---
title: "Galley vs TinaCMS: two Markdown CMSs compared"
description: TinaCMS and Galley both edit Markdown in your Git repository. How they differ on setup, AI, editing, hosting, teams and price, and when TinaCMS wins.
kind: versus
product: TinaCMS
heading: TinaCMS and Galley both keep your words in Git. TinaCMS asks a developer to describe them first.
name: Galley and TinaCMS
lead: Both edit the Markdown and data files in your repository, and every change ends as a commit. TinaCMS, in development since 2019, adds a schema in code, a GraphQL API and visual editing for React and Astro, with its AI marked coming soon. Galley is free, open-source and new, reads the site as it is and has its assistant built in.
published: "2026-11-25"
checked: November 2026
order: 4
draft: true
short:
  - Both are Git-based. Your content stays as Markdown and data files in your own repository, and leaving either one needs no content migration. In TinaCMS every save is a commit. In Galley changes wait in a proof, and publishing is the commit.
  - TinaCMS has a free plan for two users. Its Team plan is $29 a month per project, or $290 a year (as of November 2026), and its hosted backend, TinaCloud, works with GitHub only. Galley is free and Apache-2.0. You pay for your own AI key and your own hosting.
  - TinaCMS asks a developer for a schema in `tina/config`, a build step and, for visual editing, code in each page, in React or Astro. Other frameworks get forms. Galley reads the site's framework, collections and fields as they already are.
  - TinaCMS lists AI features as "coming soon", and its roadmap has an MCP server under "Coming Soon" (November 2026). Galley has an assistant in the editor that never publishes, a proof of every change, and an MCP server for other AI tools.
  - Choose TinaCMS for a React or Next.js site whose editors want the page to change as they type, for an editorial workflow of branches and pull requests (Team plan and up), for single sign-on (Enterprise), or for years of use behind it. Galley was first released in November 2026 and has little of that yet.
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
      ours: Free. Your AI key and hosting are yours
      theirs: Free for 2; Team $29 a project a month (Nov 2026)
      better: ours
    - label: Setup
      ours: Reads the site as it is
      theirs: A schema in tina/config, and a build step
      better: ours
    - label: Editing on the page
      ours: In the preview, with no markup
      theirs: Live as you type, in React and Astro
      better: even
    - label: Page building
      ours: The site's own sections (preview)
      theirs: Pages from blocks you define
      better: theirs
    - label: AI
      ours: A built-in assistant and an MCP server
      theirs: AI and MCP marked coming soon (Nov 2026)
      better: ours
    - label: Checking a change
      ours: Each change in the site's words, beside the live site
      theirs: Live preview; pull requests on Team
      better: ours
    - label: Content API
      ours: None; the site reads its files
      theirs: GraphQL, with a typed client
      better: theirs
    - label: Teams
      ours: Three roles on a hosted editor (new)
      theirs: Three roles; SSO on Enterprise
      better: theirs
    - label: Where the editor runs
      ours: Your computer, or your own server (new)
      theirs: At /admin on your site
      better: even
    - label: Maturity
      ours: First released November 2026
      theirs: Repository since 2019; developed by SSW
      better: theirs
faq:
  - q: Is Galley an alternative to TinaCMS?
    a: "For many static sites, yes. Both edit the Markdown and data files in your Git repository and commit the changes. Galley is free and open-source, needs no schema or page code for common setups, and has an assistant built in. TinaCMS has what Galley lacks today: mature visual editing for React and Next.js, a GraphQL API, an editorial workflow on Team, single sign-on on Enterprise and years of use."
  - q: How much does TinaCMS cost?
    a: As of November 2026, TinaCloud's Free plan is $0 for two users. Team is $29 a month per project, or $290 a year, with three users included and up to ten. Business is $299 a month or $2,990 a year, with twenty. Enterprise is priced on request and covers the whole organisation. Galley is free; the assistant uses your own Anthropic key.
  - q: Is TinaCMS open source?
    a: Its main repository on GitHub is Apache-2.0, and TinaCMS says the whole CMS, "including its Data Layer, is open-source". TinaCloud, the hosted backend the paid plans buy, is a service, and we found no public source for it. You can host the backend yourself, without TinaCloud's Git-backed media, branch switching at runtime or search. Galley is Apache-2.0 and runs on your computer or your own server (new).
  - q: Does TinaCMS have AI features?
    a: Not built in, as of November 2026. Its pricing page lists "AI features (coming soon)" on the Team plan, and its roadmap has an MCP server under "Coming Soon". It publishes a guide to coding with AI assistants and an llms.txt index of its docs, and argues that Markdown suits AI. Galley has an assistant in the editor and an MCP server today.
  - q: Does TinaCMS need a database?
    a: Yes, behind its API, though not as the home of your content. TinaCMS's GraphQL API is served from a "Data Layer" database, which it calls "an ephemeral cache" of your Markdown and JSON files, there for search, pagination and references. TinaCloud runs that database for you. If you host the backend yourself, you bring one; TinaCMS has adapters for MongoDB and Vercel KV. Galley has no database.
  - q: Which frameworks does TinaCMS support?
    a: Its setup guides cover Astro, Next.js, Hugo, Gatsby, Jekyll, Eleventy, Remix and SvelteKit, and Astro is its default starter. Visual editing, where the page updates as you type, works in React-based frameworks and in Astro. Elsewhere editors get its "basic editor", which is forms. Vue support "is currently in our backlog". Galley fits Astro deepest and recognises Next.js, Hugo, Jekyll and others by their conventions.
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
  - label: "Galley, the tour: what is built and what isn't yet"
    href: /tour/
  - label: "Galley, detection and schema inference"
    href: /docs/concepts/detection/
  - label: "Galley over MCP"
    href: /docs/integrations/mcp/
related: [cloudcannon, decap-cms, types-of-cms]
---

## What do Galley and TinaCMS have in common?

More than most pairs of CMSs. Both are Git-based, and both are a Markdown CMS in the plain sense: the words of the site are files in its repository, and the CMS changes them for people who don't open a code editor. TinaCMS's documentation says "All your content gets backed by git into JSON/Markdown/MDX files", and YAML and TOML work too. Galley edits the same files, except TOML, which it only reads.

Both end in a commit. TinaCMS says "When users make a change in the CMS, a commit is made back to your Git repository." In Galley, changes wait until someone presses Publish, and that is the commit. Neither makes a database the home of your content: TinaCMS says it "doesn't lock you into a proprietary database", and Galley has none.

They part at one point. TinaCMS calls itself "an open-source, Git-backed headless content management system". It puts a GraphQL API between your files and your site, served from a "Data Layer", a database that indexes the files. Its documentation calls that database "more of an ephemeral cache, since the single source of truth for your content is really your Markdown/JSON files." Galley puts nothing in between; the site's build reads the files.

So the choice comes down to setup, AI, editing, the backend and your team.

## How much does each cost?

As of November 2026, TinaCMS sells TinaCloud, its hosted backend, by the project:

| Plan | Paid monthly | Paid yearly | Users included |
| --- | --- | --- | --- |
| Free | $0 | $0 | 2, the limit |
| Team | $29 a month | $290 a year | 3, up to 10 |
| Business | $299 a month | $2,990 a year | 20, no limit |
| Enterprise | Priced on request | Priced on request | Agreed with you |

The pricing page opens on yearly billing, so its large figures, $24 and $249 a month, are the yearly prices spread over twelve months. Extra users are $9 a month on Team and $18 on Business. Bandwidth is 100 GB a month on Free, 500 GB on Team and unlimited above. Enterprise "covers every project in your organization". The figures are from [TinaCMS's pricing page](https://tina.io/pricing); check it before you decide, because plans change. You can also host the backend yourself and pay TinaCloud nothing, at the cost of some features (see below).

Galley costs nothing. It is open-source under Apache-2.0, with one edition and no paid tier today. Two things do cost money. The assistant runs on Anthropic's Claude with your own key, and each request is billed to whoever owns that key. And the site needs hosting, which for static files is often free or cheap.

Neither product hosts your site, so unlike [CloudCannon](/compare/cloudcannon/), the prices compare almost like for like.

## What does a developer have to set up?

TinaCMS is frank about it: "Anyone can start using TinaCMS right away but it is designed for developers to setup and customize." On an existing site, a developer runs `tinacms init`, then models the content in `tina/config`, as collections of typed fields, each collection mapped to a folder. The generated `tina-lock.json` "must be checked into source control", and the build runs `tinacms build` before the site's own build. The schema pays something back: TinaCMS generates a typed client from it, so developers query content with types.

Visual editing, where the page updates beside the form as you type, takes more code. In React and Next.js, each page uses the `useTina` hook, and must be "using TinaCMS's data-fetching" and "compatible with client side rendering". In Astro, you install `@tinacms/astro` and an SSR adapter ("You need an SSR adapter"), then add a data loader, an island and `tinaField()` marks for each editable part. Other frameworks, Hugo, Jekyll and Eleventy among them, get what TinaCMS calls the "basic editor", which is forms. Once wired, it works well: click a headline and its field opens in the sidebar. And on Astro, production HTML is "byte-identical to a TinaCMS-free Astro app", apart from a one-line bootstrap on pages with its islands.

Galley starts by reading the site. It works out the framework, the content collections and every field's type from the site's own schemas and files, without running any of its code. Astro fits deepest; Next.js, Hugo, Jekyll, Eleventy and others are recognised by their conventions. A `galley.config.json` file exists only to correct what it found. Editing on the page needs no markup, because Galley maps the words in the preview back to their fields.

The caveat on our side: detection is only as good as the site is tidy. Words kept in content files get a good form with no work. Copy hard-coded in components gets less, until someone moves it out.

## How does each one use AI?

As of November 2026, we found no AI feature in the TinaCMS editor. Its pricing page lists "AI features (coming soon)" on the Team plan, and an "AI Assist" row marked "Coming soon" on the paid plans. Its [roadmap](https://tina.io/roadmap) lists "MCP Server" under "Coming Soon". Under "Working on it now" is ContentHawk, a GitHub Action for querying and editing content; one use TinaCMS gives for it is having AI find content on a schedule. Meanwhile it makes the case for Markdown: "LLMs think in it. GEO runs on it. Your CMS should too." Its docs have a guide to building with AI coding assistants, and an example GitHub Action that translates content through an outside model, with the honest warning "Content generated by LLMs cannot be considered fully reliable."

Galley puts the assistant inside the editor, beside the page. You ask in plain words; it reads the site before it edits, asks one short question when a request is ambiguous, and quotes the new words back. In content mode it can touch only content and media, and it has no shell or network tool. It never publishes: every change waits in the proof, and a person presses Publish. For people with their own AI tool, [Galley's MCP server](/docs/integrations/mcp/) gives Claude, Cursor or any other MCP client the assistant's tools for reading and changing the site, and their changes wait in the same proof. Unlike the assistant, such a tool can also publish (its instructions say only when you ask) unless publishing over MCP is switched off.

We think TinaCMS is right about Markdown in Git; Galley rests on the same bet. Its AI features aren't out yet, so there is nothing to compare. Our view is that AI in a CMS should sit beside the person who knows what the page should say, with a check a non-developer can read. When TinaCMS's arrive, ask where the AI's change waits, and who sees it first.

## How do you check a change before it goes live?

In TinaCMS, a React or Astro site with visual editing shows the page changing beside the form. After that, the check is Git. Saving is the commit, and by default it goes straight to the branch. On Team and above, Editorial Workflow changes that: saves go to a new branch with a pull request, "as a draft or ready for review, your choice", and publishing means merging it "via GitHub". Media goes through the same review, and a developer can add preview links per branch.

In Galley every change, whether typed in the form, retyped on the page or made by the assistant, lands in [Proof](/how-to/proof-and-publish/): the change in the site's own words, old text struck out and new text written in, beside the live site. Any single change can be put back. Publishing is a commit, or a branch and a pull request on GitHub, GitLab or Bitbucket if the site is set up for review. Undo is a new commit, and history is never rewritten.

The difference is what the reviewer reads. In TinaCMS, a pull request and, if someone set one up, a preview of the branch. In Galley, what changed on the page, in words, before anything is committed.

## How does the site get its content?

In TinaCMS, through its GraphQL Content API, with filtering, sorting and references, asked through the generated client. Visual editing depends on it, though Hugo or Jekyll sites on the basic editor can read the files themselves. TinaCloud runs the API, re-indexes your files on every push, and keeps its data on AWS in the United States. It needs GitHub: "Currently yes, the first Git provider that TinaCloud integrates with is GitHub." Editors don't need GitHub accounts; only whoever connects the repository does.

Or you run the backend yourself, in a Node.js serverless setup "such as Vercel or Netlify". You bring a database (TinaCMS has adapters for MongoDB and Vercel KV), sign-in (Auth.js, Clerk or your own) and a Git provider (GitHub by default, or one you write). TinaCMS's FAQ names what you give up: "Git Backed Media", "Dynamic Branch Switching at Runtime" and "Search". Hosted or not, editors work in "the /admin page on your site".

Galley has no API and no database. The build reads the files, and Galley adds no dependency or build plugin. Its editor runs on your computer, or on your own server (new), not on the live site. It publishes to your repository and your host builds from there, as after any commit.

TinaCMS's API gives developers typed queries, and content that other front ends can fetch, at the cost of a backend that has to answer when the site asks. Galley keeps nothing between your files and your site, which also means no API for an app.

## Which one suits a team?

For a larger team today, TinaCMS. It has "Owner, Admin and Editor on every plan. Enterprise can add custom roles (Beta)." Editorial Workflow (Team and up) gives each editor's work its own pull request, and commits can carry each editor's name rather than TinaCloud's app. Enterprise adds single sign-on, "with full support for both SAML and OIDC", through providers such as Okta, Entra ID and Google Workspace, and promises "99.9% server uptime". TinaCloud has two-factor sign-in. For several languages, its docs show two ways to model a site, by folder or by field. We found no scheduled publishing on its pricing page, docs or roadmap, and Galley has none either.

Galley is behind here, and we'd rather say so than let you find out. Used on your own computer, it has no accounts: anyone who can open the app can publish, so the gate is pull-request mode and your code host's branch protection. A hosted editor, one site per install on a server you run, adds accounts with three roles (owner, editor and contributor), and each publish carries its author's name. The roles keep people out of each other's way; they aren't a security boundary. That hosted editor is new and still in final checks. Single sign-on is planned for later. Everyone on one hosted editor works on one shared copy of the site; a second save of a page someone has just changed is refused, not written over it. There is no live presence.

## Where does Galley fall short?

Beyond teams, in a few places.

- **It's young.** Version {version} of software first released in November 2026. TinaCMS's repository dates from 2019, and its About page says it began at Forestry.io as an "inline-editing CMS".
- **Page building is in preview.** TinaCMS lets editors "build out full pages using your pre-defined blocks". Galley builds pages from the site's own sections, and that part is still in preview.
- **No content API.** If an app or a second front end needs the same content, TinaCMS's API can serve it. Galley can't.
- **TOML is read-only.** Galley shows TOML files, and Hugo's `+++` front matter, but won't edit them. TinaCMS edits both.
- **No support contract.** Help comes through the project's issues on GitHub. TinaCMS sells support and onboarding, with a dedicated account manager on Enterprise.

## When is TinaCMS the better choice?

When the site is React or Next.js and editors want to see the page change as they type. When you want each editor's work on its own branch, with its own pull request and preview, which Editorial Workflow gives you from the Team plan. When single sign-on, GitHub Enterprise or an uptime promise, all on Enterprise, is a requirement this quarter. When developers want a typed GraphQL API over the content, or search (on TinaCloud). When you're coming from Forestry.io: TinaCMS calls itself "the successor to Forestry.io, now maintained by SSW". And when you'd rather adopt a tool in development since 2019, now "actively developed by SSW", an Australian software consultancy, with a paid team to call.

Galley fits when the people who change the site aren't developers and you want them to ask for a change, see exactly what changed and publish it, on a site that needs no schema or page code first. It also fits when you want no backend between your files and your site, and no subscription.

## Can you move from one to the other?

Yes, and more easily than most CMS moves, because the content never leaves the repository. Galley has no importer for TinaCMS, and needs none. To try it, run `npx galley-cms` in the site's folder. Galley doesn't read `tina/config`; it works the fields out from the files, and `galley.config.json` can point it at a folder it missed. TinaCMS stores each block's type under a `_template` key, which Galley's detection reads as page sections (the page builder is in preview). In MDX, Galley edits the Markdown between components and leaves imports and components alone. The `tina` folder and `tinacms build` can stay while you try.

If you leave TinaCMS, look at how the site reads its content. Pages wired for visual editing fetch it through TinaCMS's API, so they need that API, from TinaCloud or your own backend, until a developer changes them to read the files. A Hugo or Jekyll site on the basic editor reads them already. Going the other way means writing a schema for what Galley worked out by itself. The only guided move Galley offers is from [WordPress](/wordpress/), and that one is new, in final checks.

## Three questions to ask before you choose

**Who writes the editor into the site, and who keeps it in step?** Ask what a new collection takes: a schema change, a lock file, code in each page.

**When the AI makes a change, who sees it before it is live, and in what form?** Ask to see it working, not on a roadmap. A pull request reads well to a developer. Ask what the marketer sees.

**What sits between your files and your live site?** If it's an API and a database, ask who runs them, which Git hosts they work with, and what the site does if they stop. Know the answer for any tool before you need it.
