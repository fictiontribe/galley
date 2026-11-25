/**
 * The content index: every editable string in the site in memory, for
 * search, click-to-edit resolution and URL ⇄ entry lookups.
 *
 * Body locations carry offsets relative to the entry's body (the same frame
 * as enumerateBodyBlocks); field locations carry the FieldPath; source
 * locations carry a 1-based line and column.
 */
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";

import picomatch from "picomatch";
import { glob } from "tinyglobby";

import type { AgentMode, Collection, EntrySummary, ResolveRequest, ResolveResult, SearchHit, SiteModel, SourceMatch } from "../../types";
import type { ContentIndex, ResolveOptions, SearchOptions } from "../model";
import { scanRoutes, type RouteFile } from "../detect/routes";
import { parseDocument } from "../document/parse";
import { absolute, firstHeading, IGNORED_DIRS, listCollectionFiles } from "../entries/files";
import { authorReferences, dataItemTitles, formatOf, summarize } from "../entries/entries";
import { collectionForPath, normalizePath, urlKey } from "../entries/paths";
import { collapseWhitespace, matchKey, truncate } from "../util/text";
import { bodyStrings, fieldStrings, SOURCE_PATTERN, sourceStrings, type IndexedString } from "./strings";
import { shownWhereTheyAre } from "../../workspace/paths";

interface FileRecord {
  path: string;
  collection: Collection | null;
  summary: EntrySummary | null;
  strings: IndexedString[];
  /** Data files: the name of each record by id, for references into it. */
  records?: Map<string, string>;
}

/** Above this many places, a string is too common to point at one of them. */
const TOO_COMMON = 50;
const MAX_LISTED = 20;
const MAX_SOURCE_BYTES = 300_000;

function excerpt(text: string, needle: string): string {
  const visible = collapseWhitespace(text);
  const at = visible.toLowerCase().indexOf(needle.toLowerCase());

  if (at === -1) return truncate(visible, 160);
  const from = Math.max(0, at - 60);
  const to = Math.min(visible.length, at + needle.length + 60);

  return `${from > 0 ? "…" : ""}${visible.slice(from, to)}${to < visible.length ? "…" : ""}`;
}

class Index implements ContentIndex {
  private readonly files = new Map<string, FileRecord>();
  private readonly urls = new Map<string, EntrySummary>();
  private byKey: Map<string, IndexedString[]> | null = null;
  private byFolded: Map<string, IndexedString[]> | null = null;
  private readonly isSource: (path: string) => boolean;
  private readonly collectionRoutes: RouteFile[];
  private readonly openRoutes: RouteFile[];

  constructor(
    private readonly root: string,
    private readonly model: SiteModel,
    routes: RouteFile[]
  ) {
    this.isSource = picomatch(SOURCE_PATTERN, { dot: false });
    const contentIds = new Set(model.collections.map((collection) => collection.id));

    // Dynamic routes that render a collection serve exactly that collection's
    // entries; other dynamic routes may serve anything, so they always match.
    this.collectionRoutes = routes.filter((route) => route.dynamic && route.collections.some((id) => contentIds.has(id)));
    this.openRoutes = routes.filter((route) => !this.collectionRoutes.includes(route));
  }

  get size(): number {
    return this.files.size;
  }

  private invalidate(): void {
    this.byKey = null;
    this.byFolded = null;
  }

  private remove(path: string): void {
    const record = this.files.get(path);

    if (record?.summary?.url) {
      const key = urlKey(record.summary.url);

      if (this.urls.get(key)?.path === path) this.urls.delete(key);
    }
    this.files.delete(path);
    this.invalidate();
  }

  indexEntry(path: string, raw: string, collection: Collection, modifiedAt: number): void {
    const format = formatOf(collection, path);
    const parsed = parseDocument(raw, format);
    const summary = summarize(this.model, collection, path, parsed.data, firstHeading(parsed), modifiedAt, "clean", (id, slug) => this.titleOf(id, slug));
    const strings = fieldStrings(path, collection, parsed.data);

    if (parsed.body !== null) strings.push(...bodyStrings(path, parsed.body, strings.length));
    this.remove(path);
    this.files.set(path, { path, collection, summary, strings, ...(collection.kind === "data" ? { records: dataItemTitles(parsed.data) } : {}) });
    if (summary.url) this.urls.set(urlKey(summary.url), summary);
  }

  indexSource(path: string, raw: string): void {
    this.remove(path);
    this.files.set(path, { path, collection: null, summary: null, strings: sourceStrings(path, raw) });
  }

  update(path: string, raw: string | null): void {
    const normalized = normalizePath(path);

    if (raw === null) {
      this.remove(normalized);
      return;
    }
    const collection = collectionForPath(this.model, normalized);

    if (collection) this.indexEntry(normalized, raw, collection, Date.now());
    else if (this.isSource(normalized)) this.indexSource(normalized, raw);
  }

  private keyed(folded: boolean): Map<string, IndexedString[]> {
    const cached = folded ? this.byFolded : this.byKey;

    if (cached) return cached;
    const map = new Map<string, IndexedString[]>();

    for (const record of this.files.values()) {
      for (const string of record.strings) {
        const key = folded ? string.key.toLowerCase() : string.key;
        const list = map.get(key);

        if (list) list.push(string);
        else map.set(key, [string]);
      }
    }
    if (folded) this.byFolded = map;
    else this.byKey = map;
    return map;
  }

  entryForUrl(urlPath: string): EntrySummary | null {
    return this.urls.get(urlKey(urlPath)) ?? null;
  }

  titleOf(collectionId: string, slug: string): string | null {
    for (const record of this.files.values()) {
      if (record.collection?.id !== collectionId) continue;
      if (record.records) {
        const title = record.records.get(slug);

        if (title) return title;
      } else if (record.summary?.slug === slug) return record.summary.title;
    }
    return null;
  }

  routeExists(urlPath: string): boolean {
    const key = urlKey(urlPath);

    if (this.urls.has(key)) return true;
    if (this.openRoutes.some((route) => route.test.test(key))) return true;
    // Files served as they are (PDFs, images, robots.txt) from the media roots.
    for (const rootDir of this.model.media.roots) {
      const prefix = rootDir.publicPath.replace(/\/$/, "");

      if (prefix !== "" && !key.startsWith(`${prefix.toLowerCase()}/`)) continue;
      const rest = urlPath.split(/[?#]/)[0]!.slice(prefix.length).replace(/^\/+/, "");

      if (rest !== "" && existsSync(absolute(this.root, `${rootDir.dir}/${rest}`))) return true;
    }
    return false;
  }

  search(query: string, options: SearchOptions = {}): SearchHit[] {
    const needle = matchKey(query).toLowerCase();

    if (needle.length < 2) return [];
    const tokens = needle.split(" ").filter(Boolean);
    const scored: Array<{ hit: SearchHit; score: number }> = [];

    for (const record of this.files.values()) {
      if (!record.summary || !record.collection) continue;
      if (options.collection && record.collection.id !== options.collection) continue;
      let perFile = 0;
      const title = record.summary.title.toLowerCase();

      for (const string of record.strings) {
        if (string.fragment) continue;
        const haystack = string.key.toLowerCase();
        let score = 0;

        if (haystack === needle) score = 120;
        else if (haystack.includes(needle)) score = 90;
        else if (tokens.length > 1 && tokens.every((token) => haystack.includes(token))) score = 50;
        else continue;
        if (title.includes(needle)) score += 15;
        if (string.kind === "field" && string.location.kind === "field" && string.location.field.length === 1) score += 5;
        // Denser matches first: the word as most of a short title beats it buried in a paragraph.
        score += (10 * needle.length) / Math.max(haystack.length, needle.length);
        score -= Math.min(20, Math.floor(haystack.length / 200));
        scored.push({
          score,
          hit: {
            path: record.path,
            collection: record.collection.id,
            title: record.summary.title,
            url: record.summary.url,
            location: string.location,
            excerpt: excerpt(string.value, query.trim()),
          },
        });
        perFile += 1;
        if (perFile >= 3) break;
      }
    }
    return scored
      .sort((a, b) => b.score - a.score || a.hit.title.localeCompare(b.hit.title))
      .slice(0, options.limit ?? 20)
      .map((entry) => entry.hit);
  }

  private toMatch(string: IndexedString, text: string, mode: AgentMode | undefined, folded: boolean): SourceMatch {
    const record = this.files.get(string.path);
    const match: SourceMatch = {
      path: string.path,
      location: string.location,
      value: string.value,
      plain: !folded && !string.fragment && !string.locked && collapseWhitespace(string.value) === text,
      editable: string.kind === "source" ? mode === "build" : true,
    };

    if (record?.collection) match.collection = record.collection.id;
    if (record?.summary) match.title = record.summary.title;
    return match;
  }

  /** One candidate per place: a value and its paragraph fragments are the same place. */
  private distinct(strings: IndexedString[]): IndexedString[] {
    const seen = new Map<string, IndexedString>();

    for (const string of strings) {
      const existing = seen.get(string.place);

      if (!existing || (existing.fragment && !string.fragment)) seen.set(string.place, string);
    }
    return [...seen.values()].sort((a, b) => (a.path === b.path ? a.order - b.order : a.path.localeCompare(b.path)));
  }

  resolve(request: ResolveRequest, options: ResolveOptions = {}): ResolveResult {
    const text = collapseWhitespace(request.text ?? "");
    const key = matchKey(text);

    if (key.length < 2) return { status: "none", matches: [], reason: "The selected text is too short to find reliably." };
    if (!/[\p{L}\p{N}]/u.test(key)) return { status: "none", matches: [], reason: "The selected text has no words to look for." };
    // An empty path means "no page given", not the home page (which is "/").
    const page = typeof request.urlPath === "string" && request.urlPath.trim() !== "" ? this.entryForUrl(request.urlPath) : null;

    for (const folded of [false, true]) {
      const candidates = this.keyed(folded).get(folded ? key.toLowerCase() : key) ?? [];

      if (candidates.length === 0) continue;
      const toMatch = (string: IndexedString) => this.toMatch(string, text, options.mode, folded);
      const onPage = page ? this.distinct(candidates.filter((string) => string.path === page.path)) : [];
      const elsewhere = this.distinct(candidates.filter((string) => !page || string.path !== page.path));
      const total = request.total;
      const occurrence = request.occurrence;

      if (onPage.length > 0) {
        if (onPage.length === 1 && (total === undefined || total <= 1)) return { status: "unique", matches: [toMatch(onPage[0]!)] };
        if (total !== undefined && total > 1 && onPage.length === total && occurrence !== undefined && occurrence >= 0 && occurrence < total) {
          // Same text several times on the page, and the page's own entry holds
          // it exactly that many times: document order maps one-to-one.
          return { status: "unique", matches: [toMatch(onPage[occurrence]!)] };
        }
        const listed = [...onPage, ...(onPage.length === 1 ? elsewhere : [])].slice(0, MAX_LISTED);

        return {
          status: "ambiguous",
          matches: listed.map(toMatch),
          reason:
            total !== undefined && total !== onPage.length
              ? `The page shows this text ${total} times, but its content holds it ${onPage.length === 1 ? "once" : `${onPage.length} times`}. Choose the one you meant.`
              : `This text appears ${onPage.length} times on this page. Choose the one you meant.`,
        };
      }
      if (elsewhere.length === 1) return { status: "unique", matches: [toMatch(elsewhere[0]!)] };
      if (elsewhere.length > TOO_COMMON) {
        return { status: "none", matches: [], reason: `This text appears in ${elsewhere.length} places, which is too many to tell which one this is.` };
      }
      return { status: "ambiguous", matches: elsewhere.slice(0, MAX_LISTED).map(toMatch), reason: `This text appears in ${elsewhere.length} places. Choose the one you meant.` };
    }
    return { status: "none", matches: [], reason: "This text isn't in any content file. It may be written into the site's code or produced by it." };
  }
}

async function readAll(root: string, paths: string[], handle: (path: string, raw: string, mtimeMs: number) => void): Promise<void> {
  const batch = 64;
  // Resolve each file at the read, not only when it was listed: a path that is a link out of the site, or reaches a
  // secrets file or .git, is not indexed even if it reached here unfiltered or was swapped since the listing.
  const shown = shownWhereTheyAre(root);

  for (let start = 0; start < paths.length; start += batch) {
    await Promise.all(
      paths.slice(start, start + batch).map(async (path) => {
        if (!shown(path)) return;
        try {
          const file = absolute(root, path);
          const info = statSync(file);

          if (info.size > MAX_SOURCE_BYTES * 20) return;
          handle(path, await readFile(file, "utf8"), info.mtimeMs);
        } catch {
          // A file that vanished between listing and reading is simply not indexed.
        }
      })
    );
  }
}

export async function buildContentIndex(root: string, model: SiteModel): Promise<ContentIndex> {
  // Where the site's code-written pages live is the adapter's to say (Astro's
  // `<srcDir>/pages`); a site whose adapter names none has no such routes.
  const index = new Index(root, model, model.routesDir ? scanRoutes(root, model.routesDir) : []);

  // Collections other entries name as their author go first, so those names are known when the entries are read.
  const referenced = new Set(model.collections.flatMap(authorReferences));
  const ordered = [...model.collections].sort((a, b) => Number(referenced.has(b.id)) - Number(referenced.has(a.id)));

  for (const collection of ordered) {
    const files = await listCollectionFiles(root, model, collection);

    await readAll(root, files, (path, raw, mtimeMs) => index.indexEntry(path, raw, collection, mtimeMs));
  }
  const contentDirs = model.collections.filter((collection) => collection.kind === "entries" && collection.path !== ".").map((collection) => `${normalizePath(collection.path)}/**`);
  const publicDirs = model.media.roots.map((rootDir) => `${normalizePath(rootDir.dir)}/**`);
  // The site's own build output, wherever its adapter or config puts it, holds copies of the templates' text.
  const outDir = model.build?.outDir ? normalizePath(model.build.outDir) : "";
  const buildDirs = outDir && outDir !== "." ? [`${outDir}/**`] : [];
  const shown = shownWhereTheyAre(root);
  const sources = (await glob(SOURCE_PATTERN, { cwd: root, onlyFiles: true, ignore: [...IGNORED_DIRS, "**/build/**", "**/out/**", "**/coverage/**", ...buildDirs, ...contentDirs, ...publicDirs], expandDirectories: false }))
    .map(normalizePath)
    // Read here, not through the site's own read: a template that is a link is the site's only where it really leads.
    .filter((path) => !collectionForPath(model, path) && shown(path))
    .sort();

  await readAll(root, sources, (path, raw) => {
    if (raw.length <= MAX_SOURCE_BYTES) index.indexSource(path, raw);
  });
  return index;
}
