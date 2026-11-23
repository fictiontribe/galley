// Vendored from @galley/astro 0.1.0 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// Galley's own capture endpoint — the default destination. The request and
// response are specified in docs/forms.md, "The capture endpoint":
//   POST <endpoint>  content-type: application/json
//   { form, values, page: { url, title, referrer }, meta }
//   200 { ok: true, id }  ·  422 { ok: false, errors: { fieldId: message }, message? }
//   429 { ok: false, message } + Retry-After  ·  403 origin refused  ·  404 form not taken here

/** @type {import("../types").Submitter} */
export async function submit(values, destination, context) {
  const own = destination.settings.endpoint;
  const root = /** @type {HTMLElement | null} */ (context.form.closest(".galley-form"));
  const configured = root?.querySelector("script[data-galley-form-config]")?.textContent;
  // Which address, in the order docs/forms.md gives: the destination's own
  // settings.endpoint; else the page's <html data-galley-endpoint> (how
  // Galley's preview sends test submissions to its own inbox, so it wins over
  // the site-wide address — a published page never carries it unless the site
  // sets it on purpose); else the site-wide capture address.
  const endpoint = (typeof own === "string" && own) || document.documentElement.dataset.galleyEndpoint || (configured ? JSON.parse(configured).endpoint : "") || "";

  if (!endpoint) return { ok: false, notConnected: true, detail: "No capture address is set for the Galley inbox." };
  let response;

  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ form: context.formId, values, page: context.page, meta: context.meta }),
    });
  } catch (error) {
    return { ok: false, detail: `The capture endpoint couldn't be reached: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (response.status === 429) {
    // The capture server says how long to wait, and exposes the header to the page.
    const header = response.headers.get("retry-after") ?? "";
    const seconds = /^\d+$/.test(header) ? Number(header) : header ? Math.max(1, Math.ceil((Date.parse(header) - Date.now()) / 1000)) : NaN;

    return { ok: false, retry: true, ...(Number.isFinite(seconds) && seconds > 0 ? { retryAfter: seconds } : {}), detail: "The capture endpoint asked to slow down (429)." };
  }
  /** @type {any} */
  const answer = await response.json().catch(() => null);

  if (response.ok && answer?.ok === true) return { ok: true, detail: `Stored as ${answer.id ?? "a new submission"}.` };
  if (response.status === 404) return { ok: false, notConnected: true, detail: `The capture endpoint doesn't take this form (404)${answer?.message ? `: ${answer.message}` : ""}.` };
  if (response.status === 403) return { ok: false, detail: "The capture endpoint refused this page's origin (403). Check the site's addresses in the app's capture settings." };
  return {
    ok: false,
    errors: answer && typeof answer.errors === "object" && answer.errors ? answer.errors : {},
    ...(typeof answer?.message === "string" && answer.message ? { message: answer.message } : {}),
    detail: `The capture endpoint answered ${response.status}${answer?.message ? `: ${answer.message}` : ""}.`,
  };
}
