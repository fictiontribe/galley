/**
 * What the content files say about a page, read once per content hash: its
 * title and description (and which fields hold them), images with their alt
 * text, links with their text, body headings, the page's text in reading
 * order, dates, authors and the engine's own validation issues. Pure: the
 * entry comes in, facts come out; the checks never re-read files.
 */
import { labelForFieldPath } from "../content/diff/fields";
import { getIn, isObject } from "../content/util/json";
import type { Collection, Entry, Field, FieldPath, JsonValue, ValidationIssue } from "../types";
import { collapse, plainText, wordCount } from "./text";

export interface FieldValue {
  value: string;
  field: FieldPath | null;
  label: string;
}

export interface ContentImage {
  src: string;
  alt: string | null;
  /** Where the image path is stored. Null in the main text. */
  field: FieldPath | null;
  /** Where its alt text is (or would be) stored; null when the page has no place for one. */
  altField: FieldPath | null;
  /** Text right beside the image that already says what it shows (a person's name, a caption). */
  beside: string | null;
  /** Width/height fields next to the image, when the schema has them. */
  sizeFields?: { width: FieldPath; height: FieldPath; hasWidth: boolean; hasHeight: boolean };
  inBody: boolean;
}

export interface ContentLink {
  href: string;
  text: string;
  /** Where the link is stored; null in the main text. */
  field: FieldPath | null;
  inBody: boolean;
  /** The exact source text of the link, for body edits ("](/about)"). */
  raw?: string;
}

export interface ContentHeading {
  level: number;
  text: string;
  inBody: boolean;
  field: FieldPath | null;
}

export interface ContentPage {
  path: string;
  hash: string;
  collection: string;
  collectionLabel: string;
  /** "entries" collections make pages; data files (settings, menus) don't. */
  isPage: boolean;
  url: string | null;
  title: FieldValue | null;
  titleFieldExists: boolean;
  description: FieldValue | null;
  descriptionField: FieldPath | null;
  shareImage: FieldValue | null;
  shareImageField: FieldPath | null;
  noindex: { value: boolean; field: FieldPath | null };
  draft: boolean;
  date: { value: string | null; field: FieldPath | null };
  author: { value: string | null; field: FieldPath | null };
  images: ContentImage[];
  links: ContentLink[];
  headings: ContentHeading[];
  /** All the page's words in reading order (section fields, then the main text). */
  text: string;
  /** The first real paragraph, where it is stored: what "rewrite the opening" changes. */
  opening: { field: FieldPath | null; value: string } | null;
  words: number;
  /** Section types, in order (for the blocks field). */
  sections: string[];
  /** Every string in the file, with where it is: for placeholders. */
  strings: Array<{ value: string; field: FieldPath | null }>;
  issues: ValidationIssue[];
  /** Questions and answers in a section (for "draft Q&A"): the blocks field and type that hold them. */
  faqBlock: { field: string; type: string; itemKeys: { question: string; answer: string } } | null;
  /** The blocks field, when the collection has one. */
  blocksField: string | null;
}

const NOT_TEXT = /^(type|_type|_component|component|block|template|id|tone|align|alignment|layout|variant|theme|style|class|columns|icon|color|colour|href|url|link|src|image|images|photo|logo|avatar|slug|key|order|weight|draft|noindex|date|lang|locale|width|height|ratio|target|rel|action|method|tag|tags|categories|category|author|authors)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i;
const IMAGE_KEY = /(image|photo|picture|logo|avatar|thumbnail|thumb|cover|poster|icon|src)$/i;
const DESCRIPTION_KEYS = ["description", "summary", "excerpt", "metaDescription", "meta_description", "seoDescription", "seo.description", "meta.description"];
const SHARE_KEYS = ["shareImage", "ogImage", "socialImage", "share_image", "og_image", "seo.image", "meta.image", "image"];
const NOINDEX_KEYS = ["noindex", "noIndex", "no_index", "seo.noindex", "robots", "seo.robots"];
const AUTHOR_KEYS = ["author", "authors", "byline", "by"];

function dotted(key: string): FieldPath {
  return key.split(".");
}

function fieldAt(fields: Field[], path: FieldPath): Field | undefined {
  let list: Field[] | undefined = fields;
  let found: Field | undefined;

  for (const segment of path) {
    if (typeof segment !== "string" || !list) return undefined;
    found = list.find((field) => field.key === segment);
    list = found?.fields;
  }
  return found;
}

function firstField(fields: Field[], keys: string[], accept?: (field: Field) => boolean): FieldPath | null {
  for (const key of keys) {
    const path = dotted(key);
    const field = fieldAt(fields, path);

    if (field && (!accept || accept(field))) return path;
  }
  return null;
}

function stringAt(data: { [key: string]: JsonValue }, path: FieldPath | null): string | null {
  if (!path) return null;
  const value = getIn(data, path);

  return typeof value === "string" ? value : typeof value === "number" ? String(value) : null;
}

function altKeyFor(key: string): string[] {
  const keys = [`${key}Alt`, `${key}_alt`, `${key}AltText`];

  if (/image$/i.test(key) || key === "src" || key === "photo") keys.push("alt", "imageAlt", "altText");
  return keys;
}

/** Fields of one object: the declared ones, for a block its type's, otherwise none known. */
function objectFields(field: Field | undefined, value: { [key: string]: JsonValue }): Field[] {
  if (!field) return [];
  if (field.type === "object") return field.fields ?? [];
  if (field.type === "blocks") {
    const type = value[field.discriminator ?? "type"];

    return field.blocks?.find((block) => block.type === type)?.fields ?? [];
  }
  if (field.type === "list" && field.of) return field.of.type === "object" ? (field.of.fields ?? []) : [];
  return [];
}

interface Walk {
  images: ContentImage[];
  links: ContentLink[];
  headings: ContentHeading[];
  text: Array<{ field: FieldPath | null; value: string }>;
  strings: Array<{ value: string; field: FieldPath | null }>;
}

function markupIn(walk: Walk, text: string, field: FieldPath | null, inBody: boolean): void {
  let fenced = false;
  const lines = text.split("\n");

  for (const line of lines) {
    if (/^\s{0,3}(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);

    if (heading) walk.headings.push({ level: heading[1]!.length, text: plainText(heading[2] ?? ""), inBody, field });
  }
  for (const match of text.matchAll(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?[^)]*\)/g)) walk.images.push({ src: match[2]!, alt: match[1] ?? "", beside: null, field, altField: field, inBody });
  for (const match of text.matchAll(/<img\b([^>]*)>/gi)) {
    const src = /\bsrc=["']([^"']+)["']/i.exec(match[1]!)?.[1];
    const alt = /\balt=["']([^"']*)["']/i.exec(match[1]!);

    if (src) walk.images.push({ src, alt: alt ? alt[1]! : null, beside: null, field, altField: field, inBody });
  }
  for (const match of text.matchAll(/(?<!!)\[([^\]]*)\]\(\s*<?([^)\s>]+)>?[^)]*\)/g)) walk.links.push({ href: match[2]!, text: plainText(match[1] ?? ""), field, inBody, raw: match[0] });
  for (const match of text.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) walk.links.push({ href: match[1]!, text: plainText(match[2] ?? ""), field, inBody, raw: match[0] });
}

function walkValue(walk: Walk, value: JsonValue | undefined, field: Field | undefined, path: FieldPath, parent: { fields: Field[]; value: { [key: string]: JsonValue }; path: FieldPath } | null): void {
  if (value === undefined || value === null) return;
  if (typeof value === "string") {
    walk.strings.push({ value, field: path });
    const key = String(path[path.length - 1] ?? "");
    const type = field?.type;

    if (type === "image" || (type !== "url" && IMAGE_EXT.test(value) && (IMAGE_KEY.test(key) || /^\/|^https?:/.test(value)))) {
      if (!parent) return;
      const altKey = altKeyFor(key).find((candidate) => parent.fields.some((f) => f.key === candidate) || candidate in parent.value);
      const altValue = altKey ? parent.value[altKey] : undefined;
      const widthKey = parent.fields.find((f) => /^(width|imageWidth|w)$/i.test(f.key))?.key;
      const heightKey = parent.fields.find((f) => /^(height|imageHeight|h)$/i.test(f.key))?.key;

      const beside = ["name", "caption", "title", "label", "company"].map((k) => parent.value[k]).find((v): v is string => typeof v === "string" && v.trim() !== "") ?? null;

      walk.images.push({
        src: value,
        alt: typeof altValue === "string" ? altValue : null,
        beside,
        field: path,
        altField: altKey ? [...parent.path, altKey] : null,
        ...(widthKey && heightKey
          ? { sizeFields: { width: [...parent.path, widthKey], height: [...parent.path, heightKey], hasWidth: parent.value[widthKey] !== undefined && parent.value[widthKey] !== "", hasHeight: parent.value[heightKey] !== undefined && parent.value[heightKey] !== "" } }
          : {}),
        inBody: false,
      });
      return;
    }
    if (type === "url" || /^(href|url|link|to|action)$/i.test(key)) {
      if (!parent) return;
      const label = ["label", "text", "title", "name", "cta"].map((k) => parent.value[k]).find((v): v is string => typeof v === "string");

      walk.links.push({ href: value, text: label ? plainText(label) : "", field: path, inBody: false });
      return;
    }
    if (type === "markdown" || type === "text" || /\]\(|<a\s|<img\s/i.test(value)) markupIn(walk, value, path, false);
    if (type === "select" || type === "color" || type === "date" || type === "datetime" || type === "reference" || NOT_TEXT.test(key) || /(^|[a-z_])alt(text)?$/i.test(key)) return;
    if (/^(\/|https?:|#|mailto:|tel:)\S*$/.test(value) || /^#[0-9a-f]{3,8}$/i.test(value)) return;
    const clean = plainText(value);

    if (clean) walk.text.push({ field: path, value: clean });
    if (/^heading$|^title$|^headline$/i.test(key) && path.length > 1) walk.headings.push({ level: 0, text: clean, inBody: false, field: path });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const itemField = field?.type === "list" ? field.of : field?.type === "blocks" ? field : undefined;

      walkValue(walk, item, itemField, [...path, index], parent);
    });
    return;
  }
  if (isObject(value)) {
    const fields = objectFields(field, value);
    const self = { fields, value, path };

    for (const [key, child] of Object.entries(value)) walkValue(walk, child, fields.find((f) => f.key === key), [...path, key], self);
  }
}

function faqBlockOf(collection: Collection): ContentPage["faqBlock"] {
  for (const field of collection.fields) {
    if (field.type !== "blocks") continue;
    for (const block of field.blocks ?? []) {
      const items = block.fields.find((f) => f.type === "list" && f.of?.type === "object");
      const keys = items?.of?.fields?.map((f) => f.key) ?? [];
      const question = keys.find((k) => /^(question|q|title)$/i.test(k));
      const answer = keys.find((k) => /^(answer|a|text|body)$/i.test(k));

      if (items && question && answer && /faq|question/i.test(`${block.type} ${block.label}`)) return { field: field.key, type: block.type, itemKeys: { question, answer } };
    }
  }
  return null;
}

export function readContentPage(entry: Entry, collection: Collection): ContentPage {
  const fields = collection.fields.length ? collection.fields : entry.fields;
  const titleKey = collection.titleField ?? (fieldAt(fields, ["title"]) ? "title" : null);
  const titlePath = titleKey ? dotted(titleKey) : null;
  const titleValue = stringAt(entry.data, titlePath);
  const descriptionField = firstField(fields, DESCRIPTION_KEYS, (field) => ["string", "text", "markdown"].includes(field.type));
  const descriptionValue = stringAt(entry.data, descriptionField);
  // The post's own image field is its share image on most sites; pages name one explicitly.
  const shareField = firstField(fields, collection.imageField ? [...SHARE_KEYS.slice(0, -1), collection.imageField] : SHARE_KEYS, (field) => field.type === "image" || field.type === "string");
  const shareValue = stringAt(entry.data, shareField);
  const noindexField = firstField(fields, NOINDEX_KEYS) ?? (NOINDEX_KEYS.find((key) => getIn(entry.data, dotted(key)) !== undefined) ? dotted(NOINDEX_KEYS.find((key) => getIn(entry.data, dotted(key)) !== undefined)!) : null);
  const noindexRaw = noindexField ? getIn(entry.data, noindexField) : undefined;
  const noindex = noindexRaw === true || (typeof noindexRaw === "string" && /noindex/i.test(noindexRaw));
  const draftRaw = collection.draftField ? entry.data[collection.draftField] : entry.data.draft;
  const dateField = collection.dateField ? dotted(collection.dateField) : null;
  const authorField = firstField(fields, AUTHOR_KEYS);
  const walk: Walk = { images: [], links: [], headings: [], text: [], strings: [] };
  const blocksField = collection.fields.find((field) => field.type === "blocks")?.key ?? null;

  for (const [key, value] of Object.entries(entry.data)) {
    if (titlePath && titlePath.length === 1 && titlePath[0] === key) continue;
    if (descriptionField && descriptionField.length === 1 && descriptionField[0] === key) {
      if (typeof value === "string") walk.strings.push({ value, field: [key] });
      continue;
    }
    walkValue(walk, value, fields.find((field) => field.key === key), [key], { fields, value: entry.data, path: [] });
  }
  if (titleValue) walk.strings.push({ value: titleValue, field: titlePath });
  if (entry.body) {
    walk.strings.push({ value: entry.body, field: null });
    markupIn(walk, entry.body, null, true);
    const clean = plainText(entry.body);

    if (clean) walk.text.push({ field: null, value: clean });
  }
  const text = collapse(walk.text.map((item) => item.value).join(" "));
  const openingText = walk.text.find((item) => item.field !== null && !/heading|title|eyebrow|label|name/i.test(String(item.field[item.field.length - 1])) && wordCount(item.value) >= 8);
  const firstParagraph = entry.body?.split(/\n\s*\n/).map((part) => part.trim()).find((part) => !/^(#|!\[|<|import |export |[-*+] |\d+\. |>)/.test(part) && wordCount(plainText(part)) >= 8);
  const opening = openingText
    ? { field: openingText.field, value: stringAt(entry.data, openingText.field) ?? openingText.value }
    : firstParagraph
      ? { field: null, value: firstParagraph }
      : null;
  const label = (path: FieldPath | null) => (path ? labelForFieldPath(collection, entry.data, path) : "Main text");
  const sections = blocksField && Array.isArray(entry.data[blocksField]) ? (entry.data[blocksField] as JsonValue[]).map((item) => (isObject(item) ? String(item[collection.fields.find((f) => f.key === blocksField)?.discriminator ?? "type"] ?? "") : "")) : [];

  return {
    path: entry.path,
    hash: entry.hash,
    collection: collection.id,
    collectionLabel: collection.singular,
    isPage: collection.kind === "entries" && entry.url !== null,
    url: entry.url,
    title: titleValue !== null ? { value: titleValue, field: titlePath, label: label(titlePath) } : entry.titleSource === "heading" ? { value: entry.title, field: null, label: "Main heading" } : null,
    titleFieldExists: titlePath !== null,
    description: descriptionValue !== null ? { value: descriptionValue, field: descriptionField, label: label(descriptionField) } : null,
    descriptionField,
    shareImage: shareValue ? { value: shareValue, field: shareField, label: label(shareField) } : null,
    shareImageField: shareField,
    noindex: { value: noindex, field: noindexField },
    draft: draftRaw === true,
    date: { value: stringAt(entry.data, dateField), field: dateField && fieldAt(fields, dateField) ? dateField : null },
    author: { value: stringAt(entry.data, authorField), field: authorField },
    images: walk.images,
    links: walk.links,
    headings: walk.headings,
    text,
    opening,
    words: wordCount(text),
    sections,
    strings: walk.strings,
    issues: entry.issues.filter((issue) => issue.code === "broken-link" || issue.code === "broken-image"),
    faqBlock: faqBlockOf(collection),
    blocksField,
  };
}

export function fieldLabel(collection: Collection | null, data: { [key: string]: JsonValue }, path: FieldPath | null): string {
  return path ? labelForFieldPath(collection, data, path) : "Main text";
}
