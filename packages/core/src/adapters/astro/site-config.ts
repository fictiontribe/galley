/**
 * The values of `astro.config.*` that shape where things live and how URLs
 * look, read statically: srcDir, publicDir, outDir, base, site,
 * trailingSlash, build.format and server.port. A value written as
 * `process.env.X || "fallback"` reads as its fallback (what a plain local run
 * uses), with a note saying so.
 */
import type { ModuleExpr, ParsedModule } from "../../adapter/types";
import type { I18nConfig, I18nLocaleConfig } from "../../types";

export const ASTRO_CONFIG_FILES = ["astro.config.mjs", "astro.config.ts", "astro.config.js", "astro.config.mts", "astro.config.cjs"];

const RTL_LANGS = new Set(["ar", "arc", "dv", "fa", "ha", "he", "khw", "ks", "ku", "ps", "ur", "yi"]);
const KNOWN_LABELS: Record<string, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  it: "Italiano",
  pt: "Português",
  "pt-br": "Português (Brasil)",
  nl: "Nederlands",
  ja: "日本語",
  ko: "한국어",
  zh: "中文",
  "zh-cn": "简体中文",
  "zh-tw": "繁體中文",
  ar: "العربية",
  he: "עברית",
  sv: "Svenska",
  da: "Dansk",
  no: "Norsk",
  fi: "Suomi",
  pl: "Polski",
  tr: "Türkçe",
  uk: "Українська",
  ru: "Русский",
  hi: "हिन्दी",
};

function localeLabel(code: string): string {
  const lower = code.toLowerCase();

  if (KNOWN_LABELS[lower]) return KNOWN_LABELS[lower]!;
  try {
    const names = new Intl.DisplayNames(["en"], { type: "language" });
    const display = names.of(code);

    if (display && display.toLowerCase() !== lower) return display;
  } catch {
    // Fall back to the code itself.
  }
  return code.toUpperCase();
}

function localeDirection(code: string): "ltr" | "rtl" {
  const base = code.split("-")[0]?.toLowerCase() ?? "";

  return RTL_LANGS.has(base) ? "rtl" : "ltr";
}

function readAstroI18n(module: ParsedModule, expr: ModuleExpr | undefined): I18nConfig | undefined {
  if (!expr) return undefined;
  const resolved = module.resolve(expr);
  const literal = module.literal(resolved);
  let defaultLocale: string | undefined;
  let rawLocales: unknown[] | undefined;
  let prefixDefaultLocale: boolean | undefined;

  if (literal && typeof literal === "object" && !Array.isArray(literal)) {
    const obj = literal as Record<string, unknown>;

    if (typeof obj.defaultLocale === "string") defaultLocale = obj.defaultLocale;
    if (Array.isArray(obj.locales)) rawLocales = obj.locales;
    if (obj.routing && typeof obj.routing === "object" && !Array.isArray(obj.routing)) {
      const routing = obj.routing as Record<string, unknown>;

      if (typeof routing.prefixDefaultLocale === "boolean") prefixDefaultLocale = routing.prefixDefaultLocale;
    }
  } else {
    const def = module.string(module.prop(resolved, "defaultLocale"));

    if (def) defaultLocale = def;
    const locExpr = module.prop(resolved, "locales");
    const locLit = module.literal(locExpr);

    if (Array.isArray(locLit)) rawLocales = locLit;
    const routing = module.prop(resolved, "routing");
    const pref = routing ? module.boolean(module.prop(routing, "prefixDefaultLocale")) : null;

    if (pref !== null) prefixDefaultLocale = pref;
  }

  if (!defaultLocale || !rawLocales || rawLocales.length === 0) return undefined;
  const locales: I18nLocaleConfig[] = [];
  const seen = new Set<string>();

  for (const item of rawLocales) {
    if (typeof item === "string" && item.trim()) {
      const code = item.trim();
      const key = code.toLowerCase();

      if (seen.has(key)) continue;
      seen.add(key);
      const direction = localeDirection(code);

      locales.push({ code, label: localeLabel(code), ...(direction === "rtl" ? { direction } : {}) });
    } else if (item && typeof item === "object" && !Array.isArray(item)) {
      const entry = item as { path?: unknown; codes?: unknown };
      const prefix = typeof entry.path === "string" && entry.path.trim() ? entry.path.trim().toLowerCase() : undefined;
      const codes = Array.isArray(entry.codes) ? entry.codes.filter((c): c is string => typeof c === "string" && c.trim().length > 0) : [];
      const code = codes[0]?.trim() ?? prefix;

      if (!code) continue;
      const key = code.toLowerCase();

      if (seen.has(key)) continue;
      seen.add(key);
      const direction = localeDirection(code);

      locales.push({
        code,
        label: localeLabel(code),
        ...(prefix && prefix !== code.toLowerCase() ? { prefix } : {}),
        ...(direction === "rtl" ? { direction } : {}),
      });
    }
  }
  if (locales.length === 0) return undefined;
  if (!seen.has(defaultLocale.toLowerCase())) {
    const direction = localeDirection(defaultLocale);

    locales.unshift({ code: defaultLocale, label: localeLabel(defaultLocale), ...(direction === "rtl" ? { direction } : {}) });
  }
  return {
    defaultLocale,
    locales,
    strategy: "folder",
    prefixDefaultLocale: prefixDefaultLocale ?? false,
    localizeSlugs: true,
  };
}

export interface AstroSiteValues {
  srcDir?: string;
  publicDir?: string;
  outDir?: string;
  base?: string;
  site?: string;
  trailingSlash?: string;
  buildFormat?: string;
  port?: number;
  i18n?: I18nConfig;
  /** Plain-words remarks about how values were read. */
  notes: string[];
}

/** `process.env.X`, `import.meta.env.X` → "X". */
function envName(module: ParsedModule, expr: ModuleExpr): string | null {
  if (expr.kind === "member") {
    const object = expr.object;

    if (object.kind === "member" && object.property === "env") return expr.property;
  }
  if (expr.kind === "call") {
    // `Number(process.env.PORT)`, `String(…)`
    const inner = expr.args[0];

    return inner ? envName(module, inner) : null;
  }
  return null;
}

/** A literal, or the literal fallback of `a || b` / `a ?? b`, with the variable it stands in for. */
function valueOf(module: ParsedModule, expr: ModuleExpr | undefined): { value: string | number | boolean; env: string | null } | null {
  if (!expr) return null;
  const resolved = module.resolve(expr);
  const plain = module.literal(resolved);

  if (typeof plain === "string" || typeof plain === "number" || typeof plain === "boolean") return { value: plain, env: null };
  if (resolved.kind === "new" && module.callee(resolved) === "URL") {
    const path = module.string(resolved.args[0]);

    return path === null ? null : { value: path, env: null };
  }
  if (resolved.kind === "logical") {
    const fallback = valueOf(module, resolved.right);

    if (!fallback) return null;
    return { value: fallback.value, env: envName(module, module.resolve(resolved.left)) ?? fallback.env ?? "" };
  }
  return null;
}

export function readAstroSiteValues(module: ParsedModule, file: string): AstroSiteValues {
  const out: AstroSiteValues = { notes: [] };
  const config = module.configObject();

  if (!config) return out;
  const read = (expr: ModuleExpr | undefined, what: string): string | number | boolean | undefined => {
    const found = valueOf(module, expr);

    if (!found) return undefined;
    if (found.env !== null) {
      out.notes.push(
        found.env
          ? `${file} takes the ${what} from ${found.env} when that is set; its fallback, ${String(found.value)}, was used.`
          : `${file} computes the ${what}; its fallback, ${String(found.value)}, was used.`
      );
    }
    return found.value;
  };
  const text = (key: string, what: string): string | undefined => {
    const value = read(module.prop(config, key), what);

    return typeof value === "string" ? value : undefined;
  };
  const srcDir = text("srcDir", "source folder");
  const publicDir = text("publicDir", "public folder");
  const outDir = text("outDir", "build folder");
  const base = text("base", "base path");
  const site = text("site", "site address");
  const trailingSlash = text("trailingSlash", "trailing-slash setting");
  const build = module.prop(config, "build");
  const buildFormat = build ? read(module.prop(build, "format"), "build format") : undefined;
  const server = module.prop(config, "server");
  const port = server ? read(module.prop(server, "port"), "dev server port") : undefined;
  const i18n = readAstroI18n(module, module.prop(config, "i18n"));

  if (srcDir) out.srcDir = srcDir;
  if (publicDir) out.publicDir = publicDir;
  if (outDir) out.outDir = outDir;
  if (base) out.base = base;
  if (site) out.site = site;
  if (trailingSlash) out.trailingSlash = trailingSlash;
  if (typeof buildFormat === "string") out.buildFormat = buildFormat;
  if (typeof port === "number" && Number.isInteger(port) && port > 0) out.port = port;
  if (i18n) {
    out.i18n = i18n;
    out.notes.push(`Read ${i18n.locales.length} language${i18n.locales.length === 1 ? "" : "s"} (default ${i18n.defaultLocale}) from ${file}.`);
  }
  return out;
}
