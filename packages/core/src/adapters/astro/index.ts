/**
 * The Astro adapter — Galley's reference adapter. Everything it knows about
 * Astro is here, and it is written only against the public adapter API
 * (`GalleyAdapter` + `AdapterContext`), exactly as a third-party adapter
 * would be. If it ever needs something the context lacks, the context grows
 * a helper rather than this file reaching into the engine.
 *
 * What it reads, statically (nothing is ever run):
 * - astro.config.*: srcDir, publicDir, outDir, base, site, trailingSlash,
 *   build.format, server.port (an imported JSON value or an env fallback included);
 * - the content config at `<srcDir>/content.config.*` or the legacy
 *   `<srcDir>/content/config.*`, following relative imports: glob() and
 *   file() loaders, legacy `type:` collections, zod schemas;
 * - `<srcDir>/pages/**` dynamic routes, for each collection's URL pattern.
 */
import { posix } from "node:path";

import type { Collection, EntryFormat, Field } from "../../types";
import { ADAPTER_API_VERSION, defineAdapter } from "../../adapter/define";
import type { AdapterContext, AdapterConventions, CollectionDraft, RouteFile } from "../../adapter/types";
import { analyzeContentConfig, type AstroCollectionDecl } from "./content-config";
import { ASTRO_CONFIG_FILES, readAstroSiteValues, type AstroSiteValues } from "./site-config";

export { analyzeContentConfig, type AstroCollectionDecl, type AstroConfigAnalysis, type AstroLoader } from "./content-config";
export { ASTRO_CONFIG_FILES, readAstroSiteValues, type AstroSiteValues } from "./site-config";

const CONTENT_CONFIGS = ["content.config.ts", "content.config.mts", "content.config.mjs", "content.config.js", "content/config.ts", "content/config.mts", "content/config.mjs", "content/config.js"];
const DEFAULT_PORT = 4321;
/** Hosts reserved for documentation (RFC 2606): a site configured with one has not been given its real address yet. */
const PLACEHOLDER_HOST = /(^|\.)example\.(com|net|org)$/i;

interface AstroState {
  configFile: string | null;
  values: AstroSiteValues;
  srcDir: string;
  trailingSlash: boolean;
  base: string;
  routes?: RouteFile[];
  /** URL patterns of collections served by a route an integration injects (Starlight's docs), by id. */
  injected: Map<string, string>;
}

/** One read of astro.config per detection, shared by every hook through the context. */
const states = new WeakMap<AdapterContext, AstroState>();

/** "./src/" → "src"; "." stays "."; ".." is resolved, a leading "/" dropped. */
function clean(path: string): string {
  const normal = posix.normalize(path.replace(/\\/g, "/")).replace(/^\/+/, "").replace(/\/+$/, "");

  return normal === "" ? "." : normal;
}

function join(dir: string, path: string): string {
  return clean(dir === "." ? path : `${dir}/${path}`);
}

function stateOf(ctx: AdapterContext): AstroState {
  let state = states.get(ctx);

  if (state) return state;
  const configFile = ASTRO_CONFIG_FILES.find((file) => ctx.exists(file)) ?? null;
  const module = configFile ? ctx.helpers.readModule(configFile) : null;
  let values: AstroSiteValues = { notes: [] };

  try {
    values = module && configFile ? readAstroSiteValues(module, configFile) : { notes: [] };
  } catch {
    values = { notes: [] };
  }
  // "file" pages are served without a trailing slash unless the config insists on one.
  const trailingSlash = values.trailingSlash === "never" ? false : values.trailingSlash === "always" ? true : values.buildFormat !== "file";
  const base = values.base ? `/${clean(values.base)}`.replace(/^\/\.$/, "") : "";

  state = { configFile, values, srcDir: clean(values.srcDir ?? "src"), trailingSlash, base: base === "/" ? "" : base, injected: new Map() };
  states.set(ctx, state);
  return state;
}

function routesOf(ctx: AdapterContext, state: AstroState): RouteFile[] {
  state.routes ??= ctx.helpers.fileRoutes(join(state.srcDir, "pages"));
  return state.routes;
}

function formatFromPattern(patterns: string[], fallback: EntryFormat): EntryFormat {
  const text = patterns.join(" ");

  if (/\bmdx\b/.test(text) && !/\bmd\b|markdown/.test(text)) return "mdx";
  if (/\bmd\b|markdown|mdx/.test(text)) return "markdown";
  if (/json/.test(text)) return "json";
  if (/ya?ml/.test(text)) return "yaml";
  if (/toml/.test(text)) return "toml";
  return fallback;
}

function formatOfFile(path: string): EntryFormat {
  if (/\.ya?ml$/i.test(path)) return "yaml";
  if (/\.toml$/i.test(path)) return "toml";
  return "json";
}

function joinPatterns(ctx: AdapterContext, patterns: string[], name: string): string | undefined {
  const positive = patterns.filter((pattern) => !pattern.startsWith("!"));

  if (positive.length < patterns.length) ctx.note(`The “${name}” collection excludes some files by pattern; those exclusions are not applied here.`);
  if (positive.length === 0) return undefined;
  return positive.length === 1 ? positive[0] : `{${positive.join(",")}}`;
}

function draftFor(ctx: AdapterContext, state: AstroState, configFile: string, decl: AstroCollectionDecl): CollectionDraft | null {
  const base = { id: decl.name, source: "schema" as const, create: true };

  switch (decl.loader.kind) {
    case "glob": {
      // An omitted base is the project root.
      let path = decl.loader.base === null ? "." : clean(decl.loader.base);

      // `new URL("./x", import.meta.url)` is relative to the config file, not the project.
      if (!ctx.isDirectory(path)) {
        const nextToConfig = join(posix.dirname(configFile), path);

        if (ctx.isDirectory(nextToConfig)) path = nextToConfig;
      }
      const format = formatFromPattern(decl.loader.pattern, "markdown");
      const pattern = joinPatterns(ctx, decl.loader.pattern, decl.name);

      return { ...base, kind: "entries", path, ...(pattern ? { pattern } : {}), format, body: format === "markdown" || format === "mdx", fields: decl.fields, ...(decl.kit ? { kit: decl.kit } : {}) };
    }
    case "file": {
      const path = clean(decl.loader.path);
      const data = ctx.readData(path);
      let fields: Field[] | null = null;

      if (decl.fields) {
        if (data !== null && !Array.isArray(data) && typeof data === "object") {
          // Entries keyed by id ({ "ana": {…}, "ben": {…} }): the schema describes each value, not the file, so the files speak for themselves.
          fields = null;
        } else {
          fields = [{ key: "items", label: "Items", type: "list", required: true, source: "schema", of: { key: "item", label: "Item", type: "object", required: true, source: "schema", fields: decl.fields } }];
        }
      }
      return { ...base, kind: "data", path, format: formatOfFile(path), body: false, url: null, create: false, fields };
    }
    case "starlight": {
      if (decl.loader.loader === "i18n") {
        return { ...base, kind: "entries", path: join(state.srcDir, "content/i18n"), pattern: "**/*.{json,yaml,yml}", format: "json", body: false, fields: decl.fields };
      }
      // Starlight serves every page in src/content/docs from the site root: guides/intro.md → /guides/intro/.
      state.injected.set(decl.name, "/{slug}/");
      return { ...base, kind: "entries", path: join(state.srcDir, "content/docs"), pattern: "**/*.{md,mdx}", format: "markdown", body: true, fields: decl.fields };
    }
    case "legacy": {
      const path = join(state.srcDir, `content/${decl.name}`);
      const data = decl.loader.type === "data";
      const yaml = data && ctx.list(path).filter((file) => /\.ya?ml$/i.test(file)).length > ctx.list(path).filter((file) => /\.json$/i.test(file)).length;

      return {
        ...base,
        kind: "entries",
        path,
        pattern: data ? "**/*.{json,yaml,yml}" : "**/*.{md,mdx,markdown}",
        format: data ? (yaml ? "yaml" : "json") : "markdown",
        body: !data,
        ...(data ? { url: null } : {}),
        fields: decl.fields,
      };
    }
    default:
      return null;
  }
}

function contentConfigDrafts(ctx: AdapterContext, state: AstroState): CollectionDraft[] | null {
  const configFile = CONTENT_CONFIGS.map((file) => join(state.srcDir, file)).find((file) => ctx.exists(file));

  if (!configFile) return null;
  let decls: AstroCollectionDecl[];

  try {
    const module = ctx.helpers.readModule(configFile);

    if (!module) throw new Error("the file could not be opened");
    const analysis = analyzeContentConfig(module, ctx.helpers);

    for (const note of analysis.notes) ctx.note(`${configFile}: ${note}`);
    decls = analysis.collections;
  } catch (error) {
    ctx.note(`${configFile} could not be read (${error instanceof Error ? error.message : String(error)}); folders were scanned instead.`);
    return null;
  }
  if (decls.length === 0) return null;
  const drafts = decls.flatMap((decl) => draftFor(ctx, state, configFile, decl) ?? []);

  ctx.note(`Read ${drafts.length} collection${drafts.length === 1 ? "" : "s"} from ${configFile}.`);
  return drafts;
}

/** Where a collection's entries are served, from the routes; "/{slug}/"-style guesses only when the routes cannot say. */
function urlsFor(ctx: AdapterContext, state: AstroState, collections: Collection[]): Record<string, string | null> {
  const routes = routesOf(ctx, state);
  const slash = (pattern: string): string => (state.trailingSlash ? `${pattern.replace(/\/$/, "")}/` : pattern.replace(/\/$/, "") || "/");
  const withBase = (pattern: string): string => (state.base ? `${state.base}${pattern}` : pattern);
  // Collections read from the content config are known by id; scanned folders by their folder name.
  const keyOf = (collection: Collection): string => (collection.source === "schema" ? collection.id : (collection.path.split("/").pop() ?? collection.id));
  const pages = (collection: Collection): boolean => collection.kind === "entries" && (collection.format === "markdown" || collection.format === "mdx");
  const dynamic = routes.filter((route) => route.dynamic && !route.endpoint);
  // When every dynamic page says which collection it reads, a collection none of them reads has no pages.
  const legible = dynamic.length > 0 && dynamic.every((route) => route.collections.length > 0);
  const keys = collections.map(keyOf);
  const fromRoutes = new Map<string, string>();
  const out: Record<string, string | null> = {};
  const unrendered: string[] = [];

  for (const collection of collections) {
    const pattern = pages(collection) ? ctx.helpers.urlPatternFromRoutes(routes, keyOf(collection), state.trailingSlash, keys) : null;

    if (pattern) fromRoutes.set(collection.id, pattern);
  }
  for (const collection of collections) {
    if (!pages(collection)) {
      out[collection.id] = null;
      continue;
    }
    const injected = state.injected.get(collection.id);

    if (injected) {
      out[collection.id] = withBase(slash(injected));
      continue;
    }
    const routed = fromRoutes.get(collection.id);

    if (routed) {
      out[collection.id] = withBase(routed);
      continue;
    }
    // A folder inside another collection's folder is served by that collection's route,
    // with the sub-folder as part of the slug (src/content/pages/guides → /guides/{slug}/).
    const parent = collections
      .filter((other) => other !== collection && pages(other) && fromRoutes.has(other.id) && (other.path === "." || collection.path.startsWith(`${other.path}/`)) && (other.pattern ?? "**").includes("**"))
      .sort((a, b) => b.path.length - a.path.length)[0];

    if (parent) {
      const inner = parent.path === "." ? collection.path : collection.path.slice(parent.path.length + 1);

      out[collection.id] = withBase(fromRoutes.get(parent.id)!.replace("{slug}", `${inner}/{slug}`));
      continue;
    }
    const key = keyOf(collection);

    // Read only by pages that belong to other collections (a post page looking up its author): a lookup, not pages.
    const readers = dynamic.filter((route) => route.collections.includes(key) || route.route.split("/").includes(key));

    if (legible && readers.every((route) => { const owner = ctx.helpers.routeOwner(route, keys); return owner !== null && owner !== key; })) {
      out[collection.id] = null;
      unrendered.push(collection.label);
      continue;
    }
    out[collection.id] = withBase(slash(key === "pages" || key === "page" ? "/{slug}/" : `/${key}/{slug}/`));
  }
  if (unrendered.length > 0) {
    const list = unrendered.map((label) => `“${label}”`).join(", ");

    ctx.note(`No page in ${join(state.srcDir, "pages")} shows ${unrendered.length === 1 ? "an entry of" : "entries of"} ${list}, so ${unrendered.length === 1 ? "it has" : "they have"} no pages of ${unrendered.length === 1 ? "its" : "their"} own.`);
  }
  return out;
}

export const astroAdapter = defineAdapter({
  id: "astro",
  name: "Astro",
  apiVersion: ADAPTER_API_VERSION,

  detect(ctx) {
    const file = ASTRO_CONFIG_FILES.find((name) => ctx.exists(name));
    const range = ctx.hasDependency("astro");

    if (!file && range === null) return null;
    const version = range !== null ? ctx.dependencyVersion("astro") : null;
    const confidence = file && range !== null ? 0.95 : range !== null ? 0.9 : 0.8;

    return version ? { confidence, version } : { confidence };
  },

  conventions(ctx): AdapterConventions {
    const state = stateOf(ctx);
    const { values } = state;

    for (const note of values.notes) ctx.note(note);
    // `--port` is Astro's own flag: offered only when the dev script is plain `astro dev`
    // (or there is none), not a wrapper that would receive the flag instead.
    const scripts = ctx.packageJson?.scripts ?? {};
    const script = ["dev", "start", "serve"].map((name) => scripts[name]).find((value) => value !== undefined);
    const plainDev = script === undefined || /^\s*astro\s+dev(\s+[^&|;<>$`]*)?$/.test(script);
    const conventions: AdapterConventions = {
      dev: { port: values.port ?? DEFAULT_PORT, ...(plainDev ? { portArgs: ["--port", "{port}"] } : {}) },
      routesDir: join(state.srcDir, "pages"),
      build: { outDir: clean(values.outDir ?? "dist") },
      publicDir: clean(values.publicDir ?? "public"),
      contentDirs: [join(state.srcDir, "content")],
      dataDirs: [join(state.srcDir, "data")],
      trailingSlash: state.trailingSlash,
      contentUrls: "none",
    };

    if (values.site && /^https?:\/\//.test(values.site)) {
      let host = "";

      try {
        host = new URL(values.site).hostname;
      } catch {
        host = "";
      }
      if (PLACEHOLDER_HOST.test(host)) {
        ctx.note(`The site address in ${state.configFile} (${values.site}) is a placeholder, so no live site was set. Change it to the real address to compare previews with the live site.`);
      } else {
        conventions.urls = { production: values.site };
      }
    }
    return conventions;
  },

  collections(ctx) {
    const state = stateOf(ctx);
    const declared = contentConfigDrafts(ctx, state);

    if (declared && declared.length > 0) return declared;
    // No readable content config: every folder of markdown under src/content, plus folders of JSON/YAML records.
    const markdown = ctx.helpers.markdownCollections({ urls: "none" });
    const records = ctx.helpers.dataFolderCollections(join(state.srcDir, "content"), { claimed: markdown.map((draft) => draft.path) });
    const drafts = [...markdown, ...records];

    if (drafts.length > 0) ctx.note(`Found ${drafts.length} content folder${drafts.length === 1 ? "" : "s"} by scanning.`);
    return drafts;
  },

  routes(ctx, collections) {
    return urlsFor(ctx, stateOf(ctx), collections);
  },
});
