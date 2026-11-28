---
title: "Galley vs Webflow: a Git-based Webflow alternative"
description: "A Webflow alternative for static sites: Galley edits your site's files in Git. Design, page building, AI, scheduling, translations, SSO, search intelligence, hosting, teams and price compared."
kind: versus
product: Webflow
heading: Webflow is the whole website in one product. Galley edits a site that lives in your own repository.
name: Galley and Webflow
lead: "In Webflow, designers build on a visual canvas, and the design, the content and the hosting live on Webflow's platform. Galley is an AI-first, open-source Webflow alternative (with optional Cloudflare hosting on Galley Cloud) for developer-built static sites — editing plain files in Git with visual section building, translations, live search rankings, scheduled publishing, free OIDC SSO and zero per-seat fees."
published: "2026-11-25"
updated: "2026-11-28"
checked: November 2026
order: 10
draft: false
short:
  - Webflow is a hosted visual site builder with a CMS. Designers build on a canvas without code, CMS content sits in Webflow's database, and paid Site plans include hosting. Galley edits a static site that developers built, as files in your own Git repository.
  - "As of November 2026, Webflow's Premium Site plan is $25 a month yearly ($39 monthly) per site, plus Workspace plans, per-seat charges ($15–$19/seat for editors, $39–$45/seat for designers) and Localize ($9+/mo per locale). Galley is free under Apache-2.0 locally or self-hosted; [Galley Cloud](/cloud/) (opening by invitation) includes Cloudflare edge hosting, translations, monthly AI credits and Search intelligence from $35 a month per site ($99 on Agency for five sites), with no per-seat fees."
  - "Galley is AI-first for live websites: a page-aware assistant that never publishes, multi-provider image and short video generation, whole-site AI translations with a Git-tracked Translation Memory and Glossary, live Google search rankings and 404 backlink recovery, `llms.txt` and Markdown twins, scheduled publishing, and MCP — whereas Webflow gates page branching to Team ($2,500/mo) and charges extra per locale and per editor seat."
  - Leaving Webflow with CMS content means a rebuild. Its code export is static HTML, CSS and JavaScript without the CMS content, which comes out as CSV, one Collection at a time. With Galley the content stays in your repository, as files.
  - Choose Webflow if designers should draw custom layouts and CSS animations on a visual canvas without writing code, or if you need built-in ecommerce, SOC 2 Type II and ISO 27001 today.
table:
  heading: Galley and Webflow, side by side.
  text: Where Webflow does more, the table says so.
  caption: Galley compared with Webflow
  columns: [What differs, Galley, Webflow]
  rows:
    - label: Where the site lives
      ours: Files in your own Git repository
      theirs: On Webflow; CMS content in its database
      better: ours
    - label: Price
      ours: Free open source; Galley Cloud from $35/mo w/ site hosting, i18n & $0/seat (Nov 2026)
      theirs: Starter free (webflow.io, 2 pages); Premium $25/mo yearly + Workspace, seats & Localize (Nov 2026)
      better: ours
    - label: Designing pages
      ours: Visual Arrange section builder stays inside the site's design system; layouts are code
      theirs: Freeform visual CSS canvas & animations without writing code
      better: theirs
    - label: Editing
      ours: Form, click-to-edit on the page, visual Arrange builder, or AI assistant
      theirs: On the canvas, or in CMS fields
      better: even
    - label: AI & search intelligence
      ours: AI-first — assistant (never publishes), image/video gen, AI translations w/ TM & glossary, live rankings/404 recovery, llms.txt, MCP
      theirs: Site builder, Assistant & on-page SEO/AEO on shared credits; no live rankings or 404 backlink recovery
      better: ours
    - label: Checking a change
      ours: Word-by-word Proof beside the live site, single-change undo, Cloud preview links
      theirs: Live canvas & preview; page branching gated to $2,500/mo Team & Enterprise
      better: ours
    - label: Languages
      ours: Built-in i18n, side-by-side editing, AI translation w/ TM & glossary included
      theirs: Localize add-on, from $9/mo per locale yearly
      better: ours
    - label: Scheduled publishing
      ours: Built in free (scheduler/CLI/publishAt) & pre-built edge deploys on every Cloud plan
      theirs: Scheduled CMS items on paid Premium and above
      better: ours
    - label: Hosting
      ours: Any static host free/cheap, direct Cloudflare deploy, or Cloudflare edge on Cloud w/ zero lock-in
      theirs: Included in paid Site plans, locked to Webflow
      better: ours
    - label: Two people at once
      ours: Real-time co-editing & live presence on Galley Cloud; safe save checks self-hosted
      theirs: Live co-editing on the canvas for up to 25 people
      better: even
    - label: Teams & SSO
      ours: Free OpenID Connect SSO in Apache-2.0 server, 3 roles, $0/seat on Cloud (up to 500)
      theirs: Eight roles billed per seat ($15–$45/mo); SSO & custom roles locked to Enterprise
      better: ours
    - label: Leaving
      ours: Nothing to export; keep your Git repository and static build as-is
      theirs: Static code export; CMS as CSV per Collection
      better: ours
    - label: Maturity
      ours: First released November 2026; no SOC 2 or ISO 27001 yet
      theirs: Founded 2013; SOC 2 Type II, ISO 27001
      better: theirs
faq:
  - q: Is Galley an alternative to Webflow?
    a: For developer-built websites, yes, though they are different kinds of product. Webflow is where a designer builds, stores and hosts a site on a visual CSS canvas with no code needed. Galley edits a static site that developers built in code and keep in Git — with visual section building ([Arrange](/docs/editing/page-builder/)), AI editing, translations with Translation Memory, live search rankings, scheduled publishing, free OIDC SSO self-hosted, and Cloudflare edge hosting on [Galley Cloud](/cloud/) with zero per-seat fees.
  - q: How much does Webflow cost?
    a: As of November 2026, Premium, Webflow's Site plan for sites that use the CMS, is $25 a month paid yearly or $39 paid monthly, per site. Basic, without a CMS, is $15 or $25, and Starter is free on a `webflow.io` address. Workspace plans, seats ($15–$19/seat for editors, $39–$45/seat for designers) and Localize ($9+/mo per locale) are billed separately. Team is $2,500 a month on an annual contract. Galley is free under Apache-2.0 locally or self-hosted (bringing your own AI key); [Galley Cloud](/cloud/) (opening by invitation) starts at $35 a month per site ($99 on Agency for five sites, $149 on Business), with Cloudflare hosting, translations, monthly AI credits and Search intelligence included and no per-seat fees.
  - q: Can you export a Webflow site?
    a: Partly. On paid Workspace plans, Webflow exports the site's HTML, CSS, JavaScript and images as a ZIP file. CMS content, Ecommerce, localised pages, site search, form handling and code components don't come with it, and Collection pages export empty. CMS content comes out separately, as a CSV file for each Collection, with images as links to files Webflow hosts.
  - q: What happened to the Webflow Editor?
    a: Webflow retired its legacy Editor, and since 5 October 2026 it can no longer be opened. Anyone who edits a Webflow site now signs in with a Webflow account that has a seat in the site's Workspace. Editors who were moved across automatically were given the Content editor role. As of November 2026, a limited seat for an editor is $15 a month paid yearly, or $19 monthly; editors moved over from the old Editor got their seats free, and freelancer and agency plans include free client seats.
  - q: Does Webflow have an MCP server?
    a: Yes. Webflow runs an official, hosted MCP server that tools such as Claude, ChatGPT and Codex connect to with OAuth. It is on every Site plan, Starter included, and uses no Webflow AI credits of its own (Campaigns work excepted). Galley's MCP server gives AI tools the assistant's tools for the site. Unlike the assistant, such a tool can also publish (its instructions say only when you ask) unless publishing over MCP is switched off.
  - q: Is Galley a design tool like Webflow?
    a: No. Galley is not a freeform CSS drawing canvas. Its built-in visual [Arrange](/docs/editing/page-builder/) page builder lets editors select, drag, reorder, duplicate and drop new sections from a thumbnail palette directly onto the rendered page and toggle section layout options while staying inside the site's design system — new section components and CSS remain in code. Designing arbitrary layouts and animations without writing code is what Webflow is for.
sources:
  - label: "Webflow, home page"
    href: https://webflow.com/
  - label: "Webflow, pricing"
    href: https://webflow.com/pricing
  - label: "Webflow, the platform"
    href: https://webflow.com/platform
  - label: "Webflow, CMS"
    href: https://webflow.com/feature/cms
  - label: "Webflow, editing content"
    href: https://webflow.com/feature/edit-content
  - label: "Webflow, hosting"
    href: https://webflow.com/feature/hosting
  - label: "Webflow, about"
    href: https://webflow.com/company/about
  - label: "Webflow, security"
    href: https://webflow.com/security
  - label: "Webflow, apps"
    href: https://webflow.com/apps
  - label: "Webflow Help Center, intro to the Webflow CMS"
    href: https://help.webflow.com/hc/en-us/articles/33961307099027-Intro-to-the-Webflow-CMS
  - label: "Webflow Help Center, choose a Site plan"
    href: https://help.webflow.com/hc/en-us/articles/33961232582419-Choose-a-Site-plan
  - label: "Webflow Help Center, updated pricing and simplified plans for May 2026"
    href: https://help.webflow.com/hc/en-us/articles/51059955082387-Updated-pricing-and-simplified-plans-for-May-2026
  - label: "Webflow Help Center, Webflow hosting overview"
    href: https://help.webflow.com/hc/en-us/articles/33961342422547-Webflow-hosting-overview
  - label: "Webflow Help Center, seats, roles and permissions"
    href: https://help.webflow.com/hc/en-us/articles/33961273067411-Seats-roles-and-permissions-overview
  - label: "Webflow Help Center, legacy Editor deprecation FAQ"
    href: https://help.webflow.com/hc/en-us/articles/48412420902675-Legacy-Editor-deprecation-FAQ
  - label: "Webflow Help Center, edit site content as a content editor"
    href: https://help.webflow.com/hc/en-us/articles/33961251014931-Edit-site-content-as-a-content-editor
  - label: "Webflow Help Center, page building"
    href: https://help.webflow.com/hc/en-us/articles/33961210206483-Page-building
  - label: "Webflow Help Center, real-time collaboration"
    href: https://help.webflow.com/hc/en-us/articles/43232037920275-Real-time-collaboration
  - label: "Webflow Help Center, comments"
    href: https://help.webflow.com/hc/en-us/articles/33961339882131-Comments
  - label: "Webflow Help Center, scheduled publishing"
    href: https://help.webflow.com/hc/en-us/articles/33961272476563-Scheduled-publishing
  - label: "Webflow Help Center, page branching"
    href: https://help.webflow.com/hc/en-us/articles/46651751861139-Page-branching
  - label: "Webflow Help Center, design approvals"
    href: https://help.webflow.com/hc/en-us/articles/46651772348947-Design-approvals
  - label: "Webflow Help Center, custom roles"
    href: https://help.webflow.com/hc/en-us/articles/46651804072467-Create-and-manage-custom-roles
  - label: "Webflow Help Center, single sign-on"
    href: https://help.webflow.com/hc/en-us/articles/46651862433683-Single-Sign-On-SSO-Login
  - label: "Webflow Help Center, Webflow Localize overview"
    href: https://help.webflow.com/hc/en-us/articles/33961240752147-Webflow-Localize-overview
  - label: "Webflow Help Center, Webflow AI overview"
    href: https://help.webflow.com/hc/en-us/articles/34297897805715-Webflow-AI-overview
  - label: "Webflow Help Center, Webflow AI credits"
    href: https://help.webflow.com/hc/en-us/articles/51060121155347-Webflow-AI-credits
  - label: "Webflow Help Center, Webflow MCP server overview"
    href: https://help.webflow.com/hc/en-us/articles/52536562285203-Webflow-MCP-server-overview
  - label: "Webflow Help Center, connect your AI tools to the Webflow MCP server"
    href: https://help.webflow.com/hc/en-us/articles/52536616701971-Connect-your-AI-tools-to-the-Webflow-MCP-server
  - label: "Webflow developer documentation, getting started with the MCP server"
    href: https://developers.webflow.com/mcp/reference/getting-started
  - label: "Webflow Help Center, how to export your site code"
    href: https://help.webflow.com/hc/en-us/articles/33961386739347-How-do-I-export-my-Webflow-site-code
  - label: "Webflow Help Center, importing and exporting CMS content"
    href: https://help.webflow.com/hc/en-us/articles/33961290794771-How-do-I-import-content-into-the-Webflow-CMS
  - label: "WordPress.org, about WordPress"
    href: https://wordpress.org/about/
  - label: "Cloudflare Pages, pricing"
    href: https://developers.cloudflare.com/pages/functions/pricing/
  - label: "Galley, the FAQ for developers"
    href: /docs/project/faq/
  - label: "Galley, page builder"
    href: /docs/editing/page-builder/
  - label: "Galley, languages"
    href: /docs/editing/languages/
  - label: "Galley, the tour: what is built and what isn't yet"
    href: /tour/
  - label: "Galley Cloud"
    href: /cloud/
  - label: "Galley for enterprise and security teams"
    href: /enterprise/
related: [/wordpress/, types-of-cms, cloudcannon]
---

## Is Galley really a Webflow alternative?

For developer-built websites, yes, though they are different kinds of product.

Webflow is a hosted visual site builder with a CMS built in. A designer builds the site on Webflow's canvas without code; in Webflow's words, "You design, we generate the code". Content with a shared structure, such as blog posts, lives in Webflow's CMS, which its documentation calls "a structured database", and paid Site plans include hosting. Webflow started in 2013 and counts 300,000 organisations using it (November 2026).

Galley edits a static site that developers have built in a framework such as Astro and keep in a Git repository. The words are Markdown, JSON and YAML files beside the code. Everyone else changes them in a form, on the page, in the visual [Arrange](/docs/editing/page-builder/) page builder, or by asking an assistant, and each publish is a commit to your repository. The code stays your developers', on the host you choose — or on Cloudflare's edge through [Galley Cloud](/cloud/).

So the real question is who makes the site. If designers build it on a freeform CSS canvas without developers, Webflow is made for that and Galley isn't. If developers build it and the rest of the team keeps it fresh, Galley keeps your code in Git and avoids per-seat and per-locale fees. People weighing Webflow often look at WordPress too; we set Galley beside it on [its own page](/wordpress/).

## How much does each cost?

As of November 2026, Webflow charges for each site and for the team separately. Its Site plans, per site, in US dollars:

| Plan | Paid yearly | Paid monthly | What it covers |
| --- | --- | --- | --- |
| Starter | Free | Free | A webflow.io address, 2 static pages, 50 CMS items in 20 Collections |
| Basic | $15 a month | $25 a month | Your own domain, 300 static pages, no CMS |
| Premium | $25 a month | $39 a month | The CMS: 20,000 items in 40 Collections, 50 GB of bandwidth |
| Team | $2,500 a month | Not offered | A Platform plan: a site, 5 full and 5 limited seats, 100 Collections |
| Enterprise | Priced on request | Priced on request | Custom roles, single sign-on, EU hosting |

Workspace plans add $19–$60/month (in-house) or $16–$42/month (freelancer/agency), extra seats cost $39/month yearly ($45 monthly) for designers and $15 ($19) for content editors, and Localize adds $9+/month per locale paid yearly. Those figures are from [Webflow's pricing page](https://webflow.com/pricing).

Galley is free and Apache-2.0 locally (`npx galley-cms` or the Apple-signed and notarized macOS desktop app) or self-hosted on your own server with Docker (`ghcr.io/fictiontribe/galley`), including OIDC SSO, visual section building, multilingual translation and scheduled publishing. For managed hosting with no keys to paste, [Galley Cloud](/cloud/) (opening by invitation) hosts both a dedicated editor machine per site and the published site on Cloudflare's global edge, with monthly AI credits, translations, pre-built scheduled publishing and Search and AI intelligence included and **no per-seat fees** (up to 500 named people per workspace, 100 per site): Partner is $0 a month for agencies whose clients pay directly (earning 15% of handed-over Site invoices), Site is $35 a month, Agency is $99 a month (5 live sites included, then $15–$12 per extra site), and Business is $149 a month.

## Who designs the site, and how does page building work?

In Webflow, designers draw layouts, styles, components and animations visually on a freeform CSS canvas without writing code. For marketers who shouldn't alter the design, designers lock page templates and components.

In Galley, your developers own the design system in code. Galley's built-in visual [Arrange](/docs/editing/page-builder/) page builder lets editors select, drag, reorder, duplicate and drop new sections from a visual thumbnail palette directly onto the rendered page, toggle layout options live and undo safely — keeping every page firmly inside the site's design system while landing surgical edits in Proof. Content mode keeps editors and the assistant on content and media only; Build mode (which can edit code and styles) is restricted to editors/owners and can be switched off.

## What does a developer have to set up?

In Webflow, Collections, templates and editable element rules are configured inside Webflow. Custom code requires a paid plan.

In Galley, developers build the site as they would without a CMS. Then Galley reads the framework, content collections and field types from the site's schemas and files without running its code. Astro fits deepest; Docusaurus, Nuxt, Next.js, SvelteKit, Eleventy, Hugo and Jekyll are recognised by their conventions. A `galley.config.json` file exists only to correct what Galley found.

## How does each one use AI, translations and search intelligence?

Webflow AI includes an AI site builder, an in-app Assistant (with beta section design on select templates), copy/CMS generation, on-page SEO/AEO metadata, Localize AI translation (paid add-on), and an official hosted MCP server, running on shared Workspace AI credits (200–400/month on lower plans).

Galley is AI-first for running and growing live websites across both open source and [Galley Cloud](/cloud/):

- **Page-aware built-in assistant.** [Ask in plain words](/how-to/ask-the-assistant/) beside the page; it reads the site before it edits, builds and arranges sections, reads brand and voice guidelines from your materials or live site, rebuilds WordPress imports, touches only content and media in content mode, has no shell or network tool, and **never publishes**.
- **Multi-provider image and short video generation.** Generate images and short video clips across OpenAI, Google Gemini and OpenRouter straight into the media library.
- **Built-in multilingual (`i18n`) translation — no per-locale add-on.** Configure target languages, localized URL slugs, `hreflang` alternates and Astro `<LanguageSelector />` / `<LocaleHead />` components ([Languages](/docs/editing/languages/)); edit side by side with automatic out-of-sync flags when the source changes, or translate pages and entire sites with AI using a Git-tracked **Translation Memory** (0-credit reuse), a brand/product **Glossary** and an upfront cost estimate — every translated page waiting in Proof.
- **Built-in Search and AI intelligence.** On-site SEO and structured-data checks, live Google search rankings, striking-distance (`#4–#15`) quick wins, keyword explorer, competitor content gaps, broken-404 backlink recovery with one-click redirects, and AI search answer citations — included on every Galley Cloud plan (at zero AI credits for lookups) or self-hosted with your own search data key, without a separate Semrush or Ahrefs subscription for everyday site SEO.
- **AI-first published output and MCP.** Publishes `llms.txt`, `llms-full.txt`, `agent.md`, Markdown twins of every page and per-AI-crawler `robots.txt` switches ([AI-first websites](/ai-first/)), plus [Galley's MCP server](/docs/integrations/mcp/) (publishing over MCP can be switched off).

Webflow's AI does more for generating freeform visual designs from scratch. Galley does more for ongoing search intelligence, built-in multilingual translation with Translation Memory, AI-ready static output and readable Proof before anything goes live.

## How do you check a change and schedule publishing?

In Webflow, edits save as you go, staging uses `webflow.io`, scheduled CMS items require Premium, and page branching with merge summaries is gated to Team ($2,500/month) and Enterprise.

In Galley every change — from the form, the page, Arrange, translation or the assistant — lands in [Proof](/how-to/proof-and-publish/): word-by-word markup beside the live site, where any single change can be put back and publishing is a commit or pull request. Galley also includes **scheduled publishing** on both editions: free in open source (server scheduler, `galley schedule` CLI, entry `publishAt` date/time matching and one-click GitHub Actions workflow), and pre-built zero-latency Cloudflare edge deploys on every [Galley Cloud](/cloud/) plan (verified ahead of time with a shareable preview link, going live at the exact scheduled minute even while the editor machine is asleep, with instant rollback without rebuilding).

## Who hosts the site?

Webflow hosts paid Site plans inside its own platform — "No, you can only develop websites in Webflow. If you export your code, it can’t be reimported."

Galley gives you full portability with zero lock-in: publish to Git and host on any static provider (AWS, Google Cloud, Azure, Cloudflare, Vercel, Netlify), deploy straight to Cloudflare from the editor (verified on the real service; external media buckets support Cloudflare R2, Amazon S3 and Cloudflare Images), or run on [Galley Cloud](/cloud/) (opening by invitation) for Cloudflare global edge delivery, automatic SSL, custom domains in one DNS record, and 30–90 day nightly backups. Forms and redirects are built in.

## Which one suits a team?

Webflow offers eight roles, live canvas collaboration for up to 25 people, on-page comments, SOC 2 Type II and ISO 27001 — with per-seat billing ($15–$19/month for limited editor seats since Webflow retired its legacy Editor on 5 October 2026) and SSO locked to Enterprise.

Galley eliminates per-seat billing and the SSO paywall:

- **Free OpenID Connect (OIDC) SSO self-hosted:** A [hosted editor](/docs/running/hosted/) (`ghcr.io/fictiontribe/galley`, one isolated container per site) adds owner, editor and contributor accounts plus OpenID Connect single sign-on (Authorization Code with PKCE, IdP role-claim mapping, `GALLEY_OIDC_ONLY`, Back-Channel Logout) built into the free Apache-2.0 server; see [`/enterprise/`](/enterprise/). On self-hosted installs, editors share one copy and a conflicting save is refused; roles organize work while the container is the security boundary.
- **Real-time collaboration & zero per-seat fees on [Galley Cloud](/cloud/):** Built-in live presence, active field outlines, simultaneous Markdown typing, and per-author Proof for up to 500 named people per workspace and 100 per site with **$0 per-seat fees**.

## Where does Galley fall short?

In clear places:

- **It isn't a freeform visual design tool.** It arranges the site's own sections and edits copy/media; custom CSS layouts and animations live in code.
- **It needs developers first.** Someone builds the site (or customises a starter) in code.
- **It's young.** Version {version} of software first released in November 2026, with no SOC 2 Type II or ISO 27001 certification yet. Webflow started in 2013.
- **No built-in ecommerce or on-page reviewer comments.** (A Shopify storefront starter is in progress.)
- **Galley Cloud is opening by invitation.** Self-hosted and local installs are available today (help via GitHub issues; self-hosted AI uses your own keys).

## When is Webflow the better choice?

When designers build the site on a freeform visual canvas and nobody wants to write code. When up to 25 people collaborate on visual layouts with on-page comments and design approvals. When you need built-in ecommerce, SOC 2 Type II, ISO 27001 or hundreds of Webflow marketplace apps today.

Galley fits when developers build your site and marketers keep it fresh: visual section building ([Arrange](/docs/editing/page-builder/)), AI editing, built-in translations with Translation Memory and a Glossary, live Google rankings and 404 backlink recovery, scheduled publishing, readable Proof, free OIDC SSO self-hosted, and Cloudflare-hosted [Galley Cloud](/cloud/) with zero per-seat fees — while your code and content stay in Git.

## Can you move from one to the other?

From Webflow to Galley, it's a rebuild. Galley has no importer for Webflow; its only guided move is from WordPress, and that is new and in final checks. Webflow's code export leaves out CMS content, localised pages and form handling, and Collection pages export empty; CMS items export as CSV per Collection with links to Webflow-hosted images. A developer rebuilds the site in a framework, converts the CSVs to Markdown/data files and downloads the images, then Galley reads it.

From Galley to Webflow, the content is already files in your repository, though Webflow can't import the site's code so the design is rebuilt in its Designer and content goes in via CSV.

## Three questions to ask before you choose

**Who will make the site, and who will change it after launch?** If designers do both without code, Webflow. If developers make it and marketers change it, ask how each tool keeps the design safe and what each editor seat and locale costs.

**When the AI makes a change, who sees it before it is live, and in what form?** A canvas shows the new page; branch summaries require Webflow's $2,500/month Team plan. Ask what a reviewer sees on your plan.

**What do you take with you if you leave?** From Webflow, a static export and a CSV file per Collection. From Galley, the repository. Know the answer before you need it.
