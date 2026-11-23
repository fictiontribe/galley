/**
 * A Galley adapter for Eleventy (11ty), written only against the public
 * adapter API. It has no runtime dependencies: the kit is imported for its
 * types alone, so a compiled copy of this file is all a site needs.
 *
 * What it reads, without running anything:
 * - the Eleventy config (`eleventy.config.{js,mjs,cjs}` or `.eleventy.{js,cjs}`)
 *   for the input, output, data and includes folders — from
 *   `return { dir: {…} }`, `export const config = { dir: {…} }` or
 *   `eleventyConfig.setInputDirectory("…")` — and passthrough-copied media folders;
 * - directory data files (`posts/posts.json`, `posts/posts.11tydata.json`):
 *   each folder that has one is a collection named by its `tags`, served at
 *   its `permalink`;
 * - `_data/*.json`: global data files, each a data collection.
 */
import type { AdapterContext, AdapterConventions, Collection, CollectionDraft, GalleyAdapter, ParsedModule } from "@galley/adapter-kit";

const CONFIG_FILES = ["eleventy.config.js", "eleventy.config.mjs", "eleventy.config.cjs", ".eleventy.js", ".eleventy.cjs"];

interface Dirs {
  input: string;
  output: string;
  data: string;
  includes: string;
  /** Folders copied through to the site as-is, relative to the site root. */
  passthrough: string[];
}

/** "./src/" → "src"; "" and "./" → ".". */
function clean(path: string): string {
  const out = path.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "");

  return out === "" ? "." : out;
}

function under(dir: string, path: string): string {
  return dir === "." ? clean(path) : clean(`${dir}/${path}`);
}

/** The `dir` object of an Eleventy config, in any of the shapes it is written. */
function dirObject(module: ParsedModule): ReturnType<ParsedModule["configObject"]> {
  const fromConfigExport = module.prop(module.exported("config"), "dir");

  return fromConfigExport ?? module.prop(module.configObject(), "dir");
}

/** One read of the config per detection; every hook gets the same context, so a WeakMap carries it. */
const cache = new WeakMap<AdapterContext, Dirs>();

function dirsOf(ctx: AdapterContext): Dirs {
  const known = cache.get(ctx);

  if (known) return known;
  const file = CONFIG_FILES.find((name) => ctx.exists(name));
  const text = file ? (ctx.readText(file) ?? "") : "";
  const module = file ? ctx.helpers.readModule(file) : null;
  const dir = module ? dirObject(module) : undefined;
  const value = (key: string): string | null => (module && dir ? module.string(module.prop(dir, key)) : null);
  // Eleventy 3 can also set them with calls inside the config function.
  const call = (name: string): string | null => new RegExp(`\\.${name}\\(\\s*["'\`]([^"'\`]+)["'\`]`).exec(text)?.[1] ?? null;
  const input = clean(value("input") ?? call("setInputDirectory") ?? ".");
  const dirs: Dirs = {
    input,
    output: clean(value("output") ?? call("setOutputDirectory") ?? "_site"),
    data: clean(value("data") ?? call("setDataDirectory") ?? "_data"),
    includes: clean(value("includes") ?? call("setIncludesDirectory") ?? "_includes"),
    passthrough: [...text.matchAll(/addPassthroughCopy\(\s*["'`]([^"'`*{]+)["'`]\s*\)/g)].map((match) => clean(match[1]!)),
  };

  cache.set(ctx, dirs);
  return dirs;
}

/** The directory data file of a folder (`posts/posts.json` or `posts/posts.11tydata.json`), parsed. */
function directoryData(ctx: AdapterContext, folder: string): { tags?: unknown; permalink?: unknown } | null {
  const name = folder.split("/").pop() ?? folder;

  for (const file of [`${folder}/${name}.11tydata.json`, `${folder}/${name}.json`]) {
    const data = ctx.readJson<{ tags?: unknown; permalink?: unknown }>(file);

    if (data && typeof data === "object" && !Array.isArray(data)) return data;
  }
  return null;
}

/** An Eleventy permalink as a Galley URL pattern, when it is built from the file's own name. */
function patternFromPermalink(permalink: string): string | null {
  const pattern = permalink.replace(/\{\{-?\s*page\.fileSlug(?:\s*\|\s*slugify)?\s*-?\}\}/g, "{slug}");

  if (/\{\{|\{%/.test(pattern) || (pattern.match(/\{slug\}/g) ?? []).length !== 1) return null;
  return pattern.startsWith("/") ? pattern : `/${pattern}`;
}

function folderUrl(input: string, folder: string): string {
  const inner = input === "." ? folder : folder.slice(input.length + 1);

  return inner === "" || inner === "." ? "/{slug}/" : `/${inner}/{slug}/`;
}

export const eleventyAdapter = {
  id: "eleventy",
  name: "Eleventy",
  apiVersion: 1,

  // #region detect
  detect(ctx: AdapterContext) {
    const range = ctx.hasDependency("@11ty/eleventy");
    const config = CONFIG_FILES.find((file) => ctx.exists(file));

    if (range === null && !config) return null;
    const version = range === null ? null : ctx.dependencyVersion("@11ty/eleventy");
    const confidence = range !== null && config ? 0.95 : range !== null ? 0.9 : 0.8;

    return version ? { confidence, version } : { confidence };
  },
  // #endregion detect

  // #region conventions
  conventions(ctx: AdapterContext): AdapterConventions {
    const dirs = dirsOf(ctx);
    // A passthrough-copied folder is served at its path inside the input folder: src/img → /img.
    const media = dirs.passthrough
      .filter((dir) => ctx.isDirectory(dir))
      .map((dir) => ({ dir, publicPath: `/${dirs.input === "." ? dir : dir.replace(`${dirs.input}/`, "")}` }));

    return {
      dev: { command: "npx @11ty/eleventy --serve", port: 8080 },
      build: { command: "npx @11ty/eleventy", outDir: dirs.output },
      ...(media.length > 0 ? { media: { dir: media[0]!.dir, publicPath: media[0]!.publicPath, roots: media } } : {}),
      contentDirs: [dirs.input],
      pageDirs: [dirs.input],
    };
  },
  // #endregion conventions

  // #region collections
  collections(ctx: AdapterContext): CollectionDraft[] {
    const dirs = dirsOf(ctx);
    const skip = [under(dirs.input, dirs.includes), under(dirs.input, dirs.data)];
    const drafts: CollectionDraft[] = [];

    // A folder with a directory data file is a collection, named by its tag.
    for (const file of ctx.glob(["**/*.11tydata.json", "**/*.json"], { cwd: dirs.input === "." ? undefined : dirs.input })) {
      const parts = file.split("/");
      const folder = parts.slice(0, -1).join("/");
      const name = parts.at(-1)!.replace(/(\.11tydata)?\.json$/, "");

      if (folder === "" || folder.split("/").pop() !== name || skip.some((dir) => folder.startsWith(dir))) continue;
      if (drafts.some((draft) => draft.path === folder)) continue;
      const data = directoryData(ctx, folder);
      const tag = Array.isArray(data?.tags) ? data.tags.find((item) => typeof item === "string") : data?.tags;

      drafts.push({ id: typeof tag === "string" && /^[\w-]+$/.test(tag) ? tag : name, path: folder, pattern: "**/*.md", format: "markdown" });
    }
    // Every other folder of markdown, the top-level pages included, by looking.
    const found = ctx.helpers.markdownCollections({ claimed: [...drafts.map((draft) => draft.path), ...skip] });
    // Global data files: one data collection each.
    const data = ctx.helpers.dataCollections([under(dirs.input, dirs.data)]);

    if (drafts.length > 0) ctx.note(`Found ${drafts.length} Eleventy collection${drafts.length === 1 ? "" : "s"} from directory data files.`);
    return [...drafts, ...found, ...data];
  },
  // #endregion collections

  // #region routes
  routes(ctx: AdapterContext, collections: Collection[]): Record<string, string | null> {
    const { input } = dirsOf(ctx);
    const urls: Record<string, string | null> = {};

    for (const collection of collections) {
      if (collection.kind === "data") {
        urls[collection.id] = null;
        continue;
      }
      const permalink = directoryData(ctx, collection.path)?.permalink;

      if (permalink === false) urls[collection.id] = null;
      else if (typeof permalink === "string") {
        const pattern = patternFromPermalink(permalink);

        if (!pattern) ctx.note(`The “${collection.label}” permalink (${permalink}) is built from more than the file name, so its pages could not be matched to their files.`);
        urls[collection.id] = pattern;
      } else if (collection.path === input) urls[collection.id] = "/{slug}/";
      else urls[collection.id] = folderUrl(input, collection.path);
    }
    return urls;
  },
  // #endregion routes
} satisfies GalleyAdapter;

export default eleventyAdapter;
