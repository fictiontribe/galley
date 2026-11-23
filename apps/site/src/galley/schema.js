// Vendored from @galley/astro 0.1.2 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// `@galley/astro/schema` — zod schemas for the two kinds of file the site kit
// reads: a form (src/content/forms/<id>.json) and the scripts setup
// (src/data/scripts.json). They match the contract in kit.d.ts exactly
// (test/contract.test.ts fails if they drift) and add the checks a type
// cannot express — unknown field references, ids that don't look like the
// vendor's ids — with messages a person can act on.
//
// zod comes from Astro (`astro/zod`), so the schema is the same zod the
// site's content config uses and the package adds no dependency.
import { z } from "astro/zod";
import { FORM_PROVIDERS, SCRIPT_INTEGRATIONS } from "./catalog-data.js";

/** @typedef {import("./kit").JsonValue} JsonValue */

/** @type {z.ZodType<JsonValue>} */
const json = z.lazy(() => z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(json), z.record(z.string(), json)]));
const settings = z.record(z.string(), json);
const stringMap = z.record(z.string(), z.string());

export const FIELD_TYPES = /** @type {const} */ ([
  "text",
  "email",
  "tel",
  "url",
  "number",
  "textarea",
  "select",
  "radio",
  "checkbox",
  "checkboxes",
  "date",
  "hidden",
  "consent",
  "heading",
  "paragraph",
]);

/** Types that are only layout: they have no value and are never submitted. */
export const LAYOUT_TYPES = new Set(["heading", "paragraph"]);
/** Types that need `options`. */
export const OPTION_TYPES = new Set(["select", "radio", "checkboxes"]);

const FIELD_ID = /^[a-z][a-z0-9_-]*$/;

export const formFieldSchema = z.object({
  id: z.string().regex(FIELD_ID, "Use lowercase letters, digits, hyphens and underscores, starting with a letter."),
  type: z.enum(FIELD_TYPES),
  label: z.string().optional(),
  name: z.string().optional(),
  placeholder: z.string().optional(),
  help: z.string().optional(),
  required: z.boolean().optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  defaultValue: z.string().optional(),
  width: z.enum(["full", "half"]).optional(),
  validation: z
    .object({
      pattern: z.string().optional(),
      minLength: z.number().optional(),
      maxLength: z.number().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      message: z.string().optional(),
      businessEmailOnly: z.boolean().optional(),
    })
    .optional(),
  showWhen: z
    .object({
      field: z.string(),
      equals: z.string().optional(),
      notEquals: z.string().optional(),
      in: z.array(z.string()).optional(),
    })
    .optional(),
  autofill: z
    .object({
      from: z.enum(["query", "utm", "referrer", "page-url", "page-title", "cookie"]),
      key: z.string().optional(),
      touch: z.enum(["first", "last"]).optional(),
    })
    .optional(),
  text: z.string().optional(),
  step: z.number().int().min(0).optional(),
});

export const formDestinationSchema = z.object({
  provider: z.string().min(1),
  settings,
  mapping: stringMap.optional(),
  constants: stringMap.optional(),
  when: z.object({ field: z.string(), equals: z.string() }).optional(),
});

export const formActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message"), title: z.string().optional(), text: z.string() }),
  z.object({ type: z.literal("redirect"), url: z.string(), passFields: z.array(z.string()).optional(), delaySeconds: z.number().optional() }),
  z.object({ type: z.literal("download"), url: z.string(), label: z.string().optional(), auto: z.boolean().optional() }),
  z.object({
    type: z.literal("event"),
    name: z.string(),
    target: z.enum(["dataLayer", "gtag", "dom"]).optional(),
    params: stringMap.optional(),
  }),
  z.object({ type: z.literal("webhook"), url: z.string() }),
  z.object({ type: z.literal("script"), code: z.string() }),
]);

const formShape = z.object({
  name: z.string(),
  description: z.string().optional(),
  fields: z.array(formFieldSchema),
  submitLabel: z.string(),
  steps: z.array(z.object({ title: z.string().optional(), nextLabel: z.string().optional() })).optional(),
  destinations: z.array(formDestinationSchema),
  afterSubmit: z.array(formActionSchema),
  errorMessage: z.string().optional(),
  messages: stringMap.optional(),
  spam: z
    .object({
      honeypot: z.boolean().optional(),
      minSeconds: z.number().optional(),
      turnstileSiteKey: z.string().optional(),
    })
    .optional(),
  appearance: z
    .object({
      layout: z.enum(["stacked", "inline"]).optional(),
      size: z.enum(["regular", "compact"]).optional(),
      labels: z.enum(["above", "floating", "hidden"]).optional(),
    })
    .optional(),
});

/**
 * The checks across fields: references point at real fields, ids are unique,
 * choices have options, each built-in destination has the settings it needs.
 *
 * @param {import("./kit").FormDefinition} form
 * @param {z.RefinementCtx} ctx
 */
function checkForm(form, ctx) {
  const ids = new Set();
  const issue = (/** @type {(string | number)[]} */ path, /** @type {string} */ message) => ctx.addIssue({ code: "custom", path, message });

  form.fields.forEach((field, index) => {
    if (ids.has(field.id)) issue(["fields", index, "id"], `Two fields are called “${field.id}”. Each field needs its own id.`);
    ids.add(field.id);
    if (OPTION_TYPES.has(field.type) && !(field.options && field.options.length > 0)) {
      issue(["fields", index, "options"], `“${field.id}” is a ${field.type} field, so it needs at least one option.`);
    }
    if ((field.type === "heading" || field.type === "paragraph" || field.type === "consent") && !field.text && !field.label) {
      issue(["fields", index, "text"], `“${field.id}” is a ${field.type}, so it needs its text.`);
    }
    if (field.validation?.pattern !== undefined) {
      try {
        new RegExp(field.validation.pattern, "u");
      } catch {
        issue(["fields", index, "validation", "pattern"], `The pattern for “${field.id}” isn't a regular expression a browser can read.`);
      }
    }
    if (field.step !== undefined && (form.steps?.length ?? 1) <= field.step) {
      issue(["fields", index, "step"], `“${field.id}” is on step ${field.step + 1}, but the form has ${form.steps?.length ?? 1} step${(form.steps?.length ?? 1) === 1 ? "" : "s"}.`);
    }
  });
  form.fields.forEach((field, index) => {
    if (field.showWhen && !ids.has(field.showWhen.field)) issue(["fields", index, "showWhen", "field"], `“${field.id}” depends on “${field.showWhen.field}”, which isn't a field of this form.`);
  });
  if (form.destinations.length === 0) issue(["destinations"], "Add at least one destination, so submissions go somewhere.");
  form.destinations.forEach((destination, index) => {
    if (destination.when && !ids.has(destination.when.field)) issue(["destinations", index, "when", "field"], `This destination depends on “${destination.when.field}”, which isn't a field of this form.`);
    for (const key of Object.keys(destination.mapping ?? {})) {
      if (!ids.has(key)) issue(["destinations", index, "mapping", key], `The mapping names “${key}”, which isn't a field of this form.`);
    }
    const info = FORM_PROVIDERS.find((entry) => entry.id === destination.provider);

    for (const setting of info?.settings ?? []) {
      const value = destination.settings[setting.key];

      if (value === undefined || value === "" || value === null) {
        if (setting.required) issue(["destinations", index, "settings", setting.key], `${info?.name} needs its ${setting.label.toLowerCase()} (settings.${setting.key}).`);
        continue;
      }
      if (setting.pattern && !new RegExp(setting.pattern).test(String(value))) {
        issue(["destinations", index, "settings", setting.key], `“${String(value)}” doesn't look like a ${info?.name} ${setting.label.toLowerCase()}${setting.placeholder ? ` (for example ${setting.placeholder})` : ""}.`);
      }
    }
  });
  form.afterSubmit.forEach((action, index) => {
    if (action.type === "redirect") {
      for (const field of action.passFields ?? []) if (!ids.has(field)) issue(["afterSubmit", index, "passFields"], `The redirect passes “${field}”, which isn't a field of this form.`);
    }
  });
}

/** A form file: src/content/forms/<id>.json. */
export const formSchema = formShape.superRefine(checkForm);

// ─────────────────────────────────────────────────────────────── scripts

const consentCategory = z.enum(["necessary", "analytics", "marketing", "preferences"]);
const placement = z.enum(["head", "body-start", "body-end"]);

export const scriptEntrySchema = z.object({
  id: z.string().regex(FIELD_ID, "Use lowercase letters, digits, hyphens and underscores, starting with a letter."),
  kind: z.string().min(1),
  label: z.string().optional(),
  enabled: z.boolean(),
  settings,
  placement: placement.optional(),
  load: z.enum(["eager", "idle", "interaction"]).optional(),
  consent: consentCategory.optional(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  inPreview: z.boolean().optional(),
  note: z.string().optional(),
});

const categoryText = z.object({ label: z.string().optional(), description: z.string().optional() });

export const consentSettingsSchema = z.object({
  mode: z.enum(["none", "banner", "external"]),
  defaults: z.array(consentCategory).optional(),
  banner: z
    .object({
      title: z.string().optional(),
      text: z.string().optional(),
      acceptLabel: z.string().optional(),
      rejectLabel: z.string().optional(),
      settingsLabel: z.string().optional(),
      saveLabel: z.string().optional(),
      policyUrl: z.string().optional(),
      policyLabel: z.string().optional(),
      categories: z
        .object({
          necessary: categoryText.optional(),
          analytics: categoryText.optional(),
          marketing: categoryText.optional(),
          preferences: categoryText.optional(),
        })
        .optional(),
    })
    .optional(),
  googleConsentMode: z.boolean().optional(),
});

/**
 * Each enabled entry of a known kind has the settings its snippet needs, in
 * the shape the vendor issues them — so a typo is a build error, not a tag
 * that silently does nothing.
 *
 * @param {import("./kit").ScriptsConfig} config
 * @param {z.RefinementCtx} ctx
 */
function checkScripts(config, ctx) {
  const ids = new Set();

  config.scripts.forEach((entry, index) => {
    const at = (/** @type {string} */ key) => ["scripts", index, "settings", key];

    if (ids.has(entry.id)) ctx.addIssue({ code: "custom", path: ["scripts", index, "id"], message: `Two scripts are called “${entry.id}”. Each needs its own id.` });
    ids.add(entry.id);
    const info = SCRIPT_INTEGRATIONS.find((item) => item.kind === entry.kind);
    // A kind this kit doesn't know (a plugin's) is written like "custom".
    const custom = entry.kind === "custom" || !info;

    if (custom) checkCustom(entry, at, ctx);
    if (!info) return;
    for (const setting of info.settings) {
      const value = entry.settings[setting.key];

      if (value === undefined || value === null || value === "") {
        if (setting.required && entry.enabled) ctx.addIssue({ code: "custom", path: at(setting.key), message: `${info.name} needs its ${setting.label} (settings.${setting.key}${setting.placeholder ? `, like ${setting.placeholder}` : ""}).` });
        continue;
      }
      if (setting.pattern && !new RegExp(setting.pattern).test(String(value))) {
        ctx.addIssue({
          code: "custom",
          path: at(setting.key),
          message: `“${String(value)}” doesn't look like a ${info.name} ${setting.label}${setting.placeholder ? ` (it looks like ${setting.placeholder})` : ""}.`,
        });
      }
    }
    if (entry.enabled && entry.kind === "plausible" && !entry.settings.scriptId && !entry.settings.domain) {
      ctx.addIssue({ code: "custom", path: at("scriptId"), message: "Plausible needs its script ID (pa-…, from Site installation) or, for the older script, the site's domain." });
    }
  });
}

/**
 * The rules for a script written from its own src / inline: "custom", and
 * any kind this kit has no snippet for.
 *
 * @param {import("./kit").ScriptEntry} entry
 * @param {(key: string) => (string | number)[]} at
 * @param {z.RefinementCtx} ctx
 */
function checkCustom(entry, at, ctx) {
  if (entry.enabled && !entry.settings.src && !entry.settings.inline) {
    ctx.addIssue({
      code: "custom",
      path: at("src"),
      message: entry.kind === "custom" ? "A custom script needs a script address (settings.src) or code (settings.inline)." : `A “${entry.kind}” script is written from its own settings.src (the script's address) or settings.inline (its code); give it one of them.`,
    });
  }
  if (entry.settings.attributes !== undefined) {
    const attributes = entry.settings.attributes;

    if (typeof attributes !== "object" || attributes === null || Array.isArray(attributes) || Object.values(attributes).some((value) => typeof value !== "string" && typeof value !== "boolean")) {
      ctx.addIssue({ code: "custom", path: at("attributes"), message: "settings.attributes is a list of attribute names and their text (or true for a bare attribute)." });
    } else if (Object.keys(attributes).some((name) => !/^[a-z][a-z0-9-]*$/i.test(name) || /^on/i.test(name) || name.toLowerCase() === "src" || name.toLowerCase() === "type")) {
      ctx.addIssue({ code: "custom", path: at("attributes"), message: "settings.attributes can't set src, type or on… handlers; use settings.src and settings.inline." });
    }
  }
}

const scriptsShape = z.object({
  scripts: z.array(scriptEntrySchema),
  consent: consentSettingsSchema.optional(),
});

/** The scripts setup: src/data/scripts.json. */
export const scriptsSchema = scriptsShape.superRefine(checkScripts);

/**
 * A zod error as plain lines: “scripts[0].settings.containerId: … ”.
 *
 * @param {z.ZodError} error
 * @returns {string[]}
 */
export function describeIssues(error) {
  return error.issues.map((issue) => {
    const path = issue.path.map((part, index) => (typeof part === "number" ? `[${part}]` : `${index === 0 ? "" : "."}${String(part)}`)).join("");

    return path ? `${path}: ${issue.message}` : issue.message;
  });
}
