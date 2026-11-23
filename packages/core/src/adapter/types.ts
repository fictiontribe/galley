/**
 * The adapter contract: what a framework adapter is, and what the engine
 * hands it. An adapter describes a site — how to recognise it, where its
 * content lives, how URLs map to entries and how to run it. It never renders
 * or builds anything.
 *
 * Everything here is types. Keep it free of runtime code so an adapter can
 * `import type` it and stay a dependency-free file.
 */
import type { Collection, EntryFormat, Field, JsonValue } from "../types";
import type { Expr } from "../content/detect/js/parse";
import type { RouteFile } from "../content/detect/routes";

export type MaybePromise<T> = T | Promise<T>;

/** "Yes, this site is mine" — and how sure the adapter is. */
export interface AdapterMatch {
  /**
   * 0–1. The highest confidence wins; ties go to registration order. Rough
   * scale the built-ins use: 0.95 dependency and config file, 0.9 dependency,
   * 0.8 config file, 0.5 a weak hint, 0.05 the plain-markdown fallback.
   */
  confidence: number;
  /** The framework version, when known (installed version, else the declared range). */
  version?: string;
}

/**
 * How to run a site and where things live. Every field is optional; what is
 * left out comes from the engine's defaults (shown in brackets).
 */
export interface AdapterConventions {
  /**
   * The dev server. A `dev`, `start` or `serve` script in package.json always
   * wins for the command; `command` here is used when there is none.
   * [no command; port from a `--port` flag in the script, else none]
   *
   * `portArgs` says how the dev command is told which port to use, with
   * "{port}" standing for the number — Astro's is ["--port", "{port}"]. When
   * given, the preview starts the dev server on a port it has checked is
   * free, so two sites with the same configured port never collide. [none:
   * the dev server picks its own port and the preview reads it from the output]
   */
  dev?: { command?: string; port?: number | null; portArgs?: string[] };
  /** Build command (used when package.json has no `build` script) and output folder. ["dist"] */
  build?: { command?: string; outDir?: string };
  /** The folder served at the site root, as-is. ["public"] */
  publicDir?: string;
  /**
   * Where images live and the URL each folder is served from. [an images
   * folder found under `publicDir`, plus `publicDir` itself at "/"]
   */
  media?: { dir?: string; publicPath?: string; roots?: Array<{ dir: string; publicPath: string }> };
  /** The deployed site's addresses. [a CNAME file, else package.json `homepage`] */
  urls?: { production?: string; staging?: string };
  /** Whether page URLs end in "/". [true] */
  trailingSlash?: boolean;
  /**
   * The folder of file-based routes — pages written as code, which the
   * content index reads to know which URLs the site serves (Astro's
   * `<srcDir>/pages`). [none]
   */
  routesDir?: string;
  /** Folders conventional discovery scans for markdown, most likely first. [".", the whole site] */
  contentDirs?: string[];
  /** Content folders whose own files are the site's top-level pages (collection id "pages"). [none] */
  pageDirs?: string[];
  /** Folders whose JSON/YAML/TOML files become data collections (one per file). [none] */
  dataDirs?: string[];
  /**
   * How discovered content folders get URLs: "folders" maps `content/posts`
   * to "/posts/{slug}/"; "none" gives them no page of their own (use it when
   * the framework's URLs cannot be told from the folder layout). ["folders"]
   */
  contentUrls?: "folders" | "none";
}

/**
 * A collection as an adapter declares it. Only `id` and `path` are needed:
 * the engine fills in the rest (labels from the id, the format from the path
 * or pattern, the count and the fields from the files themselves).
 */
export interface CollectionDraft {
  /** Stable, unique within the site: "blog", "team". */
  id: string;
  /** Repo-relative folder (entries) or file (data), POSIX separators. */
  path: string;
  /** "entries" (one file per item, the default for folders) or "data" (one file). */
  kind?: "entries" | "data";
  /** Glob relative to `path` ["**\/*.{md,mdx,markdown}" for markdown]. */
  pattern?: string;
  format?: EntryFormat;
  /** Whether entries carry a markdown body. [true for markdown and MDX] */
  body?: boolean;
  /** Public URL pattern with {slug} ("/blog/{slug}/"), null for no page. [your `routes()` hook, else null] */
  url?: string | null;
  label?: string;
  singular?: string;
  description?: string;
  /**
   * Fields the framework declares (a schema). Partial is fine: keys the files
   * carry that are not listed are inferred, and a declared field whose type
   * is unknown (`json`) takes the type the files show.
   */
  fields?: Field[] | null;
  titleField?: string;
  dateField?: string;
  imageField?: string;
  draftField?: string;
  /** Whether new entries may be created from the app. [true for entries, false for data] */
  create?: boolean;
  hidden?: boolean;
  /** Where the definition came from. ["schema" when `fields` is given, else "inferred"] */
  source?: "schema" | "inferred";
  /**
   * The collection holds site-kit files: "forms" when its schema is the kit's
   * form schema, "scripts" for the kit's scripts setup. The engine then
   * describes and checks them with the kit's own schema. [the engine also
   * recognises them by the files' shape]
   */
  kit?: "forms" | "scripts";
}

/** The fields of package.json an adapter usually needs. Anything else is there too, untyped. */
export interface PackageJsonLike {
  name?: string;
  version?: string;
  homepage?: string;
  packageManager?: string;
  type?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * A node of a statically read JavaScript/TypeScript module. Values the reader
 * cannot know without running code are `{ kind: "unknown" }`.
 */
export type ModuleExpr = Expr;

export type { RouteFile };

/**
 * A JavaScript or TypeScript module, read without running it: top-level
 * declarations, imports and exports, with calls, member chains, object and
 * array literals, arrow and plain functions, and `a || b` fallbacks.
 */
export interface ParsedModule {
  /** Top-level `const`/`let`/`var`/`function` bindings. */
  readonly scope: ReadonlyMap<string, ModuleExpr>;
  /** Exported name → local name. CommonJS `module.exports = x` is recorded as "default". */
  readonly exports: ReadonlyMap<string, string>;
  /** Local names bound by imports, and where they come from. */
  readonly imports: ReadonlyMap<string, { from: string; imported: string }>;
  /** The value of an export ("default", "collections"), identifiers followed. */
  exported(name: string): ModuleExpr | undefined;
  /**
   * The object a config file exports: `export default defineConfig({…})`,
   * `export default {…}`, `module.exports = {…}`, a function returning an
   * object (`(config) => ({…})`, `function (config) { return {…} }`), or an
   * identifier bound to one of these. Undefined when it cannot be read.
   */
  configObject(): ModuleExpr | undefined;
  /** Follows identifiers, and `a.b` into object literals. */
  resolve(expr: ModuleExpr): ModuleExpr;
  /** A property of an object literal (resolved), or undefined. */
  prop(expr: ModuleExpr | undefined, key: string): ModuleExpr | undefined;
  /** A string literal's value (resolved), or null. */
  string(expr: ModuleExpr | undefined): string | null;
  /** A number literal's value (resolved), or null. */
  number(expr: ModuleExpr | undefined): number | null;
  /** A boolean literal's value (resolved), or null. */
  boolean(expr: ModuleExpr | undefined): boolean | null;
  /** Plain data — strings, numbers, booleans, null, and arrays/objects of them — or undefined. */
  literal(expr: ModuleExpr | undefined): JsonValue | undefined;
  /** The dotted name of what a call or `new` calls ("defineConfig", "z.object"), or null. */
  callee(expr: ModuleExpr | undefined): string | null;
}

export interface MarkdownCollectionOptions {
  /** Folders to scan; "." is the site root. [your conventions' `contentDirs` that exist, else "."] */
  roots?: string[];
  /** Folders whose own files are the top-level pages. [your conventions' `pageDirs`] */
  pageDirs?: string[];
  /** How URLs are guessed from folders. [your conventions' `contentUrls`] */
  urls?: "folders" | "none";
  /** [your conventions' `trailingSlash`] */
  trailingSlash?: boolean;
  /** Folders another collection already owns; nothing inside them is offered again. */
  claimed?: string[];
}

export interface FileRouteOptions {
  /** Route file extensions, without the dot. ["astro", "md", "mdx", "html", "ts", "js", …] */
  extensions?: string[];
}

/** Building blocks the built-in adapters use; a third-party adapter gets the same ones. */
export interface AdapterHelpers {
  /**
   * Conventional discovery: every folder (under the roots, 5 levels deep)
   * holding at least two markdown/MDX files that start with front matter is
   * a collection. Code, build output and tooling folders are skipped.
   */
  markdownCollections(options?: MarkdownCollectionOptions): CollectionDraft[];
  /**
   * One data collection per JSON/YAML/TOML file directly inside each folder.
   * Files over 1 MB (redirect maps, exports) are left out with a note.
   */
  dataCollections(dirs: string[], options?: { claimed?: string[] }): CollectionDraft[];
  /**
   * One entries collection per sub-folder of `parent` whose files are mostly
   * JSON or YAML (a folder of records, one file each).
   */
  dataFolderCollections(parent: string, options?: { claimed?: string[] }): CollectionDraft[];
  /** Reads JavaScript/TypeScript source statically. Never executes it; never throws. */
  parseModule(source: string): ParsedModule;
  /**
   * Like `parseModule`, for a file in the site, with relative imports
   * followed (a few levels): bindings imported from `./schemas.ts` resolve,
   * and an imported `.json` file reads as an object literal. Null when the
   * file cannot be read.
   */
  readModule(path: string): ParsedModule | null;
  /**
   * The fields of a zod object schema (`z.object({…})`, with `.extend`,
   * `.merge`, `.partial`, `.pick`, `.omit`, helper functions, unions of
   * objects as blocks). Null when the expression is not a readable object schema.
   */
  fieldsFromZod(expr: ModuleExpr, module: ParsedModule): Field[] | null;
  /**
   * File-based routes under a pages folder: each file's URL pattern, whether
   * it is dynamic, and which collections it reads (`getCollection("x")`, `getEntry("x", …)`).
   */
  fileRoutes(pagesDir: string, options?: FileRouteOptions): RouteFile[];
  /**
   * The URL pattern of the one dynamic route that renders a collection, or
   * null. Pass every collection id of the site so a route's folder name
   * (`blog/[slug]`) can decide whose page it is.
   */
  urlPatternFromRoutes(routes: RouteFile[], collectionId: string, trailingSlash: boolean, collectionIds?: string[]): string | null;
  /** The collection a route is one entry's page of — by its folder name, else by the one collection it renders — or null. */
  routeOwner(route: RouteFile, collectionIds?: string[]): string | null;
}

/**
 * What an adapter's hooks receive. File access is read-only and confined to
 * the site folder: a path that leads outside it throws, a missing or
 * unreadable file reads as null. Hooks for one detection share one context
 * object, so a `WeakMap` keyed by it can carry work from one hook to the next.
 */
export interface AdapterContext {
  /** Absolute path of the site folder. */
  readonly root: string;
  exists(path: string): boolean;
  isDirectory(path: string): boolean;
  /** Names in a folder, sorted; sub-folders end in "/". Empty when it does not exist. */
  list(path: string): string[];
  /** UTF-8 text, or null when missing, unreadable or over 2 MB. */
  readText(path: string): string | null;
  /** Parsed JSON, or null. */
  readJson<T = unknown>(path: string): T | null;
  /** JSON, YAML or TOML by extension, or null. */
  readData(path: string): JsonValue | null;
  /**
   * Site files matching the patterns, as sorted repo-relative paths.
   * node_modules, .git and build output are never matched. [limit 5000]
   */
  glob(patterns: string | string[], options?: { cwd?: string; limit?: number }): string[];
  /** The site's package.json, or null when it has none (or it does not parse). */
  readonly packageJson: PackageJsonLike | null;
  /** The version range package.json declares for a dependency (dependencies or devDependencies), or null. */
  hasDependency(name: string): string | null;
  /** The installed version of a dependency, else its declared range without the `^`/`~`, or null. */
  dependencyVersion(name: string): string | null;
  /** Adds a line to the site's notes. Say what you found, in plain words. */
  note(message: string): void;
  readonly helpers: AdapterHelpers;
}

// #region adapter-interface
/**
 * A framework adapter: a plain object. Only `id`, `name` and `detect` are
 * required; every other hook is optional and the engine fills in what an
 * adapter leaves out. Hooks may be async. A hook that throws costs only what
 * it would have provided — the engine notes it and carries on.
 */
export interface GalleyAdapter {
  /** Stable id, lowercase letters, digits and dashes: "astro", "eleventy". Becomes `SiteModel.framework.id`. */
  id: string;
  /** Display name: "Astro". */
  name: string;
  /** The adapter API version this adapter was written for (`ADAPTER_API_VERSION`). */
  apiVersion?: number;
  /** Is this site yours? Return null for no. Never throw for an unfamiliar site. */
  detect(ctx: AdapterContext): MaybePromise<AdapterMatch | null>;
  /** How to run the site and where things live. */
  conventions?(ctx: AdapterContext): MaybePromise<AdapterConventions>;
  /**
   * The collections the framework declares. Return null (or leave the hook
   * out) for conventional discovery over `conventions().contentDirs`; return
   * an empty list to say "this site has none".
   */
  collections?(ctx: AdapterContext): MaybePromise<CollectionDraft[] | null>;
  /**
   * Public URL pattern per collection id ("/blog/{slug}/", or null for no
   * page). Runs after every collection is known and counted. Ids you leave
   * out keep the URL they already have.
   */
  routes?(ctx: AdapterContext, collections: Collection[]): MaybePromise<Record<string, string | null>>;
  /** Extra environment variables for the site's own commands (dev server, build). */
  environment?(ctx: AdapterContext): Record<string, string | undefined>;
}
// #endregion adapter-interface

/**
 * The data a `conventionAdapter` is made from: how to recognise the framework
 * plus its conventions, and optionally any hook to add to (or replace) the
 * generated ones.
 */
export interface ConventionAdapterSpec extends AdapterConventions {
  id: string;
  name: string;
  apiVersion?: number;
  /** package.json dependencies that identify the framework (any one is enough). */
  packages?: string[];
  /** Files at the site root that identify it (any one is enough). */
  files?: string[];
  /** An extra condition checked after a package or file matched. */
  requires?(ctx: AdapterContext): boolean;
  /** Replaces the generated `detect`. */
  detect?(ctx: AdapterContext): MaybePromise<AdapterMatch | null>;
  /** Merged over the static conventions above — for values read from the site's own config. */
  conventions?(ctx: AdapterContext): MaybePromise<AdapterConventions>;
  collections?(ctx: AdapterContext): MaybePromise<CollectionDraft[] | null>;
  routes?(ctx: AdapterContext, collections: Collection[]): MaybePromise<Record<string, string | null>>;
  environment?(ctx: AdapterContext): Record<string, string | undefined>;
}
