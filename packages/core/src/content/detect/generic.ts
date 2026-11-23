/**
 * Collection discovery by looking at folders: any directory holding at least
 * two markdown files with front matter is a collection. Used for every
 * framework without a content config, and as Astro's fallback.
 */
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";

import type { Collection, EntryFormat } from "../../types";
import { formatForPath } from "../document/parse";
import { absolute } from "../entries/files";
import { normalizePath } from "../entries/paths";
import { collectionNames } from "../util/text";

/** Folders that hold code, build output or tooling — never content. */
const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", "out", "_site", ".next", ".nuxt", ".output", ".astro", ".cache", ".vercel", ".netlify",
  "vendor", "coverage", "layouts", "_layouts", "_includes", "includes", "partials", "components", "assets", "styles",
  "scripts", "static", "public", "themes", "archetypes", "resources", "i18n", "test", "tests", "__tests__", "src/pages",
]);

const MAX_DEPTH = 5;
/** Data files bigger than this are lookup tables (redirects, exports), not something to edit in a form. */
export const MAX_DATA_FILE_BYTES = 1_000_000;

function hasFrontMatter(file: string): boolean {
  let fd: number | null = null;

  try {
    fd = openSync(file, "r");
    const buffer = Buffer.alloc(8);
    const read = readSync(fd, buffer, 0, 8, 0);
    const head = buffer.subarray(0, read).toString("utf8").replace(/^﻿/, "");

    return head.startsWith("---") || head.startsWith("+++") || head.startsWith("{");
  } catch {
    return false;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

interface Candidate {
  dir: string;
  markdown: number;
  mdx: number;
}

function scan(root: string, dir: string, depth: number, out: Candidate[]): void {
  if (depth > MAX_DEPTH) return;
  let entries;

  try {
    entries = readdirSync(absolute(root, dir || "."), { withFileTypes: true });
  } catch {
    return;
  }
  let markdown = 0;
  let mdx = 0;

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const path = dir ? `${dir}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || SKIP_DIRS.has(path)) continue;
      scan(root, path, depth + 1, out);
      continue;
    }
    const format = formatForPath(entry.name);

    if ((format === "markdown" || format === "mdx") && !/^(readme|license|changelog|contributing|code_of_conduct|agents|claude)\./i.test(entry.name) && hasFrontMatter(absolute(root, path))) {
      if (format === "mdx") mdx += 1;
      else markdown += 1;
    }
  }
  if (markdown + mdx >= 2) out.push({ dir, markdown, mdx });
}

export interface GenericOptions {
  /** Folders to scan; "" or "." is the repo root. */
  roots: string[];
  /** Folders whose own files are the site's top-level pages (id "pages"). */
  pageRoots: string[];
  /** URL for a collection at a folder, or null when the site has no pages for it. */
  urlFor(dir: string, isPages: boolean): string | null;
  /** Folders already claimed by another adapter. */
  claimed?: string[];
}

export function discoverMarkdownCollections(root: string, options: GenericOptions): Collection[] {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  for (const start of options.roots) {
    const dir = normalizePath(start === "." ? "" : start);

    if (dir !== "" && !existsSync(absolute(root, dir))) continue;
    const found: Candidate[] = [];

    scan(root, dir, dir.split("/").filter(Boolean).length, found);
    for (const candidate of found) {
      if (seen.has(candidate.dir)) continue;
      seen.add(candidate.dir);
      candidates.push(candidate);
    }
  }
  const claimed = (options.claimed ?? []).map(normalizePath);
  const ids = new Set<string>();

  return candidates
    .filter((candidate) => !claimed.some((path) => candidate.dir === path || candidate.dir.startsWith(`${path}/`)))
    .sort((a, b) => a.dir.localeCompare(b.dir))
    .map((candidate) => {
      const isPages = options.pageRoots.map((path) => normalizePath(path === "." ? "" : path)).includes(candidate.dir);
      let id = isPages ? "pages" : (candidate.dir.split("/").pop() ?? "content").replace(/^_+/, "") || "content";

      if (ids.has(id)) id = candidate.dir.replace(/^_+/, "").replace(/\//g, "-");
      ids.add(id);
      const format: EntryFormat = candidate.mdx > candidate.markdown ? "mdx" : "markdown";
      const names = collectionNames(id);

      return {
        id,
        label: names.label,
        singular: names.singular,
        kind: "entries",
        path: candidate.dir === "" ? "." : candidate.dir,
        pattern: "**/*.{md,mdx,markdown}",
        format,
        body: true,
        url: options.urlFor(candidate.dir, isPages),
        fields: [],
        create: true,
        count: 0,
        source: "inferred",
      } satisfies Collection;
    });
}

/** Each JSON/YAML/TOML file directly inside the data folders becomes a data collection. */
export function discoverDataCollections(root: string, dirs: string[], taken: Set<string>, notes: string[]): Collection[] {
  const out: Collection[] = [];

  for (const dir of dirs) {
    const base = normalizePath(dir);
    let entries;

    try {
      entries = readdirSync(absolute(root, base), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || entry.name.startsWith(".")) continue;
      const format = formatForPath(entry.name);

      if (format !== "json" && format !== "yaml" && format !== "toml") continue;
      const path = `${base}/${entry.name}`;

      if (taken.has(path)) continue;
      let size = 0;

      try {
        size = statSync(absolute(root, path)).size;
      } catch {
        continue;
      }
      if (size > MAX_DATA_FILE_BYTES) {
        notes.push(`${path} is too large to edit as a form, so it was left out.`);
        continue;
      }
      let id = entry.name.replace(/\.[^.]+$/, "");

      if (out.some((collection) => collection.id === id)) id = `${id}-${format}`;
      const names = collectionNames(id);

      out.push({
        id,
        label: names.label,
        singular: names.singular,
        kind: "data",
        path,
        format,
        body: false,
        url: null,
        fields: [],
        create: false,
        count: 1,
        source: "inferred",
      });
    }
  }
  return out;
}
