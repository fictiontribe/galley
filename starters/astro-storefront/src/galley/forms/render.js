// Vendored from @galley/astro 0.4.4 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// A form definition → its complete HTML, on the server. Everything a visitor
// needs is in the page before any JavaScript runs: labels, inputs with native
// validation attributes, help, options, every step, consent text, and — when
// the first suitable destination accepts a plain form post — a working
// `action`. The browser runtime (client/forms.js) then takes over: inline
// validation, steps, conditions, sending without leaving the page.
//
// Pure string building, so it can be tested without Astro and reused by any
// renderer. Every text from the file is escaped; Markdown is the small
// inline subset in shared/markdown.js.

import { escapeHtml as esc, inlineMarkdown as inlineMd, markdownParagraphs as paragraphsMd, withBase } from "../shared/markdown.js";
import { isServerSide, LAYOUT } from "./logic.js";
import { FREE_EMAIL_DOMAINS } from "./free-email-domains.js";
import { fill, resolveMessages } from "./messages.js";

/** @typedef {import("../kit").FormDefinition} FormDefinition */
/** @typedef {import("../kit").FormField} FormField */
/** @typedef {import("../kit").FormDestination} FormDestination */

/**
 * @typedef {object} RenderOptions
 * @property {string} [endpoint]  The site-wide capture endpoint for "galley" destinations.
 * @property {string} [pageUrl]  This page's absolute address (no-JS returns, `page-url` autofill).
 * @property {Record<string, string>} [messages]  Site-wide wording (see messages.js).
 * @property {string} [instance]  Suffix that keeps ids unique when one form appears twice on a page.
 * @property {string} [className]  Extra classes for the <form>.
 * @property {string} [submitClass]  Extra classes for the submit and next buttons (e.g. the site's "button").
 * @property {string} [backClass]  Extra classes for a multi-step form's back button.
 * @property {number} [headingLevel]  Level of `heading` fields. Default 3.
 * @property {boolean} [allowFormScripts]  Keep `script` actions (see docs/forms.md).
 * @property {boolean} [unstyled]
 * @property {string[]} [freeEmailDomains]  Extra free-mailbox domains.
 * @property {string} [base]  The site's base path ("/docs"): links written from the site root get it.
 */

/**
 * What a build should say about a form, once: `key` is the same for every
 * form the note applies to, so a site with several such forms hears it once
 * per build ("no-endpoint"), or once per form ("script-actions:<id>").
 *
 * @typedef {{ key: string; text: string }} RenderNotice
 */

/** Browser autofill hints, by the field's id or name. */
const AUTOCOMPLETE = /** @type {Record<string, string>} */ ({
  name: "name",
  full_name: "name",
  fullname: "name",
  "full-name": "name",
  first_name: "given-name",
  firstname: "given-name",
  "first-name": "given-name",
  given_name: "given-name",
  last_name: "family-name",
  lastname: "family-name",
  "last-name": "family-name",
  surname: "family-name",
  family_name: "family-name",
  email: "email",
  work_email: "email",
  "work-email": "email",
  company: "organization",
  organization: "organization",
  organisation: "organization",
  company_name: "organization",
  "company-name": "organization",
  job_title: "organization-title",
  "job-title": "organization-title",
  jobtitle: "organization-title",
  title: "organization-title",
  phone: "tel",
  telephone: "tel",
  mobile: "tel",
  tel: "tel",
  country: "country-name",
  postal_code: "postal-code",
  "postal-code": "postal-code",
  postcode: "postal-code",
  zip: "postal-code",
  city: "address-level2",
  address: "street-address",
  website: "url",
});
const TEXTLIKE = new Set(["text", "email", "tel", "url", "number", "date", "textarea"]);

/**
 * The destination a browser without JavaScript can post to: the first one,
 * in order and without a `when` condition, whose provider accepts a plain
 * form post. HubSpot (JSON API) and Marketo (its own library) do not.
 *
 * @param {FormDestination[]} destinations
 * @param {string} endpoint
 * @returns {{ index: number; action: string; enctype?: string; hidden: Record<string, string> } | null}
 */
export function nativeTarget(destinations, endpoint, pageUrl = "", formId = "") {
  for (const [index, destination] of destinations.entries()) {
    if (destination.when || isServerSide(destination)) continue;
    const s = destination.settings;
    const str = (/** @type {string} */ key) => (typeof s[key] === "string" ? /** @type {string} */ (s[key]) : "");
    const sent = pageUrl ? `${pageUrl.split("#")[0]}#galley-sent-${formId}` : "";

    switch (destination.provider) {
      case "galley": {
        const url = str("endpoint") || endpoint;

        if (url) return { index, action: url, hidden: { _galley_form: formId, ...(sent ? { _galley_return: sent } : {}) } };
        break;
      }
      case "webhook":
        if (str("format") === "form" && str("url")) return { index, action: str("url"), hidden: {} };
        break;
      case "salesforce":
        if (str("orgId")) {
          return {
            index,
            action: "https://webto.salesforce.com/servlet/servlet.WebToLead?encoding=UTF-8",
            hidden: { oid: str("orgId"), ...(str("returnUrl") || sent ? { retURL: str("returnUrl") || sent } : {}) },
          };
        }
        break;
      case "pardot":
        if (str("handlerUrl")) return { index, action: str("handlerUrl"), hidden: {} };
        break;
      case "mailto":
        if (str("to")) {
          const subject = str("subject");

          return { index, action: `mailto:${str("to")}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`, enctype: "text/plain", hidden: {} };
        }
        break;
    }
  }
  return null;
}

/** @param {Record<string, string | number | boolean | undefined | null>} attrs */
function attributes(attrs) {
  let out = "";

  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    out += value === true ? ` ${name}` : ` ${name}="${esc(String(value))}"`;
  }
  return out;
}

/**
 * @param {FormDefinition} definition
 * @param {string} formId  The form's id (its file name).
 * @param {RenderOptions} [options]
 */
export function renderForm(definition, formId, options = {}) {
  const messages = resolveMessages(options.messages, definition.messages);
  const base = options.base ?? "";
  /** @param {string} text */
  const inlineMarkdown = (text) => inlineMd(text, { base });
  /** @param {string} text */
  const markdownParagraphs = (text) => paragraphsMd(text, { base });
  const uid = `galley-${formId}${options.instance ? `-${options.instance}` : ""}`;
  const steps = Math.max(1, definition.steps?.length ?? 1);
  const appearance = definition.appearance ?? {};
  const labels = appearance.labels ?? "above";
  const endpoint = options.endpoint ?? "";
  const native = nativeTarget(definition.destinations, endpoint, options.pageUrl, formId);
  const nativeDestination = native ? definition.destinations[native.index] : undefined;
  /** @type {RenderNotice[]} */
  const notices = [];
  const headingTag = `h${Math.min(6, Math.max(2, options.headingLevel ?? 3))}`;
  const nameFor = (/** @type {FormField} */ field) => nativeDestination?.mapping?.[field.id] ?? field.name ?? field.id;
  const primary = definition.destinations[0];

  if (primary?.provider === "galley" && !(typeof primary.settings.endpoint === "string" && primary.settings.endpoint) && !endpoint) {
    notices.push({
      key: "no-endpoint",
      text: `The form “${formId}” sends to the Galley inbox, but no capture address is set: put the inbox address in forms.endpoint (src/galley/settings.json for a vendored kit, or the integration's options), or in the destination's settings.endpoint. Galley's preview supplies its own address; on the live site the form will say it isn't connected yet.`,
    });
  }
  const scriptActions = definition.afterSubmit.filter((action) => action.type === "script");

  if (scriptActions.length > 0 && !options.allowFormScripts) {
    notices.push({
      key: `script-actions:${formId}`,
      text: `The form “${formId}” has ${scriptActions.length === 1 ? "a script action" : `${scriptActions.length} script actions`}, which only run when forms.allowFormScripts is true (src/galley/settings.json for a vendored kit, or the integration's options). Leaving ${scriptActions.length === 1 ? "it" : "them"} out.`,
    });
  }

  /** Initial answers, for working out which conditional fields start hidden. */
  /** @type {Record<string, string>} */
  const initial = {};

  for (const field of definition.fields) initial[field.id] = field.defaultValue ?? "";

  const describedBy = (/** @type {FormField} */ field, /** @type {string} */ id) => [field.help ? `${id}-help` : "", `${id}-error`].filter(Boolean).join(" ");
  const requiredMark = (/** @type {FormField} */ field) =>
    field.required ? `<span class="galley-form__required" aria-hidden="true">${esc(messages.requiredMark)}</span>` : messages.optional ? ` <span class="galley-form__optional">${esc(messages.optional)}</span>` : "";
  const helpAndError = (/** @type {FormField} */ field, /** @type {string} */ id) =>
    `${field.help ? `<p class="galley-form__help" id="${id}-help">${inlineMarkdown(field.help)}</p>` : ""}<p class="galley-form__error" id="${id}-error" data-galley-error hidden></p>`;

  /** @param {FormField} field */
  function control(field) {
    const id = `${uid}-${field.id}`;
    const label = field.label ?? field.id;
    const hiddenLabel = labels === "hidden";
    const floating = labels === "floating" && TEXTLIKE.has(field.type) && field.type !== "date";
    const rules = field.validation ?? {};
    const conditional = Boolean(field.showWhen);
    const common = {
      id,
      name: nameFor(field),
      class: "galley-form__control",
      // A conditional field is only required while it shows; the runtime checks it.
      required: Boolean(field.required) && !conditional,
      "aria-describedby": describedBy(field, id),
    };
    const labelHtml = `<label class="galley-form__label${hiddenLabel ? " galley-visually-hidden" : ""}" for="${id}">${esc(label)}${requiredMark(field)}</label>`;

    switch (field.type) {
      case "textarea":
        return {
          id,
          html: `${floating ? "" : labelHtml}<textarea${attributes({
            ...common,
            rows: 5,
            placeholder: floating ? " " : field.placeholder ?? (hiddenLabel ? label : undefined),
            minlength: rules.minLength,
            maxlength: rules.maxLength,
          })}>${esc(field.defaultValue ?? "")}</textarea>${floating ? labelHtml : ""}${helpAndError(field, id)}`,
        };
      case "select": {
        const options = (field.options ?? [])
          .map((option) => `<option${attributes({ value: option.value, selected: field.defaultValue === option.value })}>${esc(option.label)}</option>`)
          .join("");

        return {
          id,
          html: `${labelHtml}<select${attributes(common)}><option value=""${field.defaultValue ? "" : " selected"}>${esc(field.placeholder ?? messages.choose)}</option>${options}</select>${helpAndError(field, id)}`,
        };
      }
      case "radio":
      case "checkboxes": {
        const type = field.type === "radio" ? "radio" : "checkbox";
        const chosen = (field.defaultValue ?? "").split(",").map((part) => part.trim());
        const options = (field.options ?? [])
          .map(
            (option, index) =>
              `<div class="galley-form__option"><input${attributes({
                type,
                id: `${id}-${index}`,
                name: nameFor(field),
                value: option.value,
                class: "galley-form__choice",
                checked: chosen.includes(option.value),
                required: type === "radio" && Boolean(field.required) && !conditional,
              })}><label for="${id}-${index}">${esc(option.label)}</label></div>`,
          )
          .join("");

        return {
          id,
          group: true,
          html: `<legend class="galley-form__label${hiddenLabel ? " galley-visually-hidden" : ""}" id="${id}-label">${esc(label)}${requiredMark(field)}</legend><div class="galley-form__options">${options}</div>${helpAndError(field, id)}`,
        };
      }
      case "checkbox":
      case "consent": {
        const text = field.type === "consent" ? inlineMarkdown(field.text ?? label) : esc(label);

        return {
          id,
          check: true,
          html: `<input${attributes({ ...common, type: "checkbox", value: "true", class: "galley-form__choice", checked: field.defaultValue === "true" })}><label class="galley-form__label" for="${id}">${text}${requiredMark(field)}</label>${helpAndError(field, id)}`,
        };
      }
      default: {
        const type = field.type === "text" ? "text" : field.type;
        const key = (field.name ?? field.id).toLowerCase();
        const autocomplete = AUTOCOMPLETE[key] ?? AUTOCOMPLETE[field.id] ?? (type === "email" ? "email" : type === "tel" ? "tel" : type === "url" ? "url" : undefined);
        const value = field.autofill?.from === "page-url" && options.pageUrl ? options.pageUrl : field.defaultValue;
        const input = `<input${attributes({
          ...common,
          type,
          value,
          autocomplete,
          inputmode: type === "number" ? "decimal" : undefined,
          placeholder: floating ? " " : field.placeholder ?? (hiddenLabel ? label : undefined),
          minlength: rules.minLength,
          maxlength: rules.maxLength,
          min: rules.min,
          max: rules.max,
          pattern: rules.pattern,
        })}>`;

        return { id, html: floating ? `${input}${labelHtml}${helpAndError(field, id)}` : `${labelHtml}${input}${helpAndError(field, id)}` };
      }
    }
  }

  /** @param {FormField} field */
  function fieldHtml(field) {
    const base = { "data-galley-field": field.id, "data-type": field.type, "data-width": field.width === "half" ? "half" : undefined };
    const hiddenAtStart = field.showWhen ? !conditionHolds(field, initial) : false;
    const when = { "data-galley-when": Boolean(field.showWhen), "data-galley-hidden": hiddenAtStart };

    if (field.type === "hidden") {
      const value = field.autofill?.from === "page-url" && options.pageUrl ? options.pageUrl : field.defaultValue ?? "";

      return `<input${attributes({ type: "hidden", id: `${uid}-${field.id}`, name: nameFor(field), value, "data-galley-field": field.id, "data-type": "hidden" })}>`;
    }
    if (field.type === "heading") {
      return `<div${attributes({ class: "galley-form__field galley-form__layout", ...base, ...when })}><${headingTag} class="galley-form__heading">${inlineMarkdown(field.text ?? field.label ?? "")}</${headingTag}></div>`;
    }
    if (field.type === "paragraph") {
      return `<div${attributes({ class: "galley-form__field galley-form__layout", ...base, ...when })}><div class="galley-form__text">${markdownParagraphs(field.text ?? field.label ?? "")}</div></div>`;
    }
    const built = control(field);

    if (built.group) {
      return `<fieldset${attributes({ class: "galley-form__field galley-form__group", ...base, ...when, "aria-describedby": describedBy(field, built.id) })}>${built.html}</fieldset>`;
    }
    return `<div${attributes({ class: `galley-form__field${built.check ? " galley-form__check" : ""}`, ...base, ...when, "data-floating": labels === "floating" && TEXTLIKE.has(field.type) && field.type !== "date" })}>${built.html}</div>`;
  }

  /** Whether a conditional field shows for the initial answers (one level is enough here). */
  function conditionHolds(/** @type {FormField} */ field, /** @type {Record<string, string>} */ values) {
    const rule = field.showWhen;

    if (!rule) return true;
    const value = values[rule.field] ?? "";

    if (rule.equals !== undefined) return value === rule.equals;
    if (rule.notEquals !== undefined) return value !== rule.notEquals;
    if (rule.in !== undefined) return rule.in.includes(value);
    return value !== "";
  }

  // ── The form ──────────────────────────────────────────────────────────
  const stepOf = (/** @type {FormField} */ field) => Math.min(steps - 1, field.step ?? 0);
  let body = "";

  if (steps > 1) {
    body += `<p class="galley-form__progress" data-galley-progress hidden>${esc(fill(messages.step, { step: 1, total: steps }))}</p>`;
    for (let step = 0; step < steps; step += 1) {
      const title = definition.steps?.[step]?.title;
      const fields = definition.fields.filter((field) => stepOf(field) === step && field.type !== "hidden");

      body += `<fieldset class="galley-form__step" data-galley-step="${step}"${title ? "" : ` aria-label="${esc(fill(messages.step, { step: step + 1, total: steps }))}"`}>${
        title ? `<legend class="galley-form__step-title" tabindex="-1">${esc(title)}</legend>` : ""
      }<div class="galley-form__fields">${fields.map(fieldHtml).join("")}</div></fieldset>`;
    }
  } else {
    body += `<div class="galley-form__fields">${definition.fields.filter((field) => field.type !== "hidden").map(fieldHtml).join("")}</div>`;
  }

  const hiddenInputs =
    definition.fields
      .filter((field) => field.type === "hidden")
      .map(fieldHtml)
      .join("") +
    Object.entries({ ...(native?.hidden ?? {}), ...(nativeDestination?.constants ?? {}) })
      .map(([name, value]) => `<input type="hidden"${attributes({ name, value })}>`)
      .join("");
  const honeypot =
    definition.spam?.honeypot === false
      ? ""
      : `<div class="galley-form__hp" aria-hidden="true"><label for="${uid}-hp">${esc(messages.honeypotLabel)}</label><input type="text" id="${uid}-hp" name="_galley_hp" tabindex="-1" autocomplete="off" data-galley-hp></div>`;
  const turnstile = definition.spam?.turnstileSiteKey ? `<div class="cf-turnstile galley-form__turnstile"${attributes({ "data-sitekey": definition.spam.turnstileSiteKey })}></div>` : "";
  const nav =
    steps > 1
      ? `<button type="button" class="galley-form__back${options.backClass ? ` ${esc(options.backClass)}` : ""}" data-galley-back hidden>${esc(messages.back)}</button><button type="button" class="galley-form__next${options.submitClass ? ` ${esc(options.submitClass)}` : ""}" data-galley-next hidden>${esc(definition.steps?.[0]?.nextLabel ?? messages.next)}</button>`
      : "";
  const submit = `<button type="submit" class="galley-form__submit${options.submitClass ? ` ${esc(options.submitClass)}` : ""}" data-galley-submit>${esc(definition.submitLabel)}</button>`;
  const formAttrs = attributes({
    id: uid,
    class: `galley-form__form${options.className ? ` ${options.className}` : ""}`,
    action: native?.action,
    method: native ? "post" : undefined,
    enctype: native?.enctype,
    "accept-charset": native ? "UTF-8" : undefined,
    "aria-label": definition.name,
    "aria-describedby": definition.description ? `${uid}-description` : undefined,
    "data-galley-requires-js": !native,
  });

  const start =
    `<div${attributes({
      class: "galley-form",
      "data-galley-form": formId,
      "data-layout": appearance.layout ?? "stacked",
      "data-size": appearance.size ?? "regular",
      "data-labels": labels,
      "data-steps": steps > 1 ? steps : undefined,
      "data-state": "idle",
      "data-galley-unstyled": Boolean(options.unstyled),
    })}>` +
    `<form${formAttrs}>` +
    (definition.description ? `<p class="galley-form__description" id="${uid}-description">${inlineMarkdown(definition.description)}</p>` : "") +
    `<div class="galley-form__summary" id="${uid}-summary" tabindex="-1" role="group" aria-labelledby="${uid}-summary-title" hidden><p class="galley-form__summary-title" id="${uid}-summary-title"></p><ul class="galley-form__summary-list"></ul></div>`;
  const middle = hiddenInputs + honeypot + body + turnstile;
  const actionsStart = `<div class="galley-form__actions">${nav}`;
  const actionsEnd =
    `</div><p class="galley-form__status" id="${uid}-status" role="status" data-galley-status></p>` +
    (native ? "" : `<noscript><p class="galley-form__noscript">${esc(messages.noScript)}</p></noscript>`);
  const formEnd = "</form>";

  // ── After a successful submission ─────────────────────────────────────
  const message = /** @type {{ type: "message"; title?: string; text: string } | undefined} */ (definition.afterSubmit.find((action) => action.type === "message"));
  const downloads = definition.afterSubmit.filter((action) => action.type === "download");
  const mailtoPrimary = primary?.provider === "mailto";
  const successDefault =
    (message
      ? `${message.title ? `<p class="galley-form__success-title">${inlineMarkdown(message.title)}</p>` : ""}<div class="galley-form__success-text">${markdownParagraphs(message.text)}</div>`
      : `<p class="galley-form__success-title">${esc(messages.thanksTitle)}</p><div class="galley-form__success-text"><p>${esc(mailtoPrimary ? messages.mailtoText : messages.thanksText)}</p></div>`) +
    downloads
      .map((action) => (action.type === "download" ? `<p class="galley-form__download"><a href="${esc(withBase(action.url, base))}" download>${esc(action.label ?? messages.download)}</a></p>` : ""))
      .join("");
  const successStart = `<div class="galley-form__success" id="galley-sent-${formId}${options.instance ? `-${options.instance}` : ""}" tabindex="-1" data-galley-success hidden>`;
  const successEnd = "</div>";

  // ── What the runtime needs ────────────────────────────────────────────
  const config = {
    id: formId,
    uid,
    endpoint,
    fields: definition.fields
      .filter((field) => !LAYOUT.has(field.type) || field.showWhen)
      .map((field) => {
        /** @type {Record<string, unknown>} */
        const out = { id: field.id, type: field.type };

        // A consent field's text travels too: providers that record consent (HubSpot) send it.
        if (field.type === "consent") out.text = field.text ?? field.label ?? "";
        for (const key of /** @type {const} */ (["label", "name", "required", "validation", "showWhen", "autofill", "step", "options"])) {
          const value = field[key];

          if (value === undefined) continue;
          out[key] = key === "options" ? field.options?.map((option) => ({ value: option.value, label: option.label })) : value;
        }
        return out;
      }),
    steps,
    nextLabels: definition.steps?.map((step) => step.nextLabel ?? messages.next),
    // Server-side destinations are the capture server's to forward: their addresses stay out of the page.
    destinations: definition.destinations.filter((destination) => !isServerSide(destination)),
    // A redirect written from the site root ("/thanks/") goes to the page under the base path.
    afterSubmit: definition.afterSubmit.filter((action) => action.type !== "script" || options.allowFormScripts).map((action) => (action.type === "redirect" ? { ...action, url: withBase(action.url, base) } : action)),
    spam: { honeypot: definition.spam?.honeypot !== false, minSeconds: definition.spam?.minSeconds ?? 0, turnstile: Boolean(definition.spam?.turnstileSiteKey) },
    native: native?.index ?? -1,
    messages: {
      ...pick(messages, ["required", "requiredChoice", "requiredCheck", "email", "businessEmail", "url", "tel", "number", "date", "min", "max", "minLength", "maxLength", "pattern"]),
      ...pick(messages, ["summaryOne", "summaryMany", "sending", "sent", "rateLimited", "rateLimitedFor", "rateLimitedForOne", "tooFast", "notConnected", "step"]),
      error: definition.errorMessage ?? messages.error,
    },
    // The free-mailbox list travels only with forms that refuse personal addresses.
    freeEmailDomains: definition.fields.some((field) => field.validation?.businessEmailOnly) ? [...FREE_EMAIL_DOMAINS, ...(options.freeEmailDomains ?? [])] : [],
    name: definition.name,
  };
  const configHtml = `<script type="application/json" data-galley-form-config>${JSON.stringify(config).replace(/</g, "\\u003c")}</script>`;
  const end = `${successEnd}${configHtml}</div>`;

  return { start, middle, actionsStart, submit, actionsEnd, formEnd, successStart, successDefault, end, warnings: notices.map((notice) => notice.text), notices, config, uid };
}

/**
 * @template {Record<string, string>} T
 * @param {T} source
 * @param {(keyof T)[]} keys
 */
function pick(source, keys) {
  /** @type {Partial<T>} */
  const out = {};

  for (const key of keys) out[key] = source[key];
  return out;
}

/**
 * The whole form as one string (no slots) — for tests and non-Astro use.
 *
 * @param {FormDefinition} definition
 * @param {string} formId
 * @param {RenderOptions} [options]
 */
export function renderFormHtml(definition, formId, options) {
  const parts = renderForm(definition, formId, options);

  return parts.start + parts.middle + parts.actionsStart + parts.submit + parts.actionsEnd + parts.formEnd + parts.successStart + parts.successDefault + parts.end;
}
