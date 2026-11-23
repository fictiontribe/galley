# galley-adapter-eleventy

A Galley adapter for [Eleventy](https://www.11ty.dev) sites, and the worked
example of a third-party adapter: it is built only on the public adapter API
(`@galley/adapter-kit`, types only), and it passes the kit's conformance
checks on two fixtures. The full guide is [docs/adapters.md](../../docs/adapters.md).

## What it reads

Nothing is ever run; every file is read as text.

- **The config** — `eleventy.config.{js,mjs,cjs}` or `.eleventy.{js,cjs}` —
  for the input, output, data and includes folders, written as
  `return { dir: {…} }` from the config function, `export const config = { dir: {…} }`,
  or `eleventyConfig.setInputDirectory("…")` calls; and
  `addPassthroughCopy("src/img")` folders, which become media folders served
  at `/img`.
- **Directory data files.** A folder with `posts/posts.json` (or
  `posts/posts.11tydata.json`) is a collection named by its `tags`. Its
  `permalink` becomes the URL pattern when it is built from the file's own
  name (`/journal/{{ page.fileSlug }}/` → `/journal/{slug}/`); `permalink:
  false` means no pages.
- **Everything else** by looking: the markdown files at the top of the input
  folder are the site's pages, other markdown folders are collections at
  `/<folder>/{slug}/`, and each `_data/*.json` file is a data collection.

It does not read JavaScript data files (`_data/*.js`, `*.11tydata.js`),
collections built in the config with `addCollection`, or permalinks computed
from anything but the file name (a date, a front-matter value) — those
collections get no URL pattern and a note says why. Eleventy's `fileSlug`
drops sub-folders, so a nested post (`posts/2026/rye.md`) is served at a
different address than the pattern gives.

## Use it

In a site, install it and name it in `galley.config.json`:

```json
{ "adapters": ["galley-adapter-eleventy"] }
```

(This package is the worked example inside the Galley repository; it is
TypeScript and points `exports` at the source. A published adapter ships
compiled JavaScript — see "Publishing" in the guide.)

## Make your own from this folder

1. Copy this folder and rename it `adapter-<framework>`; set `name` in
   `package.json` to `galley-adapter-<framework>`.
2. In `src/index.ts`, change `id` and `name`, then rewrite `detect`: look for
   what only your framework leaves behind — its package in package.json, its
   config file. Return `null` for anything else.
3. Rewrite `conventions` with how your framework is run and where it keeps
   content. If its content lives in ordinary markdown folders, you may need
   nothing else: delete `collections` and `routes`, and Galley finds the
   folders by looking.
4. Replace `fixture/` with a tiny invented site of your framework, and list
   in `test/adapter.test.ts` the collections it should yield.
5. Run the checks until they pass:

   ```sh
   pnpm test
   ```

   Every failure says what to change. Without vitest, run
   `npx galley-adapter-check ./src/index.ts ./fixture`.

## Files

- `src/index.ts` — the adapter.
- `fixture/` — an invented bakery's site: Eleventy 3, ESM config, `src/` input.
- `fixture-classic/` — an invented walking club's site: Eleventy 2, CommonJS `.eleventy.js`, default folders.
- `test/adapter.test.ts` — the kit's checks on both fixtures, with the collections each must yield.
