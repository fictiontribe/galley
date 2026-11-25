---
title: "Galley vs Storyblok: a headless CMS or files in Git"
description: Storyblok is a hosted headless CMS; Galley edits files in your Git repository. Setup, AI, price and teams compared, and when Storyblok is the better fit.
kind: versus
product: Storyblok
heading: Storyblok and Galley both let you edit on the page. They keep your words in different places.
name: Galley and Storyblok
lead: Storyblok is a hosted headless CMS with a Visual Editor. Your content lives in its cloud, and your site fetches it as JSON. Galley is free, open-source and new, and edits the files in your own Git repository, with the assistant and a check of every change built into the editor.
published: "2026-11-25"
checked: November 2026
order: 7
draft: false
short:
  - Storyblok keeps your content in its own cloud, in a space whose server location can't be changed later, and your site fetches it as JSON through an API. Galley edits the Markdown, JSON and YAML files in your own repository, and has no database.
  - Storyblok's Starter plan is free, with one seat. Growth is $99 a month, or $90.75 a month paid yearly, with five seats (as of November 2026). Galley is free and Apache-2.0; you pay for your own AI key and your own hosting.
  - Storyblok asks a developer for a content model, an SDK in the site and, for the Visual Editor, a preview served over HTTPS that Storyblok is allowed to load in a frame. Galley reads the site's framework, collections and fields as they already are.
  - Both have AI. Storyblok meters its AI features in monthly credits, has Storyblok Agents in the app (a beta, from Growth up) and hosts an official MCP server. Galley builds in an assistant that never publishes and holds every change it makes in a proof; other AI tools can connect over MCP, and can publish unless that is switched off.
  - Choose Storyblok if the same content feeds an app as well as a website, or if you need many languages, custom roles and workflows, releases, single sign-on or an uptime agreement. Galley was first released in November 2026 and has none of that; single sign-on is planned for later.
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
      ours: Free. Your AI key and hosting are yours
      theirs: Starter free (1 seat); Growth $99 a month (Nov 2026)
      better: even
    - label: Setup
      ours: Reads the site as it is
      theirs: A content model (Block Library or CLI), an SDK, an HTTPS preview
      better: ours
    - label: Page building
      ours: The site's own sections (preview)
      theirs: Blocks in the Visual Editor, on every plan
      better: theirs
    - label: AI in the editor
      ours: An assistant that never publishes
      theirs: AI features by plan; Agents (beta, Growth up)
      better: even
    - label: Checking a change
      ours: Each change marked up beside the live site
      theirs: Draft preview; version compare on Premium
      better: ours
    - label: Version history
      ours: Every publish is a commit in your Git history
      theirs: Every save versioned; kept 1 day on Starter to unlimited on Elite
      better: even
    - label: Languages
      ours: No multi-language workflows
      theirs: Field, folder or space translation; AI help
      better: theirs
    - label: Teams
      ours: Three roles on a hosted editor (new); they organise work, not security
      theirs: Roles and a workflow on every plan; SSO on Premium
      better: theirs
    - label: Content for apps
      ours: Not its job
      theirs: REST API; GraphQL on Premium and Elite
      better: theirs
    - label: Maturity
      ours: First released November 2026
      theirs: Started in 2017; ISO 27001 certified
      better: theirs
    - label: Leaving
      ours: No content to export
      theirs: Export as JSON by CLI, then convert it
      better: ours
faq:
  - q: Is Galley an alternative to Storyblok?
    a: For a static site whose content can live as files, yes. Galley edits the Markdown, JSON and YAML in your Git repository, and publishing is a commit, so there's no content database and no API between the site and its words. It's free and open-source, with an assistant built in. Storyblok fits better when the content feeds apps too, or when you need many languages, custom workflows and single sign-on.
  - q: How much does Storyblok cost?
    a: As of November 2026, Starter is free, with one seat. Growth is $99 a month, or $90.75 a month paid yearly, with five seats. Growth Plus is $349 a month, or $319.91 a month paid yearly, with fifteen. Premium and Elite are priced on request. Starter, Growth and Growth Plus each cover one space. Galley is free; its assistant uses your own Anthropic key.
  - q: Can you self-host Storyblok?
    a: We found no self-hosted edition. Storyblok describes its application as "subscription-based software-as-a-service (SaaS)", and you host only the front end and its preview. Its SDKs, command-line tool and Agent Skills are open source under the MIT licence; the CMS application isn't described as open source. Galley is open source under Apache-2.0, and runs on your computer, or on your own server with the hosted editor, which is new.
  - q: Does Storyblok work with a static site?
    a: Yes. In its pricing page's words, Storyblok "only delivers JSON and therefore can be combined with any static site generator you want", and the site rebuilds when Storyblok's webhook calls your host's build hook. Live preview as editors type usually needs pages rendered on the server or in the browser, so Storyblok usually recommends a separate preview deployment beside the live site. Galley previews with the site's own dev server.
  - q: Does Storyblok have an MCP server?
    a: Yes, an official hosted one. Claude, Cursor, VS Code and other MCP clients connect with OAuth or a personal access token, and work in a space through Storyblok's Management API. Galley has one too, offering the assistant's tools for reading and changing the site. Unlike the assistant, such a tool can also publish (its instructions say only when you ask) unless publishing over MCP is switched off.
  - q: Can two people edit the same story at once?
    a: Not by typing together, as far as we found in Storyblok's docs. When two editors change one story, the second to save gets a Content Conflict warning and can copy their changes over or overwrite. From Growth, a Content Locking app lets only the first editor save. On a hosted Galley editor (new, in final checks), a second save of a page someone has just changed is refused rather than written over it.
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
  - label: "Galley over MCP"
    href: /docs/integrations/mcp/
  - label: "Galley, run a hosted install"
    href: /docs/running/hosted/
related: [types-of-cms, strapi, payload]
---

## How do Galley and Storyblok differ at the root?

In where your words live. Most of the other differences follow from that.

Storyblok is a headless CMS sold as a service. Its documentation says so plainly: "As a headless CMS, Storyblok stores your content and assets and delivers them over an API. It doesn’t render or host your website." The content sits in a space, "a flexible content repository for your project", on servers in Europe, the United States, Canada or Australia. "A space's server location is permanent." Changing it means a new space and a migration. Your site fetches stories as JSON from Storyblok's Content Delivery API, a REST API cached on Amazon CloudFront; Premium and Elite add GraphQL.

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

Galley costs nothing. It is open-source under Apache-2.0, with one edition. The assistant runs on Anthropic's Claude with your own key, billed to whoever owns it, and the site's hosting is yours to arrange, often free or cheap for static files. Storyblok doesn't host the site either, so that bill is yours with both.

## What does a developer have to set up?

With Storyblok, a content model comes first: content types, blocks and fields, built in the app's Block Library or in code with `@storyblok/schema` and the command-line tool's `schema push`. The site fetches stories with an access token, usually through one of Storyblok's SDKs, and maps each block's name to a component.

The [Visual Editor](https://www.storyblok.com/docs/concepts/visual-editor), Storyblok's headline feature, opens your site in a frame and asks more of it:

- **A preview URL.** "Storyblok’s security policy requires that you serve the preview over HTTPS (whether deployed or on localhost)", so local work needs a certificate.
- **Permission to frame the page,** if the site sends a Content Security Policy: it must allow `https://app.storyblok.com` as a frame ancestor.
- **Two data attributes on each block,** `data-blok-c` and `data-blok-uid`, which the SDKs format for you.
- **The preview bridge,** a script that reloads the page when an editor saves or publishes.
- **A check on the server** that a preview request came from Storyblok, because the preview token can read drafts.

Seeing the page change as an editor types usually needs pages rendered on the server or in the browser, not built ahead of time. For Astro, Storyblok's SDK says the route "must render on demand", while "Reloading on save or publish works on every route." For a site that is static in production, Storyblok's usual recommendation is two deployments: a preview that renders on the server, and the static live site, rebuilt by a webhook after each publish.

Storyblok's Blueprints shorten the start, with a GitHub repository connected to the Visual Editor and deployed to Vercel or Netlify.

Galley starts by reading the site. It works out the framework, the content collections and every field's type from the site's own schemas and files, without running any of its code. Astro fits deepest; Docusaurus, Nuxt, Next.js, SvelteKit, Eleventy, Hugo and Jekyll are recognised by convention. A `galley.config.json` file exists only to correct what it found. Editing on the page needs no markup, and the preview is the site's own dev server, so there's no second deployment to keep. The caveat: a site whose copy is hard-coded in components gets less, until someone moves the words into content files.

## How does each one use AI?

Storyblok has many AI features, sorted by plan and paid for in AI credits, "a monthly allowance for using Storyblok’s AI features" that doesn't roll over. As of November 2026:

- **Every plan:** AI Content Generation, and AI Translations, a beta in 48 languages.
- **Growth and up:** AI Alt Text and Storyblok Agents.
- **Premium and Elite:** AI SEO and basic AI Branding.
- **Elite:** advanced AI Branding, and bringing your own AI.

Storyblok Agents is "an in-app assistant with a chat-based interface. It can read, modify, and analyze the space’s content." Teams can save custom agents and schedule them to run on their own. It is a beta, and in chat "any action that writes content or changes configuration requires manual approval". Publishing a story is one of its actions.

For outside AI tools, Storyblok hosts an official MCP server. Claude, Cursor, VS Code, Codex and other clients connect with OAuth or a personal access token and work in a space through its Management API. Its own advice is frank: "Because the LLM mediates every call, results are non-deterministic and unsuited for repeatable, high-volume work." It also publishes open-source Agent Skills for coding agents.

Galley puts one assistant inside the editor, beside the page. You ask in plain words; it reads the site before it edits, asks when a request is ambiguous, and quotes the new words back. In content mode it can touch only content and media, and it has no shell or network tool. It never publishes: every change it makes waits in the proof, and a person presses Publish. Galley's [MCP server](/docs/integrations/mcp/) gives Claude Desktop, Claude Code, Cursor, VS Code or any MCP client the assistant's tools for reading and changing the site. Unlike the assistant, such a tool can also publish (its instructions say only when you ask) unless publishing over MCP is switched off.

We think what happens after the AI writes matters more than the number of features. In chat, Storyblok's agent asks before each write. Galley's assistant writes into a proof that shows the change in the site's own words, and leaves publishing to a person. Storyblok's list is far longer, and for translation it offers what Galley doesn't. That's our view, and we make one of the two.

## How do you check a change before it goes live?

In Storyblok, editors see their draft in the Visual Editor, on the preview deployment, as they work. On every plan, the Default workflow takes a story through Drafting, Reviewing and Ready to Publish, and "In the Default workflow, only stories at this stage can be published." Each save makes a version, listed with its author and what it added, changed or deleted. Versions are kept for one day on Starter, 30 days on Growth and Growth Plus, 180 days on Premium and without limit on Elite. Comparing a draft with the published version, changes highlighted, is on Premium and Elite. Scheduling a single story starts on Growth; Releases, which publish a group of stories together, on Premium.

In Galley every change, whether typed in the form, retyped on the page or made by the assistant, lands in [Proof](/how-to/proof-and-publish/): old text struck out and new text written in, in the site's own words, beside the live site. Any single change can be put back. Publishing is a commit to your repository, or a branch and a pull request. Undo is a new commit, and the history lasts as long as your repository does.

We think Galley shows a reviewer more plainly what changed, and it does so on its one free edition. Storyblok has more process around the review: stages, assignments and, on Premium, releases.

## How does the site get its content?

From Storyblok's API, when the site is built or on each visit. Storyblok hosts the editor, the content (cached on a CDN) and the images (transformed on request); you host the front end, its domain and the preview. Its pricing page says Storyblok "only delivers JSON and therefore can be combined with any static site generator you want." A static site rebuilds when Storyblok's webhook calls your host's build hook.

Galley serves no content. The build reads the files, and your host builds from the repository as it would after any commit. Galley can put a site online on Cloudflare, verified on the real service; deploys to Vercel are built but still in progress.

We think that makes Galley simpler for one website, with no API and no second deployment, and it is the wrong tool for content an app has to read. Storyblok's API, with its Swift and Kotlin libraries, reaches a phone too.

## Which one suits a team?

Storyblok, and the gap grows with the team. Every plan has three fixed roles (Owner, Admin and Editor) and the Default workflow, and editors can comment on any field and tag teammates. Premium adds ten custom roles, two custom workflows and single sign-on through OpenID Connect or SAML; Elite lifts those limits. Storyblok is certified for ISO 27001 and says it adheres to SOC 2 Type 2, and its uptime agreement runs from 97% on Growth to 99.99% on Elite.

Languages are built in. A space can translate by field, by folder or by space, with two locales on Starter and Growth (Growth can buy more) and ten on Growth Plus.

When two editors change one story, "Storyblok shows a Content Conflict warning to the second editor who tries to save after the first editor has already saved changes", and that editor can copy their changes over or overwrite. From Growth, a Content Locking app lets only the first editor save. We found no live co-editing of a story in its docs; the Ideation Room, a beta for drafting ideas, is described as real time.

Galley is behind here, and we'd rather say so than let you find out. Used on your own computer, it has no accounts: anyone who can open the app can publish, so the gate is pull-request mode and your code host's branch protection. A hosted editor, one site per install on a server you run, adds accounts with three roles (owner, editor and contributor), and each publish carries its author's name. The roles keep people out of each other's way; they aren't a security boundary. That hosted editor is new and still in final checks, and single sign-on is planned for later. Everyone on one hosted editor works on one shared copy of the site; a second save of a page someone has just changed is refused, not written over it. There's no live presence.

## Where does Galley fall short?

In several places.

- **It's young.** Version {version} of software first released in November 2026. Storyblok was started in 2017.
- **No content for apps.** There's no API for an app to read.
- **No scheduled publishing, no workflows for several languages, no approval chain beyond pull requests.** Galley's own [FAQ](/docs/project/faq/) gives these as reasons to choose something else.
- **Page building is in preview.** Galley builds pages from the site's own sections, and that part is still in preview. Storyblok's editors arrange blocks in the Visual Editor on every plan, the free one included.
- **No support contract.** Help comes through the project's issues on GitHub, not a support plan or an uptime agreement.
- **TOML is read-only.** Galley reads TOML files but won't change them.
- **The assistant needs a key, and it's billed to you.** Everything except chat and image generation works without one.

## When is Storyblok the better choice?

When the same content has to reach a website and a mobile app through one API. When you publish in several languages and want translation in the editor, with AI to draft it. When you need custom roles and workflows, releases, single sign-on and a 99.9% uptime agreement, on Premium or Elite. When editors want to build pages from blocks in a visual editor today, even on the free plan. And when you'd rather buy a service with a record since 2017 than adopt a new open-source tool.

Galley fits when the website is the whole job: a static site whose content can live as files, changed by people who aren't developers and who want to ask for a change, see exactly what changed and publish it. It fits when you want no subscription and no content database, and the editor on your own computer or your own server (the hosted editor is new). See [what it does today](/tour/).

## Can you move from one to the other?

Yes, but it's a project, because the content has to come out of Storyblok's database and become files. Storyblok's command-line tool downloads it: with `stories pull`, stories are "saved as individual JSON files", and `assets pull` fetches the images. A developer then turns those trees of blocks into Markdown or data files, including rich text, which Storyblok stores as JSON, and changes the templates to read files instead of the API. Galley has no importer for Storyblok. Its only guided move is from [WordPress](/wordpress/), and that is new, in final checks.

The other way, Storyblok's CMS migration guide covers moving in, with tutorials for coming from Contentful, WordPress, Drupal, Sitecore and Adobe Experience Manager; files would first need a content model to land in.

## Three questions to ask before you choose

**Where do the words live, and what does leaving take?** With Storyblok, in its cloud, in a region fixed when the space was made, and leaving means an export and a conversion. With Galley, in your repository already.

**Does anything besides the website need this content?** If an app reads it too, you want an API, and that's Storyblok's side of this page.

**When the AI makes a change, who sees it before it's live, and in what form?** Ask each product to show you on a real page, with someone who isn't a developer doing the reviewing.
