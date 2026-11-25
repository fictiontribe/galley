---
title: "Galley vs Sanity CMS: Git files or a Content Lake"
description: Sanity CMS keeps content in its hosted Content Lake; Galley keeps it as files in Git. Setup, AI, teams and price, and when Sanity is the better choice.
kind: versus
product: Sanity
heading: Sanity keeps your content in its Content Lake. Galley leaves it in your repository.
name: Galley and Sanity
lead: Sanity CMS serves structured content from a hosted database to any site or app, with an open-source editor, real-time teamwork and a large set of AI tools. Galley is free, open-source and new, and edits the files your static site is already made of.
published: "2026-11-25"
checked: November 2026
order: 2
draft: true
short:
  - Sanity CMS keeps your content as JSON documents in its hosted Content Lake, and your site fetches it with GROQ or GraphQL. Its editor, Sanity Studio, is open-source (MIT) code you configure. Galley keeps content as files in your own Git repository, with no database.
  - Sanity's Free plan is $0 for up to 20 seats, Growth is $15 a seat a month, and Enterprise is priced on request (as of November 2026). Galley is free and Apache-2.0. You pay for your own AI key and your own hosting.
  - Sanity asks a developer for a schema in code and queries in the site, and on Astro its visual editing needs server rendering. Galley reads the site as it is, and the live site stays static.
  - Sanity has a broad set of AI features, among them AI Assist, Agent Actions, Content Agent and Canvas, and a hosted MCP server. Galley has one assistant in the editor that never publishes, a proof of every change, and its own MCP server.
  - Choose Sanity when content feeds more than one website, when people edit the same document together, or when you need scheduled releases, custom roles and single sign-on. Galley was first released in November 2026 and has no content API, real-time editing, scheduling or single sign-on.
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
      ours: Free. Your AI key and hosting are yours
      theirs: Free plan; Growth $15 a seat a month (Nov 2026)
      better: ours
    - label: Setup
      ours: Reads the site as it is
      theirs: A schema in code, and queries in the site
      better: ours
    - label: Editing on the page
      ours: Retype words in the preview; no markup
      theirs: Click-to-edit, drag and drop; on Astro, needs server rendering
      better: even
    - label: Page building
      ours: The site's own sections (preview)
      theirs: Drag and drop in the Presentation tool
      better: theirs
    - label: AI features
      ours: One assistant, on your own Anthropic key
      theirs: AI Assist, Agent Actions, Content Agent and more
      better: theirs
    - label: Checking a change
      ours: Each change in the site's words, beside the live site
      theirs: Live preview, share links, version history
      better: even
    - label: Two people at once
      ours: One shared copy; a clashing save is refused
      theirs: Real-time editing and presence on every plan
      better: theirs
    - label: Scheduling
      ours: None
      theirs: Scheduled drafts (Growth); releases (Enterprise add-on)
      better: theirs
    - label: Teams
      ours: Three roles on a hosted editor (new)
      theirs: 5 roles on Growth; custom roles, SSO on Enterprise
      better: theirs
    - label: Content for apps
      ours: Not its job; the site's build reads the files
      theirs: APIs and a CDN for any channel
      better: theirs
    - label: Leaving
      ours: No content to export
      theirs: An NDJSON export; rich text to convert
      better: ours
faq:
  - q: What is Sanity CMS?
    a: "Sanity calls itself \"The AI Content Operating System\". It has three parts: Sanity Studio, an open-source React editing app you configure in code; the Content Lake, Sanity's hosted database of JSON documents; and APIs that sites and apps query with GROQ or GraphQL. Its headless CMS guide has a section titled \"Why Sanity is a headless CMS, but also much more\"."
  - q: Is Galley an alternative to Sanity?
    a: For a static website whose content only needs to reach that site, yes. Galley edits the files in your Git repository, needs no schema or queries for common setups, and is free and open-source. It isn't an alternative where content feeds apps and other channels, or where a team needs real-time editing, scheduled releases or single sign-on. Sanity does those today.
  - q: How much does Sanity cost?
    a: As of November 2026, Sanity's Free plan is $0 with up to 20 seats, 10,000 documents and public datasets only. Growth is $15 per seat a month for up to 50 seats, with pay-as-you-go API requests, bandwidth and assets above its quotas, while documents stop at 25,000 unless you buy the $299-a-month quota add-on. Enterprise is priced on request. Viewers don't take a seat. Galley is free; its assistant uses your own Anthropic key, billed by Anthropic.
  - q: Is Sanity open source?
    a: Partly. Sanity Studio, the editing app, is open source under the MIT licence, and Sanity will host it for free or you can host it yourself. The Content Lake, where the content is stored, is a service Sanity hosts, and we found no self-hosted version of it on Sanity's pages. Galley is open source under Apache-2.0 and keeps content in your own repository.
  - q: Does Sanity work with static sites and Astro?
    a: "Yes. Sanity has an official Astro integration, and a static Astro site fetches its content once, at build time, with a webhook to rebuild it when content changes. Visual editing is the exception: Sanity's Astro guide says it \"requires server-side rendering\" and \"Static output mode will not work\". Individual pages can be server-rendered instead, with a deployment adapter for your host."
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
  - label: "Galley, run a hosted install"
    href: /docs/running/hosted/
  - label: "Galley over MCP"
    href: /docs/integrations/mcp/
related: [types-of-cms, contentful, cloudcannon]
---

## What is Sanity CMS, and where does it keep your content?

Sanity calls itself "The AI Content Operating System". It has three parts. Sanity Studio is the editing app: open source under the MIT licence, built with React and configured in code. The Content Lake is the database, which Sanity hosts on Google Cloud. On top sit the APIs a site or an app uses to ask for content, in Sanity's own query language, GROQ, or in GraphQL.

The words live in the Content Lake, as "structured JSON documents with referential integrity." Their shape is code: "Content Lake stores any valid JSON document, with schemas living in your Sanity Studio configuration, not as database constraints." So the content model can sit in your Git repository and go through pull requests, as [Sanity's Studio page](https://www.sanity.io/studio) says, while the content stays in Sanity's database. Rich text comes back from the API as Portable Text, "rich text as an array of blocks, where each block is an array of child spans", which Sanity's docs say "isn't designed for direct human authoring or reading, but instead should be parsed by software."

Galley keeps the words where a static site already keeps them: Markdown, YAML, JSON or TOML files in the site's own repository. There is no database. A change waiting to be published is a change in those files, and publishing is a commit.

Most of what follows comes from that. Sanity is built for one body of content that feeds a website, an app and anything else that can call an API. Galley is built for the website the files belong to. Our [guide to the kinds of CMS](/compare/types-of-cms/) sets the two shapes side by side.

## How much does each cost?

As of November 2026, Sanity has three plans:

| Plan | Price | Seats | Documents |
| --- | --- | --- | --- |
| Free | $0 | Up to 20 | 10,000 |
| Growth | $15 per seat a month | Up to 50 | 25,000 |
| Enterprise | Priced on request | Custom | Custom |

For a small team the Free plan goes a long way: twenty seats cost nothing, and viewers don't take a seat on any plan. But its datasets are public only, which the docs explain means "anyone can query" them, and it has hard caps with no overages. On Growth, API requests, bandwidth and assets beyond the quotas are pay-as-you-go; documents stop at 25,000 unless you buy the $299-a-month Increased quota add-on. Add-ons run from $299 a month for more quota to $999 a month for each extra dataset. A draft counts as a document of its own. Free and Growth include 1,000 AI credits a month; on Growth, more cost $0.05 each. These figures are from [Sanity's pricing page](https://www.sanity.io/pricing); check it before you decide, because plans change.

Galley costs nothing. It is open-source under Apache-2.0, with one edition and no paid tier today. Two things do cost money. The assistant runs on Anthropic's Claude with your own key, and each request is billed to whoever owns that key. And the site needs hosting, which for static files is often free or cheap, but is yours to arrange.

It isn't like for like: Sanity's price pays for the hosted database, its APIs and CDN, and hosting for the Studio. With either product, you host the website itself.

## What does a developer have to set up?

With Sanity, the content model comes first. `npm create sanity@latest` makes a Studio project with a `sanity.config.ts` file and, by convention, a `schemas` folder, and the docs are frank about the next step: "A new Sanity Studio project has no schema types registered, so there is nothing to edit yet." A developer defines the document types in TypeScript or, as the Studio page offers, asks a coding agent to. Then the Studio is deployed, to a free `*.sanity.studio` address or a host of your own.

The site has to be taught to fetch. For Astro, Sanity's docs point to the official `@sanity/astro` integration, GROQ queries for what each page shows, a renderer such as `@portabletext/astro` for the rich text, and a webhook so the host rebuilds when content changes. Visual editing, Sanity's live preview with click-to-edit, asks for stega encoding, draft mode and the Presentation tool. On Astro, [Sanity's guide](https://www.sanity.io/docs/visual-editing/astro-visual-editing) says it "requires server-side rendering because draft mode depends on per-request cookie checking. Static output mode will not work." You can server-render only the pages that need it, with "a deployment adapter for your hosting platform."

In return the developer gets type checking for the content, fields that can be custom React components, and content ready for other channels.

Galley starts by reading the site. It works out the framework, the content collections and every field's type from the site's own schemas and files, without running any of its code. Astro fits deepest; Docusaurus, Nuxt, Next.js, SvelteKit, Eleventy, Hugo and Jekyll are recognised by their conventions. There are no queries to write, because the site's build already reads the files. Editing on the page needs no markup and no server rendering: Galley's preview runs the site's own dev server, and the live site stays static.

The caveat on our side: a site whose copy is hard-coded in components gets less, until someone moves the words into content files.

## How does each one use AI?

Sanity has a large set of named AI features, and they reach well beyond the editor.

- **AI Assist**, a Studio plugin on Growth and up, follows "reusable instructions in natural human language": translating documents or fields, image captions, SEO details.
- **Agent Actions**, such as Generate, Transform and Translate, process content with AI from code, on every plan, at one AI credit ($0.05) a request.
- **Content Agent** is a chat assistant for content work "without writing code or GROQ queries", in Sanity's Dashboard, Slack, Linear and an API. It "never makes changes without your approval."
- **Canvas** is "a collaborative writing environment built into Sanity", with AI writing help.
- **Sanity Context** gives your own AI agents knowledge bases built from your content, over MCP. One is free; on Growth, up to five cost $299 a month.
- **An official MCP server**, hosted at `mcp.sanity.io` and generally available since December 2025, lets Claude Code, Cursor, VS Code and other clients query, create, patch and publish documents, and create and list releases and manage schemas.

Galley has one assistant, inside the editor, beside the page. You [ask in plain words](/how-to/ask-the-assistant/); it reads the site before it edits, asks one short question when two places could be meant, and quotes the new words back. In content mode it can touch only content and media, and it has no shell or network tool. It never publishes: every change waits in the proof until a person presses Publish. [Galley's MCP server](/docs/integrations/mcp/) gives Claude Desktop, Claude Code, Cursor, VS Code or any MCP client the assistant's tools for reading and changing the site, and their changes wait in the same proof. Unlike the assistant, such a tool can also publish (its instructions say only when you ask) unless publishing over MCP is switched off.

Sanity's AI reaches further than ours: across thousands of documents, into Slack, out to your own agents. For a large content operation that is the point. We think a website edited by people who aren't developers needs something narrower first: one assistant that can only touch content, and a check in the page's own words. Content Agent asks for approval too, so the difference is where you look at the change. That's our view; plenty of teams will want Sanity's reach.

## How do you check a change before it goes live?

In Sanity an edit is a draft until someone publishes it. The Presentation tool shows the draft on your site as you work, in desktop or mobile sizes, and can share the preview by link or QR code when the front end allows it. On Astro, that preview needs the server rendering above. The Studio promises "Every change tracked. Compare any two versions. Restore anything.", with history kept for 3 days on Free, 90 on Growth and 365 on Enterprise. On Growth, a Contributor "Can write but not publish documents", and colleagues can comment on single fields or words. On certain Enterprise plans, Content Releases let a team "plan, preview, and validate significant changes in advance, then publish them together."

In Galley every change, typed in the form, retyped on the page or made by the assistant, lands in [Proof](/how-to/proof-and-publish/): the change in the site's own words, old text struck out and new text written in, beside the live site. Any single change can be put back. Publishing is a commit, or a branch and a pull request if the site is set up for review. Undo is a new commit, and history is never rewritten.

The difference is the unit of review. Sanity keeps history document by document, and on Enterprise a release groups many documents to preview together. Galley lists every change waiting across the site in one place, and the record is your Git history. Sanity can do two things here that Galley can't: comments on a field or a single word, and, on Growth, Scheduled drafts that publish a document at a time you set.

## How does the site get its content?

From Sanity, over the network. A static Astro site fetches it at build time ("content is fetched once during the build rather than on every request"), and "Static sites need a rebuild to reflect content changes", usually through a webhook to the host. A server-rendered site queries Sanity on every request. The requests count towards the plan: 250,000 API requests and a million API CDN requests a month on Free and Growth.

From the repository, with Galley. The build reads the files, as it did before. Publishing is a commit and a push, so whatever deploys the site on a push, such as Netlify, Cloudflare Pages or GitHub Actions, deploys it as before. Galley can also put a site online on Cloudflare, verified on the real service; deploys to Vercel are built but still in progress.

## Which one suits a team?

For a team of any size today, Sanity. Real-time editing and presence are on every plan: "Same document, multiple editors, character-level sync." Free has two roles, Administrator and Viewer. Growth has five, adding Editor, Developer and Contributor, with comments and tasks. Enterprise adds custom roles, single sign-on with SAML, a full audit trail and an uptime agreement. Sanity is a SOC 2 Type 2 certified provider, launched to the public in November 2017, and says it is "Loved by 1M+ users and 60K+ teams". It doesn't charge for locales, within a plan's limit on unique attributes.

Galley is behind here. On your own computer it has no accounts: anyone who can open the app can publish, so the gate is pull-request mode and your code host's branch protection. A [hosted editor](/docs/running/hosted/), one site per install on a server you run, adds accounts with three roles (owner, editor and contributor), and each publish carries its author's name. The roles keep people out of each other's way; they aren't a security boundary. That hosted editor is new and still in final checks, and single sign-on is planned for later. Everyone on one hosted editor works on one shared copy of the site; a second save of a page someone has just changed is refused rather than written over it. There is no live presence.

## Where does Galley fall short?

Beside Sanity, in several places.

- **It's young.** Version {version} of software first released in November 2026.
- **It serves one website.** There's no content API for apps or other channels.
- **No editing together, no scheduling.** No real-time co-editing or presence, no scheduled publishing or releases, and no editorial workflows across many languages.
- **Page building is in preview.** Sanity's drag-and-drop page building is on every plan.
- **No support contract.** Help comes through the project's issues on GitHub, with no uptime agreement.
- **The assistant needs a key, billed to you.** Everything except chat and image generation works without one.

## When is Sanity the better choice?

When the same content feeds a website, an app and other channels, which is what the Content Lake and its APIs are for. When several editors work in the same document at once and need to see each other there. When you need scheduled drafts, coordinated releases, custom roles, single sign-on and an audit trail. When your developers want a typed content model and custom inputs in React. When you want AI across the whole content operation, from translation to knowledge bases for your own agents. And when you'd rather adopt a product launched in 2017 than a new open-source tool.

Galley fits when the content is the website, the site is static, and the people who change it aren't developers: they ask, see exactly what changed beside the live site, and publish, with no schema to write first and no seats to pay for. See [what it does today](/tour/), or set it beside [CloudCannon](/compare/cloudcannon/), the Git-based product closest to it.

## Can you move from one to the other?

From Sanity to Galley takes real work, because the content has to leave the Content Lake and become files. Sanity's command-line tool exports a dataset as a gzipped tarball: `data.ndjson`, with "Every exported document, one JSON object per line", a map of the assets, and folders of images and files. Exports are billed against your API quota. Then someone turns each document into a Markdown or data file, converts the Portable Text with one of the serializers Sanity's docs list, moves the images into the site, and replaces the GROQ queries with reads of local files. Galley has no importer for Sanity. The only guided move into Galley is from [WordPress](/wordpress/), and that is new and in final checks.

The other way, the files are already plain. Sanity's import tool takes NDJSON, and its Block Tools library converts existing markup into Portable Text. You'd still design a schema and rewrite the site to fetch from Sanity.

To try Galley first, run `npx galley-cms` in the site's folder. It edits the content in the site's files, so a site that fetches everything from Sanity gives it little to edit until the content moves.

## Three questions to ask before you choose

**Where else does this content have to go?** If an app, a second site or your own AI agents need it through an API, that points to Sanity. If the answer is "only this website", it doesn't.

**When an AI makes a change, who sees it before it's live, and in what form?** Ask to see one change that touches several pages, in the words the reader will read.

**What does leaving look like?** Ask for an export of your content, and try turning one rich-text page into Markdown, before you need to.
