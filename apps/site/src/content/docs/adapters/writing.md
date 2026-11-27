---
title: "Writing a Galley adapter"
navTitle: "Writing an adapter"
description: "The adapter API in full — the hooks, the helpers, what the engine fills in, the conformance kit, using and publishing an adapter, and the trust model."
group: "extend"
order: 2
---

<!-- Generated from docs/adapters.md by apps/site/scripts/sync-docs.mjs. Edit that file, not this one. -->

> This page is [`docs/adapters.md`]({repository}/blob/main/docs/adapters.md) from the repository, rendered as it is. `@galleycms/adapter-kit` lives in `packages/adapter-kit` in the repository; from a clone you can also run the kit's checker directly as `node packages/adapter-kit/bin/galley-adapter-check.js <adapter> <fixture>`.

Galley is built around Astro, and every other framework arrives through an
**adapter**: a small module that tells Galley how to recognise a site of that
framework, where its content lives, how its URLs map to files and how to run
it. The built-in Astro adapter is written against exactly the API described
here, so anything it can do, yours can.

This guide is for someone who knows their framework well and has never seen
Galley's code. You will need an afternoon.

- [What an adapter is, and is not](#what-an-adapter-is-and-is-not)
- [A complete adapter in 25 lines](#a-complete-adapter-in-25-lines)
- [The hooks](#the-hooks)
- [The helpers](#the-helpers)
- [What the engine fills in](#what-the-engine-fills-in)
- [Testing with the kit](#testing-with-the-kit)
- [Using an adapter in a site](#using-an-adapter-in-a-site)
- [Publishing](#publishing)
- [The trust model](#the-trust-model)
- [Proposing an adapter as a built-in](#proposing-an-adapter-as-a-built-in)

Every code sample on this page is a real file that Galley's tests run or
compare, so none of them can go stale.

## What an adapter is, and is not

An adapter **describes** a site. It reads files — never writes them — and
answers a few questions: is this site yours? How is it run? Which folders and
files hold content? At what address is each entry's page?

An adapter does **not** render, build or serve anything. Galley previews a
site by running the site's own dev server and publishes by committing files;
the adapter only says which command starts that server. It does not parse
markdown or edit files either: Galley's engine does that, the same way for
every framework, so edits stay surgical (changing one value changes those
bytes and nothing else).

An adapter is a **plain object**. There is no base class and no required
dependency; the helpers you need arrive through the context object every hook
receives. A whole adapter can be one dependency-free `.mjs` file.

What a hook returns becomes part of the site's model, and the model is
read-only all the way down: return a new object each time, and don't keep
one to change later. A change to it would be an error where it is made.

## A complete adapter in 25 lines

This adapter teaches Galley about [Lume](https://lume.land), a static site
generator for Deno:

```js
// lume-adapter.mjs — a complete Galley adapter for Lume, with no dependencies.
export default {
  id: "lume",
  name: "Lume",
  apiVersion: 1,

  // A Lume site has a _config.ts (or .js) that imports Lume.
  detect(ctx) {
    const config = ctx.readText("_config.ts") ?? ctx.readText("_config.js");
    if (!config || !/from\s+["']lume\//.test(config)) return null;
    return { confidence: ctx.exists("deno.json") ? 0.95 : 0.8 };
  },

  // How to run it and where content lives; Galley finds the collections by looking.
  conventions(ctx) {
    const config = ctx.readText("_config.ts") ?? ctx.readText("_config.js") ?? "";
    const src = /\bsrc:\s*["'](?:\.\/)?([\w./-]*?)\/?["']/.exec(config)?.[1] || ".";
    return {
      dev: { command: "deno task serve", port: 3000 },
      build: { command: "deno task build", outDir: "_site" },
      contentDirs: [src],
      pageDirs: [src],
      dataDirs: [src === "." ? "_data" : `${src}/_data`],
    };
  },
};
```

That is enough. On a Lume site, Galley now knows how to start the preview
(`deno task serve`, port 3000), finds every folder of markdown under `src/`
as a collection (`src/posts` becomes "Posts", served at `/posts/{slug}/`; the
pages directly in `src/` become "Pages" at `/{slug}/`), turns each file in
`src/_data` into an editable data collection, and infers every field from the
files themselves.

## The hooks

```ts
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
  /**
   * Forget what the preview saved: the files (site-relative, files only, never
   * folders) the framework's dev server keeps between runs and trusts on its
   * next start, such as a store of already-checked content. The engine
   * removes exactly these before the preview starts on newer versions, so it
   * can't serve what it saved under the older ones. Leave it out when the
   * framework keeps nothing of the kind.
   */
  forgetPreviewSaves?(ctx: AdapterContext): MaybePromise<string[]>;
}
```

Only `id`, `name` and `detect` are required. Every hook may be `async`. A hook
that throws costs only what it would have provided: Galley notes the problem
in plain words and carries on with its defaults. The examples below come from
the worked [Eleventy adapter]({repository}/blob/main/examples/adapter-eleventy/src/index.ts).

### `detect(ctx)` — is this site yours?

Return `null` for "no", or `{ confidence, version? }`. Every installed
adapter is asked; the most confident one describes the site, and ties go to
the adapter registered first (the site's own adapters, then the built-ins).
The built-ins score 0.95 for "the framework's package and its config file",
0.9 for the package alone, 0.8 for the config file alone; the plain-markdown
fallback answers 0.05 for every folder. Keep `detect` fast — it runs for every
site Galley opens — and never throw for a site you do not recognise.

```ts
detect(ctx: AdapterContext) {
  const range = ctx.hasDependency("@11ty/eleventy");
  const config = CONFIG_FILES.find((file) => ctx.exists(file));

  if (range === null && !config) return null;
  const version = range === null ? null : ctx.dependencyVersion("@11ty/eleventy");
  const confidence = range !== null && config ? 0.95 : range !== null ? 0.9 : 0.8;

  return version ? { confidence, version } : { confidence };
},
```

### `conventions(ctx)` — how to run it, where things live

Everything is optional; leave out what the engine's defaults already get right.

| Field | Meaning | Default |
| --- | --- | --- |
| `dev` | `{ command, port }` of the dev server. A `dev`/`start`/`serve` script in package.json wins for the command. | no command; port from a `--port` flag |
| `build` | `{ command, outDir }`. A `build` script wins for the command. | outDir `dist` |
| `publicDir` | the folder served at `/` as-is | `public` |
| `media` | `{ dir, publicPath, roots }`: where images go and the URL each folder is served at | an images folder in `publicDir` |
| `urls` | `{ production, staging }` addresses of the deployed site | a `CNAME` file, else package.json `homepage` |
| `trailingSlash` | whether page URLs end in `/` | `true` |
| `contentDirs` | folders scanned for markdown collections | the whole site |
| `pageDirs` | content folders whose own files are the top-level pages | none |
| `dataDirs` | folders whose JSON/YAML/TOML files are data collections | none |
| `contentUrls` | `"folders"` (`content/posts` → `/posts/{slug}/`) or `"none"` | `"folders"` |
| `builtFrom` | globs, from the site root, for what the site is built from: its source, the folder it serves as-is, the configuration its build reads | every file in the site |

The Eleventy adapter reads the input and output folders from the site's own
config, and turns passthrough-copied folders into media folders:

```ts
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
```

`dirsOf` reads the config once per detection and keeps it in a `WeakMap`
keyed by `ctx`: every hook of one detection receives the same context object,
so this is the way to share work between hooks.

### `collections(ctx)` — what the framework declares

Return the collections your framework declares. Each needs only an `id` and a
`path`; the engine fills in the label, format, count and fields (see
[What the engine fills in](#what-the-engine-fills-in)). Return `null` — or
leave the hook out — and the engine finds collections by looking in
`conventions().contentDirs`. Return `[]` to say the site has none.

A draft may carry `pattern` (a glob relative to `path`), `format`, `kind`
(`"entries"` for a folder of files, `"data"` for one file), `url`, labels,
`fields` (a partial schema; the files fill in the rest) and the
`titleField`/`dateField`/`imageField`/`draftField` the list view uses.

```ts
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
```

### `routes(ctx, collections)` — where each entry's page is

Return a URL pattern per collection id: a path with one `{slug}`
(`"/journal/{slug}/"`), or `null` for a collection with no pages of its own
(authors looked up by other pages, a settings file). A slug is the entry's
path inside its collection without the extension, so nested folders stay in
it (`en/harbour`), and `index` maps to the folder itself. The hook runs after
every collection is known and counted; ids you leave out keep what they had.
Galley uses these patterns to open the right page in the preview and to know
which file a clicked page came from, so a wrong pattern is worse than `null`.

```ts
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
```

### `environment(ctx)` — extra variables for the site's commands

Return environment variables the framework needs when Galley runs its dev
server or build. This adapter, written with `conventionAdapter` (below), turns
off a first-run prompt and declares its one collection itself, because each
post lives in a folder of its own:

```js
// gatsby-adapter.mjs — conventionAdapter does the detecting; the spec adds two hooks.
import { conventionAdapter } from "@galleycms/adapter-kit";

export default conventionAdapter({
  id: "gatsby",
  name: "Gatsby",
  packages: ["gatsby"],
  files: ["gatsby-config.js", "gatsby-config.mjs", "gatsby-config.ts"],
  dev: { port: 8000 },
  build: { outDir: "public" },
  publicDir: "static",
  // Each post is content/blog/<name>/index.md, served at /<name>/.
  collections: () => [{ id: "blog", label: "Blog posts", path: "content/blog", pattern: "**/index.md", url: "/{slug}/" }],
  // Gatsby asks whether it may collect usage data on first run; a preview should not stop to ask.
  environment: () => ({ GATSBY_TELEMETRY_DISABLED: "1" }),
});
```

#### `builtFrom`: what the site is built from

A file can name a picture without the built site using it: a README, a
script, a record kept beside the site. `builtFrom` tells the two apart. It is
a list of globs from the site root for everything the build reads: the source
folder, the folder served as it is, the configuration at the root. The Astro
adapter answers `src/**`, `public/**`, `*.config.*`, `package.json`,
`tsconfig.json` and `tsconfig.*.json`, with the site's own `srcDir` and
`publicDir` in place of the first two.

Galley uses it when media moves to a bucket: a repository file stays only
while something the site is built from, and that the move can't update,
still uses it. A file outside the list keeps nothing; the plan lists it as
"also mentioned in", and it isn't changed. Leave the field out and every file
in the site counts, which is safe and keeps more files than it need.

One exception, which an adapter gets for nothing: a file outside the list
still counts when a file inside it reads it by a relative path written out
there (`import team from "../../data/team.json"`). Galley finds that itself,
one step from the list, so `builtFrom` need only name the folders the
framework reads, not what each site's code goes on to import.

Include every folder the build reads. The conformance check fails an adapter
whose list leaves out a collection, a media folder or the routes folder. A
site adds to the list with `build.sources` in its `galley.config.json`, for a
build that reads a folder the framework doesn't know about.

### `forgetPreviewSaves(ctx)` — what the dev server saved between runs

Return the files (site-relative, files only) the framework's dev server keeps
between runs and trusts on its next start — a store of content it has already
read and checked, say. When newer versions come into the site (**Get latest**,
or a hosted editor bringing them in by itself), Galley stops a running
preview, brings the versions in, removes exactly these files and starts the
preview again; the app's own **Restart preview** removes them too when the
site has moved to another version since the preview started. Without it, a dev
server that saw a page and its schema change together could go on serving
what it saved under the old schema. Galley removes only regular files inside
the site folder, never a folder and never through a link that leads out of
it. Leave the hook out when the framework keeps nothing of the kind. The Astro
adapter returns its content store, in the two places Astro keeps it:
`.astro/data-store.json` and `node_modules/.astro/data-store.json`. The Nuxt
adapter returns `.data/content/contents.sqlite` (and its `-wal` and `-shm`
files).

`conventionAdapter(spec)` is the fastest way to write a simple adapter: give
it the packages and files that identify the framework and its conventions,
and it writes `detect` (0.95 / 0.9 / 0.8, with the version) and `conventions`
for you. Any hook in the spec is used too; a `conventions` hook is merged
over the static values, for things read from the site's own config.

## The helpers

Every hook receives `ctx`. File access is read-only and confined to the site
folder: a path that leads outside it throws (that is a bug in the adapter),
while a missing or unreadable file reads as `null`.

- `ctx.root` — the site folder's absolute path.
- `ctx.exists(path)`, `ctx.isDirectory(path)`, `ctx.list(path)` — sub-folders end in `/`.
- `ctx.readText(path)`, `ctx.readJson(path)`, `ctx.readData(path)` — JSON, YAML or TOML by extension. Files over 2 MB read as `null`.
- `ctx.glob(patterns, { cwd, limit })` — sorted site-relative paths; `node_modules`, `.git` and build output never match.
- `ctx.packageJson`, `ctx.hasDependency(name)` (the declared range) and `ctx.dependencyVersion(name)` (the installed version, else the range).
- `ctx.note(message)` — a line in the site's notes. Say what you found, in plain words.

And `ctx.helpers`, the building blocks the built-in adapters use:

- `markdownCollections(options)` — conventional discovery: every folder with
  at least two markdown files that start with front matter. Defaults come
  from your conventions; pass `roots`, `pageDirs`, `urls`, `trailingSlash` or
  `claimed` (folders another collection already owns) to adjust.
- `dataCollections(dirs)` — one data collection per JSON/YAML/TOML file.
- `dataFolderCollections(parent)` — one collection per sub-folder of JSON/YAML records.
- `parseModule(source)` and `readModule(path)` — read a JavaScript or
  TypeScript config **without running it**: declarations, imports, exports
  (ESM and CommonJS), calls, object literals, functions that return objects,
  and `process.env.X || "fallback"`. `readModule` also follows relative
  imports, and an imported `.json` file reads like an object literal. The
  result's `configObject()` finds the object a config exports, whether written
  as `export default defineConfig({…})`, `module.exports = function () { return {…} }`
  or anything in between; `prop`, `string`, `literal` and `callee` read values out of it.
- `fieldsFromZod(expr, module)` — the fields of a zod object schema.
- `fileRoutes(pagesDir)`, `urlPatternFromRoutes(routes, id, trailingSlash, ids)`
  and `routeOwner(route, ids)` — file-based routing (`[slug]`, `[...slug]`),
  and which collection each dynamic route renders.

The [Astro adapter]({repository}/blob/main/packages/core/src/adapters/astro/index.ts) uses all of
them; it is the best place to see what a thorough adapter looks like.

## What the engine fills in

Whatever an adapter leaves out, the engine works out from the site:

- **The package manager and commands.** Lockfiles name the package manager;
  `dev`, `start` or `serve` and `build` scripts in package.json become the
  commands, and a `--port` flag in the script the port.
- **Collections**, when `collections()` returns `null`: every folder of
  markdown under `contentDirs`, and every data file in `dataDirs`.
- **Labels and formats.** "blog" becomes "Blog" / "blog post"; the format
  comes from the file extension or the `pattern`.
- **Fields**, always: the engine reads the files (a sample of about 400 per
  collection) and infers each field's type — dates, images, URLs, colours,
  long text, markdown, lists, nested objects — and whether it is required
  (present in 95% of files). Fields you declare win; the files fill the gaps.
- **Blocks.** A list of objects that share a key such as `type` or
  `_component` becomes a blocks field (page sections), with one block type
  per value and the most complete real instance kept as the template for
  "add section".
- **Media folders, the live site address, the publish branch and remote,
  and which paths are writable** in content mode.

Config beats schema beats inference: a site's `galley.config.json` can still
correct anything an adapter or the engine got wrong.

## Testing with the kit

Install the conformance kit as a dev dependency:

```sh
npm install --save-dev @galleycms/adapter-kit
```

Make a fixture: a tiny invented site of your framework, a few files deep,
with every shape your adapter reads. Then the whole test file is one call
(this one is the Eleventy example's):

```ts
import { fileURLToPath } from "node:url";

import { describeAdapter } from "@galleycms/adapter-kit/vitest";

import { eleventyAdapter } from "../src/index";

const fixture = (name: string) => fileURLToPath(new URL(`../${name}`, import.meta.url));

describeAdapter(eleventyAdapter, fixture("fixture"), {
  collections: [
    { id: "posts", minEntries: 2, url: "/journal/{slug}/", fields: ["title", "date", "author"] },
    { id: "recipes", minEntries: 2, url: null, fields: ["serves"] },
    { id: "pages", minEntries: 2, url: "/{slug}/" },
    { id: "hours", url: null, fields: ["weekdays"] },
    { id: "staff", url: null },
  ],
  dev: { command: "npm start", port: 8080 },
});

describeAdapter(eleventyAdapter, fixture("fixture-classic"), {
  collections: [
    { id: "notes", minEntries: 2, url: "/notes/{slug}/" },
    { id: "pages", minEntries: 2, url: "/{slug}/" },
    { id: "site", url: null },
  ],
});
```

`describeAdapter` registers one vitest test per check. Without vitest, run the
same checks from the command line; it prints a report and exits non-zero when
a check fails:

```sh
npx galley-adapter-check ./lume-adapter.mjs ./lume-site
```

From code, `checkAdapter(adapter, fixtureDir, expectations)` returns the
report (`{ ok, checks, model }`) for you to inspect.

The checks are what "a correct adapter" means:

| Check | What it asks |
| --- | --- |
| Is a well-formed adapter object | id, name and detect are there and the right shape |
| Recognises its own fixture | `detect` says yes, confidently |
| Wins its fixture against the built-in adapters | no built-in outbids it |
| Does not claim sites that are not its own | it says no to a plain markdown folder and a Node web service |
| Copes with an empty folder | nothing throws when every file is missing |
| Decides quickly | `detect` takes well under 100 ms |
| Every hook runs without failing | no hook throws |
| Finds collections in its fixture | there is something to edit |
| Collection ids are unique and stable | no two collections share an id, and ids do not change |
| Every collection path exists and holds files | paths are right and patterns match |
| Every entry in the fixture parses | formats match the files |
| Entries survive an edit and its undo, byte for byte | for every entry, applying no edit returns the file unchanged, and changing a value and changing it back restores every byte — so the collections are genuinely editable |
| URL patterns are well formed and give every entry its own address | one `{slug}`, a leading `/`, no two entries at one address |
| Two runs describe the site the same way | no randomness, no clock |
| Nothing was written to the fixture | adapters only read |
| Says how to run and build the site | or explains that previews will be unavailable |
| What it says the site is built from holds the site's content | every collection, media folder and routes folder is inside `builtFrom`, when the adapter gives one |
| Matches the expectations given | the collections, URLs, fields and dev command you listed |

Every failure says what to change.

## Using an adapter in a site

Put the adapter file in the site and name it in `galley.config.json`, at the
site's root:

```json galley.config.json
{
  "adapters": ["./lume-adapter.mjs"]
}
```

Entries are package names (looked up in the site's own `node_modules`) or
paths starting with `./` inside the site. They are tried before the built-in
adapters, in order. To make one adapter describe the site whatever the others
say, add `"framework": "lume"`. The site's notes say which adapters were
loaded, and anything they could not read.

## Publishing

Publish an adapter to npm as `galley-adapter-<framework>`, with the
`galley-adapter` keyword so it can be found:

```json
{
  "name": "galley-adapter-lume",
  "version": "1.0.0",
  "description": "Galley adapter for Lume sites.",
  "type": "module",
  "exports": "./lume-adapter.mjs",
  "files": ["lume-adapter.mjs"],
  "keywords": ["galley-adapter", "galley", "lume"],
  "license": "Apache-2.0",
  "peerDependencies": { "@galleycms/adapter-kit": ">=0.1.0 <1" },
  "peerDependenciesMeta": { "@galleycms/adapter-kit": { "optional": true } },
  "devDependencies": { "@galleycms/adapter-kit": "^0.1.0" }
}
```

- Ship JavaScript: the main entry must be a module Node can import as it is
  (compile TypeScript first). Export the adapter as the default export, or as
  a named export called `adapter`.
- Set `apiVersion` to the version you wrote against (`ADAPTER_API_VERSION`,
  currently 1). A site running a Galley that speaks another version gets a
  plain note rather than a crash.
- A dependency-free adapter needs no dependencies at all. If it imports
  `conventionAdapter` (or anything else) from the kit at runtime, make the
  kit a regular dependency or a peer dependency with a range, as above, so
  the site's installed copy is used.
- Sites add it as a dev dependency (`npm install --save-dev galley-adapter-lume`)
  and name it in `adapters`.

## The trust model

An adapter is code from the site's repository, and Galley runs it inside its
own process. That is the same trust a site already gets: to show a preview,
Galley runs the site's own dev server, which executes the site's config and
dependencies anyway. So Galley adds no new trust — but it does not widen it
either:

- **Only what `galley.config.json` names is loaded.** Galley never scans
  `node_modules` for adapters or loads anything automatically.
- **Only from the site.** A path must resolve inside the site folder (symlinks
  that lead out are refused) and outside `.git`; a package name is looked up
  in the site's own `node_modules` only — never a parent folder's or a global
  install.
- **Only when allowed.** Set `GALLEY_DISABLE_SITE_ADAPTERS=1` where Galley
  runs — a hosted deployment opening sites it does not trust, say — and site
  adapters are skipped with a note; the built-in adapters describe the site.
- **A broken adapter costs only itself.** One that fails to load, is the
  wrong shape, or throws is skipped with a note; detection never fails
  because of an adapter.
- **Read-only access.** The context only reads files; an adapter that writes
  with its own code fails the kit's checks. Nothing about the context stops
  deliberate misuse, though — the protection is that only code the site's
  owners committed and named runs at all.
- Opening a site's folder without Galley reading its config — `detectSite`
  in the engine — never runs any site code.

## Proposing an adapter as a built-in

A built-in adapter ships with Galley, so it is held to a higher bar. Open a
pull request that adds it under `packages/core/src/adapters/<id>/` when:

1. It uses **only** the public API (`GalleyAdapter`, `AdapterContext` and
   its helpers) — no imports from the engine's internals. If you need
   something the context lacks, propose the helper instead; third parties
   will need it too.
2. It passes the kit on at least two fixtures (a current project layout and
   an older or minimal one) with no failures, and the warnings explained.
3. Its fixtures are small, invented sites — no real company's content.
4. It reads the framework's own config statically, never by running it,
   and says in a note whatever it could not read.
5. Its URL patterns come from the framework's routing rules, and it returns
   `null` rather than guessing when they cannot be known.
6. It is registered in `packages/core/src/adapters/index.ts` before the
   generic adapter, and replaces the framework's `conventionAdapter` entry if
   there is one.
7. Every message it writes follows the [voice guide]({repository}/blob/main/brand/voice.md):
   plain words, saying what happened and what to do.
