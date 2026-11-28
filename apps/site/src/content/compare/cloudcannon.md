---
title: "Galley vs CloudCannon: two Git-based CMSs compared"
description: Galley and CloudCannon both keep your content in Git. How they differ on setup, page building, AI, scheduling, translations, SSO, collaboration, hosting and price, and when CloudCannon wins.
kind: versus
product: CloudCannon
heading: CloudCannon and Galley agree about Git. They part ways on where the AI sits.
name: Galley and CloudCannon
lead: Both edit the plain files in your repository and record changes as commits. CloudCannon is a hosted service, founded in 2013, that leaves AI to the agents you bring. Galley is an AI-first, open-source CMS (Apache-2.0) with optional managed hosting on Galley Cloud — giving teams visual section building, built-in AI, translations, search intelligence, scheduled publishing, free OIDC SSO and live collaboration.
published: "2026-11-25"
updated: "2026-11-28"
checked: November 2026
order: 1
draft: false
short:
  - Both are Git-based. Your content stays as Markdown, JSON, YAML or TOML files in your own repository, and a change becomes a commit when you save in CloudCannon and when you publish in Galley. Leaving either one needs no content migration.
  - CloudCannon is a paid, hosted service starting at $55 a month for three users ($49 paid yearly, as of November 2026), with extra users at $10 a month. Galley is free and Apache-2.0 locally or self-hosted; [Galley Cloud](/cloud/) (opening by invitation) adds Cloudflare edge hosting, monthly AI credits and Search intelligence from $35 a month per site ($99 on Agency for five sites), with no per-seat fees.
  - CloudCannon asks a developer for a configuration file and, for visual editing, markup in the templates. Galley reads the site's framework, collections and fields as they already are, and includes the visual [Arrange](/docs/editing/page-builder/) section builder with zero template markup.
  - "Galley is AI-first for websites: a page-aware assistant that never publishes, multi-provider image and short video generation, whole-site AI translations with a Git-tracked Translation Memory and Glossary, live Google rankings and 404 backlink recovery, `llms.txt` and Markdown twins, scheduled publishing, and MCP — whereas CloudCannon has no built-in editor AI (Nov 2026)."
  - "Choose CloudCannon if you need what thirteen years have built: live-today self-serve hosting without an invitation, custom file-level permission groups, SAML SSO, SOC 2 Type 2, and a published uptime SLA."
table:
  heading: Galley and CloudCannon, side by side.
  text: Where CloudCannon does more, the table says so.
  caption: Galley compared with CloudCannon
  columns: [What differs, Galley, CloudCannon]
  rows:
    - label: Your content
      ours: Files in your Git repository
      theirs: Files in your Git repository
      better: even
    - label: Price
      ours: Free open source; Galley Cloud from $35/mo w/ site hosting & $0/seat (Nov 2026)
      theirs: Standard, $55/mo for 3 users (+$10/seat), hosting included (Nov 2026)
      better: ours
    - label: Setup
      ours: Reads the site as it is; zero template markup
      theirs: A config file (its app or CLI can draft it); markup for editing on the page
      better: ours
    - label: Page building
      ours: Visual Arrange builder drags, duplicates & drops the site's sections — zero markup
      theirs: Components in the visual editor (requires markup and integration package)
      better: even
    - label: AI & search intelligence
      ours: AI-first — assistant (never publishes), image/video gen, AI translations w/ TM & glossary, live rankings/404 recovery, llms.txt, MCP
      theirs: None built in (Nov 2026); bring your own agents
      better: ours
    - label: Checking a change
      ours: Word-by-word Proof beside the live site, put back any change, Cloud preview links
      theirs: Live preview and a list of changed files
      better: ours
    - label: Languages
      ours: Built-in i18n, side-by-side editing, AI translation w/ Translation Memory & glossary
      theirs: Open-source Rosey tool
      better: ours
    - label: Scheduled publishing
      ours: Built in free (scheduler/CLI/publishAt) & pre-built zero-latency edge deploys on every Cloud plan
      theirs: Content scheduling on Standard; advanced scheduling on Team
      better: ours
    - label: Building and hosting
      ours: Direct Cloudflare deploy free + Galley Cloud (by invite) Cloudflare edge w/ instant rollback & backups
      theirs: Builds and hosts on Cloudflare live today without invitation, with forms and redirects
      better: even
    - label: Teams & SSO
      ours: Free OpenID Connect SSO in Apache-2.0 server, 3 roles, $0/seat on Cloud (up to 500)
      theirs: Five roles; custom file-level groups on Team; SAML SSO locked to Enterprise
      better: ours
    - label: Two people at once
      ours: Real-time multiplayer co-editing & live presence on Cloud; safe save checks self-hosted
      theirs: One editor per file, others watch live
      better: ours
    - label: Where it runs
      ours: Local app/CLI, self-hosted Docker, or Galley Cloud (by invite)
      theirs: CloudCannon's hosted app only
      better: ours
    - label: Maturity & compliance
      ours: First released November 2026; no SOC 2 or SLA yet
      theirs: Founded 2013; SOC 2 Type 2, live-today self-serve, uptime SLA
      better: theirs
faq:
  - q: Is Galley an alternative to CloudCannon?
    a: For many static sites, yes. Both edit the files in your Git repository and record changes as commits (CloudCannon on each save, Galley when you publish). Galley is free and Apache-2.0 locally or self-hosted (with optional Cloudflare hosting and live co-editing on [Galley Cloud](/cloud/)), needs no configuration or template markup for common setups, and builds in visual section building ([Arrange](/docs/editing/page-builder/)), an AI assistant, multilingual translation with Translation Memory, live search rankings, scheduled publishing and free OIDC SSO. CloudCannon adds a thirteen-year track record, custom file-level permissions, SOC 2 Type 2, live self-serve hosting today and an uptime agreement.
  - q: Is CloudCannon open source?
    a: "The CMS itself isn't described as open source on CloudCannon's pages, and they don't offer a self-hosted version for editors. Its command-line tool can run the app against local files, for developers building the setup. CloudCannon does publish open-source tools, among them Pagefind for search, Bookshop for components and Rosey for translations. Galley is open source under Apache-2.0: it runs on your own computer (CLI or Apple-signed macOS desktop app), on your own server with Docker (`ghcr.io/fictiontribe/galley`), or hosted on [Galley Cloud](/cloud/)."
  - q: Does CloudCannon have AI features?
    a: As of November 2026, its pages describe no AI assistant built into the CMS. CloudCannon calls itself "AI-ready". Because content is plain files in Git, outside agents such as Cursor, Claude Code or Copilot can work on it, and their changes go through pull requests. It also publishes agent skills that help coding agents set sites up on CloudCannon.
  - q: How much does CloudCannon cost?
    a: As of November 2026, Standard is $55 a month or $49 a month paid yearly, with three users. Team is $350 a month or $300 paid yearly, with fifteen. Enterprise is priced on request, and extra users are $10 a month each. There is a 21-day free trial and no free plan. Galley is free locally or self-hosted (bringing your own AI key); [Galley Cloud](/cloud/) (opening by invitation) starts at $35 a month for a handed-over client Site or $99 a month on Agency (five live sites included, then $15–$12 per extra site), with Cloudflare hosting, monthly AI credits and Search intelligence included and no per-seat fees.
  - q: Can two people edit the same page at once?
    a: On [Galley Cloud](/cloud/), yes — teammates see live presence in the top bar and page list, active field outlines with each person's name, and simultaneous typing in Markdown body text, with each author attributed in Proof. On local or self-hosted Galley installs, editors share one copy and a conflicting save is refused rather than silently overwritten. In CloudCannon, one person edits a file at a time while others watch the changes live, with avatars showing who is where.
  - q: Do I have to change my templates to use Galley?
    a: "No. Galley adds no dependency, integration or build plugin, and on-page editing and visual [Arrange](/docs/editing/page-builder/) section building need no markup. A site that keeps its words in content files gets a better form, and Astro sites with schemas get the most. Optional features such as forms, the consent banner, and multilingual `<LanguageSelector />` / `<LocaleHead />` components come from its site kit, added as changes you check in Proof first."
sources:
  - label: "CloudCannon, home page"
    href: https://cloudcannon.com/
  - label: "CloudCannon, pricing"
    href: https://cloudcannon.com/pricing/
  - label: "CloudCannon, AI-ready CMS"
    href: https://cloudcannon.com/ai-llm-cms/
  - label: "CloudCannon, official AI information"
    href: https://cloudcannon.com/ai-info/
  - label: "CloudCannon, for developers"
    href: https://cloudcannon.com/for-developers/
  - label: "CloudCannon, open source"
    href: https://cloudcannon.com/open-source/
  - label: "CloudCannon agent skills, on GitHub"
    href: https://github.com/CloudCannon/agent-skills
  - label: "CloudCannon, company"
    href: https://cloudcannon.com/company/
  - label: "CloudCannon documentation, what is the configuration file"
    href: https://cloudcannon.com/documentation/developer-articles/what-is-the-cloudcannon-configuration-file/
  - label: "CloudCannon documentation, the command-line tool"
    href: https://cloudcannon.com/documentation/developer-reference/cli/
  - label: "CloudCannon documentation, the publishing page"
    href: https://cloudcannon.com/documentation/user-articles/what-is-the-publishing-page/
  - label: "CloudCannon documentation, an overview of Editable Regions"
    href: https://cloudcannon.com/documentation/developer-guides/set-up-visual-editing/an-overview-of-editable-regions/
  - label: "CloudCannon documentation, editing sessions and collaboration"
    href: https://cloudcannon.com/documentation/user-guides/editing-in-cloudcannon/editing-sessions-and-collaboration/
  - label: "CloudCannon documentation, default permission groups"
    href: https://cloudcannon.com/documentation/user-articles/what-are-default-permission-groups/
  - label: "CloudCannon documentation, publishing methods"
    href: https://cloudcannon.com/documentation/user-articles/what-are-publishing-methods/
  - label: "CloudCannon documentation, forms"
    href: https://cloudcannon.com/documentation/developer-articles/what-is-a-form/
  - label: "CloudCannon, security"
    href: https://cloudcannon.com/security/
  - label: "CloudCannon, changelog"
    href: https://cloudcannon.com/documentation/changelog/
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
related: [types-of-cms, /wordpress/, /ai-first/]
---

## What do Galley and CloudCannon have in common?

More than either has in common with WordPress or a headless CMS. Both are Git-based: the words of the site are the files in its repository, and the CMS is a way to change those files without opening a code editor. CloudCannon puts it plainly: "CloudCannon stores content as files in your Git repo — Markdown, JSON, YAML, or TOML — and builds your static site directly from them." Galley edits Markdown, JSON and YAML the same way; it reads TOML but doesn't change it yet.

That shared starting point has two consequences worth knowing before anything else. There is no database behind the live site to run or patch. And neither tool holds your content hostage. CloudCannon's developer page says "If you ever leave CloudCannon, you leave with everything." We say the same about Galley, for the same reason.

## How much does each cost?

As of November 2026, CloudCannon has three plans you can buy and one for agency partners:

| Plan | Monthly | Paid yearly | Users included |
| --- | --- | --- | --- |
| Standard | $55 a month | $49 a month | 3 |
| Team | $350 a month | $300 a month | 15 |
| Enterprise | Priced on request | Priced on request | Agreed with you |

Every plan covers unlimited sites. Extra users are $10 a month each, and bandwidth beyond the plan's allowance (110 GB on Standard, 700 GB on Team) is $15 per 100 GB. A Lite plan at $10 a month is for agency partners' smaller clients. There is a 21-day trial and no free plan. Those figures are from [CloudCannon's pricing page](https://cloudcannon.com/pricing/); check it before you decide, because plans change.

Galley comes in two shapes. The open-source software is free under Apache-2.0: run it locally (`npx galley-cms` or the Apple-signed and notarized macOS desktop app) or self-host it on your own server with Docker (`ghcr.io/fictiontribe/galley`), bringing your own AI key and static hosting.

If you want managed hosting with no keys to paste, [Galley Cloud](/cloud/) (opening by invitation as of November 2026) runs a dedicated editor machine for each site, serves the live site on Cloudflare's global edge, and includes monthly AI credits, pre-built scheduled publishing and Search and AI intelligence — with **nobody charged by the seat** (up to 500 named people per workspace, 100 per site):

| Plan | Price | What's included |
| --- | --- | --- |
| Partner | $0 a month | For agencies whose clients pay directly; earns 15% of handed-over Site invoices |
| Site | $35 a month | One handed-over client site, 4,000 AI credits a month |
| Agency | $99 a month | 5 live sites included ($15–$12 per extra site) |
| Business | $149 a month | 12,000 AI credits a month, 90-day nightly repository backups |

The difference for growing teams is per-seat billing. CloudCannon charges $10 a month per extra user past 3 on Standard or 15 on Team. Galley Cloud never charges per editor seat.

## What does a developer have to set up, and how does page building work?

CloudCannon starts from a configuration file in the root of your repository (its CLI's `configure generate` and Configuration Mode can draft much of it). Editing on the page in its Visual Editor needs markup in your templates (`data-editable="text"` or `<editable-text>`), and visual component editing needs an integration package plus a working CloudCannon build.

Galley starts by reading the site. It works out the framework, the content collections and every field's type from the site's own schemas and files, without running any of its code. Astro fits deepest; Docusaurus, Nuxt, Next.js, SvelteKit, Eleventy, Hugo and Jekyll are recognised by their conventions. A `galley.config.json` file exists only to correct what it found. Editing on the page needs no markup, and Galley's built-in visual [Arrange](/docs/editing/page-builder/) page builder lets editors select, drag, reorder, duplicate and drop new sections from a visual thumbnail palette directly onto static pages, toggle layout options live and undo safely — with every change landing surgically in Proof.

The honest caveat on our side: detection is only as good as the site is tidy. A site that keeps its words in content files, with schemas, gets a good form with no work. A site whose copy is hard-coded in components gets less, until someone moves the words out.

## How does each one use AI, translations and search intelligence?

CloudCannon calls itself "the CMS your AI tools can actually read" and leaves AI to outside coding agents ("Cursor, Claude Code, GitHub Copilot, a locally hosted model, or something you built yourself") working on branches, plus open-source Rosey for translations. As of November 2026 we found no AI assistant built into CloudCannon's editor itself.

Galley is AI-first for websites on every edition (free open source and [Galley Cloud](/cloud/)):

- **Page-aware built-in assistant.** Ask in plain words beside the page. It reads the site before it edits, builds and arranges sections, reads brand and voice guidelines from your materials or live site, rebuilds WordPress imports, touches only content and media in content mode, has no shell or network tool, and **never publishes**.
- **Multi-provider image and short video generation.** Generate images and short video clips across OpenAI, Google Gemini and OpenRouter straight into the media library.
- **Whole-site and per-page AI translations.** Configure target languages, localized URL slugs, `hreflang` alternates and Astro `<LanguageSelector />` / `<LocaleHead />` components ([Languages](/docs/editing/languages/)); edit side by side with automatic out-of-sync flags when the source changes, or translate pages and entire sites with AI using a Git-tracked **Translation Memory** (0-credit reuse), a brand/product **Glossary** and an upfront cost estimate — every translated page waiting in Proof.
- **Built-in Search and AI intelligence.** On-site SEO and structured-data checks, one-click fixes into Proof, live Google search rankings, striking-distance (`#4–#15`) quick wins, keyword explorer, competitor content gaps, broken-404 backlink recovery with one-click redirects, and AI search answer citations — included on every Galley Cloud plan (at zero AI credits for lookups) or self-hosted with your own search data key.
- **AI-first published output and MCP.** Publishes `llms.txt`, `llms-full.txt`, `agent.md`, Markdown twins of every page and per-AI-crawler `robots.txt` switches ([AI-first websites](/ai-first/)), plus [Galley's MCP server](/docs/integrations/mcp/) (publishing over MCP can be switched off).

## How do you check a change and schedule publishing?

In CloudCannon, saving commits and rebuilds (or opens a pull request on Team/Enterprise), and content scheduling is available on Standard with advanced scheduling on Team.

In Galley every change — typed in the form, retyped on the page, arranged visually, translated or made by the assistant — lands in [Proof](/how-to/proof-and-publish/): word-by-word markup beside the live site, where any single change can be put back and publishing is a commit or pull request.

Galley also includes **scheduled publishing** on both editions:

- **Open source (free):** Schedule changes directly from Proof for an exact date and time (published automatically by the server scheduler or `galley schedule` CLI while holding scheduled changes safely aside so you can keep editing other pages), alongside entry `publishAt` date/time matching and a one-click GitHub Actions scheduled build workflow for pure static sites.
- **Galley Cloud (every plan):** Pre-built scheduled versions are verified ahead of time with a shareable preview link and promoted live at Cloudflare's edge at the exact scheduled minute — even while the editor machine is asleep, with zero build delay at launch time — alongside instant version rollback without rebuilding.

## Who builds and hosts the site?

CloudCannon builds and hosts on Cloudflare's network live today without waiting for an invitation, with SSL, DNS, redirects, forms and password-protected sites included (or BYO hosting).

Galley gives you both paths: keep your own hosting (AWS, Google Cloud, Azure, Cloudflare, Vercel, Netlify) and use Galley purely as the editing GUI for Git, deploy straight to Cloudflare from the editor (verified on the real service; external media buckets support Cloudflare R2, Amazon S3 and Cloudflare Images), or run on [Galley Cloud](/cloud/) (opening by invitation) for a dedicated editor machine per site plus Cloudflare global edge hosting, automatic SSL, custom domains in one DNS record, and 30–90 day nightly backups.

## Which one suits a team?

CloudCannon offers five default roles, custom file-level permission groups on Team and Enterprise, SAML SSO on Enterprise, SOC 2 Type 2, and single-editor-per-file live viewing.

Galley removes both the SSO paywall and per-seat billing:

- **Free OpenID Connect (OIDC) SSO self-hosted:** Self-hosted Galley (`ghcr.io/fictiontribe/galley`, one isolated container per site) includes owner, editor and contributor accounts plus OpenID Connect single sign-on (Authorization Code with PKCE, IdP role-claim mapping, `GALLEY_OIDC_ONLY`, Back-Channel Logout) built into the free Apache-2.0 server — no Enterprise contract required; see [`/enterprise/`](/enterprise/). On self-hosted installs, editors share one copy and a conflicting save is refused; roles organize work while the container is the security boundary.
- **Real-time multiplayer collaboration & zero per-seat fees on [Galley Cloud](/cloud/):** Teammates see faces in the top bar and page list, jump to each other's page, see active field outlines with each person's name, type together simultaneously in Markdown body text, and see each author attributed in Proof — for up to 500 named people per workspace and 100 per site with **$0 per-seat fees**.

## Where does Galley fall short?

In clear places:

- **It's young.** Version {version} of software first released in November 2026, with no SOC 2 Type 2 report or published uptime SLA yet. CloudCannon has a changelog going back to 2015.
- **Galley Cloud is opening by invitation.** CloudCannon's hosted service is open for immediate self-serve sign-up today.
- **Coarser permissions.** CloudCannon's Team and Enterprise plans offer custom permission groups narrowed to particular files. Galley has three fixed roles.
- **TOML is read-only.** Galley reads TOML files and Hugo's TOML front matter but refuses to change them. CloudCannon edits TOML.
- **Self-hosted AI needs your own keys.** Galley Cloud includes monthly AI credits; local and self-hosted AI uses your own API keys (everything else works without one).

## When is CloudCannon the better choice?

When your team is large, regulated or both, and needs custom file-level permissions, enforced two-factor sign-in, SAML SSO, a SOC 2 Type 2 report and an uptime SLA this quarter. When your media lives in Cloudinary or Azure Blob Storage and the CMS should connect directly to it. When you want a hosted CMS open for self-serve sign-up today with thirteen years of production history. Or when your developers already run AI agents against the repository and want the CMS to stay out of their way.

Galley fits when non-developers edit the site and you want visual section building ([Arrange](/docs/editing/page-builder/)) with zero markup, an AI-first editor with Proof, built-in translations with Translation Memory and a Glossary, live Google rankings and 404 backlink recovery, scheduled publishing, free open-source OIDC SSO, real-time multiplayer co-editing on [Galley Cloud](/cloud/), and zero per-seat fees.

## Can you move from one to the other?

Yes, and it's easier than most CMS moves, because the content never leaves the repository. To try Galley on a site that uses CloudCannon, run `npx galley-cms` in the site's folder, or open the repository in the macOS desktop app. CloudCannon's own files (`cloudcannon.config.*`, the `.cloudcannon` folder, and the editable-region attributes in templates) can stay while you try. If you leave CloudCannon, its forms, redirects and hosting stop with it, and those are the parts to replace. Galley has forms and redirects of its own, deploys directly to Cloudflare, and offers managed Cloudflare edge hosting on [Galley Cloud](/cloud/).

## Three questions to ask before you choose

**Who sets up the editor, and who keeps it in step with the site?** Ask how many files and how much template markup a new collection takes.

**When the AI makes a change, who sees it before it is live, and in what form?** A pull request reads well to a developer. Ask what the marketer sees.

**What happens to the site if you stop paying, or add ten more editors?** With CloudCannon, your files stay in your repository, its hosted domains go offline when a subscription stops, and extra seats cost $10 a month each. With Galley, you can always keep editing locally or self-host the open-source server at zero licence cost, and Galley Cloud doesn't charge per seat. Know the answer for any tool before you need it.
