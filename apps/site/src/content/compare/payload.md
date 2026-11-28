---
title: "Galley vs Payload CMS: files in Git or a database"
description: Payload CMS runs inside your Next.js app and keeps content in a database you provide; Galley edits files in Git. Setup, page building, AI, scheduling, SSO, teams, when to choose Payload.
kind: versus
product: Payload
heading: Payload is a framework you build your CMS in. Galley reads the site you already have.
name: Galley and Payload
lead: Payload CMS is an MIT-licensed headless CMS and application framework that runs inside your Next.js app, over a database you provide, and is configured in TypeScript. Galley is an AI-first, open-source CMS (Apache-2.0) with optional managed hosting on Galley Cloud — editing the files in your Git repository with no database at all, and building in visual section building, AI, translations, search intelligence, scheduled publishing and free OIDC SSO.
published: "2026-11-25"
updated: "2026-11-28"
checked: November 2026
order: 8
draft: false
short:
  - Payload keeps your content in a database you provide (MongoDB, Postgres or SQLite), and the site reads it through Payload's APIs. Galley edits the Markdown, JSON and YAML files in your Git repository, and there is no database. Most of the other differences follow from that one.
  - "Both are free to self-host: Payload is MIT-licensed (requiring a Node.js host, database, file storage and email; Enterprise price not public, Nov 2026) and Galley is Apache-2.0 with nothing running behind the live static site. [Galley Cloud](/cloud/) (opening by invitation) adds managed editor hosting, Cloudflare edge website delivery and monthly AI credits from $35 a month per site, with no per-seat fees."
  - Payload is set up in code by a developer, with a Next.js app, a TypeScript config of collections and fields, a database with migrations, and file storage. Galley reads the site as it is and includes visual section building ([Arrange](/docs/editing/page-builder/)) directly on static pages.
  - "Payload offers a free, open-source MCP plugin for developers and lists editor AI features on Enterprise pages (two marked coming soon). Galley is AI-first on every edition: a page-aware assistant that never publishes, image and short video generation, whole-site AI translations with a Git-tracked Translation Memory and Glossary, live Google rankings and keyword-gap intelligence, `llms.txt` and Markdown twins, scheduled publishing, and MCP."
  - Choose Payload if you're building a Next.js application (accounts, orders, internal tools) or multi-channel APIs with code-defined field-level access control and a mature 2018 codebase.
table:
  heading: Galley and Payload, side by side.
  text: Where Payload does more, the table says so.
  caption: Galley compared with Payload
  columns: [What differs, Galley, Payload]
  rows:
    - label: Your content
      ours: Files in your Git repository
      theirs: A database you provide
      better: even
    - label: Price
      ours: Free Apache-2.0 (static live site, no DB bill); Cloud from $35/mo w/ site hosting & $0/seat
      theirs: Free MIT (needs Node host, DB, storage & email); Enterprise price not public (Nov 2026)
      better: ours
    - label: Setup
      ours: Reads the site as it is
      theirs: A Next.js app, config and database (create-payload-app starts them)
      better: ours
    - label: Behind the live site
      ours: Static pages; no database
      theirs: Usually the Next.js app that runs Payload, and its database
      better: ours
    - label: Page building & editing
      ours: Visual Arrange section builder, click-to-edit on the page, forms & assistant
      theirs: Blocks fields in admin forms (its pages differ on visual editing)
      better: ours
    - label: AI & search intelligence
      ours: AI-first — assistant (never publishes), image/video gen, AI translations w/ TM & glossary, live rankings/404 recovery, llms.txt, MCP
      theirs: Free MCP plugin for developers; editor AI on Enterprise pages, two coming soon (Nov 2026)
      better: ours
    - label: Checking a change
      ours: Word-by-word Proof beside the live site, single-change undo, unlimited Git log
      theirs: Opt-in Drafts, Live Preview, document version diffs and restore
      better: ours
    - label: Scheduling & languages
      ours: Built-in i18n w/ TM, glossary & AI translation + built-in scheduled publishing (free & Cloud edge)
      theirs: Free DB locales & background-job scheduling; no built-in AI translation memory
      better: ours
    - label: Teams & SSO
      ours: Free OIDC SSO in Apache-2.0 server + real-time co-editing & $0/seat on Cloud
      theirs: Field-level access in code; SAML/OAuth SSO & Multi-Player (coming soon) on Enterprise
      better: even
    - label: Content for apps
      ours: Built for websites; the site's build reads Git files
      theirs: REST, GraphQL and Local APIs for apps and multi-channel backends
      better: theirs
    - label: Leaving
      ours: No database export; keep your Git repository as-is
      theirs: CSV/JSON export and rich-text conversion
      better: ours
    - label: Maturity
      ours: First released November 2026
      theirs: Started in 2018; about 46,000 GitHub stars (Nov 2026)
      better: theirs
faq:
  - q: Is Galley an alternative to Payload?
    a: "For a static website, yes. Galley lets editors visually arrange sections ([Arrange](/docs/editing/page-builder/)), edit copy with an AI assistant, translate pages with Translation Memory, check live search rankings and schedule releases with no database and little setup (free to self-host with OIDC SSO, or managed on [Galley Cloud](/cloud/)). If you're building an application, or content that feeds mobile apps, Payload is the better fit: it's a full Next.js backend with REST/GraphQL/Local APIs and code-defined field-level access control."
  - q: Is Payload CMS free?
    a: Yes. Payload is open source under the MIT licence and free to host yourself. Its Enterprise plan, with dedicated support and features such as single sign-on, has no public price as of November 2026. You still pay for somewhere to run a Node.js app, a database and file storage. Galley is free under Apache-2.0 locally or self-hosted (including OIDC SSO, using your own AI key), or hosted on [Galley Cloud](/cloud/) from $35 a month per site with Cloudflare website hosting, monthly AI credits and no per-seat fees.
  - q: Does Payload CMS need a database?
    a: Yes. Payload officially supports MongoDB, Postgres and SQLite through adapters, and you provide the database. If your Next.js pages are generated statically and read content through Payload's Local API, the build needs a database connection as well, unless you change how you build. Galley has no database. The content is the files in your Git repository, and the site's build reads them.
  - q: Does Payload have AI features or an MCP server?
    a: "Both, in different places. A free, open-source plugin adds an MCP server to your own Payload app, with permissions set per collection. Its AI features for editors are on its Enterprise pages, with no price: translations, image generation and a writing assistant, the last two marked \"COMING SOON\" (November 2026). Galley's assistant, AI translations with Translation Memory, image/video generation and search intelligence are built into the editor today, and the assistant never publishes."
  - q: How does Payload compare with Strapi and Sanity?
    a: All three are headless. The content sits in a database and reaches the site through an API. Payload and Strapi are open source under MIT and can run on your own servers, while Sanity hosts its content database for you. Payload publishes its own comparison with each, and both make the case that it is native to Next.js. Galley is another kind of CMS that edits files in Git.
  - q: Can Galley edit a site built with Payload?
    a: Not its content. Galley edits files in a Git repository, and a Payload site keeps its words in a database, so there is nothing for Galley to change until the content has been moved into files. Galley has no importer for Payload. Its only guided move is from WordPress, and that is new and in final checks.
sources:
  - label: "Payload, home page"
    href: https://payloadcms.com/
  - label: "Payload, get started (its pricing page)"
    href: https://payloadcms.com/get-started
  - label: "Payload, Enterprise"
    href: https://payloadcms.com/enterprise
  - label: "Payload, Enterprise AI"
    href: https://payloadcms.com/enterprise/enterprise-ai
  - label: "Payload, AI Auto-Embedding"
    href: https://payloadcms.com/enterprise/ai-framework
  - label: "Payload, Publishing Workflows"
    href: https://payloadcms.com/enterprise/publishing-workflows
  - label: "Payload, single sign-on"
    href: https://payloadcms.com/enterprise/single-sign-on-sso
  - label: "Payload, Multi-Player Editing"
    href: https://payloadcms.com/enterprise/multi-player-editing
  - label: "Payload Cloud update: Payload has joined Figma"
    href: https://payloadcms.com/payload-has-joined-figma
  - label: "Payload Cloud, new project"
    href: https://payloadcms.com/new
  - label: "Payload, compared with Sanity"
    href: https://payloadcms.com/compare/sanity
  - label: "Payload, compared with Strapi"
    href: https://payloadcms.com/compare/strapi
  - label: "Payload blog, Payload is joining Figma (17 June 2025)"
    href: https://payloadcms.com/posts/blog/payload-is-joining-figma
  - label: "Payload blog, Payload 4.0 beta (19 October 2026)"
    href: https://payloadcms.com/posts/blog/payload-4-beta-redesigned-admin-tanstack-mcp
  - label: "Payload documentation, the Payload Config"
    href: https://payloadcms.com/docs/configuration/overview
  - label: "Payload documentation, database"
    href: https://payloadcms.com/docs/database/overview
  - label: "Payload documentation, Postgres"
    href: https://payloadcms.com/docs/database/postgres
  - label: "Payload documentation, the rich text field"
    href: https://payloadcms.com/docs/fields/rich-text
  - label: "Payload documentation, use cases"
    href: https://payloadcms.com/docs/getting-started/use-cases
  - label: "Payload documentation, installation"
    href: https://payloadcms.com/docs/getting-started/installation
  - label: "Payload documentation, migrations"
    href: https://payloadcms.com/docs/database/migrations
  - label: "Payload documentation, generating types"
    href: https://payloadcms.com/docs/typescript/generating-types
  - label: "Payload documentation, core concepts"
    href: https://payloadcms.com/docs/getting-started/concepts
  - label: "Payload documentation, building without a database connection"
    href: https://payloadcms.com/docs/production/building-without-a-db-connection
  - label: "Payload documentation, production deployment"
    href: https://payloadcms.com/docs/production/deployment
  - label: "Payload documentation, Live Preview"
    href: https://payloadcms.com/docs/live-preview/overview
  - label: "Payload documentation, versions"
    href: https://payloadcms.com/docs/versions/overview
  - label: "Payload documentation, autosave"
    href: https://payloadcms.com/docs/versions/autosave
  - label: "Payload documentation, drafts and scheduled publishing"
    href: https://payloadcms.com/docs/versions/drafts
  - label: "Payload documentation, localisation"
    href: https://payloadcms.com/docs/configuration/localization
  - label: "Payload documentation, document locking"
    href: https://payloadcms.com/docs/admin/locked-documents
  - label: "Payload documentation, access control"
    href: https://payloadcms.com/docs/access-control/overview
  - label: "Payload documentation, the admin panel"
    href: https://payloadcms.com/docs/admin/overview
  - label: "Payload documentation, the Blocks field"
    href: https://payloadcms.com/docs/fields/blocks
  - label: "Payload documentation, the MCP plugin"
    href: https://payloadcms.com/docs/plugins/mcp
  - label: "Payload documentation, the Import Export plugin"
    href: https://payloadcms.com/docs/plugins/import-export
  - label: "Payload documentation, converting rich text to Markdown"
    href: https://payloadcms.com/docs/rich-text/converting-markdown
  - label: "Payload on GitHub"
    href: https://github.com/payloadcms/payload
  - label: "Payload releases, on GitHub"
    href: https://github.com/payloadcms/payload/releases
  - label: "Strapi, home page"
    href: https://strapi.io/
  - label: "Sanity, Content Lake"
    href: https://www.sanity.io/content-lake
  - label: "Sanity, pricing"
    href: https://www.sanity.io/pricing
  - label: "Galley, the FAQ for developers"
    href: /docs/project/faq/
  - label: "Galley, page builder"
    href: /docs/editing/page-builder/
  - label: "Galley, languages"
    href: /docs/editing/languages/
  - label: "Galley, the tour: what is built and what isn't yet"
    href: /tour/
  - label: "Galley over MCP"
    href: /docs/integrations/mcp/
  - label: "Galley Cloud"
    href: /cloud/
  - label: "Galley for enterprise and security teams"
    href: /enterprise/
related: [strapi, types-of-cms, cloudcannon]
---

## What is Payload CMS, and where does it differ from Galley?

Payload CMS calls itself, in its documentation, "a config-based, code-first CMS and application framework." A developer defines collections and fields in a TypeScript file, `payload.config.ts`, and Payload turns that into an admin panel, a database schema and APIs, inside a Next.js app. It is MIT-licensed, its team started building it in 2018, and its own blog announced on 17 June 2025 that "Payload has joined Figma." On 25 November 2026 its GitHub repository had 46,004 stars.

The root difference is where the words live. Payload keeps them in a database you provide, and officially supports three through adapters: MongoDB, Postgres and SQLite. Its documentation speaks of "a Postgres database that you provide", and rich text is "saved as JSON in the database". Your pages ask Payload for content, and Payload asks the database.

Galley has no database. The words are the files in the site's own Git repository, and Galley edits Markdown, JSON and YAML where they sit (TOML it reads but doesn't change). Publishing is a commit.

So these are [two kinds of CMS](/compare/types-of-cms/), and the kind is the first choice. Payload is a backend you build a site or an app on. Galley is an editor for a static site that keeps its words in files. Both leave the data with you, in your database or your repository.

## How much does each cost?

As of November 2026, Payload's pricing page names two tiers:

| Plan | Price | What the page lists |
| --- | --- | --- |
| Free, self-hosted | Free, MIT licence | Open source, host it yourself, community support |
| Enterprise | No public price | Dedicated support and Enterprise features such as SSO, self-hosted or with Payload |

The free card says: "Deploy it anywhere you can run a Node.js app — for free, forever." Enterprise is reached through "Get a Demo" or "Talk to Sales", and the page shows no price, user count or usage limit for either tier. Payload's own hosting, Payload Cloud, says "Although deployment of new projects is currently paused, existing Cloud projects will continue running as normal." Payload's deployment guide notes that "most Payload projects will also need a database, file storage, an email provider, and a CDN."

Galley is Apache-2.0 and free to run locally (`npx galley-cms` or the Apple-signed and notarized macOS desktop app) or self-host on your own server with Docker (`ghcr.io/fictiontribe/galley`), including OIDC single sign-on, visual section building, AI translations and scheduled publishing, with no database or Node server required behind the live static site. For managed hosting with no keys to paste, [Galley Cloud](/cloud/) (opening by invitation) runs an isolated editor machine per site, serves the published site on Cloudflare's global edge, and includes monthly AI credits, pre-built scheduled publishing and Search and AI intelligence — with **no per-seat fees** (up to 500 named people per workspace, 100 per site): Partner is $0 a month for agencies whose clients pay directly, Site is $35 a month, Agency is $99 a month (5 live sites included, then $15–$12 per extra site), and Business is $149 a month.

## What does a developer have to set up, and how does page building work?

With Payload, the CMS itself, which is the point of it. `npx create-payload-app` scaffolds a Next.js app, database adapter, route files and `payload.config.ts`. With Postgres or SQLite, migrations "will be required for non-development database environments". Types are generated with `payload generate:types`, Live Preview needs front-end hooks, and scheduled publishing requires background jobs wired up. Blocks fields let developers define modular page blocks edited inside admin forms (Payload's own pages differ on whether on-page visual editing is available).

Galley starts by reading the site. It works out the framework, the collections and every field's type from the site's own schemas and files, without running its code. Astro fits deepest; Docusaurus, Nuxt, Next.js, SvelteKit, Eleventy, Hugo and Jekyll are recognised by their conventions. A `galley.config.json` file exists only to correct what it found, editing on the page needs no markup, and Galley's visual [Arrange](/docs/editing/page-builder/) page builder lets editors visually select, drag, reorder, duplicate and drop new sections from a thumbnail palette directly onto static pages, toggle layout options live and undo safely — with zero database or SSR required.

The caveats on our side: detection is only as good as the site is tidy. And Galley edits files only, so a Next.js site whose words are in Payload's database gives it nothing to edit.

## How does each one use AI, translations and search intelligence?

Payload's home page calls it "The Agentic Content Framework". What is free today is mostly for developers: its open-source [MCP plugin](https://payloadcms.com/docs/plugins/mcp) adds `/api/mcp` under Payload's collection access rules. Payload's editor AI features are on its Enterprise pages with no public price: AI-Translations, AI-Image Generation ("COMING SOON") and AI-Writing Assistant ("COMING SOON"), plus AI Auto-Embedding for vector search.

Galley is AI-first on every edition — open source and [Galley Cloud](/cloud/):

- **Page-aware built-in assistant.** Ask in plain words beside the page; it reads the site before it edits, builds and arranges sections, reads brand and voice guidelines from your materials or live site, rebuilds WordPress imports, touches only content and media in content mode, has no shell or network tool, and **never publishes**.
- **Multi-provider image and short video generation.** Generate images and short video clips across OpenAI, Google Gemini and OpenRouter straight into the media library.
- **Whole-site and per-page AI translations.** Configure target languages, localized URL slugs, `hreflang` alternates and Astro `<LanguageSelector />` / `<LocaleHead />` components ([Languages](/docs/editing/languages/)); edit side by side with automatic out-of-sync flags when the source changes, or translate pages and entire sites with AI using a Git-tracked **Translation Memory** (0-credit reuse), a brand/product **Glossary** and an upfront cost estimate — every translated page waiting in Proof.
- **Built-in Search and AI intelligence.** On-site SEO and structured-data checks, live Google search rankings, striking-distance (`#4–#15`) quick wins, keyword explorer, competitor content gaps, broken-404 backlink recovery with one-click redirects, and AI search answer citations — included on Galley Cloud (at zero AI credits for lookups) or self-hosted with your own search data key.
- **AI-first published output and MCP.** Publishes `llms.txt`, `llms-full.txt`, `agent.md`, Markdown twins of every page and per-AI-crawler `robots.txt` switches ([AI-first websites](/ai-first/)), plus [Galley's MCP server](/docs/integrations/mcp/) (publishing over MCP can be switched off).

## How do you check a change and schedule publishing?

Payload makes versions opt-in, with Drafts, Autosave, Live Preview, document version diffs and restore, and background-job scheduled publishing free once configured. On Enterprise, Publishing Workflows add multi-step approvals.

In Galley every change — typed in the form, retyped on the page, arranged visually, translated or made by the assistant — lands in [Proof](/how-to/proof-and-publish/): word-by-word markup beside the live site, where any single change can be put back and publishing is a commit or pull request with unlimited Git history.

Galley also includes **scheduled publishing** on both editions:

- **Open source (free):** Schedule changes directly from Proof for an exact date and time (published automatically by the server scheduler or `galley schedule` CLI while holding scheduled changes safely aside so you can keep editing other pages), alongside entry `publishAt` date/time matching and a one-click GitHub Actions scheduled build workflow for pure static sites.
- **Galley Cloud (every plan):** Pre-built scheduled versions are verified ahead of time with a shareable preview link and promoted live at Cloudflare's edge at the exact scheduled minute — even while the editor machine is asleep, with zero build delay at launch time — alongside instant version rollback without rebuilding.

## How does the site get its content?

Payload's docs list three APIs: Local API, REST and GraphQL. When Next.js generates pages statically using the Local API, the build needs a database connection unless you disable static optimization.

With Galley there's nothing to ask: the site's build reads the files. Galley publishes to your repository and your host builds from there — or deploys directly to Cloudflare (verified on the real service; Vercel deploys are in progress; external media buckets support Cloudflare R2, Amazon S3 and Cloudflare Images). On [Galley Cloud](/cloud/) (opening by invitation), the published site is served straight from Cloudflare's global edge with automatic SSL, custom domains in one DNS record, and nightly backups kept 30–90 days.

## Which one suits a team?

Payload wins on code-defined field-level access control and multi-step approval workflows; Galley wins on free OIDC SSO and built-in real-time multiplayer editing on Cloud.

In Payload's free edition, access control is code you write per collection, global and field, versions keep a document-level history, document locking prevents overlapping edits, and the admin panel is translated into over 30 languages. Enterprise adds SAML/OAuth 2.0 SSO, Publishing Workflows, Audit Logs, and Multi-Player Editing (marked "Coming Soon").

In Galley:

- **Free OpenID Connect (OIDC) SSO self-hosted:** A [hosted editor](/docs/running/hosted/) (`ghcr.io/fictiontribe/galley`, one isolated container per site) adds owner, editor and contributor accounts plus OpenID Connect single sign-on (Authorization Code with PKCE, IdP role-claim mapping, `GALLEY_OIDC_ONLY`, Back-Channel Logout) built into the free Apache-2.0 server — no Enterprise plan needed; see [`/enterprise/`](/enterprise/). On self-hosted installs, editors share one copy and a conflicting save is refused rather than overwritten; roles organize work while the container is the security boundary.
- **Real-time collaboration & zero per-seat fees on [Galley Cloud](/cloud/):** Built-in live presence, active field outlines, simultaneous Markdown typing, and per-author Proof for up to 500 named people per workspace and 100 per site with **$0 per-seat fees**.

## Where does Galley fall short?

Against an application framework this size, in clear places:

- **No content API or app backend.** Galley edits static websites; it doesn't provide REST/GraphQL/Local APIs, user accounts for end-users, or an application database.
- **It's young.** Version {version} of software first released in November 2026. Payload started in 2018 and has ~46,000 GitHub stars.
- **No code-defined field-level ACLs or multi-step approval workflows.** Galley uses Proof, pull requests and three fixed roles.
- **Galley Cloud is opening by invitation.** Self-hosted and local installs are available today (help via GitHub issues; self-hosted AI uses your own keys).

## When is Payload the better choice?

When you're building an application, not only a website: accounts, orders, an internal tool, or content an app reads too. When you need field-level permissions written in TypeScript, or your team builds in Next.js and wants the backend in the same codebase. When you need SAML SSO, multi-step approval workflows and Enterprise support. And when you'd rather adopt a project with years of releases and a large community than a new one.

Galley fits when the site is static, the content is the website, and the people who change it aren't developers: visual section building ([Arrange](/docs/editing/page-builder/)), AI editing, translations with Translation Memory and a Glossary, live Google rankings and keyword-gap intelligence, scheduled publishing, readable Proof, free OIDC SSO self-hosted, and Cloudflare-hosted [Galley Cloud](/cloud/) with real-time collaboration and no per-seat fees — with no database behind the site.

## Can you move from one to the other?

Yes, with work, because the content changes shape.

From Payload to Galley, the content has to come out of the database and into files. Payload's free Import Export plugin exports collections as CSV or JSON, and rich text, stored as JSON, can be converted to Markdown with a function Payload documents. Uploads are already in your own storage. Someone then writes the files in the shape the site's build reads, and rewrites the pages that asked Payload for content. Galley has no importer for Payload; the only guided move into Galley is from WordPress, and it is new, still in final checks.

From Galley to Payload, a developer defines the collections in a Payload config, brings the files' content in (the same plugin imports collection data), and changes the site to read from Payload.

## Three questions to ask before you choose

**Do you need a backend, or an editor?** If the project has users, orders or apps to feed, you need the first, and we think Payload is one of the strongest open-source answers. If it's a website that already works, ask whether you need a database at all.

**Who changes the words, and what do they see before it's live?** Watch an editor make one change, from the request to the live page.

**What runs in production, and who looks after it?** A database, its migrations and backups, file storage, a jobs runner: each is a standing chore with somebody's name on it. Know whose before you choose.
