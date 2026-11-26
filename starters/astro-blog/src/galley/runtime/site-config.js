// Vendored from @galley/astro 0.4.5 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// The site's kit settings, read from files (a vendored kit has no
// integration to pass them): src/galley/settings.json for the forms,
// src/data/scripts.json for the managed scripts, src/content/forms/ for the
// site-wide UTM memory, and the email-link dialog's settings.
import settings from "../settings.json";
import { resolveMailto } from "../mailto/config.js";
import { describeIssues, scriptsSchema } from "../schema.js";
import { resolveEntries } from "../scripts/plan.js";

/** @typedef {import("../kit").ScriptsConfig} ScriptsConfig */

const scriptFiles = import.meta.glob("/src/data/scripts.json", { eager: true, import: "default" });
const formFiles = import.meta.glob("/src/content/forms/*.json", { eager: true, import: "default" });

export const scriptsFile = "src/data/scripts.json";

/** @returns {ScriptsConfig | null} */
function readScripts() {
  const raw = scriptFiles["/src/data/scripts.json"];

  if (raw === undefined) return null;
  const parsed = scriptsSchema.safeParse(raw);

  if (!parsed.success) throw new Error(`src/data/scripts.json has problems:\n${describeIssues(parsed.error).map((line) => `  - ${line}`).join("\n")}`);
  const config = /** @type {ScriptsConfig} */ (parsed.data);

  resolveEntries(config);
  return config;
}

export const scripts = readScripts();

const forms = /** @type {Record<string, unknown>} */ (settings.forms ?? {});

export const options = {
  collection: typeof forms.collection === "string" ? forms.collection : "forms",
  endpoint: typeof forms.endpoint === "string" ? forms.endpoint : "",
  allowFormScripts: forms.allowFormScripts === true,
  messages: /** @type {Record<string, string>} */ (forms.messages ?? {}),
  freeEmailDomains: /** @type {string[]} */ (forms.freeEmailDomains ?? []),
};

/** The email-link dialog: on unless settings.json says "mailto": false. */
export const mailto = resolveMailto(/** @type {any} */ (settings).mailto);

export const utm = Object.values(formFiles).some(
  (form) => Array.isArray(/** @type {any} */ (form)?.fields) && /** @type {any} */ (form).fields.some((/** @type {any} */ field) => field?.autofill?.from === "utm"),
);
