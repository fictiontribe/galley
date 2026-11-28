---
title: "Git-based CMS compared: eight, side by side"
description: "A Git-based CMS edits your site's files in Git. Eight compared, fairly: where each runs, the config it needs, Git hosts, price, AI and translations, as of November 2026."
kind: guide
name: The Git-based CMSs
heading: All eight keep your words as files in Git. They differ in everything around the files.
lead: A Git-based CMS edits the Markdown and data files your site is built from, where they already live. Here are eight of them, with where each one runs, what a developer writes first, which Git hosts it works with, what it costs and what its AI does, as of November 2026. One of them, Galley, is ours.
published: "2026-11-25"
updated: "2026-11-28"
checked: November 2026
order: 3
draft: false
short:
  - All eight keep your content as plain files, normally in your own Git repository, and the repository stays its home. Leaving any of them is mostly a matter of removing the editor, not exporting the words.
  - "The biggest difference is where the editor runs: a hosted service (CloudCannon, Pages CMS), a page on your site (Decap CMS, Sveltia CMS, TinaCMS, Keystatic), your code editor (Front Matter CMS), or an app on your computer, your own server with Docker, or managed on [Galley Cloud](/cloud/) (Galley; Cloud opening by invitation)."
  - Most ask a developer to describe the content in a configuration file before an editor sees a form. Galley reads the site as it is. Pages CMS and Keystatic work with GitHub only, and so does TinaCloud, TinaCMS's hosted backend.
  - Most of the software is free and open source. CloudCannon is paid (Standard is $55 a month, or $49 paid yearly), and Galley, TinaCMS, Decap CMS and Keystatic offer optional hosted services (as of November 2026). We found an assistant you can ask for a change only in Galley (alongside multilingual AI translation with Translation Memory and Search and AI intelligence); Sveltia translates with AI, and Front Matter suggests titles through GitHub Copilot.
  - We think the right one depends on who edits. Developers in VS Code, Front Matter. A free editor in the browser with no server, Decap or Sveltia. A live-today service that hosts and supports you with a 2013 track record, CloudCannon. Editing on the page in React, TinaCMS. Non-developers who ask for a change, translate pages, check search rankings and check Proof first, Galley. We make Galley, so weigh that last one accordingly.
faq:
  - q: What is the best Git-based CMS?
    a: It depends on who edits and where. For developers in VS Code, Front Matter CMS. For a free editor in any browser with no server, Decap CMS or Sveltia CMS. For a paid service with thirteen years of history that also hosts the site, CloudCannon. For editing on the page in React, TinaCMS. For a model typed in TypeScript, Keystatic. We think Galley fits best when non-developers make the changes, translate pages and check them in Proof first — free to self-host or managed on [Galley Cloud](/cloud/) — but we make it.
  - q: Is Netlify CMS still maintained?
    a: "Netlify CMS is now Decap CMS. In Decap's documentation's words, \"In February 2023 Netlify CMS became Decap CMS.\" Its State of Decap page answers \"Is Decap CMS still maintained?\" with \"Yes\", counting 15 stable releases between October 2025 and September 2026, and its latest release, 3.18.0, came out on 18 November 2026. PM d.o.o., a software company in Slovenia, maintains it."
  - q: Is a Git-based CMS a headless CMS?
    a: "Several of these call themselves one. TinaCMS is \"Git-backed headless\", Sveltia a \"Git-based headless CMS\" and Front Matter a \"Headless CMS right in your code editor\". They are headless in that editing is kept apart from how the pages are built. But most don't serve the content through an API: the site's build reads the files. TinaCMS adds a GraphQL API over them."
  - q: Are Git-based CMSs free?
    a: "Most of the software is. Galley and TinaCMS are Apache-2.0, and Decap CMS, Keystatic, Pages CMS, Sveltia CMS and Front Matter CMS are MIT-licensed. CloudCannon is a paid service, with hosting included: Standard is $55 a month, or $49 a month paid yearly. Four offer optional hosted services. As of November 2026, [Galley Cloud](/cloud/) (opening by invitation) starts at $35 a month per site ($99 on Agency for five sites, with Cloudflare edge hosting, monthly AI credits and no per-seat fees), TinaCloud's Team plan is $29 a month per project, Decap Turbo Pro starts at €19 a month and Keystatic Cloud Pro starts at $10 a month."
  - q: Which Git-based CMSs work with GitLab or Bitbucket?
    a: CloudCannon connects to GitHub, GitLab and Bitbucket. Decap CMS has backends for all three, plus Gitea, Forgejo and Azure. Sveltia CMS works with GitLab, Gitea and Forgejo as well as GitHub, but not Bitbucket. Galley publishes to whatever remote the site has. Pages CMS and Keystatic are GitHub only, and so is TinaCloud, though a self-hosted TinaCMS backend can use a Git provider you write.
  - q: Which Git-based CMSs have AI features?
    a: As of November 2026, Galley has an assistant in the editor that never publishes, multilingual AI translation with Translation Memory and a Glossary, image and short video generation, Search and AI intelligence, and an MCP server (through which other AI tools can publish unless that is switched off). Sveltia CMS translates fields with your own AI key, and Front Matter CMS suggests titles, descriptions and tags through GitHub Copilot. TinaCMS and Decap CMS have MCP servers on their roadmaps. CloudCannon leaves AI to the agents you bring. We found none in Keystatic or Pages CMS.
sources:
  - label: "CloudCannon, home page"
    href: https://cloudcannon.com/
  - label: "CloudCannon, official AI information"
    href: https://cloudcannon.com/ai-info/
  - label: "CloudCannon, pricing"
    href: https://cloudcannon.com/pricing/
  - label: "CloudCannon, AI-ready CMS"
    href: https://cloudcannon.com/ai-llm-cms/
  - label: "CloudCannon, llms.txt"
    href: https://cloudcannon.com/llms.txt
  - label: "CloudCannon documentation, creating the configuration file"
    href: https://cloudcannon.com/documentation/developer-articles/create-your-cloudcannon-configuration-file/
  - label: "CloudCannon documentation, an overview of Editable Regions"
    href: https://cloudcannon.com/documentation/developer-guides/set-up-visual-editing/an-overview-of-editable-regions/
  - label: "CloudCannon documentation, default permission groups"
    href: https://cloudcannon.com/documentation/user-articles/what-are-default-permission-groups/
  - label: "Decap CMS, home page"
    href: https://decapcms.org/
  - label: "Decap CMS documentation, introduction"
    href: https://decapcms.org/docs/intro/
  - label: "Decap CMS documentation, installing"
    href: https://decapcms.org/docs/install-decap-cms/
  - label: "Decap CMS documentation, backends overview"
    href: https://decapcms.org/docs/backends-overview/
  - label: "Decap CMS documentation, access your content"
    href: https://decapcms.org/docs/access-your-content/
  - label: "Decap CMS documentation, editorial workflows"
    href: https://decapcms.org/docs/editorial-workflows/
  - label: "Decap CMS documentation, Notes"
    href: https://decapcms.org/docs/notes/
  - label: "Decap CMS documentation, i18n"
    href: https://decapcms.org/docs/i18n/
  - label: "Decap CMS documentation, releases"
    href: https://decapcms.org/docs/releases/
  - label: "Decap CMS, features and roadmap"
    href: https://decapcms.org/features/
  - label: "Decap CMS, State of Decap"
    href: https://decapcms.org/state-of-decap/
  - label: "Decap Turbo, plans and prices"
    href: https://decapcms.org/turbo/
  - label: "Decap CMS, Decap CMS vs other Git-based CMSs"
    href: https://decapcms.org/compare/git-based-cms/
  - label: "Netlify documentation, Git Gateway"
    href: https://docs.netlify.com/manage/security/secure-access-to-sites/git-gateway/
  - label: "Front Matter CMS, home page"
    href: https://frontmatter.codes/
  - label: "Front Matter CMS documentation, introduction"
    href: https://frontmatter.codes/docs
  - label: "Front Matter CMS documentation, getting started"
    href: https://frontmatter.codes/docs/getting-started
  - label: "Front Matter CMS documentation, settings"
    href: https://frontmatter.codes/docs/settings
  - label: "Front Matter CMS documentation, Git integration"
    href: https://frontmatter.codes/docs/git-integration
  - label: "Front Matter CMS documentation, AI features"
    href: https://frontmatter.codes/docs/ai-features
  - label: "Front Matter CMS documentation, multilingual"
    href: https://frontmatter.codes/docs/content-creation/multilingual
  - label: "Front Matter CMS, releases on GitHub"
    href: https://github.com/estruyf/vscode-front-matter/releases
  - label: "Keystatic, home page"
    href: https://keystatic.com/
  - label: "Keystatic documentation, configuration"
    href: https://keystatic.com/docs/configuration
  - label: "Keystatic documentation, adding Keystatic to an Astro project"
    href: https://keystatic.com/docs/installation-astro
  - label: "Keystatic documentation, GitHub mode"
    href: https://keystatic.com/docs/github-mode
  - label: "Keystatic documentation, Keystatic Cloud"
    href: https://keystatic.com/docs/cloud
  - label: "Keystatic documentation, content components"
    href: https://keystatic.com/docs/content-components
  - label: "Pages CMS, home page"
    href: https://pagescms.org/
  - label: "Pages CMS documentation, introduction"
    href: https://pagescms.org/docs/
  - label: "Pages CMS documentation, quick start"
    href: https://pagescms.org/docs/quick-start/
  - label: "Pages CMS documentation, configuration"
    href: https://pagescms.org/docs/configuration/
  - label: "Pages CMS documentation, collaborators"
    href: https://pagescms.org/docs/configuration/collaborators/
  - label: "Pages CMS documentation, settings"
    href: https://pagescms.org/docs/configuration/settings/
  - label: "Pages CMS documentation, database"
    href: https://pagescms.org/docs/development/database/
  - label: "Pages CMS documentation, self-host"
    href: https://pagescms.org/docs/guides/installing/self-host/
  - label: "Pages CMS, CONTENT.md"
    href: https://pagescms.org/CONTENT.md
  - label: "Pages CMS, releases on GitHub"
    href: https://github.com/hunvreus/pagescms/releases
  - label: "Sveltia CMS, home page"
    href: https://sveltiacms.app/
  - label: "Sveltia CMS documentation, what is Sveltia CMS"
    href: https://sveltiacms.app/docs/intro
  - label: "Sveltia CMS documentation, getting started"
    href: https://sveltiacms.app/docs/start
  - label: "Sveltia CMS documentation, backends"
    href: https://sveltiacms.app/docs/backends
  - label: "Sveltia CMS documentation, workflows"
    href: https://sveltiacms.app/docs/workflows
  - label: "Sveltia CMS documentation, translation services"
    href: https://sveltiacms.app/docs/integrations/translations
  - label: "Sveltia CMS documentation, working with AI"
    href: https://sveltiacms.app/docs/working-with-ai
  - label: "Sveltia CMS documentation, Sveltia CMS Additions"
    href: https://sveltiacms.app/docs/additions
  - label: "Sveltia CMS documentation, FAQ"
    href: https://sveltiacms.app/docs/faq
  - label: "TinaCMS documentation, introduction"
    href: https://tina.io/docs
  - label: "TinaCMS, pricing"
    href: https://tina.io/pricing
  - label: "TinaCMS, roadmap"
    href: https://tina.io/roadmap
  - label: "TinaCMS documentation, FAQ"
    href: https://tina.io/docs/introduction/faq
  - label: "TinaCMS documentation, content modelling"
    href: https://tina.io/docs/schema
  - label: "TinaCMS documentation, frameworks"
    href: https://tina.io/docs/integration/frameworks
  - label: "TinaCMS documentation, editorial workflow"
    href: https://tina.io/docs/tinacloud/editorial-workflow
  - label: "TinaCMS documentation, the self-hosted Git provider"
    href: https://tina.io/docs/reference/self-hosted/git-provider/overview
  - label: "TinaCMS, goodbye Forestry.io"
    href: https://tina.io/forestry
  - label: "Galley, the FAQ for developers"
    href: /docs/project/faq/
  - label: "Galley, the tour: what is built and what isn't yet"
    href: /tour/
  - label: "Galley, publishing"
    href: /docs/configuration/publishing/
  - label: "Galley over MCP"
    href: /docs/integrations/mcp/
  - label: "Galley, run a hosted install"
    href: /docs/running/hosted/
  - label: "Galley Cloud"
    href: /cloud/
  - label: "Galley for enterprise and security teams"
    href: /enterprise/
related: [types-of-cms, cloudcannon, tinacms]
---

## What is a Git-based CMS?

A Git-based CMS is an editor for the files a website is built from: Markdown pages, data in JSON or YAML, images. The files stay in the site's own Git repository, beside its code, and published changes end up as commits there. The site rebuilds from the repository, as it would after a developer's commit. Most are used with static sites.

How that compares with a traditional or a headless CMS is in [Traditional vs headless vs Git-based CMS](/compare/types-of-cms/). Several of the eight below call themselves headless; the answers at the end explain in what sense.

## What should you look for?

The files are much the same in all eight. The differences are around them.

**Where the editor runs.** A hosted service you sign in to, a page on your own site, an app on your computer, or your code editor. Each asks for something different: an account (and often a bill), a sign-in set up for the page, a server that runs code, or a developer's tools.

**What a developer writes first.** Most of these tools need a configuration file that lists the collections and every field before an editor sees a form. Some also need code or markup in the site's templates. Ask who keeps that file in step when the site changes.

**Which Git hosts it works with.** Pages CMS and Keystatic work with GitHub only, and so does TinaCloud, TinaCMS's hosted backend. If your repository is on GitLab, Bitbucket or a server of your own, check this first.

**When a change becomes a commit, and who checks it.** In CloudCannon, TinaCMS, Decap CMS, Pages CMS and Sveltia CMS, saving makes a commit, either on the live branch or, where a review workflow is set up, on a branch that goes through a pull request. In Galley, saved changes wait in a proof beside the live site, and publishing is the commit. Ask what the person checking a change actually sees.

**Who can sign in.** With some tools every editor needs an account on your Git host, with write access to the repository. Others invite people by email, and a few add roles or single sign-on.

**What the AI does, and where its change waits.** In November 2026 the eight range from an assistant, multilingual AI translation and search intelligence built into the editor to nothing at all. Some offer MCP, an open standard many AI tools use to connect to other software, and for some it is still on a roadmap. Ask whether an AI's change can go live by itself, or waits for a person.

**Price, and who is behind it.** Most of the software is free and open source. The costs are in the hosted services sold around it, and in hosting the site. Look at who maintains it and how it is supported.

## The eight, side by side

| | Runs as | Config to write | Git hosts | Price (as of Nov 2026) | AI in the editor |
| --- | --- | --- | --- | --- | --- |
| **Galley** (ours) | Local app/CLI, self-hosted Docker, or Galley Cloud (by invite) | None; an optional file corrects what it finds | Any Git remote, or none | Free, Apache-2.0; optional Galley Cloud from $35/mo, no per-seat fees | Assistant (never publishes), AI translations, image/video, search intelligence, `llms.txt`, MCP |
| **CloudCannon** | A hosted service that also builds and hosts | A config file its app can draft; markup for on-page editing | GitHub, GitLab, Bitbucket | No free plan; Standard $55 a month for 3 users | None built in; bring your own agents |
| **Decap CMS** | A page on your site | `config.yml` of collections and fields; a sign-in | GitHub, GitLab, Bitbucket, Gitea, Forgejo, Azure | Free, MIT; Turbo Pro from €19 a month | None; MCP on Turbo's roadmap |
| **Front Matter CMS** | In your code editor (VS Code) | `frontmatter.json`, made when you set it up | — | Free, MIT | GitHub Copilot suggests titles, descriptions, tags; translation through DeepL or Azure AI Translator, your own key |
| **Keystatic** | A page on your site, with server code | `keystatic.config.ts`, in TypeScript | GitHub only (or local files) | Free, MIT; Cloud Pro from $10 a month | None found |
| **Pages CMS** | A hosted service, or one you host | `.pages.yml` of collections and fields | GitHub only | Free, MIT | None found |
| **Sveltia CMS** | A page on your site | `config.yml`, in Decap's format; a sign-in | GitHub, GitLab, Gitea, Forgejo | Free, MIT | Translation, with your own key |
| **TinaCMS** | A page on your site, plus a backend | A schema in `tina/config`; a build step | GitHub on TinaCloud; your own provider if self-hosted | Apache-2.0; TinaCloud free for 2, Team $29 a project a month | Marked "coming soon"; MCP on its roadmap |

Prices are as each product's own pricing page or documentation gave them on 25 November 2026 (and Galley Cloud plans as of November 2026), so check them before you decide. CloudCannon's Standard plan is $49 a month paid yearly. TinaCloud's Team plan is per project, or $290 a year. Keystatic's docs show a dollar sign and name no currency. "None found" means we searched the product's home page, its documentation and its changelog or roadmap for an AI feature in the editor and an MCP server, and found neither. Front Matter's Git hosts are a dash because its pages name none. It edits the files of the project you have open, and its optional Git integration syncs with that repository, so we'd expect any host to work, but its documentation doesn't say so.

## Each one, in a paragraph

Galley first, because it's ours and you should know that before you read the rest. Then the others, in alphabetical order.

### Galley

We make Galley, so read this paragraph with that in mind. It's the open-source AI CMS for static sites, Apache-2.0 and free, first released in November 2026 and now at version {version}. It runs locally (`npx galley-cms` or the Apple-signed and notarized macOS desktop app), self-hosted on your own server with Docker (`ghcr.io/fictiontribe/galley`, with accounts and OpenID Connect SSO built in, new in final checks; [`/enterprise/`](/enterprise/)), or managed on [Galley Cloud](/cloud/) (opening by invitation: dedicated editor machine per site, Cloudflare edge hosting, preview links, instant version rollback without rebuilding, 30–90 day nightly backups, real-time collaboration and live presence, monthly AI credits, and **no per-seat fees** from $35 a month per site or $99 on Agency for five sites). There's no configuration to write first: it reads the framework, collections and fields from the site's own schemas and files without running its code (Astro fits deepest; Docusaurus, Nuxt, Next.js, SvelteKit, Eleventy, Hugo and Jekyll are recognised by convention). Editors change a page in a form, by retyping words on the page, by building and arranging sections visually with the built-in [Arrange page builder](/docs/editing/page-builder/) (drag, reorder, duplicate and drop sections from a visual thumbnail palette with live layout options and zero SSR), or by asking the assistant (which never publishes). It also generates images and short video clips across OpenAI, Google Gemini and OpenRouter, translates pages manually or with AI using a Git-tracked Translation Memory and brand/product Glossary, emits AI-first output (`llms.txt`, `llms-full.txt`, `agent.md`, Markdown twins and per-AI-crawler `robots.txt`), and tracks live Google rankings, keyword gaps and 404 backlink recovery with built-in Search and AI intelligence. Every change waits in [Proof](/how-to/proof-and-publish/) beside the live site, publishing is a commit or pull request to whatever Git remote the site has, and scheduled publishing is built into both open source (scheduled releases via server scheduler or `galley schedule` plus `publishAt` date/time matching and a 1-click GitHub Actions workflow) and Galley Cloud (pre-built zero-latency edge deploys included on every plan). External media buckets support Cloudflare R2 (verified on the real service), Amazon S3 and Cloudflare Images (in progress), and [Galley's MCP server](/docs/integrations/mcp/) lets outside AI tools in (publishing over MCP can be switched off). It's young: TOML is read-only, and there's no SOC 2 report or SLA yet. See [what it does today](/tour/).

**Best for:** we think, sites where the people who change the words aren't developers, and you want visual section building, scheduled publishing, an AI assistant, translations, live search rankings and word-level Proof — with no CMS configuration to write first.

### CloudCannon

CloudCannon calls itself a "Git-based CMS built for speed, security, and zero headaches." It's a commercial hosted service, founded in New Zealand in 2013, and it can also build and host the site. A developer starts with a configuration file that names at least the site generator and the source folder. Its app or command-line tool can draft that file, and it guesses an editing interface for fields it isn't told about. Editing on the page in its Visual Editor needs markup in the templates; its sidebar of fields works without. It connects to GitHub, GitLab and Bitbucket, and every save is a commit. Teams get five default roles on every plan, custom permission groups on Team and Enterprise, and single sign-on on Enterprise. As of November 2026 we found no AI assistant in its editor and no MCP server. Its approach is the agents you already use, "Cursor, Claude Code, GitHub Copilot, a locally hosted model, or something you built yourself", working in the repository, helped by its public agent skills. As of November 2026, Standard is $55 a month, or $49 paid yearly, for three users, with a 21-day trial and no free plan. More in [Galley and CloudCannon](/compare/cloudcannon/).

**Best for:** we think, teams that would rather pay for a live-today service with a 2013 record that edits, builds and hosts the site, with roles, content scheduling and support on every plan, and SAML SSO, SOC 2 Type 2 and an uptime agreement on Enterprise.

### Decap CMS

Decap CMS calls itself "Open source content management for your Git workflow". Netlify created it in 2016 as Netlify CMS, and "In February 2023 Netlify CMS became Decap CMS", in its documentation's words. PM d.o.o., a software company in Slovenia, maintains it. It's a JavaScript app on your site, reached at `/admin`: an `index.html` that loads it, and a `config.yml` in which a developer lists every collection and field. The developer also sets up how editors sign in. Decap has backends for GitHub, GitLab, Bitbucket, Gitea, Forgejo and Azure, plus Netlify's Git Gateway, which Netlify has deprecated, and GitHub sign-in needs an OAuth service, Netlify's or your own. Editors get forms, rich text and a preview pane, an editorial workflow with Draft, In review and Ready, comments on entries (it calls them Notes, and keeps them on GitHub or GitLab), and several languages side by side. Each save is a commit. It has no AI features built in; a command-line tool with an MCP server for Decap Turbo is "On the roadmap". Decap is free under the MIT licence. Decap Turbo, its optional hosted service for sign-in, roles and a faster backend, has a free plan, and Pro starts at €19 a month (as of November 2026). More in [Galley and Decap CMS](/compare/decap-cms/).

**Best for:** we think, a free editor that ships with the site and opens in any browser with no server of its own, on almost any Git host, with review statuses, Notes and several languages at no cost.

### Front Matter CMS

Front Matter calls itself a "Headless CMS right in your code editor": an extension for Visual Studio Code, "the CMS that runs within Visual Studio Code, GitPod, and many more". Elio Struyf built it when he moved from WordPress to Hugo. There's no server and no account. It works on the files of the project you have open, with dashboards for content, media, snippets and data files, a preview of the site, and SEO checks. Setting it up creates a `frontmatter.json` at the root, where you register the content folders and describe content types; on Astro it can generate them from the site's content collections. An optional Git integration syncs your changes to and from the repository. For AI it uses GitHub Copilot's model, if you have the Copilot extension, to suggest titles, descriptions and tags, and it can machine-translate content through DeepL or Azure AI Translator. We found no MCP server. It's free and MIT-licensed, supported by sponsors, and its latest release, 10.14.0, came out on 11 November 2026.

**Best for:** we think, developers and writers who already work in VS Code and want their content organised without leaving it. People who don't use a code editor will be better served by one of the others.

### Keystatic

Keystatic, "a Thinkmill project", describes itself as "A tool that makes Markdown, JSON and YAML content in your codebase editable by humans." A developer adds it to an Astro, Next.js or Remix project and writes `keystatic.config.ts`, which defines the collections, the singletons and every field in TypeScript. Its admin then lives inside the site, at `/keystatic`, as server code, so editing on the deployed site needs a host that runs Node.js; in local mode, people edit the files on their own computer. Editors get forms, and a rich-text editor for Markdoc and MDX with content components the developer defines. GitHub mode needs a GitHub App, and lets in anyone with write access to the repository. Keystatic Cloud handles sign-in instead, so editors need no GitHub account. GitHub is its only Git host. We found no AI feature and no MCP server (November 2026). Keystatic is free under MIT. Keystatic Cloud is free for up to three users per team, and Pro "starts at $10/month" (as of November 2026), adding experimental real-time co-editing and Cloud Images. It has been public since 2023, and its latest release, 0.6.10, came out on 17 November 2026. More in [Galley and Keystatic](/compare/keystatic/).

**Best for:** we think, developers on Astro, Next.js or Remix who want the content model typed in TypeScript, and rich text full of their own components.

### Pages CMS

Pages CMS calls itself "The simplest CMS you'll ever need", and its docs say it "is an open-source CMS for static sites stored in GitHub repositories." The quickest start is its hosted app: sign in with GitHub, install its GitHub App on the repository, and create a `.pages.yml` at the root when prompted, listing the media folder, the collections and their fields. You can also deploy it on Vercel or host it yourself, with a PostgreSQL database for its own state, such as sign-ins and collaborators; the content stays in GitHub. Editors get forms with a rich-text editor, a media manager and search, and people without a GitHub account can be invited by email as collaborators. Saves are written back to GitHub as commits. It works with GitHub only: its FAQ asks "Do you only support GitHub?" and answers "Yes." Scheduling, permissions and comments are marked "Soon" on its home page. We found no AI feature in the editor and no MCP server. It does propose CONTENT.md, a file that describes a repository's content model for people, tools and AI agents. It's "100% free" under MIT, made by Ronan Berder, and its latest release, 2.1.8, came out in June 2026.

**Best for:** we think, a small site on GitHub whose editors need a simple web editor quickly, with nothing to install or pay for.

### Sveltia CMS

Sveltia CMS calls itself "Git-based headless CMS, made right." It's a rewrite of Netlify CMS in Svelte, and it reads an existing Netlify or Decap configuration. Decap's own comparison page calls it "the closest alternative to Decap". Like Decap, it's a page on your site, an `index.html` that loads its script and a `config.yml` of collections and fields, and it "runs entirely in the browser", with no server of its own. It works with GitHub, GitLab, Gitea and Forgejo, but not Bitbucket or Azure. Editors get an asset library, full-text search, languages side by side and an editorial workflow. Its AI feature is translation: a field can be translated by Google Cloud Translation or by a model from Anthropic, OpenAI and others, with your own API key. Its MCP server is for its documentation: it is read-only and helps coding assistants write the configuration, and it doesn't edit content. Sveltia is free under MIT. Sveltia CMS Additions, a free service you deploy to your own Cloudflare account, adds accounts with roles, entry locks and comments, on GitHub only. Sveltia is in beta, with version 1.0 "scheduled for release in late 2026", and one developer, Kohei Yoshino, maintains it.

**Best for:** we think, a Decap or Netlify CMS site that wants what Sveltia says is a faster editor with the same configuration, and multilingual sites. Its own docs say Git-based CMSs like it "are best suited for small to medium-sized projects."

### TinaCMS

TinaCMS describes itself as "an open-source, Git-backed headless content management system (CMS)". Editors work at `/admin` on your site, and behind it runs a backend: TinaCloud, its hosted service, or one you run yourself with a database. A developer writes a schema in `tina/config` and adds `tinacms build` to the build. For visual editing, where the page changes beside the form as you type, they also wire each page, in React or Astro; other frameworks get forms. TinaCMS serves the content through a GraphQL API with a typed client, so a second front end can read it too. Every save is a commit. TinaCloud works with GitHub only, and a self-hosted backend supports GitHub by default, or a Git provider you write. On Team and above, an editorial workflow puts each editor's changes on a branch with a pull request, and Enterprise adds single sign-on. As of November 2026 its pricing page lists "AI features (coming soon)", and its roadmap has an MCP server under "Coming Soon". TinaCMS itself is Apache-2.0. As of November 2026, TinaCloud is free for two users, and Team is $29 a month per project, or $290 a year. It began at Forestry.io, its repository dates from 2019, and SSW maintains it. More in [Galley and TinaCMS](/compare/tinacms/).

**Best for:** we think, React, Next.js or Astro sites whose editors want to see the page change as they type, and developers who want a typed API over the content.

## Which one fits which site?

**If the people who change the site aren't developers,** and you want them to ask for a change in plain words, translate pages, check live search rankings and check Proof beside the live page, we think Galley, with the caveat that it was first released in November 2026. CloudCannon's Visual Editor and TinaCMS's visual editing also let editors work on the page itself.

**If you'd rather buy a service than run anything,** CloudCannon is live today without an invitation and has a 2013 record, editing, building and hosting with support and an SLA on Enterprise. [Galley Cloud](/cloud/) (opening by invitation) hosts both the editor and your static site on Cloudflare's edge with monthly AI credits, real-time collaboration and no per-seat fees. Pages CMS's hosted app is a free and simpler take on a hosted editor, for GitHub only.

**If you need single sign-on,** Galley includes OpenID Connect (OIDC) SSO (new, in final checks) in its free Apache-2.0 self-hosted server ([`/enterprise/`](/enterprise/)). If you need SAML SSO backed by an enterprise contract, SOC 2 or an uptime SLA today, CloudCannon and TinaCMS offer those on their Enterprise plans, with years of production history (since 2013 and 2019). Decap CMS lists single sign-on for Decap Turbo as under consideration.

**If you want a free editor in any browser and your repository isn't on GitHub,** Decap CMS works with the most Git hosts of the editors that run in the browser without a server, and Sveltia CMS works with GitHub, GitLab, Gitea and Forgejo. Galley also publishes to whatever remote the site has, running locally, self-hosted with Docker, or on Galley Cloud.

**If the site is in several languages,** Galley includes built-in multilingual (`i18n`) editing (localized URL slugs, `hreflang`, side-by-side editing with out-of-sync flags, and AI translation with a Git-tracked Translation Memory and brand/product Glossary, checked in Proof). Decap and Sveltia edit languages side by side in the browser (and Sveltia translates fields with your own AI key), Front Matter handles multilingual content in VS Code, and TinaCMS's docs show two ways to model it.

**If editors should see the page change as they type or build pages from sections,** Galley includes on-page editing and the visual [Arrange page builder](/docs/editing/page-builder/) with no template markup required; TinaCMS offers visual editing on React, Next.js or Astro, and CloudCannon offers its Visual Editor (editing on the page itself needs markup).

**If developers want the content model in code,** Keystatic, in TypeScript, or TinaCMS, whose schema also gives them a typed client.

**If only developers and technical writers edit,** Front Matter keeps everything in VS Code.

**If an app also needs the content through an API,** TinaCMS has one. If the content has to reach many channels, a headless CMS is built for that, and [the guide to the three kinds](/compare/types-of-cms/) explains why.

## Where does the Git-based kind fall short?

In the same places for all eight, to different degrees.

**Content for many channels.** These tools mostly serve the website they sit in. TinaCMS has an API; the others leave reading the files to the site's build.

**Large editorial teams.** Multi-stage approval chains, external TMS connectors and granular field-level permissions are where the bigger headless products, and Drupal, have years of work. Among the eight, scheduled publishing is built into Galley (both open source and pre-built zero-latency edge deploys on Galley Cloud) and on CloudCannon's plans, marked "Soon" on Pages CMS's home page, and planned for Sveltia CMS Additions; we didn't find it in Decap CMS, TinaCMS or Keystatic.

**Setup.** Most of them ask a developer for a configuration file that has to stay in step with the site.

**Builds and media.** Each published change rebuilds the site, which takes longer on a big one, and large images and video are heavy to keep in Git (so tools such as Galley and Decap Turbo let teams move media to external R2 or S3 buckets).

There's more on each in [Traditional vs headless vs Git-based CMS](/compare/types-of-cms/).

## Three questions to ask before you choose

**Where will editors work, and what does that need?** A hosted account, a page on the site with a sign-in behind it, a host that runs Node.js, a code editor, a Docker server, or an app on their own computer. Know which before you need it.

**Who describes the content, and who keeps that description in step with the site?** Ask how many lines a new collection takes, and who writes them.

**When an AI makes a change, who sees it before it's live, and in what form?** A pull request reads well to a developer. Ask what the person who knows the page will see.
