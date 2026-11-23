/**
 * Where a site's redirects live and which host reads them, from the site
 * model alone (no files read): the list file, the host (deploy settings
 * first, then the redirects setting), and the file that host reads. Used by
 * the config merge to make exactly those files editable in content mode —
 * the list is content, and the host's file is derived from it.
 */
import type { GalleyConfig, RedirectsConfig, SiteModel } from "../types";
import type { SlashStyle } from "./path";
import type { RedirectHostId } from "./types";

export type GeneratedHost = "cloudflare" | "netlify" | "vercel";

/** The site's public folder: the media root served at "/". */
export function publicDir(model: Pick<SiteModel, "media">): string {
  return model.media.roots.find((root) => root.publicPath === "/")?.dir ?? "public";
}

export function isGeneratedHost(host: RedirectHostId | null | undefined): host is GeneratedHost {
  return host === "cloudflare" || host === "netlify" || host === "vercel";
}

/** The file a host reads, repo-relative. */
export function derivedPath(host: GeneratedHost, model: Pick<SiteModel, "media">): string {
  const dir = publicDir(model);

  return host === "vercel" ? "vercel.json" : `${dir === "." ? "" : `${dir}/`}_redirects`;
}

/**
 * Where the list lives when the config doesn't say: beside the site's other
 * data files (Astro's src/data/navigation.json → src/data/redirects.json),
 * else src/data/redirects.json.
 */
export function defaultListFile(model: Pick<SiteModel, "collections">): string {
  const dirs = new Map<string, number>();

  for (const collection of model.collections) {
    if (collection.kind !== "data" || !/\.json$/i.test(collection.path)) continue;
    const dir = collection.path.includes("/") ? collection.path.slice(0, collection.path.lastIndexOf("/")) : "";

    dirs.set(dir, (dirs.get(dir) ?? 0) + 1);
  }
  const best = [...dirs.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];

  return best ? `${best}/redirects.json` : "src/data/redirects.json";
}

export function listFileOf(model: Pick<SiteModel, "collections" | "redirects">): string {
  return model.redirects?.file?.replace(/^\.?\/+/, "") || defaultListFile(model);
}

/** The deploy target wins: it is where the site actually goes. */
export function hostOf(model: { deploy?: SiteModel["deploy"]; redirects?: RedirectsConfig }): { id: RedirectHostId | null; from: "deploy" | "config" | null } {
  const target = model.deploy?.target;

  if (target === "cloudflare" || target === "vercel" || target === "netlify") return { id: target as RedirectHostId, from: "deploy" };
  if (model.redirects?.host) return { id: model.redirects.host, from: "config" };
  return { id: null, from: null };
}

/** The repo paths redirects write: the list, and the host's file when the host is one this app writes for. */
export function redirectPaths(config: Pick<GalleyConfig, "deploy" | "redirects">, model: Pick<SiteModel, "collections" | "media">): string[] {
  const list = config.redirects?.file?.replace(/^\.?\/+/, "") || defaultListFile(model);
  const host = hostOf(config).id;

  return isGeneratedHost(host) ? [list, derivedPath(host, model)] : [list];
}

/** "/about/" in the site's URL patterns: page addresses end with a slash. */
export function slashStyleOf(model: Pick<SiteModel, "collections">): SlashStyle {
  const patterns = model.collections.map((collection) => collection.url).filter((url): url is string => Boolean(url) && url !== "/");
  const withSlash = patterns.filter((url) => url.endsWith("/")).length;

  return patterns.length === 0 || withSlash * 2 >= patterns.length ? "always" : "never";
}
