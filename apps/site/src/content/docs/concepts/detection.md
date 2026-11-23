---
title: Detection and schema inference
navTitle: Detection and inference
description: How Galley works out a site's framework, commands, collections, fields, page sections, URLs and media without running any of its code — and the precedence config > schema > inferred.
group: concepts
order: 4
---

This page is for developers. It explains the first principle — *zero config, then config* — by walking through what detection reads, in order. `galley doctor` prints the result; `GET /api/sites/<id>` returns it as the `SiteModel`.

Nothing is executed: no config file is imported, no dev server is started, no package script is run. Everything below comes from reading files.

## 1. The framework

Each built-in adapter rates how well it matches the folder — from the packages in `package.json` and the config files present — and the most confident wins. The built-in adapters, in the order that breaks ties:

| Id | Recognised by | Collections come from |
| --- | --- | --- |
| `astro` | the `astro` package, `astro.config.*` | `src/content.config.*`, read statically — see [Astro](/docs/astro/content-collections/) |
| `docusaurus`, `nuxt`, `next`, `sveltekit`, `eleventy`, `hugo`, `jekyll` | their packages and config files | conventional content folders, scanned |
| `generic` | anything | any folder holding two or more markdown files with front matter |

Only Astro has an adapter that reads the framework's own configuration; the others know how to run the site and where its content conventionally lives. `"framework"` in `galley.config.json` overrides the choice. Adapters for other frameworks are on the [roadmap]({repository}/blob/main/ROADMAP.md); see [Adapters](/docs/adapters/).

## 2. Commands and package manager

- **Package manager**: from the lockfile — `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`/`bun.lockb`, else npm.
- **Dev command**: the first of the `dev`, `start` or `serve` scripts in `package.json`, run with that package manager (`npm run dev`). Its port comes from a `--port` in the script, else the framework's default (4321 for Astro).
- **Build command**: the `build` script; output folder from the framework (`dist` for Astro).

## 3. Collections

A **collection** is either a folder of entries (one file per page or post) or a single data file (settings, navigation). The framework's adapter declares them when it can; otherwise folders are scanned. Data files under the framework's data folders — `src/data/*.{json,yaml,yml}` on Astro — become data collections.

## 4. Fields

Each collection's fields come from two sources, joined:

- **The schema**, when the framework declares one — on Astro, the zod schema in the content config, read as far as it is plainly readable. Schema fields are marked `source: "schema"`.
- **The files themselves.** Up to 400 files per collection are read and every value is classified ([`content/schema/infer.ts`]({repository}/blob/main/packages/core/src/content/schema/infer.ts)). Inferred fields are marked `source: "inferred"`.

What inference looks for:

| Evidence in the files | Field type |
| --- | --- |
| `true`/`false` everywhere | `boolean` |
| numbers everywhere | `number` |
| `2026-11-20` / `2026-11-20T09:30` | `date` / `datetime` |
| a path or URL ending in an image extension | `image` |
| `https://…`, `mailto:`, `/a/path`, `#anchor` | `url` |
| `#1f6feb` | `color` |
| several lines, or markdown syntax | `text` / `markdown` |
| a list of short strings | `tags`, with the values seen as suggestions |
| a list of objects that share a type key | `blocks` (page sections) — see below |
| a nested object | `object`, with its own fields |
| a number here, a string there | `string` — Galley doesn't guess between them |

A field present in 95 % or more of the files is **required**. A string field becomes a **select** only on strong evidence: at least 12 files and no more than 8 distinct values, each 40 characters or shorter — otherwise it stays text, and you can add `options` in config. Up to three real values are kept as **examples**: placeholders in the form, and context for the assistant.

## 5. Page sections (blocks)

A list of objects that all carry one of these keys — `type`, `_component`, `_type`, `block`, `component`, `template`, `_template`, `blockType`, `_block` — on at least 90 % of the items becomes a `blocks` field. Each distinct value is a **block type** with its own fields, inferred from every instance, and the most complete real instance is kept as its `example` — the scaffold Galley uses when someone adds a section of that type.

On Astro, a `z.discriminatedUnion("type", […])` in the schema declares the block types directly; the files then fill in examples. See [Page sections from discriminated unions](/docs/astro/content-collections/#page-sections).

## 6. URLs, media and the live site

- **URLs**: each collection's URL pattern (`/blog/{slug}/`) comes from the framework's routes — on Astro, the dynamic routes in `src/pages` that render that collection. A collection no route renders gets `url: null` and no page of its own, and `doctor` says so.
- **Media**: the public folder (`public/`) and, inside it, the first of `images`, `img`, `assets/images`, `assets/img`, `assets`, `media`, `uploads`. New images are saved there; the whole public folder is scanned for the library.
- **The live address**: `site` in the Astro config (a placeholder such as `example.com` is ignored), a `CNAME` file, or `homepage` in `package.json`.
- **Assistant instructions**: `STYLE.md`, `STYLEGUIDE.md`, `STYLE_GUIDE.md`, `style-guide.md`, `docs/style-guide.md`, `brand/voice.md`, `VOICE.md` or `BRAND.md`, if present.

## Precedence: config > schema > inferred

Three sources can describe the same field. They are layered, never mixed blindly ([`content/schema/merge.ts`]({repository}/blob/main/packages/core/src/content/schema/merge.ts), [`content/config/config.ts`]({repository}/blob/main/packages/core/src/content/config/config.ts)):

1. **Inferred** is the base: what the files show.
2. **Schema** is authoritative about which fields exist, their types and what is required. The files may only *refine* a vague declaration: a `z.string()` that every file fills with an image path becomes an `image` field; a list of objects whose items all carry a type key becomes `blocks`. A field the schema couldn't read statically (`json`) takes the inferred definition.
3. **Config** (`galley.config.json`) beats both. It merges by collection `id` and field `key`, so one line can fix one label without restating anything else. A field gets `source: "config"` once config touches it.

## When detection is wrong

Run `galley doctor` and read its notes — they say what was read, what was ignored and why. Then correct it in `galley.config.json` ([Configuration](/docs/configuration/)): a wrong label, a field that should be a select, a collection detection missed (give it a `path`), a URL pattern. If the content config itself couldn't be read, `doctor` says which part, and the collections fall back to the folders under `src/content/`.

## Next

- [What Galley reads from an Astro project](/docs/astro/content-collections/).
- [Collections and fields](/docs/configuration/collections/) — every override.
- [Field types](/docs/configuration/collections/#field-types).
