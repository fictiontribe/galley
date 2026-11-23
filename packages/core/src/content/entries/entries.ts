/**
 * Entries: listing a collection and reading one item, shaped for the UI and
 * the assistant. Listing reads through the parse cache in files.ts.
 */
import { readFile, stat } from "node:fs/promises";

import { GalleyError } from "../../errors";
import type { ChangeStatus, Collection, Entry, EntryList, EntryQuery, EntrySummary, Field, JsonValue, SiteModel } from "../../types";
import type { ValidationContext } from "../model";
import { formatForPath, parseDocument } from "../document/parse";
import { inferField } from "../schema/infer";
import { hashContent, isObject } from "../util/json";
import { labelForKey, titleFromFilename } from "../util/text";
import { validateEntry } from "../validate/validate";
import { absolute, firstHeading, listCollectionFiles, readCached } from "./files";
import { collectionForPath, entryUrl, normalizePath, slugForPath } from "./paths";

function stringAt(data: { [key: string]: JsonValue }, key: string | undefined): string | undefined {
  if (!key) return undefined;
  const value = data[key];

  if (typeof value === "string" && value.trim() !== "") return value;
  if (typeof value === "number") return String(value);
  // Image fields are sometimes objects: { src, alt } / { source, alt } / { url }.
  if (isObject(value)) {
    for (const inner of ["src", "source", "url", "path"]) {
      if (typeof value[inner] === "string" && value[inner] !== "") return value[inner] as string;
    }
  }
  return undefined;
}

/** The title of an entry in another collection, by its slug — how a reference is shown. */
export type TitleLookup = (collectionId: string, slug: string) => string | null | undefined;

const AUTHOR_KEYS = ["author", "authors", "byline"];

/** A name from a value: the string itself, the first string of a list, or an object's name/title. */
function nameIn(value: JsonValue | undefined): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const name = nameIn(item);

      if (name) return name;
    }
    return undefined;
  }
  if (isObject(value)) {
    for (const key of ["name", "title", "id", "slug"]) if (typeof value[key] === "string" && value[key].trim() !== "") return (value[key] as string).trim();
  }
  return undefined;
}

/**
 * Who wrote an entry, from an author-like field (`author`, `authors` or
 * `byline`; the first one of a list). When that field references another
 * collection (Astro's `reference("team")`), the referenced entry's title is
 * shown rather than its slug.
 */
export function authorOf(collection: Collection, data: { [key: string]: JsonValue }, lookup?: TitleLookup): string | undefined {
  const key = Object.keys(data).find((candidate) => AUTHOR_KEYS.includes(candidate.toLowerCase()));

  if (!key) return undefined;
  const value = nameIn(data[key]);

  if (!value) return undefined;
  const field = collection.fields.find((candidate) => candidate.key === key);
  const target = field?.type === "reference" ? field.collection : field?.type === "list" && field.of?.type === "reference" ? field.of.collection : undefined;

  return (target && lookup?.(target, value)) || value;
}

/**
 * The records of a data file by id, with the name each shows: a list of
 * `{ id, name }` objects (Astro's `file()` loader) or an object keyed by id.
 */
export function dataItemTitles(data: { [key: string]: JsonValue }): Map<string, string> {
  const out = new Map<string, string>();
  const name = (item: JsonValue): string | undefined => {
    if (!isObject(item)) return undefined;
    for (const key of ["name", "title", "label"]) if (typeof item[key] === "string" && item[key].trim() !== "") return (item[key] as string).trim();
    return undefined;
  };

  if (Array.isArray(data.items)) {
    for (const item of data.items) {
      const id = isObject(item) ? (item.id ?? item.slug) : undefined;
      const shown = name(item);

      if (typeof id === "string" && shown) out.set(id, shown);
    }
  } else {
    for (const [id, item] of Object.entries(data)) {
      const shown = name(item);

      if (shown) out.set(id, shown);
    }
  }
  return out;
}

/** Collections that an author-like field of `collection` points into. */
export function authorReferences(collection: Collection): string[] {
  return collection.fields
    .filter((field) => AUTHOR_KEYS.includes(field.key.toLowerCase()))
    .map((field) => (field.type === "reference" ? field.collection : field.type === "list" && field.of?.type === "reference" ? field.of.collection : undefined))
    .filter((id): id is string => typeof id === "string");
}

export function formatOf(collection: Collection, path: string): Collection["format"] {
  return formatForPath(path) ?? collection.format;
}

/** The list-view shape of an entry, from data the caller already parsed. */
export function summarize(
  model: SiteModel,
  collection: Collection,
  path: string,
  data: { [key: string]: JsonValue },
  heading: string | null,
  modifiedAt: number,
  status: ChangeStatus,
  lookup?: TitleLookup
): EntrySummary {
  const slug = slugForPath(collection, path);
  const fieldTitle = stringAt(data, collection.titleField);
  const name = normalizePath(path).split("/");
  const fileName = name[name.length - 1] ?? path;
  const fromFile = /^_?index\./.test(fileName) && name.length > 1 ? (name[name.length - 2] ?? fileName) : fileName;
  let title: string;
  let titleSource: EntrySummary["titleSource"];

  if (fieldTitle) {
    title = fieldTitle;
    titleSource = "field";
  } else if (heading) {
    title = heading;
    titleSource = "heading";
  } else {
    title = collection.kind === "data" ? collection.label : slug === "index" ? "Home" : titleFromFilename(fromFile);
    titleSource = "filename";
  }
  const permalink = typeof data.permalink === "string" && data.permalink.startsWith("/") ? data.permalink : null;
  const slugOverride = typeof data.slug === "string" && data.slug.trim() !== "" ? data.slug.trim() : null;
  const summary: EntrySummary = {
    path: normalizePath(path),
    collection: collection.id,
    slug,
    title,
    titleSource,
    url: collection.url === null ? null : (permalink ?? entryUrl(model, collection, slugOverride ?? slug)),
    status,
    modifiedAt,
  };
  const date = stringAt(data, collection.dateField);
  const image = stringAt(data, collection.imageField);
  const draft = collection.draftField ? data[collection.draftField] : undefined;
  const author = authorOf(collection, data, lookup);

  if (date) summary.date = date;
  if (author) summary.author = author;
  if (image) summary.image = image;
  if (typeof draft === "boolean") summary.draft = draft;
  return summary;
}

/** The collection's fields plus any keys this entry carries that the schema lacks. */
export function fieldsForEntry(collection: Collection, data: { [key: string]: JsonValue }): Field[] {
  const extras = Object.keys(data)
    .filter((key) => !collection.fields.some((field) => field.key === key))
    .map((key) => ({ ...inferField(key, [data[key]!], 1), required: false }));

  return [...collection.fields, ...extras];
}

const PERMISSIVE: ValidationContext = { mediaExists: () => true, routeExists: () => true };

export function buildEntry(
  model: SiteModel,
  path: string,
  raw: string,
  stat_: { mtimeMs: number },
  status: ChangeStatus = "clean",
  ctx?: ValidationContext,
  lookup?: TitleLookup
): Entry {
  const collection = collectionForPath(model, path);

  if (!collection) throw new GalleyError("not-found", "This file isn't part of any collection, so it can't be opened as content.", path);
  const format = formatOf(collection, path);
  const parsed = parseDocument(raw, format);
  const summary = summarize(model, collection, path, parsed.data, firstHeading(parsed), stat_.mtimeMs, status, lookup);
  const entry: Entry = {
    ...summary,
    format,
    data: parsed.data,
    body: parsed.body,
    raw,
    hash: hashContent(raw),
    fields: fieldsForEntry(collection, parsed.data),
    issues: parsed.errors.map((message) => ({ severity: "error" as const, code: "parse", message, path: summary.path })),
  };

  if (parsed.errors.length === 0) entry.issues.push(...validateEntry(model, entry, ctx ?? PERMISSIVE));
  return entry;
}

export async function readEntry(
  root: string,
  model: SiteModel,
  path: string,
  statusOf?: (path: string) => ChangeStatus,
  ctx?: ValidationContext
): Promise<Entry> {
  const normalized = normalizePath(path);
  let raw: string;
  let info;

  try {
    [raw, info] = await Promise.all([readFile(absolute(root, normalized), "utf8"), stat(absolute(root, normalized))]);
  } catch {
    throw new GalleyError("not-found", "This item no longer exists. It may have been moved or deleted.", normalized);
  }
  return buildEntry(model, normalized, raw, info, statusOf?.(normalized) ?? "clean", ctx);
}

/** Titles of the entries in `collectionIds`, by slug — read through the parse cache. */
async function referencedTitles(root: string, model: SiteModel, collectionIds: string[]): Promise<TitleLookup | undefined> {
  if (collectionIds.length === 0) return undefined;
  const titles = new Map<string, string>();

  for (const id of new Set(collectionIds)) {
    const target = model.collections.find((candidate) => candidate.id === id);

    if (!target) continue;
    if (target.kind === "data") {
      const doc = await readCached(root, target.path, target.format);

      for (const [slug, title] of doc ? dataItemTitles(doc.data) : []) titles.set(`${id}/${slug}`, title);
      continue;
    }
    for (const path of await listCollectionFiles(root, model, target)) {
      const doc = await readCached(root, path, formatOf(target, path));

      if (doc) titles.set(`${id}/${slugForPath(target, path)}`, summarize(model, target, path, doc.data, doc.heading, doc.mtimeMs, "clean").title);
    }
  }
  return (collectionId, slug) => titles.get(`${collectionId}/${slug}`);
}

function compare(a: EntrySummary, b: EntrySummary, sort: NonNullable<EntryQuery["sort"]>): number {
  if (sort === "date") return (a.date ?? "").localeCompare(b.date ?? "") || a.title.localeCompare(b.title);
  if (sort === "modified") return a.modifiedAt - b.modifiedAt || a.title.localeCompare(b.title);
  return a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }) || a.path.localeCompare(b.path);
}

export async function listEntries(
  root: string,
  model: SiteModel,
  collectionId: string,
  query: EntryQuery = {},
  statusOf?: (path: string) => ChangeStatus,
  lookup?: TitleLookup
): Promise<EntryList> {
  const collection = model.collections.find((candidate) => candidate.id === collectionId);

  if (!collection) throw new GalleyError("not-found", `There is no “${labelForKey(collectionId)}” collection on this site.`, collectionId);
  const files = await listCollectionFiles(root, model, collection);
  const titles = lookup ?? (await referencedTitles(root, model, authorReferences(collection)));
  const summaries = (
    await Promise.all(
      files.map(async (path) => {
        const doc = await readCached(root, path, formatOf(collection, path));

        return doc ? summarize(model, collection, path, doc.data, doc.heading, doc.mtimeMs, statusOf?.(path) ?? "clean", titles) : null;
      })
    )
  ).filter((summary): summary is EntrySummary => summary !== null);
  const needle = query.search?.trim().toLowerCase();
  const filtered = summaries.filter(
    (summary) =>
      (!needle || summary.title.toLowerCase().includes(needle) || summary.slug.toLowerCase().includes(needle) || summary.path.toLowerCase().includes(needle)) &&
      (!query.status || summary.status === query.status)
  );
  const sort = query.sort ?? (collection.dateField ? "date" : "title");
  const order = query.order ?? (sort === "title" ? "asc" : "desc");

  filtered.sort((a, b) => (order === "asc" ? compare(a, b, sort) : -compare(a, b, sort)));
  const offset = Math.max(0, query.offset ?? 0);
  const items = query.limit === undefined ? filtered.slice(offset) : filtered.slice(offset, offset + Math.max(0, query.limit));

  return { collection: collection.id, total: filtered.length, items };
}
