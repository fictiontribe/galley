---
title: Starters
description: The four Astro sites `galley new` can copy — Caddow, Ferrow, Lowfield Studio and the Caddow storefront — what each holds, their looks, and what every starter must do.
group: astro
order: 8
---

This page is for developers. A starter is a complete Astro site that `galley new` (and the app's **New site**) copies into a new folder, with its own git history from the first version. Starters live in [`starters/`]({repository}/tree/main/starters); the people and companies in them are made up, and their photographs are AI-generated.

| Starter | Site | For | Section types | Looks |
| --- | --- | --- | --- | --- |
| `astro-editorial` | Caddow | A small fashion label: campaign, lookbooks, journal, stockists, atelier | 20 | Chalk, Paper, Night |
| `astro-saas` | Ferrow | A B2B software company: customer stories, changelog, blog, team, seven page templates | 29 | Signal, Meridian, Night shift |
| `astro-starter` | Lowfield Studio | A small studio or local business: services, about, pricing, contact, journal, team | 17 | Lowfield, Sage, Evening |
| `astro-storefront` | Caddow (shop) | A shop whose products, prices, stock, cart and checkout come from Shopify | 24 | Chalk, Paper, Night |

*Status:* the first three are built. **The Shopify storefront is in progress** — it is in `galley new --starter`'s list, but its own `starter.json` still describes Caddow and it isn't presented as a starter yet ([Shopify](/docs/plugins/shopify/)).

```sh
$ galley starters
$ galley new caddow --starter astro-editorial --look night
```

`--look` picks one of the starter's looks; the default is its first. Without `--starter` you get `astro-starter`. Step by step: [Start a new site from a starter](/docs/getting-started/new-site/).

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
