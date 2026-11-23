/**
 * File-based routes (Astro-style `src/pages`): which URLs a site serves from
 * code rather than content, and which collection each dynamic route renders.
 * Read statically from the route files' text.
 */
import { readFileSync, statSync } from "node:fs";

import { globSync } from "tinyglobby";

import { absolute } from "../entries/files";

export interface RouteFile {
  /** Repo-relative path of the route file. */
  file: string;
  /** URL pattern with Astro-style params: "/blog/[...slug]". */
  route: string;
  dynamic: boolean;
  /** Matches a URL key (lowercase, no trailing slash). */
  test: RegExp;
  /** Collection ids the file reads with getCollection/getEntry. */
  collections: string[];
  /**
   * Collection ids the file renders one page per entry of: read with
   * `getCollection("x")`, or `getEntry("x", …)` with an id taken from the
   * URL's params. `getEntry("pages", "blog")` reads one known entry, and
   * `getEntry("authors", post.data.author)` looks one up by reference, so
   * they are in `collections` but not here.
   */
  renders: string[];
  /** A `.ts`/`.js` endpoint (feeds, JSON, sitemaps) — never an entry's page. */
  endpoint: boolean;
  /** Calls `paginate()`: a listing split over pages, not one entry's page. */
  paginates: boolean;
}

const ROUTE_EXTENSIONS = ["astro", "md", "mdx", "html", "ts", "js", "svelte", "vue", "jsx", "tsx"];
const ENDPOINT = /\.(ts|js|mjs|mts|cjs|cts)$/;

function routeFor(relative: string): string {
  const withoutExtension = relative.replace(/\.[^./]+$/, "").replace(/\.(html|xml|json|txt)$/, "");
  const route = `/${withoutExtension}`.replace(/\/index$/, "/").replace(/\/\([^)]*\)/g, "");

  return route === "" ? "/" : route;
}

function testFor(route: string): RegExp {
  const parts = route.split("/").filter(Boolean).map((segment) => {
    if (/^\[\.\.\.[^\]]+\]$/.test(segment)) return "(?:/.*)?";
    const escaped = segment.replace(/[.*+?^${}()|\\]/g, "\\$&").replace(/\\\[[^\]]+\\\]|\[[^\]]+\]/g, "[^/]+");

    return `/${escaped}`;
  });

  return new RegExp(`^${parts.join("") || "/"}$`, "i");
}

const READS = /\b(?:getCollection|getEntry|getEntries|getEntryBySlug)\(\s*["'`]([\w-]+)["'`]/g;
// getEntry renders a collection when the id comes from the page's own URL
// (`Astro.params.slug`, `params.id`, a `slug` variable); `getEntry("authors",
// post.data.author)` is a lookup by reference, not a page per author.
const RENDERS = /\bgetCollection\(\s*["'`]([\w-]+)["'`]|\b(?:getEntry|getEntryBySlug)\(\s*["'`]([\w-]+)["'`]\s*,\s*(?:Astro\.params\b|params\b|(?:slug|id|path|page)\s*[,)])/g;

export function scanRoutes(root: string, pagesDir: string, extensions: string[] = ROUTE_EXTENSIONS): RouteFile[] {
  let files: string[];

  try {
    if (!statSync(absolute(root, pagesDir)).isDirectory()) return [];
    const pattern = extensions.length === 1 ? `**/*.${extensions[0]}` : `**/*.{${extensions.join(",")}}`;

    files = globSync(pattern, { cwd: absolute(root, pagesDir), onlyFiles: true, expandDirectories: false });
  } catch {
    return [];
  }
  return files
    .filter((file) => !file.split("/").some((segment) => segment.startsWith("_")))
    .map((relative) => {
      const route = routeFor(relative);
      const dynamic = /\[[^\]]+\]/.test(route);
      let collections: string[] = [];
      let renders: string[] = [];
      let paginates = false;

      if (dynamic) {
        try {
          const text = readFileSync(absolute(root, `${pagesDir}/${relative}`), "utf8");

          collections = [...new Set([...text.matchAll(READS)].map((match) => match[1]!))];
          renders = [...new Set([...text.matchAll(RENDERS)].map((match) => (match[1] ?? match[2])!))];
          paginates = /\bpaginate\s*\(/.test(text);
        } catch {
          collections = [];
        }
      }
      return { file: `${pagesDir}/${relative}`, route, dynamic, test: testFor(route), collections, renders, endpoint: ENDPOINT.test(relative), paginates };
    })
    .sort((a, b) => Number(a.dynamic) - Number(b.dynamic) || a.route.localeCompare(b.route));
}

/** Dynamic HTML routes with exactly one parameter: the only kind that can be one entry's page. */
function entryRoutes(routes: RouteFile[]): RouteFile[] {
  return routes.filter((route) => route.dynamic && !route.endpoint && !route.paginates && (route.route.match(/\[[^\]]+\]/g) ?? []).length === 1);
}

/**
 * The one collection a route is dedicated to. A folder named after one of the
 * site's collections decides it (`blog/[slug].astro` is the blog's, even when
 * it loads posts through a helper and only looks up a team member by name);
 * otherwise a route that renders exactly one collection is that one's.
 */
export function routeOwner(route: RouteFile, collectionIds: string[] = []): string | null {
  const segments = route.route.split("/").filter((segment) => segment !== "" && !segment.startsWith("["));
  const named = [...new Set(segments.filter((segment) => collectionIds.includes(segment) || route.renders.includes(segment)))];

  if (named.length === 1) return named[0]!;
  if (route.renders.length === 1) return route.renders[0]!;
  return null;
}

/**
 * The URL pattern a collection's entries are served at, from the one dynamic
 * route that renders it. Null when no route (or more than one) claims it.
 * `collectionIds` (every collection in the site) lets a route's folder name
 * decide whose it is.
 *
 * A catch-all route that renders several collections (`[...slug].astro`
 * reading both "pages" and "blog") belongs to the one collection left over
 * once every other has a route of its own.
 */
export function urlPatternFromRoutes(routes: RouteFile[], collectionId: string, trailingSlash: boolean, collectionIds: string[] = []): string | null {
  const candidates = entryRoutes(routes);
  const ids = collectionIds.includes(collectionId) ? collectionIds : [...collectionIds, collectionId];
  const ownerOf = (route: RouteFile): string | null => routeOwner(route, ids);
  let claiming = candidates.filter((route) => ownerOf(route) === collectionId);

  if (claiming.length === 0) {
    claiming = candidates.filter((route) => {
      if (ownerOf(route) !== null || !route.renders.includes(collectionId)) return false;
      const left = route.renders.filter((id) => !candidates.some((other) => other !== route && ownerOf(other) === id));

      return left.length === 1 && left[0] === collectionId;
    });
  }
  if (claiming.length !== 1) return null;
  const pattern = claiming[0]!.route.replace(/\[[^\]]+\]/, "{slug}");

  return trailingSlash ? `${pattern.replace(/\/$/, "")}/` : pattern;
}
