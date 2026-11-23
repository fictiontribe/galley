---
title: Start a new site from the starter
navTitle: New site from the starter
description: "galley new copies the Astro starter into a new folder, records a first version with git, installs its dependencies and opens it. What the starter contains, and what to change first."
group: getting-started
order: 2
---

This page is for a developer starting a site from nothing. `galley new` copies a starter — the small-business starter in `starters/astro-starter` unless you choose another with `--starter` (`galley starters` lists them: Caddow is `astro-editorial`, Ferrow is `astro-saas`) — and opens it in Galley, ready to edit.

## Create it

```sh
$ galley new "Harbour Bakery" --dir ~/sites
Creating “Harbour Bakery” in /Users/you/sites/harbour-bakery from astro-starter…
✓ Copied the starter and recorded the first version
Installing dependencies with npm (this can take a minute)…
✓ Dependencies installed
```

…and then it carries on exactly as `galley ~/sites/harbour-bakery` would: the server starts and the browser opens on the new site.

What happened, in order ([source]({repository}/blob/main/packages/core/src/workspace/scaffold.ts)):

1. **The folder name** is the name made safe for a package: lowercase, words joined by hyphens (`harbour-bakery`). It must not exist yet.
2. **The starter is copied** without its `node_modules`, `.git`, `dist`, `.astro` or `.DS_Store`, and the copy's `package.json` gets the new name.
3. **A first version is recorded**: `git init`, then one commit, `Start Harbour Bakery from a starter`, with the `Galley-Publish: 1` trailer, authored by your git identity (or a neutral one when git has none). Galley needs a commit to compare changes against.
4. **Dependencies are installed** with the package manager the starter's lockfile names (`npm` when there is none). The starter needs Node 22.23.4 or newer, because Astro 7 does.

| Option | What it does |
| --- | --- |
| `--dir <folder>` | Where to create the site's folder. Default: the current folder. |
| `--starter <id>` | Which starter to copy. Default `astro-starter`; an unknown id lists the ones there are. |
| `--skip-install` | Don't install dependencies (the preview installs them the first time it starts). |
| `--no-start` | Stop after creating it, and print the command that opens it. |
| `-p`, `--port <port>` | The port for the server when it starts. |

```sh
$ galley new "Harbour Bakery" --skip-install --no-start
Creating “Harbour Bakery” in /Users/you/harbour-bakery from astro-starter…
✓ Copied the starter and recorded the first version
Next: galley harbour-bakery
```

Starters are read from `GALLEY_STARTERS_DIR`, which defaults to the repository's `starters/` folder. Any folder of starters works: one subfolder per starter, its name the id.

## What the starter is

An ordinary Astro 7 site — no Galley dependency, no integration — written to be easy for people and for Galley to edit ([its README]({repository}/blob/main/starters/astro-starter/README.md)):

- **Pages** (`src/content/pages/*.md`) are a list of **sections** in front matter. There are sixteen section types — `hero`, `logos`, `features`, `split`, `stats`, `steps`, `testimonial`, `testimonials`, `pricing`, `faq`, `gallery`, `team`, `posts`, `rich-text`, `cta`, `contact` — declared as a zod discriminated union, so Galley offers each as a page section with its own fields.
- **A blog** (`src/content/blog/`) and **a team** (`src/content/team/`).
- **Data files**: `src/data/site.json` (name, contact details, social links, and every small piece of interface text under `labels`) and `src/data/navigation.json`. Components contain no copy, so every word on the site is editable without touching code.
- **One theme file**, `src/styles/tokens.css`: colours, the two font families, type scale, spacing.
- **`CONTENT-GUIDE.md`**: the voice, every section type and its fields, image shapes. `galley.config.json` lists it under `ai.instructions`, so the assistant reads it before every conversation.
- **`galley.config.json`**: the few things detection can't know — URL patterns, the media folder, the guide.

The sample content is a fictional architecture studio. `galley new` changes only the package name, so the copy still says *Lowfield Studio* everywhere — including `"name"` in `galley.config.json`, which is the name Galley shows for the site.

## What to change first

1. `"name"` in `galley.config.json` — the name on the Sites screen.
2. `url` in `src/data/site.json` and `site` in `astro.config.ts` — your real domain. Galley reads `site` as the live address to compare previews with; while it is `https://www.example.com` it is treated as a placeholder and ignored (`galley doctor` says so).
3. The **Voice** section of `CONTENT-GUIDE.md`, so the assistant writes like the new organisation rather than the sample one.
4. The content itself — in the editor, or by asking the assistant.

## Building a site from a brief

`POST /api/sites/create` also accepts a short brief — what the organisation does, the audience, the tone, the pages wanted, a brand colour — and then hands the assistant a first build-mode task: rewrite the identity, compose the pages from the existing section types, deal with the sample posts and people, re-theme through the tokens file, and run the build ([the task it is given]({repository}/blob/main/packages/core/src/ai/brief.ts)). It needs an Anthropic key. The **New site** screen that collects the brief in the web UI is still being built.

## Next

- [Connect the assistant](/docs/getting-started/assistant/) — needed for chat and for building from a brief.
- [Make an Astro site easy to edit](/docs/astro/editable-sites/) — the conventions the starter follows, for sites you build yourself.
- [Hand a site over to an editor](/docs/getting-started/handover/).
