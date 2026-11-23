---
title: What Galley reads from an Astro project
navTitle: Content collections
description: The Astro adapter reads astro.config, the content config and its zod schemas, and src/pages — statically, never running them. Which zod shapes become which fields, how discriminated unions become page sections, and what it can't read.
group: astro
order: 1
---

This page is for developers with an Astro site. It lists exactly what Galley's Astro adapter reads and how it maps each thing, so you can predict what the form will show — and fix it with a line of config when it is wrong. The adapter is [`packages/core/src/adapters/astro/`]({repository}/tree/main/packages/core/src/adapters/astro).

**Nothing is executed.** The config files are parsed as JavaScript/TypeScript source and read as far as they are plainly readable; nothing is imported, nothing runs. A config that does something clever yields fewer collections and a note in `galley doctor`, never an error.

## What it reads

| File | What it takes |
| --- | --- |
| `astro.config.{mjs,ts,…}` | `srcDir`, `publicDir`, `outDir`, `base`, `site` (the live address, unless it is a placeholder such as `example.com`), `trailingSlash`, `build.format`, `server.port` — including a value imported from a JSON file or an environment fallback |
| `<srcDir>/content.config.{ts,mts,mjs,js}`, or the legacy `<srcDir>/content/config.*` | every collection in `export const collections`: its loader and its zod schema, following relative imports |
| `<srcDir>/pages/**` | which dynamic routes render which collection, for each collection's URL pattern |
| `<srcDir>/data/*.{json,yaml,yml}` | each file not already claimed by a collection becomes a data collection |
| `package.json`, the lockfile | the Astro version, the package manager, the `dev` and `build` scripts |

## Loaders

| Loader | Becomes |
| --- | --- |
| `glob({ base, pattern })` | an entries collection at `base` with that pattern. Markdown and MDX patterns get a body; JSON/YAML patterns don't. Negated patterns (`!drafts/**`) are not applied, and `doctor` says so. A `base` written as `new URL("./x", import.meta.url)` is resolved relative to the config file. |
| `file("src/data/team.json")` | a data collection: one file, no body, no URL. An array of records gets an `items` list whose item fields come from the schema; an object keyed by id is described by its files instead. |
| legacy `type: "content"` / `type: "data"` | the folder of that name under `src/content/` |
| Starlight's `docsLoader()` / `i18nLoader()` | `src/content/docs` (markdown) and `src/content/i18n` |
| a custom or remote loader | not editable — *uses a custom loader, so it is not editable here* |

A collection whose loader names its entries with its own code (`generateId`) is read, with a note that page addresses may differ from file names. Collections spread in from elsewhere, or built by calling a function, are skipped with a note. When the content config can't be read at all, the folders under `src/content/` are scanned instead.

## Zod to fields

[`content/detect/zod.ts`]({repository}/blob/main/packages/core/src/content/detect/zod.ts) reads each schema expression. What it recognises:

| Zod | Field |
| --- | --- |
| `z.string()` | `string` — refined by the files to `text`, `markdown`, `image`, `url`, `color`, `date` or `datetime` when every value says so |
| `.url()`, `.datetime()`, `.date()` on a string | `url`, `datetime`, `date` |
| `z.number()`, `z.bigint()`, `z.int()`, `z.coerce.number()` | `number` |
| `z.boolean()` | `boolean` |
| `z.date()`, `z.coerce.date()` | `date` |
| `z.enum([...])`, a union of string literals | `select` with those `options` |
| `image()` (from the schema function's argument) | `image` |
| `reference("authors")` | `reference` into that collection |
| `z.array(z.string())` | `tags` |
| `z.array(…)` of anything else | `list` of that |
| `z.object({…})`, `strictObject`, `looseObject`, `.extend`, `.merge`, `.partial`, `.pick`, `.omit`, `z.intersection` | `object` with nested fields |
| `z.discriminatedUnion("type", [...])`, or a union of objects sharing a literal key | `blocks` — page sections |
| `.optional()`, `.nullable()`, `.nullish()`, `.catch()` | not required |
| `.default(value)` | not required, with that `default` when it is a literal |
| `.describe("…")` | the field's `description` (help text in the form, and context for the assistant) |
| anything else (`z.custom`, `z.any`, a schema computed at run time) | `json` — edited as source, then refined by what the files hold |

Identifiers are followed: a schema built from named pieces (`const link = z.object(…)`, used in several places) reads the same as one written inline. Keys the files carry that the schema doesn't declare are added as inferred fields after the declared ones, so a `.passthrough()` schema loses nothing.

On the starter this produces, for the blog (`galley doctor` abridged):

```text
blog: “Journal” · 8 fields (title, description, date, author, image, imageAlt, …) · src/content/blog/*.md → /blog/{slug}/
```

with `title` a required `string`, `description` a `text` (declared `z.string()`, refined because the values are long), `date` a `date` from `z.coerce.date()`, `tags` from `z.array(z.string()).default([])`, and `draft` a `boolean`.

## Page sections

A list of sections in front matter, declared as a discriminated union, is the shape Galley is built around:

```ts
const heroSection = z.object({
  type: z.literal("hero"),
  heading: z.string(),
  text: z.string().optional(),
  cta: link.optional(),
});
const ctaSection = z.object({ type: z.literal("cta"), heading: z.string(), cta: link });
const section = z.discriminatedUnion("type", [heroSection, ctaSection /* … */]);

const pages = defineCollection({
  loader: glob({ base: "./src/content/pages", pattern: "**/*.md" }),
  schema: z.object({ title: z.string(), sections: z.array(section).default([]) }),
});
```

`sections` becomes a `blocks` field with `discriminator: "type"` and one block type per union member, each with its own fields. From the files, each block type also gets a count and its most complete real instance as `example` — what **Add section** inserts. Without a schema, the same list is recognised from the files when 90 % of its items share a type key (`type`, `_component`, `_type`, `block`, `component`, `template`, …).

## URLs

For each collection, the adapter looks in `src/pages` for a dynamic route that renders one page per entry — one that calls `getCollection("blog")`, or `getEntry("blog", …)` with an id from `Astro.params` — and turns its path into the collection's pattern: `src/pages/blog/[...slug].astro` → `/blog/{slug}/`. Endpoints (`.ts`/`.js`) and paginated listings don't count. `base` is prefixed, and the trailing slash follows `trailingSlash` and `build.format`. A collection no route renders gets `url: null`, with a note: *No page in src/pages shows an entry of “Team”, so it has no pages of its own.*

Routes are read from the route files' text, so a route that computes which collection it shows can't be matched. Set `url` for that collection in `galley.config.json`. Reading Astro's own route table exactly would need an Astro integration, which is on the [roadmap]({repository}/blob/main/ROADMAP.md).

## Helping it with config

Each of these is a line in `galley.config.json` ([Collections and fields](/docs/configuration/collections/)):

```json galley.config.json
{
  "collections": [
    { "id": "blog", "url": "/journal/{slug}/" },
    { "id": "team", "label": "Team", "singular": "team member", "url": null },
    { "id": "events", "path": "src/content/events", "pattern": "**/*.md", "url": "/events/{slug}/" },
    {
      "id": "pages",
      "fields": [
        { "key": "category", "type": "select", "options": ["News", "Guides", "Studio"] },
        { "key": "ogImage", "type": "image", "label": "Share image" }
      ]
    }
  ]
}
```

- a URL pattern the routes don't reveal;
- a collection from a custom loader, given its `path` and `pattern` (Galley then edits the files; it can't know what the loader does with them);
- a select the evidence was too thin for;
- a label in the editor's words.

## Next

- [The preview and astro dev](/docs/astro/preview/).
- [Making an Astro site easy to edit](/docs/astro/editable-sites/).
- [Detection and schema inference](/docs/concepts/detection/) — the framework-independent part.
