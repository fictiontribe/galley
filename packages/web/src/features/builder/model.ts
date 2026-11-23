/**
 * The page builder's model, as plain functions: which fields hold a page's
 * sections, what the overlay needs to find each one on the page, which of a
 * section's fields are its options, and how the palette lists section types.
 * Nothing here guesses: evidence is only text a single section holds, and
 * options are only choices the site's schema spells out.
 */
import type { BlockType, Field, JsonValue, OverlaySection, OverlaySectionList } from "@galley/core/types";
import { blockLabel, blockTypeOf } from "@/features/content/form/summary";

type JsonObject = { [key: string]: JsonValue };
const isObject = (value: JsonValue | undefined): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

/** The entry's top-level blocks fields that the form shows: the lists of sections a page is built from. */
export function blocksFields(fields: readonly Field[]): Field[] {
  return fields.filter((field) => field.type === "blocks" && !field.hidden);
}

/** "sections.3" ⇄ { field: "sections", index: 3 }. */
export const sectionKey = (field: string, index: number): string => `${field}.${index}`;
export function parseSectionKey(key: string | null): { field: string; index: number } | null {
  if (!key) return null;
  const dot = key.lastIndexOf(".");
  const index = Number(key.slice(dot + 1));
  if (dot <= 0 || !Number.isInteger(index) || index < 0) return null;
  return { field: key.slice(0, dot), index };
}

const SETTING_TYPES = new Set(["select", "boolean", "number", "color", "date", "datetime", "json"]);
const NOT_COPY = new Set(["image", "url", "select", "color", "date", "datetime", "reference", "boolean", "number", "json"]);
const NOT_COPY_KEY = /^(href|url|link|src|slug|id|icon|anchor|target|rel|class|style|type|variant|tone|align|layout|theme|size|width|height)$/i;
const IMAGE_KEY = /(^|_|-)(image|img|src|logo|photo|picture|avatar|thumbnail|background|poster)s?$/i;
const MAX_TEXTS = 16;
const MAX_IMAGES = 8;

/** Markdown as the page shows it: one string per paragraph or list item, inline marks gone, whitespace collapsed. */
export function shownText(markdown: string): string[] {
  const out: string[] = [];
  for (const block of markdown.split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/).filter((line) => line.trim());
    const listy = lines.length > 0 && lines.every((line) => /^\s*([-*+]|\d+[.)])\s+/.test(line));
    const parts = listy ? lines.map((line) => line.replace(/^\s*([-*+]|\d+[.)])\s+/, "")) : [lines.join(" ")];
    for (const part of parts) {
      const plain = part
        .replace(/^\s{0,3}(#{1,6}|>)\s*/, "")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/<[^>]+>/g, "")
        .replace(/(\*\*|__|\*|_|~~|`)/g, "")
        .replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1")
        .replace(/\s+/g, " ")
        .trim();
      if (plain) out.push(plain);
    }
  }
  return out;
}

const looksLikeAddress = (value: string) => /^(\/|\.\.?\/|https?:|mailto:|tel:|#)/i.test(value) && !/\s/.test(value);
const isImagePath = (value: string) => looksLikeAddress(value) && /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i.test(value);
const meaningful = (text: string) => text.length >= 3 && /[\p{L}\p{N}]/u.test(text);

/** Every string a section stores that the page shows as text, and every image address it stores. */
export function sectionEvidence(item: JsonValue | undefined, block: BlockType | undefined, discriminator: string): { texts: string[]; images: string[] } {
  const texts: string[] = [];
  const images: string[] = [];
  const walk = (value: JsonValue | undefined, field: Field | undefined, key: string) => {
    if (value === undefined || value === null) return;
    if (typeof value === "string") {
      if (field?.type === "image" || (!field && IMAGE_KEY.test(key)) || isImagePath(value)) {
        if (looksLikeAddress(value)) images.push(value);
        return;
      }
      if (field ? NOT_COPY.has(field.type) : NOT_COPY_KEY.test(key) || looksLikeAddress(value)) return;
      for (const text of shownText(value)) if (meaningful(text)) texts.push(text);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, field?.of ?? (field?.type === "tags" ? { ...field, type: "string" } : undefined), key);
      return;
    }
    if (typeof value === "object") {
      for (const [childKey, child] of Object.entries(value)) {
        if (childKey === discriminator && field === undefined && key === "") continue;
        walk(child, field?.fields?.find((candidate) => candidate.key === childKey), childKey);
      }
    }
  };
  if (isObject(item)) {
    for (const [key, value] of Object.entries(item)) {
      if (key === discriminator) continue;
      walk(value, block?.fields.find((field) => field.key === key), key);
    }
  }
  return { texts: [...new Set(texts)], images: [...new Set(images)] };
}

/**
 * What the overlay needs to find the entry's sections on the page: for each
 * blocks field, its sections with label and type, and evidence that only
 * that section holds (strings or images two sections share are left out —
 * they can't tell the two apart).
 */
export function sectionLists(fields: readonly Field[], data: JsonObject): OverlaySectionList[] {
  const lists = blocksFields(fields).map((field) => {
    const value = data[field.key];
    const items = Array.isArray(value) ? value : [];
    const discriminator = field.discriminator ?? "type";
    return {
      field,
      sections: items.map((item, index) => {
        const block = blockTypeOf(item, field);
        const type = isObject(item) && typeof item[discriminator] === "string" ? (item[discriminator] as string) : "";
        return { index, type, label: blockLabel(item, field), ...sectionEvidence(item, block, discriminator) };
      }),
    };
  });
  const seen = new Map<string, number>();
  const count = (key: string) => seen.set(key, (seen.get(key) ?? 0) + 1);
  for (const list of lists) {
    for (const section of list.sections) {
      for (const text of section.texts) count(`t${text}`);
      for (const image of section.images) count(`i${image}`);
    }
  }
  const distinct = (prefix: string) => (value: string) => seen.get(`${prefix}${value}`) === 1;
  return lists.map(({ field, sections }) => ({
    field: field.key,
    sections: sections.map(
      (section): OverlaySection => ({
        index: section.index,
        type: section.type,
        label: section.label,
        // Longest first: a heading or a paragraph says more than a two-word button.
        texts: section.texts.filter(distinct("t")).sort((a, b) => b.length - a.length).slice(0, MAX_TEXTS),
        images: section.images.filter(distinct("i")).slice(0, MAX_IMAGES),
      }),
    ),
  }));
}

/**
 * A section's options: the choices its schema spells out — selects with two
 * to six values, and switches. Never free text; never nested fields.
 */
export function optionFields(block: BlockType | undefined): Field[] {
  return (block?.fields ?? []).filter((field) => {
    if (field.hidden) return false;
    if (field.type === "boolean") return true;
    const count = field.options?.length ?? 0;
    return field.type === "select" && count >= 2 && count <= 6;
  });
}

/** "media-left" → "Media left", "imageSide" → "Image side", "2" → "2". */
export function humanize(value: string): string {
  const words = value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The value an option shows: what the section stores, else the schema's default, else nothing chosen. */
export function optionValue(item: JsonValue | undefined, field: Field): JsonValue | undefined {
  const stored = isObject(item) ? item[field.key] : undefined;
  if (stored !== undefined && stored !== null) return stored;
  return field.default;
}

/** The fields a section type has, in a few words, for a palette card with no picture. */
export function fieldSummary(block: BlockType, max = 3): string {
  // What a section holds (words, pictures, lists), not its settings.
  const labels = block.fields.filter((field) => !field.hidden && !SETTING_TYPES.has(field.type) && !/^(id|anchor|slug)$/i.test(field.key)).map((field) => field.label);
  if (labels.length === 0) return "No fields";
  const shown = labels.slice(0, max).join(" · ");
  return labels.length > max ? `${shown} · ${labels.length - max} more` : shown;
}

export interface BlockGroup {
  /** The heading over the group, or null for a flat list. */
  label: string | null;
  blocks: BlockType[];
}

const stem = (label: string) => {
  const word = (label.trim().split(/\s+/)[0] ?? "").toLowerCase();
  return word.length > 3 ? word.replace(/s$/, "") : word;
};

/**
 * The palette's groups, only when the site's own labels make them obvious:
 * section types whose labels start with the same word ("Hero", "Hero with
 * form") form a group, and the rest follow under "More sections". Short
 * lists, and lists where fewer than two such groups appear, stay flat —
 * there is no taxonomy of our own.
 */
export function groupBlocks(blocks: readonly BlockType[]): BlockGroup[] {
  if (blocks.length < 8) return [{ label: null, blocks: [...blocks] }];
  const byStem = new Map<string, BlockType[]>();
  for (const block of blocks) {
    const key = stem(block.label);
    byStem.set(key, [...(byStem.get(key) ?? []), block]);
  }
  const groups = [...byStem.values()].filter((members) => members.length >= 2);
  if (groups.length < 2) return [{ label: null, blocks: [...blocks] }];
  const grouped = new Set(groups.flat());
  const out: BlockGroup[] = groups.map((members) => ({ label: (members[0] as BlockType).label.trim().split(/\s+/)[0] as string, blocks: members }));
  const rest = blocks.filter((block) => !grouped.has(block));
  if (rest.length > 0) out.push({ label: "More sections", blocks: rest });
  return out;
}

/** Section types matching a search, by label, type and description. */
export function searchBlocks(blocks: readonly BlockType[], query: string): BlockType[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...blocks];
  return blocks.filter((block) => {
    const haystack = `${block.label} ${block.type} ${block.description ?? ""}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** Where a new section goes, in words: "at the top of the page", "after “Hero”". */
export function positionWords(labels: readonly string[], index: number): string {
  if (labels.length === 0) return "on this page";
  if (index >= labels.length) return "at the end of the page";
  if (index <= 0) return "at the top of the page";
  return `after “${labels[index - 1]}”`;
}
