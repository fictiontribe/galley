---
title: "Galley vs Contentful: a free Contentful alternative"
description: Contentful alternatives for a static site. How Galley and Contentful differ on where content lives, setup, page building, AI, scheduling, SSO, teams and price, and when Contentful wins.
kind: versus
product: Contentful
heading: Contentful keeps your content in its cloud. Galley keeps it in your repository.
name: Galley and Contentful
lead: Contentful is a hosted, API-first platform that serves one body of content to websites, apps and other channels, with years of enterprise features behind it. Galley is an AI-first, open-source Contentful alternative for static sites (with optional managed hosting on Galley Cloud) — giving teams visual page building, built-in AI, translations, search intelligence, scheduled publishing, free OIDC SSO and live collaboration directly on Git files.
published: "2026-11-25"
updated: "2026-11-28"
checked: November 2026
order: 3
draft: false
short:
  - Contentful is a hosted, API-first headless CMS. Your content lives in its cloud, on Amazon Web Services, and sites fetch it through its APIs. Asked whether you can host it yourself, its help centre answers "No." Galley's content is files in your own Git repository, and every publish is a commit.
  - As of November 2026, Contentful's Free plan may not be used for commercial work, Lite is $300 a month (without website hosting), and Studio, AI Actions and Personalization are gated to Enterprise. Galley is free and Apache-2.0 locally or self-hosted; [Galley Cloud](/cloud/) (opening by invitation) adds Cloudflare edge website hosting, monthly AI credits and Search intelligence from $35 a month per site ($149 on Business), with no per-seat fees.
  - With Contentful, a developer designs the content model first, wires API fetches and a live preview SDK, and registers React components for Studio. Galley reads the site's collections and fields as they already are, and includes visual section building ([Arrange](/docs/editing/page-builder/)) on every edition with zero SSR or React requirement.
  - "Galley is AI-first on every plan: a page-aware assistant that never publishes, multi-provider image and short video generation, whole-site AI translations with a Git-tracked Translation Memory and Glossary, built-in live Google rankings and keyword-gap intelligence, `llms.txt` and Markdown twins, scheduled publishing, and MCP — whereas Contentful locks AI Actions to Enterprise."
  - Choose Contentful if the same content must reach mobile apps and other channels through an API, or your team needs custom roles, multi-stage localized approval workflows, SCIM, SOC 2 Type 2, ISO 27001, and a 99.99% uptime SLA today.
table:
  heading: Galley and Contentful, side by side.
  text: Where Contentful does more, the table says so.
  caption: Galley compared with Contentful
  columns: [What differs, Galley, Contentful]
  rows:
    - label: Your content
      ours: Files in your Git repository
      theirs: Entries in Contentful's cloud, on AWS
      better: even
    - label: Price
      ours: Free open source; Galley Cloud from $35/mo w/ site hosting & $0/seat (Nov 2026)
      theirs: Free (non-commercial only); Lite $300/mo, no site hosting (Nov 2026)
      better: ours
    - label: Setup
      ours: Reads the site as it is
      theirs: A content model (visual modeler or CLI), API fetch code and preview SDK
      better: ours
    - label: Content for apps
      ours: Built for websites; edits the site's Git files
      theirs: Delivery and GraphQL APIs on every plan for apps and any channel
      better: theirs
    - label: Editing
      ours: Form, click-to-edit on the page, visual Arrange builder, or AI assistant
      theirs: Entry forms beside a framed live preview
      better: ours
    - label: Page building
      ours: Visual Arrange builder drags, duplicates & drops the site's sections — free & all plans
      theirs: Studio, locked to Enterprise and React 18+
      better: ours
    - label: AI & search intelligence
      ours: AI-first — assistant (never publishes), image/video gen, AI translations w/ TM & glossary, live rankings/404 recovery, llms.txt, MCP
      theirs: AI Actions locked to Enterprise; Content Operations Agent; free MCP server; no live rankings
      better: ours
    - label: Checking a change
      ours: Word-by-word Proof across the site beside the live page, single-change undo, Cloud previews
      theirs: Live preview; master-environment version compare
      better: ours
    - label: Two people at once
      ours: Real-time co-editing & live presence on Galley Cloud; safe save checks self-hosted
      theirs: Presence indicator from Lite; comments and Tasks (no simultaneous typing)
      better: ours
    - label: Teams & SSO
      ours: Free OpenID Connect SSO in Apache-2.0 server & $0/seat on Cloud (up to 500)
      theirs: Custom roles, Teams, SCIM and audit logs on Enterprise
      better: even
    - label: Languages and scheduling
      ours: Built-in i18n w/ TM, glossary & AI translation + built-in scheduled publishing (free & Cloud)
      theirs: Up to 500 locales, localized workflows, dated releases with Launch
      better: even
    - label: Leaving
      ours: No content to export; keep your Git repository as-is
      theirs: A JSON export to convert
      better: ours
    - label: Maturity
      ours: First released November 2026; no SOC 2, ISO 27001 or SLA yet
      theirs: SOC 2 Type 2, ISO 27001; up to 99.99% SLA on Enterprise
      better: theirs
faq:
  - q: Is Galley an alternative to Contentful?
    a: For a static website, yes. Galley edits the content files in your Git repository, needs no content model or API code for common setups, includes visual section building ([Arrange](/docs/editing/page-builder/)), AI editing, translations with Translation Memory, live search rankings, scheduled publishing and free OIDC SSO self-hosted — plus Cloudflare edge hosting and live co-editing on [Galley Cloud](/cloud/). Contentful stays the better choice when the same content must feed mobile apps and other channels through an API, or when you need custom multi-stage workflows, SCIM, SOC 2 / ISO 27001 and a 99.99% enterprise SLA today.
  - q: Can you self-host Contentful?
    a: "No. Contentful's help centre answers the question directly: \"No. Contentful is a cloud-based web service that we manage. Downloading Contentful and hosting it yourself is not in our plans.\" It runs on Amazon Web Services, in the US by default, with EU data residency on Enterprise. Galley is open source under Apache-2.0 and runs on your own computer, on your own server with Docker (`ghcr.io/fictiontribe/galley`), or hosted on [Galley Cloud](/cloud/)."
  - q: How much does Contentful cost?
    a: As of November 2026, the Free plan is $0, with 10 users and 100,000 API calls a month, and may be used only to test and learn, not for commercial use. Lite is $300 a month, with 20 users and a million API calls (without hosting the website). Enterprise, and the Studio, AI Actions and Personalization added to it, are priced on request. Galley is free locally or self-hosted (bringing your own AI key); [Galley Cloud](/cloud/) (opening by invitation) starts at $35 a month per site ($99 on Agency for five sites, $149 on Business), with Cloudflare website hosting, monthly AI credits and Search intelligence included and no per-seat fees.
  - q: Does Contentful have AI features and an MCP server?
    a: Yes. AI Actions, on any Enterprise plan, run set prompts such as translation, alt text and SEO metadata on entries, with a model you choose or bring. The Content Operations Agent, generally available since 9 November 2026, takes requests in plain language and asks before it publishes. An official hosted MCP server is available to all customers without charge.
  - q: What is the difference between Contentful and Sanity?
    a: Both are headless CMSs that keep your content in their own hosted cloud and serve it through APIs. The difference we'd point to first is the editor. Contentful's is its hosted web app, and the content model is built there or with scripted migrations. Sanity Studio is open-source React code you configure in TypeScript, with the schema in your repository, while the content stays in Sanity's Content Lake.
  - q: Can Galley edit content that is stored in Contentful?
    a: "No. Galley edits Markdown, JSON and YAML files in a Git repository; it reads TOML but doesn't change it. A site whose words come from Contentful's API has nothing there for Galley to edit until those words are moved into files and the templates read them from there. Galley has no importer for Contentful. Its only guided move is from WordPress, and that is new and in final checks."
sources:
  - label: "Contentful, home page"
    href: https://www.contentful.com/
  - label: "Contentful, platform"
    href: https://www.contentful.com/products/platform/
  - label: "Contentful, pricing"
    href: https://www.contentful.com/pricing/
  - label: "Contentful Help Center, usage limits"
    href: https://www.contentful.com/help/admin/usage/usage-limit/
  - label: "Contentful Help Center, backup, security and hosting"
    href: https://www.contentful.com/help/faq/backup-security-and-hosting/
  - label: "Contentful blog, a new chapter for Contentful (1 June 2026)"
    href: https://www.contentful.com/blog/a-new-chapter-for-contentful/
  - label: "Contentful documentation, developer docs"
    href: https://www.contentful.com/developers/docs/
  - label: "Contentful documentation, domain model"
    href: https://www.contentful.com/developers/docs/concepts/domain-model/
  - label: "Contentful documentation, data model"
    href: https://www.contentful.com/developers/docs/concepts/data-model/
  - label: "Contentful documentation, technical limits"
    href: https://www.contentful.com/developers/docs/platform/technical-limits/
  - label: "Contentful documentation, scripting migrations with the CLI"
    href: https://www.contentful.com/developers/docs/tutorials/cli/scripting-migrations/
  - label: "Contentful documentation, automate site builds with webhooks"
    href: https://www.contentful.com/developers/docs/tutorials/general/automate-site-builds-with-webhooks/
  - label: "Contentful, Astro starter"
    href: https://www.contentful.com/astro-starter/
  - label: "Contentful, getting started with your framework"
    href: https://www.contentful.com/technologies-getting-started/
  - label: "Contentful Help Center, live preview"
    href: https://www.contentful.com/help/preview/live-preview/
  - label: "Contentful documentation, live preview"
    href: https://www.contentful.com/developers/docs/tutorials/general/live-preview/
  - label: "Contentful documentation, Experiences (Studio)"
    href: https://www.contentful.com/developers/docs/experiences/
  - label: "Contentful documentation, installing the Experiences SDK"
    href: https://www.contentful.com/developers/docs/experiences/installation/
  - label: "Contentful Help Center, Studio experiences"
    href: https://www.contentful.com/help/studio/experiences/
  - label: "Contentful Help Center, AI Actions"
    href: https://www.contentful.com/help/ai-automations/ai-actions/
  - label: "Contentful Help Center, bring your own model"
    href: https://www.contentful.com/help/ai-automations/ai-actions/bring-your-own-model/
  - label: "Contentful Help Center, Content Operations Agent"
    href: https://www.contentful.com/help/ai-automations/content-operations-agent/
  - label: "Contentful changelog, Content Operations Agent is now generally available"
    href: https://www.contentful.com/developers/changelog/content-operations-agent-is-now-generally-available/
  - label: "Contentful documentation, MCP server"
    href: https://www.contentful.com/developers/docs/tools/mcp-server/
  - label: "Contentful changelog, remote MCP server in GA"
    href: https://www.contentful.com/developers/changelog/remote-mcp-server-in-ga/
  - label: "Contentful Help Center, entry editor"
    href: https://www.contentful.com/help/content-and-entries/entry-editor/
  - label: "Contentful Help Center, tasks"
    href: https://www.contentful.com/help/content-and-entries/tasks/
  - label: "Contentful Help Center, workflows"
    href: https://www.contentful.com/help/ai-automations/workflows/
  - label: "Contentful Help Center, versions"
    href: https://www.contentful.com/help/content-and-entries/versions/
  - label: "Contentful Help Center, Timeline"
    href: https://www.contentful.com/help/timeline/
  - label: "Contentful Help Center, Launch"
    href: https://www.contentful.com/help/launch/
  - label: "Contentful Help Center, scheduled publishing"
    href: https://www.contentful.com/help/scheduled-publishing/
  - label: "Contentful documentation, near real-time audit logs"
    href: https://www.contentful.com/developers/docs/concepts/near-real-time-audit-logs/
  - label: "Contentful, marketplace"
    href: https://www.contentful.com/marketplace/
  - label: "Contentful Help Center, data export"
    href: https://www.contentful.com/help/admin/data-export/
  - label: "Contentful documentation, importing and exporting content with the CLI"
    href: https://www.contentful.com/developers/docs/tutorials/cli/import-and-export/
  - label: "Sanity documentation, deploying Sanity Studio"
    href: https://www.sanity.io/docs/studio/deployment
  - label: "Sanity, Sanity Studio"
    href: https://www.sanity.io/studio
  - label: "Galley, the FAQ for developers"
    href: /docs/project/faq/
  - label: "Galley, the tour: what is built and what isn't yet"
    href: /tour/
  - label: "Galley, page builder"
    href: /docs/editing/page-builder/
  - label: "Galley, languages"
    href: /docs/editing/languages/
  - label: "Galley, over MCP"
    href: /docs/integrations/mcp/
  - label: "Galley, run a hosted install"
    href: /docs/running/hosted/
  - label: "Galley Cloud"
    href: /cloud/
  - label: "Galley for enterprise and security teams"
    href: /enterprise/
related: [types-of-cms, sanity, cloudcannon]
---

## How do Galley and Contentful differ at the root?

In where your content lives. Most of what follows comes from that.

Contentful's platform page calls it "A headless CMS at the core of Contentful's digital experience platform", and says "Contentful is API-first and cloud-native." Your content sits in a space, hosted on Amazon Web Services, and a website, an app or anything else asks for it through Contentful's APIs: the Content Delivery API for what is published, the Preview API for drafts, a GraphQL API and a Sync API, all on every plan. It runs only in Contentful's cloud. Its help centre asks "Can I self host/download Contentful?" and answers "No. Contentful is a cloud-based web service that we manage."

Galley keeps the content where a static site already keeps it: Markdown, JSON or YAML files (TOML it reads but doesn't change) in the site's own Git repository. There is no database. An unpublished change is a changed file, and publishing is a commit.

Two things follow. Contentful is built for one body of content that feeds many places; Galley edits the one website in the repository, with no content API for apps or other channels. And with Contentful your content lives in a vendor's system, on its plans, while with Galley it stays in your repository.

## How much does each cost?

As of November 2026, Contentful's pricing page lists three platform plans:

| Plan | Price | Users | Locales | API calls a month |
| --- | --- | --- | --- | --- |
| Free | $0, not for commercial use | 10 | 2 | 100,000, no overages |
| Lite | $300 a month | 20 | 3 | 1 million, then $5 per million |
| Enterprise | Priced on request | Custom | Custom | Unlimited |

Contentful's usage terms say the Free plan "may not be used to support commercial use cases." On Lite, a larger Lite Space, with 50 content types, 50,000 records and up to five workflows, costs $850 a month on top. Studio, AI Actions and Personalization are added to an Enterprise plan, through sales. Those figures are from [Contentful's pricing page](https://www.contentful.com/pricing/); check it before you decide, because plans change.

Galley is free and open-source under Apache-2.0 to run locally (`npx galley-cms` or the Apple-signed and notarized macOS desktop app) or self-host on your own server with Docker (`ghcr.io/fictiontribe/galley`), bringing your own AI key and static hosting. For teams that want managed hosting with no keys to paste, [Galley Cloud](/cloud/) (opening by invitation) runs an isolated editor machine per site, hosts the live site on Cloudflare's global edge, and includes monthly AI credits, pre-built scheduled publishing and Search and AI intelligence — with **no per-seat fees** (up to 500 named people per workspace, 100 per site): Partner is $0 a month for agencies whose clients pay directly, Site is $35 a month (4,000 AI credits), Agency is $99 a month (5 live sites included, then $15–$12 per extra site), and Business is $149 a month (12,000 AI credits, 90-day backups).

Notice what Contentful's $300-a-month Lite plan does not cover: hosting the website itself. Its price covers the content and its delivery through a CDN, while the website is built and hosted elsewhere. Galley Cloud includes Cloudflare edge hosting for the published site on every paid plan.

## What does a developer have to set up, and how does page building work?

For Contentful, a content model, before anyone writes a word. "Each content type consists of a set of up to 50 fields that you define", from text and rich text to dates, media and references. A developer builds the model in the web app's visual modeler, or scripts it with Contentful's command-line tool. Then the site needs code to fetch the content, with keys for Contentful's APIs, and, for a static site, a webhook so that publishing starts a rebuild.

Preview takes a little more. Side-by-side preview needs only a preview platform set up in Contentful, but live updates and inspector mode need its live preview SDK, and the site has to let `app.contentful.com` show it in a frame. Studio, Contentful's visual page editor, takes the most: Enterprise pricing, the Experiences SDK, React 18 or later, and your components and design tokens registered in code.

In return, developers get structured content, TypeScript definitions generated from the model, and guides for twenty technologies, from Astro and Next.js to Android, Swift and .NET.

Galley starts by reading the site. It works out the framework, the content collections and every field's type from the site's own schemas and files, without running any of its code. Astro fits deepest; Docusaurus, Nuxt, Next.js, SvelteKit, Eleventy, Hugo and Jekyll are recognised by their conventions. A `galley.config.json` file exists only to correct what it found, editing on the page needs no markup, and Galley's visual [Arrange](/docs/editing/page-builder/) page builder is built in free and on every Cloud plan — letting editors visually select, drag, reorder, duplicate and drop new sections from a thumbnail palette directly onto static pages, toggle layout options live and undo safely, with zero SSR or React requirement.

The honest caveat on our side: detection is only as good as the site is tidy. A site that keeps its words in content files, with schemas, gets a good form with no work. A site whose copy is hard-coded in components gets less, until someone moves the words out.

## How does each one use AI, translations and search intelligence?

Contentful's headline is "Built for humans. Ready for agents." It has built a good deal to back that up:

- **AI Actions** run set prompts on an entry or a single field, such as translation, image alt text or SEO metadata, with a model you pick or one you bring. The pricing page says "AI Actions is available on any Enterprise plan", with credits included and pay-as-you-go beyond them.
- **The Content Operations Agent**, generally available since 9 November 2026, takes a request in plain language, and "the agent creates pages, audits content, applies metadata, and runs AI Actions across many entries at once." It asks first: "the agent never publishes, archives, or changes a content type without your explicit approval first."
- **An official MCP server**, hosted by Contentful: "The MCP server is available to all customers without charge." Cursor, VS Code, Claude Code, ChatGPT and Windsurf sign in with OAuth.

Galley is AI-first on every edition — open source and [Galley Cloud](/cloud/) — without gating AI tools behind an Enterprise contract:

- **Page-aware built-in assistant.** Ask in plain words beside the page. It reads the site before it edits, builds and arranges sections, reads brand and voice guidelines from your materials or live site, rebuilds WordPress imports, touches only content and media in content mode, has no shell or network tool, and **never publishes**.
- **Multi-provider image and short video generation.** Generate images and short video clips across OpenAI, Google Gemini and OpenRouter straight into the media library.
- **Whole-site and per-page AI translations.** Configure target languages, localized URL slugs, `hreflang` alternates and Astro `<LanguageSelector />` / `<LocaleHead />` components ([Languages](/docs/editing/languages/)); edit side by side with automatic out-of-sync flags when the source page changes, or translate pages and entire sites with AI using a Git-tracked **Translation Memory** (0-credit reuse), a brand/product **Glossary** and an upfront cost estimate — every translated page waiting in Proof.
- **Built-in Search and AI intelligence.** On-site SEO and structured-data checks, live Google search rankings, striking-distance (`#4–#15`) quick wins, keyword explorer, competitor content gaps, broken-404 backlink recovery with one-click redirects, and AI search answer citations — included on Galley Cloud (at zero AI credits for lookups) or self-hosted with your own search data key.
- **AI-first published output and MCP.** Publishes `llms.txt`, `llms-full.txt`, `agent.md`, Markdown twins of every page and per-AI-crawler `robots.txt` switches ([AI-first websites](/ai-first/)), plus [Galley's MCP server](/docs/integrations/mcp/) (publishing over MCP can be switched off).

Both products' built-in AI waits for a person before anything goes live. For websites, Galley gives teams integrated search intelligence, Translation Memory, AI-ready static output and readable side-by-side Proof without an Enterprise contract. For multi-channel content operations across dozens of markets with external TMS integrations and multi-stage approval steps, Contentful still leads.

## How do you check a change and schedule publishing?

In Contentful, live preview is on every plan, beside the entry editor. A team can add tasks ("An entry can be published only after all tasks in it are completed"), and, with a Lite Space or on Enterprise, workflows of up to 20 steps. Each entry keeps versions on the master environment. Launch groups entries into dated releases, and single entries can be scheduled too. Contentful's help centre says it can't restore a single deleted entry, though it can recover a deleted space or environment within 25 days.

In Galley every change — typed in the form, retyped on the page, arranged visually, translated or made by the assistant — lands in [Proof](/how-to/proof-and-publish/): word-by-word markup beside the live site, where any single change can be put back and undoing a publish brings deleted pages back cleanly as a new commit.

Galley also includes **scheduled publishing** on both editions:

- **Open source (free):** Schedule changes directly from Proof for an exact date and time (published automatically by the server scheduler or `galley schedule` CLI while holding scheduled changes safely aside so you can keep editing other pages), alongside entry `publishAt` date/time matching and a one-click GitHub Actions scheduled build workflow for pure static sites.
- **Galley Cloud (every plan):** Pre-built scheduled versions are verified ahead of time with a shareable preview link and promoted live at Cloudflare's edge at the exact scheduled minute — even while the editor machine is asleep, with zero build delay at launch time — alongside instant version rollback without rebuilding.

## How does the site get its content?

From Contentful's API, at build time or on each visit. A static site's build fetches entries through the Content Delivery API, and webhooks trigger rebuilds. The same API, through Contentful's global CDN, serves mobile apps and other channels.

With Galley, the build reads files. Galley publishes to your repository, and your host builds from there — or deploys directly to Cloudflare (verified on the real service; Vercel deploys are in progress; external media buckets support Cloudflare R2, Amazon S3 and Cloudflare Images). On [Galley Cloud](/cloud/) (opening by invitation), the published site is served straight from Cloudflare's global edge with automatic SSL, custom domains in one DNS record, and nightly repository backups kept 30–90 days.

## Which one suits a team?

Contentful leads for formal multi-stage enterprise governance; Galley leads on real-time co-editing, free OIDC SSO and zero per-seat pricing.

Contentful's Free plan has two roles (Admin and Editor) and Lite adds Author. Enterprise adds custom roles, tag-based permissions, Teams, SCIM provisioning, near real-time audit logs, localized workflows, 24/7 support and up to a 99.99% SLA. Comments and Tasks are on every plan, and a presence indicator starts at Lite (without simultaneous typing). Contentful is certified to SOC 2 Type 2 and ISO 27001.

Galley gives web teams:

- **Real-time multiplayer collaboration on [Galley Cloud](/cloud/):** Faces in the top bar and page list, jump straight to a teammate's page, active field outlines with each person's name, simultaneous typing in Markdown body text, and per-author attribution in Proof — with up to 500 named people per workspace and 100 per site at **$0 per seat**.
- **Free OpenID Connect (OIDC) SSO self-hosted:** A [hosted editor](/docs/running/hosted/) (`ghcr.io/fictiontribe/galley`, one isolated container per site) adds owner, editor and contributor accounts plus OpenID Connect single sign-on (Authorization Code with PKCE, IdP role-claim mapping, `GALLEY_OIDC_ONLY`, Back-Channel Logout) built into the free Apache-2.0 server; see [`/enterprise/`](/enterprise/). On local and self-hosted installs, editors share one copy and a conflicting save is refused rather than silently overwritten; roles organize work while the container is the security boundary.

Where Contentful still leads: SCIM provisioning, custom granular roles, up to 20-step localized approval workflows, near real-time audit logs, PCI DSS / EU residency, SOC 2 Type 2 and ISO 27001.

## Where does Galley fall short?

Beyond enterprise procurement certifications, in clear places:

- **No content API for apps.** Galley edits static websites in Git; it doesn't serve mobile apps or kiosks over an API.
- **It's young.** Version {version} of software first released in November 2026, with no SOC 2 Type 2 report, ISO 27001 badge or uptime SLA yet.
- **No multi-stage approval workflows, SCIM or custom granular roles.** Galley relies on Proof, pull requests and three fixed roles.
- **Galley Cloud is opening by invitation.** Self-hosted and local installs are available today (help via GitHub issues; self-hosted AI uses your own keys).

## When is Contentful the better choice?

When one body of content has to reach a website, mobile apps and other channels, which is the job Contentful was built for. When your team is large or regulated and needs custom roles, multi-stage localized approval workflows, SCIM, near real-time audit logs, PCI DSS, SOC 2 Type 2, ISO 27001, EU data residency or a 99.99% SLA on Enterprise. When you want personalisation and A/B tests in the same system through Personalization on Enterprise, or marketplace integrations with Slack, Microsoft Teams, Bynder and Cloudinary.

Galley fits a static website in a Git repository kept by people who aren't developers: visual section building ([Arrange](/docs/editing/page-builder/)), AI editing, translations with Translation Memory and a Glossary, live Google rankings and keyword-gap intelligence, scheduled publishing, readable Proof, free open-source OIDC SSO, and Cloudflare-hosted [Galley Cloud](/cloud/) with real-time co-editing and zero per-seat fees.

## Can you move from one to the other?

Yes, but from Contentful it is a real migration, because the content has to come out of its database and become files.

Contentful's command-line tool exports a space with `contentful space export` (add `--download-assets` for the files) and writes the content types, entries, assets and locales as JSON. From there, someone has to turn each entry into a Markdown or JSON file, convert rich text, which Contentful stores as a JSON document, into Markdown, and change the site's templates to read files instead of calling the API. Comments, tasks, releases and workflows aren't in that export; Contentful lists them as available through its APIs. Galley has no importer for Contentful. Its only guided move is from WordPress, and that is new and in final checks. Once the content is files, run `npx galley-cms` in the site's folder.

The other way, from Galley to Contentful, means designing content types, writing the files into entries through Contentful's Management API, and rewriting the templates to fetch them.

## Three questions to ask before you choose a Contentful alternative

**Where does this content have to go?** If it is one website, files in the site's repository may be all it needs. If an app and a newsletter read it too, that is the job Contentful was built for.

**Who keeps the content model, and the code that fetches it, in step with the site?** Ask how much developer time a new field or a new kind of page takes, in either tool.

**What do you take with you if you leave?** With Contentful, a JSON export to turn into something your site can read. With Galley, the repository you already have. Know the answer for any tool before you need it.
