---
title: "Galley vs Strapi: a Git-based Strapi alternative"
description: "Strapi or Galley? Strapi runs a Node server over your database; Galley edits files in Git. Setup, AI, translations, search intelligence, teams, price, and when Strapi is the better choice."
kind: versus
product: Strapi
heading: Strapi and Galley are both open source. They disagree about where your words should live.
name: Galley and Strapi
lead: Strapi is a headless CMS you run as a Node server over your own SQL database, or on Strapi Cloud, and your site fetches the content through its APIs. Galley is an open-source Strapi alternative for static sites (with optional managed hosting on Galley Cloud) that edits the files in your Git repository and needs nothing running behind the live site.
published: "2026-11-25"
updated: "2026-11-27"
checked: November 2026
order: 6
draft: false
short:
  - Strapi is headless. The content sits in a SQL database that you run, or that Strapi Cloud runs, and your site asks for it through REST or GraphQL. Galley is Git-based. The content stays as files in your repository, and every publish is a commit.
  - "Both are open source. Strapi's Community edition is free under MIT, with unlimited users; Growth is $45 a month for three users, Strapi Cloud starts at $35 a month per project, and Enterprise is priced on request (as of November 2026). Galley is free under Apache-2.0 to run locally or self-host; [Galley Cloud](/cloud/) (opening by invitation) hosts both editor and site on Cloudflare's edge with monthly AI credits and no per-seat fees, from $35 a month per site."
  - Strapi asks a developer to model the content, keep a Node server running and build a front end that fetches from its API. Galley reads the site's framework, collections and fields as they already are.
  - Strapi's AI is Strapi AI on the Growth plan, for content models, translation and alt text (or a paid add-on on Enterprise), plus a free MCP server for outside agents. Galley builds an assistant that never publishes, multilingual AI translation (with Translation Memory and a Glossary), and Search and AI intelligence into the editor, holds every change in Proof, and offers an MCP server.
  - Choose Strapi if the same content must feed apps as well as a website, or your team needs free per-field and per-locale permissions, scheduled Releases, multi-stage Review Workflows, audit logs and SOC 2 today. Galley was first released in November 2026 and has no content API, scheduled Releases, field-level ACLs or SOC 2 badge yet.
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
      ours: Free, Apache-2.0; optional Galley Cloud from $35/mo, no per-seat fees
      theirs: Community free (self-hosted); Growth $45/mo for 3 users; Cloud from $35/mo (Nov 2026)
      better: even
    - label: Setup
      ours: Reads the site as it is
      theirs: A model (its builder or Strapi AI drafts it), a server, a front end
      better: ours
    - label: Editing
      ours: A form, the page itself, or the assistant
      theirs: Forms; on-page editing on Growth (experimental)
      better: ours
    - label: AI & search intelligence
      ours: Assistant that never publishes, AI translations, SEO/rankings intelligence, MCP
      theirs: Strapi AI on Growth; a free MCP server
      better: ours
    - label: Checking a change
      ours: Every change marked up beside the live site
      theirs: Drafts, Preview, Live Preview and Content History
      better: even
    - label: Scheduled publishing
      ours: None
      theirs: Releases, on Growth
      better: theirs
    - label: Languages
      ours: Built-in i18n, side-by-side editing, AI translation with memory and glossary
      theirs: Unlimited locales, free; AI translation on Growth
      better: even
    - label: Roles, SSO & collaboration
      ours: Three roles + free OIDC SSO (new) self-hosted; live co-editing on Cloud
      theirs: Free per-field/locale roles; Review Workflows on Enterprise; SSO paid add-on
      better: theirs
    - label: Content for apps
      ours: Not its job
      theirs: REST and GraphQL APIs
      better: theirs
    - label: Maturity
      ours: First released November 2026; no SOC 2 yet
      theirs: On GitHub since 2015; SOC 2 certified
      better: theirs
faq:
  - q: Is Galley an alternative to Strapi?
    a: For a static website, often yes. Strapi keeps content in a database behind a Node server and serves it through REST and GraphQL APIs. Galley edits the content files in your Git repository, needs nothing running behind the live site, and builds in an AI assistant, multilingual translation and search intelligence (free to self-host, or managed on [Galley Cloud](/cloud/)). Strapi stays the better fit when content must also reach mobile apps, or a team needs per-field/per-locale permissions, scheduled Releases and multi-stage Review Workflows.
  - q: Is Strapi free?
    a: Its Community edition is free and open source under MIT, with unlimited users, and costs nothing when you host it yourself. As of November 2026, Growth is $45 a month with three users, Enterprise is priced on request, and Strapi Cloud hosting starts at $35 a month per project, or $348 a year, with no free Cloud plan. Galley is free under Apache-2.0 to run locally or self-host (including OIDC SSO, new, using your own AI key); [Galley Cloud](/cloud/) (opening by invitation) hosts both editor and static site on Cloudflare's edge from $35 a month per site ($99 on Agency for five sites), with monthly AI credits and no per-seat fees.
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

If you are weighing Sanity vs Strapi, it's the same question asked another way. Sanity's Studio connects to Sanity's hosted Content Lake, so Sanity keeps the content. Strapi keeps it in a database you run, or one Strapi Cloud runs for you. Galley keeps it in neither.

The main consequence: with Strapi, something has to keep running. Its FAQ says Strapi "is not well suited for serverless environments" and is "designed to run as an always-on service". A static site can be built from Strapi's API ahead of time, so visitors never reach Strapi, but the editors and every rebuild still need the server and its database. Galley needs nothing behind the live site. Its editor runs on your computer (`npx galley-cms` or the Apple-signed macOS desktop app), on your own server with Docker (`ghcr.io/fictiontribe/galley`), or hosted on [Galley Cloud](/cloud/).

## How much does Strapi cost, and how much does Galley?

Strapi has two price lists, because, in its documentation's words, "The CMS plan and the hosting of a project are 2 separate choices." The CMS plan decides the features. As of November 2026:

| Plan | Price | Admin users | What it adds |
| --- | --- | --- | --- |
| Community | Free | Unlimited | The open-source core, with roles, languages and Draft & Publish |
| Growth | $45 a month, paid monthly | 3, then $15 a month each | Strapi AI Growth, Live Preview, Releases, Content History |
| Enterprise | On request, yearly | At least 10, self-hosted | Single sign-on, Review Workflows, Audit Logs; its AI is an add-on |

Single sign-on is also an add-on to Growth, from $150 a month. Growth has a 30-day free trial. The Community edition is MIT-licensed; code in the repository's `ee/` folders is the Enterprise Edition, under its own licence.

Hosting is the second choice. Any plan can run on your own server. Or you pay for Strapi Cloud, per project: Starter is $35 a month, Pro $90 and Business $450, or $348, $900 and $4,500 paid yearly. Use beyond a plan's allowance is billed. There is no free Cloud plan, and a Cloud plan doesn't include the paid CMS features: Strapi's documentation says those "require a CMS license key added to the Cloud project", so Releases on Strapi Cloud means paying for both. Check Strapi's [CMS pricing](https://strapi.io/pricing-cms) and [Cloud pricing](https://strapi.io/pricing-cloud) pages before you decide; plans change.

Strapi's free edition is generous, with unlimited users, roles and locales. What it costs is the server, and someone's time to keep it patched.

Galley is free and Apache-2.0 to run locally or self-host on your own server (including OIDC single sign-on, new, in final checks), bringing your own AI key and static hosting. For managed hosting with no keys to paste, [Galley Cloud](/cloud/) (opening by invitation) combines both the editor and Cloudflare edge hosting for the published site on one bill, with monthly AI credits and Search and AI intelligence included and **no per-seat fees** (up to 500 named people per workspace, 100 per site): Partner is $0 a month for agencies whose clients pay directly, Site is $35 a month, Agency is $99 a month (5 live sites included, then $15–$12 per extra site), and Business is $149 a month.

## What does a developer have to set up?

For Strapi, quite a lot, and it buys a lot.

A project starts with `npx create-strapi@latest`, a supported Node.js version and a database. Content types are designed in the admin panel's Content-type Builder, or with `strapi generate`. The builder is "Available in Development environment only", and Strapi's FAQ says there is "no plan to allow model creating or updating while in a production environment". So a new field is a code change, committed and deployed. Content types are private by default, so someone sets permissions or API tokens before a site can read them.

Then the front end. Strapi doesn't build pages, so a developer writes the code that fetches the content, and sets up a webhook to start a rebuild. Preview needs a handler in `config/admin`, the front end's address in an environment variable (and a secret for Next.js draft mode), and a front end that can show drafts. Double-click editing in Live Preview, on Growth, needs a script in the front end and works only through the REST API. Last, the server: yours, or Strapi Cloud, which deploys from a GitHub or GitLab repository.

In return, Strapi is a framework as much as a CMS. Its home page says you can "Write custom controllers, services, and middleware on the backend, and reshape the admin panel on the front". Its marketplace listed 391 packages when we looked, in November 2026.

Galley starts by reading the site. It works out the framework, the content collections and every field's type from the site's own schemas and files, without running any of its code. Astro fits deepest: Galley reads the content config and its schemas. Docusaurus, Nuxt, Next.js, SvelteKit, Eleventy, Hugo and Jekyll are recognised by their conventions. A `galley.config.json` file exists only to correct what it found. Editing on the page needs no markup, because Galley maps the words in the preview back to their fields.

The honest caveat on our side: detection is only as good as the site is tidy. A site whose copy is hard-coded in components gets a thinner form until someone moves the words into content files.

## How does each one use AI, translations and search intelligence?

Strapi AI Growth, included in the Growth plan, runs on Strapi's own AI service with 1,000 credits a month (more at $1.50 per 100). It does three things: a chat assistant that designs content types from plain words, existing code, a Figma project or an image; translation of an entry into the other locales on save; and alt text and captions for images. Strapi AI Enterprise, a paid add-on to Enterprise, runs on your own AI provider and covers the last two. The free Community plan has no Strapi AI.

The MCP server is free on every plan, and off until you switch it on. Then tools such as Claude Code, Codex or Cursor can create, read, update, delete, publish and unpublish entries, within the permissions of the Admin token they use. A token can be held to particular content types, fields and locales, and on Enterprise each change an agent makes to an entry goes into the audit logs. Strapi's AI page adds: "Review workflows apply to their changes too." Review Workflows are an Enterprise feature.

Galley includes AI editing, multilingual translation, image/video generation and Search and AI intelligence across both its free open-source edition and [Galley Cloud](/cloud/):

- **The built-in assistant.** Ask in plain words beside the page; it reads the site before it edits, asks one short question when a request is ambiguous, touches only content and media in content mode, has no shell or network tool, and never publishes. Image and short video generation run across OpenAI, Google Gemini and OpenRouter models.
- **Multilingual (`i18n`) translation.** Configure target languages, localized URL slugs, `hreflang` alternates and Astro `<LanguageSelector />` / `<LocaleHead />` components; translate side by side (with automatic out-of-sync flags when the source page changes) or translate individual pages or the whole site with AI using a Git-tracked Translation Memory, a Glossary and a clear upfront cost estimate — every translated page waiting in Proof.
- **Search and AI intelligence.** On-site SEO and structured-data checks, Markdown twins, `llms.txt`, per-AI-crawler `robots.txt` controls, live Google search rankings, striking-distance (`#4–#15`) quick wins, keyword research, competitor content gaps, broken-404 backlink recovery with one-click redirects, and AI search answer citations — included on Galley Cloud (at zero AI credits for lookups) or self-hosted with your own search data key.
- **MCP server.** [Galley's MCP server](/docs/integrations/mcp/) gives Claude Desktop, Claude Code, Cursor, VS Code or any MCP client the assistant's tools for reading and changing the site, waiting in Proof. Unlike the assistant, such a tool can also publish (its instructions say only when you ask) unless publishing over MCP is switched off. Galley does not check that a person asked.

We think Strapi's MCP server is the finer-grained door for agents, because of those per-field and per-locale token permissions. We also think the AI that changes the words belongs beside the person who knows what the page should say, with a check a non-developer can read before anything is live.

## How do you check a change before it goes live?

In Strapi, Draft & Publish keeps a draft beside the published version until someone publishes it, on every plan. Preview shows the draft in your own front end, full screen on the free plan. Live Preview, on Growth, puts it beside the edit form and lets you double-click content to edit it there; Strapi marks it experimental. Content History, on Growth, keeps earlier versions for 14 days to compare and restore. Enterprise adds Review Workflows: stages, assigned reviewers, stages only some roles can change, and a stage an entry must reach before it can be published.

In Galley every change, whether typed in the form, retyped on the page, translated or made by the assistant, lands in [Proof](/how-to/proof-and-publish/): the change in the site's own words, old text struck out and new text written in, beside the live site. Any single change can be put back. Publishing is a commit to your repository, or a branch and a pull request if the site is set up for review. Undo is a new commit, and history is never rewritten. On Galley Cloud, teams can also share preview links for unpublished changes and roll back to an earlier version instantly without rebuilding.

The difference is what the reviewer sees. Strapi shows the entry and the page it makes; Galley shows what changed, in the site's own words. For sign-off in several stages, Strapi Enterprise has the tools, and Galley has Proof and pull requests.

## How does the site get its content?

From Strapi, through its API. A static site fetches at build time and rebuilds when a webhook fires; a site rendered on a server can ask on every request. Images and files are stored on the server by default, or in Amazon S3 or Cloudinary through a provider. Strapi Cloud includes a PostgreSQL database, a CDN and email. Either way, the website itself is a separate front end, hosted where you choose.

In Galley, the site's build reads the files, and your host builds it after each commit — or deploys directly to Cloudflare (verified on the real service; Vercel deploys are in progress). External media buckets support Cloudflare R2 (verified on the real service), Amazon S3 / S3-compatible stores and Cloudflare Images (in progress). On [Galley Cloud](/cloud/) (opening by invitation), the published site is served straight from Cloudflare's global edge with automatic SSL, custom domains in one DNS record, and nightly backups kept 30–90 days.

## Which one suits a team?

Strapi wins on fine-grained access control, scheduled Releases and multi-stage workflows; Galley wins on real-time collaboration and free OIDC SSO.

In Strapi, on the free plan, roles are unlimited, and a role can be allowed to create, read, update, delete or publish each content type, per field and per locale, with conditions such as being the entry's creator. Languages are free too, with unlimited locales. Growth adds Releases, which publish a group of entries together, by hand or at a set time. Enterprise adds Review Workflows, audit logs kept for 90 days by default, single sign-on (or a $150/mo add-on on Growth) and a SOC 2 report. We found no live co-editing or presence in Strapi's documentation (November 2026).

In Galley:

- **Free OIDC SSO self-hosted:** A [hosted editor](/docs/running/hosted/) (`ghcr.io/fictiontribe/galley`, one isolated container per site) adds owner, editor and contributor accounts plus **OpenID Connect (OIDC) single sign-on** (new, in final checks — Authorization Code with PKCE, IdP role-claim mapping, `GALLEY_OIDC_ONLY`, Back-Channel Logout) built into the Apache-2.0 image; see [`/enterprise/`](/enterprise/). On self-hosted installs, editors share one copy and a conflicting save is refused rather than overwritten; roles organize work while the container is the security boundary.
- **Real-time collaboration on [Galley Cloud](/cloud/):** Teammates see faces in the top bar and page list, active field outlines with each person's name, simultaneous typing in Markdown body text, and per-author Proof — with **no per-seat fees** (up to 500 named people per workspace, 100 per site).

## Where does Galley fall short?

Beyond granular RBAC, in clear places:

- **It's young.** Version {version} of software first released in November 2026, with no SOC 2 report yet. Strapi's repository dates from 2015.
- **No content API.** If an app or a second site needs the same content, Galley can't serve it. Strapi is built for that.
- **No scheduled Releases, field-level ACLs or multi-stage Review Workflows.** Strapi offers free per-field/per-locale permissions, Releases on Growth, and Review Workflows and audit logs on Enterprise.
- **Page building is in preview.** Galley builds pages from the site's own sections, and that part is still in preview. Strapi's dynamic zones let editors rearrange page structure today.
- **Galley Cloud is opening by invitation.** Self-hosted and local installs are available today (help via GitHub issues; self-hosted AI uses your own keys).

## When is Strapi the better choice?

When the same content feeds a website, an app and other screens. When your team needs permissions per field and per locale without paying for them. When you need scheduled Releases, multi-stage Review Workflows, 90-day audit logs and a SOC 2 report. When the site is rendered on a server and should ask for content live. When your developers want a backend they can extend with custom controllers, middleware and marketplace plugins. And when you'd rather keep content in a SQL database you run than in Git.

Galley fits when the site is static, the people who change it aren't developers, and you want them to ask for a change, translate pages with Translation Memory and a Glossary, check live search rankings, see every edit in Proof and publish — with no database or Node server behind the live site, free OIDC SSO self-hosted, or Cloudflare-hosted [Galley Cloud](/cloud/) with real-time collaboration and no per-seat fees.

## Can you move from Strapi to Galley?

Yes, with real work, because the content has to come out of the database and become files. Strapi's `strapi export` command writes the entries, their relations and the schemas as JSON Lines files, with the files from its uploads folder, in an archive, or since version 5.42 in a plain folder. Admin users and API tokens are left out. A developer then writes a script that turns each entry into a Markdown or JSON file, moves the media into the repository, and changes the front end to read those files instead of calling the API.

Galley has no importer for Strapi. Its only guided move is from [WordPress](/wordpress/), and that is new and in final checks. Going the other way is also a project: model the content types in Strapi, load the entries through its API, and change the front end to fetch them.

## Three questions to ask before you choose

**Does the content have to reach anything but this website?** If an app needs it, you want an API, and Strapi has a good one. If not, you may not need one.

**Who runs the server, and who patches it?** With Strapi that is a Node server and a database, or a Strapi Cloud bill. Each has somebody's name on it.

**When the AI makes a change, who sees it before it is live, and in what form?** Ask what a marketer sees, not only what a token may do.
