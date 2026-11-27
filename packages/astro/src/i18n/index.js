// @ts-check
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const RTL_LANGS = new Set(["ar", "arc", "dv", "fa", "ha", "he", "khw", "ks", "ku", "ps", "ur", "yi"]);

/**
 * @typedef {{ code: string; label: string; prefix?: string; direction?: "ltr" | "rtl" }} LocaleConfig
 * @typedef {{ code: string; label: string; prefix: string; direction: "ltr" | "rtl"; isDefault: boolean }} ResolvedLocale
 * @typedef {{ defaultLocale: string; locales: LocaleConfig[]; strategy?: "folder" | "suffix"; prefixDefaultLocale?: boolean; localizeSlugs?: boolean }} I18nConfig
 * @typedef {{ key: string; sourcePath: string; locale: string; sourceHash: string; sourceSlug: string; localizedSlug: string; updatedAt: string }} ManifestLink
 * @typedef {{ version: 1; links: Record<string, ManifestLink> }} I18nManifest
 */

/**
 * @param {string} root
 * @param {string} rel
 * @returns {any}
 */
function readJsonSafe(root, rel) {
  const full = join(root, rel);

  if (!existsSync(full)) return null;
  try {
    return JSON.parse(readFileSync(full, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Normalizes a site's i18n configuration and reads `galley/i18n/manifest.json`.
 * @param {string} [root]
 * @param {{ config?: I18nConfig | null; manifest?: I18nManifest | null }} [overrides]
 */
export function loadSiteI18n(root = process.cwd(), overrides = {}) {
  const galleyConfig = overrides.config !== undefined ? overrides.config : readJsonSafe(root, "galley.config.json")?.i18n ?? null;
  const rawManifest = overrides.manifest !== undefined ? overrides.manifest : readJsonSafe(root, "galley/i18n/manifest.json");
  /** @type {I18nManifest} */
  const manifest =
    rawManifest && typeof rawManifest === "object" && rawManifest.links && typeof rawManifest.links === "object"
      ? { version: 1, links: rawManifest.links }
      : { version: 1, links: {} };

  if (!galleyConfig || !Array.isArray(galleyConfig.locales) || galleyConfig.locales.length === 0) {
    return {
      configured: false,
      defaultLocale: "en",
      prefixDefaultLocale: false,
      localizeSlugs: true,
      locales: [{ code: "en", label: "English", prefix: "en", direction: /** @type {"ltr"} */ ("ltr"), isDefault: true }],
      manifest,
    };
  }

  const defaultLocale = String(galleyConfig.defaultLocale || galleyConfig.locales[0].code);
  /** @type {ResolvedLocale[]} */
  const locales = galleyConfig.locales.map((/** @type {LocaleConfig} */ item) => {
    const code = String(item.code);
    const base = code.split("-")[0]?.toLowerCase() ?? "";
    /** @type {"ltr" | "rtl"} */
    const direction = item.direction === "rtl" || item.direction === "ltr" ? item.direction : RTL_LANGS.has(base) ? "rtl" : "ltr";

    return {
      code,
      label: String(item.label || code),
      prefix: String(item.prefix || code).toLowerCase(),
      direction,
      isDefault: code.toLowerCase() === defaultLocale.toLowerCase(),
    };
  });

  return {
    configured: locales.length >= 2,
    defaultLocale,
    prefixDefaultLocale: Boolean(galleyConfig.prefixDefaultLocale),
    localizeSlugs: galleyConfig.localizeSlugs !== false,
    locales,
    manifest,
  };
}

/**
 * Normalizes a pathname for comparison ("/es/precios" -> "/es/precios").
 * @param {string} value
 */
function normalizePathKey(value) {
  const clean = String(value || "/").replace(/\/{2,}/g, "/");

  if (!clean || clean === "/") return "/";
  return clean.replace(/\/+$/, "").toLowerCase();
}

/**
 * Formats a clean URL path preserving trailing slash preference.
 * @param {string} path
 * @param {boolean} trailingSlash
 */
function formatPath(path, trailingSlash) {
  let clean = path.replace(/\/{2,}/g, "/");

  if (!clean.startsWith("/")) clean = `/${clean}`;
  if (clean === "/") return "/";
  return trailingSlash ? (clean.endsWith("/") ? clean : `${clean}/`) : clean.replace(/\/+$/, "");
}

/**
 * Infers the collection route prefix from a repo-relative content path:
 *   src/content/pages/pricing.md → ""
 *   src/content/blog/hello.md    → "/blog"
 * @param {string} sourcePath
 * @param {string} sourceSlug
 */
function collectionPrefixFromPath(sourcePath, sourceSlug) {
  const cleanPath = sourcePath.replace(/\\/g, "/");
  const match = /(?:^|\/)content\/([^/]+)\//.exec(cleanPath);
  const folder = match?.[1]?.toLowerCase() ?? "";

  if (!folder || folder === "pages" || folder === "page") return "";
  if (sourceSlug && cleanPath.includes(`/${folder}/`)) return `/${folder}`;
  return "";
}

/**
 * Builds the URL path for a given slug + locale.
 * @param {string} collectionPrefix
 * @param {string} slug
 * @param {{ prefix: string; isDefault: boolean }} locale
 * @param {boolean} prefixDefaultLocale
 * @param {boolean} trailingSlash
 */
function buildUrl(collectionPrefix, slug, locale, prefixDefaultLocale, trailingSlash) {
  const cleanSlug = String(slug || "").replace(/^\/+|\/+$/g, "");
  const isIndex = cleanSlug.toLowerCase() === "index" || cleanSlug === "";
  const route = isIndex ? collectionPrefix || "/" : `${collectionPrefix}/${cleanSlug}`;
  const usePrefix = !locale.isDefault || prefixDefaultLocale;
  const combined = usePrefix ? `/${locale.prefix}${route === "/" ? "/" : route}` : route;

  return formatPath(combined, trailingSlash);
}

/**
 * Resolves the current locale, counterpart URLs, and hreflang entries for a page.
 *
 * @param {{
 *   pathname: string;
 *   currentLocale?: string;
 *   site?: string | URL;
 *   base?: string;
 *   root?: string;
 *   config?: I18nConfig | null;
 *   manifest?: I18nManifest | null;
 * }} input
 */
export function resolvePageLocales(input) {
  const loaded = loadSiteI18n(input.root, { config: input.config, manifest: input.manifest });
  const base = (input.base || "/").replace(/\/+$/, "");
  const rawPathname = input.pathname || "/";
  const pathname = base && base !== "/" && rawPathname.startsWith(base) ? rawPathname.slice(base.length) || "/" : rawPathname;
  const trailingSlash = pathname === "/" || pathname.endsWith("/");

  /** @param {string | null} relPath */
  const toHref = (relPath) => {
    if (!relPath) return null;
    const withBase = base && base !== "/" ? `${base}${relPath}` : relPath;

    if (!input.site) return withBase;
    try {
      return new URL(withBase, typeof input.site === "string" ? input.site : input.site.href).href;
    } catch {
      return withBase;
    }
  };

  // Group manifest links by sourcePath so localized slugs (/pricing/ ↔ /es/precios/) map bidirectionally.
  /** @type {Map<string, { sourcePath: string; sourceSlug: string; collectionPrefix: string; byLocale: Map<string, string> }>} */
  const groups = new Map();

  for (const link of Object.values(loaded.manifest.links)) {
    if (!link || typeof link.sourcePath !== "string" || typeof link.locale !== "string") continue;
    let group = groups.get(link.sourcePath);

    if (!group) {
      const srcSlug = link.sourceSlug || "index";

      group = {
        sourcePath: link.sourcePath,
        sourceSlug: srcSlug,
        collectionPrefix: collectionPrefixFromPath(link.sourcePath, srcSlug),
        byLocale: new Map(),
      };
      groups.set(link.sourcePath, group);
    }
    group.byLocale.set(link.locale.toLowerCase(), link.localizedSlug || group.sourceSlug);
  }

  const currentKey = normalizePathKey(pathname);
  /** @type {ResolvedLocale} */
  const defaultLoc =
    loaded.locales.find((/** @type {ResolvedLocale} */ l) => l.isDefault) ??
    loaded.locales[0] ?? { code: "en", label: "English", prefix: "en", direction: "ltr", isDefault: true };

  // Try matching the current pathname to a manifest group.
  let matchedGroup = null;
  /** @type {ResolvedLocale | null} */
  let detectedLocale = input.currentLocale
    ? loaded.locales.find((/** @type {ResolvedLocale} */ l) => l.code.toLowerCase() === input.currentLocale?.toLowerCase() || l.prefix === input.currentLocale?.toLowerCase()) ?? null
    : null;

  for (const group of groups.values()) {
    const defaultUrl = buildUrl(group.collectionPrefix, group.sourceSlug, defaultLoc, loaded.prefixDefaultLocale, trailingSlash);

    if (normalizePathKey(defaultUrl) === currentKey) {
      matchedGroup = group;
      detectedLocale = detectedLocale ?? defaultLoc;
      break;
    }
    for (const loc of loaded.locales) {
      if (loc.isDefault) continue;
      const locSlug = group.byLocale.get(loc.code.toLowerCase());

      if (!locSlug) continue;
      const locUrl = buildUrl(group.collectionPrefix, locSlug, loc, loaded.prefixDefaultLocale, trailingSlash);

      if (normalizePathKey(locUrl) === currentKey) {
        matchedGroup = group;
        detectedLocale = loc;
        break;
      }
    }
    if (matchedGroup) break;
  }

  // Fallback: detect locale from leading path prefix when not matched via manifest.
  let unprefixedPath = pathname;

  if (!detectedLocale) {
    const segs = pathname.replace(/^\/+/, "").split("/");
    const first = (segs[0] || "").toLowerCase();
    const byPrefix = loaded.locales.find((/** @type {ResolvedLocale} */ l) => (!l.isDefault || loaded.prefixDefaultLocale) && (l.prefix === first || l.code.toLowerCase() === first));

    if (byPrefix) {
      detectedLocale = byPrefix;
      const rest = segs.slice(1).join("/");

      unprefixedPath = rest ? formatPath(`/${rest}`, trailingSlash) : "/";
    } else {
      detectedLocale = defaultLoc;
      unprefixedPath = pathname;
    }
  } else if (!matchedGroup) {
    // Strip prefix if current pathname starts with detectedLocale's prefix.
    const segs = pathname.replace(/^\/+/, "").split("/");
    const first = (segs[0] || "").toLowerCase();

    if (first === detectedLocale.prefix || first === detectedLocale.code.toLowerCase()) {
      const rest = segs.slice(1).join("/");

      unprefixedPath = rest ? formatPath(`/${rest}`, trailingSlash) : "/";
    }
  }

  const activeLocale = detectedLocale ?? defaultLoc;
  const hasManifest = groups.size > 0;
  const isHome = normalizePathKey(unprefixedPath) === "/";

  const alternates = loaded.locales.map((/** @type {ResolvedLocale} */ loc) => {
    const homePath = buildUrl("", "index", loc, loaded.prefixDefaultLocale, true);
    let path = null;
    let exists = false;

    if (matchedGroup) {
      if (loc.isDefault) {
        path = buildUrl(matchedGroup.collectionPrefix, matchedGroup.sourceSlug, loc, loaded.prefixDefaultLocale, trailingSlash);
        exists = true;
      } else {
        const locSlug = matchedGroup.byLocale.get(loc.code.toLowerCase());

        if (locSlug) {
          path = buildUrl(matchedGroup.collectionPrefix, locSlug, loc, loaded.prefixDefaultLocale, trailingSlash);
          exists = true;
        }
      }
    } else {
      // Convention fallback (static routes or sites without manifest yet).
      const slugPart = unprefixedPath === "/" ? "index" : unprefixedPath.replace(/^\/+|\/+$/g, "");

      path = buildUrl("", slugPart, loc, loaded.prefixDefaultLocale, trailingSlash);
      exists = !hasManifest || isHome || loc.code.toLowerCase() === activeLocale.code.toLowerCase() || loc.isDefault;
    }

    return {
      code: loc.code,
      label: loc.label,
      prefix: loc.prefix,
      direction: loc.direction,
      isDefault: loc.isDefault,
      active: loc.code.toLowerCase() === activeLocale.code.toLowerCase(),
      exists,
      path,
      href: toHref(path),
      fallbackPath: homePath,
      fallbackHref: toHref(homePath),
    };
  });

  const defaultAlt = alternates.find((item) => item.isDefault) ?? alternates[0];

  return {
    configured: loaded.configured,
    defaultLocale: loaded.defaultLocale,
    current: activeLocale,
    alternates,
    xDefaultPath: defaultAlt?.path ?? defaultAlt?.fallbackPath ?? "/",
    xDefaultHref: defaultAlt?.href ?? defaultAlt?.fallbackHref ?? toHref("/"),
  };
}
