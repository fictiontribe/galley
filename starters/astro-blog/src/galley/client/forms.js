// Vendored from @galley/astro 0.4.7 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// The browser half of the forms: one module for every form on the page.
// It finds each `.galley-form` the server rendered, then:
//   - validates inline and on submit, with an error summary that takes focus;
//   - shows and hides conditional fields (hidden ones are not sent);
//   - runs multi-step forms (per-step checks, progress, back/next keep answers);
//   - fills autofill fields (query, UTM first/last touch, referrer, page, cookie);
//   - sends to each destination through its provider, loaded only when a form
//     on the page uses it, and never clears what the visitor typed on failure;
//   - runs the after-submit actions and dispatches galley:form:* events.
// Baseline: browsers with ES2020 modules, fetch, URL, CustomEvent and
// `:focus-visible` — every evergreen browser since 2022.

import { applies, payloadFor, problem, shownFields, submittedValues } from "../forms/logic.js";
import { captureAttribution, utmValue } from "./attribution.js";
import { registerFormProvider, registeredProvider } from "./registry.js";

/** @typedef {import("./types").ClientFormConfig} Config */
/** @typedef {import("./types").SubmitResult} SubmitResult */
/** @typedef {import("./types").Submitter} Submitter */
/** @typedef {import("../kit").FormField} FormField */
/** @typedef {import("../kit").FormDestination} FormDestination */
/** @typedef {{ [id: string]: string | string[] }} Values */

export const KIT_VERSION = "0.4.7";

/** Built-in providers, each its own chunk. */
const BUILT_IN = /** @type {Record<string, () => Promise<{ submit: Submitter }>>} */ ({
  galley: () => import("./providers/galley.js"),
  hubspot: () => import("./providers/hubspot.js"),
  marketo: () => import("./providers/marketo.js"),
  salesforce: () => import("./providers/salesforce.js"),
  pardot: () => import("./providers/pardot.js"),
  webhook: () => import("./providers/webhook.js"),
  mailto: () => import("./providers/mailto.js"),
});

/** @param {string} id @returns {Promise<Submitter | undefined>} */
async function provider(id) {
  const own = registeredProvider(id);

  if (own) return own;
  const load = BUILT_IN[id];

  return load ? (await load()).submit : undefined;
}

/** @param {string} name @param {Element} target @param {object} detail @param {boolean} [cancelable] */
function emit(name, target, detail, cancelable = false) {
  return target.dispatchEvent(new CustomEvent(name, { bubbles: true, cancelable, detail }));
}

/** @param {string} template @param {Record<string, string | number>} [values] */
const fill = (template, values = {}) => template.replace(/\{(\w+)\}/g, (whole, key) => (key in values ? String(values[key]) : whole));

/** @param {string} name */
function cookie(name) {
  const match = document.cookie.split(/;\s*/).find((part) => part.startsWith(`${name}=`));

  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

/** @param {FormField} field @returns {string} */
function autofillValue(field) {
  const rule = field.autofill;

  if (!rule) return "";
  switch (rule.from) {
    case "query":
      return new URL(location.href).searchParams.get(rule.key ?? field.id) ?? "";
    case "utm":
      return utmValue(rule.key ?? field.id, rule.touch ?? "last");
    case "referrer":
      return document.referrer;
    case "page-url":
      return location.href;
    case "page-title":
      return document.title;
    case "cookie":
      return cookie(rule.key ?? field.id);
  }
  return "";
}

let turnstileRequested = false;

function loadTurnstile() {
  if (turnstileRequested) return;
  turnstileRequested = true;
  const script = document.createElement("script");

  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
  script.async = true;
  script.defer = true;
  document.head.append(script);
}

/** @param {HTMLElement} root */
function setUp(root) {
  const configElement = root.querySelector("script[data-galley-form-config]");
  const found = root.querySelector("form");

  if (!configElement || !found) return;
  const form = found;
  /** @type {Config} */
  const config = JSON.parse(configElement.textContent || "{}");
  const messages = config.messages;
  const fields = config.fields;
  const byId = new Map(fields.map((field) => [field.id, field]));
  const startedAt = performance.now();
  const status = /** @type {HTMLElement} */ (root.querySelector("[data-galley-status]"));
  const summary = /** @type {HTMLElement} */ (root.querySelector(".galley-form__summary"));
  const success = /** @type {HTMLElement} */ (root.querySelector("[data-galley-success]"));
  const submitButton = /** @type {HTMLButtonElement | null} */ (form.querySelector('[type="submit"]'));
  const nextButton = /** @type {HTMLButtonElement | null} */ (root.querySelector("[data-galley-next]"));
  const backButton = /** @type {HTMLButtonElement | null} */ (root.querySelector("[data-galley-back]"));
  const progress = /** @type {HTMLElement | null} */ (root.querySelector("[data-galley-progress]"));
  /** Fields the visitor has left at least once: they are checked as they type. */
  const touched = new Set();
  /** A destination's refusal stays on its field until the answer changes. */
  /** @type {Map<string, { message: string; value: string }>} */
  const refused = new Map();
  let step = 0;
  let sending = false;

  form.noValidate = true;
  root.setAttribute("data-galley-ready", "");

  /** @param {string} id */
  const wrapper = (id) => /** @type {HTMLElement | null} */ (form.querySelector(`[data-galley-field="${CSS.escape(id)}"]`));
  /** @param {string} id */
  const controls = (id) => {
    const at = wrapper(id);

    if (!at) return [];
    return /** @type {(HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)[]} */ (at.matches("input") ? [at] : [...at.querySelectorAll("input, select, textarea")]);
  };

  /** @returns {Values} */
  function read() {
    /** @type {Values} */
    const values = {};

    for (const field of fields) {
      const list = controls(field.id);

      if (field.type === "checkboxes") values[field.id] = list.filter((input) => /** @type {HTMLInputElement} */ (input).checked).map((input) => input.value);
      else if (field.type === "radio") values[field.id] = list.find((input) => /** @type {HTMLInputElement} */ (input).checked)?.value ?? "";
      else if (field.type === "checkbox" || field.type === "consent") values[field.id] = /** @type {HTMLInputElement | undefined} */ (list[0])?.checked ? "true" : "";
      else if (list[0]) values[field.id] = list[0].value;
    }
    return values;
  }

  // ── Autofill ─────────────────────────────────────────────────────────
  for (const field of fields) {
    if (!field.autofill) continue;
    const value = autofillValue(field);
    const control = controls(field.id)[0];

    if (value && control && (field.type === "hidden" || !control.value || field.autofill.from === "page-url")) control.value = value;
  }

  // ── Conditions ───────────────────────────────────────────────────────
  function applyConditions() {
    const shown = shownFields(fields, read());

    for (const at of /** @type {NodeListOf<HTMLElement>} */ (form.querySelectorAll("[data-galley-when]"))) {
      const id = at.getAttribute("data-galley-field") ?? "";
      const visible = shown.has(id);

      at.removeAttribute("data-galley-hidden");
      at.hidden = !visible;
      for (const control of at.querySelectorAll("input, select, textarea")) /** @type {HTMLInputElement} */ (control).disabled = !visible;
    }
  }

  // ── Errors ───────────────────────────────────────────────────────────
  /** @param {string} id @param {string} message */
  function showError(id, message) {
    const at = wrapper(id);
    const error = at?.querySelector("[data-galley-error]");

    if (!at || !error) return;
    error.textContent = message;
    /** @type {HTMLElement} */ (error).hidden = !message;
    at.toggleAttribute("data-invalid", Boolean(message));
    for (const control of controls(id)) {
      if (message) control.setAttribute("aria-invalid", "true");
      else control.removeAttribute("aria-invalid");
    }
  }

  /** @param {FormField} field @param {Values} values */
  const check = (field, values) => problem(field, values[field.id] ?? "", messages, config.freeEmailDomains);

  /** @param {string[]} ids @returns {{ id: string; message: string }[]} */
  function validate(ids) {
    const values = read();
    const shown = shownFields(fields, values);
    const found = [];

    for (const id of ids) {
      const field = byId.get(id);

      if (!field || !shown.has(id)) {
        showError(id, "");
        continue;
      }
      const value = JSON.stringify(values[id] ?? "");
      const kept = refused.get(id);
      const message = check(field, values) || (kept && kept.value === value ? kept.message : "");

      if (kept && kept.value !== value) refused.delete(id);
      showError(id, message);
      if (message) found.push({ id, message });
    }
    return found;
  }

  /** @param {{ id: string; message: string }[]} errors */
  function showSummary(errors) {
    const title = summary.querySelector(".galley-form__summary-title");
    const list = summary.querySelector(".galley-form__summary-list");

    if (!title || !list) return;
    if (errors.length === 0) {
      summary.hidden = true;
      return;
    }
    title.textContent = errors.length === 1 ? messages.summaryOne ?? "" : fill(messages.summaryMany ?? "", { count: errors.length });
    list.replaceChildren(
      ...errors.map(({ id, message }) => {
        const item = document.createElement("li");
        const link = document.createElement("a");
        const control = controls(id)[0];
        const label = byId.get(id)?.label;

        link.href = `#${control?.id ?? ""}`;
        link.textContent = label ? `${label}: ${message}` : message;
        link.addEventListener("click", (event) => {
          event.preventDefault();
          control?.focus();
        });
        item.append(link);
        return item;
      }),
    );
    summary.hidden = false;
    summary.focus();
  }

  /** @param {string} text @param {"error" | ""} [tone] */
  function say(text, tone = "") {
    status.textContent = text;
    if (tone) status.setAttribute("data-tone", tone);
    else status.removeAttribute("data-tone");
  }

  form.addEventListener("focusout", (event) => {
    const at = /** @type {HTMLElement} */ (event.target).closest?.("[data-galley-field]");
    const id = at?.getAttribute("data-galley-field");

    if (!id || at?.contains(/** @type {Node | null} */ (event.relatedTarget))) return;
    const values = read();
    const field = byId.get(id);

    if (field && (touched.has(id) || (values[id] ?? "") !== "")) {
      touched.add(id);
      validate([id]);
    }
  });
  form.addEventListener("input", (event) => {
    const id = /** @type {HTMLElement} */ (event.target).closest?.("[data-galley-field]")?.getAttribute("data-galley-field");

    applyConditions();
    if (id && wrapper(id)?.hasAttribute("data-invalid")) validate([id]);
  });
  form.addEventListener("change", applyConditions);

  // ── Steps ────────────────────────────────────────────────────────────
  const stepElements = /** @type {HTMLElement[]} */ ([...form.querySelectorAll("[data-galley-step]")]);
  const stepOf = (/** @type {FormField} */ field) => Math.min(config.steps - 1, field.step ?? 0);

  /** @param {number} to @param {boolean} [focus] */
  function showStep(to, focus = true) {
    step = to;
    stepElements.forEach((element, index) => (element.hidden = index !== step));
    const last = step === config.steps - 1;

    if (progress) {
      progress.hidden = false;
      progress.textContent = fill(messages.step ?? "", { step: step + 1, total: config.steps });
    }
    if (backButton) backButton.hidden = step === 0;
    if (nextButton) {
      nextButton.hidden = last;
      nextButton.textContent = config.nextLabels?.[step] ?? nextButton.textContent;
    }
    if (submitButton) submitButton.hidden = !last;
    if (focus) {
      const current = stepElements[step];
      const target = /** @type {HTMLElement | null} */ (current?.querySelector(".galley-form__step-title") ?? current?.querySelector("input:not([type=hidden]), select, textarea"));

      target?.focus();
    }
  }

  function next() {
    const errors = validate(fields.filter((field) => stepOf(field) === step).map((field) => field.id));

    showSummary(errors);
    if (errors.length === 0) showStep(step + 1);
  }

  if (config.steps > 1) {
    showStep(0, false);
    nextButton?.addEventListener("click", next);
    backButton?.addEventListener("click", () => {
      showSummary([]);
      showStep(step - 1);
    });
  }

  applyConditions();
  if (config.spam.turnstile) loadTurnstile();
  // Warm the providers this form uses, so sending doesn't wait for them.
  const warm = () => config.destinations.forEach((destination) => provider(destination.provider).catch(() => undefined));

  if ("requestIdleCallback" in window) requestIdleCallback(warm, { timeout: 3000 });
  else setTimeout(warm, 1500);

  // ── Sending ──────────────────────────────────────────────────────────
  /** @param {boolean} on */
  function busy(on) {
    sending = on;
    root.setAttribute("data-state", on ? "sending" : "idle");
    form.setAttribute("aria-busy", String(on));
    if (submitButton) submitButton.setAttribute("aria-disabled", String(on));
  }

  /** @param {FormDestination} destination @param {object} context */
  async function send(destination, context) {
    try {
      const submit = await provider(destination.provider);

      if (!submit) return { ok: false, detail: `No form provider called “${destination.provider}” is registered.` };
      const { values, items } = payloadFor(destination, fields, /** @type {Values} */ (/** @type {any} */ (context).answers));

      return /** @type {SubmitResult} */ (await submit(values, destination, { .../** @type {any} */ (context), items }));
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (sending) return;
    if (config.steps > 1 && step < config.steps - 1) {
      next();
      return;
    }
    say("");
    const all = validate(fields.map((field) => field.id));

    if (all.length > 0) {
      const firstStep = Math.min(...all.map(({ id }) => stepOf(/** @type {FormField} */ (byId.get(id)))));

      if (config.steps > 1 && firstStep !== step) showStep(firstStep, false);
      showSummary(all.filter(({ id }) => stepOf(/** @type {FormField} */ (byId.get(id))) === (config.steps > 1 ? firstStep : 0) || config.steps === 1));
      return;
    }
    showSummary([]);
    const honeypot = /** @type {HTMLInputElement | null} */ (form.querySelector("[data-galley-hp]"))?.value ?? "";
    const elapsedMs = Math.round(performance.now() - startedAt);
    const answers = submittedValues(fields, read());

    // A filled-in trap means a robot: it is shown the thank-you and nothing is sent.
    if (config.spam.honeypot && honeypot) {
      done(answers, []);
      return;
    }
    if (config.spam.minSeconds > 0 && elapsedMs < config.spam.minSeconds * 1000) {
      say(messages.tooFast ?? "", "error");
      status.focus();
      return;
    }
    const turnstileToken = /** @type {HTMLInputElement | null} */ (form.querySelector('[name="cf-turnstile-response"]'))?.value || undefined;

    if (!emit("galley:form:submit", root, { form: config.id, values: answers }, true)) return;
    const targets = config.destinations.filter((destination) => applies(destination, answers, fields));

    if (targets.length === 0) {
      fail({ ok: false, notConnected: true, detail: "No destination applies to these answers." });
      return;
    }
    busy(true);
    say(messages.sending ?? "");
    const context = {
      formId: config.id,
      form,
      fields,
      answers,
      page: { url: location.href, title: document.title, referrer: document.referrer },
      meta: { elapsedMs, honeypot, turnstileToken, locale: navigator.language, kit: KIT_VERSION },
      messages,
    };
    const navigates = (/** @type {FormDestination} */ destination) => destination.settings.mode === "navigate" && (destination.provider === "salesforce" || destination.provider === "pardot");
    const inPage = targets.filter((destination) => !navigates(destination));
    const leaving = targets.filter(navigates);
    const pending = inPage.map((destination) => send(destination, context));
    const primary = targets[0];
    const primaryLeaves = primary ? navigates(primary) : false;
    const result = primaryLeaves ? { ok: true } : await /** @type {Promise<SubmitResult>} */ (pending[0]);

    // The others get a few seconds to finish before the page moves on.
    await Promise.race([Promise.allSettled(pending), new Promise((done) => setTimeout(done, 4000))]);
    if (!result.ok) {
      fail(result, primary);
      return;
    }
    const results = await Promise.all(pending.map((promise) => Promise.race([promise, Promise.resolve({ ok: false, detail: "still sending" })])));

    if (leaving.length > 0) {
      // A destination that takes the visitor away goes last; only actions that
      // don't need the page (events, webhooks) run first.
      runActions(answers, results, true);
      busy(false);
      for (const destination of leaving.slice(1)) void send(destination, context);
      await send(/** @type {FormDestination} */ (leaving[0]), context);
      return;
    }
    done(answers, results, result);
  });

  /** @param {SubmitResult} result @param {FormDestination} [destination] */
  function fail(result, destination) {
    busy(false);
    const errors = result.errors ?? {};
    const named = Object.entries(errors)
      .map(([name, message]) => {
        const field = fields.find((item) => item.id === name || destination?.mapping?.[item.id] === name || item.name === name);

        return field ? { id: field.id, message } : null;
      })
      .filter((item) => item !== null);

    const values = read();

    named.forEach(({ id, message }) => {
      refused.set(id, { message, value: JSON.stringify(values[id] ?? "") });
      showError(id, message);
    });
    const text = result.retry
      ? result.retryAfter
        ? result.retryAfter === 1
          ? messages.rateLimitedForOne
          : fill(messages.rateLimitedFor ?? "", { seconds: result.retryAfter })
        : messages.rateLimited
      : result.notConnected
        ? messages.notConnected
        : result.message || messages.error;

    say(text ?? "", "error");
    emit("galley:form:error", root, { form: config.id, detail: result.detail, errors });
    if (result.detail) console.warn(`[galley] The form “${config.id}” couldn't be sent: ${result.detail}`);
    if (named.length > 0) showSummary(named);
    else {
      status.tabIndex = -1;
      status.focus();
    }
  }

  /** @param {Values} answers @param {SubmitResult[]} results @param {SubmitResult} [primary] */
  function done(answers, results, primary) {
    busy(false);
    say("");
    const redirect = runActions(answers, results, false);
    const showsMessage = config.afterSubmit.some((action) => action.type === "message") || !redirect || (redirect.delaySeconds ?? 0) > 0;

    if (showsMessage) {
      for (const slot of success.querySelectorAll("[data-galley-value]")) {
        const value = answers[slot.getAttribute("data-galley-value") ?? ""];

        slot.textContent = Array.isArray(value) ? value.join(", ") : value ?? "";
      }
      form.hidden = true;
      success.hidden = false;
      success.setAttribute("role", "status");
      success.focus();
      root.setAttribute("data-state", "sent");
    }
    emit("galley:form:success", root, { form: config.id, values: answers, results, redirect: primary?.redirect });
    if (redirect) {
      const url = new URL(redirect.url, location.href);

      for (const id of redirect.passFields ?? []) {
        const value = answers[id];

        if (value !== undefined) url.searchParams.set(id, Array.isArray(value) ? value.join(",") : value);
      }
      if (!/^https?:$/.test(url.protocol)) return;
      setTimeout(() => location.assign(url.href), Math.max(150, (redirect.delaySeconds ?? 0) * 1000));
    }
  }

  /**
   * Runs the after-submit actions in order and returns the redirect (if any),
   * which the caller performs last so nothing after it is cut short.
   *
   * @param {Values} answers @param {SubmitResult[]} results @param {boolean} leaving
   */
  function runActions(answers, results, leaving) {
    /** @type {{ url: string; passFields?: string[]; delaySeconds?: number } | undefined} */
    let redirect;
    /** @param {string} text */
    const withAnswers = (text) =>
      text.replace(/\{\{\s*([a-z][a-z0-9_-]*)\s*\}\}/g, (_, id) => {
        const value = answers[id];

        return Array.isArray(value) ? value.join(", ") : value ?? "";
      });

    for (const action of config.afterSubmit) {
      try {
        switch (action.type) {
          case "redirect":
            if (!leaving) redirect = action;
            break;
          case "download":
            if (action.auto && !leaving) /** @type {HTMLAnchorElement | null} */ (success.querySelector(".galley-form__download a"))?.click();
            break;
          case "event": {
            /** @type {Record<string, string>} */
            const params = {};

            for (const [key, value] of Object.entries(action.params ?? {})) params[key] = withAnswers(value);
            const target = action.target ?? "dataLayer";

            if (target === "dataLayer") (window.dataLayer = window.dataLayer || []).push({ event: action.name, galley_form: config.id, ...params });
            else if (target === "gtag") window.gtag?.("event", action.name, params);
            else root.dispatchEvent(new CustomEvent(action.name, { bubbles: true, detail: { form: config.id, values: answers, params } }));
            break;
          }
          case "webhook": {
            const body = JSON.stringify({ form: config.id, values: answers, page: { url: location.href, title: document.title, referrer: document.referrer }, at: new Date().toISOString() });

            if (!navigator.sendBeacon?.(action.url, new Blob([body], { type: "text/plain;charset=UTF-8" }))) {
              void fetch(action.url, { method: "POST", body, keepalive: true, mode: "no-cors", headers: { "content-type": "text/plain;charset=UTF-8" } }).catch(() => undefined);
            }
            break;
          }
          case "script":
            // Present only when the site set forms.allowFormScripts (docs/forms.md).
            new Function("values", "form", "results", action.code)(structuredClone(answers), form, results);
            break;
        }
      } catch (error) {
        console.error(`[galley] An after-submit action of the form “${config.id}” failed:`, error);
      }
    }
    return redirect;
  }
}

/**
 * Starts every form under `root` that isn't running yet. Safe to call again
 * after new forms are added to the page.
 *
 * @param {ParentNode} [root]
 */
export function initForms(root = document) {
  captureAttribution();
  for (const element of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll(".galley-form:not([data-galley-ready])"))) setUp(element);
}

window.galleyForms = { registerProvider: registerFormProvider, init: initForms };

export { registerFormProvider };
