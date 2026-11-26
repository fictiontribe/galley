/**
 * The SvelteKit adapter — reads `svelte.config.{js,ts,mjs}` and
 * `vite.config.{ts,js,mjs}` statically (never executes site code) using only
 * the public adapter API.
 *
 * What it reads:
 * - `svelte.config.*`: `kit.files.assets` (publicDir, default `"static"`),
 *   `kit.files.routes` (routesDir, default `"src/routes"`), `kit.paths.base`,
 *   `@sveltejs/adapter-static` `pages` output directory (default `"build"`),
 *   and markdown/MDsveX `extensions` (`.svx`, `.md`, `.mdx`);
 * - `vite.config.*`: `server.port` (default `5173`);
 * - conventional markdown/MDsveX collections (`src/content`, `src/posts`,
 *   `content`, `posts`) and data collections (`src/data`, `src/lib/data`),
 *   plus `+page.{md,mdx,svx}` route pages under `kit.files.routes` when
 *   MDsveX / markdown extensions are configured.
 */
import { ADAPTER_API_VERSION, defineAdapter } from "../../adapter/define";
import type { AdapterContext, AdapterConventions, CollectionDraft } from "../../adapter/types";
import type { Collection } from "../../types";
import {
  formatRoute,
  normalizeBasePath,
  readPortProp,
  readStringArray,
  readStringProp,
  safePath,
} from "../shared";

const SVELTE_CONFIG_FILES = ["svelte.config.js", "svelte.config.ts", "svelte.config.mjs", "svelte.config.cjs"] as const;
const VITE_CONFIG_FILES = ["vite.config.ts", "vite.config.js", "vite.config.mjs", "vite.config.mts", "vite.config.cjs"] as const;
const CONTENT_DIRS = ["src/content", "src/posts", "content", "posts"] as const;
const DATA_DIRS = ["src/data", "src/lib/data"] as const;
const DEFAULT_PORT = 5173;

interface SvelteKitState {
  configFile: string | null;
  assetsDir: string;
  routesDir: string;
  outDir: string;
  basePath: string;
  port: number;
  markdownExtensions: string[];
  hasMdsvex: boolean;
  routePageIds: Set<string>;
  notes: string[];
}

const states = new WeakMap<AdapterContext, SvelteKitState>();

function readState(ctx: AdapterContext): SvelteKitState {
  const cached = states.get(ctx);

  if (cached) return cached;
  const configFile = SVELTE_CONFIG_FILES.find((file) => ctx.exists(file)) ?? null;
  const rawText = configFile ? (ctx.readText(configFile) ?? "") : "";
  const module = configFile ? ctx.helpers.readModule(configFile) : null;
  const config = module?.configObject();
  const notes: string[] = [];

  let assetsDir = "static";
  let routesDir = "src/routes";
  let outDir = "build";
  let basePath = "";
  let port = DEFAULT_PORT;
  let markdownExtensions: string[] = [];
  let hasMdsvex = ctx.hasDependency("mdsvex") !== null;

  if (module && config && configFile) {
    const kit = module.prop(config, "kit");
    const files = kit ? module.prop(kit, "files") : undefined;
    const rawAssets = readStringProp(module, files, "assets", "static assets folder", configFile, notes);

    if (rawAssets) assetsDir = safePath(rawAssets) ?? assetsDir;
    const rawRoutes = readStringProp(module, files, "routes", "routes folder", configFile, notes);

    if (rawRoutes) routesDir = safePath(rawRoutes) ?? routesDir;

    const paths = kit ? module.prop(kit, "paths") : undefined;
    const rawBase = readStringProp(module, paths, "base", "base path", configFile, notes);

    if (rawBase) basePath = normalizeBasePath(rawBase);

    // `@sveltejs/adapter-static` accepts `{ pages: "build", assets: "build" }`.
    const adapterExpr = kit ? module.prop(kit, "adapter") : undefined;

    if (adapterExpr) {
      const resolvedAdapter = module.resolve(adapterExpr);

      if (resolvedAdapter.kind === "call" && resolvedAdapter.args[0]) {
        const opts = module.resolve(resolvedAdapter.args[0]);
        const rawPages = readStringProp(module, opts, "pages", "build output folder", configFile, notes);

        if (rawPages) outDir = safePath(rawPages) ?? outDir;
      }
    }

    const extensions = readStringArray(module, module.prop(config, "extensions")) ?? [];

    markdownExtensions = extensions
      .map((ext) => ext.trim().replace(/^\./, "").toLowerCase())
      .filter((ext) => ext === "svx" || ext === "md" || ext === "mdx" || ext === "markdown");

    if (
      markdownExtensions.length > 0 ||
      [...module.imports.values()].some((imp) => imp.from === "mdsvex" || imp.imported === "mdsvex") ||
      /\bmdsvex\b/.test(rawText)
    ) {
      hasMdsvex = true;
    }
  } else if (configFile && rawText) {
    const assetsMatch = /\bassets\s*:\s*["']([^"']+)["']/.exec(rawText)?.[1];
    const routesMatch = /\broutes\s*:\s*["']([^"']+)["']/.exec(rawText)?.[1];
    const baseMatch = /\bbase\s*:\s*["']([^"']+)["']/.exec(rawText)?.[1];
    const pagesMatch = /\bpages\s*:\s*["']([^"']+)["']/.exec(rawText)?.[1];

    if (assetsMatch) assetsDir = safePath(assetsMatch) ?? assetsDir;
    if (routesMatch) routesDir = safePath(routesMatch) ?? routesDir;
    if (baseMatch) basePath = normalizeBasePath(baseMatch);
    if (pagesMatch) outDir = safePath(pagesMatch) ?? outDir;
    if (/\bmdsvex\b|\.svx\b/.test(rawText)) hasMdsvex = true;
  }

  // Read dev server port from `vite.config.*` when present.
  const viteFile = VITE_CONFIG_FILES.find((file) => ctx.exists(file));

  if (viteFile) {
    const viteModule = ctx.helpers.readModule(viteFile);
    const viteConfig = viteModule?.configObject();

    if (viteModule && viteConfig) {
      const server = viteModule.prop(viteConfig, "server");
      const rawPort = readPortProp(viteModule, server, "port", viteFile, notes);

      if (rawPort !== undefined) port = rawPort;
    }
  }

  const state: SvelteKitState = {
    configFile,
    assetsDir,
    routesDir,
    outDir,
    basePath,
    port,
    markdownExtensions,
    hasMdsvex,
    routePageIds: new Set(),
    notes,
  };

  states.set(ctx, state);
  return state;
}

export const sveltekitAdapter = defineAdapter({
  id: "sveltekit",
  name: "SvelteKit",
  apiVersion: ADAPTER_API_VERSION,

  detect(ctx) {
    const range = ctx.hasDependency("@sveltejs/kit");
    const file = SVELTE_CONFIG_FILES.find((name) => ctx.exists(name));

    if (!file && range === null) return null;
    const version = range !== null ? ctx.dependencyVersion("@sveltejs/kit") : null;
    const confidence = file && range !== null ? 0.95 : range !== null ? 0.9 : 0.8;

    return version ? { confidence, version } : { confidence };
  },

  conventions(ctx): AdapterConventions {
    const state = readState(ctx);

    for (const note of state.notes) ctx.note(note);
    return {
      dev: { port: state.port },
      build: { outDir: state.outDir },
      publicDir: state.assetsDir,
      routesDir: state.routesDir,
      contentDirs: [...CONTENT_DIRS],
      dataDirs: [...DATA_DIRS],
    };
  },

  collections(ctx): CollectionDraft[] | null {
    const state = readState(ctx);

    state.routePageIds.clear();
    const discovered = ctx.helpers.markdownCollections({ roots: [...CONTENT_DIRS] });
    const drafts: CollectionDraft[] = discovered.map((draft) => {
      if (ctx.isDirectory(draft.path) && ctx.glob("**/*.svx", { cwd: draft.path, limit: 1 }).length > 0) {
        return { ...draft, pattern: "**/*.{md,mdx,markdown,svx}" };
      }
      return draft;
    });

    const seenIds = new Set(drafts.map((draft) => draft.id));

    // When mdsvex / markdown extensions are configured, surface `+page.{md,mdx,svx}` route pages under `kit.files.routes`.
    if (state.hasMdsvex && ctx.isDirectory(state.routesDir)) {
      const exts = state.markdownExtensions.length > 0 ? state.markdownExtensions : ["md", "mdx", "svx"];
      const extPattern = exts.length === 1 ? `**/+page.${exts[0]}` : `**/+page.{${exts.join(",")}}`;
      const routePages = ctx.glob(extPattern, { cwd: state.routesDir, limit: 100 });

      if (routePages.length > 0) {
        const id = seenIds.has("pages") ? "route-pages" : "pages";

        seenIds.add(id);
        state.routePageIds.add(id);
        drafts.push({
          id,
          label: "Pages",
          singular: "page",
          kind: "entries",
          path: state.routesDir,
          pattern: extPattern,
          format: "markdown",
          body: true,
          url: null,
          source: "inferred",
        });
        ctx.note(`Found ${routePages.length} Markdown route page${routePages.length === 1 ? "" : "s"} in ${state.routesDir}.`);
      }
    }

    return drafts.length > 0 ? drafts : null;
  },

  routes(ctx, collections: Collection[]): Record<string, string | null> {
    const state = readState(ctx);
    const urls: Record<string, string | null> = {};

    for (const collection of collections) {
      if (collection.kind === "data" || state.routePageIds.has(collection.id)) {
        urls[collection.id] = null;
        continue;
      }
      if (collection.url) {
        const pattern =
          (collection.url === "/{slug}" || collection.url === "/{slug}/") && collection.id !== "pages"
            ? `/${collection.id}/{slug}/`
            : collection.url;

        if (state.basePath || pattern !== collection.url) {
          urls[collection.id] = formatRoute(pattern, { base: state.basePath, trailingSlash: true });
        }
      }
    }
    return urls;
  },
});
