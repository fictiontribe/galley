---
title: Collections and fields
description: Correcting or adding collections, fields and page-section types in galley.config.json, and the 17 field types.
group: configuration
order: 2
---

This page is for developers. Every collection detection finds can be adjusted by its `id`, every field by its `key`, every page-section type by its `type` — and collections detection missed can be added. The full key list with types and defaults is in the [config reference](/docs/reference/config/).

## Collections

A collection is either **entries** — a folder with one file per page, post or person — or **data** — one file of settings, navigation or records.

| Key | Meaning |
| --- | --- |
| `id` | Required. Matches a detected collection, or adds a new one. |
| `label`, `singular` | The plural and singular names the editor sees: *Journal*, *post*. |
| `description` | A sentence shown with the collection and given to the assistant. |
| `kind` | `entries` or `data`. For a new collection, inferred from `path`: a `.json`, `.yaml`, `.yml` or `.toml` file is data. |
| `path` | Folder (entries) or file (data), relative to the site root. Required for a new collection. |
| `pattern` | Entries: a glob inside `path`, such as `**/*.md` or `*.{md,mdx}`. |
| `format` | `markdown`, `mdx`, `json`, `yaml` or `toml` (TOML is read-only). |
| `body` | Whether entries have a markdown body below the front matter. |
| `url` | The public URL pattern, with `{slug}`: `"/blog/{slug}/"`. `null` means the entries have no page of their own. |
| `titleField`, `dateField`, `imageField`, `draftField` | Which field the list view uses for the title, date, thumbnail and draft badge. Detected from common names (`title`, `name`, `date`, `pubDate`, `image`, `cover`, `draft`, …). |
| `create` | Whether new entries may be created from the app. |
| `hidden` | Leave it out of the navigation (its files stay editable). |
| `fields` | Field overrides and additions — below. |

```json galley.config.json
{
  "collections": [
    { "id": "blog", "label": "Journal", "singular": "post", "url": "/journal/{slug}/", "dateField": "published" },
    { "id": "events", "path": "src/content/events", "pattern": "*.md", "url": "/events/{slug}/" },
    { "id": "settings", "path": "src/data/settings.yaml", "label": "Settings" },
    { "id": "drafts", "hidden": true }
  ]
}
```

`slug` is the entry's path inside the collection folder without its extension: `src/content/blog/2026/launch.md` has the slug `2026/launch`. The pages collection maps `index` to `/`.

## Fields

| Key | Meaning |
| --- | --- |
| `key` | Required. The key in the file. |
| `label` | The label in the form. Defaults to the key in words (`heroImage` → *Hero image*). |
| `type` | One of the 17 types below. |
| `required` | Whether validation reports a missing value as an error. |
| `description` | Help text under the field; also given to the assistant. |
| `options` | `select`: the allowed values. `tags`: suggestions. |
| `default` | The value a new entry starts with. |
| `examples` | Sample values, shown as placeholders and given to the assistant. |
| `hidden` | Hide it from the form. The value stays in the file untouched. |
| `of` | `list`: the shape of one item, itself a field (its `key` defaults to `item`). |
| `fields` | `object`: the nested fields. |
| `discriminator` | `blocks`: the key that names a section's type. |
| `blocks` | `blocks`: the section types — below. |
| `collection` | `reference`: the collection the value points into. |

A field config that names a key detection didn't see adds the field (type `string` unless you say otherwise).

```json galley.config.json
{
  "collections": [
    {
      "id": "blog",
      "fields": [
        { "key": "category", "type": "select", "options": ["News", "Guides", "Studio"], "required": true },
        { "key": "author", "type": "reference", "collection": "team" },
        { "key": "description", "label": "Summary", "description": "Shown in search results. About 160 characters." },
        { "key": "seo", "type": "object", "fields": [{ "key": "image", "type": "image", "label": "Share image" }] },
        { "key": "legacyId", "hidden": true }
      ]
    }
  ]
}
```

## Field types

| Type | Holds | Detected from |
| --- | --- | --- |
| `string` | one line of text | any string |
| `text` | several lines of plain text | long or multi-line strings |
| `markdown` | text with markdown allowed | strings with markdown syntax |
| `number` | a number | numbers; `z.number()` |
| `boolean` | true or false | booleans; `z.boolean()` |
| `date` | `2026-11-20` | ISO dates; `z.date()`, `z.coerce.date()` |
| `datetime` | `2026-11-20T09:30` | ISO date-times; `.datetime()` |
| `image` | a site image path (`/images/x.webp`) or URL | image extensions; `image()` |
| `url` | a link: `https://…`, `/a/page/`, `#anchor`, `mailto:` | link-shaped strings; `.url()` |
| `color` | a hex colour, `#1f6feb` | hex values |
| `select` | one of `options` | `z.enum`; strong evidence in the files |
| `tags` | a list of short strings | lists of short strings; `z.array(z.string())` |
| `list` | a list of `of` | other lists |
| `object` | nested `fields` | objects; `z.object` |
| `blocks` | a list of objects, each of a type named by `discriminator` — page sections | lists of typed objects; discriminated unions |
| `reference` | the slug of an entry in `collection` | `reference()` |
| `json` | anything else, edited as source | values detection can't classify |

Validation checks the types it can: required fields, numbers, booleans, dates, select values, unknown block types, images that don't exist under a media root, internal links that match no page. A missing required value is an error when the schema or the config says the field is required, and only a warning when inference alone does. Keys a file has that no field describes are warnings, never errors.

## Page sections (blocks)

A `blocks` field carries one entry per section type. Adjust a detected type by its `type`, or declare one the files don't use yet:

```json galley.config.json
{
  "collections": [
    {
      "id": "pages",
      "fields": [
        {
          "key": "sections",
          "blocks": [
            { "type": "hero", "label": "Opening", "description": "The first section of a page. One per page." },
            {
              "type": "quote",
              "label": "Quote",
              "fields": [
                { "key": "quote", "type": "text", "required": true },
                { "key": "name", "type": "string" }
              ],
              "example": { "type": "quote", "quote": "They measured the whole house.", "name": "A client" }
            }
          ]
        }
      ]
    }
  ]
}
```

`example` is the scaffold inserted by **Add section** for that type; detection keeps the most complete real instance from the files when there is one. `count` (how often the type appears) is filled in by detection; setting it has no effect on the files. A section whose type the site's components don't render is the site's business — on the starter, it shows a notice in development and nothing in a build.

## Next

- [Config reference](/docs/reference/config/).
- [Detection and schema inference](/docs/concepts/detection/) — what you are correcting.
