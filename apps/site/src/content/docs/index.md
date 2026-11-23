---
title: Galley documentation
navTitle: Introduction
description: What Galley is, the two kinds of reader these pages are for, and where to start.
group: start
order: 1
---

Galley is an open-source AI CMS for static sites, built for [Astro](/astro/) first. A site's content stays as files in its own git repository. People change pages three ways — typing in a form, clicking the words on the page, or asking the assistant — and every change waits in **Proof**, marked up beside the live site, until someone presses **Publish**.

| Step | What the person does | What happens underneath |
| --- | --- | --- |
| **Prompt** | Edits a field, retypes text on the page, or asks the assistant | The site's files change on disk, only the bytes that need to |
| **Proof** | Checks each change beside the live site; puts back what they don't want | A diff against the last commit, shown in the site's own words |
| **Publish** | Presses Publish | A git commit, and a push — or a branch and a pull request |

Galley is **pre-release, version 0.1.0**. It isn't on npm yet: it runs from a clone of the [repository]({repository}). Where something is new or still being built, the page says so.

## Two kinds of reader

**If you edit a site** — write, update pages, look after forms and analytics — start with [Find your way around](/docs/editing/tour/). Those pages use the app's own words (Publish, Proof, Discard) and never need git.

- **Edit a site**: [change a page](/docs/editing/form/), [on the page itself](/docs/editing/on-the-page/), [ask the assistant](/docs/editing/assistant/), [images and video](/docs/editing/media/), [build a page from sections](/docs/editing/page-builder/), [check and publish](/docs/editing/proof-and-publish/), [undo a publish](/docs/editing/history/).
- **Look after a site**: [forms](/docs/editing/forms/) and [the inbox](/docs/editing/inbox/), [Google Analytics and other scripts](/docs/editing/scripts/), [redirects](/docs/editing/redirects/), [the brand](/docs/editing/brand/), [search and AI checks](/docs/editing/search-and-ai/), [putting the site online](/docs/editing/online/), [moving from WordPress](/docs/editing/wordpress/), [many sites](/docs/editing/many-sites/).

**If you set Galley up or look after a site's code**, start with the [Quickstart](/docs/getting-started/quickstart/). Those pages use git, files and configuration freely.

- **Set up**: the quickstart, a new site from a starter, an existing repository, the assistant's key, handing a site to an editor, moving from WordPress.
- **How it works**: [prompt, proof, publish](/docs/concepts/prompt-proof-publish/), [the working tree as the draft](/docs/concepts/working-tree/), [surgical edits](/docs/concepts/surgical-edits/), [detection](/docs/concepts/detection/), [modes](/docs/concepts/modes/), [never guessing](/docs/concepts/never-guess/).
- **Your Astro site**: what Galley reads, the preview, making a site easy to edit, [the site kit](/docs/astro/site-kit/), [forms](/docs/forms/), [scripts](/docs/scripts/), [what Arrange needs](/docs/visual-builder/), [the starters](/docs/astro/starters/).
- **Configuration**: [`galley.config.json`](/docs/configuration/), for correcting what detection found.
- **Extend Galley**: [adapters](/docs/adapters/), [plugins](/docs/plugins/), [MCP](/docs/integrations/mcp/), [Shopify](/docs/plugins/shopify/).
- **Run Galley**: the [desktop app](/docs/running/desktop/), [self-hosting](/docs/running/hosted/), [settings and secrets](/docs/running/settings/), [security](/docs/running/security/), [deploying](/docs/running/deploy/).
- **Reference**: [command line](/docs/reference/cli/), [config file](/docs/reference/config/), [HTTP API](/docs/reference/api/), [environment variables](/docs/reference/environment/), [messages](/docs/reference/messages/), [troubleshooting](/docs/reference/troubleshooting/), [glossary](/docs/reference/glossary/). The command line, config and API pages are generated from or checked against the code on every build of this site.

## The quickest way in

```sh
$ git clone {repository}.git galley && cd galley
$ corepack enable && pnpm install && pnpm --filter @galley/web build
$ node packages/cli/bin/galley.js new my-site --starter astro-editorial --dir ~/sites
```

That opens a copy of the Caddow starter in your browser. The [quickstart](/docs/getting-started/quickstart/) goes through it, and through opening your own Astro site.

## What it costs

Galley is free and open source (Apache-2.0). The assistant runs on the site owner's own Anthropic key, billed by Anthropic per request; image and video services, and hosts such as Cloudflare or Vercel, bill their own accounts. Without any key, everything but asking the assistant works.

## This site is a Galley site

Every page here is a markdown file in `apps/site/src/content/docs/` of the repository, and the whole site is an Astro project Galley can edit. **Edit this page on GitHub**, at the bottom of each page, takes you to its file.
