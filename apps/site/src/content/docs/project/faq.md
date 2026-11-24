---
title: FAQ for developers
navTitle: FAQ
description: Straight answers to what developers ask before putting Galley on a site — what it changes, what it costs, what leaves the machine, and when it isn't the right fit.
group: project
order: 3
---

This page is for developers deciding whether to use Galley, or explaining it to someone who is. Each answer links to the page with the detail.

## Do I have to change my site?

No. Galley adds no dependency, integration or build plugin, and needs no configuration. `galley.config.json` is optional and only corrects what detection got wrong. Sites that follow a few habits — copy in content files rather than components, a zod schema, plain routes — get a better editor. [Making an Astro site easy to edit](/docs/astro/editable-sites/).

## Will it reformat our files?

No. A scalar edit splices the new value at the old value's byte range; comments, quoting, folded scalars, key order and the markdown body survive byte for byte. Structural edits go through the YAML document API, which keeps comments. A diff that shows more than the person changed is a bug. [Surgical edits](/docs/concepts/surgical-edits/).

## Where is the content? Is there a database?

In your repository, as the files it already is. Galley has no database: an unpublished change is an uncommitted change in the working tree, publishing is a commit. Settings, keys, the list of sites and assistant conversations live in the Galley home (`~/.galley`). [The working tree is the draft](/docs/concepts/working-tree/).

## Does it run our code?

Reading a site never runs it — detection is static. The preview runs the site's own dev command (and installs its dependencies first if they are missing), build mode runs its build command, and adapters and plugins a site names in its config are loaded (on a hosted install only when the operator allows it). That is the trust `npm install && npm run dev` already asks for. [Security model](/docs/running/security/#whose-code-it-runs).

## Does it phone home?

No. There is no telemetry and no account. It talks to your git host, your package registry and your deployed site; to Anthropic when someone uses the assistant (or the publish note, the brand's voice guide or the Search and AI writer) with a key set; to OpenAI, Google or OpenRouter when someone generates an image or video with that service chosen; to Cloudflare or Vercel when someone puts a site online; to Shopify when the Shopify plugin has a store; and to a WordPress site or a brand's website when someone imports or reads one. [What leaves the machine](/docs/running/security/#what-leaves-the-machine).

## What does it cost?

Galley is free and Apache-2.0, with one edition. The assistant and image generation use your own API keys, billed by the provider at their prices; Settings shows an estimate of what this computer has spent. Everything except chat and image generation works without a key. [Connect the assistant](/docs/getting-started/assistant/#what-it-costs).

## Which frameworks?

Astro fits deepest: Galley reads its content config and zod schemas, the routes and the Astro config, and the site kit and the starters are Astro. Eleventy, Hugo, Jekyll, Next.js, Nuxt, SvelteKit and Docusaurus are recognised by convention, and any folder of markdown with front matter works. Other frameworks arrive as adapters. [Adapters](/docs/adapters/).

## How does it fit our deploy pipeline?

It doesn't touch it. Publishing is `git commit` and `git push` (or a branch and a pull request), so whatever deploys your site on a push — Netlify, Cloudflare Pages, Vercel, GitHub Actions — deploys it as before. Your git hooks run on publish. [Publishing](/docs/configuration/publishing/).

## Can several people edit at once?

Each Galley works on one checkout per site, and everyone using that Galley shares its working tree: there are no per-person drafts. Galley notices outside edits and refuses an edit made against a stale copy of a file rather than merging it. Locally, each person runs their own Galley on their own checkout and git handles the rest. On a hosted install — one site per install — everyone who signs in shares the checkout, the settings and the author identity on publishes. [Run a hosted install](/docs/running/hosted/).

## Can an editor break the site?

Content mode — the default for everyone, assistant included — can change content and media only, and validation flags missing required fields, wrong types, missing images and broken internal links. Every change waits in the proof; **Discard** throws it away, **Undo** reverses an assistant reply, **Undo this publish** reverts a published version. In pull-request mode nothing reaches the live branch without a review. Content can still be wrong content: proof it. [Modes and the write surface](/docs/concepts/modes/).

## Is the assistant reliable?

It edits through the same guarded functions as the form, reads before it edits, asks when a request is ambiguous, and says a change happened only when a tool reported it. It has been run against the live Anthropic API; its fallback request shape and the third-party image providers have not. It is a model: it can misread a request. Everything it does is in the proof and can be undone per reply. [Connect the assistant](/docs/getting-started/assistant/).

## Can we rebrand it for our clients?

Yes: a brand file or two environment variables rename and recolour the UI. The Apache licence covers the code; the Galley name and logo are Fiction Tribe's marks, and a hosted or modified Galley offered to others should carry its own name. [White-label](/docs/configuration/white-label/), [TRADEMARKS.md]({repository}/blob/main/TRADEMARKS.md).

## Does it run on Windows or Linux?

Not verified yet. Everything has been built and run on macOS; Windows and Linux code paths exist and need someone to try them. Reports are welcome. [ROADMAP.md]({repository}/blob/main/ROADMAP.md).

## When isn't Galley the right fit?

When you need per-user roles and approval chains beyond pull requests, scheduled publishing, multi-locale editorial workflows, content delivered to apps through an API, or a site that isn't in a git repository and won't be. Also, today: one shared password per hosted install, with no accounts or single sign-on ([Security model](/docs/running/security/#not-covered-yet)).

## Is it ready?

Version {version}, on npm. Editing three ways, Proof, publishing and undo, forms and the inbox, scripts with consent, plugins, Cloudflare deploys, many sites in one app, MCP, the desktop app (macOS, unsigned), three starters, redirects, the brand set-up, the Search and AI checks, and (on Astro sites with the site kit) agent-readable pages and the per-crawler switch are built. The guided WordPress move is new and in final checks; the page builder is in preview; Vercel deploys and the Shopify storefront are in progress. It is on npm as `galley-cms`; the [changelog]({repository}/blob/main/CHANGELOG.md) lists what is in it.
