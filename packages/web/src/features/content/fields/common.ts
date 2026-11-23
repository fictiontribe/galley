import type { Field, FieldPath, JsonValue } from "@galley/core/types";

export interface FieldProps {
  field: Field;
  /** Where the value lives in the entry. */
  path: FieldPath;
  /** Show the mono key beside the label (top level only, like the specimen). */
  showKey?: boolean;
}

/** Fields that say what one page is — its title, its search description — and so differ on every page. */
const OWN_TITLE = /^(title|seo_?title|meta_?title|og_?title|social_?title)$/i;
const OWN_DESCRIPTION = /^(description|summary|excerpt|seo_?description|meta_?description|og_?description|social_?description)$/i;

/**
 * A real example from the site as the placeholder, when there is one. A
 * field that says what one page is (its title, its description for search)
 * gets a neutral example instead: another page's value there ("e.g. Page
 * not found" on the home page) reads like a suggestion for this one.
 */
export function placeholderFor(field: Field): string | undefined {
  if (OWN_TITLE.test(field.key)) return "A short, specific title";
  if (OWN_DESCRIPTION.test(field.key)) return "One or two plain sentences about this page";
  const example = field.examples?.find((value): value is string | number => typeof value === "string" || typeof value === "number");
  if (example === undefined) return undefined;
  const text = String(example).replace(/\s+/g, " ");
  return `e.g. ${text.length > 64 ? `${text.slice(0, 62)}…` : text}`;
}

/** A field definition for a key the site's fields don't describe, from its value. */
export function inferField(key: string, value: JsonValue | undefined): Field {
  const label = key.replace(/[-_]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (first) => first.toUpperCase());
  const base = { key, label, required: false, source: "inferred" as const };
  if (typeof value === "boolean") return { ...base, type: "boolean" };
  if (typeof value === "number") return { ...base, type: "number" };
  if (typeof value === "string") return { ...base, type: value.includes("\n") ? "text" : "string" };
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return { ...base, type: "tags" };
  return { ...base, type: "json" };
}
