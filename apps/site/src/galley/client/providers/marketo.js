// Vendored from @galley/astro 0.4.7 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// Marketo, through Marketo's own Forms 2.0 library and a hidden Marketo form,
// as Adobe documents it: load {host}/js/forms2/js/forms2.min.js, call
// MktoForms2.loadForm(host, munchkinId, formId), put the answers on the
// Marketo form (setValues for fields the form has, addHiddenFields for the
// rest — the only way values reach a known-visitor form), then submit() with
// an onSuccess that returns false so the page stays put.
//
// Posting straight to Marketo's endpoint is not a supported API; going
// through the library keeps Marketo's own validation, its anti-spam checks
// and the Munchkin cookie association (the library sends _mkto_trk itself).
// When Marketo refuses a value, its message is shown on our field.

/** @type {Map<string, Promise<void>>} */
const libraries = new Map();
/** @type {Map<string, Promise<any>>} */
const loaded = new Map();

/** @param {string} host */
function library(host) {
  if (window.MktoForms2) return Promise.resolve();
  const known = libraries.get(host);

  if (known) return known;
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");

    script.src = `${host}/js/forms2/js/forms2.min.js`;
    script.async = true;
    script.onload = () => (window.MktoForms2 ? resolve(undefined) : reject(new Error("Marketo's forms library loaded but did not start.")));
    script.onerror = () => reject(new Error(`Marketo's forms library couldn't load from ${host}.`));
    document.head.append(script);
  });

  libraries.set(host, /** @type {Promise<void>} */ (promise));
  return /** @type {Promise<void>} */ (promise);
}

/** @param {string} host @param {string} munchkinId @param {string} formId */
function marketoForm(host, munchkinId, formId) {
  const key = `${host}|${munchkinId}|${formId}`;
  const known = loaded.get(key);

  if (known) return known;
  const promise = library(host).then(
    () =>
      new Promise((resolve, reject) => {
        let element = document.getElementById(`mktoForm_${formId}`);

        if (!element) {
          element = document.createElement("form");
          element.id = `mktoForm_${formId}`;
          element.hidden = true;
          element.setAttribute("aria-hidden", "true");
          element.style.display = "none";
          document.body.append(element);
        }
        const timer = setTimeout(() => reject(new Error("Marketo's form didn't load in time.")), 15000);

        window.MktoForms2.loadForm(host, munchkinId, Number(formId), (/** @type {any} */ form) => {
          clearTimeout(timer);
          resolve(form);
        });
      }),
  );

  loaded.set(key, promise);
  promise.catch(() => loaded.delete(key));
  return promise;
}

/** @type {import("../types").Submitter} */
export async function submit(values, destination) {
  const settings = destination.settings;
  const host = String(settings.host ?? "").replace(/\/+$/, "");
  const munchkinId = String(settings.munchkinId ?? "");
  const formId = String(settings.formId ?? "");

  if (!host || !munchkinId || !formId) return { ok: false, notConnected: true, detail: "Marketo needs settings.host, settings.munchkinId and settings.formId." };
  let form;

  try {
    form = await marketoForm(host, munchkinId, formId);
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
  /** @type {Record<string, string>} */
  const flat = {};

  for (const [name, value] of Object.entries(values)) flat[name] = Array.isArray(value) ? value.join(";") : value;
  const onForm = Object.keys(form.getValues?.() ?? {});
  /** @type {Record<string, string>} */
  const present = {};
  /** @type {Record<string, string>} */
  const extra = {};

  for (const [name, value] of Object.entries(flat)) (onForm.includes(name) ? present : extra)[name] = value;
  form.setValues(present);
  if (Object.keys(extra).length > 0) form.addHiddenFields(extra);

  // Marketo's callbacks can't be removed, so each form gets them once and
  // they answer whichever submission is in flight.
  if (!form.__galley) {
    form.__galley = { end: null };
    form.onValidate((/** @type {boolean} */ valid) => {
      if (valid) return;
      // Marketo marks the refused field and writes its message into its own DOM.
      const element = form.getFormElem?.()?.[0];
      const invalid = element?.querySelector(".mktoInvalid");
      const message = element?.querySelector(".mktoErrorMsg")?.textContent?.trim() || "Marketo refused this answer.";
      const name = invalid?.getAttribute("name");

      form.__galley.end?.({ ok: false, errors: name ? { [name]: message } : {}, detail: `Marketo refused the submission: ${message}` });
    });
    form.onSuccess((/** @type {unknown} */ _values, /** @type {string} */ followUpUrl) => {
      form.__galley.end?.({ ok: true, redirect: followUpUrl || undefined, detail: "Marketo accepted the submission." });
      return false;
    });
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => end({ ok: false, detail: "Marketo didn't confirm the submission in time." }), 20000);
    const end = (/** @type {import("../types").SubmitResult} */ result) => {
      clearTimeout(timer);
      form.__galley.end = null;
      resolve(result);
    };

    form.__galley.end = end;
    form.submit();
  });
}
