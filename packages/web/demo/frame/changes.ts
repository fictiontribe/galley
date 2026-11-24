/**
 * Pure helpers for showing the working copy on a built page: which values
 * changed, how the site renders a value as text and as HTML, and where on
 * the page a value lives. No DOM here (demo/frame/apply.ts does the DOM).
 */
import type { JsonValue } from "@galley/core/types";

export type Path = Array<string | number>;

export interface Leaf {
  path: Path;
  before: JsonValue | undefined;
  after: JsonValue | undefined;
}

const isObject = (value: JsonValue | undefined): value is { [key: string]: JsonValue } => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Every value that differs between two versions of an entry's data, down to
 * strings, numbers and booleans. Lists of the same length are compared item
 * by item; a list that grew, shrank or holds plain values is one change.
 */
export function leafChanges(before: JsonValue | undefined, after: JsonValue | undefined, path: Path = []): Leaf[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (isObject(before) && isObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].flatMap((key) => leafChanges(before[key], after[key], [...path, key]));
  }
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    return before.flatMap((item, index) => leafChanges(item, after[index], [...path, index]));
  }
  return [{ path, before, after }];
}

/** The order of a page's sections changed, or one was added or removed: the page's layout, not just its words. */
export function sectionsChanged(before: JsonValue | undefined, after: JsonValue | undefined): boolean {
  const types = (value: JsonValue | undefined) => (Array.isArray(value) ? value.map((item) => (isObject(item) ? String(item.type ?? "") : "")) : []);
  const a = types(before);
  const b = types(after);
  return a.length !== b.length || a.some((type, index) => type !== b[index]);
}

/** The text a value shows as: inline markdown and tags stripped, spaces collapsed (as the overlay and the resolver compare). */
export function plainText(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/** A value as the sample site renders it inline: **strong**, *emphasis* and _emphasis_, `code`, [links](…). */
export function inlineHtml(value: string): string {
  return escape(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/(^|[\s(])_([^_]+)_(?=$|[\s).,;:!?])/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
}

/** The paragraphs of a multi-line value, as the site splits them (a blank line between). */
export function paragraphsOf(value: string): string[] {
  return value
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** A value that names a picture rather than words. */
export function isImagePath(value: unknown): value is string {
  return typeof value === "string" && /^\/[^\s]*\.(webp|png|jpe?g|gif|svg|avif)$/i.test(value);
}

/** The block a field sits in (`sections.2` for sections › 2 › heading), as the page's markers name it, or null. */
export function blockKeyOf(path: Path): string | null {
  const index = path.findIndex((part) => typeof part === "number");
  if (index < 1) return null;
  return `${path.slice(0, index).join(".")}.${String(path[index])}`;
}

/** How a change will be shown: in words, as a picture, in the page's title or description, or not at all. */
export type Plan =
  | { kind: "text"; scope: string | null; before: string; after: string }
  | { kind: "image"; scope: string | null; before: string; after: string }
  | { kind: "title"; after: string }
  | { kind: "description"; after: string }
  | { kind: "none"; label: string };

export function planFor(leaf: Leaf, ownEntry: boolean): Plan {
  const { path, before, after } = leaf;
  const label = path.join(" › ");
  if (typeof before !== "string" || typeof after !== "string") return { kind: "none", label };
  if (ownEntry && path.length === 1 && path[0] === "title") return { kind: "title", after };
  if (ownEntry && path.length === 1 && path[0] === "description") return { kind: "description", after };
  const scope = ownEntry ? blockKeyOf(path) : null;
  if (isImagePath(before) || isImagePath(after)) return { kind: "image", scope, before, after };
  if (!plainText(before)) return { kind: "none", label };
  return { kind: "text", scope, before, after };
}
