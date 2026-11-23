/**
 * The editable strings of one file, in file order: front-matter / data
 * strings with their field path, markdown body blocks with their range, and
 * visible text in source templates with its line and column.
 */
import type { Collection, FieldPath, JsonValue, SourceLocation } from "../../types";
import { enumerateBodyBlocks } from "../document/body-blocks";
import { labelForFieldPath } from "../diff/fields";
import { DISCRIMINATORS, classifyString } from "../schema/infer";
import { isObject } from "../util/json";
import { collapseWhitespace, matchKey } from "../util/text";

export interface IndexedString {
  path: string;
  location: SourceLocation;
  /** The value exactly as stored. */
  value: string;
  /** Comparison form (visible text, punctuation folded). */
  key: string;
  /** Position within the file, for matching document order. */
  order: number;
  kind: "field" | "body" | "source";
  /** A paragraph of a longer stored value: findable, but never retyped in place. */
  fragment?: boolean;
  /** Text inside HTML/JSX in a body: findable, never retyped in place. */
  locked?: boolean;
  /** Identity of the location, so a value and its fragments count as one place. */
  place: string;
}

/** Keys whose values are identifiers or wiring, never text a visitor reads. */
const NON_TEXT_KEYS = new Set([...DISCRIMINATORS, "id", "slug", "permalink", "layout", "uuid", "key", "ref", "anchor", "variant", "theme", "icon", "iconName", "class", "className", "style", "target", "rel", "lang", "locale", "_schema"]);
const NON_TEXT_KINDS = new Set(["image", "url", "color", "date", "datetime"]);

function hasWords(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value);
}

export function fieldStrings(path: string, collection: Collection | null, data: { [key: string]: JsonValue }): IndexedString[] {
  const out: IndexedString[] = [];
  let order = 0;

  const visit = (value: JsonValue, at: FieldPath): void => {
    if (typeof value === "string") {
      const key = at[at.length - 1];

      if (typeof key === "string" && NON_TEXT_KEYS.has(key)) return;
      if (!hasWords(value) || NON_TEXT_KINDS.has(classifyString(value))) return;
      const location: SourceLocation = { kind: "field", field: at, label: labelForFieldPath(collection, data, at) };
      const place = `${path}#${JSON.stringify(at)}`;

      out.push({ path, location, value, key: matchKey(value), order: order++, kind: "field", place });
      const paragraphs = value.split(/\n\s*\n/).map((part) => part.trim()).filter((part) => part !== "" && hasWords(part));

      if (paragraphs.length > 1) {
        for (const paragraph of paragraphs) {
          out.push({ path, location, value, key: matchKey(paragraph), order: order++, kind: "field", fragment: true, place });
        }
      }
      return;
    }
    if (Array.isArray(value)) value.forEach((item, index) => visit(item, [...at, index]));
    else if (isObject(value)) for (const [key, item] of Object.entries(value)) visit(item, [...at, key]);
  };

  visit(data, []);
  return out;
}

export function bodyStrings(path: string, body: string, startOrder: number): IndexedString[] {
  const out: IndexedString[] = [];
  let order = startOrder;

  for (const block of enumerateBodyBlocks(body)) {
    if (block.kind === "rule" || block.text === "" || !hasWords(block.text)) continue;
    // MDX import/export lines are code, not copy.
    if (block.kind === "html" && /^(import|export)\s/.test(block.raw)) continue;
    const value = body.slice(block.contentStart, block.contentEnd);

    out.push({
      path,
      location: { kind: "body", start: block.contentStart, end: block.contentEnd, block: block.key },
      value,
      key: matchKey(block.text),
      order: order++,
      kind: "body",
      ...(block.inline ? {} : { locked: true }),
      place: `${path}@${block.key}`,
    });
  }
  return out;
}

/** Template file types whose visible text is indexed for click-to-edit. */
export const SOURCE_PATTERN = "**/*.{astro,html,htm,njk,liquid,hbs,handlebars,vue,svelte,jsx,tsx}";

function position(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;

  return { line, column: offset - before.lastIndexOf("\n") };
}

function sourceString(path: string, text: string, offset: number, value: string, order: number): IndexedString {
  const { line, column } = position(text, offset);

  return { path, location: { kind: "source", line, column }, value, key: matchKey(value), order, kind: "source", place: `${path}:${line}:${column}` };
}

/**
 * Visible text in a template: text between tags (expressions removed), plus
 * string literals in its script/front-matter code, where copy often lives
 * (`const features = [{ title: "Fast" }]`).
 */
export function sourceStrings(path: string, text: string): IndexedString[] {
  const out: IndexedString[] = [];
  const seen = new Set<number>();
  let order = 0;
  const codeRanges: Array<[number, number]> = [];
  const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);

  if (frontMatter && /\.astro$/.test(path)) codeRanges.push([0, frontMatter[0].length]);
  for (const match of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) codeRanges.push([match.index, match.index + match[0].length]);
  for (const match of text.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi)) codeRanges.push([match.index, match.index + match[0].length]);
  const inCode = (offset: number) => codeRanges.some(([from, to]) => offset >= from && offset < to);
  const isJsx = /\.(jsx|tsx)$/.test(path);

  for (const match of text.matchAll(/>([^<>]+)</g)) {
    const raw = match[1]!;
    const start = match.index + 1;

    if (inCode(start)) continue;
    // Drop {expressions}; what is left between them is literal text.
    const literal = raw.replace(/\{[^{}]*\}/g, " ");

    if (!hasWords(literal) || /[{}]/.test(literal) || (isJsx && /^\s*[;),]/.test(literal))) continue;
    const trimmed = collapseWhitespace(raw);
    const lead = raw.length - raw.trimStart().length;

    if (trimmed === "" || seen.has(start + lead)) continue;
    seen.add(start + lead);
    out.push(sourceString(path, text, start + lead, raw.trim(), order++));
  }
  const literalPattern = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;

  for (const match of text.matchAll(literalPattern)) {
    const offset = match.index + 1;

    if (!(inCode(match.index) || isJsx || /\{[^}]*$/.test(text.slice(Math.max(0, match.index - 200), match.index)))) continue;
    const value = match[2]!;

    // Visible copy has words and usually a space; module paths and class lists don't qualify.
    if (value.length < 2 || !/\p{L}/u.test(value) || /^(\.{0,2}\/|@|https?:|#|[\w-]+:\/\/)/.test(value) || /\$\{/.test(value)) continue;
    if (!/\s/.test(value) && !/^[A-Z][a-z]+[.!?]?$/.test(value)) continue;
    if (/^[a-z0-9-]+(\s+[a-z0-9:/[\]_.-]+)+$/.test(value)) continue;
    if (seen.has(offset)) continue;
    seen.add(offset);
    out.push(sourceString(path, text, offset, value.replace(/\\(["'`\\])/g, "$1"), order++));
  }
  return out.sort((a, b) => (a.location as { line: number }).line - (b.location as { line: number }).line || (a.location as { column: number }).column - (b.location as { column: number }).column);
}
