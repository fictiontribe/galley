---
title: "Galley vs Payload CMS: files in Git or a database"
description: Payload CMS runs inside your Next.js app and keeps content in a database you provide; Galley edits files in Git. Setup, AI, teams, when to choose Payload.
kind: versus
product: Payload
heading: Payload is a framework you build your CMS in. Galley reads the site you already have.
name: Galley and Payload
lead: Payload CMS is an MIT-licensed headless CMS and application framework that runs inside your Next.js app, over a database you provide, and is configured in TypeScript. Galley, also free and much newer, edits the files in your Git repository, with no database at all, and builds the assistant and the check into the editor.
published: "2026-11-25"
checked: November 2026
order: 8
draft: false
short:
  - Payload keeps your content in a database you provide (MongoDB, Postgres or SQLite), and the site reads it through Payload's APIs. Galley edits the Markdown, JSON and YAML files in your Git repository, and there is no database. Most of the other differences follow from that one.
  - Both are free. Payload is MIT-licensed and free to host yourself; its Enterprise plan has no public price (as of November 2026). Galley is Apache-2.0, with one edition. With either, you pay for your own hosting, and with Galley for your own AI key.
  - Payload is set up in code by a developer, with a Next.js app, a TypeScript config of collections and fields, a database with migrations, and file storage. Galley reads the site's framework, collections and fields as they already are.
  - Payload offers a free, open-source MCP plugin for your own app, and lists its AI features for editors on Enterprise pages, two of them marked as coming soon. Galley builds an assistant into the editor, holds every change your editors and its assistant make in a proof beside the live site, and lets other AI tools in over MCP, where they can publish unless that is switched off.
  - Choose Payload if you're building an application, or content that also feeds apps, and want field-level access control, scheduled publishing and unlimited locales, free and today. Galley was first released in November 2026 and has none of those.
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
      ours: Free. Your AI key and hosting are yours
      theirs: Free (MIT); Enterprise price not public (Nov 2026)
      better: even
    - label: Setup
      ours: Reads the site as it is
      theirs: A Next.js app, config and database (create-payload-app starts them)
      better: ours
    - label: Behind the live site
      ours: Static pages; no database
      theirs: Usually the Next.js app that runs Payload, and its database
      better: ours
    - label: Editing
      ours: A form, the page itself, or the assistant
      theirs: An admin panel built from your fields (its pages differ on visual editing)
      better: even
    - label: Page building
      ours: The site's own sections (preview)
      theirs: Blocks fields a developer defines
      better: theirs
    - label: AI in the editor
      ours: An assistant that never publishes
      theirs: On Enterprise pages; two coming soon (Nov 2026)
      better: ours
    - label: Checking a change
      ours: Each change in the site's words, beside the live site
      theirs: Drafts, Live Preview, version diffs and restore
      better: even
    - label: Scheduling and languages
      ours: No scheduled publishing or multi-locale workflow
      theirs: Scheduled publishing and unlimited locales, free
      better: theirs
    - label: Teams
      ours: Three roles on a hosted editor (new); they organise work, not security
      theirs: Field-level access in code; SSO on Enterprise
      better: theirs
    - label: Content for apps
      ours: None; the site's build reads the files
      theirs: REST, GraphQL and a Local API
      better: theirs
    - label: Maturity
      ours: First released November 2026
      theirs: Started in 2018; about 46,000 GitHub stars (Nov 2026)
      better: theirs
faq:
  - q: Is Galley an alternative to Payload?
    a: For some sites. If you have a static site and want its editors to change the words, Galley does that with no database, little setup and an assistant built in. If you're building an application, or content that feeds apps, Payload is the better fit. It's a full backend with an API, field-level access control, scheduled publishing and unlimited locales, all free.
  - q: Is Payload CMS free?
    a: Yes. Payload is open source under the MIT licence and free to host yourself. Its Enterprise plan, with dedicated support and features such as single sign-on, has no public price as of November 2026. You still pay for somewhere to run a Node.js app, a database and file storage. Galley is free too, and its assistant uses your own Anthropic key.
  - q: Does Payload CMS need a database?
    a: Yes. Payload officially supports MongoDB, Postgres and SQLite through adapters, and you provide the database. If your Next.js pages are generated statically and read content through Payload's Local API, the build needs a database connection as well, unless you change how you build. Galley has no database. The content is the files in your Git repository, and the site's build reads them.
  - q: Does Payload have AI features or an MCP server?
    a: "Both, in different places. A free, open-source plugin adds an MCP server to your own Payload app, with permissions set per collection. Its AI features for editors are on its Enterprise pages, with no price: translations, image generation and a writing assistant, the last two marked \"COMING SOON\" (November 2026). Galley's assistant is built into the free editor and never publishes."
  - q: How does Payload compare with Strapi and Sanity?
    a: All three are headless. The content sits in a database and reaches the site through an API. Payload and Strapi are open source under MIT and can run on your own servers, while Sanity hosts its content database for you. Payload publishes its own comparison with each, and both make the case that it is native to Next.js. Galley is another kind of CMS that edits files in Git.
  - q: Can Galley edit a site built with Payload?
    a: Not its content. Galley edits files in a Git repository, and a Payload site keeps its words in a database, so there is nothing for Galley to change until the content has been moved into files. Galley has no importer for Payload. Its only guided move is from WordPress, and that is new and still in final checks.
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
  - label: "Galley, the tour: what is built and what isn't yet"
    href: /tour/
  - label: "Galley over MCP"
    href: /docs/integrations/mcp/
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

The free card says: "Deploy it anywhere you can run a Node.js app — for free, forever." Enterprise is reached through "Get a Demo" or "Talk to Sales", and the page shows no price, user count or usage limit for either tier. Payload's own hosting, Payload Cloud, says "Although deployment of new projects is currently paused, existing Cloud projects will continue running as normal." Those details are from [Payload's pricing page](https://payloadcms.com/get-started) and its [Payload Cloud page](https://payloadcms.com/payload-has-joined-figma); check them before you decide.

Galley is Apache-2.0, with one edition and no paid tier today. The assistant runs on Anthropic's Claude with your own key, and each request is billed to whoever owns that key.

Neither bill stops at the licence. Payload's deployment guide says "most Payload projects will also need a database, file storage, an email provider, and a CDN". A Galley site needs somewhere to serve static files, which is often free or cheap.

## What does a developer have to set up?

With Payload, the CMS itself, which is the point of it. The installation guide lists the Next.js versions it supports and warns: "Not all Next.js 15/16 releases are compatible". `npx create-payload-app` scaffolds a new project. To add Payload to an existing app, a developer installs Payload and a database adapter, copies Payload's route files into the app's `/app` folder, wraps the Next.js config with `withPayload`, and writes `payload.config.ts`. Then come the collections and their fields, in TypeScript, and the admin panel follows from them.

A working project needs a little more. With Postgres or SQLite, migrations "will be required for non-development database environments". Types are generated with `payload generate:types`. Live Preview needs a little code in the front end: a hook, or for the Next.js App Router a component Payload provides. Scheduled publishing needs the app set up to run background jobs, or the jobs "will never be executed." That's no complaint: in a code-first framework the content model lives in code, typed and versioned with the app.

Galley starts by reading the site. It works out the framework, the collections and every field's type from the site's own schemas and files, without running its code. Astro fits deepest; Docusaurus, Nuxt, Next.js, SvelteKit, Eleventy, Hugo and Jekyll are recognised by their conventions. A `galley.config.json` file exists only to correct what it found, and editing on the page needs no markup.

The caveats on our side: detection is only as good as the site is tidy. And Galley edits files only, so a Next.js site whose words are in Payload's database gives it nothing to edit.

## How does each one use AI?

Payload's home page calls it "The Agentic Content Framework". We think what is free today is mostly for developers.

Its [MCP plugin](https://payloadcms.com/docs/plugins/mcp), whose docs say "This plugin is completely open-source", adds an MCP server to your own Payload app at `/api/mcp`. You allow or disallow find, create, update and delete for each collection. By default, every request needs an API key, and Payload's access rules still apply to the key's user. Payload's post announcing the 4.0 beta, in October 2026, says: "We've rebuilt our MCP integration to work out of the box with significantly less configuration."

Payload's other AI features are on its Enterprise pages, which show no price and offer a demo. The Enterprise AI page names three: AI-Translations, AI-Image Generation and AI-Writing Assistant. The second and third are marked "COMING SOON", and the page doesn't say whether translations are available now. A separate page, AI Auto-Embedding, describes breaking your content into chunks and storing vector embeddings of them in your own database, for retrieval-augmented generation. We found no page for any of these in Payload's current (3.x) documentation.

Galley puts the assistant inside the editor, beside the page. You ask in plain words, and it reads the site before it edits. In content mode it can touch only content and media, and it has no shell or network tool. It never publishes: every change it makes waits in the proof, and a person presses Publish. For people who'd rather use their own AI tool, [Galley's MCP server](/docs/integrations/mcp/) gives Claude Desktop, Claude Code, Cursor, VS Code or any MCP client the assistant's tools for reading and changing the site. Unlike the assistant, such a tool can also publish (its instructions say only when you ask) unless publishing over MCP is switched off.

We think Payload's approach suits developers who want AI tools working against a typed backend, under permissions they write. We think it does less, today, for an editor who wants to ask for a change in plain words and see exactly what changed before it goes live. That's our view, and it's what Galley is built around.

## How do you check a change before it goes live?

Payload has the pieces, free, once a developer turns them on; its docs call versions "totally opt-in". With drafts on, Save becomes a choice between saving a draft and publishing, and each document shows as Draft, Published or Changed. Autosave keeps changes as a new draft while you work. Live Preview shows your front end inside the admin panel: "As you type, your changes take effect in real-time." Versions keep each document's history, show the differences between versions and restore an earlier one. Scheduled publishing puts a document live, or back to draft, at a set time. On Enterprise, Publishing Workflows add what the page calls "multi-step approval processes".

In Galley every change, whether typed in the form, retyped on the page or made by the assistant, lands in [Proof](/how-to/proof-and-publish/): the change in the site's own words, old text struck out and new text written in, beside the live site. Any single change can be put back. Publishing is a commit to your repository, or a branch and a pull request if the site is set up for review. Undo is a new commit, and history is never rewritten.

Payload shows the changed document and the page in a preview, with the history inside the CMS. Galley shows what changed on the page, in the site's own words, and the history is your Git log.

## How does the site get its content?

Payload's docs list three APIs. The Local API is "Direct-to-database access with no HTTP overhead — call payload.find from any server context, including React Server Components." There is also a REST API at `/api`, and GraphQL.

One detail matters for static sites. When Next.js generates pages statically, which is the default, and they read Payload's Local API, the build needs a database connection. The docs offer two ways round it: generate the pages later, when a connection is available, or turn static generation off, which "will disable static optimization and your site will be slower."

Payload "can be deployed anywhere that Next.js can run", and one-click templates put it on Vercel or Cloudflare with a database and file storage. In Payload's website template, the admin panel and the site are one app. Payload Cloud's new-project page says "Project creation is only available for Enterprise teams."

With Galley there's nothing to ask: the site's build reads the files. Galley doesn't host anything. It publishes to your repository, and your host builds from there. It can put a site online on Cloudflare, and that is verified on the real service; attaching a new domain of your own there has so far been tested only against stand-ins. Deploys to Vercel are built but still in progress.

## Which one suits a team?

Payload, today, by a distance. In the free edition, access control is code you write for each collection, global and field, and for each operation. Roles aren't a fixed list: the docs have you add a `roles` field and check it. Versions keep "an audit log / history of every change ever made to a document, including monitoring for what user made which change". Document locking "ensures that only one user at a time can edit a document", and anyone else can view it read-only or take over. "There are no limits to the number of locales you can add to your Payload project", and the admin panel is "translated in over 30 languages".

Its Enterprise page lists single sign-on through SAML or OAuth 2.0, Publishing Workflows with approvals and notifications, and "Audit Logs & Version Control". The Enterprise page lists real-time "Multi-Player Editing", marked "Coming Soon". It also describes an on-page visual editor, but Payload's own pages differ on whether that is available, so we leave it out of this comparison.

Galley is behind here. Used on your own computer, it has no accounts: anyone who can open the app can publish, so the gate is pull-request mode and your code host's branch protection. A hosted editor, one site per install on a server you run, adds accounts with three roles (owner, editor and contributor), and each publish carries its author's name. The roles keep people out of each other's way; they aren't a security boundary. That hosted editor is new and still in final checks, and single sign-on is planned for later. Everyone on one hosted editor works on one shared copy of the site; a second save of a page someone has just changed is refused, not written over it. There is no live presence.

## Where does Galley fall short?

Against a framework this size, in several places.

- **It's young.** Version {version} of software first released in November 2026. Payload's team started building it in 2018, and the project published two releases on 24 November 2026 alone.
- **No content for apps.** Galley has no content API. If an app needs the same words, Payload serves them and Galley doesn't.
- **No scheduled publishing, no multi-locale workflow.** Payload has scheduled publishing and unlimited locales in its free edition.
- **Page building is in preview.** Galley builds pages from the site's own sections, and that part is still in preview. Payload's Blocks field suits page builders, with blocks a developer defines.
- **No support contract.** Help with Galley comes through the project's issues on GitHub. Payload's Enterprise plan includes dedicated support.
- **The assistant needs a key, and it's billed to you.** Everything except chat and image generation works without one.

## When is Payload the better choice?

When you're building an application, not only a website: accounts, orders, an internal tool, or content an app reads too. When you need field-level permissions, scheduled publishing or many languages, free, this month. When your team builds in Next.js and wants the backend in the same codebase. Payload's own docs put it bluntly: "If you're building a website and your frontend is on Next.js, then Payload is a no-brainer." When you need single sign-on, approval workflows and someone to call, which Enterprise offers. And when you'd rather adopt a project with years of releases and a large community than a new one.

Galley fits when the site is static, the content is the website, and the people who change it aren't developers. They can ask for a change, see exactly what changed and publish it, with no content model to write first and no database behind the site.

## Can you move from one to the other?

Yes, with work, because the content changes shape.

From Payload to Galley, the content has to come out of the database and into files. Payload's free Import Export plugin exports collections as CSV or JSON, and rich text, stored as JSON, can be converted to Markdown with a function Payload documents. Uploads are already in your own storage. Someone then writes the files in the shape the site's build reads, and rewrites the pages that asked Payload for content. Galley has no importer for Payload; the only guided move into Galley is from WordPress, and it is new, still in final checks.

From Galley to Payload, a developer defines the collections in a Payload config, brings the files' content in (the same plugin imports collection data), and changes the site to read from Payload.

## Three questions to ask before you choose

**Do you need a backend, or an editor?** If the project has users, orders or apps to feed, you need the first, and we think Payload is one of the strongest open-source answers. If it's a website that already works, ask whether you need a database at all.

**Who changes the words, and what do they see before it's live?** Watch an editor make one change, from the request to the live page.

**What runs in production, and who looks after it?** A database, its migrations and backups, file storage, a jobs runner: each is a standing chore with somebody's name on it. Know whose before you choose.
