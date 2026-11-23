/**
 * One line that tells sections apart when they're folded: the section's
 * heading (or the nearest thing to one), as plain text.
 */
import type { BlockType, Field, JsonValue } from "@galley/core/types";
import { isObject } from "./paths";

const HEADING_LIKE = [/^(heading|headline|title)$/i, /^(name|label|question)$/i, /^(quote|eyebrow|subheading|subtitle)$/i];
const TEXT_TYPES = new Set(["string", "text", "markdown"]);
const MAX = 90;

/** Markdown and line breaks out, whitespace collapsed, cut at a word near `max`. */
export function plainLine(text: string, max = MAX): string {
  const plain = text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, "")}…`;
}

function textOf(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

/** The summary for one item of an object list or blocks field, or "" when it has no text. */
export function itemSummary(item: JsonValue | undefined, fields: readonly Field[] | undefined): string {
  if (typeof item === "string" || typeof item === "number") return plainLine(String(item));
  if (!isObject(item)) return "";
  const known = fields ?? [];
  for (const pattern of HEADING_LIKE) {
    const field = known.find((candidate) => pattern.test(candidate.key) && TEXT_TYPES.has(candidate.type) && textOf(item[candidate.key]).trim());
    if (field) return plainLine(textOf(item[field.key]));
    const loose = Object.keys(item).find((key) => pattern.test(key) && textOf(item[key]).trim());
    if (loose) return plainLine(textOf(item[loose]));
  }
  const firstText = known.find((field) => field.type === "string" && textOf(item[field.key]).trim()) ?? known.find((field) => TEXT_TYPES.has(field.type) && textOf(item[field.key]).trim());
  return firstText ? plainLine(textOf(item[firstText.key])) : "";
}

/** The block type of one section, by its discriminator value. */
export function blockTypeOf(item: JsonValue | undefined, field: Field): BlockType | undefined {
  if (!isObject(item)) return undefined;
  const type = item[field.discriminator ?? "type"];
  return field.blocks?.find((block) => block.type === type);
}

/** The label of a section's type, falling back to its raw type value. */
export function blockLabel(item: JsonValue | undefined, field: Field): string {
  const block = blockTypeOf(item, field);
  if (block) return block.label;
  const type = isObject(item) ? item[field.discriminator ?? "type"] : undefined;
  return typeof type === "string" && type ? type : "Section";
}
