/**
 * Starting values for new sections and list items.
 *
 * A new section takes its shape from the most complete real one
 * (`BlockType.example`) but not its words: copy and links are blanked,
 * while settings (choices, numbers, switches, colours) are kept. Copying
 * another page's words into a new section makes duplicate text that is easy
 * to publish by mistake; an empty heading is obvious and the form flags it.
 * Optional copy is left out entirely, so the file only gains what the person
 * fills in.
 *
 * A blank is not a value for everything, though. A required field that names
 * a file (a picture, a video, a download), picks from a list, points at
 * another entry, or is a number or date can't draw blank: the site's
 * component throws and the whole page stops drawing — and a person adding a
 * section on the page sees it at once. Those start (`newSection`) with what
 * the site declares for them, else the value the nearest real section of the
 * same type has (this page, then this collection, then anywhere), which is
 * known to draw; the person is told where it came from. Only when there is
 * nothing to borrow do they stay blank.
 */
import type { BlockSample, BlockType, Field, FieldPath, JsonValue } from "@galley/core/types";
import { isObject, type JsonObject } from "./paths";

const COPY_TYPES = new Set(["string", "text", "markdown", "url", "image", "reference", "date", "datetime"]);

/** The empty value a field starts with. */
export function emptyValue(field: Field): JsonValue {
  if (field.default !== undefined) return field.default;
  switch (field.type) {
    case "number":
      // The schema's smallest allowed value when 0 isn't allowed.
      return field.min !== undefined && field.min > 0 ? field.min : field.max !== undefined && field.max < 0 ? field.max : 0;
    case "boolean":
      return false;
    case "tags":
      return atLeast(field, [], "");
    case "list":
      return atLeast(field, [], newListItem(field.of));
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

/** A list grown to the fewest items its schema allows, with copies of `item` (a list one short fails the schema). */
function atLeast(field: Field | undefined, list: JsonValue[], item: JsonValue | undefined): JsonValue[] {
  const min = field?.min ?? 0;
  if (item === undefined || list.length >= min) return list;
  const out = [...list];
  while (out.length < min) out.push(structuredClone(item));
  return out;
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
    if (type === "tags") return required ? atLeast(field, [], "") : undefined;
    const first = value[0];
    if (first === undefined) return required ? atLeast(field, [], field?.of ? newListItem(field.of) : undefined) : undefined;
    if (isObject(first)) {
      const item = blankObject(first, field?.of?.fields ?? []);
      return atLeast(field, [item], item);
    }
    return required ? atLeast(field, [""], "") : undefined;
  }
  const out = blankObject(value, field?.fields ?? []);
  // An optional group (a second button, a link) left with nothing of its own is left out, as optional words are.
  if (field && !required && !holdsSomething(out)) return undefined;
  return out;
}

/** Whether a blanked value still says anything: some text, a number, a switch that's on. */
function holdsSomething(value: JsonValue): boolean {
  if (typeof value === "string") return value !== "";
  if (typeof value === "number") return true;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.some(holdsSomething);
  return value !== null && Object.values(value).some(holdsSomething);
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

// ── what a new section starts with where a blank wouldn't draw

/** Where a value a new section starts with came from. */
export type BorrowedFrom =
  /** The site's own declaration (galley.config.json `examples`/`example`, or zod `.meta({ examples })`). */
  | { kind: "declared" }
  /** Another section of the same type on the page it is added to. */
  | { kind: "page" }
  /** A section of the same type on another entry. */
  | { kind: "entry"; title: string; noun: string };

export interface Borrowed {
  /** Where in the section, e.g. ["video"] or ["tabs", 0, "visual", "src"]. */
  path: FieldPath;
  /** The field's label, e.g. "Video". */
  label: string;
  from: BorrowedFrom;
}

export interface SectionContext {
  /** The list the section is added to, as it is now (the page's own sections, edits included). */
  siblings?: readonly JsonValue[];
  /** Where it is added in that list (nearest siblings are asked first). */
  index?: number;
  /** The entry it is added to: its samples are skipped (`siblings` is its live copy). */
  entryPath?: string;
  /** What the entry's collection calls one entry ("page"). */
  noun?: string;
  /** The same section type in other collections, nearest last: their samples and nouns. */
  elsewhere?: ReadonlyArray<{ samples: readonly BlockSample[]; noun: string }>;
}

export interface NewSection {
  value: JsonObject;
  borrowed: Borrowed[];
}

/** Types that can't be blank and still draw. Text, Markdown, switches and lists can. */
const VALUE_TYPES = new Set(["image", "select", "reference", "number", "date", "datetime", "color"]);
/** A plain name of a thing: a slug or a path, no spaces, lower case ("galley-demo", "video/tour"). */
const NAME = /^\/?[a-z0-9][a-z0-9._@-]*(?:\/[a-z0-9._@-]+)*\/?$/;
/** A file by its extension (a page is not a file here). */
const FILE = /\.(?!html?$|php$|aspx?$)[a-z0-9]{2,5}$/i;

const isBlank = (value: JsonValue | undefined): boolean => value === undefined || value === null || value === "";

/** The value at `path` in `value`; a number in the path matches any item of that list that has one. */
function valueAt(value: JsonValue | undefined, path: FieldPath): JsonValue | undefined {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (typeof head === "number") {
    if (!Array.isArray(value)) return undefined;
    const exact = valueAt(value[head], rest);
    if (!isBlank(exact)) return exact;
    for (const item of value) {
      const found = valueAt(item, rest);
      if (!isBlank(found)) return found;
    }
    return undefined;
  }
  return isObject(value) ? valueAt(value[head as string], rest) : undefined;
}

function setAt(target: JsonObject, path: FieldPath, value: JsonValue): void {
  let current: JsonValue = target;
  for (const [at, key] of path.entries()) {
    const last = at === path.length - 1;
    if (Array.isArray(current) && typeof key === "number") {
      if (last) current[key] = value;
      else current = current[key] as JsonValue;
    } else if (isObject(current) && typeof key === "string") {
      if (last) current[key] = value;
      else current = current[key] as JsonValue;
    } else return;
  }
}

/**
 * Whether a required field can't draw blank. Pictures, choices, references,
 * numbers, dates and colours never can. A plain text field can't when every
 * real value it has is the name of a thing rather than words — a slug, a
 * path, a file — which is how a site names a video or a download
 * (`video: "galley-demo"` means public/video/galley-demo.*).
 */
export function needsValue(field: Field, known: readonly JsonValue[]): boolean {
  if (!field.required || field.hidden) return false;
  if (VALUE_TYPES.has(field.type)) return true;
  if (field.type !== "string" && field.type !== "url") return false;
  const values = known.filter((value): value is string => typeof value === "string" && value !== "");
  // A link is words unless it is a file; a plain text field may also be a name.
  const names = (value: string) => !/\s/.test(value) && (FILE.test(value) || (field.type === "string" && NAME.test(value)));
  return values.length > 0 && values.every(names);
}

interface Need {
  path: FieldPath;
  field: Field;
  /** The fields of the object it sits in, for the settings that go with it. */
  beside: readonly Field[];
}

/** Settings: what says how a value is meant (a picture's kind, a side), as opposed to words. */
const SETTING_TYPES = new Set(["select", "boolean", "number", "color"]);

/** Every required leaf in the new section that is blank, with its field. */
function blanks(fields: readonly Field[], value: JsonValue | undefined, path: FieldPath, out: Need[]): Need[] {
  if (!isObject(value)) return out;
  for (const field of fields) {
    if (field.hidden) continue;
    const own = value[field.key];
    const at = [...path, field.key];
    if (field.type === "object") blanks(field.fields ?? [], own, at, out);
    else if (field.type === "list" && field.of?.type === "object" && Array.isArray(own)) own.forEach((item, index) => blanks(field.of?.fields ?? [], item, [...at, index], out));
    else if (field.required && isBlank(own)) out.push({ path: at, field, beside: fields });
  }
  return out;
}

/** The section, and the sections a value may come from, nearest first. */
function sources(block: BlockType, discriminator: string, context: SectionContext): Array<{ value: JsonValue; from: BorrowedFrom }> {
  const out: Array<{ value: JsonValue; from: BorrowedFrom }> = [];
  const siblings = context.siblings ?? [];
  const index = context.index ?? siblings.length;
  // This page: the sections nearest the new one first.
  const mine = siblings.map((item, at) => ({ item, distance: Math.abs(at - index + 0.5) })).filter(({ item }) => isObject(item) && item[discriminator] === block.type);
  mine.sort((a, b) => a.distance - b.distance);
  for (const { item } of mine) out.push({ value: item, from: { kind: "page" } });
  for (const sample of block.samples ?? []) {
    if (sample.path !== context.entryPath) out.push({ value: sample.value, from: { kind: "entry", title: sample.title, noun: context.noun ?? "page" } });
  }
  for (const other of context.elsewhere ?? []) {
    for (const sample of other.samples) {
      if (sample.path !== context.entryPath) out.push({ value: sample.value, from: { kind: "entry", title: sample.title, noun: other.noun } });
    }
  }
  return out;
}

/**
 * What "Add section" inserts — on the page in Arrange, and in the form's
 * section list alike — and what it borrowed. Without a context it is
 * `blockScaffold` exactly, but for declared values.
 */
export function newSection(block: BlockType, discriminator: string, context: SectionContext = {}): NewSection {
  const value = blockScaffold(block, discriminator);
  const borrowed: Borrowed[] = [];
  const from = sources(block, discriminator, context);
  for (const { path, field, beside } of blanks(block.fields, value, [], [])) {
    // What the field holds in real sections (and the example the shape came from): the evidence for what kind of value it is.
    const known = [...(field.examples ?? []), ...[block.example ?? {}, ...from.map((source) => source.value)].map((source) => valueAt(source, path)).filter((item): item is JsonValue => item !== undefined)];
    if (!needsValue(field, known)) continue;
    // 1. What the site declares for the field: its default (no news), then its own example.
    if (field.default !== undefined && !isBlank(field.default)) {
      setAt(value, path, field.default);
      continue;
    }
    const declared = field.examplesDeclared ? field.examples?.find((item) => !isBlank(item)) : block.exampleDeclared ? valueAt(block.example, path) : undefined;
    if (declared !== undefined && !isBlank(declared)) {
      setAt(value, path, declared);
      borrowed.push({ path, label: field.label, from: { kind: "declared" } });
      continue;
    }
    // 2. The nearest real section of this type that has one: known to draw.
    for (const source of from) {
      const found = valueAt(source.value, path);
      if (isBlank(found) || found === undefined) continue;
      setAt(value, path, found);
      // Inside a group (a picture and its kind), the settings beside it come along from the
      // same section, so they agree. The section's own settings stay as they were.
      const parent = path.slice(0, -1);
      for (const setting of parent.length > 0 ? beside : []) {
        if (setting === field || !SETTING_TYPES.has(setting.type)) continue;
        const theirs = valueAt(source.value, [...parent, setting.key]);
        if (theirs !== undefined && !isBlank(theirs)) setAt(value, [...parent, setting.key], theirs);
      }
      borrowed.push({ path, label: field.label, from: source.from });
      break;
    }
    // 3. Nothing to borrow: it stays as it was (blank, or the field's first choice).
  }
  return { value, borrowed };
}

const lowerFirst = (label: string) => (/^[A-Z][a-z]/.test(label) ? label[0]!.toLowerCase() + label.slice(1) : label);

function fromWords(from: BorrowedFrom, label: string): string {
  switch (from.kind) {
    case "declared":
      return "from the site’s own example";
    case "page":
      return `from another ${label} section on this page`;
    case "entry":
      return `from the “${from.title}” ${from.noun}`;
  }
}

const joinAnd = (parts: string[]) => (parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`);

/**
 * The one sentence that tells the person what a new section borrowed and
 * that it is theirs to change, or null when it borrowed nothing:
 * "The new Film section starts with the video from the “Home” page. Change it in the form."
 */
export function borrowedNote(label: string, borrowed: readonly Borrowed[]): string | null {
  if (borrowed.length === 0) return null;
  const groups = new Map<string, { from: BorrowedFrom; labels: string[] }>();
  for (const item of borrowed) {
    const key = JSON.stringify(item.from);
    const group = groups.get(key) ?? { from: item.from, labels: [] };
    const words = `the ${lowerFirst(item.label)}`;
    if (!group.labels.includes(words)) group.labels.push(words);
    groups.set(key, group);
  }
  const parts = [...groups.values()].map((group) => `${joinAnd(group.labels)} ${fromWords(group.from, label)}`);
  return `The new ${label} section starts with ${joinAnd(parts)}. Change ${borrowed.length === 1 ? "it" : "them"} in the form.`;
}
