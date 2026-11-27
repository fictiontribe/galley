/**
 * Locale-aware entry paths, localized URL slugs, and internal link rewriting.
 *
 * Supports both strategies:
 *   - "folder" (default): src/content/pages/pricing.md ↔ src/content/pages/es/precios.md
 *   - "suffix":           src/content/pages/pricing.md ↔ src/content/pages/precios.es.md
 *
 * Home pages ("index") keep their "index" filename so /es/ resolves cleanly
 * instead of inventing /es/inicio/.
 */
import type { Collection } from "../types";
import { findLocale, isDefaultLocale, localePrefix, type NormalizedI18nConfig } from "./locales";

export interface DetectedSlugLocale {
  locale: string;
  /** Slug with any locale folder or suffix stripped (e.g. "pricing" or "guides/start"). */
  baseSlug: string;
  isDefault: boolean;
}

/**
 * Inspects a collection-relative slug (no extension, POSIX separators) to determine
 * which configured locale it belongs to.
 */
export function detectSlugLocale(slug: string, config: NormalizedI18nConfig): DetectedSlugLocale {
  const clean = slug.replace(/^\/+|\/+$/g, "");
  const nonDefault = config.locales.filter((item) => !isDefaultLocale(config, item.code));
  const all = config.locales;

  if (config.strategy === "suffix") {
    const parts = clean.split("/");
    const leaf = parts[parts.length - 1] ?? "";
    const dot = leaf.lastIndexOf(".");

    if (dot > 0) {
      const candidate = leaf.slice(dot + 1);
      const matched = findLocale(config, candidate);

      if (matched && (!isDefaultLocale(config, matched.code) || config.prefixDefaultLocale)) {
        const nextLeaf = leaf.slice(0, dot);
        const baseSlug = [...parts.slice(0, -1), nextLeaf].join("/");

        return { locale: matched.code, baseSlug, isDefault: isDefaultLocale(config, matched.code) };
      }
    }
    return { locale: config.defaultLocale, baseSlug: clean, isDefault: true };
  }

  // Folder strategy: check first segment against locale prefixes / codes.
  const segments = clean.split("/");
  const first = segments[0]?.toLowerCase() ?? "";

  if (segments.length >= 2) {
    // Non-default locales always live under their prefix folder.
    const matchedNonDefault = nonDefault.find((item) => item.prefix === first || item.code.toLowerCase() === first);

    if (matchedNonDefault) {
      return { locale: matchedNonDefault.code, baseSlug: segments.slice(1).join("/"), isDefault: false };
    }
    // Default locale may also live under its prefix folder (e.g. en/about.md).
    const def = all.find((item) => isDefaultLocale(config, item.code));

    if (def && (def.prefix === first || def.code.toLowerCase() === first)) {
      return { locale: def.code, baseSlug: segments.slice(1).join("/"), isDefault: true };
    }
  } else if (segments.length === 1) {
    // A file named `es.md` right at the collection root is uncommon; only treat as default locale.
    return { locale: config.defaultLocale, baseSlug: clean, isDefault: true };
  }

  return { locale: config.defaultLocale, baseSlug: clean, isDefault: true };
}

/**
 * Turns a proposed translated slug into a clean URL-safe ASCII slug while
 * preserving directory segments and keeping "index" untouched.
 */
export function sanitizeLocalizedSlug(proposed: string | undefined, fallbackBaseSlug: string): string {
  const cleanFallback = fallbackBaseSlug.replace(/^\/+|\/+$/g, "");
  const fallbackParts = cleanFallback.split("/");
  const fallbackLeaf = fallbackParts[fallbackParts.length - 1] ?? "";

  // Home/index pages must keep their "index" slug so /<locale>/ resolves cleanly.
  if (fallbackLeaf.toLowerCase() === "index") return cleanFallback;
  if (!proposed || !proposed.trim()) return cleanFallback;

  const rawParts = proposed
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((segment) =>
      segment
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    )
    .filter(Boolean);

  if (rawParts.length === 0) return cleanFallback;

  // If the source had parent folders (e.g. "guides/getting-started") and the proposal only gave the leaf, keep parent folders.
  if (fallbackParts.length > 1 && rawParts.length === 1) {
    return [...fallbackParts.slice(0, -1), rawParts[0]!].join("/");
  }
  return rawParts.join("/");
}

/**
 * Builds the collection-relative entry slug (without extension) for a target locale.
 */
export function targetEntrySlug(localizedBaseSlug: string, targetLocaleCode: string, config: NormalizedI18nConfig): string {
  const clean = localizedBaseSlug.replace(/^\/+|\/+$/g, "");
  const locale = findLocale(config, targetLocaleCode);
  const prefix = locale ? locale.prefix : targetLocaleCode.toLowerCase();

  if (isDefaultLocale(config, targetLocaleCode) && !config.prefixDefaultLocale) {
    return clean;
  }
  if (config.strategy === "suffix") {
    const parts = clean.split("/");
    const leaf = parts[parts.length - 1] ?? "index";

    return [...parts.slice(0, -1), `${leaf}.${prefix}`].join("/");
  }
  return `${prefix}/${clean}`;
}

/**
 * Computes the repo-relative file path for a translated entry based on its source file extension.
 */
export function targetEntryPath(collection: Pick<Collection, "path">, sourcePath: string, entrySlug: string): string {
  const extMatch = /\.([a-z0-9]+)$/i.exec(sourcePath);
  const ext = extMatch ? `.${extMatch[1]!.toLowerCase()}` : ".md";
  const root = collection.path === "." ? "" : `${collection.path.replace(/\/+$/, "")}/`;

  return `${root}${entrySlug}${ext}`;
}

/**
 * Computes the public URL path for a localized entry given its collection URL pattern.
 * Examples (trailingSlash from collection pattern):
 *   pattern "/{slug}/", slug "index", locale "en" (default, unprefixed)  → "/"
 *   pattern "/{slug}/", slug "index", locale "es"                        → "/es/"
 *   pattern "/{slug}/", slug "precios", locale "es"                      → "/es/precios/"
 *   pattern "/blog/{slug}/", slug "hola-mundo", locale "es"              → "/es/blog/hola-mundo/"
 *   pattern "/{slug}/", slug "pricing", locale "en" (prefixDefault=true) → "/en/pricing/"
 */
export function localizedEntryUrl(
  collectionUrl: string | null,
  localizedBaseSlug: string,
  localeCode: string,
  config: NormalizedI18nConfig
): string | null {
  if (!collectionUrl) return null;
  const trailing = collectionUrl.endsWith("/");
  const cleanSlug = localizedBaseSlug.replace(/^\/+|\/+$/g, "");
  const locale = findLocale(config, localeCode);
  const prefix = locale ? localePrefix(locale) : localeCode.toLowerCase();
  const usePrefix = !isDefaultLocale(config, localeCode) || config.prefixDefaultLocale;

  let basePath = collectionUrl.replace("{slug}", cleanSlug);

  // Normalize "/index/" or "/index" to "/" (and "/blog/index/" to "/blog/")
  basePath = basePath.replace(/(^|\/)index\/?$/i, "$1");
  if (!basePath.startsWith("/")) basePath = `/${basePath}`;
  basePath = basePath.replace(/\/{2,}/g, "/");

  let full = usePrefix ? `/${prefix}${basePath === "/" ? "/" : basePath}` : basePath;

  full = full.replace(/\/{2,}/g, "/");
  if (full !== "/") {
    full = trailing ? (full.endsWith("/") ? full : `${full}/`) : full.replace(/\/+$/, "");
  }
  return full;
}

/** Normalizes an internal URL path for lookup ("/pricing" and "/pricing/" match cleanly). */
export function normalizeUrlKey(urlPath: string): string {
  const clean = urlPath.trim().replace(/\/{2,}/g, "/");

  if (!clean || clean === "/") return "/";
  return clean.replace(/\/+$/, "").toLowerCase();
}

/**
 * Rewrites internal site links inside Markdown text or plain URL fields using a
 * `sourceUrl -> targetUrl` counterpart map. Preserves hashes (#section) and query strings.
 */
export function rewriteUrlValue(value: string, urlMap: ReadonlyMap<string, string>): string {
  const trimmed = value.trim();

  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return value;
  const match = /^([^?#]+)([?#].*)?$/.exec(trimmed);

  if (!match) return value;
  const base = match[1]!;
  const suffix = match[2] ?? "";
  const mapped = urlMap.get(normalizeUrlKey(base));

  if (!mapped) return value;
  return `${mapped}${suffix}`;
}

export function rewriteMarkdownLinks(markdown: string, urlMap: ReadonlyMap<string, string>): string {
  if (urlMap.size === 0 || !markdown) return markdown;
  // Split around fenced code blocks so code examples stay untouched.
  const parts = markdown.split(/(^```[\s\S]*?^```|^~~~[\s\S]*?^~~~)/gm);

  return parts
    .map((chunk, idx) => {
      if (idx % 2 === 1) return chunk;
      // Rewrite Markdown links [text](/path) (skip image links ![alt](/images/...))
      let out = chunk.replace(/(^|[^!])(\[[^\]]*\]\()(\/[^)\s]+)([^)]*\))/g, (whole, pre: string, open: string, url: string, rest: string) => {
        const next = rewriteUrlValue(url, urlMap);

        return next === url ? whole : `${pre}${open}${next}${rest}`;
      });

      // Rewrite HTML href="/path"
      out = out.replace(/(\bhref\s*=\s*["'])(\/[^"']+)(["'])/gi, (whole, open: string, url: string, close: string) => {
        const next = rewriteUrlValue(url, urlMap);

        return next === url ? whole : `${open}${next}${close}`;
      });
      return out;
    })
    .join("");
}
