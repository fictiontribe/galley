// Vendored from @galleycms/astro 0.4.9 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// The rules of a form that don't need a page: which fields are showing,
// whether an answer is acceptable, which destinations get the submission and
// what each one is sent. Shared by the browser runtime and the tests.

/** @typedef {import("../kit").FormField} FormField */
/** @typedef {import("../kit").FormDestination} FormDestination */
/** @typedef {{ [fieldId: string]: string | string[] }} Values */
/** @typedef {{ field: FormField; name: string; value: string | string[] }} PayloadItem */

export const LAYOUT = new Set(["heading", "paragraph"]);
/** How a ticked box reads in conditions — "yes", as the capture server stores it and the app's builder writes rules. */
export const TICKED = "yes";

/**
 * An answer as conditions see it. A box the browser holds as "true" is "yes"
 * (and an unticked one is no answer), so `showWhen` / `when` rules behave in
 * the page exactly as on the server.
 *
 * @param {FormField | undefined} field
 * @param {string | string[] | undefined} value
 */
export function conditionValue(field, value) {
  if (field && (field.type === "checkbox" || field.type === "consent")) return value === "true" || value === TICKED ? TICKED : "";
  return value;
}

/**
 * Destinations the Galley server forwards to after capture (`settings.serverSide: true`):
 * never sent from the page, and never written into it.
 *
 * @param {FormDestination} destination
 */
export const isServerSide = (destination) => destination.provider !== "galley" && destination.settings?.serverSide === true;

/** @param {string | string[] | undefined} value */
const asList = (value) => (Array.isArray(value) ? value : value === undefined || value === "" ? [] : [value]);

/**
 * Whether one condition holds for the current answers.
 *
 * @param {{ equals?: string; notEquals?: string; in?: string[] }} rule
 * @param {string | string[] | undefined} value
 */
export function holds(rule, value) {
  const list = Array.isArray(value) ? value : [value ?? ""];

  if (rule.equals === undefined && rule.notEquals === undefined && rule.in === undefined) return asList(value).length > 0;
  if (rule.equals !== undefined && !list.includes(rule.equals)) return false;
  if (rule.notEquals !== undefined && list.includes(rule.notEquals)) return false;
  if (rule.in !== undefined && !list.some((item) => rule.in?.includes(item))) return false;
  return true;
}

/**
 * The ids of the fields that are showing. A field whose condition depends on
 * a hidden field is hidden too (a hidden field has no answer).
 *
 * @param {FormField[]} fields
 * @param {Values} values
 * @returns {Set<string>}
 */
export function shownFields(fields, values) {
  const byId = new Map(fields.map((field) => [field.id, field]));
  /** @type {Map<string, boolean>} */
  const memo = new Map();
  /** @param {string} id @param {Set<string>} seen @returns {boolean} */
  const shown = (id, seen) => {
    const known = memo.get(id);

    if (known !== undefined) return known;
    const field = byId.get(id);
    let result = Boolean(field);

    if (field?.showWhen) {
      const controller = field.showWhen.field;

      result = !seen.has(controller) && shown(controller, new Set([...seen, id])) && holds(field.showWhen, conditionValue(byId.get(controller), values[controller]));
    }
    memo.set(id, result);
    return result;
  };

  return new Set(fields.filter((field) => shown(field.id, new Set())).map((field) => field.id));
}

/**
 * Whether the page sends to this destination: not server-side, and its
 * `when` holds.
 *
 * @param {FormDestination} destination
 * @param {Values} values
 * @param {FormField[]} [fields]
 */
export function applies(destination, values, fields = []) {
  if (isServerSide(destination)) return false;
  const when = destination.when;

  return !when || holds({ equals: when.equals }, conditionValue(fields.find((field) => field.id === when.field), values[when.field]));
}

/**
 * What one destination is sent: every showing, non-layout field under its
 * mapped name (else `name`, else `id`), then the destination's constants.
 *
 * @param {FormDestination} destination
 * @param {FormField[]} fields
 * @param {Values} values
 * @returns {{ values: { [name: string]: string | string[] }; items: PayloadItem[] }}
 */
export function payloadFor(destination, fields, values) {
  const shown = shownFields(fields, values);
  /** @type {PayloadItem[]} */
  const items = [];
  /** @type {{ [name: string]: string | string[] }} */
  const out = {};

  for (const field of fields) {
    if (LAYOUT.has(field.type) || !shown.has(field.id)) continue;
    let value = values[field.id] ?? "";

    if ((field.type === "checkbox" || field.type === "consent") && value === "") value = "false";
    const name = destination.mapping?.[field.id] ?? field.name ?? field.id;

    items.push({ field, name, value });
    out[name] = value;
  }
  for (const [name, value] of Object.entries(destination.constants ?? {})) out[name] = value;
  return { values: out, items };
}

/**
 * The visitor's answers with hidden fields left out — what the form submits.
 *
 * @param {FormField[]} fields
 * @param {Values} values
 * @returns {Values}
 */
export function submittedValues(fields, values) {
  const shown = shownFields(fields, values);
  /** @type {Values} */
  const out = {};

  for (const field of fields) if (!LAYOUT.has(field.type) && shown.has(field.id)) out[field.id] = values[field.id] ?? "";
  return out;
}

/** @param {string} template @param {Record<string, string | number>} values */
const fill = (template, values) => template.replace(/\{(\w+)\}/g, (whole, key) => (key in values ? String(values[key]) : whole));

/**
 * Why an answer is refused, in the form's words — or "" when it is fine.
 *
 * @param {FormField} field
 * @param {string | string[]} value
 * @param {Record<string, string>} messages
 * @param {string[]} [freeDomains]
 * @returns {string}
 */
export function problem(field, value, messages, freeDomains = []) {
  const rules = field.validation ?? {};
  const say = (/** @type {string} */ key, /** @type {Record<string, string | number>} */ vars = {}) => rules.message || fill(messages[key] ?? key, { label: field.label ?? field.id, ...vars });
  const list = asList(value);
  const text = Array.isArray(value) ? value.join(",") : value;

  if (LAYOUT.has(field.type) || field.type === "hidden") return "";
  if (list.length === 0 || ((field.type === "checkbox" || field.type === "consent") && text !== "true")) {
    if (!field.required) return "";
    if (field.type === "checkbox" || field.type === "consent") return say("requiredCheck");
    return say(field.type === "select" || field.type === "radio" || field.type === "checkboxes" ? "requiredChoice" : "required");
  }
  switch (field.type) {
    case "email": {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return say("email");
      const domain = text.split("@").pop()?.toLowerCase() ?? "";

      if (rules.businessEmailOnly && freeDomains.includes(domain)) return say("businessEmail", { domain });
      break;
    }
    case "url":
      try {
        if (!/^https?:$/.test(new URL(text).protocol)) return say("url");
      } catch {
        return say("url");
      }
      break;
    case "tel":
      if (!/^[+()\d\s./-]+$/.test(text) || text.replace(/\D/g, "").length < 5) return say("tel");
      break;
    case "number": {
      const number = Number(text);

      if (!Number.isFinite(number) || text.trim() === "") return say("number");
      if (rules.min !== undefined && number < rules.min) return say("min", { min: rules.min });
      if (rules.max !== undefined && number > rules.max) return say("max", { max: rules.max });
      break;
    }
    case "date":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) return say("date");
      break;
    case "select":
    case "radio":
    case "checkboxes":
      if (field.options && !list.every((item) => field.options?.some((option) => option.value === item))) return say("requiredChoice");
      break;
  }
  if (field.type !== "checkboxes" && field.type !== "number") {
    if (rules.minLength !== undefined && text.length < rules.minLength) return say("minLength", { min: rules.minLength });
    if (rules.maxLength !== undefined && text.length > rules.maxLength) return say("maxLength", { max: rules.maxLength });
  }
  if (rules.pattern) {
    try {
      if (!new RegExp(`^(?:${rules.pattern})$`, "u").test(text)) return say("pattern");
    } catch {
      return "";
    }
  }
  return "";
}
