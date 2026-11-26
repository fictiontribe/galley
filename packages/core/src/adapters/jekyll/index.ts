/**
 * The Jekyll adapter — reads `_config.yml` / `_config.yaml` statically
 * (never executes site code) using only the public adapter API.
 *
 * What it reads:
 * - `url` + `baseurl` for the live site address and URL prefix;
 * - `source`, `destination`, `collections_dir`, `data_dir`, `layouts_dir`,
 *   `includes_dir`, and `exclude`;
 * - custom `collections:` (object or array), respecting `output: true | false`
 *   and custom `permalink` patterns;
 * - `_posts` (and `_drafts`), keeping `_posts` routes as `null` with a note
 *   unless the permalink literally matches `:year-:month-:day-:title` / `:slug`
 *   (since `_posts` filenames carry `YYYY-MM-DD-` prefixes that `{slug}` does
 *   not strip);
 * - global data files in `data_dir` (`_data`).
 */
import { posix } from "node:path";

import { ADAPTER_API_VERSION, defineAdapter } from "../../adapter/define";
import type { AdapterContext, AdapterConventions, CollectionDraft } from "../../adapter/types";
import type { Collection, JsonValue } from "../../types";

const CONFIG_FILES = ["_config.yml", "_config.yaml"] as const;

type JsonRecord = { [key: string]: JsonValue };

interface JekyllCollectionConfig {
  name: string;
  dir: string;
  output: boolean;
  permalink?: string;
}

interface JekyllState {
  configFile: string | null;
  production?: string;
  baseurl: string;
  source: string;
  destination: string;
  collectionsDir: string;
  dataDir: string;
  layoutsDir: string;
  includesDir: string;
  exclude: string[];
  permalink: string;
  postsConfig?: { output: boolean; permalink?: string };
  customCollections: JekyllCollectionConfig[];
}

const states = new WeakMap<AdapterContext, JekyllState>();

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

function joinSafe(...parts: Array<string | undefined>): string | null {
  const filtered = parts
    .map((part) => (part ?? "").trim().replace(/\\/g, "/"))
    .filter((part) => part !== "" && part !== "." && part !== "./");

  if (filtered.length === 0) return ".";
  return safePath(filtered.join("/"));
}

function normalizeBaseurl(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");

  if (trimmed === "" || trimmed === ".") return "";
  return `/${trimmed}`;
}

function readConfig(ctx: AdapterContext): { file: string | null; data: JsonRecord } {
  for (const file of CONFIG_FILES) {
    if (!ctx.exists(file)) continue;
    const raw = ctx.readData(file);

    return { file, data: isRecord(raw) ? raw : {} };
  }
  return { file: null, data: {} };
}

function stateOf(ctx: AdapterContext): JekyllState {
  const known = states.get(ctx);

  if (known) return known;

  const { file, data } = readConfig(ctx);
  const url = httpUrl(data.url);
  const baseurl = normalizeBaseurl(data.baseurl);
  const production = url ? `${url}${baseurl}`.replace(/\/+$/, "") : undefined;

  const source = typeof data.source === "string" ? (safePath(data.source) ?? ".") : ".";
  const destination = typeof data.destination === "string" ? (safePath(data.destination) ?? "_site") : "_site";
  const collectionsDirRel = typeof data.collections_dir === "string" ? (safePath(data.collections_dir) ?? "") : "";
  const collectionsDir = collectionsDirRel === "." ? "" : collectionsDirRel;
  const dataDirRel = typeof data.data_dir === "string" ? data.data_dir : "_data";
  const dataDir = joinSafe(source, dataDirRel) ?? "_data";
  const layoutsDirRel = typeof data.layouts_dir === "string" ? data.layouts_dir : "_layouts";
  const layoutsDir = joinSafe(source, layoutsDirRel) ?? "_layouts";
  const includesDirRel = typeof data.includes_dir === "string" ? data.includes_dir : "_includes";
  const includesDir = joinSafe(source, includesDirRel) ?? "_includes";

  const exclude: string[] = [];

  if (Array.isArray(data.exclude)) {
    for (const item of data.exclude) {
      if (typeof item !== "string" || /[*?{}\[\]]/.test(item)) continue;
      const underSource = joinSafe(source, item);
      const fromRoot = safePath(item);

      if (underSource && underSource !== "." && !exclude.includes(underSource)) exclude.push(underSource);
      if (fromRoot && fromRoot !== "." && !exclude.includes(fromRoot)) exclude.push(fromRoot);
    }
  }

  const permalink = typeof data.permalink === "string" && data.permalink.trim() !== "" ? data.permalink.trim() : "date";
  const customCollections: JekyllCollectionConfig[] = [];
  let postsConfig: { output: boolean; permalink?: string } | undefined;

  if (Array.isArray(data.collections)) {
    for (const entry of data.collections) {
      if (typeof entry !== "string" || !/^[\w-]+$/.test(entry)) continue;
      if (entry === "posts") {
        postsConfig = { output: true };
        continue;
      }
      const dir = joinSafe(source, collectionsDir, `_${entry}`);

      if (dir) customCollections.push({ name: entry, dir, output: false });
    }
  } else if (isRecord(data.collections)) {
    for (const [name, raw] of Object.entries(data.collections)) {
      if (!/^[\w-]+$/.test(name)) continue;
      const cfg = isRecord(raw) ? raw : {};

      if (name === "posts") {
        postsConfig = {
          output: cfg.output !== false,
          ...(typeof cfg.permalink === "string" && cfg.permalink.trim() !== "" ? { permalink: cfg.permalink.trim() } : {}),
        };
        continue;
      }
      const dir = joinSafe(source, collectionsDir, `_${name}`);

      if (!dir) continue;
      customCollections.push({
        name,
        dir,
        output: cfg.output === true,
        ...(typeof cfg.permalink === "string" && cfg.permalink.trim() !== "" ? { permalink: cfg.permalink.trim() } : {}),
      });
    }
  }

  const state: JekyllState = {
    configFile: file,
    ...(production ? { production } : {}),
    baseurl,
    source,
    destination,
    collectionsDir,
    dataDir,
    layoutsDir,
    includesDir,
    exclude,
    permalink,
    ...(postsConfig ? { postsConfig } : {}),
    customCollections,
  };

  states.set(ctx, state);
  return state;
}

const BUILTIN_STYLES: Record<string, string> = {
  date: "/:categories/:year/:month/:day/:title:output_ext",
  pretty: "/:categories/:year/:month/:day/:title/",
  ordinal: "/:categories/:year/:y_day/:title:output_ext",
  weekdate: "/:categories/:year/W:week/:short_day/:title:output_ext",
  none: "/:categories/:title:output_ext",
};

const JEKYLL_DATE_TOKEN = /:(year|short_year|month|i_month|short_month|long_month|day|i_day|y_day|w_year|week|w_day|short_day|long_day|hour|minute|second)(?![a-zA-Z0-9_])/;

function convertJekyllPermalink(
  raw: string,
  options: { collection?: string } = {}
): { ok: true; pattern: string } | { ok: false; reason: "date" | "dynamic" } {
  const expanded = BUILTIN_STYLES[raw.toLowerCase()] ?? raw.trim();

  if (JEKYLL_DATE_TOKEN.test(expanded)) return { ok: false, reason: "date" };

  let pattern = expanded;

  if (options.collection) {
    pattern = pattern.replace(/:collection(?![a-zA-Z0-9_])/g, options.collection);
  }
  pattern = pattern.replace(/:output_ext(?![a-zA-Z0-9_])/g, "/");
  pattern = pattern.replace(/:(title|slug|name|path)(?![a-zA-Z0-9_])/g, "{slug}");

  if (/:[a-zA-Z0-9_]+/.test(pattern)) return { ok: false, reason: "dynamic" };
  if ((pattern.match(/\{slug\}/g) ?? []).length !== 1) return { ok: false, reason: "dynamic" };

  pattern = pattern.replace(/\/{2,}/g, "/");
  if (!pattern.startsWith("/")) pattern = `/${pattern}`;
  if (/\s|[?#]/.test(pattern)) return { ok: false, reason: "dynamic" };
  return { ok: true, pattern };
}

/**
 * `_posts` filenames carry a `YYYY-MM-DD-` prefix (`2026-01-01-first-note.md`)
 * that Galley's `{slug}` keeps intact, whereas Jekyll strips it for `:title` /
 * `:slug`. Only a permalink that literally writes `:year-:month-:day-:title`
 * (or `:slug`) matches `{slug}` accurately.
 */
function convertJekyllPostsPermalink(
  raw: string
): { ok: true; pattern: string } | { ok: false; reason: "date" | "date-prefix" | "dynamic" } {
  const expanded = BUILTIN_STYLES[raw.toLowerCase()] ?? raw.trim();
  let pattern = expanded.replace(/:year-:month-:day-:(title|slug)(?![a-zA-Z0-9_])/g, "{slug}");

  if (pattern.includes("{slug}")) {
    if (JEKYLL_DATE_TOKEN.test(pattern)) return { ok: false, reason: "date" };
    pattern = pattern.replace(/:output_ext(?![a-zA-Z0-9_])/g, "/");
    if (/:[a-zA-Z0-9_]+/.test(pattern)) return { ok: false, reason: "dynamic" };
    if ((pattern.match(/\{slug\}/g) ?? []).length !== 1) return { ok: false, reason: "dynamic" };
    pattern = pattern.replace(/\/{2,}/g, "/");
    if (!pattern.startsWith("/")) pattern = `/${pattern}`;
    if (/\s|[?#]/.test(pattern)) return { ok: false, reason: "dynamic" };
    return { ok: true, pattern };
  }

  if (JEKYLL_DATE_TOKEN.test(expanded)) return { ok: false, reason: "date" };
  if (/:(title|slug|name|path)(?![a-zA-Z0-9_])/.test(expanded)) return { ok: false, reason: "date-prefix" };
  return { ok: false, reason: "dynamic" };
}

function withBaseurl(baseurl: string, pattern: string): string {
  if (!baseurl) return pattern;
  if (pattern === baseurl || pattern.startsWith(`${baseurl}/`)) return pattern;
  return `${baseurl}${pattern}`.replace(/\/{2,}/g, "/");
}

function postsPath(state: JekyllState): string {
  return joinSafe(state.source, state.collectionsDir, "_posts") ?? "_posts";
}

function draftsPath(state: JekyllState): string {
  return joinSafe(state.source, state.collectionsDir, "_drafts") ?? "_drafts";
}

function hasMarkdownFiles(ctx: AdapterContext, dir: string): boolean {
  return ctx.isDirectory(dir) && ctx.glob("**/*.{md,mdx,markdown}", { cwd: dir, limit: 1 }).length > 0;
}

export const jekyllAdapter = defineAdapter({
  id: "jekyll",
  name: "Jekyll",
  apiVersion: ADAPTER_API_VERSION,

  detect(ctx) {
    const configFile = CONFIG_FILES.find((file) => ctx.exists(file));

    if (!configFile) return null;
    const gemfile = ctx.readText("Gemfile");
    const hasRootSignal = ctx.isDirectory("_posts") || ctx.isDirectory("_drafts") || ctx.isDirectory("_layouts") || gemfile !== null;

    if (hasRootSignal) {
      const confidence = gemfile !== null && /\b(jekyll|github-pages)\b/i.test(gemfile) ? 0.9 : 0.8;

      return { confidence };
    }
    // Sites with a custom `source` or `collections_dir` keep _posts/_layouts under it.
    const state = stateOf(ctx);
    const hasCustomSignal =
      ctx.isDirectory(postsPath(state)) ||
      ctx.isDirectory(draftsPath(state)) ||
      ctx.isDirectory(state.layoutsDir) ||
      state.customCollections.some((collection) => ctx.isDirectory(collection.dir));

    return hasCustomSignal ? { confidence: 0.8 } : null;
  },

  conventions(ctx): AdapterConventions {
    const state = stateOf(ctx);
    const posts = postsPath(state);
    const contentDirs = posts === state.source ? [state.source] : [posts, state.source];

    return {
      dev: { command: "bundle exec jekyll serve", port: 4000 },
      build: { command: "bundle exec jekyll build", outDir: state.destination },
      publicDir: state.source,
      contentDirs,
      pageDirs: [state.source],
      dataDirs: [state.dataDir],
      ...(state.production ? { urls: { production: state.production } } : {}),
    };
  },

  collections(ctx): CollectionDraft[] {
    const state = stateOf(ctx);
    const drafts: CollectionDraft[] = [];
    const usedIds = new Set<string>();
    const claimed = new Set<string>();

    const posts = postsPath(state);

    if (hasMarkdownFiles(ctx, posts)) {
      drafts.push({ id: "posts", path: posts, pattern: "**/*.{md,mdx,markdown}", format: "markdown" });
      usedIds.add("posts");
      claimed.add(posts);
    }

    const draftsDir = draftsPath(state);

    if (hasMarkdownFiles(ctx, draftsDir)) {
      drafts.push({ id: "drafts", path: draftsDir, pattern: "**/*.{md,mdx,markdown}", format: "markdown", url: null });
      usedIds.add("drafts");
      claimed.add(draftsDir);
    }

    for (const custom of state.customCollections) {
      if (claimed.has(custom.dir)) continue;
      if (!hasMarkdownFiles(ctx, custom.dir)) continue;
      let id = custom.name;

      if (usedIds.has(id)) id = custom.dir.replace(/^_+/, "").replace(/\//g, "-");
      if (usedIds.has(id)) continue;
      usedIds.add(id);
      claimed.add(custom.dir);
      drafts.push({ id, path: custom.dir, pattern: "**/*.{md,mdx,markdown}", format: "markdown" });
    }

    const skip = [
      ...claimed,
      state.destination,
      state.dataDir,
      state.layoutsDir,
      state.includesDir,
      joinSafe(state.source, "_sass"),
      ...state.exclude,
    ].filter((dir): dir is string => dir !== null && dir !== ".");

    const found = ctx.helpers.markdownCollections({
      roots: [state.source],
      pageDirs: [state.source],
      claimed: [...new Set(skip)],
    });

    for (const draft of found) {
      if (usedIds.has(draft.id)) {
        draft.id = draft.path.replace(/^_+/, "").replace(/\//g, "-") || draft.id;
      }
      usedIds.add(draft.id);
    }

    const data = ctx.isDirectory(state.dataDir) ? ctx.helpers.dataCollections([state.dataDir]) : [];

    for (const draft of data) {
      if (usedIds.has(draft.id)) draft.id = `${draft.id}-data`;
      usedIds.add(draft.id);
    }

    return [...drafts, ...found, ...data];
  },

  routes(ctx, collections: Collection[]): Record<string, string | null> {
    const state = stateOf(ctx);
    const posts = postsPath(state);
    const draftsDir = draftsPath(state);
    const customByPath = new Map(state.customCollections.map((item) => [item.dir, item]));
    const urls: Record<string, string | null> = {};

    for (const collection of collections) {
      if (collection.kind === "data") {
        urls[collection.id] = null;
        continue;
      }
      if (collection.path === draftsDir || /(^|\/)_drafts$/.test(collection.path)) {
        urls[collection.id] = null;
        continue;
      }
      if (collection.path === posts || /(^|\/)_posts$/.test(collection.path)) {
        if (state.postsConfig?.output === false) {
          urls[collection.id] = null;
          continue;
        }
        const rawPermalink = state.postsConfig?.permalink ?? state.permalink;
        const converted = convertJekyllPostsPermalink(rawPermalink);

        if (!converted.ok) {
          if (converted.reason === "date-prefix") {
            ctx.note(`The “${collection.label}” permalink (${rawPermalink}) drops the YYYY-MM-DD- prefix from _posts filenames, which a {slug} pattern cannot strip, so its pages could not be matched to their files.`);
          } else if (converted.reason === "date") {
            ctx.note(`The “${collection.label}” permalink (${rawPermalink}) is date-based, so its page addresses could not be expressed as a {slug} pattern.`);
          } else {
            ctx.note(`The “${collection.label}” permalink (${rawPermalink}) uses tokens beyond the file name, so its pages could not be matched to their files.`);
          }
          urls[collection.id] = null;
        } else {
          urls[collection.id] = withBaseurl(state.baseurl, converted.pattern);
        }
        continue;
      }

      const custom = customByPath.get(collection.path);

      if (custom) {
        if (!custom.output) {
          urls[collection.id] = null;
          continue;
        }
        if (custom.permalink) {
          const converted = convertJekyllPermalink(custom.permalink, { collection: custom.name });

          if (!converted.ok) {
            ctx.note(`The “${collection.label}” permalink (${custom.permalink}) uses tokens beyond the file name, so its pages could not be matched to their files.`);
            urls[collection.id] = null;
          } else {
            urls[collection.id] = withBaseurl(state.baseurl, converted.pattern);
          }
        } else {
          urls[collection.id] = withBaseurl(state.baseurl, `/${custom.name}/{slug}/`);
        }
        continue;
      }

      if (collection.path === state.source) {
        urls[collection.id] = withBaseurl(state.baseurl, "/{slug}/");
      } else {
        const inner =
          state.source === "."
            ? collection.path
            : collection.path.startsWith(`${state.source}/`)
              ? collection.path.slice(state.source.length + 1)
              : collection.path;
        const cleanInner = inner.replace(/^_+/, "");

        urls[collection.id] = withBaseurl(state.baseurl, cleanInner ? `/${cleanInner}/{slug}/` : "/{slug}/");
      }
    }
    return urls;
  },
});
