/**
 * Reading entry files with a parse cache. Listing a 1,000-file collection
 * must not parse 1,000 documents every time, so parsed results are kept by
 * absolute path and reused while the file's mtime and size are unchanged.
 */
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { glob } from "tinyglobby";

import type { Collection, EntryFormat, JsonValue, SiteModel } from "../../types";
import type { ParsedDocument } from "../model";
import { enumerateBodyBlocks } from "../document/body-blocks";
import { formatForPath, parseDocument } from "../document/parse";
import { collectionForPath, normalizePath, patternOf } from "./paths";

/** Directories never scanned for content. */
export const IGNORED_DIRS = ["**/node_modules/**", "**/.git/**", "**/.astro/**", "**/dist/**", "**/.next/**", "**/.nuxt/**", "**/.output/**", "**/_site/**"];

export function absolute(root: string, path: string): string {
  return join(root, ...normalizePath(path).split("/"));
}

/** Every file a collection owns (sorted), excluding files a more specific collection claims. */
export async function listCollectionFiles(root: string, model: Pick<SiteModel, "collections" | "templates">, collection: Collection): Promise<string[]> {
  const base = normalizePath(collection.path);

  // A data collection is one file, named by the settings: it is the collection's only when a path is (see collectionForPath).
  if (collection.kind === "data") return existsSync(absolute(root, base)) && collectionForPath(model, base)?.id === collection.id ? [base] : [];
  const cwd = base === "" || base === "." ? root : absolute(root, base);

  if (!existsSync(cwd)) return [];
  const found = await glob(patternOf(collection), { cwd, onlyFiles: true, ignore: IGNORED_DIRS, expandDirectories: false });

  return found
    .map((file) => (base === "" || base === "." ? normalizePath(file) : `${base}/${normalizePath(file)}`))
    .filter((path) => formatForPath(path) !== null && collectionForPath(model, path)?.id === collection.id)
    .sort((a, b) => a.localeCompare(b));
}

export interface CachedDocument {
  mtimeMs: number;
  size: number;
  format: EntryFormat;
  data: { [key: string]: JsonValue };
  errors: string[];
  /** Text of the first heading in the body, for entries without a title field. */
  heading: string | null;
  rootList: boolean;
}

const CACHE_LIMIT = 50_000;
const cache = new Map<string, CachedDocument>();

export function firstHeading(parsed: ParsedDocument): string | null {
  if (!parsed.body) return null;
  // Cheap pre-check: most bodies have a heading near the top or none at all.
  if (!/^ {0,3}#{1,6}[ \t]|\n(=+|-+)[ \t]*(\r?\n|$)/m.test(parsed.body)) return null;
  const heading = enumerateBodyBlocks(parsed.body).find((block) => block.kind === "heading" && block.text !== "");

  return heading ? heading.text : null;
}

function remember(key: string, value: CachedDocument): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;

    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

export function summarizeParsed(parsed: ParsedDocument, format: EntryFormat, mtimeMs: number, size: number): CachedDocument {
  return { mtimeMs, size, format, data: parsed.data, errors: parsed.errors, heading: firstHeading(parsed), rootList: parsed.rootList === true };
}

/** Parsed data for a file, from the cache when the file has not changed. */
export async function readCached(root: string, path: string, format: EntryFormat): Promise<CachedDocument | null> {
  const file = absolute(root, path);
  let info;

  try {
    info = await stat(file);
  } catch {
    cache.delete(file);
    return null;
  }
  const hit = cache.get(file);

  if (hit && hit.mtimeMs === info.mtimeMs && hit.size === info.size && hit.format === format) return hit;
  const raw = await readFile(file, "utf8");
  const parsed = parseDocument(raw, format);
  const entry = summarizeParsed(parsed, format, info.mtimeMs, info.size);

  remember(file, entry);
  return entry;
}

/** Records text the caller already holds (after a write) so the next listing skips the parse. */
export function primeCache(root: string, path: string, raw: string, format: EntryFormat, mtimeMs: number, size: number): void {
  remember(absolute(root, path), summarizeParsed(parseDocument(raw, format), format, mtimeMs, size));
}
