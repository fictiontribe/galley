/**
 * Starting values for new sections and list items.
 *
 * A new section takes its shape from the most complete real one
 * (`BlockType.example`) but not its words: copy, links and images are
 * blanked, while settings (choices, numbers, switches, colours) are kept.
 * Copying another page's words into a new section makes duplicate text that
 * is easy to publish by mistake; an empty heading is obvious and the form
 * flags it. Optional copy is left out entirely, so the file only gains what
 * the person fills in.
 */
import type { BlockType, Field, JsonValue } from "@galley/core/types";
import { isObject, type JsonObject } from "./paths";

const COPY_TYPES = new Set(["string", "text", "markdown", "url", "image", "reference", "date", "datetime"]);

/** The empty value a field starts with. */
export function emptyValue(field: Field): JsonValue {
  if (field.default !== undefined) return field.default;
  switch (field.type) {
    case "number":
      return 0;
    case "boolean":
      return false;
    case "tags":
      return [];
    case "list":
      return [];
    case "blocks":
      return [];
    case "object":
      return emptyObject(field.fields ?? []);
    case "select":
      return field.options?.[0] ?? "";
    case "json":
      return null;
    default:
      return "";
  }
}

/** Required fields at their empty values; optional ones left out. */
export function emptyObject(fields: readonly Field[]): JsonObject {
  const out: JsonObject = {};
  for (const field of fields) {
    if (field.required && !field.hidden) out[field.key] = emptyValue(field);
  }
  return out;
}

/** A new list item for a list field (`field.of`). */
export function newListItem(of: Field | undefined): JsonValue {
  if (!of) return "";
  if (of.type === "object") return emptyObject(of.fields ?? []);
  if (of.type === "string" || of.type === "text" || of.type === "markdown" || of.type === "url" || of.type === "image") return "";
  return emptyValue(of);
}

function blankValue(value: JsonValue, field: Field | undefined): JsonValue | undefined {
  const required = field?.required ?? false;
  const type = field?.type;
  if (typeof value === "string") {
    if (type === "select" || type === "color") return value;
    if (type === undefined || COPY_TYPES.has(type)) return required ? "" : undefined;
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    if (type === "tags") return required ? [] : undefined;
    const first = value[0];
    if (first === undefined) return required ? [] : undefined;
    if (isObject(first)) return [blankObject(first, field?.of?.fields ?? [])];
    return required ? [""] : undefined;
  }
  return blankObject(value, field?.fields ?? []);
}

function blankObject(source: JsonObject, fields: readonly Field[], keep: readonly string[] = []): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(source)) {
    if (keep.includes(key)) {
      out[key] = value;
      continue;
    }
    const blanked = blankValue(value, fields.find((field) => field.key === key));
    if (blanked !== undefined) out[key] = blanked;
  }
  for (const field of fields) {
    if (field.required && !field.hidden && !Object.hasOwn(out, field.key)) out[field.key] = emptyValue(field);
  }
  return out;
}

/** The value inserted by "Add section" for one block type. */
export function blockScaffold(block: BlockType, discriminator: string): JsonObject {
  const source = block.example ?? {};
  const out = blankObject(source, block.fields, [discriminator]);
  // The discriminator comes first so the file reads "- type: hero".
  return { [discriminator]: block.type, ...Object.fromEntries(Object.entries(out).filter(([key]) => key !== discriminator)) };
}
