/**
 * Corpus inference: field definitions from the values a collection's files
 * actually hold. Deliberately conservative — a type is only claimed when
 * every value supports it, and `select` only on strong evidence — because a
 * wrong guess becomes a form control that fights the person using it.
 */
import type { BlockType, Field, FieldType, JsonValue } from "../../types";
import { isObject, type JsonObject } from "../util/json";
import { labelForBlockType, labelForKey } from "../util/text";

export interface InferOptions {
  /** URL prefixes of media roots ("/images"), so extension-less media paths still read as images. */
  mediaPublicPaths?: string[];
}

/** Keys that commonly name the block type of a page-builder list, in priority order. */
export const DISCRIMINATORS = ["type", "_component", "_type", "block", "component", "template", "_template", "blockType", "_block"];

/** Above this many files, inference reads an evenly spaced sample. */
export const SAMPLE_LIMIT = 400;
const REQUIRED_SHARE = 0.95;
const SELECT_MAX_OPTIONS = 8;
const SELECT_MIN_ITEMS = 12;
const TAG_MAX_LENGTH = 60;
const MAX_TAG_OPTIONS = 50;
const MAX_EXAMPLE_LENGTH = 300;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const COLOR = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico|tiff?|heic)(\?[^\s]*)?$/i;
const URL_LIKE = /^(https?:\/\/\S+|mailto:\S+|tel:\S+|\/\S*|#[\w-]+|\.{1,2}\/\S*)$/;
const MARKDOWN_BLOCK = /(^|\n)(#{1,6}\s|\s*[-*+]\s+\S|\s*\d+\.\s+\S|>\s)/;
const MARKDOWN_INLINE = /\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|`[^`]+`|(^|\s)_[^_\s][^_]*_(\s|$)/;

/** Evenly spaced sample, deterministic for a given input order. */
export function sample<T>(items: T[], limit = SAMPLE_LIMIT): T[] {
  if (items.length <= limit) return items;
  const step = items.length / limit;

  return Array.from({ length: limit }, (_, index) => items[Math.floor(index * step)]!);
}

type StringKind = "date" | "datetime" | "color" | "image" | "url" | "markdown" | "text" | "string";

export function classifyString(value: string, options: InferOptions = {}): StringKind {
  const trimmed = value.trim();

  if (DATE.test(trimmed)) return "date";
  if (DATETIME.test(trimmed)) return "datetime";
  if (COLOR.test(trimmed)) return "color";
  if (!/\s/.test(trimmed) && trimmed !== "") {
    if (IMAGE_EXT.test(trimmed)) return "image";
    const media = (options.mediaPublicPaths ?? []).filter((prefix) => prefix !== "/" && prefix !== "");

    if (media.some((prefix) => trimmed.startsWith(`${prefix.replace(/\/$/, "")}/`)) && !/\/$/.test(trimmed)) return "image";
    if (URL_LIKE.test(trimmed)) return "url";
  }
  if (MARKDOWN_INLINE.test(value) || (value.includes("\n") && MARKDOWN_BLOCK.test(value))) return "markdown";
  if (value.includes("\n") || value.length > 200) return "text";
  return "string";
}

const SPECIAL: StringKind[] = ["date", "datetime", "color", "image", "url"];
const PROSE_RANK: Record<string, number> = { string: 0, text: 1, markdown: 2 };

/** One type for a set of string kinds — a special type only when every value agrees. */
function combineStrings(kinds: StringKind[]): FieldType {
  const set = new Set(kinds);

  if (set.size === 0) return "string";
  if (set.size === 1) return [...set][0]!;
  if ([...set].every((kind) => kind === "date" || kind === "datetime")) return "datetime";
  if ([...set].every((kind) => kind === "image" || kind === "url")) return "url";
  let best: StringKind = "string";

  for (const kind of set) {
    if (SPECIAL.includes(kind)) continue;
    if (PROSE_RANK[kind]! > PROSE_RANK[best]!) best = kind;
  }
  return best;
}

const isEmpty = (value: JsonValue | undefined): boolean => value === undefined || value === null || value === "";

/** Key order that respects each item's own order: a key goes after the key that preceded it. */
function keyOrder(items: JsonObject[]): string[] {
  const order: string[] = [];
  const sorted = [...items].sort((a, b) => Object.keys(b).length - Object.keys(a).length);

  for (const item of sorted) {
    let previous: string | null = null;

    for (const key of Object.keys(item)) {
      if (!order.includes(key)) {
        order.splice(previous === null ? 0 : order.indexOf(previous) + 1, 0, key);
      }
      previous = key;
    }
  }
  return order;
}

export function leafCount(value: JsonValue): number {
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + leafCount(item), 0);
  if (isObject(value)) return Object.values(value).reduce<number>((sum, item) => sum + leafCount(item), 0);
  return isEmpty(value) ? 0 : 1;
}

function examplesFrom(values: JsonValue[]): JsonValue[] | undefined {
  const seen = new Set<string>();
  const out: JsonValue[] = [];

  for (const value of values) {
    if (isEmpty(value) || (typeof value === "string" && value.length > MAX_EXAMPLE_LENGTH)) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    const key = JSON.stringify(value);

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length === 3) break;
  }
  return out.length > 0 ? out : undefined;
}

function discriminatorOf(objects: JsonObject[]): string | null {
  if (objects.length === 0) return null;
  for (const key of DISCRIMINATORS) {
    const values = objects.map((object) => object[key]);
    const usable = values.filter((value) => typeof value === "string" && /^[\w./:@-]{1,80}$/.test(value));

    if (usable.length >= Math.ceil(objects.length * 0.9) && usable.length > 0) return key;
  }
  return null;
}

/** Builds a blocks field's types from every instance of every block in the corpus. */
export function inferBlocks(objects: JsonObject[], discriminator: string, options: InferOptions): BlockType[] {
  const byType = new Map<string, JsonObject[]>();

  for (const object of objects) {
    const type = object[discriminator];

    if (typeof type !== "string") continue;
    const list = byType.get(type) ?? [];

    list.push(object);
    byType.set(type, list);
  }
  return [...byType.entries()]
    .map(([type, instances]) => {
      const withoutDiscriminator = instances.map((instance) => {
        const copy = { ...instance };

        delete copy[discriminator];
        return copy;
      });
      const example = instances.reduce((best, instance) => (leafCount(instance) > leafCount(best) ? instance : best), instances[0]!);

      return {
        type,
        label: labelForBlockType(type),
        fields: inferFields(withoutDiscriminator, options),
        count: instances.length,
        example,
      } satisfies BlockType;
    })
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

function inferList(key: string, arrays: JsonValue[][], options: InferOptions): Partial<Field> {
  const elements = arrays.flat();

  if (elements.length === 0) return { type: "list", of: { key: "item", label: "Item", type: "string", required: false, source: "inferred" } };
  if (elements.every((element) => typeof element === "string")) {
    const strings = elements as string[];
    const kinds = strings.map((value) => classifyString(value, options));
    const itemType = combineStrings(kinds);
    const short = strings.every((value) => value.length <= TAG_MAX_LENGTH && !value.includes("\n"));

    if (short && (itemType === "string" || itemType === "text")) {
      const counts = new Map<string, number>();

      for (const value of strings) counts.set(value, (counts.get(value) ?? 0) + 1);
      const options_ = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, MAX_TAG_OPTIONS).map(([value]) => value);

      return { type: "tags", options: options_ };
    }
    return { type: "list", of: { key: "item", label: "Item", type: itemType, required: false, source: "inferred", examples: examplesFrom(strings) } };
  }
  if (elements.every(isObject)) {
    const objects = elements as JsonObject[];
    const discriminator = discriminatorOf(objects);

    if (discriminator) return { type: "blocks", discriminator, blocks: inferBlocks(objects, discriminator, options) };
    return {
      type: "list",
      of: { key: "item", label: labelForKey(key.replace(/s$/, "")) || "Item", type: "object", required: false, source: "inferred", fields: inferFields(objects, options) },
    };
  }
  const element = inferField("item", elements, elements.length, options);

  return { type: "list", of: { ...element, label: "Item" } };
}

/** Infers one field from every value it holds (absent values excluded). */
export function inferField(key: string, values: JsonValue[], total: number, options: InferOptions = {}): Field {
  const present = values.filter((value) => !isEmpty(value));
  const base: Field = { key, label: labelForKey(key), type: "json", required: total > 0 && present.length / total >= REQUIRED_SHARE, source: "inferred" };

  if (present.length === 0) return { ...base, type: "string", required: false };
  if (present.every((value) => typeof value === "boolean")) return { ...base, type: "boolean", examples: examplesFrom(present) };
  if (present.every((value) => typeof value === "number")) return { ...base, type: "number", examples: examplesFrom(present) };
  if (present.every((value) => typeof value === "string")) {
    const strings = present as string[];
    const type = combineStrings(strings.map((value) => classifyString(value, options)));
    const field: Field = { ...base, type, examples: examplesFrom(strings) };

    if (type === "string" && strings.length >= SELECT_MIN_ITEMS) {
      const distinct = [...new Set(strings)];

      if (distinct.length <= SELECT_MAX_OPTIONS && distinct.every((value) => value.length <= 40)) {
        const counts = new Map<string, number>();

        for (const value of strings) counts.set(value, (counts.get(value) ?? 0) + 1);
        field.type = "select";
        field.options = distinct.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b));
      }
    }
    return field;
  }
  if (present.every(Array.isArray)) return { ...base, ...inferList(key, present as JsonValue[][], options) } as Field;
  if (present.every(isObject)) {
    return { ...base, type: "object", fields: inferFields(present as JsonObject[], options) };
  }
  // Mixed scalars (a number here, a string there): treat as text rather than guess.
  if (present.every((value) => !Array.isArray(value) && !isObject(value))) {
    return { ...base, type: "string", examples: examplesFrom(present) };
  }
  return base;
}

/** Field definitions for a set of objects (a collection's front matter, or one block type). */
export function inferFields(items: JsonObject[], options: InferOptions = {}): Field[] {
  const order = keyOrder(items);

  return order.map((key) => {
    const values = items.filter((item) => Object.hasOwn(item, key)).map((item) => item[key]!);

    return inferField(key, values, items.length, options);
  });
}

const TITLE_KEYS = ["title", "name", "heading", "headline", "label"];
const DATE_KEYS = ["date", "pubDate", "publishDate", "publishedAt", "published", "datePublished", "published_at", "created", "createdAt", "updated", "updatedAt", "lastmod"];
const IMAGE_KEYS = ["image", "heroImage", "hero_image", "cover", "coverImage", "cover_image", "thumbnail", "featuredImage", "featured_image", "banner", "ogImage", "og_image"];
const DRAFT_KEYS = ["draft", "unpublished", "hidden", "private"];

function pick(fields: Field[], keys: string[], types: FieldType[]): string | undefined {
  for (const key of keys) {
    const field = fields.find((candidate) => candidate.key === key);

    if (field && types.includes(field.type)) return field.key;
  }
  return undefined;
}

/** The fields a list view leans on: title, date, image, draft flag. */
export function pickListFields(fields: Field[]): { titleField?: string; dateField?: string; imageField?: string; draftField?: string } {
  const titleField =
    pick(fields, TITLE_KEYS, ["string", "text", "select"]) ??
    fields.find((field) => /title/i.test(field.key) && (field.type === "string" || field.type === "text"))?.key;
  const dateField = pick(fields, DATE_KEYS, ["date", "datetime"]) ?? fields.find((field) => field.type === "date" || field.type === "datetime")?.key;
  const imageField = pick(fields, IMAGE_KEYS, ["image", "url", "string"]) ?? fields.find((field) => field.type === "image")?.key;
  const draftField = pick(fields, DRAFT_KEYS, ["boolean"]);
  const out: ReturnType<typeof pickListFields> = {};

  if (titleField) out.titleField = titleField;
  if (dateField) out.dateField = dateField;
  if (imageField) out.imageField = imageField;
  if (draftField) out.draftField = draftField;
  return out;
}
