// @ts-check
// Reading the site's kit files in Node (the integration and the dev server):
// the scripts file, validated with a message a person can act on, and a scan
// of the forms folder for anything the whole site must know about (UTM
// memory runs on every page when any form uses it).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { INTEGRATION_NAME } from "./constants.js";
import { describeIssues, scriptsSchema } from "./schema.js";
import { resolveEntries } from "./scripts/plan.js";

/** @typedef {import("./kit").ScriptsConfig} ScriptsConfig */

export class KitFileError extends Error {}

/**
 * The scripts file, parsed and checked — or null when there is none.
 *
 * @param {string} root  The site's folder.
 * @param {string} file  Relative to the site, e.g. "src/data/scripts.json".
 * @returns {ScriptsConfig | null}
 */
export function readScripts(root, file) {
  const path = join(root, file);

  if (!existsSync(path)) return null;
  let raw;

  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new KitFileError(`${INTEGRATION_NAME}: ${file} can't be read as JSON (${error instanceof Error ? error.message : String(error)}). Fix the file, or remove it to manage no scripts.`);
  }
  const parsed = scriptsSchema.safeParse(raw);

  if (!parsed.success) {
    throw new KitFileError(`${INTEGRATION_NAME}: ${file} has ${parsed.error.issues.length === 1 ? "a problem" : `${parsed.error.issues.length} problems`}:\n${describeIssues(parsed.error).map((line) => `  - ${line}`).join("\n")}`);
  }
  const config = /** @type {ScriptsConfig} */ (parsed.data);

  try {
    resolveEntries(config);
  } catch (error) {
    throw new KitFileError(`${INTEGRATION_NAME}: ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return config;
}

/**
 * Whether any form file in `dir` fills a field from UTM memory.
 *
 * @param {string} root
 * @param {string} dir
 */
export function formsUseUtm(root, dir) {
  const path = join(root, dir);

  if (!existsSync(path)) return false;
  for (const name of readdirSync(path)) {
    if (!name.endsWith(".json")) continue;
    try {
      const form = JSON.parse(readFileSync(join(path, name), "utf8"));

      if (Array.isArray(form?.fields) && form.fields.some((/** @type {any} */ field) => field?.autofill?.from === "utm")) return true;
    } catch {
      // The content layer reports a broken form file with its own message.
    }
  }
  return false;
}
