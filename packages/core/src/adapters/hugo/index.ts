/**
 * The Hugo adapter — reads Hugo's root and split `config/_default/`
 * configuration statically (never executes site code) using only the public
 * adapter API.
 *
 * What it reads:
 * - `hugo.{toml,yaml,yml,json}`, `config.{toml,yaml,yml,json}`, and
 *   `config/_default/{hugo,config,permalinks,languages}.{toml,yaml,yml,json}`;
 * - `baseURL`, `contentDir`, `publishDir`, `staticDir` (string or list),
 *   `dataDir`, `archetypeDir`, `uglyURLs`;
 * - multilingual `[languages]` with distinct `contentDir`s and per-language
 *   permalinks;
 * - `[permalinks]` (and `[permalinks.page]`) section rules, converting
 *   slug-based rules to `{slug}` patterns and noting date-based rules as null.
 */
import { posix } from "node:path";

import { ADAPTER_API_VERSION, defineAdapter } from "../../adapter/define";
import type { AdapterContext, AdapterConventions, CollectionDraft } from "../../adapter/types";
import type { Collection, JsonValue } from "../../types";

const HUGO_FILES = ["hugo.toml", "hugo.yaml", "hugo.yml", "hugo.json"] as const;
const SPLIT_BASE_FILES = [
  "config/_default/hugo.toml",
  "config/_default/hugo.yaml",
  "config/_default/hugo.yml",
  "config/_default/hugo.json",
  "config/_default/config.toml",
  "config/_default/config.yaml",
  "config/_default/config.yml",
  "config/_default/config.json",
] as const;
const LEGACY_FILES = ["config.toml", "config.yaml", "config.yml", "config.json"] as const;
const DATA_EXTS = ["toml", "yaml", "yml", "json"] as const;

type JsonRecord = { [key: string]: JsonValue };

interface LanguageConfig {
  code: string;
  contentDir: string;
  weight: number;
  permalinks: Record<string, string>;
}

interface HugoState {
  baseURL?: string;
  contentDir: string;
  publishDir: string;
  staticDirs: string[];
  dataDir: string;
  archetypeDir: string;
  uglyURLs: boolean;
  defaultContentLanguage: string | null;
  defaultContentLanguageInSubdir: boolean;
  languages: LanguageConfig[];
  contentDirs: string[];
  permalinks: Record<string, string>;
}

const states = new WeakMap<AdapterContext, HugoState>();

function isRecord(value: JsonValue | null | undefined): value is JsonRecord {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value);
}

function httpUrl(value: unknown): string | undefined {
  return typeof value === "string" && /^https?:\/\/[^\s]+$/.test(value.trim()) ? value.trim().replace(/\/+$/, "") : undefined;
}

function safePath(path: string): string | null {
  const trimmed = path.trim().replace(/\\/g, "/");

  if (trimmed === "" || trimmed === "." || trimmed === "./") return ".";
  if (trimmed.startsWith("/") || /^[A-Za-z]:/.test(trimmed)) return null;
  const normal = posix.normalize(trimmed).replace(/^\/+/, "").replace(/\/+$/, "");

  if (normal === ".." || normal.startsWith("../")) return null;
  return normal === "" ? "." : normal;
}

function cleanDir(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return safePath(value) ?? fallback;
}

/** Case-insensitive lookup matching Hugo's config key rules. */
function getField(record: JsonRecord, ...names: string[]): JsonValue | undefined {
  for (const name of names) {
    if (Object.hasOwn(record, name)) return record[name];
  }
  const wanted = new Set(names.map((name) => name.toLowerCase()));

  for (const [key, value] of Object.entries(record)) {
    if (wanted.has(key.toLowerCase())) return value;
  }
  return undefined;
}

function readRecord(ctx: AdapterContext, file: string): JsonRecord | null {
  if (!ctx.exists(file)) return null;
  const data = ctx.readData(file);

  return isRecord(data) ? data : null;
}

function readFirstRecord(ctx: AdapterContext, files: readonly string[]): JsonRecord | null {
  for (const file of files) {
    const rec = readRecord(ctx, file);

    if (rec) return rec;
  }
  return null;
}

function mergeRecords(base: JsonRecord, extra: JsonRecord | null): JsonRecord {
  if (!extra) return { ...base };
  const out: JsonRecord = { ...base };

  for (const [key, value] of Object.entries(extra)) {
    const existingKey = Object.keys(out).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    const existing = existingKey !== undefined ? out[existingKey] : undefined;

    if (isRecord(existing) && isRecord(value)) {
      if (existingKey && existingKey !== key) delete out[existingKey];
      out[key] = mergeRecords(existing, value);
    } else {
      if (existingKey && existingKey !== key) delete out[existingKey];
      out[key] = value;
    }
  }
  return out;
}

/** Extracts `[permalinks]` (flat or nested under `[permalinks.page]`) keyed in lowercase. */
function extractPermalinks(value: JsonValue | undefined): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  const pageTable = getField(value, "page");

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") out[key.toLowerCase()] = entry;
  }
  if (isRecord(pageTable)) {
    for (const [key, entry] of Object.entries(pageTable)) {
      if (typeof entry === "string") out[key.toLowerCase()] = entry;
    }
  }
  return out;
}

function parseStaticDirs(value: JsonValue | undefined): string[] {
  const list: string[] = [];

  if (typeof value === "string") {
    const cleaned = safePath(value);

    if (cleaned) list.push(cleaned);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== "string") continue;
      const cleaned = safePath(item);

      if (cleaned && !list.includes(cleaned)) list.push(cleaned);
    }
  }
  return list.length > 0 ? list : ["static"];
}

function hasHugoGoMod(ctx: AdapterContext): boolean {
  const text = ctx.readText("go.mod");

  return text !== null && /hugo/i.test(text);
}

function stateOf(ctx: AdapterContext): HugoState {
  const known = states.get(ctx);

  if (known) return known;

  const rootConfig = readFirstRecord(ctx, HUGO_FILES) ?? readFirstRecord(ctx, LEGACY_FILES) ?? {};
  const splitBase = readFirstRecord(ctx, SPLIT_BASE_FILES);
  let merged = mergeRecords(rootConfig, splitBase);

  const splitPermalinks = readFirstRecord(ctx, DATA_EXTS.map((ext) => `config/_default/permalinks.${ext}`));

  if (splitPermalinks) {
    const inner = getField(splitPermalinks, "permalinks");
    const table = isRecord(inner) ? inner : splitPermalinks;

    merged = mergeRecords(merged, { permalinks: table });
  }

  const splitLanguages = readFirstRecord(ctx, DATA_EXTS.map((ext) => `config/_default/languages.${ext}`));

  if (splitLanguages) {
    const inner = getField(splitLanguages, "languages");
    const table = isRecord(inner) ? inner : splitLanguages;

    merged = mergeRecords(merged, { languages: table });
  }

  const baseURL = httpUrl(getField(merged, "baseURL", "baseurl"));
  const contentDir = cleanDir(getField(merged, "contentDir"), "content");
  const publishDir = cleanDir(getField(merged, "publishDir"), "public");
  const staticDirs = parseStaticDirs(getField(merged, "staticDir"));
  const dataDir = cleanDir(getField(merged, "dataDir"), "data");
  const archetypeDir = cleanDir(getField(merged, "archetypeDir"), "archetypes");
  const uglyRaw = getField(merged, "uglyURLs", "uglyurls");
  const uglyURLs = uglyRaw === true;
  const defaultLangRaw = getField(merged, "defaultContentLanguage");
  const defaultInSubdirRaw = getField(merged, "defaultContentLanguageInSubdir");
  const defaultContentLanguageInSubdir = defaultInSubdirRaw === true;
  const permalinks = extractPermalinks(getField(merged, "permalinks"));

  const languagesRaw = getField(merged, "languages");
  const languages: LanguageConfig[] = [];

  if (isRecord(languagesRaw)) {
    let order = 0;

    for (const [code, entry] of Object.entries(languagesRaw)) {
      if (!isRecord(entry)) continue;
      order += 1;
      const langContentDir = cleanDir(getField(entry, "contentDir"), contentDir);
      const weightRaw = getField(entry, "weight");
      const weight = typeof weightRaw === "number" && Number.isFinite(weightRaw) ? weightRaw : order * 100;
      const langPermalinks = extractPermalinks(getField(entry, "permalinks"));

      languages.push({ code, contentDir: langContentDir, weight, permalinks: langPermalinks });
    }
  }

  let defaultContentLanguage: string | null = typeof defaultLangRaw === "string" && defaultLangRaw.trim() !== "" ? defaultLangRaw.trim() : null;

  if (!defaultContentLanguage && languages.length > 0) {
    const sorted = [...languages].sort((a, b) => a.weight - b.weight);

    defaultContentLanguage = sorted[0]!.code;
  }

  const distinctLangDirs = [...new Set(languages.map((lang) => lang.contentDir))];
  const contentDirs = distinctLangDirs.length > 0 ? distinctLangDirs : [contentDir];

  const state: HugoState = {
    ...(baseURL ? { baseURL } : {}),
    contentDir,
    publishDir,
    staticDirs,
    dataDir,
    archetypeDir,
    uglyURLs,
    defaultContentLanguage,
    defaultContentLanguageInSubdir,
    languages,
    contentDirs,
    permalinks,
  };

  states.set(ctx, state);
  return state;
}

function applyTrailingSlash(pattern: string, trailingSlash: boolean): string {
  if (pattern === "/") return "/";
  if (/\.[a-z0-9]+$/i.test(pattern)) return pattern;
  return trailingSlash ? `${pattern.replace(/\/+$/, "")}/` : pattern.replace(/\/+$/, "") || "/";
}

const DATE_TOKEN = /:(year|month|monthname|day|weekday|weekdayname|yearday|06|2006)(?![a-zA-Z0-9_])/;

function convertHugoPermalink(
  rule: string,
  sectionPath: string,
  trailingSlash: boolean
): { ok: true; pattern: string } | { ok: false; reason: "date" | "dynamic" } {
  const trimmed = rule.trim();

  if (DATE_TOKEN.test(trimmed)) return { ok: false, reason: "date" };

  const topSection = sectionPath.split("/")[0] ?? "";
  let pattern = trimmed
    .replace(/:sections(?![a-zA-Z0-9_\[])/g, sectionPath)
    .replace(/:section(?![a-zA-Z0-9_\[])/g, topSection)
    .replace(/:(slugorfilename|slugortitle|contentbasename|filename|slug|title)(?![a-zA-Z0-9_])/g, "{slug}");

  // Any remaining `:token` (such as slice expressions `:sections[1:]`) cannot be mapped statically.
  if (/:[a-zA-Z0-9_]+/.test(pattern)) return { ok: false, reason: "dynamic" };
  if ((pattern.match(/\{slug\}/g) ?? []).length !== 1) return { ok: false, reason: "dynamic" };

  pattern = pattern.replace(/\/{2,}/g, "/");
  if (!pattern.startsWith("/")) pattern = `/${pattern}`;
  if (/\s|[?#]/.test(pattern)) return { ok: false, reason: "dynamic" };
  return { ok: true, pattern: applyTrailingSlash(pattern, trailingSlash) };
}

function ownerForPath(state: HugoState, path: string): { contentDir: string; lang: LanguageConfig | null } {
  const candidates =
    state.languages.length > 0
      ? state.languages.map((lang) => ({ contentDir: lang.contentDir, lang }))
      : [{ contentDir: state.contentDir, lang: null }];

  candidates.sort((a, b) => b.contentDir.length - a.contentDir.length);
  for (const candidate of candidates) {
    if (candidate.contentDir === "." || path === candidate.contentDir || path.startsWith(`${candidate.contentDir}/`)) {
      return candidate;
    }
  }
  return { contentDir: state.contentDir, lang: null };
}

function lookupPermalink(permalinks: Record<string, string>, sectionPath: string): string | undefined {
  if (sectionPath === "") return permalinks["/"];
  const lower = sectionPath.toLowerCase();

  if (Object.hasOwn(permalinks, lower)) return permalinks[lower];
  const top = lower.split("/")[0]!;

  if (Object.hasOwn(permalinks, top)) return permalinks[top];
  return undefined;
}

export const hugoAdapter = defineAdapter({
  id: "hugo",
  name: "Hugo",
  apiVersion: ADAPTER_API_VERSION,

  detect(ctx) {
    if (HUGO_FILES.some((file) => ctx.exists(file))) {
      const strong = ctx.isDirectory("archetypes") || ctx.isDirectory("layouts") || ctx.isDirectory("themes") || hasHugoGoMod(ctx);

      return { confidence: strong ? 0.95 : 0.85 };
    }
    if (SPLIT_BASE_FILES.some((file) => ctx.exists(file))) {
      return { confidence: 0.85 };
    }
    if (LEGACY_FILES.some((file) => ctx.exists(file)) && (ctx.isDirectory("content") || ctx.isDirectory("archetypes") || ctx.isDirectory("layouts"))) {
      return { confidence: 0.7 };
    }
    return null;
  },

  conventions(ctx): AdapterConventions {
    const state = stateOf(ctx);
    const existingStatic = state.staticDirs.filter((dir) => ctx.isDirectory(dir));
    const conventions: AdapterConventions = {
      dev: { command: "hugo server", port: 1313 },
      build: { command: "hugo", outDir: state.publishDir },
      publicDir: state.staticDirs[0] ?? "static",
      contentDirs: [...state.contentDirs],
      pageDirs: [...state.contentDirs],
      dataDirs: [state.dataDir],
      trailingSlash: !state.uglyURLs,
      ...(state.baseURL ? { urls: { production: state.baseURL } } : {}),
    };

    if (existingStatic.length > 1) {
      conventions.media = {
        roots: existingStatic.map((dir) => ({ dir, publicPath: "/" })),
      };
    }
    return conventions;
  },

  collections(ctx): CollectionDraft[] {
    const state = stateOf(ctx);
    const skip = [state.archetypeDir, state.publishDir, state.dataDir].filter((dir) => dir !== ".");
    const markdown = ctx.helpers.markdownCollections({
      roots: state.contentDirs,
      pageDirs: state.contentDirs,
      trailingSlash: !state.uglyURLs,
      claimed: skip,
    });
    const data = ctx.isDirectory(state.dataDir) ? ctx.helpers.dataCollections([state.dataDir]) : [];

    return [...markdown, ...data];
  },

  routes(ctx, collections: Collection[]): Record<string, string | null> {
    const state = stateOf(ctx);
    const trailingSlash = !state.uglyURLs;
    const urls: Record<string, string | null> = {};

    for (const collection of collections) {
      if (collection.kind === "data") {
        urls[collection.id] = null;
        continue;
      }
      const { contentDir, lang } = ownerForPath(state, collection.path);
      const sectionPath =
        collection.path === contentDir
          ? ""
          : contentDir === "."
            ? collection.path
            : collection.path.startsWith(`${contentDir}/`)
              ? collection.path.slice(contentDir.length + 1)
              : collection.path;
      const isDefaultLang = !lang || (lang.code === state.defaultContentLanguage && !state.defaultContentLanguageInSubdir);
      const langPrefix = isDefaultLang ? "" : `/${lang.code}`;
      const rule = (lang ? lookupPermalink(lang.permalinks, sectionPath) : undefined) ?? lookupPermalink(state.permalinks, sectionPath);

      if (rule !== undefined) {
        const converted = convertHugoPermalink(rule, sectionPath, trailingSlash);

        if (!converted.ok) {
          if (converted.reason === "date") {
            ctx.note(`The “${collection.label}” permalink (${rule}) uses date tokens, so its page addresses depend on each entry's date and could not be matched to a {slug} pattern.`);
          } else {
            ctx.note(`The “${collection.label}” permalink (${rule}) uses dynamic tokens beyond the file name, so its pages could not be matched to their files.`);
          }
          urls[collection.id] = null;
        } else {
          urls[collection.id] = `${langPrefix}${converted.pattern}`.replace(/\/{2,}/g, "/");
        }
        continue;
      }

      const defaultPattern = sectionPath === "" ? "/{slug}/" : `/${sectionPath}/{slug}/`;

      urls[collection.id] = applyTrailingSlash(`${langPrefix}${defaultPattern}`.replace(/\/{2,}/g, "/"), trailingSlash);
    }
    return urls;
  },
});
