---
title: "Galley vs Decap CMS: two free Git-based CMSs"
description: Decap CMS (formerly Netlify CMS) and Galley both edit your repository's files, free. How they differ on setup, page building, previews, AI, scheduling, SSO, translations, hosting and teams.
kind: versus
product: Decap CMS
heading: Decap CMS and Galley agree on Git and on price. They part ways on setup and AI.
name: Galley and Decap CMS
lead: Both are free, open-source editors for the files in your repository. Decap CMS, created in 2016, is a page on your site, set up by a developer in YAML, with no AI of its own (November 2026). Galley is AI-first, reads the site as it is, and builds in visual section building, AI editing, translations, search intelligence, scheduled publishing, free OIDC SSO and optional Cloudflare hosting on Galley Cloud.
published: "2026-11-25"
updated: "2026-11-28"
checked: November 2026
order: 5
draft: false
short:
  - "Both are Git-based and free. Your content stays as Markdown, YAML or JSON files in your own repository, and changes are recorded as commits: Decap commits every save; Galley commits when you publish. Decap is MIT-licensed, Galley Apache-2.0. Leaving either needs no export."
  - Decap is an app at `/admin` on your site requiring a `config.yml` and OAuth sign-in wiring. Galley reads the site's framework, collections and fields as they are, includes the visual [Arrange](/docs/editing/page-builder/) page builder, and runs locally, self-hosted with Docker (`ghcr.io/fictiontribe/galley`), or hosted on [Galley Cloud](/cloud/) (opening by invitation).
  - "Decap has no AI features built in (a Decap Turbo MCP server is on its roadmap, Nov 2026) and no built-in scheduled publishing. Galley is AI-first today: a page-aware assistant that never publishes, multi-provider image and short video generation, whole-site AI translations with Translation Memory and a Glossary, live Google rankings and 404 backlink recovery, `llms.txt` and Markdown twins, scheduled publishing, and MCP."
  - Decap Turbo offers hosted sign-in and roles (free plan; Pro €19 a month + €6/extra seat, Nov 2026). [Galley Cloud](/cloud/) (opening by invitation) hosts both editor and static site on Cloudflare's edge with real-time co-editing, monthly AI credits and no per-seat fees, from $35 a month per site ($99 on Agency for five sites).
  - Choose Decap if editors should open `/admin` from any browser with no server of its own, or if you need Draft/In review/Ready statuses, issue-backed Notes, Open Authoring forks, or a record since 2016.
table:
  heading: Galley and Decap CMS, side by side.
  text: Where Decap CMS does more, the table says so.
  caption: Galley compared with Decap CMS
  columns: [What differs, Galley, Decap CMS]
  rows:
    - label: Your content
      ours: Files in your Git repository
      theirs: Files in your Git repository
      better: even
    - label: Price
      ours: Free Apache-2.0; optional Galley Cloud from $35/mo w/ site hosting & $0/seat
      theirs: Free MIT; Turbo free for 1 site, Pro €19/mo (+€6/seat), no site hosting (Nov 2026)
      better: even
    - label: Setup
      ours: Reads the site as it is
      theirs: A config.yml (AI agents can write it), and an OAuth sign-in
      better: ours
    - label: Page building & editing
      ours: Visual Arrange section builder, click-to-edit on the page, forms & assistant
      theirs: Forms, rich text and custom widgets
      better: ours
    - label: Preview
      ours: The site itself, from its own dev server
      theirs: A preview pane; custom ones in React
      better: ours
    - label: Checking a change
      ours: Word-by-word Proof beside the live site, put back any change, Cloud preview links
      theirs: The preview; pull requests in the workflow
      better: ours
    - label: AI & search intelligence
      ours: AI-first — assistant (never publishes), image/video gen, AI translations w/ TM & glossary, live rankings/404 recovery, llms.txt, MCP
      theirs: None built in; MCP on Turbo's roadmap
      better: ours
    - label: Scheduled publishing
      ours: Built in free (scheduler/CLI/publishAt) & pre-built edge deploys on every Cloud plan
      theirs: None found in Decap docs
      better: ours
    - label: Several languages
      ours: Built-in i18n, side-by-side editing, AI translation w/ Translation Memory & glossary
      theirs: Side by side, in three file layouts (manual)
      better: ours
    - label: Teams, SSO & collaboration
      ours: Free OIDC SSO in Apache-2.0 server + real-time co-editing & $0/seat on Cloud
      theirs: Git host access; Turbo adds roles; SSO & presence under consideration
      better: ours
    - label: Review statuses & Notes
      ours: Proof and pull requests
      theirs: Draft, In review, Ready statuses; Notes on entries; Open Authoring forks
      better: theirs
    - label: Maturity
      ours: First released November 2026
      theirs: Since 2016; about 19,500 GitHub stars (Nov 2026)
      better: theirs
faq:
  - q: Is Galley an alternative to Decap CMS?
    a: For many static sites, yes. Both edit the files in your Git repository and record changes as commits (Decap on each save, Galley when you publish), and both open-source editors cost nothing. Galley needs no config file for common setups, previews the real site, and builds in visual section building ([Arrange](/docs/editing/page-builder/)), an AI assistant, multilingual AI translation with Translation Memory, live search rankings, scheduled publishing and free OIDC SSO self-hosted (with optional Cloudflare hosting and live co-editing on [Galley Cloud](/cloud/)). Decap, called Netlify CMS until 2023, opens from any browser as a page on your site with no server of its own, with review statuses, Notes on entries, Open Authoring forks and a record since 2016.
  - q: How much does Decap CMS cost?
    a: Decap CMS is free under the MIT licence. Its optional hosted service, Decap Turbo, has a free plan for one site and one seat. As of November 2026, Pro is €19 a month for one site and five seats, then €10 a site and €6 a seat a month, and Enterprise is priced on request. Galley is free under Apache-2.0 locally or self-hosted (bringing your own AI key); [Galley Cloud](/cloud/) (opening by invitation) adds Cloudflare website hosting, monthly AI credits and Search intelligence from $35 a month per site ($99 on Agency for five sites), with no per-seat fees.
  - q: Does Decap CMS have AI features?
    a: "Not built in, as of November 2026. Its features page lists, for Decap Turbo, a command-line tool with an MCP server for AI agents as \"On the roadmap\" and says it is \"Not built yet\". Decap publishes its documentation in forms AI tools read well, llms.txt and llms-full.txt. Because the content is plain files, any coding agent can already edit it in the repository."
  - q: Is Decap CMS still maintained?
    a: Yes. Its State of Decap page counts 15 stable releases, 151 merged pull requests, from 43 people and automated dependency updates, and 170 closed issues between October 2025 and September 2026. The latest release, 3.18.0, came out on 18 November 2026. It is maintained by PM d.o.o., a Slovenian software company of about 30 people, with contributors from around the world.
  - q: Does Decap CMS need Netlify?
    a: "No. Its documentation says \"Decap CMS doesn't need Netlify\", and it works with GitHub, GitLab, Bitbucket, Gitea, Forgejo, Azure or its own Turbo service, though its GitHub and Bitbucket sign-in use Netlify's OAuth service unless you run your own. Its tutorial does use Netlify Identity with Git Gateway. Netlify's own docs now say \"Git Gateway is deprecated\" and don't recommend it for new setups, while Netlify Identity remains a supported sign-in option."
  - q: Can editors use Decap CMS without a GitHub account?
    a: Yes, with the right backend. With the GitHub backend, each editor needs a GitHub account with push access to the repository. Git Gateway, which Netlify has deprecated, lets you add editors without direct write access, and Decap Turbo invites them by email to sign in with Google, GitHub or an email and password. In Galley, both a self-hosted editor (with accounts and OIDC SSO) and [Galley Cloud](/cloud/) let editors sign in without GitHub accounts.
sources:
  - label: "Decap CMS, home page"
    href: https://decapcms.org/
  - label: "Decap CMS, features and roadmap"
    href: https://decapcms.org/features/
  - label: "Decap CMS, State of Decap"
    href: https://decapcms.org/state-of-decap/
  - label: "Decap CMS documentation, introduction"
    href: https://decapcms.org/docs/intro/
  - label: "Decap CMS documentation, basic steps"
    href: https://decapcms.org/docs/basic-steps/
  - label: "Decap CMS documentation, installing"
    href: https://decapcms.org/docs/install-decap-cms/
  - label: "Decap CMS documentation, configuring (the tutorial)"
    href: https://decapcms.org/docs/configure-decap-cms/
  - label: "Decap CMS documentation, configuration options"
    href: https://decapcms.org/docs/configuration-options/
  - label: "Decap CMS documentation, widgets"
    href: https://decapcms.org/docs/widgets/
  - label: "Decap CMS documentation, backends overview"
    href: https://decapcms.org/docs/backends-overview/
  - label: "Decap CMS documentation, GitHub backend"
    href: https://decapcms.org/docs/github-backend/
  - label: "Decap CMS documentation, GitLab backend"
    href: https://decapcms.org/docs/gitlab-backend/
  - label: "Decap CMS documentation, external OAuth clients"
    href: https://decapcms.org/docs/external-oauth-clients/
  - label: "Decap CMS documentation, Git Gateway backend"
    href: https://decapcms.org/docs/git-gateway-backend/
  - label: "Decap CMS documentation, customizing the preview"
    href: https://decapcms.org/docs/customization/
  - label: "Decap CMS documentation, deploy preview links"
    href: https://decapcms.org/docs/deploy-preview-links/
  - label: "Decap CMS documentation, access your content"
    href: https://decapcms.org/docs/access-your-content/
  - label: "Decap CMS documentation, editorial workflows"
    href: https://decapcms.org/docs/editorial-workflows/
  - label: "Decap CMS documentation, Notes"
    href: https://decapcms.org/docs/notes/
  - label: "Decap CMS documentation, i18n"
    href: https://decapcms.org/docs/i18n/
  - label: "Decap CMS documentation, Open Authoring"
    href: https://decapcms.org/docs/open-authoring/
  - label: "Decap CMS documentation, working with AI assistants"
    href: https://decapcms.org/docs/working-with-ai/
  - label: "Decap CMS documentation, releases"
    href: https://decapcms.org/docs/releases/
  - label: "Decap Turbo, plans and prices"
    href: https://decapcms.org/turbo/
  - label: "Decap Turbo documentation, how it works"
    href: https://decapcms.org/docs/turbo-how-it-works/
  - label: "Decap Turbo documentation, getting started"
    href: https://decapcms.org/docs/turbo-getting-started/
  - label: "Decap Turbo documentation, troubleshooting and FAQ"
    href: https://decapcms.org/docs/turbo-troubleshooting-faq/
  - label: "Decap Turbo, terms"
    href: https://decapcms.org/turbo/terms/
  - label: "Decap CMS, comparing Git-based CMSs"
    href: https://decapcms.org/compare/git-based-cms/
  - label: "Decap CMS, on GitHub"
    href: https://github.com/decaporg/decap-cms
  - label: "Netlify documentation, Git Gateway"
    href: https://docs.netlify.com/manage/security/secure-access-to-sites/git-gateway/
  - label: "Netlify blog, changes to Netlify Identity (update of 19 February 2026)"
    href: https://www.netlify.com/blog/auth0-extension-identity-changes/
  - label: "Galley, the FAQ for developers"
    href: /docs/project/faq/
  - label: "Galley, page builder"
    href: /docs/editing/page-builder/
  - label: "Galley, languages"
    href: /docs/editing/languages/
  - label: "Galley, the tour: what is built and what isn't yet"
    href: /tour/
  - label: "Galley over MCP"
    href: /docs/integrations/mcp/
  - label: "Galley, run a hosted install"
    href: /docs/running/hosted/
  - label: "Galley Cloud"
    href: /cloud/
  - label: "Galley for enterprise and security teams"
    href: /enterprise/
related: [cloudcannon, tinacms, types-of-cms]
---

## Decap CMS and Galley: what do they have in common?

Nearly everything underneath. Both are Git-based: the site's words are files in its repository, and the CMS edits them for people who don't use a code editor. Both are free and open source. Leaving either needs no export.

Netlify created Decap in 2016 as Netlify CMS, and in its own documentation's words, "In February 2023 Netlify CMS became Decap CMS." PM d.o.o., a software company in Ljubljana, has maintained it since, with contributors from around the world.

The difference is the editor: where it lives, and what it knows before you start. Decap is an app on your site at `yoursite.com/admin/` configured via `config.yml`. Galley's editor isn't on the live site: it runs locally (`npx galley-cms` or the Apple-signed macOS desktop app), self-hosted with Docker (`ghcr.io/fictiontribe/galley`), or hosted on [Galley Cloud](/cloud/), and works out the content from the site's own files.

## How much does each cost?

Decap CMS costs nothing under MIT. Decap Turbo, its optional hosted backend, has three plans as of November 2026:

| Plan | Price | Included |
| --- | --- | --- |
| Free | €0 | 1 site and 1 seat |
| Pro | €19 a month | 1 site and 5 seats, then €10 a site and €6 a seat a month |
| Enterprise | Custom | Unlimited sites and seats (fair use) |

On Pro, custom roles are a €19-a-month add-on and priority support is €99 a month per organisation. Check [Decap Turbo's page](https://decapcms.org/turbo/) before you decide.

Galley is free and Apache-2.0 locally or self-hosted (including OIDC SSO, visual section building, AI translations and scheduled publishing), bringing your own AI key and static hosting. For managed hosting with no keys to paste, [Galley Cloud](/cloud/) (opening by invitation) hosts both a dedicated editor machine per site and the published static site on Cloudflare's global edge, with monthly AI credits, pre-built scheduled publishing and Search and AI intelligence included and **no per-seat fees** (up to 500 named people per workspace, 100 per site): Partner is $0 a month for agencies whose clients pay directly, Site is $35 a month, Agency is $99 a month (5 live sites included, then $15–$12 per extra site), and Business is $149 a month.

## What does a developer have to set up, and how does page building work?

Decap's install is `admin/index.html` plus `config.yml`, where a developer lists every collection, field and widget, sets up OAuth sign-in (noting Netlify deprecated Git Gateway while keeping Netlify Identity), and writes React preview templates if you want previews to look like your site.

Galley starts by reading the site. It works out the framework, content collections and field types from the site's own schemas and files without running its code. Astro fits deepest; Docusaurus, Nuxt, Next.js, SvelteKit, Eleventy, Hugo and Jekyll are recognised by their conventions. `galley.config.json` only corrects what Galley found. The preview is the site's own dev server, click-to-edit needs no markup, and Galley's visual [Arrange](/docs/editing/page-builder/) page builder lets editors select, drag, reorder, duplicate and drop new sections from a thumbnail palette directly onto static pages, toggle layout options live and undo safely.

## How does each one use AI, translations and search intelligence?

Today, Decap has no AI features built in (a Decap Turbo CLI with an MCP server is marked "On the roadmap", November 2026), and its side-by-side multi-language editing is manual.

Galley is AI-first across both open source and [Galley Cloud](/cloud/):

- **Page-aware built-in assistant.** [Ask in plain words](/how-to/ask-the-assistant/) beside the page; it reads the site before it edits, builds and arranges sections, reads brand and voice guidelines from your materials or live site, rebuilds WordPress imports, touches only content and media in content mode, has no shell or network tool, and **never publishes**.
- **Multi-provider image and short video generation.** Generate images and short video clips across OpenAI, Google Gemini and OpenRouter straight into the media library.
- **Whole-site and per-page AI translations.** Configure target languages, localized URL slugs, `hreflang` alternates and Astro `<LanguageSelector />` / `<LocaleHead />` components ([Languages](/docs/editing/languages/)); edit side by side with automatic out-of-sync flags when the source changes, or translate pages and entire sites with AI using a Git-tracked **Translation Memory** (0-credit reuse), a brand/product **Glossary** and an upfront cost estimate — every translated page waiting in Proof.
- **Built-in Search and AI intelligence.** On-site SEO and structured-data checks, live Google search rankings, striking-distance (`#4–#15`) quick wins, keyword explorer, competitor content gaps, broken-404 backlink recovery with one-click redirects, and AI search answer citations — included on Galley Cloud (at zero AI credits for lookups) or self-hosted with your own search data key.
- **AI-first published output and MCP.** Publishes `llms.txt`, `llms-full.txt`, `agent.md`, Markdown twins of every page and per-AI-crawler `robots.txt` switches ([AI-first websites](/ai-first/)), plus [Galley's MCP server](/docs/integrations/mcp/) (publishing over MCP can be switched off).

## How do you check a change and schedule publishing?

In Decap, a preview sits beside the form; with the editorial workflow, "Save draft" opens a pull request with Draft, In review and Ready statuses, plus Notes kept on GitHub/GitLab issues. We found no scheduled publishing in Decap's documentation.

In Galley every change — from the form, the page, Arrange, translation or the assistant — lands in [Proof](/how-to/proof-and-publish/): word-by-word markup beside the live site, where any single change can be put back and publishing is a commit or pull request.

Galley also includes **scheduled publishing** on both editions:

- **Open source (free):** Schedule changes directly from Proof for an exact date and time (published automatically by the server scheduler or `galley schedule` CLI while holding scheduled changes safely aside so you can keep editing other pages), alongside entry `publishAt` date/time matching and a one-click GitHub Actions scheduled build workflow for pure static sites.
- **Galley Cloud (every plan):** Pre-built scheduled versions are verified ahead of time with a shareable preview link and promoted live at Cloudflare's edge at the exact scheduled minute — even while the editor machine is asleep, with zero build delay at launch time — alongside instant version rollback without rebuilding.

## How does the site get its content, and who hosts it?

With both, the site's build reads the files. Decap doesn't host the site; Turbo Pro adds an S3-compatible media library (beta).

Galley publishes to your repository, deploys directly to Cloudflare (verified on the real service; Vercel deploys are in progress), includes forms and redirects, and supports external media buckets in Cloudflare R2 (verified on the real service), Amazon S3 and Cloudflare Images (in progress). On [Galley Cloud](/cloud/) (opening by invitation), Galley hosts both the editor and your published static site on Cloudflare's global edge with automatic SSL, custom domains in one DNS record, and 30–90 day nightly backups.

## Which one suits a team?

In plain Decap, editors sign in with Git-host accounts (needing push access on GitHub), and Decap adds Draft/In review/Ready statuses, issue-backed Notes and Open Authoring forks. Turbo adds email invites, per-collection roles (Pro add-on) and an activity log, while SSO and presence remain "Under consideration".

Galley includes both SSO and live collaboration:

- **Free OpenID Connect (OIDC) SSO self-hosted:** A [hosted editor](/docs/running/hosted/) (`ghcr.io/fictiontribe/galley`, one isolated container per site) adds owner, editor and contributor accounts plus OpenID Connect single sign-on (Authorization Code with PKCE, IdP role-claim mapping, `GALLEY_OIDC_ONLY`, Back-Channel Logout) built into the free Apache-2.0 server; see [`/enterprise/`](/enterprise/). On self-hosted installs, editors share one copy and a conflicting save is refused; roles organize work while the container is the security boundary.
- **Real-time collaboration & zero per-seat fees on [Galley Cloud](/cloud/):** Built-in live presence, active field outlines, simultaneous Markdown typing, and per-author Proof for up to 500 named people per workspace and 100 per site with **$0 per-seat fees**.

## Where does Galley fall short?

Beside Decap, in clear places:

- **It's young.** Version {version}, first released in November 2026. Decap has been in use since 2016 with ~19,500 GitHub stars.
- **No `/admin` page without a server.** Decap runs purely in the editor's browser on your static site. Galley runs locally, self-hosted with Docker, or on Galley Cloud (opening by invitation).
- **No editorial statuses, issue-backed Notes or Open Authoring forks.** Galley uses Proof and Git pull requests.
- **Desktop app verified on macOS only.** The macOS desktop app is Apple-signed and notarized; Windows and Linux builds haven't yet been verified in a person's hands.

## When is Decap CMS the better choice?

When you want a free CMS that ships as a static `/admin` page on your site with no server of its own, on GitHub, GitLab, Bitbucket, Gitea, Forgejo or Azure. When your team needs Draft/In review/Ready statuses, issue-backed Notes or fork-based Open Authoring. Or when a record since 2016 matters most.

Galley fits when non-developers edit the site and you want zero-config setup, real-site previews, visual section building ([Arrange](/docs/editing/page-builder/)), an AI-first assistant, AI translations with Translation Memory and a Glossary, live Google rankings and 404 backlink recovery, scheduled publishing, Proof, free OIDC SSO self-hosted, and Cloudflare-hosted [Galley Cloud](/cloud/) with live co-editing. See [what Galley does today](/tour/).

## Can you move from Decap CMS to Galley?

Yes, and there's little to move. The content is already files in your repository, so Galley needs no importer for it. Run `npx galley-cms` in the site's folder, or open the repository in the desktop app. Galley doesn't use `config.yml` and doesn't read the `admin` folder, so it can stay while you try. To leave Decap, remove the `admin` folder and OAuth handler. For Decap's model with a different editor, Decap calls Sveltia CMS "the closest alternative to Decap".

## Three questions to ask before you choose

**Who writes the description of your content, and who keeps it in step with the site?** With Decap it's a `config.yml` a developer looks after. Ask how many lines a new collection takes.

**How will editors sign in, and what does that depend on?** Name the backend, ask whether it needs an OAuth service, and check that the company running that service still recommends it for new sites.

**When an AI makes a change, who sees it before it's live, and in what form?** A pull request reads well to a developer. Ask what the person who knows the page will see.
