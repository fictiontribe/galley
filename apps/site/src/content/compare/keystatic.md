---
title: "Galley vs Keystatic: two open-source CMSs compared"
description: Keystatic and Galley both edit the content files in your codebase, for free. How setup, page building, editing, AI, scheduling, SSO, collaboration, hosting and teams differ.
kind: versus
product: Keystatic
heading: Keystatic and Galley agree that content is files. Keystatic has you describe them in TypeScript; Galley reads them.
name: Galley and Keystatic
lead: Both are free and open source, and both edit the Markdown, YAML and JSON in your codebase. Keystatic, a Thinkmill project, has developers describe the content in TypeScript, and its pages describe no AI features (November 2026). Galley is AI-first, needs no config file to start, and builds in visual section building, AI editing, translations, search intelligence, scheduled publishing, free OIDC SSO and optional Cloudflare hosting on Galley Cloud.
published: "2026-11-25"
updated: "2026-11-28"
checked: November 2026
order: 9
draft: false
short:
  - "Both keep your content as plain files in your codebase, with no database: Keystatic in YAML, JSON, Markdoc or MDX, Galley in Markdown, MDX, JSON or YAML. Leaving either needs no content migration, unless you keep images in Keystatic Cloud."
  - Both are free and open source, Keystatic under MIT and Galley under Apache-2.0. Keystatic Cloud is free for up to three users per team and Pro starts at $10 a month (+$5 per extra user, Nov 2026). [Galley Cloud](/cloud/) (opening by invitation) hosts both editor and static site on Cloudflare's edge with monthly AI credits and no per-seat fees, from $35 a month per site.
  - Keystatic asks a developer for a `keystatic.config.ts` in TypeScript and server-side `/keystatic` admin routes (requiring a Node.js host online). Galley reads the site as it is, includes the visual [Arrange](/docs/editing/page-builder/) page builder, and keeps the live site purely static.
  - "We found no AI feature, no MCP server and no scheduled publishing in Keystatic (November 2026). Galley is AI-first today: a page-aware assistant that never publishes, multi-provider image and short video generation, whole-site AI translations with Translation Memory and a Glossary, live Google rankings and 404 backlink recovery, `llms.txt` and Markdown twins, scheduled publishing, and MCP."
  - Choose Keystatic if your developers want a TypeScript-typed content model with the Reader API, rich text with Markdoc/MDX content components, Remix support, or Keystatic Cloud's free three-user sign-in today.
table:
  heading: Galley and Keystatic, side by side.
  text: Where Keystatic does more, the table says so.
  caption: Galley compared with Keystatic
  columns: [What differs, Galley, Keystatic]
  rows:
    - label: Your content
      ours: Files in your Git repository
      theirs: Files on your computer, or in a GitHub repository
      better: even
    - label: Price
      ours: Free Apache-2.0; optional Galley Cloud from $35/mo w/ site hosting & $0/seat
      theirs: Free MIT; Cloud free for 3 users, Pro from $10/mo (+$5/seat), no site hosting (Nov 2026)
      better: even
    - label: Setup
      ours: Reads the site as it is; live site stays purely static
      theirs: TypeScript config (npm create starts it), plus Node.js admin routes
      better: ours
    - label: Content model
      ours: Worked out from the site's schemas and files
      theirs: Typed in TypeScript, with component props and Reader API
      better: theirs
    - label: Page building & editing
      ours: Visual Arrange section builder, click-to-edit on the page, forms & assistant
      theirs: Forms and Markdoc/MDX content components; no visual editing
      better: ours
    - label: AI & search intelligence
      ours: AI-first — assistant (never publishes), image/video gen, AI translations w/ TM & glossary, live rankings/404 recovery, llms.txt, MCP
      theirs: None found (Nov 2026)
      better: ours
    - label: Checking a change
      ours: Word-by-word Proof beside the live site, put back any change, Cloud preview links
      theirs: Pull requests; a Next.js preview recipe
      better: ours
    - label: Scheduled publishing
      ours: Built in free (scheduler/CLI/publishAt) & pre-built edge deploys on every Cloud plan
      theirs: None found
      better: ours
    - label: Git hosts
      ours: Whichever host you push to
      theirs: GitHub only (local mode just writes files)
      better: ours
    - label: Teams & SSO
      ours: Free OpenID Connect SSO in Apache-2.0 server, 3 roles, $0/seat on Cloud (up to 500)
      theirs: GitHub write access, or Keystatic Cloud teams (no roles or SSO)
      better: ours
    - label: Two people at once
      ours: Built-in real-time co-editing & live presence on Galley Cloud; safe save checks self-hosted
      theirs: Multi-player editing on Cloud Pro marked experimental
      better: ours
    - label: Maturity
      ours: First released November 2026
      theirs: Public since 2023; release 0.6.10 (Nov 2026)
      better: theirs
faq:
  - q: Is Galley an alternative to Keystatic?
    a: For many static sites, yes. Both are free and open source, keep content as files in your repository and need no database. Galley reads the site without a config file, keeps the live site purely static, and builds in visual section building ([Arrange](/docs/editing/page-builder/)), click-to-edit on the page, an AI assistant, multilingual translation with Translation Memory, live search rankings, scheduled publishing and free OIDC SSO self-hosted (plus Cloudflare hosting and live co-editing on [Galley Cloud](/cloud/)). Keystatic gives developers a typed content model in TypeScript, Markdoc/MDX rich-text components and free sign-in for up to three editors on Keystatic Cloud today.
  - q: Is Keystatic free?
    a: "Yes. Keystatic itself is MIT-licensed and costs nothing. Keystatic Cloud, an optional service for signing in (and, on Pro, images), is free for up to three users per team. As of November 2026 its docs say Pro \"starts at $10/month\", and each user beyond three costs $5 a month. The page gives no yearly price; check it before you decide. Galley is free under Apache-2.0 locally or self-hosted (bringing your own AI key); [Galley Cloud](/cloud/) (opening by invitation) hosts both editor and static site on Cloudflare's edge from $35 a month per site, with monthly AI credits and no per-seat fees."
  - q: Does Keystatic need a server?
    a: To edit on the deployed site, yes. The Admin UI at `/keystatic` and its API at `/api/keystatic` are server code, so the host must run Node.js, and an Astro site needs an adapter. In local mode you can edit on your computer and keep those routes off the live site. Galley adds no dependency or integration to the live site; its editor runs locally, on your own server with Docker (`ghcr.io/fictiontribe/galley`), or hosted on [Galley Cloud](/cloud/).
  - q: Does Keystatic have AI features?
    a: Not that we found, as of November 2026. Its home page, documentation, blog and GitHub README describe no AI feature and no MCP server, and `keystatic.com` has no `llms.txt`. Because the content is plain files, a coding agent can still edit them like any other file in a repository. Galley has an assistant in the editor that never publishes, multilingual AI translation with Translation Memory, image/video generation, search intelligence and an MCP server today.
  - q: Can two people edit the same page at once?
    a: "In Keystatic, on Keystatic Cloud's paid Pro plan, whose docs list \"Multi-player editing (experimental)\" to \"collaborate with other editors in real-time on the same document.\" On [Galley Cloud](/cloud/), real-time collaboration and live presence are built in on every plan — teammates see faces in the top bar and page list, active field outlines with each person's name, and simultaneous typing in Markdown body text. On local or self-hosted Galley installs, editors work on one shared copy and a conflicting save is refused rather than silently overwritten."
  - q: How is Keystatic different from TinaCMS?
    a: "Both are open source, keep content as files in your repository and model it in a config file in code (`keystatic.config.ts`, `tina/config.ts`). TinaCMS calls itself \"Git-backed headless\": it gives the site \"a queryable content API\", and offers visual editing on React and Astro sites. A Keystatic site reads the files through its server-side Reader API or the framework's own loader. Galley differs from both: there's no config file to write first."
sources:
  - label: "Keystatic, home page"
    href: https://keystatic.com/
  - label: "Keystatic documentation, quick start"
    href: https://keystatic.com/docs/quick-start
  - label: "Keystatic documentation, configuration"
    href: https://keystatic.com/docs/configuration
  - label: "Keystatic documentation, local mode"
    href: https://keystatic.com/docs/local-mode
  - label: "Keystatic documentation, GitHub mode"
    href: https://keystatic.com/docs/github-mode
  - label: "Keystatic documentation, Keystatic Cloud"
    href: https://keystatic.com/docs/cloud
  - label: "Keystatic documentation, format options"
    href: https://keystatic.com/docs/format-options
  - label: "Keystatic documentation, Reader API"
    href: https://keystatic.com/docs/reader-api
  - label: "Keystatic documentation, adding Keystatic to an Astro project"
    href: https://keystatic.com/docs/installation-astro
  - label: "Keystatic documentation, adding Keystatic to a Next.js project"
    href: https://keystatic.com/docs/installation-next-js
  - label: "Keystatic documentation, adding Keystatic to a Remix project"
    href: https://keystatic.com/docs/installation-remix
  - label: "Keystatic documentation, the Markdoc field"
    href: https://keystatic.com/docs/fields/markdoc
  - label: "Keystatic documentation, content components"
    href: https://keystatic.com/docs/content-components
  - label: "Keystatic documentation, entry layout"
    href: https://keystatic.com/docs/entry-layout
  - label: "Keystatic documentation, the Cloud Image field"
    href: https://keystatic.com/docs/fields/cloud-image
  - label: "Keystatic documentation, real-time previews with Next.js draft mode"
    href: https://keystatic.com/docs/recipes/real-time-previews
  - label: "Keystatic documentation, disabling the Admin UI in production on Astro"
    href: https://keystatic.com/docs/recipes/astro-disable-admin-ui-in-production
  - label: "Keystatic, blog"
    href: https://keystatic.com/blog
  - label: "Keystatic on GitHub"
    href: https://github.com/Thinkmill/keystatic
  - label: "Keystatic changelog, on GitHub"
    href: https://github.com/Thinkmill/keystatic/blob/main/packages/keystatic/CHANGELOG.md
  - label: "Keystatic on npm"
    href: https://www.npmjs.com/package/@keystatic/core
  - label: "TinaCMS documentation"
    href: https://tina.io/docs
  - label: "Galley, the FAQ for developers"
    href: /docs/project/faq/
  - label: "Galley, page builder"
    href: /docs/editing/page-builder/
  - label: "Galley, languages"
    href: /docs/editing/languages/
  - label: "Galley over MCP"
    href: /docs/integrations/mcp/
  - label: "Galley, running a hosted editor"
    href: /docs/running/hosted/
  - label: "Galley, the tour: what is built and what isn't yet"
    href: /tour/
  - label: "Galley Cloud"
    href: /cloud/
  - label: "Galley for enterprise and security teams"
    href: /enterprise/
related: [cloudcannon, types-of-cms, tinacms]
---

## What do Galley and Keystatic have in common?

More than either has in common with WordPress or [a headless CMS](/compare/types-of-cms/). Both keep your content as plain files beside the codebase, with no database, and both are free and open source (Keystatic under MIT, a Thinkmill project; Galley under Apache-2.0).

## How much does each cost?

Keystatic is free and MIT-licensed. Keystatic Cloud is an optional sign-in and image service (as of November 2026):

| Plan | Price | Users per team | What it adds |
| --- | --- | --- | --- |
| Free | Free | Up to 3 | Sign-in handled by Keystatic Cloud |
| Pro | From $10 a month | More than 3, at $5 a month for each one beyond 3 | Multi-player editing (experimental), Cloud Images |

Galley is free and Apache-2.0 locally (`npx galley-cms` or the Apple-signed and notarized macOS desktop app) or self-hosted on your own server with Docker (`ghcr.io/fictiontribe/galley`, including OIDC SSO, visual section building, AI translations and scheduled publishing). For managed hosting with no keys to paste, [Galley Cloud](/cloud/) (opening by invitation) runs a dedicated editor machine per site, serves the published static site on Cloudflare's global edge, and includes monthly AI credits, pre-built scheduled publishing and Search and AI intelligence — with **no per-seat fees** (up to 500 named people per workspace, 100 per site): Partner is $0 a month for agencies whose clients pay directly, Site is $35 a month, Agency is $99 a month (5 live sites included, then $15–$12 per extra site), and Business is $149 a month.

## What does a developer have to set up, and how does page building work?

Keystatic starts from code (`keystatic.config.ts` in TypeScript, plus `/keystatic` and `/api/keystatic` server routes requiring a Node.js host online and an Astro adapter). Its typed config and Reader API give developers strong component types, and its Markdoc/MDX editor supports structured rich-text content components. We found no on-page visual editing in its docs.

Galley starts by reading the site's framework, collections and fields from its schemas and files without running its code. Astro fits deepest; Docusaurus, Nuxt, Next.js, SvelteKit, Eleventy, Hugo and Jekyll are recognised by their conventions (Remix isn't). A `galley.config.json` file only corrects what Galley found. Click-to-edit on the page needs no markup, and Galley's visual [Arrange](/docs/editing/page-builder/) page builder lets editors select, drag, reorder, duplicate and drop new sections from a thumbnail palette directly onto static pages, toggle layout options live and undo safely — with zero Node.js server required on the live site. Keystatic still gives editors more inside rich text full of Markdoc/MDX components.

## How does each one use AI, translations and search intelligence?

As of November 2026 we found no AI feature and no MCP server in Keystatic.

Galley is AI-first on every edition — open source and [Galley Cloud](/cloud/):

- **Page-aware built-in assistant.** Ask in plain words beside the page; it reads the site before it edits, builds and arranges sections, reads brand and voice guidelines from your materials or live site, rebuilds WordPress imports, touches only content and media in content mode, has no shell or network tool, and **never publishes**.
- **Multi-provider image and short video generation.** Generate images and short video clips across OpenAI, Google Gemini and OpenRouter straight into the media library.
- **Whole-site and per-page AI translations.** Configure target languages, localized URL slugs, `hreflang` alternates and Astro `<LanguageSelector />` / `<LocaleHead />` components ([Languages](/docs/editing/languages/)); edit side by side with automatic out-of-sync flags when the source changes, or translate pages and entire sites with AI using a Git-tracked **Translation Memory** (0-credit reuse), a brand/product **Glossary** and an upfront cost estimate — every translated page waiting in Proof.
- **Built-in Search and AI intelligence.** On-site SEO and structured-data checks, live Google search rankings, striking-distance (`#4–#15`) quick wins, keyword explorer, competitor content gaps, broken-404 backlink recovery with one-click redirects, and AI search answer citations — included on Galley Cloud (at zero AI credits for lookups) or self-hosted with your own search data key.
- **AI-first published output and MCP.** Publishes `llms.txt`, `llms-full.txt`, `agent.md`, Markdown twins of every page and per-AI-crawler `robots.txt` switches ([AI-first websites](/ai-first/)), plus [Galley's MCP server](/docs/integrations/mcp/) (publishing over MCP can be switched off).

## How do you check a change and schedule publishing?

In Keystatic, editors typically open a pull request and wait for deploy previews (with a Next.js draft-mode preview recipe); we found no scheduled publishing in its docs.

In Galley every change — from the form, the page, Arrange, translation or the assistant — lands in [Proof](/how-to/proof-and-publish/): word-by-word markup beside the live site, where any single change can be put back and publishing is a commit or pull request. Galley also includes **scheduled publishing** on both editions: free in open source (server scheduler, `galley schedule` CLI, entry `publishAt` date/time matching and one-click GitHub Actions workflow), and pre-built zero-latency Cloudflare edge deploys on every [Galley Cloud](/cloud/) plan (verified ahead of time with a shareable preview link, going live at the exact scheduled minute even while the editor machine is asleep, with instant rollback without rebuilding).

## How does the site get its content?

Keystatic provides a server-side Node.js Reader API (or Astro content collections) and embeds `/keystatic` server routes inside your site.

Galley adds no dependency or server runtime to the live site. Publishing is a commit, your host builds from there — or deploys directly to Cloudflare (external media buckets support Cloudflare R2, Amazon S3 and Cloudflare Images) — and [Galley Cloud](/cloud/) hosts both the editor and the published site on Cloudflare's global edge with 30–90 day nightly backups.

## Which one suits a team?

Keystatic offers GitHub write-access sign-in or Keystatic Cloud teams (free for 3 users, Pro $5/extra seat with experimental multi-player editing), with no roles or SSO documented as of November 2026.

Galley includes roles, free OIDC SSO and built-in live collaboration:

- **Free OpenID Connect (OIDC) SSO self-hosted:** A [hosted editor](/docs/running/hosted/) (`ghcr.io/fictiontribe/galley`, one isolated container per site) adds owner, editor and contributor accounts plus OpenID Connect single sign-on (Authorization Code with PKCE, IdP role-claim mapping, `GALLEY_OIDC_ONLY`, Back-Channel Logout) built into the free Apache-2.0 server; see [`/enterprise/`](/enterprise/). On self-hosted installs, editors share one copy and a conflicting save is refused; roles organize work while the container is the security boundary.
- **Real-time collaboration & zero per-seat fees on [Galley Cloud](/cloud/):** Built-in live presence, active field outlines, simultaneous Markdown typing, and per-author Proof for up to 500 named people per workspace and 100 per site with **$0 per-seat fees**.

## Where does Galley fall short?

- **It's young.** Version {version} of software first released in November 2026. Keystatic has been public since 2023 (release 0.6.10, November 2026).
- **Rich text with Markdoc/MDX components.** Keystatic edits Markdoc and MDX components inside its editor. Galley treats MDX component props as code and doesn't list Markdoc among its formats.
- **Galley Cloud is opening by invitation.** Keystatic Cloud's free three-user tier is open for immediate sign-up today.
- **Remix isn't among Galley's frameworks.** Keystatic has a package for it.

## When is Keystatic the better choice?

When your developers want the content model typed in TypeScript and read via the Reader API. When rich text is full of Markdoc/MDX components editors should fill in without touching markup. When up to three non-GitHub editors need free hosted sign-in today without Docker or an invitation. When the site is built with Remix. And when you'd rather adopt a project public since 2023.

Galley fits when non-developers edit a static site and you want zero-config setup, visual section building ([Arrange](/docs/editing/page-builder/)), click-to-edit on the page, an AI-first assistant, translations with Translation Memory and a Glossary, live Google rankings and 404 backlink recovery, scheduled publishing, free OIDC SSO self-hosted, real-time co-editing on [Galley Cloud](/cloud/), or a Git host beyond GitHub.

## Can you move from one to the other?

Yes, because the content never leaves the repository (if long text is in `.mdoc` files, try Galley on a copy first). Run `npx galley-cms` in the site's folder; Keystatic's config and routes can stay while you try. Leaving Keystatic means removing its integration/route files, replacing Reader API calls, and bringing any Keystatic Cloud Images back into the repo.

## Three questions to ask before you choose

**Who describes the content, and who keeps that description in step with the site?** A typed config is precise. It is also one more file to change with each new field.

**When an AI makes a change, who sees it before it is live, and in what form?** A pull request reads well to a developer. Ask what the marketer sees.

**Where will editors work, and what does that need?** A Node.js host for the admin, a GitHub account or a Keystatic Cloud seat, a Docker server, or an app on their own computer. Know which before you need it.
