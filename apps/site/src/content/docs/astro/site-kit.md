---
title: The site kit
description: "@galleycms/astro: forms, managed scripts with consent, email links, the agent-readable version of the site and the dev toolbar app — how a site gets it, every option, and what it adds to a build."
group: astro
order: 4
---

This page is for developers. Galley edits any Astro site without adding anything to it. The **site kit** is optional: an Astro integration, `@galleycms/astro` ([`packages/astro`]({repository}/tree/main/packages/astro)), that turns a few content files into site features:

| Feature | The file | Guide |
| --- | --- | --- |
| Forms | `src/content/forms/<id>.json` + `<Form id="…" />` | [Forms](/docs/forms/) |
| Third-party scripts with consent | `src/data/scripts.json` | [Scripts](/docs/scripts/) |
| Email links (Gmail, Outlook, mail app, copy) | — (on by default) | [below](#email-links) |
| The agent-readable version: a markdown copy of every page, `llms.txt`, `llms-full.txt`, `agent.md`, structured data, `robots.txt` and `sitemap.xml` when the site has none | `src/data/visibility.json` (optional) | [below](#the-agent-readable-version) |
| The dev toolbar app: in `astro dev`, says whether Galley is running and opens the page in it | — | |

Because forms and scripts are plain files, they are edited by Galley's form builder and Scripts screen, by its assistant, over MCP or by hand, and publish like any change.

**Not on npm yet.** The package is private in the repository; sites use it **vendored** — copied into the site as plain files. The starters ship it vendored, and so does this website.

## Getting it into a site

The quickest way: open the site in Galley, go to **Forms** or **Scripts**, and press **Set it up for me**. It adds the kit's files and wires what is unambiguous — the three script placements when the site has exactly one layout writing its own `<html>`, the forms collection, the build step for the agent-readable version — as pending changes in Proof. When the layout isn't clear it says so, with the lines for a developer. It needs build mode to be allowed on the site.

By hand, from a clone of Galley:

```sh
node packages/astro/scripts/vendor.mjs path/to/site
```

It copies the components, the browser runtime, the schemas, the CSS and the build step into `src/galley/`, each file headed with the kit version it came from. Running it again replaces the kit files and keeps `src/galley/settings.json`. Then:

- the forms collection in `src/content.config.ts`: `import { formSchema } from "./galley/schema.js"`;
- the three placements in the layout: `<Scripts placement="head" />` after `<meta charset>`, `"body-start"` after `<body>`, `"body-end"` before `</body>` (`import { Scripts } from "../galley/components/index.js"`);
- for the agent-readable version: `import galley from "./src/galley/integration.js"` and `integrations: [galley()]` in `astro.config`.

Once the package is published: `npx astro add @galleycms/astro`, and the integration places the scripts itself — no template changes.

## Options

`galley(options)` in `astro.config`. This site's build checks that this table lists exactly the options in [`packages/astro/src/index.d.ts`]({repository}/blob/main/packages/astro/src/index.d.ts).

| Option | Type and default | Meaning |
| --- | --- | --- |
| `url` | string; `GALLEY_URL`, else `http://127.0.0.1:4400` | Where the dev toolbar app looks for Galley. |
| `toolbar` | boolean; `true` | The dev toolbar app (`astro dev` only). |
| `forms` | object or `false`; on | Forms. `false` turns the part off. |
| `forms.collection` | string; `"forms"` | The content collection the forms live in. |
| `forms.dir` | string; `"src/content/forms"` | Its folder, scanned for site-wide needs (UTM memory). |
| `forms.endpoint` | string | The capture address for forms sending to Galley's inbox, e.g. `https://cms.example.com/f/<siteId>`. |
| `forms.allowFormScripts` | boolean; `false` | Let a form's `script` after-submit action run (custom code from the form file). |
| `forms.messages` | object | Site-wide wording for every form, by key. |
| `forms.freeEmailDomains` | string[] | More domains a "business e-mail only" field refuses. |
| `scripts` | object or `false`; on | Managed scripts. |
| `scripts.file` | string; `"src/data/scripts.json"` | The scripts file. |
| `scripts.inject` | boolean; `true` | Put the scripts into every page automatically. `false`: place `<Scripts />` yourself. |
| `mailto` | object or `false`; on | The email-link dialog. |
| `mailto.options` | array; `["gmail", "outlook", "app", "copy"]` | Which actions, in which order; `"outlook-live"` is also available. |
| `mailto.strings` | object | Its wording, by key. |
| `visibility` | object or `false`; on | The agent-readable version. |
| `visibility.file` | string; `"src/data/visibility.json"` | Its data file. |

With no forms, no scripts file, `mailto: false` and `visibility: false`, the build output is byte-identical with and without the integration (the kit's own test).

## Email links

Every `mailto:` link opens a small dialog: **Send with Gmail**, **Send with Outlook**, **Open my mail app**, **Copy address**, with the recipients, subject and body carried into each. Without JavaScript it stays an ordinary `mailto:` link; a modified click (⌘/Ctrl, Shift, Alt) is left to the browser. Turn it off with `mailto: false`. Details, theming and wording: [`docs/mailto.md`]({repository}/blob/main/docs/mailto.md).

## The agent-readable version

After the build the kit writes, from the rendered pages:

| Address | What it is |
| --- | --- |
| `/about.md` for `/about/`, `/index.md` for the home page | The page's main content as markdown, with its title, description, address and dates. No menus, forms or scripts. |
| `/llms.txt` | A contents page for AI systems, each page linking to its markdown copy. |
| `/llms-full.txt` | Every markdown copy in one file, up to 1 MB. |
| `/agent.md` | A short guide for an AI agent: what the site is and how to cite it. |
| `/robots.txt`, `/sitemap.xml` | Only when the site has none of its own. `robots.txt` carries the per-crawler AI choices. |

Pages marked `noindex`, drafts and the not-found page are left out. Structured data is added only where the page's own facts make it complete and true. In `astro dev` the same addresses answer on request.

*Status:* agent-readable pages for the sites Galley builds are **in progress**, and so is the per-crawler switch in the app; this website runs the kit's version today. Google says its search doesn't use `llms.txt` or markdown copies, and few AI systems read them yet: the copies make a site easier for an agent to read, not more likely to be cited. Formats, the data file and sources: [`docs/ai-first-output.md`]({repository}/blob/main/docs/ai-first-output.md).

## Languages and hreflang

For multilingual sites, `@galleycms/astro/components` exports two components that read `galley.config.json` and `galley/i18n/manifest.json` so translated slugs link directly to their counterparts:

- **`<LocaleHead />`** — place inside `<head>` to emit `<link rel="alternate" hreflang="…" href="…" />` for every existing translation of the current page plus `hreflang="x-default"` pointing at the default-locale version.
- **`<LanguageSelector />`** — accessible `<nav aria-label="Language">` language switcher marking the active page with `aria-current="page"`, setting `lang`, `hreflang` and `dir` on each link. Accepts `fallback="home" | "hide"`, `showCode`, `label`, `class` and `unstyled`.

See [Languages and translations](/docs/editing/languages/) for setup and workflow details.

## Next

- [Forms](/docs/forms/), [Scripts](/docs/scripts/), [What Arrange needs](/docs/visual-builder/).
- [Starters](/docs/astro/starters/) — four sites that ship the kit.
