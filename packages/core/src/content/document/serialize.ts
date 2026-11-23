/**
 * Writing a brand-new entry. Existing files are never re-serialised (they are
 * edited with applyEdits); this is only for files that do not exist yet, so
 * the output follows the collection's field order to look like its siblings.
 */
import { stringify as stringifyToml } from "smol-toml";
import { stringify as stringifyYaml } from "yaml";

import type { Collection, Field, JsonValue } from "../../types";
import { isObject, type JsonObject } from "../util/json";

function orderObject(value: JsonObject, fields: Field[] | undefined, discriminator?: string, blockFields?: Map<string, Field[]>): JsonObject {
  const out: JsonObject = {};
  let effective = fields ?? [];

  if (discriminator && typeof value[discriminator] === "string" && blockFields) {
    effective = blockFields.get(value[discriminator] as string) ?? effective;
    if (Object.hasOwn(value, discriminator)) out[discriminator] = value[discriminator]!;
  }
  for (const field of effective) {
    if (Object.hasOwn(value, field.key) && !Object.hasOwn(out, field.key)) out[field.key] = order(value[field.key]!, field);
  }
  for (const [key, item] of Object.entries(value)) {
    if (!Object.hasOwn(out, key)) out[key] = item;
  }
  return out;
}

function order(value: JsonValue, field: Field | undefined): JsonValue {
  if (!field) return value;
  if (Array.isArray(value)) {
    if (field.type === "blocks" && field.discriminator) {
      const byType = new Map((field.blocks ?? []).map((block) => [block.type, block.fields]));

      return value.map((item) => (isObject(item) ? orderObject(item, undefined, field.discriminator, byType) : item));
    }
    return value.map((item) => order(item, field.of));
  }
  if (isObject(value)) return orderObject(value, field.fields);
  return value;
}

function yamlText(data: JsonObject): string {
  if (Object.keys(data).length === 0) return "";
  return stringifyYaml(data, { lineWidth: 0, minContentWidth: 0 });
}

export function serializeEntry(collection: Collection, data: { [key: string]: JsonValue }, body?: string): string {
  const ordered = orderObject(data, collection.fields);

  switch (collection.format) {
    case "json":
      return `${JSON.stringify(ordered, null, 2)}\n`;
    case "yaml":
      return yamlText(ordered);
    case "toml":
      return `${stringifyToml(ordered)}\n`;
    default: {
      const text = body === undefined || body === "" ? "" : `\n${body.replace(/^\n+/, "").replace(/\s*$/, "")}\n`;

      return `---\n${yamlText(ordered)}---\n${text}`;
    }
  }
}
