/**
 * Entry identity: which collection owns a file, the slug ⇄ path mapping, and
 * the entry's public URL. Pure functions over the SiteModel — no filesystem.
 */
import picomatch from "picomatch";

import type { Collection, EntryFormat, SiteModel } from "../../types";
import { mayBeShown } from "../../workspace/policy";

const DEFAULT_PATTERNS: Record<EntryFormat, string> = {
  markdown: "**/*.{md,mdx,markdown}",
  mdx: "**/*.{md,mdx}",
  json: "**/*.json",
  yaml: "**/*.{yaml,yml}",
  toml: "**/*.toml",
};

export function patternOf(collection: Collection): string {
  return collection.pattern ?? DEFAULT_PATTERNS[collection.format];
}

/** Repo-relative POSIX form: no leading "./" or "/", no trailing slash. */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "").replace(/\/+$/, "").replace(/\/{2,}/g, "/");
}

const matchers = new Map<string, (path: string) => boolean>();

function matcher(pattern: string): (path: string) => boolean {
  let match = matchers.get(pattern);

  if (!match) {
    match = picomatch(pattern, { dot: false });
    matchers.set(pattern, match);
  }
  return match;
}

function relativeTo(base: string, path: string): string | null {
  if (base === "" || base === ".") return path;
  return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : null;
}

/**
 * The collection that owns a file. When several could (a "pages" collection
 * over `content/` and a "posts" collection over `content/posts/`), the one
 * with the most specific path wins.
 */
export function collectionForPath(model: Pick<SiteModel, "collections" | "templates">, path: string): Collection | null {
  const normalized = normalizePath(path);

  // A secrets file, or one of the version history's own, is never content, whatever the settings name as a
  // collection or let a pattern take in: an entry's text is shown, searched and sent to the assistant.
  if (!mayBeShown(normalized)) return null;
  // A template is a starting point for entries, never an entry itself, wherever it is kept.
  if (model.templates?.some((template) => normalizePath(template.file) === normalized)) return null;
  let best: Collection | null = null;
  let bestDepth = -1;

  for (const collection of model.collections) {
    const base = normalizePath(collection.path);

    if (collection.kind === "data") {
      if (base === normalized && base.length + 1 > bestDepth) {
        best = collection;
        bestDepth = base.length + 1;
      }
      continue;
    }
    const relative = relativeTo(base, normalized);

    if (relative === null || !matcher(patternOf(collection))(relative)) continue;
    const depth = base === "." ? 0 : base.length;

    if (depth > bestDepth) {
      best = collection;
      bestDepth = depth;
    }
  }
  return best;
}

/** "blog/2026/launch.md" in a collection at "blog" → "2026/launch"; "about/index.md" → "about". */
export function slugForPath(collection: Collection, path: string): string {
  const normalized = normalizePath(path);

  if (collection.kind === "data") return (normalized.split("/").pop() ?? normalized).replace(/\.[^.]+$/, "");
  const relative = relativeTo(normalizePath(collection.path), normalized) ?? normalized;
  const withoutExtension = relative.replace(/\.[^./]+$/, "");
  const stripped = withoutExtension.replace(/\/_?index$/, "");

  return stripped === "_index" ? "index" : stripped;
}

function extensionFor(collection: Collection): string {
  const pattern = collection.pattern ?? "";

  switch (collection.format) {
    case "mdx":
      return "mdx";
    case "markdown":
      return /\bmd\b/.test(pattern) || pattern === "" ? "md" : /markdown/.test(pattern) ? "markdown" : /mdx/.test(pattern) ? "mdx" : "md";
    case "yaml":
      return /yml/.test(pattern) && !/yaml/.test(pattern) ? "yml" : "yaml";
    default:
      return collection.format;
  }
}

/** The file a new entry with this slug is written to. */
export function pathForSlug(collection: Collection, slug: string): string {
  if (collection.kind === "data") return normalizePath(collection.path);
  const base = normalizePath(collection.path);
  const file = `${slug.replace(/^\/+|\/+$/g, "")}.${extensionFor(collection)}`;

  return base === "" || base === "." ? file : `${base}/${file}`;
}

/** Public URL path for an entry, from the collection's pattern. */
export function entryUrl(_model: SiteModel, collection: Collection, slug: string): string | null {
  if (!collection.url) return null;
  const clean = slug.replace(/^\/+|\/+$/g, "");
  let url = collection.url.replace(/\{slug\}/g, clean === "index" ? "" : clean);

  url = url.replace(/\/{2,}/g, "/");
  if (!url.startsWith("/")) url = `/${url}`;
  return url;
}

/** Normalises a URL path for lookups: no query/hash, decoded, one leading slash, no trailing slash. */
export function urlKey(urlPath: string): string {
  let path = urlPath.split(/[?#]/)[0] ?? "";

  try {
    path = decodeURI(path);
  } catch {
    // Keep the raw path when it is not valid percent-encoding.
  }
  path = path.replace(/^https?:\/\/[^/]+/i, "").replace(/\/index\.html?$/i, "/").replace(/\.html?$/i, "");
  path = `/${path.replace(/^\/+/, "").replace(/\/+$/, "")}`;
  return path.toLowerCase();
}
