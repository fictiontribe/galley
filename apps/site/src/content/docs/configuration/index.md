---
title: galley.config.json
navTitle: Overview
description: When you need a config file, how galley init writes one, how it merges over detection, and what happens when it has a mistake in it.
group: configuration
order: 1
---

This page is for developers. Galley needs no configuration: opening a folder is enough. `galley.config.json` exists only to **correct or extend what detection found** — a label in the editor's words, a URL pattern the routes don't reveal, a collection detection missed, where publishes go. Keep it small; anything you leave out keeps coming from detection, and stays right when the site changes.

The file lives at the root of the site and is committed with it. Other tools ignore it.

## Write one with galley init

```sh
$ galley init
✓ Astro 7.4.13 · npm · dev: npm run dev (port 4321)
✓ 5 collections: pages (8), blog (4), team (4), navigation (data), site (data)
! No live site address found — add urls.production to compare previews with the live site
✓ Wrote /Users/you/sites/lowfield/galley.config.json
```

It writes only what a person might want to adjust — the name, the live addresses it found, and each collection's id, label and URL pattern:

```json galley.config.json
{
  "$schema": "https://galley.fictiontribe.com/schema/galley.config.json",
  "name": "galley-astro-starter",
  "collections": [
    { "id": "pages", "label": "Pages", "url": "/{slug}/" },
    { "id": "blog", "label": "Blog posts", "url": "/blog/{slug}/" },
    { "id": "team", "label": "Team", "url": null },
    { "id": "navigation", "label": "Navigation", "url": null },
    { "id": "site", "label": "Site", "url": null }
  ]
}
```

(Printed one collection per line here; `init` writes standard two-space JSON.) Delete the lines that are already right. `--force` replaces an existing file; `--json` prints the result as JSON.

The `$schema` URL is where the JSON Schema will be published for editor autocompletion. It isn't served yet; until it is, the schema comes from `configJsonSchema()` in [`content/config/schema.ts`]({repository}/blob/main/packages/core/src/content/config/schema.ts), and the [reference](/docs/reference/config/) lists every key.

## How it merges

Config is the top layer of three: **config > schema > inferred** ([detection](/docs/concepts/detection/#precedence-config-schema-inferred)).

- **Collections merge by `id`**, **fields by `key`**, **block types by `type`**. Give only what changes; everything else about that collection or field stays as detected.
- **An `id` detection doesn't know adds a collection.** It needs a `path`; without one it is skipped with a note.
- **A `path`, `pattern`, `format` or `kind` that differs from detection re-reads that collection** from its new files, so counts and inferred fields stay true.
- **Objects merge key by key** (`publish`, `ai`, `urls`, `media`); **lists replace** (`ai.instructions`, `writable.content`, `media.roots`, `options`).

The smallest useful config fixes one label:

```json galley.config.json
{
  "collections": [{ "id": "blog", "label": "Journal", "singular": "post" }]
}
```

## Mistakes

The file is validated strictly with the same zod schema that produces the JSON Schema. Unknown keys are errors, so a typo can't be silently ignored. A file with problems is **ignored as a whole** — detection carries on as if it weren't there — and `galley doctor` says why. This file:

```json galley.config.json invalid
{
  "name": "Lowfield Studio",
  "colour": "#0B6E4F",
  "publish": { "mode": "review" },
  "urls": { "production": "lowfield.example" },
  "collections": [{ "id": "blog", "fields": [{ "key": "category", "type": "dropdown" }] }]
}
```

gives, in `galley doctor`:

```text
  galley.config.json has 4 problems: urls.production: should be a valid web address (https://…). publish.mode: must be one of "commit", "pull-request". collections[0].fields[0].type: must be one of "string", "text", "markdown", "number", "boolean", "date", "datetime", "image", "url", "color", "select", "tags", "list", "object", "blocks", "reference", "json". The config: “colour” is not a setting Galley knows. The file was ignored until it is fixed.
```

and a JSON syntax error gives *galley.config.json is not valid JSON. Check for a missing comma or quote. The file was ignored until it is fixed.*

## Other ways to change it

- **The site's settings page** in the web UI (addresses, publishing, preview, media, assistant files), and `PUT /api/sites/<id>/config` — validated the same way; an invalid config is refused rather than saved.
- **The assistant in build mode** has a `save_site_config` tool that rewrites the file. It goes into the proof like any other change.

## The pages in this section

- [Collections and fields](/docs/configuration/collections/) — every collection and field setting, and all 17 field types.
- [Publishing](/docs/configuration/publishing/) — branch, mode, remote, push; the live addresses.
- [Media](/docs/configuration/media/) — where images are saved and found.
- [Assistant instructions and build mode](/docs/configuration/assistant/) — `ai` and `writable`.
- [White-label](/docs/configuration/white-label/) — renaming the product (not in this file: it is a server setting).
- [Config reference](/docs/reference/config/) — every key, its type and default, checked against the schema.
