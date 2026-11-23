/**
 * Which addresses are real on this site, for the checks: the pages behind
 * every collection with URLs (with their titles), the pages written as code
 * (`src/pages/contact.astro`), and the files served as they are from the
 * public folder. The same knowledge the content index uses for broken
 * links, read through SiteService and the route scanner, so the redirects
 * never disagree with link validation.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { scanRoutes, type RouteFile } from "../content/detect/routes";
import type { SiteModel, SiteService } from "../types";
import { decodePath, isWildcard, lookupKey, pathOnly, wildcardPrefix } from "./path";

export interface SitePage {
  /** The page's own address, exactly as the site writes it. */
  url: string;
  title: string;
  /** The entry's file, when the page is content. */
  path?: string;
}

export interface SiteRoutes {
  /** The page at this address (capitals and the trailing slash ignored). */
  page(address: string): SitePage | null;
  /** Whether the site serves anything at this address: a page, a page written as code, or a file. */
  exists(address: string): boolean;
  /** Every page the site has. */
  pages(): SitePage[];
  /** Pages whose address starts with this prefix ("/blog/"). */
  under(prefix: string): SitePage[];
}

/** For tests and for hosts with nothing known: pages listed, files by predicate. */
export function routesFrom(pages: SitePage[], options: { files?: (path: string) => boolean; open?: RegExp[] } = {}): SiteRoutes {
  const byKey = new Map<string, SitePage>();

  for (const page of pages) if (!byKey.has(lookupKey(page.url))) byKey.set(lookupKey(page.url), page);
  return {
    page: (address) => byKey.get(lookupKey(address)) ?? null,
    exists(address) {
      const key = lookupKey(address);

      if (byKey.has(key)) return true;
      if (options.open?.some((test) => test.test(key))) return true;
      return options.files ? options.files(decodePath(pathOnly(address))) : false;
    },
    pages: () => pages,
    under(prefix) {
      const lower = prefix.toLowerCase();

      return pages.filter((page) => page.url.toLowerCase().startsWith(lower) || `${page.url.toLowerCase()}/` === lower);
    },
  };
}

function codeRouteTitle(route: RouteFile): string {
  const name = route.route === "/" ? "Home" : route.route.split("/").filter(Boolean).pop()!;

  return name.charAt(0).toUpperCase() + name.slice(1).replace(/[-_]/g, " ");
}

/** Everything the site serves, read once per request. */
export async function siteRoutes(site: SiteService, model?: SiteModel): Promise<SiteRoutes> {
  const current = model ?? (await site.model());
  const pages: SitePage[] = [];

  for (const collection of current.collections) {
    if (!collection.url) continue;
    const list = await site.listEntries(collection.id, { limit: 1_000_000 }).catch(() => null);

    for (const item of list?.items ?? []) if (item.url) pages.push({ url: item.url, title: item.title, path: item.path });
  }
  const contentIds = new Set(current.collections.map((collection) => collection.id));
  const routes = current.routesDir ? scanRoutes(site.root, current.routesDir) : [];
  // Static code routes are pages of their own; dynamic ones that don't render a collection may serve anything.
  for (const route of routes) if (!route.dynamic && !route.endpoint && route.route !== "/404") pages.push({ url: route.route, title: codeRouteTitle(route) });
  const open = routes.filter((route) => (route.dynamic && !route.collections.some((id) => contentIds.has(id))) || route.endpoint).map((route) => route.test);
  const roots = current.media.roots;

  return routesFrom(pages, {
    open,
    files(path) {
      if (path.split("/").includes("..")) return false;
      for (const root of roots) {
        const prefix = root.publicPath.replace(/\/+$/, "");

        if (prefix !== "" && !path.startsWith(`${prefix}/`)) continue;
        const rest = path.slice(prefix.length).replace(/^\/+/, "");

        if (rest !== "" && existsSync(join(site.root, ...`${root.dir}/${rest}`.split("/").filter(Boolean)))) return true;
      }
      return false;
    },
  });
}

/** For a wildcard old address: the pages it would hide. For an exact one: the page, if any. */
export function hiddenPages(routes: SiteRoutes, from: string): SitePage[] {
  if (isWildcard(from)) return routes.under(wildcardPrefix(from));
  if (from.includes("?")) return [];
  const page = routes.page(from);

  return page ? [page] : [];
}
