---
title: "Galley vs TinaCMS: two Markdown CMSs compared"
description: TinaCMS and Galley both edit Markdown in your Git repository. How they differ on setup, page building, AI, scheduling, translations, SSO, hosting, teams and price, and when TinaCMS wins.
kind: versus
product: TinaCMS
heading: TinaCMS and Galley both keep your words in Git. TinaCMS asks a developer to describe them first.
name: Galley and TinaCMS
lead: Both edit the Markdown and data files in your repository and record changes as commits, TinaCMS when you save and Galley when you publish. TinaCMS, in development since 2019, adds a schema in code, a GraphQL API and visual editing for React and Astro, with its AI marked coming soon (November 2026). Galley is AI-first and open source (Apache-2.0) with optional Cloudflare hosting on Galley Cloud — reading the site as it is and building in visual section building, AI, translations, search intelligence, scheduled publishing and free OIDC SSO.
published: "2026-11-25"
updated: "2026-11-28"
checked: November 2026
order: 4
draft: false
short:
  - Both are Git-based. Your content stays as Markdown and data files in your own repository, and leaving either one needs no content migration. In TinaCMS every save is a commit. In Galley changes wait in Proof, and publishing is the commit.
  - TinaCMS has a free plan for two users; Team is $29 a month per project ($290 a year, plus $9 per extra user, as of November 2026) without website hosting, and TinaCloud works with GitHub only. Galley is free under Apache-2.0 locally or self-hosted on any Git host; [Galley Cloud](/cloud/) (opening by invitation) adds Cloudflare edge website hosting, monthly AI credits and Search intelligence from $35 a month per site ($99 on Agency for five sites), with no per-seat fees.
  - TinaCMS asks a developer for a schema in `tina/config`, a build step and, for visual editing on Astro, an SSR adapter plus per-page `tinaField()` wiring. Galley reads the site as it is and gives editors on-page editing and visual [Arrange](/docs/editing/page-builder/) section building on static pages with zero SSR or markup.
  - "TinaCMS lists AI features and MCP as \"coming soon\" (November 2026) and has no built-in scheduled publishing. Galley is AI-first today: a page-aware assistant that never publishes, image and short video generation, whole-site AI translations with Translation Memory and a Glossary, live Google rankings and 404 backlink recovery, `llms.txt` and Markdown twins, scheduled publishing, and MCP."
  - Choose TinaCMS if you need a typed GraphQL content API, live-as-you-type React/Next.js visual editing, branch-per-editor pull requests on Team, or a 2019 track record with SSW Enterprise support today.
table:
  heading: Galley and TinaCMS, side by side.
  text: Where TinaCMS does more, the table says so.
  caption: Galley compared with TinaCMS
  columns: [What differs, Galley, TinaCMS]
  rows:
    - label: Your content
      ours: Files in your Git repository
      theirs: Files in your GitHub repository
      better: even
    - label: Git host
      ours: Any Git remote, or none
      theirs: GitHub only, on TinaCloud
      better: ours
    - label: Price
      ours: Free Apache-2.0; Galley Cloud from $35/mo w/ site hosting & $0/seat (Nov 2026)
      theirs: Free for 2; Team $29/project/mo (+$9/extra seat), no site hosting (Nov 2026)
      better: ours
    - label: Setup
      ours: Reads the site as it is; zero SSR or template markup
      theirs: Schema in tina/config, tinacms build step, SSR adapter & tinaField() marks on Astro
      better: ours
    - label: Page building & on-page editing
      ours: Visual Arrange section builder & click-to-edit on static pages — zero markup
      theirs: Live-as-you-type visual editing & blocks in React and Astro (requires wiring & SSR)
      better: even
    - label: AI & search intelligence
      ours: AI-first — assistant (never publishes), image/video gen, AI translations w/ TM & glossary, live rankings/404 recovery, llms.txt, MCP
      theirs: AI and MCP marked coming soon (Nov 2026)
      better: ours
    - label: Checking a change
      ours: Word-by-word Proof beside the live site, single-change undo, Cloud preview links
      theirs: Live preview; pull requests on Team and up
      better: ours
    - label: Scheduled publishing
      ours: Built in free (scheduler/CLI/publishAt) & pre-built edge deploys on every Cloud plan
      theirs: None found in TinaCMS docs or roadmap
      better: ours
    - label: Teams, SSO & collaboration
      ours: Free OIDC SSO in Apache-2.0 server + real-time co-editing & $0/seat on Cloud
      theirs: Three roles; branch-per-editor workflow on Team; SAML/OIDC SSO locked to Enterprise
      better: ours
    - label: Content API
      ours: Built for websites; the site reads Git files directly
      theirs: GraphQL API with a typed client
      better: theirs
    - label: Where the editor runs
      ours: Local app/CLI, self-hosted Docker, or Galley Cloud; never on your live domain
      theirs: At /admin on your site, backed by TinaCloud or a self-hosted DB
      better: ours
    - label: Maturity
      ours: First released November 2026
      theirs: Repository since 2019; SSW support & 99.9% Enterprise SLA
      better: theirs
faq:
  - q: Is Galley an alternative to TinaCMS?
    a: "For many static sites, yes. Both edit the Markdown and data files in your Git repository and commit the changes. Galley is free and Apache-2.0 locally or self-hosted (with optional Cloudflare hosting and live co-editing on [Galley Cloud](/cloud/)), needs no schema, SSR adapter or page code for common setups, and ships visual section building ([Arrange](/docs/editing/page-builder/)), an AI assistant, multilingual AI translation with Translation Memory, live search rankings, scheduled publishing and free OIDC SSO today. TinaCMS stays the better choice for a typed GraphQL content API, live-as-you-type React visual editing, branch-per-editor workflows on Team, or SSW Enterprise support."
  - q: How much does TinaCMS cost?
    a: As of November 2026, TinaCloud's Free plan is $0 for two users. Team is $29 a month per project, or $290 a year, with three users included and up to ten ($9/extra user). Business is $299 a month or $2,990 a year, with twenty ($18/extra user). Enterprise is priced on request. Galley is free under Apache-2.0 locally or self-hosted (bringing your own AI key); [Galley Cloud](/cloud/) (opening by invitation) starts at $35 a month per site ($99 on Agency for five sites, $149 on Business), with Cloudflare website hosting, monthly AI credits and Search intelligence included and no per-seat fees.
  - q: Is TinaCMS open source?
    a: Its main repository on GitHub is Apache-2.0, and TinaCMS says the whole CMS, "including its Data Layer, is open-source". TinaCloud, the hosted backend the paid plans buy, is a service, and we found no public source for it. You can host the backend yourself, without TinaCloud's Git-backed media, branch switching at runtime or search. Galley is Apache-2.0 and runs on your computer, on your own server with Docker (`ghcr.io/fictiontribe/galley`, with OIDC SSO built in), or hosted on [Galley Cloud](/cloud/).
  - q: Does TinaCMS have AI features?
    a: Not built in, as of November 2026. Its pricing page lists "AI features (coming soon)" on the Team plan, and its roadmap has an MCP server under "Coming Soon". It publishes a guide to coding with AI assistants and an `llms.txt` index of its docs, and argues that Markdown suits AI. Galley has an assistant in the editor, multilingual AI translation with Translation Memory, image/video generation, search intelligence and an MCP server today.
  - q: Does TinaCMS need a database?
    a: Yes, behind its API, though not as the home of your content. TinaCMS's GraphQL API is served from a "Data Layer" database, which its docs say you can think of as "more of an ephemeral cache" of your Markdown and JSON files, there for search, pagination and references. TinaCloud runs that database for you. If you host the backend yourself, you bring one; TinaCMS has adapters for MongoDB and Vercel KV. Galley has no database.
  - q: Which frameworks does TinaCMS support?
    a: Its setup guides cover Astro, Next.js, Hugo, Gatsby, Jekyll, Eleventy, Remix and SvelteKit, and Astro is its default starter. Visual editing, where the page updates as you type, works in React-based frameworks and in Astro (with an SSR adapter). Elsewhere editors get its "basic editor", which is forms. Galley fits Astro deepest and recognises Next.js, Hugo, Jekyll and others by their conventions — with zero SSR required.
sources:
  - label: "TinaCMS, home page"
    href: https://tina.io/
  - label: "TinaCMS, pricing"
    href: https://tina.io/pricing
  - label: "TinaCMS, roadmap"
    href: https://tina.io/roadmap
  - label: "TinaCMS, about"
    href: https://tina.io/about
  - label: "TinaCMS, goodbye Forestry.io"
    href: https://tina.io/forestry
  - label: "TinaCMS, enterprise"
    href: https://tina.io/enterprise
  - label: "TinaCMS, security"
    href: https://tina.io/security
  - label: "TinaCMS, editorial workflow"
    href: https://tina.io/editorial-workflow
  - label: "TinaCMS documentation, introduction"
    href: https://tina.io/docs
  - label: "TinaCMS documentation, FAQ"
    href: https://tina.io/docs/introduction/faq
  - label: "TinaCMS documentation, the Data Layer"
    href: https://tina.io/docs/reference/content-api/data-layer
  - label: "TinaCMS documentation, collections"
    href: https://tina.io/docs/reference/collections
  - label: "TinaCMS documentation, content modelling"
    href: https://tina.io/docs/schema
  - label: "TinaCMS documentation, the tina folder"
    href: https://tina.io/docs/tina-folder/overview
  - label: "TinaCMS documentation, TinaCloud"
    href: https://tina.io/docs/tinacloud/overview
  - label: "TinaCMS documentation, frameworks"
    href: https://tina.io/docs/integration/frameworks
  - label: "TinaCMS documentation, visual editing in React"
    href: https://tina.io/docs/contextual-editing/react
  - label: "TinaCMS documentation, visual editing in Astro"
    href: https://tina.io/docs/contextual-editing/astro
  - label: "TinaCMS documentation, Astro"
    href: https://tina.io/docs/frameworks/astro
  - label: "TinaCMS documentation, visual editing in Vue"
    href: https://tina.io/docs/contextual-editing/vue
  - label: "TinaCMS documentation, blocks"
    href: https://tina.io/docs/editing/blocks
  - label: "TinaCMS documentation, the object field"
    href: https://tina.io/docs/reference/types/object
  - label: "TinaCMS documentation, the rich-text field"
    href: https://tina.io/docs/reference/types/rich-text
  - label: "TinaCMS documentation, self-hosting"
    href: https://tina.io/docs/self-hosted/overview
  - label: "TinaCMS documentation, database adapters"
    href: https://tina.io/docs/reference/self-hosted/database-adapter/overview
  - label: "TinaCMS documentation, editorial workflow"
    href: https://tina.io/docs/tinacloud/editorial-workflow
  - label: "TinaCMS documentation, commit authors"
    href: https://tina.io/docs/tinacloud/git-co-authoring
  - label: "TinaCMS documentation, internationalisation"
    href: https://tina.io/docs/guides/internationalization
  - label: "TinaCMS documentation, vibe coding"
    href: https://tina.io/docs/vibe-coding
  - label: "TinaCMS, on GitHub"
    href: https://github.com/tinacms/tinacms
  - label: "Galley, the FAQ for developers"
    href: /docs/project/faq/
  - label: "Galley, page builder"
    href: /docs/editing/page-builder/
  - label: "Galley, languages"
    href: /docs/editing/languages/
  - label: "Galley, the tour: what is built and what isn't yet"
    href: /tour/
  - label: "Galley, detection and schema inference"
    href: /docs/concepts/detection/
  - label: "Galley over MCP"
    href: /docs/integrations/mcp/
  - label: "Galley Cloud"
    href: /cloud/
  - label: "Galley for enterprise and security teams"
    href: /enterprise/
related: [cloudcannon, decap-cms, types-of-cms]
---

## What do Galley and TinaCMS have in common?

More than most pairs of CMSs. Both are Git-based, and both are a Markdown CMS in the plain sense: the words of the site are files in its repository, and the CMS changes them for people who don't open a code editor. TinaCMS's documentation says "All your content gets backed by git into JSON/Markdown/MDX files", and YAML and TOML work too. Galley edits the same files, except TOML, which it reads but doesn't change.

Both end in a commit. TinaCMS commits on save; Galley holds changes in Proof and commits on publish. They part on architecture: TinaCMS puts a GraphQL API and a Data Layer cache database between your files and your site, whereas Galley puts nothing in between.

## How much does each cost?

As of November 2026, TinaCMS sells TinaCloud, its hosted backend, by the project:

| Plan | Paid monthly | Paid yearly | Users included |
| --- | --- | --- | --- |
| Free | $0 | $0 | 2, the limit |
| Team | $29 a month | $290 a year | 3, up to 10 |
| Business | $299 a month | $2,990 a year | 20, no limit |
| Enterprise | Priced on request | Priced on request | Agreed with you |

Extra users are $9 a month on Team and $18 on Business, and TinaCloud does not host the website itself. Check [TinaCMS's pricing page](https://tina.io/pricing) before you decide.

Galley is free and Apache-2.0 locally (`npx galley-cms` or the Apple-signed and notarized macOS desktop app) or self-hosted with Docker (`ghcr.io/fictiontribe/galley`, including OIDC SSO, visual section building, AI translations and scheduled publishing), bringing your own AI key and static hosting. For managed hosting with no keys to paste, [Galley Cloud](/cloud/) (opening by invitation) hosts both a dedicated editor machine per site and the published site on Cloudflare's global edge, with monthly AI credits, pre-built scheduled publishing and Search and AI intelligence included and **no per-seat fees** (up to 500 named people per workspace, 100 per site): Partner is $0 a month for agencies whose clients pay directly, Site is $35 a month, Agency is $99 a month (5 live sites included, then $15–$12 per extra site), and Business is $149 a month.

## What does a developer have to set up, and how does page building work?

On TinaCMS, a developer runs `tinacms init`, models content in `tina/config`, checks in `tina-lock.json` and adds `tinacms build` to the build. Visual editing requires `useTina` in React/Next.js, or `@tinacms/astro`, an SSR adapter ("You need an SSR adapter"), a data loader, an island and `tinaField()` marks on Astro.

Galley starts by reading the site. It works out the framework, content collections and field types from the site's own schemas and files without running its code. Astro fits deepest; Next.js, Hugo, Jekyll, Eleventy and others are recognised by their conventions. A `galley.config.json` file exists only to correct what it found. Both click-to-edit on the page and Galley's visual [Arrange](/docs/editing/page-builder/) page builder (visually selecting, dragging, reordering, duplicating and dropping sections from a thumbnail palette, toggling layout options live and undoing safely) work directly on static pages with zero SSR or template markup.

The caveat on our side: words kept in content files get a good form with no work; copy hard-coded in components gets less until moved out.

## How does each one use AI, translations and search intelligence?

As of November 2026, we found no AI feature in the TinaCMS editor. Its pricing page lists "AI features (coming soon)" and its [roadmap](https://tina.io/roadmap) lists "MCP Server" under "Coming Soon".

Galley is AI-first today across both open source and [Galley Cloud](/cloud/):

- **Page-aware built-in assistant.** Ask in plain words beside the page; it reads the site before it edits, builds and arranges sections, reads brand and voice guidelines from your materials or live site, rebuilds WordPress imports, touches only content and media in content mode, has no shell or network tool, and **never publishes**.
- **Multi-provider image and short video generation.** Generate images and short video clips across OpenAI, Google Gemini and OpenRouter straight into the media library.
- **Whole-site and per-page AI translations.** Configure target languages, localized URL slugs, `hreflang` alternates and Astro `<LanguageSelector />` / `<LocaleHead />` components ([Languages](/docs/editing/languages/)); edit side by side with automatic out-of-sync flags when the source changes, or translate pages and entire sites with AI using a Git-tracked **Translation Memory** (0-credit reuse), a brand/product **Glossary** and an upfront cost estimate — every translated page waiting in Proof.
- **Built-in Search and AI intelligence.** On-site SEO and structured-data checks, live Google search rankings, striking-distance (`#4–#15`) quick wins, keyword explorer, competitor content gaps, broken-404 backlink recovery with one-click redirects, and AI search answer citations — included on Galley Cloud (at zero AI credits for lookups) or self-hosted with your own search data key.
- **AI-first published output and MCP.** Publishes `llms.txt`, `llms-full.txt`, `agent.md`, Markdown twins of every page and per-AI-crawler `robots.txt` switches ([AI-first websites](/ai-first/)), plus [Galley's MCP server](/docs/integrations/mcp/) (publishing over MCP can be switched off).

## How do you check a change and schedule publishing?

In TinaCMS, saving commits straight to the branch (or opens a pull request on Team and up with Editorial Workflow). We found no scheduled publishing on TinaCMS's pricing page, docs or roadmap.

In Galley every change — typed in the form, retyped on the page, arranged visually, translated or made by the assistant — lands in [Proof](/how-to/proof-and-publish/): word-by-word markup beside the live site, where any single change can be put back and publishing is a commit or pull request.

Galley also includes **scheduled publishing** on both editions:

- **Open source (free):** Schedule changes directly from Proof for an exact date and time (published automatically by the server scheduler or `galley schedule` CLI while holding scheduled changes safely aside so you can keep editing other pages), alongside entry `publishAt` date/time matching and a one-click GitHub Actions scheduled build workflow for pure static sites.
- **Galley Cloud (every plan):** Pre-built scheduled versions are verified ahead of time with a shareable preview link and promoted live at Cloudflare's edge at the exact scheduled minute — even while the editor machine is asleep, with zero build delay at launch time — alongside instant version rollback without rebuilding.

## How does the site get its content?

In TinaCMS, through its GraphQL Content API indexed by TinaCloud (GitHub only) or a self-hosted Node backend with MongoDB/Vercel KV (giving up Git-backed media, runtime branch switching and search), with `/admin` living on your site.

Galley has no API and no database. The build reads the files, and Galley adds no dependency or build plugin. Its editor runs locally, on your own server with Docker (`ghcr.io/fictiontribe/galley`), or on [Galley Cloud](/cloud/) — never on your live domain. It publishes to any Git remote, deploys directly to Cloudflare (external media buckets support Cloudflare R2, Amazon S3 and Cloudflare Images), and Galley Cloud serves the published site on Cloudflare's global edge with 30–90 day nightly backups.

## Which one suits a team?

TinaCMS offers Owner, Admin and Editor roles on every plan, branch-per-editor Editorial Workflow on Team, and SAML/OIDC SSO plus custom roles (beta) and a 99.9% SLA locked to Enterprise.

Galley removes both the SSO paywall and per-seat billing:

- **Free OpenID Connect (OIDC) SSO self-hosted:** A [hosted editor](/docs/running/hosted/) (`ghcr.io/fictiontribe/galley`, one isolated container per site) adds owner, editor and contributor accounts plus OpenID Connect single sign-on (Authorization Code with PKCE, IdP role-claim mapping, `GALLEY_OIDC_ONLY`, Back-Channel Logout) built into the free Apache-2.0 server — no Enterprise contract required; see [`/enterprise/`](/enterprise/). On self-hosted installs, editors share one copy and a conflicting save is refused; roles organize work while the container is the security boundary.
- **Real-time collaboration & zero per-seat fees on [Galley Cloud](/cloud/):** Built-in live presence, active field outlines, simultaneous Markdown typing, and per-author Proof for up to 500 named people per workspace and 100 per site with **$0 per-seat fees**.

## Where does Galley fall short?

Beside TinaCMS, in clear places:

- **No GraphQL content API.** If an app or a second front end needs a typed GraphQL API over your content, TinaCMS provides one and Galley doesn't.
- **It's young.** Version {version} of software first released in November 2026. TinaCMS's repository dates from 2019, maintained by SSW with an Enterprise SLA.
- **TOML is read-only.** Galley shows TOML files and Hugo's `+++` front matter, but won't edit them. TinaCMS edits both.
- **Galley Cloud is opening by invitation.** Self-hosted and local installs are available today (help via GitHub issues; self-hosted AI uses your own keys).

## When is TinaCMS the better choice?

When developers want a typed GraphQL API over Git-backed content, or live-as-you-type React/Next.js visual editing. When you want each editor's work on its own branch via Team Editorial Workflow, or SAML SSO, GitHub Enterprise and a 99.9% uptime SLA backed by SSW today.

Galley fits when non-developers edit a static site and you want visual section building ([Arrange](/docs/editing/page-builder/)) with zero SSR or markup, an AI-first editor with Proof, built-in translations with Translation Memory and a Glossary, live Google rankings and 404 backlink recovery, scheduled publishing, free OIDC SSO self-hosted, and Cloudflare-hosted [Galley Cloud](/cloud/) with real-time collaboration and no per-seat fees.

## Can you move from one to the other?

Yes, and more easily than most CMS moves, because the content never leaves the repository. Galley has no importer for TinaCMS, and needs none. To try it, run `npx galley-cms` in the site's folder. Galley doesn't read `tina/config`; it works the fields out from the files, and `galley.config.json` can point it at a folder it missed. By default TinaCMS stores each block's type under a `_template` key, which Galley's detection reads as page sections. In MDX, Galley edits the Markdown between components and leaves imports and components alone. The `tina` folder and `tinacms build` can stay while you try.

If you leave TinaCMS, pages wired for visual editing fetch through TinaCMS's API until a developer changes them to read files directly. A Hugo or Jekyll site on the basic editor reads them already. The only guided move Galley offers is from [WordPress](/wordpress/), and that one is new, in final checks.

## Three questions to ask before you choose

**Who writes the editor into the site, and who keeps it in step?** Ask what a new collection takes: a schema change, a lock file, SSR adapter, code in each page.

**When the AI makes a change, who sees it before it is live, and in what form?** Ask to see it working, not on a roadmap. A pull request reads well to a developer. Ask what the marketer sees.

**What sits between your files and your live site?** If it's an API and a database, ask who runs them, which Git hosts they work with, and what the site does if they stop. Know the answer for any tool before you need it.
