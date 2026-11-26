/**
 * The Nuxt adapter — reads `nuxt.config.{ts,js,mjs}` and `@nuxt/content` v3
 * `content.config.{ts,js,mjs}` statically (never executes site code) using
 * only the public adapter API.
 *
 * What it reads:
 * - `nuxt.config.*`: `srcDir`, `dir.public`, `nitro.output.publicDir`,
 *   `app.baseURL`, `router.options.strict`, `devServer.port`, `site.url`,
 *   and `@nuxt/content` v2 `content.sources` (local `fs` sources);
 * - `@nuxt/content` v3 `content.config.*`: `defineCollection({ type, source, schema })`
 *   collections (page and data, string globs or `{ include, prefix, cwd }` objects,
 *   plus Zod schemas via `ctx.helpers.fieldsFromZod`);
 * - `.data/content/contents.sqlite` (Nuxt Content v3 SQLite cache file) in
 *   `forgetPreviewSaves` when present.
 */
import { ADAPTER_API_VERSION, defineAdapter } from "../../adapter/define";
import type { AdapterContext, AdapterConventions, CollectionDraft, ModuleExpr, ParsedModule } from "../../adapter/types";
import type { Collection, Field } from "../../types";
import {
  formatFromPattern,
  formatRoute,
  joinSafe,
  normalizeBasePath,
  productionUrl,
  readBooleanProp,
  readPathExpr,
  readPortProp,
  readStringProp,
  safePath,
  splitGlobPattern,
  toCollectionId,
} from "../shared";

const NUXT_CONFIG_FILES = ["nuxt.config.ts", "nuxt.config.js", "nuxt.config.mjs", "nuxt.config.mts", "nuxt.config.cjs"] as const;
const CONTENT_CONFIG_NAMES = ["content.config.ts", "content.config.js", "content.config.mjs", "content.config.mts"] as const;
const PREVIEW_CACHE_FILES = [".data/content/contents.sqlite", ".data/content/contents.sqlite-wal", ".data/content/contents.sqlite-shm"] as const;
const DEFAULT_PORT = 3000;

interface V2Source {
  id: string;
  base: string;
  prefix: string;
}

interface NuxtState {
  configFile: string | null;
  srcDir: string;
  publicDir: string;
  outDir: string;
  basePath: string;
  trailingSlash?: boolean;
  port: number;
  siteUrl?: string;
  v2Sources: V2Source[];
  routeById: Map<string, string | null>;
  notes: string[];
}

const states = new WeakMap<AdapterContext, NuxtState>();

function readV2Sources(module: ParsedModule, config: ModuleExpr, file: string, notes: string[]): V2Source[] {
  const contentObj = module.prop(config, "content");
  const sourcesObj = contentObj ? module.prop(contentObj, "sources") : undefined;

  if (!sourcesObj || sourcesObj.kind !== "object") return [];
  const out: V2Source[] = [];

  for (const prop of sourcesObj.props) {
    if (!("key" in prop)) continue;
    const item = module.resolve(prop.value);

    if (item.kind !== "object") continue;
    const driver = module.string(module.prop(item, "driver"));

    if (driver && driver !== "fs") {
      notes.push(`${file}: content source “${prop.key}” uses the “${driver}” driver, so it was left out.`);
      continue;
    }
    const base = readPathExpr(module, module.prop(item, "base"));

    if (!base) continue;
    const prefix = module.string(module.prop(item, "prefix")) ?? `/${toCollectionId(prop.key)}`;

    out.push({ id: toCollectionId(prop.key), base, prefix });
  }
  return out;
}

function readState(ctx: AdapterContext): NuxtState {
  const cached = states.get(ctx);

  if (cached) return cached;
  const configFile = NUXT_CONFIG_FILES.find((file) => ctx.exists(file)) ?? null;
  const module = configFile ? ctx.helpers.readModule(configFile) : null;
  const config = module?.configObject();
  const notes: string[] = [];

  let srcDir = ".";
  let publicDirRaw: string | undefined;
  let outDir = ".output/public";
  let baseURL: string | undefined;
  let trailingSlash: boolean | undefined;
  let port = DEFAULT_PORT;
  let siteUrl: string | undefined;
  let v2Sources: V2Source[] = [];

  if (module && config && configFile) {
    const rawSrc = readStringProp(module, config, "srcDir", "source folder", configFile, notes);

    if (rawSrc) srcDir = safePath(rawSrc) ?? ".";
    const dirObj = module.prop(config, "dir");

    publicDirRaw = readStringProp(module, dirObj, "public", "public folder", configFile, notes);

    const nitroObj = module.prop(config, "nitro");
    const nitroOut = nitroObj ? module.prop(nitroObj, "output") : undefined;
    const rawOutDir = readStringProp(module, nitroOut, "publicDir", "build output folder", configFile, notes);

    if (rawOutDir) outDir = safePath(rawOutDir) ?? outDir;

    const appObj = module.prop(config, "app");

    baseURL = readStringProp(module, appObj, "baseURL", "base URL", configFile, notes);

    const routerObj = module.prop(config, "router");
    const routerOpts = routerObj ? module.prop(routerObj, "options") : undefined;
    const strict = readBooleanProp(module, routerOpts, "strict", "strict trailing-slash setting", configFile, notes);

    if (strict === true) trailingSlash = false;
    const explicitSlash = readBooleanProp(module, config, "trailingSlash", "trailing-slash setting", configFile, notes);

    if (explicitSlash !== undefined) trailingSlash = explicitSlash;

    const devServer = module.prop(config, "devServer");
    const rawPort = readPortProp(module, devServer, "port", configFile, notes);

    if (rawPort !== undefined) port = rawPort;

    const siteObj = module.prop(config, "site");

    siteUrl = readStringProp(module, siteObj, "url", "site address", configFile, notes);
    v2Sources = readV2Sources(module, config, configFile, notes);
  }

  // Resolve publicDir under root or srcDir per Nuxt rules.
  let publicDir = "public";

  if (publicDirRaw) {
    const cleaned = safePath(publicDirRaw) ?? "public";
    const underSrc = srcDir !== "." ? joinSafe(srcDir, cleaned) : null;

    if (underSrc && ctx.isDirectory(underSrc)) publicDir = underSrc;
    else publicDir = cleaned;
  } else if (srcDir !== ".") {
    const underSrc = joinSafe(srcDir, "public");

    if (underSrc && ctx.isDirectory(underSrc) && !ctx.isDirectory("public")) publicDir = underSrc;
  }

  const state: NuxtState = {
    configFile,
    srcDir,
    publicDir,
    outDir,
    basePath: normalizeBasePath(baseURL),
    ...(trailingSlash !== undefined ? { trailingSlash } : {}),
    port,
    ...(siteUrl ? { siteUrl } : {}),
    v2Sources,
    routeById: new Map(),
    notes,
  };

  states.set(ctx, state);
  return state;
}

interface ParsedSource {
  include: string;
  prefix?: string;
  cwd?: string;
}

function parseV3Source(module: ParsedModule, expr: ModuleExpr | undefined, id: string, file: string, ctx: AdapterContext): ParsedSource | null {
  if (!expr) return null;
  const resolved = module.resolve(expr);
  const direct = module.string(resolved);

  if (direct !== null) return { include: direct };
  if (resolved.kind === "object") {
    if (module.prop(resolved, "repository")) {
      ctx.note(`${file}: the “${id}” collection comes from a remote repository, so it was left out.`);
      return null;
    }
    const include = module.string(module.prop(resolved, "include"));

    if (!include) return null;
    const prefix = module.string(module.prop(resolved, "prefix")) ?? undefined;
    const cwd = readPathExpr(module, module.prop(resolved, "cwd")) ?? undefined;

    return { include, ...(prefix !== undefined ? { prefix } : {}), ...(cwd !== undefined ? { cwd } : {}) };
  }
  if (resolved.kind === "array") {
    for (const item of resolved.items) {
      const parsed = parseV3Source(module, item, id, file, ctx);

      if (parsed) return parsed;
    }
  }
  return null;
}

function readContentV3Config(ctx: AdapterContext, state: NuxtState): CollectionDraft[] | null {
  const candidates = [...CONTENT_CONFIG_NAMES];

  if (state.srcDir !== ".") {
    for (const name of CONTENT_CONFIG_NAMES) {
      const under = joinSafe(state.srcDir, name);

      if (under) candidates.push(under as (typeof CONTENT_CONFIG_NAMES)[number]);
    }
  }
  const configFile = candidates.find((file) => ctx.exists(file));

  if (!configFile) return null;
  const module = ctx.helpers.readModule(configFile);

  if (!module) {
    ctx.note(`${configFile} could not be read; content folders were scanned instead.`);
    return null;
  }
  const configObj = module.configObject();
  const collectionsExpr = (configObj ? module.prop(configObj, "collections") : undefined) ?? module.exported("collections");

  if (!collectionsExpr || collectionsExpr.kind !== "object") return null;

  const defaultContentBase = ctx.isDirectory("content")
    ? "content"
    : state.srcDir !== "." && ctx.isDirectory(joinSafe(state.srcDir, "content") ?? "content")
      ? joinSafe(state.srcDir, "content")!
      : "content";
  const drafts: CollectionDraft[] = [];

  for (const prop of collectionsExpr.props) {
    if (!("key" in prop)) continue;
    const id = toCollectionId(prop.key);
    let decl = module.resolve(prop.value);

    if (decl.kind === "call" && decl.args[0]) decl = module.resolve(decl.args[0]);
    if (decl.kind !== "object") continue;

    const type = module.string(module.prop(decl, "type")) === "data" ? "data" : "page";
    const source = parseV3Source(module, module.prop(decl, "source"), id, configFile, ctx);

    if (!source) continue;

    const baseDir = source.cwd ?? defaultContentBase;
    const defaultPattern = type === "data" ? "**/*.{json,yaml,yml}" : "**/*.{md,mdx,markdown}";
    const target = splitGlobPattern(baseDir, source.include, defaultPattern);

    if (!target) continue;

    const schemaExpr = module.prop(decl, "schema");
    let fields: Field[] | null = null;

    if (schemaExpr) {
      try {
        fields = ctx.helpers.fieldsFromZod(schemaExpr, module);
      } catch {
        fields = null;
      }
    }

    if (target.isSingleFile) {
      if (!ctx.exists(target.path) || ctx.isDirectory(target.path)) continue;
      const format = formatFromPattern(target.path, "json");
      const data = ctx.readData(target.path);
      const isList = Array.isArray(data);
      const fileFields =
        fields && isList
          ? [{ key: "items", label: "Items", type: "list" as const, required: true, source: "schema" as const, of: { key: "item", label: "Item", type: "object" as const, required: true, source: "schema" as const, fields } }]
          : fields;

      drafts.push({
        id,
        kind: "data",
        path: target.path,
        format,
        body: false,
        url: null,
        create: false,
        ...(fileFields ? { fields: fileFields, source: "schema" } : { source: "inferred" }),
      });
      state.routeById.set(id, null);
      continue;
    }

    if (!ctx.isDirectory(target.path)) continue;
    const format = formatFromPattern(target.pattern, type === "data" ? "json" : "markdown");
    const isData = type === "data" || format === "json" || format === "yaml" || format === "toml";

    drafts.push({
      id,
      kind: "entries",
      path: target.path,
      ...(target.pattern ? { pattern: target.pattern } : {}),
      format,
      body: !isData,
      create: true,
      ...(isData ? { url: null } : {}),
      ...(fields ? { fields, source: "schema" } : { source: "inferred" }),
    });

    if (isData) {
      state.routeById.set(id, null);
    } else if (source.prefix !== undefined) {
      const cleanPrefix = normalizeBasePath(source.prefix);

      state.routeById.set(id, cleanPrefix === "" ? "/{slug}/" : `${cleanPrefix}/{slug}/`);
    } else if (target.path === baseDir) {
      state.routeById.set(id, "/{slug}/");
    } else {
      const inner = target.path.startsWith(`${baseDir}/`) ? target.path.slice(baseDir.length + 1) : target.path;

      state.routeById.set(id, `/${inner}/{slug}/`);
    }
  }

  if (drafts.length > 0) {
    ctx.note(`Read ${drafts.length} collection${drafts.length === 1 ? "" : "s"} from ${configFile}.`);
    return drafts;
  }
  return null;
}

export const nuxtAdapter = defineAdapter({
  id: "nuxt",
  name: "Nuxt",
  apiVersion: ADAPTER_API_VERSION,

  detect(ctx) {
    const nuxtRange = ctx.hasDependency("nuxt");
    const contentRange = ctx.hasDependency("@nuxt/content");
    const hasPkg = nuxtRange !== null || contentRange !== null;
    const file = NUXT_CONFIG_FILES.find((name) => ctx.exists(name));

    if (!file && !hasPkg) return null;
    const version = nuxtRange !== null ? ctx.dependencyVersion("nuxt") : contentRange !== null ? ctx.dependencyVersion("@nuxt/content") : null;
    const confidence = file && hasPkg ? 0.95 : hasPkg ? 0.9 : 0.8;

    return version ? { confidence, version } : { confidence };
  },

  forgetPreviewSaves(ctx) {
    return PREVIEW_CACHE_FILES.filter((file) => ctx.exists(file) && !ctx.isDirectory(file));
  },

  conventions(ctx): AdapterConventions {
    const state = readState(ctx);

    for (const note of state.notes) ctx.note(note);
    const contentDirs = [...new Set(["content", ...(state.srcDir !== "." ? [joinSafe(state.srcDir, "content") ?? "content"] : []), ...state.v2Sources.map((s) => s.base)])];
    const dataDirs = [...new Set(["data", "content/data", ...(state.srcDir !== "." ? [joinSafe(state.srcDir, "data") ?? "data"] : [])])];
    const production = productionUrl(ctx, state.siteUrl, state.configFile);
    const conventions: AdapterConventions = {
      dev: { port: state.port },
      build: { outDir: state.outDir },
      publicDir: state.publicDir,
      contentDirs,
      pageDirs: ["content"],
      dataDirs,
    };

    if (state.trailingSlash !== undefined) conventions.trailingSlash = state.trailingSlash;
    if (production) conventions.urls = { production };
    const pagesDir = state.srcDir === "." ? "pages" : (joinSafe(state.srcDir, "pages") ?? "pages");

    if (ctx.isDirectory(pagesDir)) conventions.routesDir = pagesDir;
    return conventions;
  },

  collections(ctx): CollectionDraft[] | null {
    const state = readState(ctx);

    state.routeById.clear();

    // 1. @nuxt/content v3 `content.config.*`
    const v3 = readContentV3Config(ctx, state);

    if (v3 && v3.length > 0) return v3;

    // 2. @nuxt/content v2 `content.sources` in nuxt.config.*
    if (state.v2Sources.length > 0) {
      const drafts: CollectionDraft[] = [];
      const claimed: string[] = [];

      for (const source of state.v2Sources) {
        if (!ctx.isDirectory(source.base)) continue;
        drafts.push({
          id: source.id,
          kind: "entries",
          path: source.base,
          pattern: "**/*.{md,mdx,markdown}",
          format: "markdown",
          body: true,
          source: "inferred",
        });
        claimed.push(source.base);
        const cleanPrefix = normalizeBasePath(source.prefix);

        state.routeById.set(source.id, cleanPrefix === "" ? "/{slug}/" : `${cleanPrefix}/{slug}/`);
      }
      const extra = ctx.helpers.markdownCollections({
        roots: ["content"],
        pageDirs: ["content"],
        claimed,
        ...(state.trailingSlash !== undefined ? { trailingSlash: state.trailingSlash } : {}),
      });

      return [...drafts, ...extra];
    }

    // 3. Conventional fallback over `content/`.
    return null;
  },

  routes(ctx, collections: Collection[]): Record<string, string | null> {
    const state = readState(ctx);
    const trailingSlash = state.trailingSlash ?? true;
    const urls: Record<string, string | null> = {};

    for (const collection of collections) {
      if (collection.kind === "data") {
        urls[collection.id] = null;
        continue;
      }
      if (state.routeById.has(collection.id)) {
        const raw = state.routeById.get(collection.id);

        urls[collection.id] = raw === null ? null : formatRoute(raw!, { base: state.basePath, trailingSlash });
        continue;
      }
      if (collection.url) {
        urls[collection.id] = formatRoute(collection.url, { base: state.basePath, trailingSlash });
      }
    }
    return urls;
  },
});
