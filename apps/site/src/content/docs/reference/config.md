---
title: Config reference
navTitle: galley.config.json reference
description: Every key galley.config.json accepts, with its type, its default and what it does. Checked against the engine's JSON Schema on every build of this site.
group: reference
order: 2
---

This page is for developers. It lists every key of `galley.config.json`. The file is validated by the zod schema in [`packages/core/src/content/config/schema.ts`]({repository}/blob/main/packages/core/src/content/config/schema.ts), which also produces the JSON Schema (`configJsonSchema()`); this site's build fails if a key here is missing from that schema or a schema key is missing here. Every key is optional unless marked **required**, and unknown keys are errors. *Default* means what Galley uses when the key is absent — usually what detection found.

How the file merges over detection: [galley.config.json](/docs/configuration/#how-it-merges).

## Top level

| Key | Type | Meaning and default |
| --- | --- | --- |
| `$schema` | string | The JSON Schema URL, for editors. `galley init` writes `https://galley.fictiontribe.com/schema/galley.config.json` (not served yet). Ignored by Galley. |
| `name` | string | The site's name in the Sites list and the assistant's description of the site. *Default:* `package.json` `name` (scope removed), unless it looks like a template's (`my-…`, `astro-…`, `example…`, `starter…`, `site`, `website`); else the folder name. |
| `framework` | `astro` · `eleventy` · `hugo` · `jekyll` · `next` · `nuxt` · `sveltekit` · `docusaurus` · `generic`, or another adapter's id (`^[a-z][a-z0-9-]*$`) | Which adapter describes the site. An id no loaded adapter has is reported and ignored. *Default:* the most confident adapter. |
| `adapters` | string[] (non-empty strings) | Adapters to load from this site before the built-in ones: package names in its `node_modules`, or paths to files inside it such as `"./tools/my-adapter.mjs"`. See [Adapters](/docs/adapters/). *Default:* none. |
| `plugins` | string[] (non-empty strings) | Plugins to load for this site only: package names in its `node_modules`, or paths to files inside it such as `"./tools/plugin.mjs"`. This runs the site's own code inside Galley, so only what is listed loads — and on a hosted Galley only when the operator sets `GALLEY_ALLOW_SITE_PLUGINS=1`. See [Plugins](/docs/plugins/). *Default:* none. |
| `dev` | object | How the preview starts the site. *Default:* detected. |
| `dev.command` | string | The dev server command. Run as an argument array, not through a shell. *Default:* the `dev`, `start` or `serve` script, run with the site's package manager (`npm run dev`). |
| `dev.port` | integer > 0 | The port the dev server is expected on. A server already answering there is reused; otherwise the port the started server announces is used. *Default:* a `--port` in the script, else the framework's default (Astro: `4321`). |
| `build` | object | How build mode checks the site. *Default:* detected. |
| `build.command` | string | The build command `run_build` runs. *Default:* the `build` script, run with the package manager. |
| `build.outDir` | string | Where the build writes: a folder inside the site. A deploy uploads everything in it, so one that leads out of the site, is the site folder itself, or is the version history's own (`.git`) or a secrets folder, is refused. A build that writes outside the site (a monorepo set to `../dist`) has to write inside it to be deployed from here. *Default:* the framework's (Astro: `dist`). |
| `build.sources` | string[] | Further files the build reads, as globs from the site root (`data/**`), beside what the framework's adapter names as what the site is built from and what the site's own source reads by a path written out in it. For what Galley can't follow: an alias, a path put together while the site builds. Moving media to a bucket keeps a repository file only while one of these still uses it ([Media in a bucket](/docs/configuration/media-storage/#what-stays-in-the-repository-and-why)). *Default:* none. |
| `urls` | object | The deployed site. *Default:* detected. |
| `urls.production` | string, a URL | The live site. *Default:* Astro `site` (placeholders ignored), a `CNAME` file, or `package.json` `homepage`. |
| `urls.staging` | string, a URL | A staging deployment; preferred over `production` for the side-by-side view. |
| `media` | object | [Media](/docs/configuration/media/). *Default:* detected. |
| `media.dir` | string | Where new images are saved. Also added to `writable.content`. *Default:* the first of `images`, `img`, `assets/images`, `assets/img`, `assets`, `media`, `uploads` in the public folder; else `<public>/images`. |
| `media.publicPath` | string | The URL prefix `media.dir` is served from. *Default:* `media.dir` without its first segment (`public/images` → `/images`). |
| `media.roots` | object[] | Every folder the library lists. Replaces the detected list; `media.dir` is always included. *Default:* `media.dir`, and the public folder at `/`. |
| `media.roots[].dir` | string, **required**, non-empty | A folder, relative to the site root. |
| `media.roots[].publicPath` | string, **required**, non-empty | The URL prefix it is served from. |
| `media.storage` | object | New media goes to this bucket instead of the repository: [Media in a bucket](/docs/configuration/media-storage/). Ids and addresses only; the key is never here. *Default:* none — media stays in the repository. |
| `media.storage.connector` | string, **required** | `r2` (Cloudflare R2), `s3` (Amazon S3) or `s3-compatible` (another S3-compatible store). |
| `media.storage.bucket` | string, **required**, 3–63 characters | The bucket's name. |
| `media.storage.account` | string | R2: the account ID the bucket is in. |
| `media.storage.region` | string | S3: the bucket's Region code (`eu-west-1`). |
| `media.storage.endpoint` | URL | The store's S3 address: an R2 bucket in a jurisdiction, or an S3-compatible store. https only. |
| `media.storage.pathStyle` | boolean | The bucket name in the path (`address/bucket/key`) rather than the host name. *Default:* true, except for Amazon S3. |
| `media.storage.prefix` | string | The folder of the bucket this site's files go in (`lowfield/`). *Default:* the bucket's top. |
| `media.storage.publicUrl` | URL, **required** | Where visitors load the files from (`https://media.example.com`). Pages store full addresses under it. |
| `media.images` | object | Pictures go to Cloudflare Images instead; other files go to `media.storage`, else the repository. [Media in a bucket](/docs/configuration/media-storage/#cloudflare-images-step-by-step). The token is never here. *Default:* none. |
| `media.images.connector` | `"cloudflare-images"`, **required** | Cloudflare Images. |
| `media.images.account` | string, **required**, 32 hex characters | The Cloudflare account ID. |
| `media.images.accountHash` | string, **required** | The Images account hash, from Hosted Images › Developer Resources. |
| `media.images.scope` | string | This site's mark on its pictures (Cloudflare's creator field), made by Galley when connecting. Only pictures with it are listed, shown, moved or deleted, so several sites can share an account. |
| `media.images.variant` | string | The variant pages ask for. *Default:* `public`. |
| `media.images.deliveryUrl` | URL | Deliver from a domain of the same Cloudflare account (its `/cdn-cgi/imagedelivery/` path). *Default:* `https://imagedelivery.net`. |
| `publish` | object | [Publishing](/docs/configuration/publishing/). *Default:* detected. |
| `publish.branch` | string | Commit mode: the branch publishing is allowed from. Pull-request mode: the target branch. *Default:* the branch checked out. |
| `publish.mode` | `commit` · `pull-request` | Commit and push, or a new `galley/…` branch and a pull request. *Default:* `commit`. |
| `publish.remote` | string or `null` | The remote to push to. `null`: never push. *Default:* `origin`, else the first remote, else `null`. |
| `publish.push` | boolean | Push after committing. *Default:* `true` when there is a remote. |
| `ai` | object | [Assistant instructions and build mode](/docs/configuration/assistant/). *Default:* detected. |
| `ai.instructions` | string[] | Files whose text is added to the assistant's instructions. Replaces the default. A secrets file (a name that starts with `.env`) or a file under `.git/` named here is skipped. *Default:* whichever of `STYLE.md`, `STYLEGUIDE.md`, `STYLE_GUIDE.md`, `style-guide.md`, `docs/style-guide.md`, `brand/voice.md`, `VOICE.md`, `BRAND.md` exist. |
| `ai.allowBuild` | boolean | Whether build mode is offered on this site — the assistant's, and what needs it for everyone: a build-mode write, turning a script on, a form's custom code. *Default:* `true`. |
| `writable` | object | The write surface, as globs relative to the site root. *Default:* detected. |
| `writable.content` | string[] | What content mode may write. Replaces the default entirely. *Default:* each collection's folder (`…/**`) or data file, `<media.dir>/**`, and media files in the other detected roots. |
| `writable.build` | string[] | What build mode may write in addition. The deny-list always applies. *Default:* `["**/*"]`. |
| `collections` | object[] | Collection overrides and additions, merged by `id`. |
| `templates` | object[] | Ready-made entries a new one can start from — a landing page, a pricing page ([below](#templates)). *Default:* none. |
| `deploy` | object | Where the site is put online ([below](#deploy)). Written by the **Online** setup and `galley deploy`. Ids only: the host's access key is never in this file. *Default:* none. |
| `redirects` | object | Where the redirects list lives and which host applies it ([below](#redirects)). *Default:* detected. |
| `editor` | object | Where this site's editor is hosted online ([below](#editor)). Written by **Host the editor online** and `galley host` once the hosted editor has the site. An address and a host id: no secrets, safe to publish. *Default:* none. |
| `siteBrand` | object | Where the site's own brand is kept ([below](#site-brand)). *Default:* detected. |

## collections[]

| Key | Type | Meaning and default |
| --- | --- | --- |
| `collections[].id` | string, **required**, non-empty | Matches a detected collection to adjust it, or adds a new one. |
| `collections[].label` | string | The plural name. *Default:* from the id (`blog` → *Blog posts*, `events` → *Events*). |
| `collections[].singular` | string | The singular name, as in *New blog post*. *Default:* from the id (`blog` → *blog post*, `events` → *event*). |
| `collections[].description` | string | Shown with the collection; given to the assistant. |
| `collections[].kind` | `entries` · `data` | One file per item, or one file for the whole collection. *Default:* detected; for a new collection, `data` when `path` is a data file. |
| `collections[].path` | string | Folder (entries) or file (data), relative to the site root. *Default:* detected; **required** for a new collection. |
| `collections[].pattern` | string | Entries: a glob inside `path`. *Default:* detected (Astro: the loader's `pattern`). |
| `collections[].format` | `markdown` · `mdx` · `json` · `yaml` · `toml` | The file format. TOML is read-only. *Default:* from the pattern or the file extension; else `markdown`. |
| `collections[].body` | boolean | Whether entries have a body below the front matter. *Default:* `true` for markdown and MDX. |
| `collections[].url` | string or `null` | The public URL pattern, with `{slug}`: `"/blog/{slug}/"`. *Default:* from the framework's routes; `null` for data and for collections no route renders. |
| `collections[].titleField` | string | The field the list view shows as the title. *Default:* `title`, `name`, `heading`, `headline` or `label`, when present. |
| `collections[].dateField` | string | The field used for sorting by date. *Default:* `date`, `pubDate`, `publishDate`, `publishedAt`, … when present. |
| `collections[].imageField` | string | The field shown as the thumbnail. *Default:* `image`, `heroImage`, `cover`, `thumbnail`, `featuredImage`, `ogImage`, … when present. |
| `collections[].draftField` | string | The field that marks an entry as a draft. *Default:* `draft`, `unpublished`, `hidden` or `private`, when present. |
| `collections[].create` | boolean | Whether new entries may be created from the app. *Default:* `true` for entries, `false` for data. |
| `collections[].hidden` | boolean | Leave the collection out of the navigation. *Default:* `false`. |
| `collections[].plain` | boolean | The site shows this collection's Markdown as written and runs no code in it, so an account below build-mode level may change its Markdown (never `.mdx`) on any framework. If the site *does* run code in this content, anyone who can edit it can run code. *Default:* `false`. |
| `collections[].fields` | object[] | Field overrides and additions, merged by `key`. |

## Fields

The same object is used for `collections[].fields[]`, for a list's item (`of`), for an object's nested `fields`, and for a block type's `fields`.

| Key | Type | Meaning and default |
| --- | --- | --- |
| `collections[].fields[].key` | string, **required**, non-empty | The field's key in the file. |
| `collections[].fields[].label` | string | The label in the form. *Default:* the key in words (`heroImage` → *Hero image*). |
| `collections[].fields[].type` | `string` · `text` · `markdown` · `number` · `boolean` · `date` · `datetime` · `image` · `url` · `color` · `select` · `tags` · `list` · `object` · `blocks` · `reference` · `json` | [Field types](/docs/configuration/collections/#field-types). *Default:* detected; `string` for a field only the config names. |
| `collections[].fields[].required` | boolean | Whether a missing value is reported. *Default:* detected (schema, or present in 95 % of files). |
| `collections[].fields[].description` | string | Help text under the field; given to the assistant. *Default:* the schema's `.describe()`. |
| `collections[].fields[].options` | string[] | `select`: the allowed values. `tags`: suggestions. *Default:* from the schema's enum, or strong evidence. |
| `collections[].fields[].discriminator` | string | `blocks`: the key naming each section's type. *Default:* detected (`type`, `_component`, `_type`, …). |
| `collections[].fields[].collection` | string | `reference`: the collection id it points into. *Default:* from `reference("…")`. |
| `collections[].fields[].default` | any JSON value | The value a new entry starts with. *Default:* the schema's `.default()`. |
| `collections[].fields[].examples` | JSON value[] | Placeholders in the form; context for the assistant. *Default:* up to three real values. |
| `collections[].fields[].hidden` | boolean | Hide the field from the form; its value is kept. *Default:* `false`. |
| `collections[].fields[].dataSource` | string, a data source id (`^[a-z][a-z0-9-]*$`) | Pick the value from a plugin's data source — a product or a collection from the Shopify plugin (`shopify-products`). The file keeps a plain string. *Default:* none. |
| `collections[].fields[].of` | field object (`key` defaults to `item`) | `list`: the shape of one item. *Default:* detected. |
| `collections[].fields[].fields` | field object[] | `object`: the nested fields. *Default:* detected. |
| `collections[].fields[].blocks` | block object[] | `blocks`: the section types, merged by `type`. *Default:* detected. |

## Block types

| Key | Type | Meaning and default |
| --- | --- | --- |
| `collections[].fields[].blocks[].type` | string, **required**, non-empty | The discriminator value: `hero`, `cta`. |
| `collections[].fields[].blocks[].label` | string | The section's name in the form. *Default:* from the type (`rich-text` → *Rich text*). |
| `collections[].fields[].blocks[].description` | string | Shown when choosing a section; given to the assistant. |
| `collections[].fields[].blocks[].count` | number | Informational; detection fills it in. *Default:* how many the files contain. |
| `collections[].fields[].blocks[].example` | object | What **Add section** inserts. *Default:* the most complete real instance. |
| `collections[].fields[].blocks[].thumbnail` | string, non-empty | A picture of this section, relative to the site's folder (`galley/sections/hero.webp`), shown when choosing a section in the form and in Arrange. *Default:* none — the section is shown by name. |
| `collections[].fields[].blocks[].fields` | field object[] | The section's fields. *Default:* detected. |

## Templates

A template is an ordinary entry file the site keeps for starting new ones: a new entry made from it starts as a copy of the file, in its own key order and style. Today a template is used through the API (`template` in `POST /api/sites/:siteId/entries`); the app's **New page** window doesn't offer templates yet.

| Key | Type | Meaning and default |
| --- | --- | --- |
| `templates[].id` | string, letters, digits and dashes, **required**, unique | `landing-page`. |
| `templates[].label` | string, **required**, non-empty | Its name when choosing: *Landing page*. |
| `templates[].description` | string | One line on what it is for. |
| `templates[].collection` | string, **required**, non-empty | The collection a new entry made from it goes in. |
| `templates[].file` | string, **required**, non-empty | The template file, relative to the site's folder, in the same format as that collection's entries (`galley/templates/landing.md`). |
| `templates[].thumbnail` | string, non-empty | A picture of the finished page, relative to the site's folder. |

## Deploy

Written by the **Online** setup and by `galley deploy` ([Deploying, for developers](/docs/running/deploy/)). All ids — access keys are kept in Galley's own secrets.

| Key | Type | Meaning and default |
| --- | --- | --- |
| `deploy.target` | string, **required**, a host id (`cloudflare`, `vercel`, or a plugin's) | The host. |
| `deploy.account` | string, **required**, 1–100 characters | The Cloudflare account id or the Vercel team id. |
| `deploy.project` | string, **required**, lowercase letters, digits and dashes, up to 54 | The project (Cloudflare Worker, Vercel project) the site goes into. |
| `deploy.productionUrl` | string, a URL | The site's live address: the host's own address after the first deploy, or your own domain once you choose one. |
| `deploy.defaultUrl` | string, a URL | The address the host gave the site (`…workers.dev`, `…vercel.app`). Kept so a site on its own domain can go back to it. |
| `deploy.domain` | object | Your own domain for the site, written by **Use your own domain** on the Online screen or `galley domain`. |
| `deploy.domain.hostname` | string, a host name like `www.example.com` | The domain. |
| `deploy.domain.attached` | boolean | `true` when Galley attached the domain itself, so removing it detaches it. `false` when the domain was already pointing at the site: Galley then leaves it in place. |
| `deploy.domain.pending` | boolean | `true` while the domain is attached but not answering over HTTPS yet. |
| `deploy.autoDeploy` | boolean | **Put changes live every time I publish**: each publish puts the new version online by itself. *Default:* `false`. |
| `deploy.previewOnShare` | boolean | `false` hides **Share a preview link** in Proof. *Default:* shown. |

## Editor

Written by **Host the editor online** and `galley host` when the hosted editor has the site, as a pending change you publish like any other ([Host the editor online](/docs/editing/editor-online/)). It tells every copy of the site where its editor lives; removing the hosted editor takes it out again.

| Key | Type | Meaning and default |
| --- | --- | --- |
| `editor.url` | string, **required**, `https://` and a name with nothing after it | The editor's address: `https://cms.example.com`. |
| `editor.host` | string, a host id (`fly`, `cloudflare`, `own-server`, or a plugin's) | Where it is hosted. |

```json galley.config.json
{
  "editor": { "url": "https://cms.example.com", "host": "fly" }
}
```

## Redirects

| Key | Type | Meaning and default |
| --- | --- | --- |
| `redirects.file` | string, a `.json` file inside the site | The redirects list. *Default:* beside the site's other JSON data files, else `src/data/redirects.json`. A name like a build tool's or host's settings file, one in a framework's template folder, or one in a folder whose name starts with a dot can be changed only by an account with build mode. |
| `redirects.host` | `cloudflare` · `netlify` · `vercel` · `other` | Which host's file is written from the list. `deploy.target` wins when set. *Default:* asked once on the Redirects screen. |
| `redirects.cloudflare` | object | For setting the list on Cloudflare itself (Bulk Redirects). Ids only. |
| `redirects.cloudflare.account` | string, 1–100 characters | The Cloudflare account, when `deploy` doesn't give one. |
| `redirects.cloudflare.hostnames` | string[], domain names, at most 20 | The site's own domains on Cloudflare: `["example.com", "www.example.com"]`. |

## Site brand

| Key | Type | Meaning and default |
| --- | --- | --- |
| `siteBrand.dir` | string, a folder inside the site | Where the brand's files are written. *Default:* `galley/brand`. |
| `siteBrand.largeFileMB` | number, 0–1000 | Material larger than this stays in Galley's own folder for the site, not in the site. *Default:* `10`. |
| `siteBrand.tokensFile` | string, a `.css`, `.scss`, `.less` or `.pcss` file inside the site | The stylesheet that holds the design values, which **Apply to the site** writes into. *Default:* the stylesheet that declares most of them (the starters: `src/styles/tokens.css`). |

## A complete example

```json galley.config.json
{
  "$schema": "https://galley.fictiontribe.com/schema/galley.config.json",
  "name": "Harbour Bakery",
  "framework": "astro",
  "dev": { "command": "pnpm dev", "port": 4321 },
  "build": { "command": "pnpm build", "outDir": "dist" },
  "urls": { "production": "https://www.harbourbakery.example", "staging": "https://staging.harbourbakery.example" },
  "media": { "dir": "public/images", "publicPath": "/images", "roots": [{ "dir": "public", "publicPath": "/" }] },
  "publish": { "branch": "main", "mode": "pull-request", "remote": "origin", "push": true },
  "ai": { "instructions": ["CONTENT-GUIDE.md"], "allowBuild": false },
  "writable": { "content": ["src/content/**", "src/data/*.json", "public/images/**"] },
  "redirects": { "file": "src/data/redirects.json", "host": "cloudflare" },
  "siteBrand": { "dir": "galley/brand", "tokensFile": "src/styles/tokens.css" },
  "templates": [
    { "id": "landing", "label": "Landing page", "collection": "pages", "file": "galley/templates/landing.md" }
  ],
  "collections": [
    { "id": "blog", "label": "Journal", "singular": "post", "url": "/journal/{slug}/", "dateField": "date" },
    { "id": "menu", "kind": "data", "path": "src/data/menu.yaml", "format": "yaml", "label": "Menu" },
    {
      "id": "pages",
      "fields": [
        { "key": "category", "type": "select", "options": ["Shop", "Story", "Visit"] },
        {
          "key": "sections",
          "type": "blocks",
          "discriminator": "type",
          "blocks": [{ "type": "hero", "label": "Opening", "fields": [{ "key": "heading", "type": "string", "required": true }] }]
        }
      ]
    }
  ]
}
```
