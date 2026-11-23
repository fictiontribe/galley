/**
 * The site kit's files described as the engine's `Field`s, in the words of
 * the app's form builder and scripts screen — so a kit collection carries
 * its real shape (not what inference guesses from the files: a form's
 * `fields` list looks like page sections to inference) and anything that
 * labels a path (search, the change list, the assistant's view of a file)
 * says "Fields › Required", not "Sections › 2 (Tel) › Required".
 *
 * Validation does not walk these: `validate.ts` checks a kit file with the
 * kit's own schema. They follow `schema.ts` key for key (a test checks it).
 */
import type { BlockType, Field, FieldType } from "../types";
import { FIELD_TYPES } from "./schema";

type Extra = Partial<Omit<Field, "key" | "label" | "type" | "source">>;

const f = (key: string, label: string, type: FieldType, extra: Extra = {}): Field => ({ key, label, type, required: false, source: "schema", ...extra });
const req = (key: string, label: string, type: FieldType, extra: Extra = {}): Field => f(key, label, type, { ...extra, required: true });
const obj = (key: string, label: string, fields: Field[], extra: Extra = {}): Field => f(key, label, "object", { ...extra, fields });
const list = (key: string, label: string, of: Field, extra: Extra = {}): Field => f(key, label, "list", { ...extra, of });
const block = (type: string, label: string, fields: Field[]): BlockType => ({ type, label, fields: [req("type", "Kind", "string"), ...fields], count: 0 });

const option = obj("option", "Option", [req("value", "Value sent", "string"), req("label", "Shown as", "string")]);

const formField = obj(
  "field",
  "Field",
  [
    req("id", "Id", "string"),
    req("type", "Type", "select", { options: [...FIELD_TYPES] }),
    f("label", "Label", "string"),
    f("name", "Name sent", "string"),
    f("placeholder", "Placeholder", "string"),
    f("help", "Help", "string"),
    f("required", "Required", "boolean"),
    list("options", "Options", option),
    f("defaultValue", "Default answer", "string"),
    f("width", "Width", "select", { options: ["full", "half"] }),
    obj("validation", "Checks", [
      f("pattern", "Custom pattern", "string"),
      f("minLength", "Fewest characters", "number"),
      f("maxLength", "Most characters", "number"),
      f("min", "Smallest number", "number"),
      f("max", "Largest number", "number"),
      f("message", "Message when it doesn't", "string"),
      f("businessEmailOnly", "Work email only", "boolean"),
    ]),
    obj("showWhen", "Show only when…", [req("field", "Field", "string"), f("equals", "Is", "string"), f("notEquals", "Isn't", "string"), f("in", "Is one of", "tags")]),
    obj("autofill", "Filled from", [
      req("from", "Source", "select", { options: ["query", "utm", "referrer", "page-url", "page-title", "cookie"] }),
      f("key", "Name", "string"),
      f("touch", "From which visit", "select", { options: ["first", "last"] }),
    ]),
    f("text", "Text", "markdown"),
    f("step", "Step", "number"),
  ],
  { required: true },
);

const destination = obj(
  "destination",
  "Destination",
  [
    req("provider", "Sends to", "string"),
    req("settings", "Settings", "json"),
    f("mapping", "Field names there", "json"),
    f("constants", "Fixed values", "json"),
    obj("when", "Only when…", [req("field", "Field", "string"), req("equals", "Is", "string")]),
  ],
  { required: true },
);

const actions: BlockType[] = [
  block("message", "Thank-you message", [f("title", "Title", "string"), req("text", "Text", "markdown")]),
  block("redirect", "Go to a page", [req("url", "Address", "url"), f("passFields", "Answers passed on", "tags"), f("delaySeconds", "Wait (seconds)", "number")]),
  block("download", "Download", [req("url", "File", "url"), f("label", "Button", "string"), f("auto", "Start straight away", "boolean")]),
  block("event", "Record a conversion", [req("name", "Event name", "string"), f("target", "Sent to", "select", { options: ["dataLayer", "gtag", "dom"] }), f("params", "Details", "json")]),
  block("webhook", "Notify another service", [req("url", "Address", "url")]),
  block("script", "Custom code", [req("code", "Code", "text")]),
];

/** A form file. */
export const FORM_FIELDS: Field[] = [
  req("name", "Name", "string"),
  f("description", "Description", "text"),
  list("fields", "Fields", formField, { required: true }),
  req("submitLabel", "Button", "string"),
  list("steps", "Steps", obj("step", "Step", [f("title", "Title", "string"), f("nextLabel", "Next button", "string")])),
  list("destinations", "Destinations", destination, { required: true }),
  f("afterSubmit", "After sending", "blocks", { required: true, discriminator: "type", blocks: actions }),
  f("errorMessage", "If it can't be sent", "text"),
  f("messages", "Wording", "json"),
  obj("spam", "Spam checks", [f("honeypot", "Hidden trap field", "boolean"), f("minSeconds", "Refuse faster than (seconds)", "number"), f("turnstileSiteKey", "Cloudflare Turnstile site key", "string")]),
  obj("appearance", "Appearance", [
    f("layout", "Layout", "select", { options: ["stacked", "inline"] }),
    f("size", "Size", "select", { options: ["regular", "compact"] }),
    f("labels", "Labels", "select", { options: ["above", "floating", "hidden"] }),
  ]),
];

const categories = ["necessary", "analytics", "marketing", "preferences"];
const categoryText = (key: string, label: string) => obj(key, label, [f("label", "Name", "string"), f("description", "Description", "text")]);

const scriptEntry = obj(
  "script",
  "Script",
  [
    req("id", "Id", "string"),
    req("kind", "Kind", "string"),
    f("label", "Name", "string"),
    req("enabled", "On", "boolean"),
    req("settings", "Settings", "json"),
    f("placement", "Where", "select", { options: ["head", "body-start", "body-end"] }),
    f("load", "When", "select", { options: ["eager", "idle", "interaction"] }),
    f("consent", "Needs consent for", "select", { options: categories }),
    f("include", "Only on", "tags"),
    f("exclude", "Never on", "tags"),
    f("inPreview", "Also in the preview", "boolean"),
    f("note", "Note", "text"),
  ],
  { required: true },
);

/** The scripts setup file. */
export const SCRIPTS_FIELDS: Field[] = [
  list("scripts", "Scripts", scriptEntry, { required: true }),
  obj("consent", "Consent", [
    req("mode", "Asking for consent", "select", { options: ["none", "banner", "external"] }),
    f("defaults", "On before a choice", "tags", { options: categories }),
    obj("banner", "Banner", [
      f("title", "Title", "string"),
      f("text", "Text", "text"),
      f("acceptLabel", "Accept button", "string"),
      f("rejectLabel", "Reject button", "string"),
      f("settingsLabel", "Choose button", "string"),
      f("saveLabel", "Save button", "string"),
      f("policyUrl", "Policy page", "url"),
      f("policyLabel", "Policy link", "string"),
      obj("categories", "Categories", [categoryText("necessary", "Necessary"), categoryText("analytics", "Analytics"), categoryText("marketing", "Marketing"), categoryText("preferences", "Preferences")]),
    ]),
    f("googleConsentMode", "Google Consent Mode", "boolean"),
  ]),
];

/**
 * The kit's data file for the version AI assistants read (src/data/visibility.json,
 * docs/ai-first-output.md). Every key is optional and every part may be `false`,
 * so the parts are free-form here: the site's build checks them in full.
 */
export const VISIBILITY_FIELDS: Field[] = [
  obj("site", "Site", [f("name", "Name", "string"), f("summary", "Summary", "text")]),
  f("crawlers", "AI crawlers", "json"),
  f("robots", "Crawling rules", "json"),
  f("sitemap", "Sitemap", "json"),
  f("structuredData", "Structured data", "json"),
  f("agentReadable", "AI-readable version", "json"),
];
