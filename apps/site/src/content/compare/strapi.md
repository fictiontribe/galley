---
title: "Galley vs Strapi: a Git-based Strapi alternative"
description: "Strapi or Galley? Strapi runs a Node server over your database; Galley edits files in Git. Setup, page building, AI, scheduling, SSO, search intelligence, teams, price, and when Strapi wins."
kind: versus
product: Strapi
heading: Strapi and Galley are both open source. They disagree about where your words should live.
name: Galley and Strapi
lead: Strapi is a headless CMS you run as a Node server over your own SQL database, or on Strapi Cloud, and your site fetches the content through its APIs. Galley is an AI-first, open-source Strapi alternative for static sites (with optional managed hosting on Galley Cloud) that edits the files in your Git repository, needs nothing running behind the live site, and builds in visual section building, AI, translations, search intelligence, scheduled publishing and free OIDC SSO.
published: "2026-11-25"
updated: "2026-11-28"
checked: November 2026
order: 6
draft: false
short:
  - Strapi is headless. The content sits in a SQL database that you run, or that Strapi Cloud runs, and your site asks for it through REST or GraphQL. Galley is Git-based. The content stays as files in your repository, and every publish is a commit.
  - "Both are open source, but Strapi requires an always-on Node server and SQL database (Growth is $45/mo for 3 users; Strapi Cloud starts at $35/mo separately, without website hosting). Galley is free under Apache-2.0 with nothing running behind the live site; [Galley Cloud](/cloud/) (opening by invitation) hosts both editor and static site on Cloudflare's edge with monthly AI credits and no per-seat fees, from $35 a month per site."
  - Strapi asks a developer to model the content, keep a Node server running and build a front end that fetches from its API. Galley reads the site as it is and gives editors on-page editing and the visual [Arrange](/docs/editing/page-builder/) page builder directly on static pages.
  - "Galley is AI-first on every edition: a page-aware assistant that never publishes, multi-provider image and short video generation, whole-site AI translations with a Git-tracked Translation Memory and Glossary, built-in live Google rankings and keyword-gap intelligence, `llms.txt` and Markdown twins, scheduled publishing, and MCP — whereas Strapi gates Strapi AI, Releases and Content History to Growth."
  - Choose Strapi if the same content must feed mobile apps as well as a website, or your team needs free per-field and per-locale RBAC, multi-stage Review Workflows, 90-day audit logs and SOC 2 today.
table:
  heading: Galley and Strapi, side by side.
  text: Where Strapi does more, the table says so.
  caption: Galley compared with Strapi
  columns: [What differs, Galley, Strapi]
  rows:
    - label: Your content
      ours: Files in your Git repository
      theirs: Rows in your own SQL database
      better: even
    - label: What has to keep running
      ours: Nothing behind the live site; the editor runs when someone edits
      theirs: A Node server and its database, for editing and every build
      better: ours
    - label: Price
      ours: Free Apache-2.0 (no DB/Node server for live site); Cloud from $35/mo w/ site hosting & $0/seat
      theirs: Community free (needs Node + SQL server); Growth $45/mo + Cloud from $35/mo separately (Nov 2026)
      better: ours
    - label: Setup
      ours: Reads the site as it is
      theirs: A model (its builder or Strapi AI drafts it), a server, a front end
      better: ours
    - label: Page building & editing
      ours: Visual Arrange section builder, click-to-edit on the page, forms & assistant
      theirs: Dynamic zones in forms; Live Preview visual editing experimental on Growth
      better: ours
    - label: AI & search intelligence
      ours: AI-first — assistant (never publishes), image/video gen, AI translations w/ TM & glossary, live rankings/404 recovery, llms.txt, MCP
      theirs: Strapi AI gated to Growth; free MCP server; no live search rankings
      better: ours
    - label: Checking a change
      ours: Word-by-word Proof beside the live site, single-change undo, unlimited Git history
      theirs: Drafts & Preview; Live Preview & 14-day Content History gated to Growth
      better: ours
    - label: Scheduled publishing
      ours: Built in free (scheduler/CLI/publishAt) & pre-built edge deploys on every Cloud plan
      theirs: Releases gated to Growth
      better: ours
    - label: Languages
      ours: Built-in i18n, side-by-side editing, AI translation w/ TM & glossary on every edition
      theirs: Unlimited free locales; AI translation gated to Growth
      better: ours
    - label: Roles, SSO & collaboration
      ours: Free OIDC SSO in Apache-2.0 server + real-time co-editing & $0/seat on Cloud
      theirs: Free per-field/locale RBAC; Review Workflows on Enterprise; SSO $150/mo add-on; no live co-editing
      better: even
    - label: Content for apps
      ours: Built for websites; edits Git files
      theirs: REST and GraphQL APIs for mobile apps and any channel
      better: theirs
    - label: Maturity
      ours: First released November 2026; no SOC 2 yet
      theirs: On GitHub since 2015; SOC 2 certified
      better: theirs
faq:
  - q: Is Galley an alternative to Strapi?
    a: For a static website, yes. Strapi keeps content in a database behind an always-on Node server and serves it through REST and GraphQL APIs. Galley edits the content files in your Git repository, needs nothing running behind the live site, and builds in visual section building ([Arrange](/docs/editing/page-builder/)), AI editing, translations with Translation Memory, live search rankings, scheduled publishing and free OIDC SSO self-hosted (plus Cloudflare hosting and live co-editing on [Galley Cloud](/cloud/)). Strapi stays the better fit when content must also reach mobile apps, or a team needs free per-field/per-locale permissions, multi-stage Review Workflows and SOC 2 today.
  - q: Is Strapi free?
    a: Its Community edition is free and open source under MIT, with unlimited users, and costs nothing when you host it yourself (alongside a Node server and SQL database). As of November 2026, Growth is $45 a month with three users, Enterprise is priced on request, and Strapi Cloud hosting starts at $35 a month per project, or $348 a year, with no free Cloud plan. Galley is free under Apache-2.0 locally or self-hosted (including OIDC SSO, bringing your own AI key); [Galley Cloud](/cloud/) (opening by invitation) hosts both editor and static site on Cloudflare's edge from $35 a month per site ($99 on Agency for five sites), with monthly AI credits and no per-seat fees.
  - q: Does Strapi have AI features?
    a: Yes. As of November 2026, Strapi AI Growth, included in the Growth plan with 1,000 credits a month, helps design content types, translates entries into other locales on save, and writes alt text and captions. Enterprise can add its own AI provider for the last two. A free MCP server, off by default, lets AI tools create, edit and publish content within a token's permissions.
  - q: Does Strapi need a server running all the time?
    a: "Yes. Strapi's FAQ says it is \"designed to run as an always-on service\" and not well suited to serverless hosting. A static site can be built from its API ahead of time, so visitors never reach Strapi, but editors and every rebuild still need the server and its database. Galley needs nothing running behind the live site. Its editor runs on your computer, on your own server with Docker (`ghcr.io/fictiontribe/galley`), or hosted on [Galley Cloud](/cloud/)."
  - q: What is the difference between Sanity and Strapi?
    a: Mainly who runs the database. Sanity's open-source Studio connects to Sanity's hosted APIs and Content Lake, so Sanity holds the content. Strapi is open-source software you run yourself, with the content in your own SQL database, or on its paid Strapi Cloud. Both serve content to your site through APIs. Galley, which is Git-based, keeps the content as files in your repository.
  - q: Can Galley import content from Strapi?
    a: Not today. Galley has no importer for Strapi; its only guided move is from WordPress, and that is new and in final checks. Strapi's export command writes your entries and relations as JSON Lines files, with the uploaded media beside them, so a developer can script them into the Markdown or JSON files a static site reads, then point the site at those files.
sources:
  - label: "Strapi, home page"
    href: https://strapi.io/
  - label: "Strapi, CMS pricing"
    href: https://strapi.io/pricing-cms
  - label: "Strapi, Cloud pricing"
    href: https://strapi.io/pricing-cloud
  - label: "Strapi Cloud"
    href: https://strapi.io/cloud
  - label: "Strapi AI"
    href: https://strapi.io/ai
  - label: "Strapi, the MCP server is now generally available"
    href: https://strapi.io/blog/the-strapi-mcp-server-is-now-ga
  - label: "Strapi documentation, introduction"
    href: https://docs.strapi.io/cms/intro
  - label: "Strapi documentation, features and plans"
    href: https://docs.strapi.io/cms/features
  - label: "Strapi documentation, FAQ"
    href: https://docs.strapi.io/cms/faq
  - label: "Strapi documentation, database configuration"
    href: https://docs.strapi.io/cms/configurations/database
  - label: "Strapi documentation, installing from the CLI"
    href: https://docs.strapi.io/cms/installation/cli
  - label: "Strapi documentation, deployment"
    href: https://docs.strapi.io/cms/deployment
  - label: "Strapi documentation, models"
    href: https://docs.strapi.io/cms/backend-customization/models
  - label: "Strapi documentation, Content-type Builder"
    href: https://docs.strapi.io/cms/features/content-type-builder
  - label: "Strapi documentation, REST API"
    href: https://docs.strapi.io/cms/api/rest
  - label: "Strapi documentation, GraphQL plugin"
    href: https://docs.strapi.io/cms/plugins/graphql
  - label: "Strapi documentation, webhooks"
    href: https://docs.strapi.io/cms/backend-customization/webhooks
  - label: "Strapi documentation, Media Library"
    href: https://docs.strapi.io/cms/features/media-library
  - label: "Strapi documentation, Preview"
    href: https://docs.strapi.io/cms/features/preview
  - label: "Strapi documentation, MCP server"
    href: https://docs.strapi.io/cms/features/strapi-mcp-server
  - label: "Strapi documentation, AI for content managers"
    href: https://docs.strapi.io/cms/ai/for-content-managers
  - label: "Strapi documentation, Draft & Publish"
    href: https://docs.strapi.io/cms/features/draft-and-publish
  - label: "Strapi documentation, role-based access control"
    href: https://docs.strapi.io/cms/features/rbac
  - label: "Strapi documentation, Internationalization"
    href: https://docs.strapi.io/cms/features/internationalization
  - label: "Strapi documentation, Releases"
    href: https://docs.strapi.io/cms/features/releases
  - label: "Strapi documentation, Review Workflows"
    href: https://docs.strapi.io/cms/features/review-workflows
  - label: "Strapi documentation, Content History"
    href: https://docs.strapi.io/cms/features/content-history
  - label: "Strapi documentation, Audit Logs"
    href: https://docs.strapi.io/cms/features/audit-logs
  - label: "Strapi documentation, Single Sign-On"
    href: https://docs.strapi.io/cms/features/sso
  - label: "Strapi documentation, data export"
    href: https://docs.strapi.io/cms/features/data-management/export
  - label: "Strapi Cloud documentation, introduction"
    href: https://docs.strapi.io/cloud/intro
  - label: "Strapi Cloud documentation, fundamentals"
    href: https://docs.strapi.io/cloud/cloud-fundamentals
  - label: "Strapi Community Hub, Hugo integration"
    href: https://community.strapi.io/integrations/hugo-cms
  - label: "Strapi Community Hub, marketplace"
    href: https://community.strapi.io/marketplace
  - label: "Strapi on GitHub, licence"
    href: https://github.com/strapi/strapi/blob/main/LICENSE
  - label: "Sanity documentation, deploying the Studio"
    href: https://www.sanity.io/docs/studio/deployment
  - label: "Galley, the FAQ for developers"
    href: /docs/project/faq/
  - label: "Galley, page builder"
    href: /docs/editing/page-builder/
  - label: "Galley, languages"
    href: /docs/editing/languages/
  - label: "Galley over MCP"
    href: /docs/integrations/mcp/
  - label: "Galley, the tour: what is built and what isn't yet"
    href: /tour/
  - label: "Galley Cloud"
    href: /cloud/
  - label: "Galley for enterprise and security teams"
    href: /enterprise/
related: [payload, types-of-cms, cloudcannon]
---

## How do Galley and Strapi differ at the root?

In where the words live. Strapi's documentation calls Strapi 5 "an open-source headless CMS". It is a Node.js application you install and run, and the content goes into a SQL database you configure: SQLite, MySQL, MariaDB or PostgreSQL. Strapi creates REST endpoints for each content type, a plugin adds GraphQL, and your website or an app asks those APIs for the content. The content model is code, in `schema.json` files in the project; the entries are rows in the database.

Galley is [Git-based](/compare/types-of-cms/). The words of the site are the Markdown, JSON and YAML files in its repository, and Galley is a way to change them without a code editor. Publishing is a commit. There is no database.

The main consequence: with Strapi, something has to keep running. Its FAQ says Strapi "is not well suited for serverless environments" and is "designed to run as an always-on service". A static site can be built from Strapi's API ahead of time, so visitors never reach Strapi, but the editors and every rebuild still need the server and its database. Galley needs nothing behind the live site. Its editor runs on your computer (`npx galley-cms` or the Apple-signed macOS desktop app), on your own server with Docker (`ghcr.io/fictiontribe/galley`), or hosted on [Galley Cloud](/cloud/).

## How much does Strapi cost, and how much does Galley?

Strapi has two price lists, because, in its documentation's words, "The CMS plan and the hosting of a project are 2 separate choices." The CMS plan decides the features. As of November 2026:

| Plan | Price | Admin users | What it adds |
| --- | --- | --- | --- |
| Community | Free | Unlimited | The open-source core, with roles, languages and Draft & Publish |
| Growth | $45 a month, paid monthly | 3, then $15 a month each | Strapi AI Growth, Live Preview, Releases, Content History |
| Enterprise | On request, yearly | At least 10, self-hosted | Single sign-on, Review Workflows, Audit Logs; its AI is an add-on |

Single sign-on is also an add-on to Growth, from $150 a month. Growth has a 30-day free trial. The Community edition is MIT-licensed; code in the repository's `ee/` folders is the Enterprise Edition, under its own licence.

Hosting is the second choice. Any plan can run on your own server. Or you pay for Strapi Cloud, per project: Starter is $35 a month, Pro $90 and Business $450, or $348, $900 and $4,500 paid yearly. Use beyond a plan's allowance is billed. There is no free Cloud plan, and a Cloud plan doesn't include the paid CMS features: Strapi's documentation says those "require a CMS license key added to the Cloud project", so Releases on Strapi Cloud means paying for both, and you still host the website separately. Check Strapi's [CMS pricing](https://strapi.io/pricing-cms) and [Cloud pricing](https://strapi.io/pricing-cloud) pages before you decide; plans change.

Galley is free and Apache-2.0 to run locally or self-host on your own server — including OIDC single sign-on, visual section building, AI translations and scheduled publishing, with no Node/SQL server required behind your live static site. For managed hosting with no keys to paste, [Galley Cloud](/cloud/) (opening by invitation) combines both the editor and Cloudflare edge hosting for the published site on one bill, with monthly AI credits, pre-built scheduled publishing and Search and AI intelligence included and **no per-seat fees** (up to 500 named people per workspace, 100 per site): Partner is $0 a month for agencies whose clients pay directly, Site is $35 a month, Agency is $99 a month (5 live sites included, then $15–$12 per extra site), and Business is $149 a month.

## What does a developer have to set up, and how does page building work?

For Strapi, quite a lot, and it buys a lot. A project starts with `npx create-strapi@latest`, a supported Node.js version and a database. Content types are designed in the Content-type Builder (available in Development only, so a new field is a code change, committed and deployed). Content types are private by default, so someone sets permissions or API tokens before a site can read them. Then a developer writes front-end fetch code, webhooks and preview handlers; double-click editing in Live Preview is on Growth and marked experimental, and dynamic zones are edited in forms. In return, Strapi is a full Node backend with 391 marketplace packages (November 2026).

Galley starts by reading the site. It works out the framework, the content collections and every field's type from the site's own schemas and files, without running any of its code. Astro fits deepest; Docusaurus, Nuxt, Next.js, SvelteKit, Eleventy, Hugo and Jekyll are recognised by their conventions. A `galley.config.json` file exists only to correct what it found, editing on the page needs no markup, and Galley's visual [Arrange](/docs/editing/page-builder/) page builder lets editors visually select, drag, reorder, duplicate and drop new sections from a thumbnail palette directly onto static pages, toggle layout options live and undo safely — with zero SSR required.

The honest caveat on our side: detection is only as good as the site is tidy. A site whose copy is hard-coded in components gets a thinner form until someone moves the words into content files.

## How does each one use AI, translations and search intelligence?

Strapi AI Growth, included in the Growth plan, runs on Strapi's own AI service with 1,000 credits a month (more at $1.50 per 100). It designs content types, translates entries on save, and writes alt text and captions. Strapi AI Enterprise, a paid add-on to Enterprise, runs on your own AI provider and covers the last two. The free Community plan has no Strapi AI. Strapi's MCP server is free on every plan, with per-field and per-locale Admin token permissions.

Galley is AI-first across both its free open-source edition and [Galley Cloud](/cloud/):

- **Page-aware built-in assistant.** Ask in plain words beside the page; it reads the site before it edits, builds and arranges sections, reads brand and voice guidelines from your materials or live site, rebuilds WordPress imports, touches only content and media in content mode, has no shell or network tool, and **never publishes**.
- **Multi-provider image and short video generation.** Generate images and short video clips across OpenAI, Google Gemini and OpenRouter straight into the media library.
- **Whole-site and per-page AI translations.** Configure target languages, localized URL slugs, `hreflang` alternates and Astro `<LanguageSelector />` / `<LocaleHead />` components ([Languages](/docs/editing/languages/)); edit side by side with automatic out-of-sync flags when the source changes, or translate pages and entire sites with AI using a Git-tracked **Translation Memory** (0-credit reuse), a brand/product **Glossary** and an upfront cost estimate — every translated page waiting in Proof.
- **Built-in Search and AI intelligence.** On-site SEO and structured-data checks, one-click fixes into Proof, live Google search rankings, striking-distance (`#4–#15`) quick wins, keyword explorer, competitor content gaps, broken-404 backlink recovery with one-click redirects, and AI search answer citations — included on Galley Cloud (at zero AI credits for lookups) or self-hosted with your own search data key.
- **AI-first published output and MCP.** Publishes `llms.txt`, `llms-full.txt`, `agent.md`, Markdown twins of every page and per-AI-crawler `robots.txt` switches ([AI-first websites](/ai-first/)), plus [Galley's MCP server](/docs/integrations/mcp/) (publishing over MCP can be switched off).

Strapi's MCP server offers finer per-field and per-locale token scoping for programmatic agents. For website teams, Galley puts an AI-first editor, Translation Memory, live search intelligence and readable Proof directly in editors' hands without paying for Growth or Enterprise.

## How do you check a change and schedule publishing?

In Strapi, Draft & Publish keeps a draft beside the published version on every plan. Preview shows the draft full screen on the free plan; Live Preview (experimental), 14-day Content History and scheduled Releases are gated to Growth, and multi-stage Review Workflows are on Enterprise.

In Galley every change — typed in the form, retyped on the page, arranged visually, translated or made by the assistant — lands in [Proof](/how-to/proof-and-publish/): word-by-word markup beside the live site, where any single change can be put back and publishing is a commit or pull request with unlimited Git history.

Galley also includes **scheduled publishing** on both editions:

- **Open source (free):** Schedule changes directly from Proof for an exact date and time (published automatically by the server scheduler or `galley schedule` CLI while holding scheduled changes safely aside so you can keep editing other pages), alongside entry `publishAt` date/time matching and a one-click GitHub Actions scheduled build workflow for pure static sites.
- **Galley Cloud (every plan):** Pre-built scheduled versions are verified ahead of time with a shareable preview link and promoted live at Cloudflare's edge at the exact scheduled minute — even while the editor machine is asleep, with zero build delay at launch time — alongside instant version rollback without rebuilding.

For sign-off in multiple formal stages, Strapi Enterprise still has Review Workflows, while Galley uses Proof and pull requests.

## How does the site get its content?

From Strapi, through its API. A static site fetches at build time and rebuilds when a webhook fires; a site rendered on a server can ask on every request. Images and files are stored on the server by default, or in Amazon S3 or Cloudinary through a provider. Strapi Cloud includes a PostgreSQL database, a CDN and email. Either way, the website itself is a separate front end, hosted where you choose.

In Galley, the site's build reads the files, and your host builds it after each commit — or deploys directly to Cloudflare (verified on the real service; Vercel deploys are in progress). External media buckets support Cloudflare R2 (verified on the real service), Amazon S3 / S3-compatible stores and Cloudflare Images (in progress). On [Galley Cloud](/cloud/) (opening by invitation), the published site is served straight from Cloudflare's global edge with automatic SSL, custom domains in one DNS record, and nightly backups kept 30–90 days.

## Which one suits a team?

Each leads in a different area.

In Strapi, on the free plan, roles are unlimited and can be scoped per content type, per field and per locale, with conditions such as being the entry's creator. Enterprise adds Review Workflows, 90-day audit logs, single sign-on (also a $150/mo add-on on Growth) and a SOC 2 report. We found no live co-editing or presence in Strapi's documentation (November 2026).

In Galley:

- **Free OpenID Connect (OIDC) SSO self-hosted:** A [hosted editor](/docs/running/hosted/) (`ghcr.io/fictiontribe/galley`, one isolated container per site) adds owner, editor and contributor accounts plus OpenID Connect single sign-on (Authorization Code with PKCE, IdP role-claim mapping, `GALLEY_OIDC_ONLY`, Back-Channel Logout) built into the free Apache-2.0 server — without a $150/month add-on or Enterprise licence; see [`/enterprise/`](/enterprise/). On self-hosted installs, editors share one copy and a conflicting save is refused rather than overwritten; roles organize work while the container is the security boundary.
- **Real-time collaboration & zero per-seat fees on [Galley Cloud](/cloud/):** Teammates see faces in the top bar and page list, active field outlines with each person's name, simultaneous typing in Markdown body text, and per-author Proof — for up to 500 named people per workspace and 100 per site with **$0 per-seat fees**.

## Where does Galley fall short?

Beyond granular RBAC, in clear places:

- **No content API for apps.** If a mobile app or a second site needs the same content over REST or GraphQL, Strapi is built for that.
- **It's young.** Version {version} of software first released in November 2026, with no SOC 2 report yet. Strapi's repository dates from 2015.
- **No per-field/per-locale RBAC or multi-stage Review Workflows.** Strapi offers free field-level permissions and Enterprise Review Workflows and 90-day audit logs.
- **Galley Cloud is opening by invitation.** Self-hosted and local installs are available today (help via GitHub issues; self-hosted AI uses your own keys).

## When is Strapi the better choice?

When the same content feeds a website, a mobile app and other screens. When your team needs permissions per field and per locale without paying for them, or multi-stage Review Workflows, 90-day audit logs and a SOC 2 report. When the site is rendered on a server and should ask for content live. When your developers want a Node backend they can extend with custom controllers, middleware and marketplace plugins. And when you'd rather keep content in a SQL database you run than in Git.

Galley fits when the site is static, the people who change it aren't developers, and you want visual section building ([Arrange](/docs/editing/page-builder/)), AI editing, translations with Translation Memory and a Glossary, live Google rankings and keyword-gap intelligence, scheduled publishing, readable Proof, free OIDC SSO self-hosted, and Cloudflare-hosted [Galley Cloud](/cloud/) with real-time collaboration and no per-seat fees — with no database or Node server behind the live site.

## Can you move from Strapi to Galley?

Yes, with real work, because the content has to come out of the database and become files. Strapi's `strapi export` command writes the entries, their relations and the schemas as JSON Lines files, with the files from its uploads folder, in an archive, or since version 5.42 in a plain folder. Admin users and API tokens are left out. A developer then writes a script that turns each entry into a Markdown or JSON file, moves the media into the repository, and changes the front end to read those files instead of calling the API.

Galley has no importer for Strapi. Its only guided move is from [WordPress](/wordpress/), and that is new and in final checks. Going the other way is also a project: model the content types in Strapi, load the entries through its API, and change the front end to fetch them.

## Three questions to ask before you choose

**Does the content have to reach anything but this website?** If an app needs it, you want an API, and Strapi has a good one. If not, you may not need one.

**Who runs the server, and who patches it?** With Strapi that is a Node server and a database, or a Strapi Cloud bill. Each has somebody's name on it.

**When the AI makes a change, who sees it before it is live, and in what form?** Ask what a marketer sees, not only what a token may do.
