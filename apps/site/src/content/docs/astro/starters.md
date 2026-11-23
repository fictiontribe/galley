---
title: Starters
description: The four Astro sites `galley new` can copy — Caddow, Ferrow, Lowfield Studio and the Caddow storefront — what each holds, their looks, and what every starter must do.
group: astro
order: 8
---

This page is for developers. A starter is a complete Astro site that `galley new` (and the app's **New site**) copies into a new folder, with its own git history from the first version. Starters live in [`starters/`]({repository}/tree/main/starters); the people and companies in them are made up, and their photographs are AI-generated.

| Starter | Site | For | Sections | Looks | Folder |
| --- | --- | --- | --- | --- | --- |
| `caddow` | Caddow | A small fashion label: campaign, lookbooks, journal, stockists, atelier | 20 | Chalk, Paper, Night | `starters/astro-editorial` |
| `ferrow` | Ferrow | A B2B software company: customer stories, changelog, blog, team | 29 | Signal, Meridian, Night shift | `starters/astro-saas` |
| `lowfield` | Lowfield Studio | A small studio or local business: services, about, pricing, contact, journal, team | 17 | Lowfield, Sage, Evening | `starters/astro-starter` |
| `storefront` | Caddow (shop) | A shop whose products, prices, stock, cart and checkout come from Shopify | 24 | Chalk, Paper, Night | `starters/astro-storefront` |

*Status:* the first three are built. **The Shopify storefront is in progress**: `galley starters` lists it, and it works with a demo catalogue, but it isn't finished ([Shopify](/docs/plugins/shopify/)).

`--starter` takes the short names — `caddow`, `ferrow`, `lowfield`, `storefront` — and `--look` one of the starter's looks (default: its first). Without `--starter` you get Lowfield.

<!-- if install.published -->
```sh
{install.createStarter folder=my-site starter=caddow}
```
<!-- else -->
```sh
galley starters
galley new my-site --starter caddow --look night
```
<!-- end -->

The step-by-step version is [Create a new site](/docs/getting-started/new-site/); every option of `galley new` is in [Command line](/docs/reference/cli/#galley-new).

## What creating a site does

1. **The folder** is the site's name made safe for a package — lowercase, words joined by hyphens (`Harbour Bakery` → `harbour-bakery`). It must not exist yet.
2. **The starter is copied** without its `node_modules`, `.git`, `dist`, `.astro` or `.DS_Store`. The site's name goes into `package.json` (made safe), `galley.config.json` and `src/data/site.json`.
3. **A first version is recorded**: `git init`, then one commit, `Start <name> from a starter`, with the `Galley-Publish: 1` trailer. Galley needs a commit to compare changes against.
4. **Dependencies are installed** with the package manager the starter's lockfile names (`npm` when there is none). The starters need Node 22.23.4 or newer, because Astro 7 does.
5. **Galley opens it**, exactly as `galley <folder>` would.

([Source]({repository}/blob/main/packages/core/src/workspace/scaffold.ts).)

## What to change first

1. The words — creating a site sets its name, but the pages still describe the starter's made-up company.
2. `url` in `src/data/site.json` and `site` in `astro.config.ts` — your real domain. Galley reads `site` as the live address to compare with; while it is `https://www.example.com` it is ignored (`galley doctor` says so).
3. The voice section of `CONTENT-GUIDE.md`, so the assistant writes like the new organisation.

`POST /api/sites/create` also accepts a short brief — what the organisation does, its audience and tone, the pages wanted, a brand colour — and hands the assistant a first build-mode task: rewrite the identity, compose the pages from the starter's sections, re-theme through the tokens file, run the build ([the task]({repository}/blob/main/packages/core/src/ai/brief.ts)). It needs an assistant key.

## What every starter has

- **Plain content collections** in `src/content.config.ts` — conventional zod that Galley reads without running it — and copy in files, never in components.
- **Pages built from sections**, each marked for [Arrange](/docs/visual-builder/), with a picture of every section type in `galley/sections/<type>.webp`.
- **The site kit, vendored** in `src/galley/`: forms, scripts with a consent banner, email links and the agent-readable version ([The site kit](/docs/astro/site-kit/)).
- **Looks**: design tokens in `src/styles/tokens.css`, one theme file per look.
- **`CONTENT-GUIDE.md`** — the writing guide the assistant reads before every request (`ai.instructions`).
- **`galley.config.json`** — what detection can't guess: section labels, descriptions and pictures.
- **`starter.json`** — the name, description, looks and previews the wizard shows; not copied into new sites.

The full contract — file layout, content model, tokens, block markers, thumbnails, the verification checklist: [`starters/README.md`]({repository}/blob/main/starters/README.md).

## Making your own

Copy a starter's folder into `starters/` (or a folder you point `GALLEY_STARTERS_DIR` at), give it its own `starter.json`, and it appears in `galley starters` and the app's **New site**. `node packages/astro/scripts/vendor.mjs <starter>` refreshes its copy of the kit.
