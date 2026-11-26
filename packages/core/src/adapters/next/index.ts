/**
 * The Next.js adapter — reads `next.config.{ts,mjs,js,cjs}`, Contentlayer
 * (`contentlayer.config.*`), and Velite (`velite.config.*`) statically (never
 * executes site code) using only the public adapter API.
 *
 * What it reads:
 * - `next.config.*` (including wrapped configs such as `withMDX(nextConfig)`
 *   and `withContentlayer(nextConfig)`): `output`, `distDir`, `trailingSlash`,
 *   `basePath`, `pageExtensions`;
 * - Contentlayer `contentlayer.config.{ts,js,mjs}`: `contentDirPath` and
 *   `defineDocumentType` (`filePathPattern`, `contentType`);
 * - Velite `velite.config.{ts,js,mjs}`: `root` and `defineCollection` (`pattern`);
 * - MDX route pages (`pages/**\/*.{md,mdx}` or `app/**\/page.{md,mdx}`) when
 *   MDX page extensions or `@next/mdx` are configured, plus conventional
 *   markdown and data folders.
 */
import { ADAPTER_API_VERSION, defineAdapter } from "../../adapter/define";
import type { AdapterContext, AdapterConventions, CollectionDraft, ModuleExpr, ParsedModule } from "../../adapter/types";
import type { Collection } from "../../types";
import {
  formatFromPattern,
  formatRoute,
  markdownFormatForFiles,
  normalizeBasePath,
  readBooleanProp,
  readPathExpr,
  readStringArray,
  readStringProp,
  safePath,
  splitGlobPattern,
  toCollectionId,
} from "../shared";

const NEXT_CONFIG_FILES = ["next.config.ts", "next.config.mjs", "next.config.js", "next.config.cjs"] as const;
const CONTENTLAYER_FILES = ["contentlayer.config.ts", "contentlayer.config.js", "contentlayer.config.mjs"] as const;
const VELITE_FILES = ["velite.config.ts", "velite.config.js", "velite.config.mjs"] as const;
const CONTENT_DIRS = ["content", "posts", "_posts", "src/content", "data/blog"] as const;
const DATA_DIRS = ["data", "src/data"] as const;
const DEFAULT_PORT = 3000;

interface NextState {
  configFile: string | null;
  output?: string;
  distDir?: string;
  outDir: string;
  trailingSlash: boolean;
  basePath: string;
  pageExtensions: string[];
  mdxPagesEnabled: boolean;
  routeById: Map<string, string | null>;
  notes: string[];
}

const states = new WeakMap<AdapterContext, NextState>();

/** Finds the Next.js config object, unwrapping wrapper calls like `withMDX(nextConfig)` or top-level `nextConfig` bindings. */
function findNextConfigObject(module: ParsedModule): ModuleExpr | undefined {
  const direct = module.configObject();

  if (direct && direct.kind === "object") return direct;
  // Unwrap chained wrapper calls like `withContentlayer(withMDX(nextConfig))` or `withNextra(opts)(nextConfig)`.
  let expr = module.exported("default");

  for (let guard = 0; expr && guard < 10; guard += 1) {
    expr = module.resolve(expr);
    if (expr.kind === "object") return expr;
    if (expr.kind === "call") {
      // Try arguments from last to first (some wrappers take `(options, nextConfig)` or `(nextConfig)`).
      const candidate = expr.args.find((arg) => {
        const r = module.resolve(arg);

        return r.kind === "object" || r.kind === "call";
      });

      expr = candidate ?? expr.args[0];
    } else if (expr.kind === "arrow") {
      expr = expr.body;
    } else {
      break;
    }
  }
  // Fallback: look for a top-level `nextConfig` or `config` object declaration (e.g. referenced inside a function body).
  for (const name of ["nextConfig", "config"]) {
    const binding = module.scope.get(name);

    if (binding) {
      const resolved = module.resolve(binding);

      if (resolved.kind === "object") return resolved;
    }
  }
  return undefined;
}

function textFallback(text: string): {
  output?: string;
  distDir?: string;
  trailingSlash?: boolean;
  basePath?: string;
  pageExtensions?: string[];
} {
  const output = /\boutput\s*:\s*["']([^"']+)["']/.exec(text)?.[1];
  const distDir = /\bdistDir\s*:\s*["']([^"']+)["']/.exec(text)?.[1];
  const slashMatch = /\btrailingSlash\s*:\s*(true|false)\b/.exec(text);
  const basePath = /\bbasePath\s*:\s*["']([^"']+)["']/.exec(text)?.[1];
  const extMatch = /\bpageExtensions\s*:\s*\[([^\]]+)\]/.exec(text);
  const pageExtensions = extMatch
    ? [...extMatch[1]!.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]!)
    : undefined;

  return {
    ...(output ? { output } : {}),
    ...(distDir ? { distDir } : {}),
    ...(slashMatch ? { trailingSlash: slashMatch[1] === "true" } : {}),
    ...(basePath ? { basePath } : {}),
    ...(pageExtensions && pageExtensions.length > 0 ? { pageExtensions } : {}),
  };
}

function readState(ctx: AdapterContext): NextState {
  const cached = states.get(ctx);

  if (cached) return cached;
  const configFile = NEXT_CONFIG_FILES.find((file) => ctx.exists(file)) ?? null;
  const rawText = configFile ? (ctx.readText(configFile) ?? "") : "";
  const module = configFile ? ctx.helpers.readModule(configFile) : null;
  const config = module ? findNextConfigObject(module) : undefined;
  const notes: string[] = [];

  let output: string | undefined;
  let distDir: string | undefined;
  let trailingSlash: boolean | undefined;
  let basePath: string | undefined;
  let pageExtensions: string[] = [];

  if (module && config && configFile) {
    output = readStringProp(module, config, "output", "output mode", configFile, notes);
    distDir = readStringProp(module, config, "distDir", "build output folder", configFile, notes);
    trailingSlash = readBooleanProp(module, config, "trailingSlash", "trailing-slash setting", configFile, notes);
    basePath = readStringProp(module, config, "basePath", "base path", configFile, notes);
    pageExtensions = readStringArray(module, module.prop(config, "pageExtensions")) ?? [];
  } else if (configFile && rawText) {
    const fb = textFallback(rawText);

    output = fb.output;
    distDir = fb.distDir;
    trailingSlash = fb.trailingSlash;
    basePath = fb.basePath;
    pageExtensions = fb.pageExtensions ?? [];
  }

  const outDir = output === "export" ? "out" : (distDir ? safePath(distDir) : null) ?? ".next";
  const mdxInExtensions = pageExtensions.some((ext) => /^(?:md|mdx|markdown)$/i.test(ext.replace(/^\./, "")));
  const mdxPagesEnabled = mdxInExtensions || ctx.hasDependency("@next/mdx") !== null || /\b(?:withMDX|createMDX)\b|@next\/mdx/.test(rawText);

  const state: NextState = {
    configFile,
    ...(output ? { output } : {}),
    ...(distDir ? { distDir } : {}),
    outDir,
    trailingSlash: trailingSlash ?? false,
    basePath: normalizeBasePath(basePath),
    pageExtensions,
    mdxPagesEnabled,
    routeById: new Map(),
    notes,
  };

  states.set(ctx, state);
  return state;
}

/** Reads Contentlayer `contentlayer.config.{ts,js,mjs}` document types statically. */
function readContentlayer(ctx: AdapterContext, state: NextState, seenIds: Set<string>, claimed: string[]): CollectionDraft[] {
  const file = CONTENTLAYER_FILES.find((candidate) => ctx.exists(candidate));

  if (!file) return [];
  const module = ctx.helpers.readModule(file);

  if (!module) {
    ctx.note(`${file} could not be read; content folders were scanned instead.`);
    return [];
  }
  const configObj = module.configObject();
  const contentDirPath = (configObj ? readPathExpr(module, module.prop(configObj, "contentDirPath")) : null) ?? "content";
  const docTypesExpr = configObj ? module.prop(configObj, "documentTypes") : undefined;
  const docExprs: ModuleExpr[] = [];

  if (docTypesExpr && docTypesExpr.kind === "array") {
    docExprs.push(...docTypesExpr.items);
  } else {
    // Also inspect top-level `defineDocumentType(...)` declarations when `documentTypes` is non-literal.
    for (const value of module.scope.values()) {
      if (module.callee(value) === "defineDocumentType") docExprs.push(value);
    }
  }

  const drafts: CollectionDraft[] = [];

  for (const item of docExprs) {
    let decl = module.resolve(item);

    if (decl.kind === "call" && decl.args[0]) decl = module.resolve(decl.args[0]);
    if (decl.kind === "arrow") decl = module.resolve(decl.body);
    if (decl.kind !== "object") continue;

    const name = module.string(module.prop(decl, "name"));
    const contentType = module.string(module.prop(decl, "contentType")) ?? "markdown";
    const filePathPattern = module.string(module.prop(decl, "filePathPattern"));
    const defaultPattern = contentType === "data" ? "**/*.{json,yaml,yml}" : contentType === "mdx" ? "**/*.mdx" : "**/*.{md,mdx}";
    const target = splitGlobPattern(contentDirPath, filePathPattern ?? defaultPattern, defaultPattern);

    if (!target) continue;

    const folderId = target.path !== contentDirPath ? target.path.split("/").pop() : null;
    let id = toCollectionId(folderId || name || "content");

    if (seenIds.has(id)) id = toCollectionId(name || target.path);
    if (seenIds.has(id)) continue;

    if (target.isSingleFile) {
      if (!ctx.exists(target.path) || ctx.isDirectory(target.path)) continue;
      seenIds.add(id);
      claimed.push(target.path);
      drafts.push({
        id,
        kind: "data",
        path: target.path,
        format: formatFromPattern(target.path, "json"),
        body: false,
        url: null,
        create: false,
        source: "inferred",
      });
      state.routeById.set(id, null);
      continue;
    }

    if (!ctx.isDirectory(target.path)) continue;
    const isData = contentType === "data";
    const format = isData
      ? formatFromPattern(target.pattern, "json")
      : contentType === "mdx"
        ? "mdx"
        : formatFromPattern(target.pattern, "markdown");

    seenIds.add(id);
    claimed.push(target.path);
    drafts.push({
      id,
      kind: "entries",
      path: target.path,
      ...(target.pattern ? { pattern: target.pattern } : {}),
      format,
      body: !isData,
      create: true,
      ...(isData ? { url: null } : {}),
      source: "inferred",
    });
    state.routeById.set(id, isData ? null : id === "pages" ? "/{slug}/" : `/${id}/{slug}/`);
  }

  if (drafts.length > 0) {
    ctx.note(`Read ${drafts.length} collection${drafts.length === 1 ? "" : "s"} from ${file}.`);
  }
  return drafts;
}

/** Reads Velite `velite.config.{ts,js,mjs}` collections statically. */
function readVelite(ctx: AdapterContext, state: NextState, seenIds: Set<string>, claimed: string[]): CollectionDraft[] {
  const file = VELITE_FILES.find((candidate) => ctx.exists(candidate));

  if (!file) return [];
  const module = ctx.helpers.readModule(file);

  if (!module) {
    ctx.note(`${file} could not be read; content folders were scanned instead.`);
    return [];
  }
  const configObj = module.configObject();

  if (!configObj || configObj.kind !== "object") return [];
  const veliteRoot = readPathExpr(module, module.prop(configObj, "root")) ?? "content";
  const collectionsObj = module.prop(configObj, "collections");

  if (!collectionsObj || collectionsObj.kind !== "object") return [];

  const drafts: CollectionDraft[] = [];

  for (const prop of collectionsObj.props) {
    if (!("key" in prop)) continue;
    const id = toCollectionId(prop.key);

    if (seenIds.has(id)) continue;
    let decl = module.resolve(prop.value);

    if (decl.kind === "call" && decl.args[0]) decl = module.resolve(decl.args[0]);
    if (decl.kind !== "object") continue;

    const patternExpr = module.prop(decl, "pattern");
    let rawPattern = module.string(patternExpr);

    if (rawPattern === null && patternExpr && patternExpr.kind === "array") {
      rawPattern = patternExpr.items.map((item) => module.string(item)).find((s): s is string => s !== null && !s.startsWith("!")) ?? null;
    }
    if (!rawPattern) continue;

    const single = module.boolean(module.prop(decl, "single")) === true;
    const target = splitGlobPattern(veliteRoot, rawPattern, "**/*.{md,mdx}");

    if (!target) continue;

    if (target.isSingleFile || (single && ctx.exists(target.path) && !ctx.isDirectory(target.path))) {
      if (!ctx.exists(target.path) || ctx.isDirectory(target.path)) continue;
      seenIds.add(id);
      claimed.push(target.path);
      drafts.push({
        id,
        kind: "data",
        path: target.path,
        format: formatFromPattern(target.path, "json"),
        body: false,
        url: null,
        create: false,
        source: "inferred",
      });
      state.routeById.set(id, null);
      continue;
    }

    if (!ctx.isDirectory(target.path)) continue;
    const format = formatFromPattern(target.pattern, "markdown");
    const isData = format === "json" || format === "yaml" || format === "toml";

    seenIds.add(id);
    claimed.push(target.path);
    drafts.push({
      id,
      kind: "entries",
      path: target.path,
      ...(target.pattern ? { pattern: target.pattern } : {}),
      format,
      body: !isData,
      create: true,
      ...(isData ? { url: null } : {}),
      source: "inferred",
    });
    state.routeById.set(id, isData ? null : id === "pages" ? "/{slug}/" : `/${id}/{slug}/`);
  }

  if (drafts.length > 0) {
    ctx.note(`Read ${drafts.length} collection${drafts.length === 1 ? "" : "s"} from ${file}.`);
  }
  return drafts;
}

/** Finds MDX/Markdown route pages under Next.js Pages Router (`pages/`) or App Router (`app/`). */
function readMdxRoutePages(ctx: AdapterContext, state: NextState, seenIds: Set<string>, claimed: string[]): CollectionDraft[] {
  if (!state.mdxPagesEnabled) return [];
  const drafts: CollectionDraft[] = [];

  const pagesDir = ["src/pages", "pages"].find((dir) => ctx.isDirectory(dir));

  if (pagesDir && !claimed.includes(pagesDir)) {
    const files = ctx
      .glob("**/*.{md,mdx}", { cwd: pagesDir, limit: 100 })
      .filter((file) => !/(^|\/)(?:_app|_document|_error)\./.test(file) && !file.startsWith(`${pagesDir}/api/`));

    if (files.length > 0) {
      const id = seenIds.has("pages") ? "route-pages" : "pages";

      seenIds.add(id);
      claimed.push(pagesDir);
      drafts.push({
        id,
        label: "Pages",
        singular: "page",
        kind: "entries",
        path: pagesDir,
        pattern: "**/*.{md,mdx}",
        format: markdownFormatForFiles(files),
        body: true,
        source: "inferred",
      });
      state.routeById.set(id, "/{slug}/");
    }
  }

  const appDir = ["src/app", "app"].find((dir) => ctx.isDirectory(dir));

  if (appDir && !claimed.includes(appDir)) {
    const files = ctx.glob("**/page.{md,mdx}", { cwd: appDir, limit: 100 });

    if (files.length > 0) {
      const id = seenIds.has("pages") ? "app-pages" : "pages";

      seenIds.add(id);
      claimed.push(appDir);
      drafts.push({
        id,
        label: "Pages",
        singular: "page",
        kind: "entries",
        path: appDir,
        pattern: "**/page.{md,mdx}",
        format: markdownFormatForFiles(files),
        body: true,
        url: null,
        source: "inferred",
      });
      state.routeById.set(id, null);
    }
  }

  return drafts;
}

export const nextAdapter = defineAdapter({
  id: "next",
  name: "Next.js",
  apiVersion: ADAPTER_API_VERSION,

  detect(ctx) {
    const range = ctx.hasDependency("next");
    const file = NEXT_CONFIG_FILES.find((name) => ctx.exists(name));

    if (!file && range === null) return null;
    const version = range !== null ? ctx.dependencyVersion("next") : null;
    const confidence = file && range !== null ? 0.95 : range !== null ? 0.9 : 0.8;

    return version ? { confidence, version } : { confidence };
  },

  conventions(ctx): AdapterConventions {
    const state = readState(ctx);

    for (const note of state.notes) ctx.note(note);
    const routesDir = ["src/app", "app", "src/pages", "pages"].find((dir) => ctx.isDirectory(dir));

    return {
      dev: { port: DEFAULT_PORT },
      build: { outDir: state.outDir },
      publicDir: "public",
      trailingSlash: state.trailingSlash,
      ...(routesDir ? { routesDir } : {}),
      contentDirs: [...CONTENT_DIRS],
      dataDirs: [...DATA_DIRS],
    };
  },

  collections(ctx): CollectionDraft[] | null {
    const state = readState(ctx);

    state.routeById.clear();
    const seenIds = new Set<string>();
    const claimed: string[] = [];

    const contentlayer = readContentlayer(ctx, state, seenIds, claimed);
    const velite = readVelite(ctx, state, seenIds, claimed);
    const mdxPages = readMdxRoutePages(ctx, state, seenIds, claimed);
    const declared = [...contentlayer, ...velite, ...mdxPages];

    if (declared.length === 0) return null;

    const extra = ctx.helpers.markdownCollections({
      roots: [...CONTENT_DIRS],
      claimed,
      trailingSlash: state.trailingSlash,
    });

    for (const draft of extra) {
      if (seenIds.has(draft.id)) continue;
      seenIds.add(draft.id);
      declared.push(draft);
    }
    return declared;
  },

  routes(ctx, collections: Collection[]): Record<string, string | null> {
    const state = readState(ctx);
    const urls: Record<string, string | null> = {};

    for (const collection of collections) {
      if (collection.kind === "data") {
        urls[collection.id] = null;
        continue;
      }
      if (state.routeById.has(collection.id)) {
        const raw = state.routeById.get(collection.id);

        urls[collection.id] = raw === null ? null : formatRoute(raw!, { base: state.basePath, trailingSlash: state.trailingSlash });
        continue;
      }
      if (collection.url) {
        const pattern =
          (collection.url === "/{slug}" || collection.url === "/{slug}/") && collection.id !== "pages"
            ? `/${collection.id}/{slug}/`
            : collection.url;

        urls[collection.id] = formatRoute(pattern, { base: state.basePath, trailingSlash: state.trailingSlash });
      }
    }
    return urls;
  },
});
