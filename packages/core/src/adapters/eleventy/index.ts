/**
 * The Eleventy (11ty) adapter — reads Eleventy's configuration statically
 * (never executes site code) using only the public adapter API.
 *
 * What it reads:
 * - `eleventy.config.{js,mjs,cjs,ts}` or `.eleventy.{js,cjs,mjs}` for
 *   `dir.{input,output,data,includes,layouts}` and `pathPrefix` (from
 *   `return { ... }`, `export const config = { ... }`, `module.exports = ...`,
 *   or Eleventy 3 fluent `set*Directory` / `setPathPrefix` calls);
 * - `addPassthroughCopy("...")` and `addPassthroughCopy({ src: dest })`
 *   mappings for media roots and root-served folders;
 * - directory data files (`<dir>/<name>.11tydata.{json,js,cjs,mjs}` and
 *   `<dir>/<name>.json`) for collection tags and permalinks;
 * - conventional markdown folders under `dir.input` and global data files
 *   in `dir.data`.
 */
import { posix } from "node:path";

import { ADAPTER_API_VERSION, defineAdapter } from "../../adapter/define";
import type { AdapterContext, AdapterConventions, CollectionDraft, ModuleExpr, ParsedModule } from "../../adapter/types";
import type { Collection } from "../../types";

const CONFIG_FILES = [
  "eleventy.config.js",
  "eleventy.config.mjs",
  "eleventy.config.cjs",
  "eleventy.config.ts",
  ".eleventy.js",
  ".eleventy.cjs",
  ".eleventy.mjs",
];

const DIR_DATA_EXTENSIONS = [".11tydata.json", ".11tydata.js", ".11tydata.cjs", ".11tydata.mjs", ".json"] as const;

interface PassthroughRoot {
  dir: string;
  publicPath: string;
}

interface EleventyState {
  configFile: string | null;
  input: string;
  output: string;
  data: string;
  includes: string;
  layouts: string | null;
  pathPrefix: string;
  passthrough: PassthroughRoot[];
}

interface DirectoryData {
  tags?: string | string[];
  permalink?: string | false | "dynamic";
}

/** One read of the config per detection; every hook gets the same context. */
const states = new WeakMap<AdapterContext, EleventyState>();

/** "./src/" → "src"; "" and "./" → ".". Returns null if the path leaves the site. */
function safePath(path: string): string | null {
  const trimmed = path.trim().replace(/\\/g, "/");

  if (trimmed === "" || trimmed === "." || trimmed === "./") return ".";
  if (trimmed.startsWith("/") || /^[A-Za-z]:/.test(trimmed)) return null;
  const normal = posix.normalize(trimmed).replace(/^\/+/, "").replace(/\/+$/, "");

  if (normal === ".." || normal.startsWith("../")) return null;
  return normal === "" ? "." : normal;
}

function cleanOrDefault(path: string | null | undefined, fallback: string): string {
  if (!path) return fallback;
  return safePath(path) ?? fallback;
}

function under(dir: string, rel: string): string | null {
  return safePath(dir === "." ? rel : `${dir}/${rel}`);
}

function normalizePathPrefix(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");

  if (trimmed === "" || trimmed === ".") return "";
  return `/${trimmed}`;
}

/** Strips JS comments while leaving string and template literals intact. */
function stripComments(source: string): string {
  let out = "";
  let i = 0;

  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];

    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;

      out += ch;
      i += 1;
      while (i < source.length) {
        const cur = source[i]!;

        out += cur;
        i += 1;
        if (cur === "\\") {
          if (i < source.length) {
            out += source[i]!;
            i += 1;
          }
          continue;
        }
        if (cur === quote) break;
      }
      continue;
    }
    if (ch === "/" && next === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      out += " ";
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Extracts the raw argument text for every `.method(...)` call in comment-stripped JS. */
function callArguments(source: string, method: string): string[] {
  const results: string[] = [];
  const pattern = new RegExp(`\\.${method}\\s*\\(`, "g");
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    const start = match.index + match[0].length;
    let depth = 1;
    let i = start;

    while (i < source.length && depth > 0) {
      const ch = source[i]!;

      if (ch === "'" || ch === '"' || ch === "`") {
        const quote = ch;

        i += 1;
        while (i < source.length) {
          const cur = source[i]!;

          i += 1;
          if (cur === "\\") {
            i += 1;
            continue;
          }
          if (cur === quote) break;
        }
        continue;
      }
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      i += 1;
    }
    if (depth === 0) results.push(source.slice(start, i - 1));
  }
  return results;
}

function firstStringArg(ctx: AdapterContext, source: string, method: string, module: ParsedModule | null): string | null {
  for (const rawArgs of callArguments(source, method)) {
    const parsed = ctx.helpers.parseModule(`export default [${rawArgs}]`);
    const list = parsed.exported("default");

    if (list?.kind !== "array" || list.items.length === 0) continue;
    const first = list.items[0]!;
    const resolved = first.kind === "ident" && module ? module.resolve(first) : parsed.resolve(first);

    if (resolved.kind === "string") return resolved.value;
  }
  return null;
}

function isGlobLike(value: string): boolean {
  return /[*?{}\[\]]/.test(value);
}

function parsePassthroughCopies(ctx: AdapterContext, source: string, input: string, module: ParsedModule | null): PassthroughRoot[] {
  const roots: PassthroughRoot[] = [];
  const seen = new Set<string>();
  const add = (dir: string | null, publicPath: string) => {
    if (!dir || seen.has(dir)) return;
    seen.add(dir);
    roots.push({ dir, publicPath });
  };

  for (const rawArgs of callArguments(source, "addPassthroughCopy")) {
    const parsed = ctx.helpers.parseModule(`export default [${rawArgs}]`);
    const list = parsed.exported("default");

    if (list?.kind !== "array" || list.items.length === 0) continue;
    const first = list.items[0]!;
    const expr = first.kind === "ident" && module ? module.resolve(first) : parsed.resolve(first);

    if (expr.kind === "string") {
      if (isGlobLike(expr.value)) continue;
      const dir = safePath(expr.value);

      if (!dir) continue;
      const rel = dir === "." || dir === input ? "" : input !== "." && dir.startsWith(`${input}/`) ? dir.slice(input.length + 1) : dir;
      const publicPath = rel === "" ? "/" : `/${rel}`;

      add(dir, publicPath);
      continue;
    }
    if (expr.kind === "object") {
      for (const prop of expr.props) {
        if (!("key" in prop) || isGlobLike(prop.key)) continue;
        const dir = safePath(prop.key);
        const target = prop.value.kind === "ident" && module ? module.string(prop.value) : parsed.string(prop.value);

        if (!dir || target === null) continue;
        const cleanTarget = target.trim().replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "").replace(/\/+$/, "");
        const publicPath = cleanTarget === "" || cleanTarget === "." ? "/" : `/${cleanTarget}`;

        add(dir, publicPath);
      }
    }
  }
  return roots;
}

function readConfigString(module: ParsedModule | null, key: string): string | null {
  if (!module) return null;
  const fromConfig = module.string(module.prop(module.exported("config"), key));

  if (fromConfig !== null) return fromConfig;
  return module.string(module.prop(module.configObject(), key));
}

function readDirString(module: ParsedModule | null, key: string): string | null {
  if (!module) return null;
  const fromConfig = module.prop(module.exported("config"), "dir");
  const fromConfigValue = module.string(module.prop(fromConfig, key));

  if (fromConfigValue !== null) return fromConfigValue;
  const fromDefault = module.prop(module.configObject(), "dir");

  return module.string(module.prop(fromDefault, key));
}

function stateOf(ctx: AdapterContext): EleventyState {
  const known = states.get(ctx);

  if (known) return known;
  const configFile = CONFIG_FILES.find((file) => ctx.exists(file)) ?? null;
  const rawText = configFile ? (ctx.readText(configFile) ?? "") : "";
  const stripped = rawText ? stripComments(rawText) : "";
  const module = configFile ? ctx.helpers.readModule(configFile) : null;

  const input = cleanOrDefault(readDirString(module, "input") ?? firstStringArg(ctx, stripped, "setInputDirectory", module), ".");
  const output = cleanOrDefault(readDirString(module, "output") ?? firstStringArg(ctx, stripped, "setOutputDirectory", module), "_site");
  const data = cleanOrDefault(readDirString(module, "data") ?? firstStringArg(ctx, stripped, "setDataDirectory", module), "_data");
  const includes = cleanOrDefault(readDirString(module, "includes") ?? firstStringArg(ctx, stripped, "setIncludesDirectory", module), "_includes");
  const rawLayouts = readDirString(module, "layouts") ?? firstStringArg(ctx, stripped, "setLayoutsDirectory", module);
  const layouts = rawLayouts ? (safePath(rawLayouts) ?? null) : null;
  const pathPrefix = normalizePathPrefix(readConfigString(module, "pathPrefix") ?? firstStringArg(ctx, stripped, "setPathPrefix", module));
  const passthrough = stripped ? parsePassthroughCopies(ctx, stripped, input, module) : [];

  const state: EleventyState = { configFile, input, output, data, includes, layouts, pathPrefix, passthrough };

  states.set(ctx, state);
  return state;
}

function extractTagFromExpr(module: ParsedModule, expr: ModuleExpr | undefined): string | string[] | undefined {
  if (!expr) return undefined;
  const str = module.string(expr);

  if (str !== null) return str;
  const resolved = module.resolve(expr);

  if (resolved.kind === "array") {
    const tags = resolved.items.map((item) => module.string(item)).filter((item): item is string => item !== null);

    return tags.length > 0 ? tags : undefined;
  }
  return undefined;
}

function extractPermalinkFromExpr(module: ParsedModule, expr: ModuleExpr | undefined): string | false | "dynamic" | undefined {
  if (!expr) return undefined;
  const bool = module.boolean(expr);

  if (bool === false) return false;
  const str = module.string(expr);

  if (str !== null) return str;
  const resolved = module.resolve(expr);

  if (resolved.kind === "arrow" || resolved.kind === "call" || resolved.kind === "unknown") return "dynamic";
  return undefined;
}

/** Reads a folder's directory data file (`<dir>/<name>.11tydata.{json,js,cjs,mjs}` or `<dir>/<name>.json`). */
function directoryData(ctx: AdapterContext, folder: string): DirectoryData | null {
  if (folder === "" || folder === ".") return null;
  const name = folder.split("/").pop() ?? folder;

  for (const ext of DIR_DATA_EXTENSIONS) {
    const file = `${folder}/${name}${ext}`;

    if (!ctx.exists(file)) continue;
    if (ext.endsWith(".json")) {
      const data = ctx.readJson<Record<string, unknown>>(file);

      if (!data || typeof data !== "object" || Array.isArray(data)) continue;
      const out: DirectoryData = {};

      if (typeof data.tags === "string") out.tags = data.tags;
      else if (Array.isArray(data.tags)) {
        const list = data.tags.filter((item): item is string => typeof item === "string");

        if (list.length > 0) out.tags = list;
      }
      if (data.permalink === false) out.permalink = false;
      else if (typeof data.permalink === "string") out.permalink = data.permalink;
      return out;
    }
    const module = ctx.helpers.readModule(file);

    if (!module) continue;
    const obj = module.configObject();
    const out: DirectoryData = {};
    const tags = extractTagFromExpr(module, obj ? module.prop(obj, "tags") : module.exported("tags"));
    const permalink = extractPermalinkFromExpr(module, obj ? module.prop(obj, "permalink") : module.exported("permalink"));

    if (tags !== undefined) out.tags = tags;
    if (permalink !== undefined) out.permalink = permalink;
    if (out.tags !== undefined || out.permalink !== undefined) return out;
  }
  return null;
}

/** Converts an Eleventy permalink into a Galley URL pattern when it depends only on `page.fileSlug`. */
function patternFromPermalink(permalink: string): string | null {
  let pattern = permalink.trim().replace(/\{\{-?\s*page\.fileSlug(?:\s*\|\s*slugify)?\s*-?\}\}/g, "{slug}");

  if (/\{\{|\{%/.test(pattern)) return null;
  if ((pattern.match(/\{slug\}/g) ?? []).length !== 1) return null;
  pattern = pattern.replace(/\/index\.html?$/i, "/");
  if (!pattern.startsWith("/")) pattern = `/${pattern}`;
  pattern = pattern.replace(/\/{2,}/g, "/");
  if (/\s|[?#]/.test(pattern)) return null;
  return pattern;
}

function withPrefix(prefix: string, pattern: string): string {
  if (!prefix) return pattern;
  if (pattern === prefix || pattern.startsWith(`${prefix}/`)) return pattern;
  return `${prefix}${pattern}`.replace(/\/{2,}/g, "/");
}

function folderUrl(input: string, folder: string): string {
  const inner = input === "." ? folder : folder.startsWith(`${input}/`) ? folder.slice(input.length + 1) : folder;

  return inner === "" || inner === "." ? "/{slug}/" : `/${inner}/{slug}/`;
}

function excludedDirs(state: EleventyState): string[] {
  const dirs = [
    under(state.input, state.includes),
    under(state.input, state.data),
    state.layouts ? under(state.input, state.layouts) : null,
    state.output,
  ].filter((dir): dir is string => dir !== null && dir !== ".");

  return [...new Set(dirs)];
}

function isUnderAny(folder: string, dirs: string[]): boolean {
  return dirs.some((dir) => folder === dir || folder.startsWith(`${dir}/`));
}

function pickTagId(tags: string | string[] | undefined): string | null {
  const list = typeof tags === "string" ? [tags] : Array.isArray(tags) ? tags : [];
  const valid = list.filter((tag) => /^[\w-]+$/.test(tag));

  return valid.find((tag) => tag !== "all") ?? valid[0] ?? null;
}

export const eleventyAdapter = defineAdapter({
  id: "eleventy",
  name: "Eleventy",
  apiVersion: ADAPTER_API_VERSION,

  detect(ctx) {
    const range = ctx.hasDependency("@11ty/eleventy");
    const config = CONFIG_FILES.find((file) => ctx.exists(file));

    if (range === null && !config) return null;
    const version = range === null ? null : ctx.dependencyVersion("@11ty/eleventy");
    const confidence = range !== null && config ? 0.95 : range !== null ? 0.9 : 0.8;

    return version ? { confidence, version } : { confidence };
  },

  conventions(ctx): AdapterConventions {
    const state = stateOf(ctx);
    const dataDir = under(state.input, state.data);
    const existingPassthrough = state.passthrough.filter((entry) => ctx.isDirectory(entry.dir));
    const rootServed = existingPassthrough.find((entry) => entry.publicPath === "/");
    const mediaSpecific = existingPassthrough.filter((entry) => entry.publicPath !== "/");
    const mediaRoots = [...mediaSpecific, ...existingPassthrough.filter((entry) => entry.publicPath === "/")].map((entry) => ({
      dir: entry.dir,
      publicPath: entry.publicPath,
    }));

    const conventions: AdapterConventions = {
      dev: { command: "npx @11ty/eleventy --serve", port: 8080 },
      build: { command: "npx @11ty/eleventy", outDir: state.output },
      ...(rootServed ? { publicDir: rootServed.dir } : { publicDir: "public" }),
      contentDirs: [state.input],
      pageDirs: [state.input],
      ...(dataDir ? { dataDirs: [dataDir] } : {}),
    };

    if (mediaSpecific.length > 0) {
      conventions.media = {
        dir: mediaSpecific[0]!.dir,
        publicPath: mediaSpecific[0]!.publicPath,
        roots: mediaRoots,
      };
    }
    return conventions;
  },

  collections(ctx): CollectionDraft[] {
    const state = stateOf(ctx);
    const skip = excludedDirs(state);
    const dataDir = under(state.input, state.data);
    const drafts: CollectionDraft[] = [];
    const usedIds = new Set<string>();
    const claimedFolders = new Set<string>();

    const dataFileGlobs = ["**/*.11tydata.json", "**/*.11tydata.js", "**/*.11tydata.cjs", "**/*.11tydata.mjs", "**/*.json"];
    const globOpts = state.input === "." ? {} : { cwd: state.input };

    for (const file of ctx.glob(dataFileGlobs, globOpts)) {
      const parts = file.split("/");
      const folder = parts.slice(0, -1).join("/");
      const baseName = parts.at(-1)!.replace(/(\.11tydata)?\.(json|js|cjs|mjs)$/, "");

      if (folder === "" || folder.split("/").pop() !== baseName) continue;
      if (claimedFolders.has(folder) || isUnderAny(folder, skip)) continue;
      if (ctx.glob("**/*.{md,mdx,markdown}", { cwd: folder, limit: 1 }).length === 0) continue;

      const data = directoryData(ctx, folder);
      const preferred = pickTagId(data?.tags) ?? baseName;
      let id = preferred;

      if (usedIds.has(id)) id = folder.replace(/\//g, "-");
      if (usedIds.has(id)) continue;
      usedIds.add(id);
      claimedFolders.add(folder);

      drafts.push({
        id,
        path: folder,
        pattern: "**/*.{md,mdx,markdown}",
        format: "markdown",
      });
    }

    const found = ctx.helpers.markdownCollections({
      roots: [state.input],
      pageDirs: [state.input],
      claimed: [...claimedFolders, ...skip],
    });

    for (const draft of found) {
      if (usedIds.has(draft.id)) {
        draft.id = draft.path.replace(/^_+/, "").replace(/\//g, "-") || draft.id;
      }
      usedIds.add(draft.id);
    }

    const data = dataDir && ctx.isDirectory(dataDir) ? ctx.helpers.dataCollections([dataDir]) : [];

    for (const draft of data) {
      if (usedIds.has(draft.id)) draft.id = `${draft.id}-data`;
      usedIds.add(draft.id);
    }

    if (drafts.length > 0) {
      ctx.note(`Found ${drafts.length} Eleventy collection${drafts.length === 1 ? "" : "s"} from directory data files.`);
    }
    return [...drafts, ...found, ...data];
  },

  routes(ctx, collections: Collection[]): Record<string, string | null> {
    const state = stateOf(ctx);
    const urls: Record<string, string | null> = {};

    for (const collection of collections) {
      if (collection.kind === "data") {
        urls[collection.id] = null;
        continue;
      }
      const data = directoryData(ctx, collection.path);
      const permalink = data?.permalink;

      if (permalink === false) {
        urls[collection.id] = null;
      } else if (permalink === "dynamic") {
        ctx.note(`The “${collection.label}” permalink is computed by code, so its pages could not be matched to their files.`);
        urls[collection.id] = null;
      } else if (typeof permalink === "string") {
        const pattern = patternFromPermalink(permalink);

        if (!pattern) {
          ctx.note(`The “${collection.label}” permalink (${permalink}) is built from more than the file name, so its pages could not be matched to their files.`);
          urls[collection.id] = null;
        } else {
          urls[collection.id] = withPrefix(state.pathPrefix, pattern);
        }
      } else if (collection.path === state.input) {
        urls[collection.id] = withPrefix(state.pathPrefix, "/{slug}/");
      } else {
        urls[collection.id] = withPrefix(state.pathPrefix, folderUrl(state.input, collection.path));
      }
    }
    return urls;
  },
});
