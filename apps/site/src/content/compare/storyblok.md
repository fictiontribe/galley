---
title: "Galley vs Storyblok: a headless CMS or files in Git"
description: Storyblok is a hosted headless CMS; Galley edits files in your Git repository. Setup, page building, AI, translations, scheduling, SSO, search intelligence, price and teams compared.
kind: versus
product: Storyblok
heading: Storyblok and Galley both let you edit on the page. They keep your words in different places.
name: Galley and Storyblok
lead: Storyblok is a hosted headless CMS with a Visual Editor. Your content lives in its cloud, and your site fetches it as JSON. Galley is an AI-first, open-source CMS (Apache-2.0) with optional managed hosting on Galley Cloud — giving static websites visual section building, built-in AI, translations, search intelligence, scheduled publishing, free OIDC SSO and live collaboration directly on Git files.
published: "2026-11-25"
updated: "2026-11-28"
checked: November 2026
order: 7
draft: false
short:
  - Storyblok keeps your content in its own cloud, in a space whose server location can't be changed later, and your site fetches it as JSON through an API. Galley edits the Markdown, JSON and YAML files in your own repository, and has no database.
  - Storyblok's Starter plan is free with one seat; Growth is $99 a month ($90.75 paid yearly) with five seats, and Growth Plus is $349 a month (as of November 2026), without website hosting. Galley is free and Apache-2.0 locally or self-hosted; [Galley Cloud](/cloud/) (opening by invitation) hosts both editor and static site on Cloudflare's edge with monthly AI credits and no per-seat fees, from $35 a month per site ($99 on Agency for five sites).
  - Storyblok asks a developer for a content model, an SDK in the site and, for the Visual Editor, an HTTPS preview deployment (and on-demand rendering on Astro). Galley reads the site as it is and gives editors on-page editing and the visual [Arrange](/docs/editing/page-builder/) page builder directly on static pages — no second preview deployment required.
  - "Galley is AI-first on every plan: a page-aware assistant that never publishes, multi-provider image and short video generation, whole-site AI translations with a Git-tracked Translation Memory and Glossary, built-in live Google rankings and keyword-gap intelligence, `llms.txt` and Markdown twins, scheduled publishing, and MCP — whereas Storyblok gates AI SEO, version compare and SSO to Premium."
  - Choose Storyblok if the same content feeds mobile apps as well as a website, or if you need custom multi-stage workflows, ISO 27001 and a published uptime SLA today.
table:
  heading: Galley and Storyblok, side by side.
  text: Where Storyblok does more, the table says so.
  caption: Galley compared with Storyblok
  columns: [What differs, Galley, Storyblok]
  rows:
    - label: Your content
      ours: Files in your Git repository
      theirs: In Storyblok's cloud, served as JSON
      better: even
    - label: Price
      ours: Free open source; Galley Cloud from $35/mo w/ site hosting & $0/seat (Nov 2026)
      theirs: Starter free (1 seat); Growth $99/mo for 5 seats, no site hosting (Nov 2026)
      better: ours
    - label: Setup
      ours: Reads the site as it is
      theirs: A content model (Block Library or CLI), an SDK, an HTTPS preview
      better: ours
    - label: Page building
      ours: Visual Arrange builder drags, duplicates & drops the site's sections on static pages
      theirs: Blocks in the Visual Editor, on every plan
      better: even
    - label: AI & search intelligence
      ours: AI-first — assistant (never publishes), image/video gen, AI translations w/ TM & glossary, live rankings/404 recovery, llms.txt, MCP
      theirs: AI features gated by plan (AI SEO on Premium); Agents (beta, Growth up); MCP
      better: ours
    - label: Checking a change
      ours: Word-by-word Proof beside the live site, single-change undo, Cloud preview links
      theirs: Draft preview; version compare gated to Premium
      better: ours
    - label: History & scheduling
      ours: Unlimited Git history + scheduled publishing free & pre-built edge deploys on every Cloud plan
      theirs: History 1–30 days on lower tiers; scheduling from Growth, Releases on Premium
      better: ours
    - label: Languages
      ours: Built-in i18n, side-by-side editing, AI translation w/ Translation Memory & glossary
      theirs: Field, folder or space translation; AI translation (beta)
      better: even
    - label: Two people at once
      ours: Real-time co-editing & live presence on Galley Cloud; safe save checks self-hosted
      theirs: Content conflict warning; Content Locking from Growth (no live co-editing)
      better: ours
    - label: Teams & SSO
      ours: Free OpenID Connect SSO in Apache-2.0 server, 3 roles, $0/seat on Cloud (up to 500)
      theirs: Fixed roles on Growth; custom roles & SSO locked to Premium
      better: ours
    - label: Content for apps
      ours: Built for websites; edits Git files
      theirs: REST API; GraphQL on Premium and Elite for apps and any channel
      better: theirs
    - label: Maturity
      ours: First released November 2026; no ISO 27001 or SLA yet
      theirs: Started in 2017; ISO 27001 certified, uptime SLA
      better: theirs
    - label: Leaving
      ours: No content to export; keep your Git repository as-is
      theirs: Export as JSON by CLI, then convert it
      better: ours
faq:
  - q: Is Galley an alternative to Storyblok?
    a: For a static site whose content lives in Git, yes. Galley needs no content database or API between the site and its words, includes visual section building ([Arrange](/docs/editing/page-builder/)), AI editing, translations with Translation Memory, live search rankings, scheduled publishing and free OIDC SSO self-hosted — plus Cloudflare edge hosting and live co-editing on [Galley Cloud](/cloud/). Storyblok fits better when the content feeds mobile apps too, or when you need custom multi-stage workflows, ISO 27001 and a published uptime SLA today.
  - q: How much does Storyblok cost?
    a: As of November 2026, Starter is free, with one seat. Growth is $99 a month, or $90.75 a month paid yearly, with five seats. Growth Plus is $349 a month, or $319.91 a month paid yearly, with fifteen. Premium and Elite are priced on request. Starter, Growth and Growth Plus each cover one space and do not include hosting the website. Galley is free locally or self-hosted (bringing your own AI key); [Galley Cloud](/cloud/) (opening by invitation) starts at $35 a month per site ($99 on Agency for five sites, $149 on Business), with Cloudflare website hosting, monthly AI credits and Search intelligence included and no per-seat fees.
  - q: Can you self-host Storyblok?
    a: We found no self-hosted edition. Storyblok describes its application as "subscription-based software-as-a-service (SaaS)", and you host only the front end and its preview. Its SDKs, command-line tool and Agent Skills are open source under the MIT licence; the CMS application isn't described as open source. Galley is open source under Apache-2.0, and runs on your computer, on your own server with Docker (`ghcr.io/fictiontribe/galley`, with OIDC SSO built in), or hosted on [Galley Cloud](/cloud/).
  - q: Does Storyblok work with a static site?
    a: Yes. In its pricing page's words, Storyblok "only delivers JSON and therefore can be combined with any static site generator you want", and the site rebuilds when Storyblok's webhook calls your host's build hook. Live preview as editors type usually needs pages rendered on the server or in the browser, so Storyblok usually recommends a separate preview deployment beside the live site. Galley previews with the site's own dev server — no second deployment or SSR required.
  - q: Does Storyblok have an MCP server?
    a: Yes, an official hosted one. Claude, Cursor, VS Code and other MCP clients connect with OAuth or a personal access token, and work in a space through Storyblok's Management API. Galley has one too, offering the assistant's tools for reading and changing the site. Unlike the assistant, such a tool can also publish (its instructions say only when you ask) unless publishing over MCP is switched off.
  - q: Can two people edit the same story at once?
    a: In Storyblok, not by typing together, as far as we found in its docs. When two editors change one story, the second to save gets a Content Conflict warning and can copy their changes over or overwrite; from Growth, a Content Locking app lets only the first editor save. On [Galley Cloud](/cloud/), real-time collaboration and live presence are built in (faces in the top bar and page list, active field outlines, simultaneous Markdown typing, per-author Proof). On self-hosted Galley installs, a conflicting save of a page someone just changed is refused rather than overwritten.
sources:
  - label: "Storyblok, home page"
    href: https://www.storyblok.com/
  - label: "Storyblok, pricing"
    href: https://www.storyblok.com/pricing
  - label: "Storyblok, about"
    href: https://www.storyblok.com/about
  - label: "Storyblok, for enterprises"
    href: https://www.storyblok.com/enterprises
  - label: "Storyblok, trust centre"
    href: https://www.storyblok.com/trust-center
  - label: "Storyblok, technologies"
    href: https://www.storyblok.com/technologies
  - label: "Storyblok, AI credits explained"
    href: https://www.storyblok.com/mp/ai-credits-explained
  - label: "Storyblok changelog, Agents (10 September 2026)"
    href: https://www.storyblok.com/cl/2026-september-agents
  - label: "Storyblok documentation, technical requirements"
    href: https://www.storyblok.com/docs/concepts/technical-requirements
  - label: "Storyblok documentation, spaces"
    href: https://www.storyblok.com/docs/manuals/spaces
  - label: "Storyblok documentation, Content Delivery API"
    href: https://www.storyblok.com/docs/api/content-delivery/v2
  - label: "Storyblok documentation, access tokens"
    href: https://www.storyblok.com/docs/concepts/access-tokens
  - label: "Storyblok documentation, content modelling"
    href: https://www.storyblok.com/docs/concepts/content-modeling
  - label: "Storyblok documentation, blocks"
    href: https://www.storyblok.com/docs/concepts/blocks
  - label: "Storyblok documentation, fields"
    href: https://www.storyblok.com/docs/concepts/fields
  - label: "Storyblok documentation, managing the Visual Editor"
    href: https://www.storyblok.com/docs/concepts/visual-editor
  - label: "Storyblok documentation, the Visual Editor manual"
    href: https://www.storyblok.com/docs/manuals/visual-editor
  - label: "Storyblok documentation, the Astro quickstart"
    href: https://www.storyblok.com/docs/quickstarts/astro
  - label: "Storyblok documentation, the Astro SDK"
    href: https://www.storyblok.com/docs/libraries/js/astro-sdk
  - label: "Storyblok documentation, clients and SDKs"
    href: https://www.storyblok.com/docs/libraries
  - label: "Storyblok documentation, Blueprints"
    href: https://www.storyblok.com/docs/concepts/blueprints
  - label: "Storyblok tutorial, preview and production environments"
    href: https://www.storyblok.com/tp/create-preview-production-environments-and-deploy
  - label: "Storyblok documentation, Agents"
    href: https://www.storyblok.com/docs/manuals/agents
  - label: "Storyblok documentation, MCP server"
    href: https://www.storyblok.com/docs/tooling/mcp-server
  - label: "Storyblok documentation, MCP server setup"
    href: https://www.storyblok.com/docs/tooling/mcp-server/setup
  - label: "Storyblok documentation, Agent Skills"
    href: https://www.storyblok.com/docs/tooling/agent-skills
  - label: "Storyblok documentation, translations"
    href: https://www.storyblok.com/docs/manuals/translations
  - label: "Storyblok documentation, internationalisation"
    href: https://www.storyblok.com/docs/concepts/internationalization
  - label: "Storyblok documentation, roles"
    href: https://www.storyblok.com/docs/concepts/roles
  - label: "Storyblok documentation, workflows"
    href: https://www.storyblok.com/docs/manuals/workflows
  - label: "Storyblok documentation, content authoring"
    href: https://www.storyblok.com/docs/manuals/content-authoring
  - label: "Storyblok documentation, Content Locking"
    href: https://www.storyblok.com/docs/apps/content-locking
  - label: "Storyblok documentation, history"
    href: https://www.storyblok.com/docs/manuals/history
  - label: "Storyblok documentation, Releases"
    href: https://www.storyblok.com/docs/apps/releases
  - label: "Storyblok documentation, the Ideation Room"
    href: https://www.storyblok.com/docs/manuals/ideation-room
  - label: "Storyblok documentation, SSO and SCIM"
    href: https://www.storyblok.com/docs/concepts/sso-and-scim
  - label: "Storyblok documentation, the command-line tool"
    href: https://www.storyblok.com/docs/tooling/cli
  - label: "Storyblok documentation, stories pull"
    href: https://www.storyblok.com/docs/tooling/cli/stories/pull
  - label: "Storyblok documentation, CMS migration"
    href: https://www.storyblok.com/docs/concepts/cms-migration
  - label: "Storyblok's open-source monorepo, on GitHub"
    href: https://github.com/storyblok/monoblok
  - label: "Storyblok Agent Skills, on GitHub"
    href: https://github.com/storyblok/agent-plugin
  - label: "Storyblok, pricing fact sheet (PDF)"
    href: https://a.storyblok.com/f/88751/x/010505f975/storyblok-pricing-plan-factsheet.pdf
  - label: "Galley, the FAQ for developers"
    href: /docs/project/faq/
  - label: "Galley, the tour: what is built and what isn't yet"
    href: /tour/
  - label: "Galley, page builder"
    href: /docs/editing/page-builder/
  - label: "Galley, languages"
    href: /docs/editing/languages/
  - label: "Galley over MCP"
    href: /docs/integrations/mcp/
  - label: "Galley, run a hosted install"
    href: /docs/running/hosted/
  - label: "Galley Cloud"
    href: /cloud/
  - label: "Galley for enterprise and security teams"
    href: /enterprise/
related: [types-of-cms, strapi, payload]
---

## How do Galley and Storyblok differ at the root?

In where your words live. Most of the other differences follow from that.

Storyblok is a headless CMS sold as a service. Its documentation says so plainly: "As a headless CMS, Storyblok stores your content and assets and delivers them over an API. It doesn’t render or host your website." The content sits in a space, "a flexible content repository for your project", on servers in Europe, the United States, Canada or Australia (and, by arrangement, dedicated infrastructure in China). "A space's server location is permanent." Changing it means a new space and a migration. Your site fetches stories as JSON from Storyblok's Content Delivery API, a REST API cached on Amazon CloudFront; Premium and Elite add GraphQL.

Galley keeps no content of its own. The site's words are the files in its repository; Galley changes them, and publishing is a commit. The build reads the files, as it did before.

So Storyblok's content can reach any front end that asks, a website or a mobile app, on Storyblok's plans. Galley's stays in your repository, readable by any person or script, and serves the website it sits in. If your shortlist reads Storyblok vs Contentful, this page adds a different kind of tool to it; [the three kinds of CMS](/compare/types-of-cms/) explains the difference.

## How much does each cost?

As of November 2026, Storyblok has three plans with a price, each for one space, and two priced on request.

| Plan | Monthly | Paid yearly | Seats | AI credits a month |
| --- | --- | --- | --- | --- |
| Starter | Free | Free | 1 (up to 2) | 25,000 |
| Growth | $99 a month | $90.75 a month | 5 (up to 10) | 100,000 |
| Growth Plus | $349 a month | $319.91 a month | 15 | 200,000 |
| Premium and Elite | Priced on request | Priced on request | Agreed with you | Agreed with you |

Every space starts with a 45-day trial of Growth Plus, with no credit card, and can stay on Starter for free afterwards. Growth can buy more seats, traffic, API requests, locales and AI credits; Growth Plus has no add-ons. The figures are in US dollars, from [Storyblok's pricing page](https://www.storyblok.com/pricing); its fact sheet gives add-on prices as the same figure in dollars or euros. Check the page before you decide, because plans change.

Galley is free and open-source under Apache-2.0 to run locally (`npx galley-cms` or the Apple-signed and notarized macOS desktop app) or self-host on your own server with Docker (`ghcr.io/fictiontribe/galley`), bringing your own AI key and static hosting. For managed hosting with no keys to paste, [Galley Cloud](/cloud/) (opening by invitation) runs a dedicated editor machine per site, serves the published site on Cloudflare's global edge, and includes monthly AI credits, pre-built scheduled publishing and Search and AI intelligence — with **no per-seat fees** (up to 500 named people per workspace, 100 per site): Partner is $0 a month for agencies whose clients pay directly, Site is $35 a month (4,000 AI credits), Agency is $99 a month (5 live sites included, then $15–$12 per extra site), and Business is $149 a month (12,000 AI credits, 90-day backups). Storyblok doesn't host the website itself, whereas Galley Cloud includes Cloudflare edge hosting on every paid plan.

## What does a developer have to set up, and how does page building work?

With Storyblok, a content model comes first: content types, blocks and fields, built in the app's Block Library or in code with `@storyblok/schema` and the command-line tool's `schema push`. The site fetches stories with an access token, usually through one of Storyblok's SDKs, and maps each block's name to a component.

The [Visual Editor](https://www.storyblok.com/docs/concepts/visual-editor), Storyblok's headline feature, opens your site in a frame and asks more of it:

- **A preview URL.** "Storyblok’s security policy requires that you serve the preview over HTTPS (whether deployed or on localhost)", so local work needs a certificate.
- **Permission to frame the page,** if the site sends a Content Security Policy: it must allow `https://app.storyblok.com` as a frame ancestor.
- **Two data attributes on each block,** `data-blok-c` and `data-blok-uid`, which the SDKs format for you.
- **The preview bridge,** a script that reloads the page when an editor saves or publishes.
- **A check on the server** that a preview request came from Storyblok, because the preview token can read drafts.

Seeing the page change as an editor types usually needs pages rendered on the server or in the browser, not built ahead of time. For Astro, Storyblok's SDK says the route "must render on demand", while "Reloading on save or publish works on every route." For a site that is static in production, Storyblok's usual recommendation is two deployments: a preview that renders on the server, and the static live site, rebuilt by a webhook after each publish.

Galley starts by reading the site. It works out the framework, the content collections and every field's type from the site's own schemas and files, without running any of its code. Astro fits deepest; Docusaurus, Nuxt, Next.js, SvelteKit, Eleventy, Hugo and Jekyll are recognised by convention. A `galley.config.json` file exists only to correct what it found. Editing on the page needs no markup, and Galley's visual [Arrange](/docs/editing/page-builder/) page builder lets editors select, drag, reorder, duplicate and drop new sections from a thumbnail palette directly onto static pages, toggle layout options live and undo safely — running on the site's own dev server with zero SSR and no second preview deployment. The caveat: a site whose copy is hard-coded in components gets less, until someone moves the words into content files.

## How does each one use AI, translations and search intelligence?

Storyblok has many AI features, sorted by plan and paid for in AI credits, "a monthly allowance for using Storyblok’s AI features" that doesn't roll over. As of November 2026:

- **Every plan:** AI Content Generation, and AI Translations, a beta in 48 languages.
- **Growth and up:** AI Alt Text and Storyblok Agents.
- **Premium and Elite:** AI SEO and basic AI Branding.
- **Elite:** advanced AI Branding, and bringing your own AI.

Storyblok Agents is "an in-app assistant with a chat-based interface. It can read, modify, and analyze the space’s content." Teams can save custom agents and schedule them to run on their own. It is a beta, and in chat "any action that writes content or changes configuration requires manual approval". For outside AI tools, Storyblok hosts an official MCP server.

Galley is AI-first on every edition — open source and [Galley Cloud](/cloud/) — without gating SEO, brand voice or BYOK behind Premium or Elite:

- **Page-aware built-in assistant.** Ask in plain words beside the page; it reads the site before it edits, builds and arranges sections, reads brand and voice guidelines from your materials or live site, rebuilds WordPress imports, touches only content and media in content mode, has no shell or network tool, and **never publishes**.
- **Multi-provider image and short video generation.** Generate images and short video clips across OpenAI, Google Gemini and OpenRouter straight into the media library.
- **Whole-site and per-page AI translations.** Configure target languages, localized URL slugs, `hreflang` alternates and Astro `<LanguageSelector />` / `<LocaleHead />` components ([Languages](/docs/editing/languages/)); edit side by side with automatic out-of-sync flags when the source page changes, or translate pages and entire sites with AI using a Git-tracked **Translation Memory** (0-credit reuse of approved phrases), a brand/product **Glossary** and an upfront cost estimate — every translated page waiting in Proof.
- **Built-in Search and AI intelligence.** On-site SEO and structured-data checks, one-click fixes into Proof, live Google search rankings, striking-distance (`#4–#15`) quick wins, keyword explorer, competitor content gaps, broken-404 backlink recovery with one-click redirects, and AI search answer citations — included on every Galley Cloud plan (at zero AI credits for lookups) or self-hosted with your own search data key.
- **AI-first published output and MCP.** Publishes `llms.txt`, `llms-full.txt`, `agent.md`, Markdown twins of every page and per-AI-crawler `robots.txt` switches ([AI-first websites](/ai-first/)), plus [Galley's MCP server](/docs/integrations/mcp/) (publishing over MCP can be switched off).

## How do you check a change and schedule publishing?

In Storyblok, editors see their draft in the Visual Editor on the preview deployment. On every plan, the Default workflow takes a story through Drafting, Reviewing and Ready to Publish. Versions are kept for one day on Starter, 30 days on Growth and Growth Plus, 180 days on Premium and without limit on Elite; comparing a draft with the published version is gated to Premium and Elite. Scheduling a single story starts on Growth; Releases, which publish a group of stories together, on Premium.

In Galley every change — typed in the form, retyped on the page, arranged visually, translated or made by the assistant — lands in [Proof](/how-to/proof-and-publish/): word-by-word markup beside the live site, where any single change can be put back, and publishing is a commit or pull request with unlimited Git history.

Galley also includes **scheduled publishing** on every edition:

- **Open source (free):** Schedule changes directly from Proof for an exact date and time (published automatically by the server scheduler or `galley schedule` CLI while holding scheduled changes safely aside so you can keep editing other pages), alongside entry `publishAt` date/time matching and a one-click GitHub Actions scheduled build workflow for pure static sites.
- **Galley Cloud (every plan):** Pre-built scheduled versions are verified ahead of time with a shareable preview link and promoted live at Cloudflare's edge at the exact scheduled minute — even while the editor machine is asleep, with zero build delay at launch time — alongside instant version rollback without rebuilding.

Storyblok still has more process around multi-stage review: workflow stages, assignments and field-level comments.

## How does the site get its content?

From Storyblok's API, when the site is built or on each visit. Storyblok hosts the editor, the content (cached on a CDN) and the images (transformed on request); you host the front end, its domain and the preview. A static site rebuilds when Storyblok's webhook calls your host's build hook.

Galley serves no content. The build reads the files, and your host builds from the repository as it would after any commit — or deploys directly to Cloudflare (verified on the real service; Vercel deploys are in progress; external media buckets support Cloudflare R2, Amazon S3 and Cloudflare Images). On [Galley Cloud](/cloud/) (opening by invitation), Galley serves the published site straight from Cloudflare's global edge with automatic SSL, custom domains in one DNS record, and nightly backups kept 30–90 days.

## Which one suits a team?

Galley leads on free OIDC SSO, real-time multiplayer co-editing and flat seat pricing; Storyblok leads on custom multi-stage workflows, field-level comments, ISO 27001 and a published SLA.

In Storyblok, every plan has three fixed roles (Owner, Admin and Editor) and the Default workflow, and editors can comment on any field and tag teammates. Premium adds ten custom roles, two custom workflows and single sign-on through OpenID Connect or SAML; Elite lifts those limits. Storyblok is certified for ISO 27001 and says it adheres to SOC 2 Type 2, and its uptime agreement runs from 97% on Growth to 99.99% on Elite. When two editors change one story, Storyblok shows a Content Conflict warning (and from Growth offers a Content Locking app); we found no live co-editing of a story in its docs.

In Galley:

- **Free OpenID Connect (OIDC) SSO self-hosted:** A [hosted editor](/docs/running/hosted/) (`ghcr.io/fictiontribe/galley`, one isolated container per site) adds owner, editor and contributor accounts plus OpenID Connect single sign-on (Authorization Code with PKCE, IdP role-claim mapping, `GALLEY_OIDC_ONLY`, Back-Channel Logout) built into the free Apache-2.0 server — no Premium upgrade required; see [`/enterprise/`](/enterprise/). On self-hosted installs, editors share one copy and a conflicting save is refused rather than overwritten; roles organize work while the container is the security boundary.
- **Real-time collaboration & zero per-seat fees on [Galley Cloud](/cloud/):** Teammates see faces in the top bar and page list, jump to each other's page, see active field outlines with each person's name, type together simultaneously in Markdown body text, and see each author attributed in Proof — for up to 500 named people per workspace and 100 per site with **$0 per-seat fees**.

## Where does Galley fall short?

In clear places:

- **No content API for apps.** There's no REST or GraphQL API for a mobile app to read.
- **It's young.** Version {version} of software first released in November 2026, with no ISO 27001 certification, SOC 2 report or uptime SLA yet. Storyblok was started in 2017.
- **No custom multi-stage workflows or field-level comments.** Galley uses Proof, pull requests and three fixed roles.
- **Galley Cloud is opening by invitation.** Self-hosted and local installs are available today (help via GitHub issues; self-hosted AI uses your own keys).
- **TOML is read-only.** Galley reads TOML files but won't change them.

## When is Storyblok the better choice?

When the same content has to reach a website and a mobile app through one API. When you need custom multi-stage editorial workflows, field-level comments, SCIM, ISO 27001 and a 99.9%–99.99% uptime SLA. And when you'd rather buy a SaaS platform with a record since 2017 than adopt a new open-source tool.

Galley fits when the website is the whole job: a static site whose content lives as files in Git, edited by non-developers who want visual section building ([Arrange](/docs/editing/page-builder/)), AI editing, translations with Translation Memory and a Glossary, live Google rankings and keyword-gap intelligence, scheduled publishing, side-by-side Proof, free open-source OIDC SSO, and Cloudflare-hosted [Galley Cloud](/cloud/) with real-time collaboration and no per-seat fees. See [what it does today](/tour/).

## Can you move from one to the other?

Yes, but it's a project, because the content has to come out of Storyblok's database and become files. Storyblok's command-line tool downloads it: with `stories pull`, stories are "saved as individual JSON files", and `assets pull` fetches the images. A developer then turns those trees of blocks into Markdown or data files, including rich text, which Storyblok stores as JSON, and changes the templates to read files instead of the API. Galley has no importer for Storyblok. Its only guided move is from [WordPress](/wordpress/), and that is new, in final checks.

The other way, Storyblok's CMS migration guide covers moving in, with tutorials for coming from Contentful, WordPress, Drupal, Sitecore and Adobe Experience Manager; files would first need a content model to land in.

## Three questions to ask before you choose

**Where do the words live, and what does leaving take?** With Storyblok, in its cloud, in a region fixed when the space was made, and leaving means an export and a conversion. With Galley, in your repository already.

**Does anything besides the website need this content?** If an app reads it too, you want an API, and that's Storyblok's side of this page.

**When the AI makes a change, who sees it before it's live, and in what form?** Ask each product to show you on a real page, with someone who isn't a developer doing the reviewing.
