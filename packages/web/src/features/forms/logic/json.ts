/**
 * Reading the site-kit files (a form, the scripts setup) out of the plain
 * JSON the content engine hands back, and turning typed values into JSON for
 * edit ops. Reading is forgiving: a hand-edited file with a missing list or a
 * stray value still opens; nothing is rewritten just because it was read.
 */
import type { JsonValue } from "@galley/core/types";
import type { FormAction, FormDefinition, FormDestination, FormField, ScriptEntry, ScriptsConfig } from "@galley/core/kit";

export type JsonObject = { [key: string]: JsonValue };

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A typed value as JSON for an edit op (drops `undefined` members, like the file would). */
export function toJson<T>(value: T): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function objects(value: JsonValue | undefined): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

const text = (value: JsonValue | undefined): string | undefined => (typeof value === "string" ? value : undefined);

/** The form a file describes. Members the file lacks come back empty, never invented in the file. */
export function readForm(data: JsonObject): FormDefinition {
  return {
    ...(data as unknown as FormDefinition),
    name: text(data.name) ?? "",
    submitLabel: text(data.submitLabel) ?? "",
    fields: objects(data.fields).map((field) => ({ ...(field as unknown as FormField), id: text(field.id) ?? "", type: (text(field.type) ?? "text") as FormField["type"] })),
    destinations: objects(data.destinations).map((destination) => ({
      ...(destination as unknown as FormDestination),
      provider: text(destination.provider) ?? "",
      settings: isObject(destination.settings) ? destination.settings : {},
    })),
    afterSubmit: objects(data.afterSubmit) as unknown as FormAction[],
  };
}

function scriptEntry(entry: JsonObject): ScriptEntry {
  return {
    ...(entry as unknown as ScriptEntry),
    id: text(entry.id) ?? "",
    kind: text(entry.kind) ?? "custom",
    enabled: entry.enabled !== false,
    settings: isObject(entry.settings) ? entry.settings : {},
  };
}

/** One script entry, or null when the value isn't one. */
export function readScriptEntry(value: JsonValue | undefined): ScriptEntry | null {
  return isObject(value) ? scriptEntry(value) : null;
}

export function readScripts(data: JsonObject): ScriptsConfig {
  return {
    ...(data as unknown as ScriptsConfig),
    scripts: objects(data.scripts).map(scriptEntry),
    consent: isObject(data.consent) ? (data.consent as unknown as ScriptsConfig["consent"]) : undefined,
  };
}

/** A settings value as text for an input. */
export function settingText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
