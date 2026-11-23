---
title: Making an Astro site easy to edit
navTitle: Easy-to-edit sites
description: Schema, routing and component habits that let Galley detect everything without configuration — the conventions the Astro starter follows.
group: astro
order: 3
---

This page is for developers building an Astro site that people will edit with Galley. None of it is required. Each habit below is something detection reads directly, so following it means a better form, working click-to-edit and a smaller `galley.config.json`. The [Astro starter]({repository}/tree/main/starters/astro-starter) follows all of them.

## Put every word in content

Click-to-edit and content mode can only change words that live in content files. A string typed into a component — a button label, a footer line, *Read more* — is code: clicking it says *This text isn't in any content file*, and only build mode can change it.

The starter keeps interface text in `src/data/site.json` under `labels`, and components read it. From its `Footer.astro`:

```astro
---
// Site footer: columns from src/data/navigation.json; name, tagline, contact,
// social links and the closing line from src/data/site.json.
import { labels, navigation, site } from "../lib/site";
---
<a class="site-footer__name" href="/">{site.name}</a>
<p class="site-footer__tagline">{site.tagline}</p>
<h2 class="site-footer__heading">{labels.nav.contact}</h2>
```

`src/data/*.json` and `*.yaml` files become data collections on their own, so `labels` appears in the editor with no configuration.

## Declare a schema, and say what fields are for

A zod schema in `src/content.config.ts` is the most reliable description Galley gets. Make it explicit where it helps people:

- `z.enum([...])` for a fixed set of choices — it becomes a select. Without it, a select is only inferred on strong evidence.
- `.describe("…")` on a field — the text appears under the field in the form and is given to the assistant.
- `.default(…)` and `.optional()` — fields the editor doesn't have to fill in.
- `reference("team")` for links between collections, and `image()` (or plain string paths under `public/`) for pictures.
- Named pieces (`const link = z.object({ label: z.string(), href: z.string() })`) reused across sections read the same as inline ones.

Keep the schema statically readable: plain `defineCollection({ loader: glob(…), schema: z.object(…) })`. A schema produced by calling your own function, or collections assembled by spreading another module's export, can't be read without running code, and Galley never runs it. [What Galley reads](/docs/astro/content-collections/) lists exactly what is recognised.

## Build pages from sections

A `sections` list declared as a `z.discriminatedUnion("type", …)` gives editors a page builder: each section type with its own fields, **Add section** seeded with a real example, reordering by moving list items. Keep one component per type and a renderer that maps `type` to the component; the starter's `src/components/Sections.astro` is the pattern, and its README explains adding a type in four steps.

## Route collections plainly

URL patterns are read from `src/pages`: a dynamic route such as `src/pages/blog/[...slug].astro` that calls `getCollection("blog")` gives the blog `/blog/{slug}/`. A route that decides which collection to show at run time can't be matched — set `url` for that collection in `galley.config.json` instead. A collection nothing renders (the starter's team members, shown inside pages) is correctly treated as having no pages of its own.

## Use a glob or file loader for editable content

`glob()` and `file()` loaders point at files Galley can edit. Content from a custom loader — a CMS API, a database, a remote feed — isn't files in the repository, so it isn't editable here, and `doctor` says so.

## Give it the live address

Set `site` in `astro.config.*` to the real domain. It is used for the side-by-side view in the proof. `https://www.example.com` and other reserved example domains are treated as placeholders and ignored.

## Write a content guide

A markdown file describing the voice, the section types and the house rules, listed in `galley.config.json`:

```json galley.config.json
{
  "ai": { "instructions": ["CONTENT-GUIDE.md"] }
}
```

The assistant reads it before every conversation. Files named `STYLE.md`, `BRAND.md`, `VOICE.md` or `brand/voice.md` are picked up without configuration. The starter's [`CONTENT-GUIDE.md`]({repository}/blob/main/starters/astro-starter/CONTENT-GUIDE.md) is an example.

## Keep MDX bodies simple

In MDX, Galley edits the markdown between components and never touches `import`/`export` lines or JSX blocks. Text inside a component's props is code to Galley. If editors need to change it, move it to front matter and pass it in.

## Next

- [What Galley reads from an Astro project](/docs/astro/content-collections/).
- [Hand a site over to an editor](/docs/getting-started/handover/).
