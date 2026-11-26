/**
 * The Docusaurus adapter — reads `docusaurus.config.{ts,js,mjs,cjs}` statically
 * (never executes site code) using only the public adapter API.
 *
 * What it reads:
 * - `url`, `baseUrl`, `trailingSlash`, `staticDirectories`;
 * - classic preset (`classic` / `@docusaurus/preset-classic`) options for
 *   `docs`, `blog`, and `pages` (`false` to disable, custom `path` and
 *   `routeBasePath`, including docs-only or blog-only `"/"` mode);
 * - standalone `@docusaurus/plugin-content-{docs,blog,pages}` plugin instances
 *   (including multi-instance plugins with custom `id`).
 */
import { ADAPTER_API_VERSION, defineAdapter } from "../../adapter/define";
import type { AdapterContext, AdapterConventions, CollectionDraft, ModuleExpr, ParsedModule } from "../../adapter/types";
import type { Collection } from "../../types";
import {
  formatRoute,
  joinSafe,
  markdownFormatForFiles,
  normalizeBasePath,
  productionUrl,
  readBooleanProp,
  readPathExpr,
  readStringArray,
  readStringProp,
  safePath,
  toCollectionId,
} from "../shared";

const CONFIG_FILES = ["docusaurus.config.ts", "docusaurus.config.js", "docusaurus.config.mjs", "docusaurus.config.cjs"] as const;
const DEFAULT_PORT = 3000;
const MEDIA_CANDIDATES = ["img", "images", "assets/images", "assets/img", "assets", "media"] as const;

interface PluginInstance {
  kind: "docs" | "blog" | "pages";
  id: string;
  path: string;
  routeBasePath: string;
}

interface DocusaurusState {
  configFile: string | null;
  url?: string;
  baseUrl?: string;
  basePath: string;
  trailingSlash: boolean;
  staticDirectories: string[];
  instances: PluginInstance[];
  disabledPaths: string[];
  routeById: Map<string, string>;
  notes: string[];
}

const states = new WeakMap<AdapterContext, DocusaurusState>();

/** Unwraps a preset/plugin specifier: `"classic"`, `"@docusaurus/preset-classic"`, or `require.resolve("...")`. */
function specifierName(module: ParsedModule, expr: ModuleExpr | undefined): string | null {
  if (!expr) return null;
  const resolved = module.resolve(expr);
  const direct = module.string(resolved);

  if (direct !== null) return direct;
  if (resolved.kind === "call" && resolved.args[0]) {
    const callee = module.callee(resolved);

    if (callee === "require.resolve" || callee === "require") return module.string(resolved.args[0]);
  }
  return null;
}

function isClassicPreset(name: string): boolean {
  return name === "classic" || name === "@docusaurus/preset-classic" || name.endsWith("/preset-classic");
}

function contentPluginKind(name: string): "docs" | "blog" | "pages" | null {
  if (name === "@docusaurus/plugin-content-docs" || name.endsWith("/plugin-content-docs")) return "docs";
  if (name === "@docusaurus/plugin-content-blog" || name.endsWith("/plugin-content-blog")) return "blog";
  if (name === "@docusaurus/plugin-content-pages" || name.endsWith("/plugin-content-pages")) return "pages";
  return null;
}

function defaultPathFor(kind: "docs" | "blog" | "pages"): string {
  return kind === "pages" ? "src/pages" : kind;
}

function defaultRouteFor(kind: "docs" | "blog" | "pages"): string {
  return kind === "pages" ? "/" : kind;
}

function readPluginOptions(
  module: ParsedModule,
  optionsExpr: ModuleExpr | undefined,
  kind: "docs" | "blog" | "pages"
): { disabled: true } | { disabled: false; id: string; path: string; routeBasePath: string } {
  const defaultPath = defaultPathFor(kind);
  const defaultRoute = defaultRouteFor(kind);

  if (!optionsExpr) return { disabled: false, id: kind, path: defaultPath, routeBasePath: defaultRoute };
  const resolved = module.resolve(optionsExpr);

  if (module.boolean(resolved) === false) return { disabled: true };
  if (resolved.kind !== "object") return { disabled: false, id: kind, path: defaultPath, routeBasePath: defaultRoute };
  const rawId = module.string(module.prop(resolved, "id"));
  const rawPath = readPathExpr(module, module.prop(resolved, "path"));
  const rawRoute = module.string(module.prop(resolved, "routeBasePath"));

  return {
    disabled: false,
    id: rawId ? toCollectionId(rawId) : kind,
    path: rawPath ?? defaultPath,
    routeBasePath: rawRoute ?? defaultRoute,
  };
}

/** Fallback text scan when a config wraps its export in code the static AST reader cannot unwrap. */
function textFallback(text: string): {
  url?: string;
  baseUrl?: string;
  trailingSlash?: boolean;
  staticDirectories?: string[];
  disabled: Set<"docs" | "blog" | "pages">;
} {
  const url = /\burl\s*:\s*["'](https?:\/\/[^"']+)["']/.exec(text)?.[1];
  const baseUrl = /\bbaseUrl\s*:\s*["']([^"']+)["']/.exec(text)?.[1];
  const slashMatch = /\btrailingSlash\s*:\s*(true|false)\b/.exec(text);
  const staticMatch = /\bstaticDirectories\s*:\s*\[([^\]]+)\]/.exec(text);
  const staticDirectories = staticMatch
    ? [...staticMatch[1]!.matchAll(/["']([^"']+)["']/g)].map((m) => safePath(m[1]!)).filter((p): p is string => p !== null)
    : undefined;
  const disabled = new Set<"docs" | "blog" | "pages">();

  for (const kind of ["docs", "blog", "pages"] as const) {
    if (new RegExp(`\\b${kind}\\s*:\\s*false\\b`).test(text)) disabled.add(kind);
  }
  return {
    ...(url ? { url } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(slashMatch ? { trailingSlash: slashMatch[1] === "true" } : {}),
    ...(staticDirectories && staticDirectories.length > 0 ? { staticDirectories } : {}),
    disabled,
  };
}

function readState(ctx: AdapterContext): DocusaurusState {
  const cached = states.get(ctx);

  if (cached) return cached;
  const configFile = CONFIG_FILES.find((file) => ctx.exists(file)) ?? null;
  const rawText = configFile ? (ctx.readText(configFile) ?? "") : "";
  const module = configFile ? ctx.helpers.readModule(configFile) : null;
  const config = module?.configObject();
  const notes: string[] = [];

  let url: string | undefined;
  let baseUrl: string | undefined;
  let trailingSlash: boolean | undefined;
  let staticDirectories: string[] = ["static"];
  let classicDocs: { disabled: boolean; path: string; routeBasePath: string } = { disabled: false, path: "docs", routeBasePath: "docs" };
  let classicBlog: { disabled: boolean; path: string; routeBasePath: string } = { disabled: false, path: "blog", routeBasePath: "blog" };
  let classicPages: { disabled: boolean; path: string; routeBasePath: string } = { disabled: false, path: "src/pages", routeBasePath: "/" };
  const standalone: PluginInstance[] = [];

  if (module && config && configFile) {
    url = readStringProp(module, config, "url", "site address", configFile, notes);
    baseUrl = readStringProp(module, config, "baseUrl", "base URL", configFile, notes);
    trailingSlash = readBooleanProp(module, config, "trailingSlash", "trailing-slash setting", configFile, notes);

    const staticRaw = readStringArray(module, module.prop(config, "staticDirectories"));

    if (staticRaw && staticRaw.length > 0) {
      const cleaned = staticRaw.map(safePath).filter((p): p is string => p !== null);

      if (cleaned.length > 0) staticDirectories = [...new Set(cleaned)];
    }

    const presetsExpr = module.prop(config, "presets");

    if (presetsExpr && presetsExpr.kind === "array") {
      for (const item of presetsExpr.items) {
        const resolved = module.resolve(item);
        const name = resolved.kind === "array" ? specifierName(module, resolved.items[0]) : specifierName(module, resolved);

        if (!name || !isClassicPreset(name)) continue;
        const opts = resolved.kind === "array" ? module.resolve(resolved.items[1] ?? { kind: "unknown" }) : undefined;

        if (!opts || opts.kind !== "object") continue;
        const docs = readPluginOptions(module, module.prop(opts, "docs"), "docs");
        const blog = readPluginOptions(module, module.prop(opts, "blog"), "blog");
        const pages = readPluginOptions(module, module.prop(opts, "pages"), "pages");

        classicDocs = docs.disabled ? { disabled: true, path: "docs", routeBasePath: "docs" } : { disabled: false, path: docs.path, routeBasePath: docs.routeBasePath };
        classicBlog = blog.disabled ? { disabled: true, path: "blog", routeBasePath: "blog" } : { disabled: false, path: blog.path, routeBasePath: blog.routeBasePath };
        classicPages = pages.disabled ? { disabled: true, path: "src/pages", routeBasePath: "/" } : { disabled: false, path: pages.path, routeBasePath: pages.routeBasePath };
      }
    }

    const pluginsExpr = module.prop(config, "plugins");

    if (pluginsExpr && pluginsExpr.kind === "array") {
      for (const item of pluginsExpr.items) {
        const resolved = module.resolve(item);
        const name = resolved.kind === "array" ? specifierName(module, resolved.items[0]) : specifierName(module, resolved);
        const kind = name ? contentPluginKind(name) : null;

        if (!kind) continue;
        const optsExpr = resolved.kind === "array" ? resolved.items[1] : undefined;
        const parsed = readPluginOptions(module, optsExpr, kind);

        if (!parsed.disabled) {
          standalone.push({ kind, id: parsed.id, path: parsed.path, routeBasePath: parsed.routeBasePath });
        }
      }
    }
  } else if (configFile && rawText) {
    const fb = textFallback(rawText);

    url = fb.url;
    baseUrl = fb.baseUrl;
    trailingSlash = fb.trailingSlash;
    if (fb.staticDirectories) staticDirectories = fb.staticDirectories;
    if (fb.disabled.has("docs")) classicDocs.disabled = true;
    if (fb.disabled.has("blog")) classicBlog.disabled = true;
    if (fb.disabled.has("pages")) classicPages.disabled = true;
  }

  // Merge classic preset instances with standalone plugins (standalone wins on id clash).
  const instances: PluginInstance[] = [];
  const disabledPaths: string[] = [];
  const standaloneIds = new Set(standalone.map((item) => item.id));

  if (classicDocs.disabled) disabledPaths.push(classicDocs.path);
  else if (!standaloneIds.has("docs")) instances.push({ kind: "docs", id: "docs", path: classicDocs.path, routeBasePath: classicDocs.routeBasePath });

  if (classicBlog.disabled) disabledPaths.push(classicBlog.path);
  else if (!standaloneIds.has("blog")) instances.push({ kind: "blog", id: "blog", path: classicBlog.path, routeBasePath: classicBlog.routeBasePath });

  if (classicPages.disabled) disabledPaths.push(classicPages.path);
  else if (!standaloneIds.has("pages")) instances.push({ kind: "pages", id: "pages", path: classicPages.path, routeBasePath: classicPages.routeBasePath });

  for (const extra of standalone) instances.push(extra);

  const state: DocusaurusState = {
    configFile,
    ...(url ? { url } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    basePath: normalizeBasePath(baseUrl),
    trailingSlash: trailingSlash ?? true,
    staticDirectories,
    instances,
    disabledPaths,
    routeById: new Map(),
    notes,
  };

  states.set(ctx, state);
  return state;
}

export const docusaurusAdapter = defineAdapter({
  id: "docusaurus",
  name: "Docusaurus",
  apiVersion: ADAPTER_API_VERSION,

  detect(ctx) {
    const range = ctx.hasDependency("@docusaurus/core");
    const file = CONFIG_FILES.find((name) => ctx.exists(name));

    if (!file && range === null) return null;
    const version = range !== null ? ctx.dependencyVersion("@docusaurus/core") : null;
    const confidence = file && range !== null ? 0.95 : range !== null ? 0.9 : 0.8;

    return version ? { confidence, version } : { confidence };
  },

  conventions(ctx): AdapterConventions {
    const state = readState(ctx);

    for (const note of state.notes) ctx.note(note);
    const existingStatic = state.staticDirectories.filter((dir) => ctx.isDirectory(dir));
    const publicDir = existingStatic[0] ?? state.staticDirectories[0] ?? "static";
    const production = productionUrl(ctx, state.url, state.configFile, state.baseUrl);
    const contentDirs = [...new Set([...state.instances.map((item) => item.path), "docs", "blog", "src/pages"])].filter(
      (dir) => !state.disabledPaths.includes(dir)
    );
    const conventions: AdapterConventions = {
      dev: { port: DEFAULT_PORT },
      build: { outDir: "build" },
      publicDir,
      trailingSlash: state.trailingSlash,
      contentDirs,
      dataDirs: ["data"],
    };

    if (production) conventions.urls = { production };

    // When multiple staticDirectories are configured, expose image folders and each static dir as media roots.
    if (existingStatic.length > 1) {
      const roots: Array<{ dir: string; publicPath: string }> = [];

      for (const staticDir of existingStatic) {
        const imgDir = MEDIA_CANDIDATES.find((candidate) => {
          const full = joinSafe(staticDir, candidate);

          return full !== null && ctx.isDirectory(full);
        });

        if (imgDir) {
          const full = joinSafe(staticDir, imgDir)!;

          roots.push({ dir: full, publicPath: `/${imgDir}` });
        }
      }
      for (const staticDir of existingStatic) {
        roots.push({ dir: staticDir, publicPath: "/" });
      }
      if (roots.length > 0) {
        conventions.media = { dir: roots[0]!.dir, publicPath: roots[0]!.publicPath, roots };
      }
    }

    return conventions;
  },

  collections(ctx): CollectionDraft[] {
    const state = readState(ctx);
    const drafts: CollectionDraft[] = [];
    const seenPaths = new Set<string>();
    const seenIds = new Set<string>();

    state.routeById.clear();

    for (const instance of state.instances) {
      if (!ctx.isDirectory(instance.path) || seenPaths.has(instance.path)) continue;
      const files = ctx.glob("**/*.{md,mdx}", { cwd: instance.path === "." ? undefined : instance.path, limit: 100 });

      if (files.length === 0) continue;
      let id = instance.id;

      if (seenIds.has(id)) id = toCollectionId(`${instance.kind}-${instance.path}`);
      seenIds.add(id);
      seenPaths.add(instance.path);
      const format = markdownFormatForFiles(files);

      drafts.push({
        id,
        path: instance.path,
        pattern: "**/*.{md,mdx}",
        format,
        body: true,
        source: "inferred",
      });
      state.routeById.set(id, instance.routeBasePath);
    }

    const claimed = [...seenPaths, ...state.disabledPaths, "i18n"];
    const extraRoots = [...new Set(["docs", "blog", ...state.instances.map((item) => item.path)])].filter(
      (dir) => !claimed.includes(dir) && ctx.isDirectory(dir)
    );
    const extra = extraRoots.length > 0 ? ctx.helpers.markdownCollections({ roots: extraRoots, claimed, trailingSlash: state.trailingSlash }) : [];

    for (const draft of extra) {
      if (seenIds.has(draft.id)) continue;
      seenIds.add(draft.id);
      drafts.push(draft);
    }

    if (state.configFile && drafts.length > 0) {
      ctx.note(`Read Docusaurus content setup from ${state.configFile}.`);
    }
    return drafts;
  },

  routes(ctx, collections: Collection[]): Record<string, string | null> {
    const state = readState(ctx);
    const urls: Record<string, string | null> = {};

    for (const collection of collections) {
      if (collection.kind === "data") {
        urls[collection.id] = null;
        continue;
      }
      const routeBase = state.routeById.get(collection.id);

      if (routeBase !== undefined) {
        const cleanBase = normalizeBasePath(routeBase);
        const pattern = cleanBase === "" ? "/{slug}/" : `${cleanBase}/{slug}/`;

        urls[collection.id] = formatRoute(pattern, { base: state.basePath, trailingSlash: state.trailingSlash });
        continue;
      }
      if (collection.url) {
        urls[collection.id] = formatRoute(collection.url, { base: state.basePath, trailingSlash: state.trailingSlash });
      }
    }
    return urls;
  },
});
