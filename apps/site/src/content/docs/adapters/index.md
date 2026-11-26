---
title: Adapters
navTitle: How adapters work
description: How frameworks plug into Galley, the adapters that ship with it and what each one finds, and how a site loads one of its own.
group: extend
order: 1
---

This page is for developers whose site isn't built with Astro, or who want to teach Galley about a framework. An **adapter** is a small module — a plain object, often one dependency-free file — that answers four questions about a site: *is it yours?*, *how is it run?*, *which files hold content?*, *at what address is each entry's page?* Everything else — reading and editing the files, inferring fields, the proof, publishing — is the engine's, the same for every framework. The full API is in [Writing an adapter](/docs/adapters/writing/), rendered from [`docs/adapters.md`]({repository}/blob/main/docs/adapters.md).

## The built-in adapters

Galley asks every adapter whether it recognises the site; the most confident describes it ([Detection](/docs/concepts/detection/#1-the-framework)). These ship with Galley, in [`packages/core/src/adapters/`]({repository}/tree/main/packages/core/src/adapters):

| Adapter | Recognised by | Runs it with | Content from |
| --- | --- | --- | --- |
| **Astro** | the `astro` package, `astro.config.*` | the `dev` script; port from the config (4321) | the content config, read statically; `src/data`; routes from `src/pages` — [details](/docs/astro/content-collections/) |
| Docusaurus | `@docusaurus/core`, `docusaurus.config.*` | the `dev`/`start` script; port 3000 | `docusaurus.config.*` (classic preset and standalone `docs`, `blog` and `pages` plugins, `url`, `baseUrl`, `trailingSlash`, `staticDirectories`); data in `data` |
| Nuxt | `nuxt`, `@nuxt/content`, `nuxt.config.*` | the `dev` script; port from `devServer.port` (3000) | `nuxt.config.*` (`srcDir`, `@nuxt/content` v2 `content.sources`) and `@nuxt/content` v3 `content.config.*` (`defineCollection` and Zod schemas); clears `.data/content/contents.sqlite` on preview restarts |
| Next.js | `next`, `next.config.*` | the `dev` script; port 3000 | `next.config.*` (`output`, `distDir`, `trailingSlash`, `basePath`, `pageExtensions`), MDX route pages, Contentlayer (`contentlayer.config.*`), Velite (`velite.config.*`), plus conventional content and data folders |
| SvelteKit | `@sveltejs/kit`, `svelte.config.*` | the `dev` script; port from `vite.config.*` (5173) | `svelte.config.*` and `vite.config.*` (custom routes/assets/base paths, MDsveX `.svx` route pages), plus conventional content and data folders |
| Eleventy | `@11ty/eleventy`, `.eleventy.*` / `eleventy.config.*` | the `dev`/`start` script; port 8080 | `eleventy.config.*` / `.eleventy.*` (object and fluent v3 configs, `dir.*`, `pathPrefix`, `addPassthroughCopy` media), directory data files (`*.11tydata.*` tags and permalinks), and global data |
| Hugo | `hugo.*`, `config.*`, or `config/_default/` | `hugo server`, port 1313 | root and `config/_default/` configs (`baseURL`, `contentDir`, `publishDir`, `staticDir`, `dataDir`, `uglyURLs`), multilingual `[languages]` and `[permalinks]` (front matter in TOML is read-only) |
| Jekyll | `_config.yml` / `_config.yaml` with `_posts/` or a `Gemfile` | `bundle exec jekyll serve`, port 4000 | `_config.yml` (`url`, `baseurl`, `source`, `destination`, `collections_dir`, `data_dir`, `collections:` with `output` and `permalink`), `_posts` and `_data` |
| Generic | any folder (weakly, so anything else wins) | the `dev`/`start`/`serve` script, if there is one | `content`, `src/content` or the root: any folder with two or more markdown files that start with front matter; data in `data`, `_data`, `src/data`. No URL patterns — without a framework there is no telling where pages are served. |

All eight framework adapters read each framework's own configuration statically, without running site code; Astro fits deepest because the site kit and starters are Astro. Adapters for other frameworks are welcome — a worked standalone [Eleventy adapter]({repository}/tree/main/examples/adapter-eleventy) is in the repository as an example. When detection gets something wrong, [`galley.config.json`](/docs/configuration/) corrects it.

## Loading a site's own adapter

A site names its adapters in `galley.config.json`, as files inside the site or packages in its own `node_modules`; they are asked before the built-in ones:

```json galley.config.json
{
  "adapters": ["./tools/lume-adapter.mjs"],
  "framework": "lume"
}
```

`framework` makes that adapter describe the site whatever the others say. `galley doctor` lists what was loaded and anything that couldn't be. Loading an adapter runs code from the site's repository inside Galley's process — the same trust the preview already gives the site's dev server. Nothing is loaded unless the config names it, nothing from outside the site, and `GALLEY_DISABLE_SITE_ADAPTERS=1` turns site adapters off entirely ([the trust model](/docs/adapters/writing/#the-trust-model)).

## Proving an adapter works

The conformance kit, `@galley/adapter-kit` ([`packages/adapter-kit`]({repository}/tree/main/packages/adapter-kit)), runs sixteen checks against a small fixture site: it is recognised and wins against the built-ins, it doesn't claim other sites, nothing throws, collections exist and parse, **every entry survives an edit and its undo byte for byte**, URL patterns give every entry its own address, and the adapter never writes. Run from a clone against the Lume sample in the guide:

```sh
node packages/adapter-kit/bin/galley-adapter-check.js ./lume-adapter.mjs packages/adapter-kit/test/fixtures/lume-site
```

```output
…
ok    Entries survive an edit and its undo, byte for byte
      5 entries edited and restored.
…

All 16 checks passed.
```

The kit isn't on npm yet; neither is any adapter.

## Next

- [Writing an adapter](/docs/adapters/writing/) — the whole API.
- [Proposing an adapter as a built-in](/docs/adapters/writing/#proposing-an-adapter-as-a-built-in).
