/**
 * SEO plugin titles and descriptions.
 *
 * Yoast, Rank Math and All in One SEO store templates ("%%title%% %%sep%%
 * %%sitename%%"), not final text. The well-known variables are filled in the
 * way the plugins do; a template with a variable we can't fill is dropped
 * rather than guessed at, and the report says so. The site name the plugins
 * append is removed again, because the new site adds its own.
 */
import type { WordPressSeo } from "../types";

export interface SeoVariables {
  title: string;
  siteName: string;
  siteDescription?: string;
  excerpt?: string;
  category?: string;
}

const SEPARATOR = "–";

export function resolveSeoTemplate(template: string | undefined, vars: SeoVariables): string | undefined {
  if (!template || !template.trim()) return undefined;
  const values: Record<string, string> = {
    title: vars.title,
    post_title: vars.title,
    sitename: vars.siteName,
    site_title: vars.siteName,
    sitedesc: vars.siteDescription ?? "",
    tagline: vars.siteDescription ?? "",
    sep: SEPARATOR,
    separator_sa: SEPARATOR,
    excerpt: vars.excerpt ?? "",
    excerpt_only: vars.excerpt ?? "",
    post_excerpt: vars.excerpt ?? "",
    primary_category: vars.category ?? "",
    category: vars.category ?? "",
    page: "",
    pagenumber: "",
    pagetotal: "",
  };
  let unknown = false;
  const fill = (name: string) => {
    const value = values[name.toLowerCase()];

    if (value === undefined) unknown = true;
    return value ?? "";
  };
  const text = template
    .replace(/%%([a-z_]+)%%/gi, (_m, name: string) => fill(name))
    .replace(/%([a-z_]+)%/gi, (_m, name: string) => fill(name))
    .replace(/#([a-z_]+)/gi, (match, name: string) => (name.toLowerCase() in values ? fill(name) : match));

  if (unknown) return undefined;
  return text.replace(/\s+/g, " ").trim() || undefined;
}

/** "Opening hours – Example Pottery" → "Opening hours" when the site name is the suffix. */
export function stripSiteName(title: string, siteName: string): string {
  if (!siteName) return title;
  const escaped = siteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripped = title.replace(new RegExp(`\\s*[-–—|·•:»]\\s*${escaped}\\s*$`, "i"), "").replace(new RegExp(`^${escaped}\\s*[-–—|·•:»]\\s*`, "i"), "");

  return stripped.trim() || title;
}

/** SEO details from an export file's post meta. */
export function seoFromMeta(meta: Record<string, string>, vars: SeoVariables): WordPressSeo {
  const seo: WordPressSeo = {};
  const pick = (title?: string, description?: string, plugin?: WordPressSeo["plugin"]) => {
    const resolvedTitle = resolveSeoTemplate(title, vars);
    const resolvedDescription = resolveSeoTemplate(description, vars);

    if (resolvedTitle && !seo.title) seo.title = stripSiteName(resolvedTitle, vars.siteName);
    if (resolvedDescription && !seo.description) seo.description = resolvedDescription;
    if ((resolvedTitle || resolvedDescription) && !seo.plugin && plugin) seo.plugin = plugin;
  };

  pick(meta._yoast_wpseo_title, meta._yoast_wpseo_metadesc, "yoast");
  pick(meta.rank_math_title, meta.rank_math_description, "rank-math");
  pick(meta._aioseo_title ?? meta._aioseop_title, meta._aioseo_description ?? meta._aioseop_description, "aioseo");
  const canonical = meta._yoast_wpseo_canonical || meta.rank_math_canonical_url || meta._aioseo_canonical_url;

  if (canonical) seo.canonical = canonical;
  if (meta["_yoast_wpseo_meta-robots-noindex"] === "1" || /noindex/.test(meta.rank_math_robots ?? "") || meta._aioseop_noindex === "on") seo.noindex = true;
  return seo;
}

/** SEO details the REST API exposes when Yoast (yoast_head_json) or AIOSEO (aioseo_head_json) is active. */
export function seoFromRest(post: Record<string, unknown>, siteName: string): WordPressSeo {
  const seo: WordPressSeo = {};
  const yoast = post.yoast_head_json as Record<string, unknown> | undefined;
  const aioseo = post.aioseo_head_json as Record<string, unknown> | undefined;
  const source = yoast ?? aioseo;

  if (!source) return seo;
  const title = typeof source.title === "string" ? source.title : undefined;
  const description = typeof source.description === "string" ? source.description : undefined;
  const canonical = typeof source.canonical === "string" ? source.canonical : typeof source.canonical_url === "string" ? source.canonical_url : undefined;
  const robots = source.robots as Record<string, unknown> | string | undefined;

  if (title) seo.title = stripSiteName(decodeEntities(title), siteName);
  if (description) seo.description = decodeEntities(description);
  if (canonical) seo.canonical = canonical;
  if ((typeof robots === "string" && /noindex/.test(robots)) || (robots && typeof robots === "object" && robots.index === "noindex")) seo.noindex = true;
  seo.plugin = yoast ? "yoast" : "aioseo";
  return seo;
}

/** The REST API sends SEO text HTML-escaped. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}
