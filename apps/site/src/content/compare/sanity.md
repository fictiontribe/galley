---
title: "Galley vs Sanity CMS: Git files or a Content Lake"
description: Sanity CMS keeps content in its hosted Content Lake; Galley keeps it as files in Git. Setup, page building, AI, scheduling, SSO, collaboration, teams and price compared.
kind: versus
product: Sanity
heading: Sanity keeps your content in its Content Lake. Galley leaves it in your repository.
name: Galley and Sanity
lead: Sanity CMS serves structured content from a hosted database to any site or app, with an open-source editor and multi-channel APIs. Galley is an AI-first, open-source CMS (Apache-2.0) with optional managed hosting on Galley Cloud — giving static websites visual section building, built-in AI, translations, search intelligence, scheduled publishing, free OIDC SSO and live collaboration without a Content Lake or per-seat fees.
published: "2026-11-25"
updated: "2026-11-28"
checked: November 2026
order: 2
draft: false
short:
  - Sanity CMS keeps your content as JSON documents in its hosted Content Lake, and your site fetches it with GROQ or GraphQL. Its editor, Sanity Studio, is open-source (MIT) code you configure. Galley keeps content as files in your own Git repository, with no database.
  - "Sanity's Free plan limits you to public datasets anyone can query, Growth costs $15 a seat a month (with a $299/mo quota add-on past 25,000 documents) and doesn't include website hosting. Galley is free and Apache-2.0 for private repos locally or self-hosted; [Galley Cloud](/cloud/) (opening by invitation) includes Cloudflare edge website hosting, monthly AI credits and Search and AI intelligence from $35 a month per site ($99 on Agency for five sites), with no per-seat fees."
  - Sanity asks a developer for a schema in code and GROQ queries, and on Astro its visual editing requires server-side rendering ("Static output mode will not work"). Galley reads the site as it is and gives editors on-page editing and the visual Arrange page builder directly on static pages — no SSR required.
  - "Galley is AI-first for websites: a page-aware assistant that never publishes, multi-provider image and short video generation, whole-site AI translations with a Git-tracked Translation Memory and Glossary, built-in live Google rankings and keyword-gap intelligence, AI-first published output (`llms.txt`, Markdown twins, per-crawler `robots.txt`), scheduled publishing (free in open source and pre-built edge deploys on Cloud), and MCP."
  - Choose Sanity when the same content must feed mobile apps and other channels through an API, or when you need SOC 2 Type 2, a multi-year track record (since 2017) or Sanity's Slack/programmatic multi-channel agent tooling today.
table:
  heading: Galley and Sanity, side by side.
  text: Where Sanity does more, the table says so.
  caption: Galley compared with Sanity
  columns: [What differs, Galley, Sanity]
  rows:
    - label: Your content
      ours: Files in your Git repository
      theirs: JSON documents in Sanity's hosted Content Lake
      better: even
    - label: Price
      ours: Free open source (private repos); Galley Cloud from $35/mo w/ site hosting & $0/seat
      theirs: Free (public datasets only); Growth $15/seat/mo + $299/mo quota add-on, no site hosting (Nov 2026)
      better: ours
    - label: Setup
      ours: Reads the site as it is
      theirs: A schema in code (a coding agent can write it), and GROQ queries in the site
      better: ours
    - label: Editing on the page
      ours: Click-to-edit directly on static pages; no markup or SSR
      theirs: Click-to-edit overlays; on Astro, requires server-side rendering
      better: ours
    - label: Page building
      ours: Visual Arrange builder drags, duplicates & drops the site's sections on static pages
      theirs: Drag and drop in Presentation; requires SSR and schema/GROQ wiring on Astro
      better: ours
    - label: AI & search intelligence
      ours: AI-first — assistant (never publishes), image/video gen, AI translations w/ TM & glossary, live rankings/404 recovery, llms.txt, MCP
      theirs: AI Assist (Growth), Agent Actions, Content Agent, Sanity Context, MCP; no live search rankings or llms.txt output
      better: ours
    - label: Checking a change
      ours: Word-by-word Proof beside the live site, put back any change, Cloud preview links
      theirs: Live preview, share links, document-by-document history
      better: ours
    - label: Scheduled publishing
      ours: Built in free (scheduler/CLI/publishAt) & pre-built edge deploys on every Cloud plan
      theirs: Scheduled drafts gated to Growth; Content Releases on Enterprise add-on
      better: ours
    - label: Two people at once
      ours: Real-time co-editing & live presence on Galley Cloud; safe save checks self-hosted
      theirs: Real-time editing and presence on every plan
      better: even
    - label: Teams & SSO
      ours: Free OpenID Connect SSO in Apache-2.0 server, 3 roles, $0/seat on Cloud (up to 500)
      theirs: 5 roles on Growth ($15/seat); SAML SSO & custom roles locked to Enterprise
      better: ours
    - label: Content for apps
      ours: Built for websites; the site's build reads Git files
      theirs: Content Lake APIs (GROQ/GraphQL) and CDN for mobile apps and any channel
      better: theirs
    - label: Leaving
      ours: No content to export; keep your Git repository as-is
      theirs: NDJSON export; Portable Text rich text to convert
      better: ours
    - label: Maturity
      ours: First released November 2026; no SOC 2 or SLA yet
      theirs: Launched 2017; SOC 2 Type 2, enterprise SLA
      better: theirs
faq:
  - q: What is Sanity CMS?
    a: "Sanity calls itself \"The AI Content Operating System\". It has three parts: Sanity Studio, an open-source React editing app you configure in code; the Content Lake, Sanity's hosted database of JSON documents; and APIs that sites and apps query with GROQ or GraphQL. Its headless CMS guide has a section titled \"Why Sanity is a headless CMS, but also much more\"."
  - q: Is Galley an alternative to Sanity?
    a: For a static website whose content belongs to that site, yes. Galley edits the files in your Git repository, needs no schema or GROQ queries for common setups, lets editors visually arrange sections on static pages without SSR, and builds in AI editing, translations with Translation Memory, live search rankings, scheduled publishing, free OIDC SSO self-hosted, and real-time co-editing on [Galley Cloud](/cloud/). Sanity stays the better choice when one database must feed mobile apps and other channels through an API, or when you need SOC 2 Type 2 and a 2017 track record today.
  - q: How much does Sanity cost?
    a: As of November 2026, Sanity's Free plan is $0 with up to 20 seats, 10,000 documents and public datasets only. Growth is $15 per seat a month for up to 50 seats, with pay-as-you-go API requests, bandwidth and assets above its quotas, while documents stop at 25,000 unless you buy the $299-a-month quota add-on. Enterprise is priced on request. Viewers don't take a seat. Galley is free under Apache-2.0 for private repositories locally or self-hosted (bringing your own AI key); [Galley Cloud](/cloud/) (opening by invitation) starts at $35 a month per site ($99 on Agency for five sites, $149 on Business), with Cloudflare website hosting, monthly AI credits and Search intelligence included and no per-seat fees.
  - q: Is Sanity open source?
    a: Partly. Sanity Studio, the editing app, is open source under the MIT licence, and Sanity will host it for free or you can host it yourself. The Content Lake, where the content is stored, is a service Sanity hosts, and we found no self-hosted version of it on Sanity's pages. Galley is open source under Apache-2.0 and keeps content in your own repository.
  - q: Does Sanity work with static sites and Astro?
    a: "Yes. Sanity has an official Astro integration, and a static Astro site fetches its content once, at build time, with a webhook to rebuild it when content changes. Visual editing is the exception: Sanity's Astro guide says it \"requires server-side rendering\" and \"Static output mode will not work\". Individual pages can be server-rendered instead, with a deployment adapter for your host. Galley's on-page editing and visual [Arrange](/docs/editing/page-builder/) page builder run directly on static Astro sites with zero SSR."
  - q: Sanity or Contentful, what's the difference?
    a: "Both are headless: the content sits in the maker's cloud and reaches sites and apps through APIs. Sanity's editor, Studio, is MIT-licensed code you configure and can host yourself. Contentful says it is \"a cloud-based web service that we manage\" and can't be self-hosted. As of November 2026, Sanity's Growth plan is $15 a seat a month and Contentful's Lite plan $300 a month for 20 users."
sources:
  - label: "Sanity, home page"
    href: https://www.sanity.io/
  - label: "Sanity, llms.txt"
    href: https://www.sanity.io/llms.txt
  - label: "Sanity, pricing"
    href: https://www.sanity.io/pricing
  - label: "Sanity, Studio"
    href: https://www.sanity.io/studio
  - label: "Sanity, Content Lake"
    href: https://www.sanity.io/content-lake
  - label: "Sanity, headless CMS explainer"
    href: https://www.sanity.io/headless-cms
  - label: "Sanity, security"
    href: https://www.sanity.io/security
  - label: "Sanity documentation, Content Lake"
    href: https://www.sanity.io/docs/content-lake
  - label: "Sanity documentation, Studio"
    href: https://www.sanity.io/docs/studio
  - label: "Sanity documentation, deploying the Studio"
    href: https://www.sanity.io/docs/studio/deployment
  - label: "Sanity documentation, project structure"
    href: https://www.sanity.io/docs/studio/project-structure
  - label: "Sanity documentation, defining a schema"
    href: https://www.sanity.io/docs/defining-a-schema
  - label: "Sanity documentation, block content (Portable Text)"
    href: https://www.sanity.io/docs/studio/block-content
  - label: "Sanity documentation, Portable Text editor configuration"
    href: https://www.sanity.io/docs/studio/portable-text-editor-configuration
  - label: "Sanity documentation, presenting Portable Text"
    href: https://www.sanity.io/docs/developer-guides/presenting-block-text
  - label: "Sanity documentation, Astro introduction"
    href: https://www.sanity.io/docs/astro/introduction
  - label: "Sanity documentation, static and server rendering with Astro"
    href: https://www.sanity.io/docs/astro/static-and-server-rendering
  - label: "Sanity documentation, Visual Editing with Astro"
    href: https://www.sanity.io/docs/visual-editing/astro-visual-editing
  - label: "Sanity documentation, Visual Editing overlays"
    href: https://www.sanity.io/docs/visual-editing/visual-editing-overlays
  - label: "Sanity documentation, introduction to Visual Editing"
    href: https://www.sanity.io/docs/visual-editing/introduction-to-visual-editing
  - label: "Sanity documentation, preview and page building"
    href: https://www.sanity.io/docs/user-guides/preview-and-page-building
  - label: "Sanity documentation, datasets"
    href: https://www.sanity.io/docs/content-lake/datasets
  - label: "Sanity documentation, plans and payments"
    href: https://www.sanity.io/docs/platform-management/plans-and-payments
  - label: "Sanity documentation, AI in Sanity"
    href: https://www.sanity.io/docs/ai
  - label: "Sanity documentation, AI Assist"
    href: https://www.sanity.io/docs/studio/install-and-configure-sanity-ai-assist
  - label: "Sanity, AI Assist"
    href: https://www.sanity.io/ai-assist
  - label: "Sanity documentation, Agent Actions"
    href: https://www.sanity.io/docs/agent-actions
  - label: "Sanity documentation, Content Agent"
    href: https://www.sanity.io/docs/content-agent
  - label: "Sanity documentation, Content Agent introduction"
    href: https://www.sanity.io/docs/content-agent/introduction
  - label: "Sanity documentation, Canvas"
    href: https://www.sanity.io/docs/canvas/introduction-to-canvas
  - label: "Sanity documentation, Sanity Context"
    href: https://www.sanity.io/docs/context/introduction
  - label: "Sanity documentation, how AI credits work"
    href: https://www.sanity.io/docs/platform-management/how-ai-credits-work
  - label: "Sanity documentation, the MCP server"
    href: https://www.sanity.io/docs/ai/mcp-server
  - label: "Sanity documentation, roles"
    href: https://www.sanity.io/docs/user-guides/roles
  - label: "Sanity documentation, comments"
    href: https://www.sanity.io/docs/studio/comments
  - label: "Sanity documentation, scheduled drafts"
    href: https://www.sanity.io/docs/studio/scheduled-drafts
  - label: "Sanity documentation, Content Releases"
    href: https://www.sanity.io/docs/user-guides/content-releases
  - label: "Sanity documentation, history"
    href: https://www.sanity.io/docs/user-guides/history-experience
  - label: "Sanity documentation, SAML single sign-on"
    href: https://www.sanity.io/docs/developer-guides/sso-saml
  - label: "Sanity documentation, exporting data"
    href: https://www.sanity.io/docs/content-lake/exporting-data
  - label: "Sanity documentation, importing data"
    href: https://www.sanity.io/docs/content-lake/importing-data
  - label: "Sanity blog, seed funding announcement"
    href: https://www.sanity.io/blog/seed-funding-announcement
  - label: "Sanity Studio licence, on GitHub"
    href: https://github.com/sanity-io/sanity/blob/main/LICENSE
  - label: "Contentful, backup, security and hosting"
    href: https://www.contentful.com/help/faq/backup-security-and-hosting/
  - label: "Contentful, pricing"
    href: https://www.contentful.com/pricing/
  - label: "Galley, the FAQ for developers"
    href: /docs/project/faq/
  - label: "Galley, the tour: what is built and what isn't yet"
    href: /tour/
  - label: "Galley, page builder"
    href: /docs/editing/page-builder/
  - label: "Galley, languages"
    href: /docs/editing/languages/
  - label: "Galley, run a hosted install"
    href: /docs/running/hosted/
  - label: "Galley over MCP"
    href: /docs/integrations/mcp/
  - label: "Galley Cloud"
    href: /cloud/
  - label: "Galley for enterprise and security teams"
    href: /enterprise/
related: [types-of-cms, contentful, cloudcannon]
---

## What is Sanity CMS, and where does it keep your content?

Sanity calls itself "The AI Content Operating System". It has three parts. Sanity Studio is the editing app: open source under the MIT licence, built with React and configured in code. The Content Lake is the database, which Sanity hosts on Google Cloud. On top sit the APIs a site or an app uses to ask for content, in Sanity's own query language, GROQ, or in GraphQL.

The words live in the Content Lake, as "structured JSON documents with referential integrity." Their shape is code: "Content Lake stores any valid JSON document, with schemas living in your Sanity Studio configuration, not as database constraints." So the content model can sit in your Git repository and go through pull requests, as [Sanity's Studio page](https://www.sanity.io/studio) says, while the content stays in Sanity's database. Rich text comes back from the API as Portable Text, "rich text as an array of blocks, where each block is an array of child spans", which Sanity's docs say, of the stored format, "isn't designed for direct human authoring or reading, but instead should be parsed by software."

Galley keeps the words where a static site already keeps them: Markdown, YAML or JSON files (TOML it reads but doesn't change) in the site's own repository. There is no database. A change waiting to be published is a change in those files, and publishing is a commit.

Most of what follows comes from that. Sanity is built for one body of content that feeds a website, an app and anything else that can call an API. Galley is built for the website the files belong to. Our [guide to the kinds of CMS](/compare/types-of-cms/) sets the two shapes side by side.

## How much does each cost?

As of November 2026, Sanity has three plans:

| Plan | Price | Seats | Documents |
| --- | --- | --- | --- |
| Free | $0 | Up to 20 | 10,000 |
| Growth | $15 per seat a month | Up to 50 | 25,000 |
| Enterprise | Priced on request | Custom | Custom |

For a small team the Free plan goes a long way: twenty seats cost nothing, and viewers don't take a seat on any plan. But its datasets are public only, which the docs explain means "anyone can query" them, and it has hard caps with no overages. On Growth, API requests, bandwidth and assets beyond the quotas are pay-as-you-go; documents stop at 25,000 unless you buy the $299-a-month Increased quota add-on. Add-ons run from $299 a month for more quota to $999 a month for each extra dataset. A draft counts as a document of its own. Free and Growth include 1,000 AI credits a month; on Growth, more cost $0.05 each. These figures are from [Sanity's pricing page](https://www.sanity.io/pricing); check it before you decide, because plans change.

Galley is free and open-source under Apache-2.0 — including for private Git repositories — whether you run it locally (`npx galley-cms` or the Apple-signed and notarized macOS desktop app) or self-host it on your own server with Docker (`ghcr.io/fictiontribe/galley`), bringing your own AI key and static hosting. For managed hosting with no keys to paste, [Galley Cloud](/cloud/) (opening by invitation) runs a dedicated editor machine per site, hosts the published static site on Cloudflare's global edge, and includes monthly AI credits, pre-built scheduled publishing and Search and AI intelligence — with **no per-seat fees** (up to 500 named people per workspace, 100 per site): Partner is $0 a month for agencies whose clients pay directly, Site is $35 a month (4,000 AI credits), Agency is $99 a month (5 live sites included, then $15–$12 per extra site), and Business is $149 a month (12,000 AI credits, 90-day backups).

Sanity's Growth plan charges per seat and covers only the hosted database, APIs, CDN and Studio — you still pay to host the website separately. Galley Cloud includes Cloudflare edge hosting for the published site on every paid plan and never charges per editor seat.

## What does a developer have to set up, and how does page building work?

With Sanity, the content model comes first. `npm create sanity@latest` makes a Studio project with a `sanity.config.ts` file and, by convention, a `schemas` folder, and the docs are frank about the next step: "A new Sanity Studio project has no schema types registered, so there is nothing to edit yet." A developer defines the document types in TypeScript or, as the Studio page offers, asks a coding agent to. Then the Studio is deployed, to a free `*.sanity.studio` address or a host of your own.

The site has to be taught to fetch. For Astro, Sanity's docs point to the official `@sanity/astro` integration, GROQ queries for what each page shows, a renderer such as `@portabletext/astro` for the rich text, and a webhook so the host rebuilds when content changes. Visual editing and drag-and-drop page building in Sanity's Presentation tool ask for stega encoding and draft mode. On Astro, [Sanity's guide](https://www.sanity.io/docs/visual-editing/astro-visual-editing) says it "requires server-side rendering because draft mode depends on per-request cookie checking. Static output mode will not work." You can server-render only the pages that need it, with "a deployment adapter for your hosting platform."

Galley starts by reading the site. It works out the framework, the content collections and every field's type from the site's own schemas and files, without running any of its code. Astro fits deepest; Docusaurus, Nuxt, Next.js, SvelteKit, Eleventy, Hugo and Jekyll are recognised by their conventions. There are no GROQ queries to write, no markup to add, and **no server-side rendering required**: both click-to-edit on the page and Galley's visual [Arrange](/docs/editing/page-builder/) page builder run directly on static pages using the site's own dev server. In Arrange, editors visually select, drag, reorder, duplicate and drop new sections from a visual thumbnail palette directly onto the rendered page, toggle layout options live, use full keyboard shortcuts and undo safely — with every change landing cleanly in Proof.

The caveat on our side: a site whose copy is hard-coded in components gets less, until someone moves the words into content files.

## How does each one use AI, translations and search intelligence?

Sanity has a large set of named AI features built around its Content Lake:

- **AI Assist**, a Studio plugin on Growth and up, follows "reusable instructions in natural human language": translating documents or fields, image captions, SEO details.
- **Agent Actions**, such as Generate, Transform and Translate, process content with AI from code, on every plan, at one AI credit ($0.05) a request.
- **Content Agent** is a chat assistant for content work "without writing code or GROQ queries", in Sanity's Dashboard, Slack, Linear and an API. It "never makes changes without your approval."
- **Canvas** is "a collaborative writing environment built into Sanity", with AI writing help.
- **Sanity Context** gives your own AI agents knowledge bases built from your content, over MCP. One is free; on Growth, up to five cost $299 a month.
- **An official MCP server**, hosted at `mcp.sanity.io`, lets Claude Code, Cursor, VS Code and other clients query, create, patch and publish documents, manage schemas and create releases.

Galley is built AI-first specifically for websites, uniting editing, media, localization, search intelligence and AI-readable output in one system on every edition (free open source and [Galley Cloud](/cloud/)):

- **Page-aware built-in assistant.** You [ask in plain words](/how-to/ask-the-assistant/) beside the page. It reads the site before it edits, builds or arranges sections, reads brand and voice guidelines from your materials or live site, rebuilds WordPress imports, touches only content and media in content mode, has no shell or network tool, and **never publishes** — every edit waits in word-level Proof.
- **Multi-provider image and short video generation.** Generate images and short video clips across OpenAI, Google Gemini and OpenRouter straight into the media library (included in monthly AI credits on Galley Cloud, or with your own keys self-hosted).
- **Whole-site and per-page AI translations.** Configure target languages, localized URL slugs, `hreflang` alternates and Astro `<LanguageSelector />` / `<LocaleHead />` components ([Languages](/docs/editing/languages/)); edit side by side with automatic out-of-sync flags when the source changes, or translate pages and entire sites with AI using a Git-tracked **Translation Memory** (0-credit reuse of approved phrases), a brand/product **Glossary** and an upfront cost estimate before anything runs — every translated page waiting in Proof.
- **Built-in Search and AI intelligence.** On-site SEO and structured-data checks, one-click fixes into Proof, live Google search rankings, striking-distance (`#4–#15`) quick wins, keyword explorer, competitor content gaps, broken-404 backlink recovery with one-click redirects, and AI search answer citations — included on every Galley Cloud plan (at zero AI credits for lookups) or self-hosted with your own search data key.
- **AI-first published output and MCP.** Galley publishes `llms.txt`, `llms-full.txt`, `agent.md`, Markdown twins of every page and per-AI-crawler `robots.txt` switches ([AI-first websites](/ai-first/)), plus [Galley's MCP server](/docs/integrations/mcp/) for Claude Desktop, Claude Code, Cursor, VS Code or any MCP client (publishing over MCP can be switched off).

Sanity's Slack, Linear and programmatic multi-channel Agent Actions reach across multi-channel content operations. For websites themselves, Galley goes further end-to-end — pairing a safe editing assistant with Translation Memory, live search/keyword intelligence, AI-ready static output and readable Proof.

## How do you check a change and schedule publishing?

In Sanity an edit is a draft until someone publishes it. The Presentation tool shows the draft on your site as you work (requiring SSR on Astro), with history kept for 3 days on Free, 90 on Growth and 365 on Enterprise. Colleagues can comment on single fields or words on Growth. Scheduled drafts are gated to Growth, and Content Releases (publishing groups of documents together) are an Enterprise add-on.

In Galley every change — typed in the form, retyped on the page, arranged visually, translated or made by the assistant — lands in [Proof](/how-to/proof-and-publish/): word-by-word markup with old text struck out and new text written in, right beside the live site. Any single change can be put back, and publishing is a commit or pull request with unlimited Git history.

Galley also includes **scheduled publishing** on both editions:

- **Open source (free):** Schedule changes directly from Proof for an exact date and time — published automatically by the server scheduler or `galley schedule` CLI while holding scheduled changes safely aside so you can keep editing other pages — alongside entry `publishAt` date/time matching and a one-click GitHub Actions scheduled build workflow for pure static sites.
- **Galley Cloud (every plan):** Scheduled releases are pre-built and verified ahead of time with a shareable preview link, then promoted live at Cloudflare's edge at the exact scheduled minute — even while the site's editor machine is asleep, with zero build delay at launch time — alongside instant version rollback without rebuilding.

Sanity still adds inline field-level comments and multi-document Content Releases across non-web channels.

## How does the site get its content?

From Sanity, over the network. A static Astro site fetches it at build time ("content is fetched once during the build rather than on every request"), and "Static sites need a rebuild to reflect content changes", usually through a webhook to the host. A server-rendered site queries Sanity on every request. The requests count towards the plan: 250,000 API requests and a million API CDN requests a month on Free and Growth.

From the repository, with Galley. The build reads the files, as it did before. Publishing is a commit and a push, so whatever deploys the site on a push, such as Netlify, Cloudflare Pages or GitHub Actions, deploys it as before. Galley also deploys directly to Cloudflare (verified on the real service; Vercel deploys are in progress; external media buckets support Cloudflare R2, Amazon S3 and Cloudflare Images), and [Galley Cloud](/cloud/) hosts the published site on Cloudflare's global edge with automatic SSL and nightly repository backups kept 30–90 days.

## Which one suits a team?

Both support real-time multiplayer collaboration, but they treat SSO and seat pricing very differently.

Sanity includes real-time editing and presence on every plan ("Same document, multiple editors, character-level sync"), two roles on Free and five on Growth ($15/seat/month) with comments and tasks. Custom roles, SAML single sign-on, a full audit trail and an uptime agreement are locked to Enterprise. Sanity is SOC 2 Type 2 certified and launched in November 2017.

Galley removes both the seat tax and the SSO paywall:

- **Free OpenID Connect (OIDC) SSO in open source:** Self-hosted Galley (`ghcr.io/fictiontribe/galley`, one isolated container per site) includes owner, editor and contributor accounts plus OpenID Connect single sign-on (Authorization Code with PKCE, IdP role-claim mapping, passwordless `GALLEY_OIDC_ONLY`, Back-Channel Logout) built into the free Apache-2.0 server — no enterprise contract required; see [`/enterprise/`](/enterprise/). On local and self-hosted installs, editors share one copy and a conflicting save is refused rather than overwritten; roles organize work while the container is the security boundary.
- **Real-time collaboration & zero per-seat fees on [Galley Cloud](/cloud/):** Built-in live presence in the top bar and page list, jump to a teammate's page, active field outlines with each person's name, simultaneous typing in Markdown body text, and per-author attribution in Proof — for up to 500 named people per workspace and 100 per site with **$0 per-seat fees**.

Where Sanity still leads for large enterprise teams: custom granular roles, SAML SSO, SCIM/audit trails, inline field comments, and SOC 2 Type 2 certification today.

## Where does Galley fall short?

Beside Sanity, in clear, specific places:

- **It serves websites, not multi-channel apps.** There's no Content Lake or GROQ/GraphQL API for mobile apps or kiosks.
- **It's young.** Version {version} of software first released in November 2026, with no SOC 2 Type 2 report or published uptime SLA yet. Sanity launched in 2017.
- **No inline field-level comments or custom granular roles.** Galley uses Proof, pull requests and three fixed roles (`owner`, `editor`, `contributor`).
- **Galley Cloud is opening by invitation.** Self-hosted and local installs are available today (help via GitHub issues; self-hosted AI uses your own keys).

## When is Sanity the better choice?

When the same content feeds a website, mobile apps and other channels, which is what the Content Lake and its APIs are built for. When you need SOC 2 Type 2, custom roles, SAML SSO, full audit trails and a published enterprise SLA this quarter. When your developers want custom React Studio inputs and programmatic multi-channel Agent Actions or Sanity Context knowledge bases. And when you'd rather adopt a platform launched in 2017 than a new open-source tool.

Galley fits when the content is the website, the site stays purely static (with visual on-page editing and Arrange page building requiring zero SSR), and you want an AI-first editor with Proof, built-in translations and Translation Memory, live Google rankings and keyword-gap intelligence, scheduled publishing, free OIDC SSO self-hosted, and Cloudflare-hosted [Galley Cloud](/cloud/) with real-time collaboration and no per-seat fees. See [what it does today](/tour/), or set it beside [CloudCannon](/compare/cloudcannon/).

## Can you move from one to the other?

From Sanity to Galley takes real work, because the content has to leave the Content Lake and become files. Sanity's command-line tool exports a dataset as a gzipped tarball: `data.ndjson`, with "Every exported document, one JSON object per line", a map of the assets, and folders of images and files. Exports are billed against your API quota. Then someone turns each document into a Markdown or data file, converts the Portable Text with one of the serializers Sanity's docs list, moves the images into the site, and replaces the GROQ queries with reads of local files. Galley has no importer for Sanity. The only guided move into Galley is from [WordPress](/wordpress/), and that is new and in final checks.

The other way, the files are already plain. Sanity's import tool takes NDJSON, and its Block Tools library converts existing markup into Portable Text. You'd still design a schema and rewrite the site to fetch from Sanity.

To try Galley first, run `npx galley-cms` in the site's folder. It edits the content in the site's files, so a site that fetches everything from Sanity gives it little to edit until the content moves.

## Three questions to ask before you choose

**Where else does this content have to go?** If an app, a second site or your own AI agents need it through an API, that points to Sanity. If the answer is "only this website", it doesn't.

**Does visual editing force server-side rendering or per-seat pricing?** Check whether editing on the page forces an SSR adapter on a static site, and what 20 editors and private content cost a year.

**What does leaving look like?** Ask for an export of your content, and try turning one rich-text page into Markdown, before you need to.
