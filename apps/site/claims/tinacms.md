# Claims in /compare/tinacms/

Every statement the article makes about TinaCMS, with the page that
supports it. All read on 2026-11-25. Statements about Galley follow
[`../CLAIMS.md`](../CLAIMS.md) and `src/data/status.json`; the few Galley
details new in this article are listed at the end with their docs pages.

| # | On the page | Source | Read |
| --- | --- | --- | --- |
| 1 | In development since 2019; repository since 2019 (lead, table: maturity, body) | GitHub API: `tinacms/tinacms` "created_at": "2019-07-23" — https://github.com/tinacms/tinacms ; footer "© TinaCMS 2019–2026" — https://tina.io/ | 2026-11-25 |
| 2 | Content is Markdown and data files in your own repository; "All your content gets backed by git into JSON/Markdown/MDX files" | https://tina.io/docs ; "Your content is stored in your own GitHub repo" — https://github.com/tinacms/tinacms (repo description) | 2026-11-25 |
| 3 | YAML and TOML work too; TinaCMS edits TOML files and TOML front matter | Collection `format`: "md" \| "markdown" \| "mdx" \| "json" \| "toml" \| "yaml"; `frontmatterFormat`: "yaml" \| "toml" \| "json" — https://tina.io/docs/reference/collections | 2026-11-25 |
| 4 | Every save is a commit; quote "When users make a change in the CMS, a commit is made back to your Git repository." | https://tina.io/docs | 2026-11-25 |
| 5 | Quote: "doesn't lock you into a proprietary database"; leaving needs no content migration | "TinaCMS doesn't lock you into a proprietary database (e.g. WordPress, Contentful, Sanity, etc)." — https://tina.io/docs ; "team members can choose to edit directly in Markdown files in the repository or through the TinaCMS interface." — https://tina.io/cms-for-teams | 2026-11-25 |
| 6 | Quote: "an open-source, Git-backed headless content management system" | "TinaCMS is an open-source, Git-backed headless content management system (CMS)." — https://tina.io/docs (Last Edited February 5, 2026) | 2026-11-25 |
| 7 | A GraphQL API between files and site, served from a "Data Layer", a database that indexes the files | "The TinaCMS Data Layer provides a GraphQL API that serves Markdown and JSON files backed by a database." — https://tina.io/docs/reference/content-api/data-layer | 2026-11-25 |
| 8 | Quotes: "more of an ephemeral cache, since the single source of truth for your content is really your Markdown/JSON files."; "an ephemeral cache" (FAQ) | https://tina.io/docs/reference/content-api/data-layer (Last Edited February 10, 2026) | 2026-11-25 |
| 9 | The database is there for search, pagination and references; TinaCMS needs a database behind its API | "the database acts as a cache to enable advanced features like search, pagination, and cross-referencing between files"; "A database is essential when using markdown with TinaCMS" — https://tina.io/docs/introduction/faq (Q8) | 2026-11-25 |
| 10 | Schema in code, in `tina/config`, as collections of typed fields mapped to folders (lead, short, table: setup, body) | "Your content is modeled in the tina/config.{ts,js,tsx} in your repo using defineConfig." / "A "collection" maps a content type to a directory in your repo." — https://tina.io/docs/schema | 2026-11-25 |
| 11 | Heading: TinaCMS asks a developer to describe the content first | Rows 10 and 13 ; "schema" is "REQUIRED" — https://tina.io/docs/reference/config | 2026-11-25 |
| 12 | Visual editing for React and Astro; other frameworks get the "basic editor", forms (lead, short, table, FAQ, body) | "Visual editing is available in React-based frameworks (NextJS, React, etc), and in Astro without any React in your page tree."; "TinaCMS's default "basic editor" works in a wide variety of frameworks." — https://tina.io/docs/integration/frameworks (Last Edited September 18, 2025) | 2026-11-25 |
| 13 | Quote: "Anyone can start using TinaCMS right away but it is designed for developers to setup and customize." | https://tina.io/docs/introduction/faq (Q3) | 2026-11-25 |
| 14 | An existing site runs `tinacms init` | "TinaCMS can be setup on your site with tinacms init. This installs a few Tina packages, and add some boilerplate." — https://tina.io/docs | 2026-11-25 |
| 15 | `tina-lock.json` "must be checked into source control" | "The tina-lock.json must be checked into source control and pushed to your repo." — https://tina.io/docs/tina-folder/overview | 2026-11-25 |
| 16 | A build step: `tinacms build` before the site's build (short, table: setup) | "make sure that your build command is running tinacms build before your site's build command." — https://tina.io/docs/tinacloud/overview | 2026-11-25 |
| 17 | Generates a typed client from the schema; GraphQL with a typed client (table: content API) | Generated files in `tina/__generated__/` include `types.{js,ts}` and `client.{js,ts}` — https://tina.io/docs/tina-folder/overview ; "we also generate a user-friendly client that simplifies the process of querying your content." — https://tina.io/docs | 2026-11-25 |
| 18 | Visual editing: the page updates beside the form as you type; live as you type in React and Astro (table, short, FAQ, body) | "This is a setup that allows your website and editor window to sit side-by-side, showing your changes in real-time." — https://tina.io/docs/contextual-editing/react ; "editors can see their pages being updated in real-time as they make changes" — https://tina.io/docs/integration/frameworks ; pricing row Visual Editing: "see changes live as you type" — https://tina.io/pricing | 2026-11-25 |
| 19 | React and Next.js: `useTina` hook; quotes "using TinaCMS's data-fetching" and "compatible with client side rendering" | https://tina.io/docs/contextual-editing/react (Last Edited November 30, 2025) | 2026-11-25 |
| 20 | Astro: `@tinacms/astro` and an SSR adapter; quote "You need an SSR adapter"; a data loader, an island and `tinaField()` marks for each editable part | https://tina.io/docs/contextual-editing/astro (Last Edited May 26, 2026) ; https://tina.io/docs/frameworks/astro (Last Edited July 28, 2026) | 2026-11-25 |
| 21 | Hugo, Jekyll and Eleventy are among the frameworks on the basic editor | Setup guides for Hugo, Jekyll and 11ty — https://tina.io/docs/frameworks/hugo , /jekyll , /11ty ; visual editing only in React-based frameworks and Astro — row 12 | 2026-11-25 |
| 22 | Click a headline and its field opens in the sidebar | "Click the headline or a button: it should highlight and open a form in the sidebar to edit live." — https://tina.io/docs/frameworks/astro | 2026-11-25 |
| 23 | Astro production HTML "byte-identical to a TinaCMS-free Astro app", apart from a one-line bootstrap on pages with its islands | "production HTML is byte-identical to a TinaCMS-free Astro app. (Exception: pages that use <TinaIsland> carry a one-line inline bootstrap…)" — https://tina.io/docs/contextual-editing/astro | 2026-11-25 |
| 24 | Vue support "is currently in our backlog" (FAQ) | "Supporting Vue is currently in our backlog. In the meantime, you can use the basic editor to edit your content." — https://tina.io/docs/contextual-editing/vue | 2026-11-25 |
| 25 | Setup guides cover Astro, Next.js, Hugo, Gatsby, Jekyll, Eleventy, Remix and SvelteKit; Astro is its default starter (FAQ) | Docs sidebar: /docs/frameworks/astro, next, hugo, gatsby, jekyll, 11ty, remix, sveltekit, other — https://tina.io/docs ; "Astro is our default starter." — https://tina.io/docs/integration/frameworks | 2026-11-25 |
| 26 | TinaCloud, the hosted backend, sold by the project; the paid plans buy TinaCloud | "Out of the box, we provide an easy-to-use hosted version of the backend, called TinaCloud." — https://tina.io/docs ; Billing unit: "Per project" (Free, Team, Business), "Entire organization" (Enterprise); sign-up buttons go to app.tina.io — https://tina.io/pricing | 2026-11-25 |
| 27 | Free: $0, two users, the limit; free plan for two users (short, table, FAQ, price table) | Free "$0", "Forever", "2 users"; Included Users 2; User Limit 2 — https://tina.io/pricing | 2026-11-25 |
| 28 | Team: $29 a month per project or $290 a year; 3 users included, up to 10 | Plan data "monthlyPrice": 29, "yearlyPrice": 290; Monthly Billing "$29/month" (Monthly Billing row; "$29/project/month" is the column heading); Annual Billing "$290/year"; Included Users 3; User Limit 10 — https://tina.io/pricing | 2026-11-25 |
| 29 | Business: $299 a month or $2,990 a year; 20 users included, no limit | "monthlyPrice": 299, "yearlyPrice": 2990; "$299/month" (Monthly Billing row; "$299/project/month" is the column heading); "$2,990/year"; Included Users 20; User Limit "Unlimited" — https://tina.io/pricing | 2026-11-25 |
| 30 | Enterprise priced on request, users agreed with you; covers the whole organisation; quote "covers every project in your organization" | "Custom", "Contact Sales"; Included Users "Custom"; "Team and Business plans are bought per project. Enterprise covers every project in your organization." — https://tina.io/pricing | 2026-11-25 |
| 31 | The pricing page opens on yearly billing; its large figures, $24 and $249 a month, are the yearly prices spread over twelve months | Card prices in the default view "$24 / project / month", "$290 billed annually (save $58)"; "$249 / project / month", "$2,990 billed annually (save $598)"; columnByLineAnnual "$24/project/month", "$249/project/month" against columnByLine "$29/month" (Monthly Billing row; "$29/project/month" is the column heading), "$299/month" (Monthly Billing row; "$299/project/month" is the column heading) — https://tina.io/pricing | 2026-11-25 |
| 32 | Extra users $9 a month on Team, $18 on Business | Additional Users: Team "$9/user", Business "$18/user"; yearly view "$90/additional seat per year", "$180/additional seat per year" — https://tina.io/pricing | 2026-11-25 |
| 33 | Bandwidth 100 GB a month on Free, 500 GB on Team, unlimited above | Bandwidth / month: "100 GB", "500 GB", "Unlimited", "Unlimited" — https://tina.io/pricing | 2026-11-25 |
| 34 | You can host the backend yourself and pay TinaCloud nothing, at the cost of some features; the pricing page doesn't mention it | "This allows you to run your own TinaCMS Backend, with the flexibility to provide your own database, authentication, and Git integration, independent of TinaCloud." — https://tina.io/docs/self-hosted/overview ; no self-hosting on https://tina.io/pricing ; losses — row 52 | 2026-11-25 |
| 35 | Neither product hosts your site | TinaCloud is "a hosted version of the backend" (row 26); the pricing page sells no site hosting; the docs sidebar has deployment guides for Vercel, Netlify, GitHub Pages and Cloudflare — https://tina.io/docs | 2026-11-25 |
| 36 | TinaCloud works with GitHub only; quote "Currently yes, the first Git provider that TinaCloud integrates with is GitHub." (short, table: Git host, body) | https://tina.io/docs/introduction/faq ("Does TinaCloud only work with GitHub repositories?") | 2026-11-25 |
| 37 | Content files in your GitHub repository (table: your content) | Rows 2 and 36 | 2026-11-25 |
| 38 | Page building: pages from blocks you define; quote "build out full pages using your pre-defined blocks" | "TinaCMS supports block-based editing, so that your editors can build out full pages using your pre-defined blocks (i.e. page sections)." — https://tina.io/docs/editing/blocks | 2026-11-25 |
| 39 | No AI feature in the TinaCMS editor found, as of November 2026 (absence; FAQ "not built in") | Looked at: https://tina.io/pricing (AI rows "coming soon"), https://tina.io/roadmap, https://tina.io/llms.txt, docs sidebar, https://tina.io/ | 2026-11-25 |
| 40 | Pricing: "AI features (coming soon)" on the Team plan; an "AI Assist" row marked "Coming soon" on the paid plans | Team card "AI features (coming soon)"; row "AI Assist": Free "", Team, Business and Enterprise "Coming soon" — https://tina.io/pricing (page data read directly) | 2026-11-25 |
| 41 | Roadmap lists "MCP Server" under "Coming Soon" (short, table, FAQ, body) | "MCP Server: We're working on some ways to leverage AI in the content creation process." in the "Coming Soon" column — https://tina.io/roadmap | 2026-11-25 |
| 42 | ContentHawk under "Working on it now", a GitHub Action for querying and editing content; one use given is AI finding content on a schedule | "Content Changes with GitHub Actions (aka ContentHawk)… a public GitHub Action for querying and editing your content. One of the use cases for this would be using GitHub actions to periodically use AI to find content in your project" — https://tina.io/roadmap | 2026-11-25 |
| 43 | Quote: "LLMs think in it. GEO runs on it. Your CMS should too."; argues that Markdown suits AI (FAQ) | https://tina.io/ ; "TinaCMS is designed to be highly LLM-friendly, mainly because it uses Markdown for structuring content." — https://tina.io/docs/introduction/faq (Q17) | 2026-11-25 |
| 44 | A guide to building with AI coding assistants | "AI coding assistants work best with TinaCMS when you stay in control." — https://tina.io/docs/vibe-coding (Last Edited June 4, 2026) | 2026-11-25 |
| 45 | An llms.txt index of its docs (FAQ) | "a high-level index of TinaCMS documentation for LLMs" — https://tina.io/llms.txt | 2026-11-25 |
| 46 | An example GitHub Action that translates content through an outside model; quote "Content generated by LLMs cannot be considered fully reliable." | "External LLMs are employed for automatic translation." — https://tina.io/docs/guides/internationalization | 2026-11-25 |
| 47 | Saving is the commit, and by default goes straight to the branch | Row 4 ; "Instead of saving your content directly to a protected branch (e.g., main), a new branch is created." (describing what Editorial Workflow changes) — https://tina.io/docs/tinacloud/editorial-workflow | 2026-11-25 |
| 48 | Editorial Workflow on Team and up: saves go to a new branch with a pull request "as a draft or ready for review, your choice"; publishing means merging it "via GitHub" (short, table, FAQ, body) | "Tina's Editorial Workflow is available on the Team, Business and Enterprise plans." — https://tina.io/editorial-workflow ; "A pull request is generated (as a draft or ready for review, your choice)… it can be merged back into the protected branch (e.g., main) via GitHub." — https://tina.io/docs/tinacloud/editorial-workflow (Last Edited August 10, 2026) | 2026-11-25 |
| 49 | Media goes through the same review; a developer can add preview links per branch | "Media follows the same review process as your content."; preview links through a `previewUrl` function in `ui` — https://tina.io/docs/tinacloud/editorial-workflow | 2026-11-25 |
| 50 | GraphQL Content API with filtering, sorting and references, through the generated client; visual editing depends on it | https://tina.io/docs/data-fetching/overview ; https://tina.io/docs/reference/content-api/data-layer ; React visual editing requires "using TinaCMS's data-fetching" — row 19 ; Astro loaders wrapped in `requestWithMetadata()` — https://tina.io/docs/frameworks/astro | 2026-11-25 |
| 51 | Hugo or Jekyll sites on the basic editor can read the files themselves | Hugo guide: "see the changes persisted to your local markdown files" — https://tina.io/docs/frameworks/hugo ; the basic editor "reads/writes file-based content (Markdown, MDX, JSON, etc)" — https://tina.io/docs/integration/frameworks | 2026-11-25 |
| 52 | Self-hosting gives up, in its FAQ's words, "Git Backed Media", "Dynamic Branch Switching at Runtime" and "Search" (FAQ, body) | "What features are unavailable in self-hosted TinaCMS compared to TinaCloud? … 1. Git Backed Media … 2. Dynamic Branch Switching at Runtime … 3. Search" — https://tina.io/docs/introduction/faq (Q6) ; "Search is not currently supported in self-hosted TinaCMS." — https://tina.io/docs/reference/search/overview | 2026-11-25 |
| 53 | TinaCloud re-indexes your files on every push | "The index updates incrementally every time a push is made to your GitHub repository (via webhooks)." — https://tina.io/docs/reference/content-api/data-layer | 2026-11-25 |
| 54 | TinaCloud keeps its data on AWS in the United States | "All of our data is hosted on Amazon Web Services (AWS) databases. These databases are all located in the United States." — https://tina.io/security | 2026-11-25 |
| 55 | Editors don't need GitHub accounts; only whoever connects the repository does | "Only the individual who sets up the TinaCloud project, linking it to a GitHub repository, requires GitHub. Editors can create a TinaCloud account with just their email." — https://tina.io/docs/introduction/faq (Q19) | 2026-11-25 |
| 56 | Self-hosted backend in a Node.js serverless setup "such as Vercel or Netlify" | "The TinaCMS backend is designed to be compatible with any Node.js serverless environment, such as Vercel or Netlify." — https://tina.io/docs/self-hosted/overview | 2026-11-25 |
| 57 | Self-hosted: a database (adapters for MongoDB and Vercel KV), sign-in (Auth.js, Clerk or your own), a Git provider (GitHub by default, or one you write) (body, FAQ) | "We currently have database adapters for the following database implementations: Vercel KV, MongoDB" — https://tina.io/docs/reference/self-hosted/database-adapter/overview ; "Default (Auth.js)", "Clerk", custom — https://tina.io/docs/reference/self-hosted/auth-provider/overview ; "By default, we support a GitHub Git Provider. If you do not use GitHub, you can make your own." — https://tina.io/docs/reference/self-hosted/git-provider/overview | 2026-11-25 |
| 58 | Editors work in "the /admin page on your site"; table: the editor runs at /admin on your site | "Users interact with the CMS by navigating to the /admin page on your site." — https://tina.io/docs ; "The TinaCMS admin is a statically built SPA." — https://tina.io/docs/reference/config | 2026-11-25 |
| 59 | The API gives content that other front ends can fetch; TinaCMS's API can serve an app or a second front end | "It also provides an API, allowing content fetching akin to traditional headless CMS operations." — https://tina.io/docs/introduction/faq (Q8) ; endpoint `https://content.tinajs.io/…` with a Read Only Token — https://tina.io/docs/reference/content-api/content-delivery | 2026-11-25 |
| 60 | A backend that has to answer when the site asks | Our reading of rows 50 and 59: a site that fetches through the API needs the API available when it fetches (at build, or on request). Local mode "will not work when your site is hosted on production." — https://tina.io/docs/introduction/faq (Q9) | 2026-11-25 |
| 61 | Roles quote: "Owner, Admin and Editor on every plan. Enterprise can add custom roles (Beta)."; table: three roles | Roles row description; Free/Team/Business "3", Enterprise "Unlimited (Beta)" — https://tina.io/pricing | 2026-11-25 |
| 62 | Commits can carry each editor's name rather than TinaCloud's app | Default commits "authored by our tina-cloud-app"; "Act as You" and co-authoring options — https://tina.io/docs/tinacloud/git-co-authoring | 2026-11-25 |
| 63 | Single sign-on on Enterprise, "with full support for both SAML and OIDC", through Okta, Entra ID and Google Workspace (short, table, FAQ, body) | "Single Sign-On is included with Enterprise"; Enterprise "SSO included" — https://tina.io/pricing ; "Compatible with leading identity providers including Okta, Entra ID (Azure AD), and Google Workspace, with full support for both SAML and OIDC" — https://tina.io/enterprise | 2026-11-25 |
| 64 | Promises "99.9% server uptime" (Enterprise) | "99.9% server uptime with swift communications if something impacts your sending integration." — https://tina.io/enterprise | 2026-11-25 |
| 65 | TinaCloud has two-factor sign-in | Roadmap "Done": "2FA Authentication… Strengthens security for TinaCloud users" — https://tina.io/roadmap | 2026-11-25 |
| 66 | For several languages, its docs show two ways to model a site, by folder or by field | "Directory-Based Localization" and "Field-Based Localization" — https://tina.io/docs/guides/internationalization | 2026-11-25 |
| 67 | No scheduled publishing found (absence) | Looked at: https://tina.io/pricing , https://tina.io/editorial-workflow , https://tina.io/docs/tinacloud/editorial-workflow , docs sidebar and https://tina.io/llms.txt , https://tina.io/roadmap | 2026-11-25 |
| 68 | Its About page says it began at Forestry.io as an "inline-editing CMS"; editing on the page from the start | "Initially launched as an open-source project by Forestry.io, TinaCMS was developed to create a more flexible, inline-editing CMS experience that was also Git-backed." — https://tina.io/about | 2026-11-25 |
| 69 | TinaCMS sells support and onboarding, with a dedicated account manager on Enterprise; a paid team to call | Business "Business support"; Enterprise "Enterprise support", "Dedicated account manager" — https://tina.io/pricing ; "Priority Support", "Onboarding" (incl. "Migration assistance from other CMS platforms") — https://tina.io/professional-services | 2026-11-25 |
| 70 | GitHub Enterprise on Enterprise | Enterprise "GitHub Enterprise support" — https://tina.io/pricing ; roadmap "Done": "TinaCloud now supports connecting to GitHub enterprise on-premise installations." — https://tina.io/roadmap | 2026-11-25 |
| 71 | Search on TinaCloud | Row 52 ; https://tina.io/docs/reference/search/overview | 2026-11-25 |
| 72 | Quote: "the successor to Forestry.io, now maintained by SSW" | "TinaCMS is the successor to Forestry.io, now maintained by SSW." — https://tina.io/forestry | 2026-11-25 |
| 73 | Quote: "actively developed by SSW", an Australian software consultancy | "TinaCMS is actively developed by SSW, Australia's leading software consultants." — footer of https://tina.io/ and https://tina.io/about | 2026-11-25 |
| 74 | Main repository on GitHub is Apache-2.0 | GitHub API licence "Apache License 2.0" (SPDX "Apache-2.0"); root LICENSE is the Apache 2.0 text — https://github.com/tinacms/tinacms/blob/main/LICENSE | 2026-11-25 |
| 75 | Quote: the whole CMS, "including its Data Layer, is open-source" | "The entire TinaCMS, including its Data Layer, is open-source, allowing for community-driven enhancements and support." — https://tina.io/docs/introduction/faq (Q8) | 2026-11-25 |
| 76 | TinaCloud is a service, and we found no public source for it | The README lists a "TinaCloud" repo (github.com/tinacms/tinacloud), which returns 404 to the public GitHub API — https://github.com/tinacms/tinacms (README); research file §3 | 2026-11-25 |
| 77 | TinaCMS stores each block's type under a `_template` key | "When using the templates property, your document stores each chosen template with the key, `_template`." — https://tina.io/docs/reference/types/object | 2026-11-25 |
| 78 | Pages wired for visual editing fetch through TinaCMS's API and need it, from TinaCloud or your own backend, until changed to read the files | Rows 19, 50, 60 ; the docs describe no way off TinaCMS (no export or removal guide found in the docs sidebar or llms.txt) | 2026-11-25 |
| 79 | Moving the other way means writing a schema | Row 11 | 2026-11-25 |
| 80 | The `tina` folder and `tinacms build` | https://tina.io/docs/tina-folder/overview ; https://tina.io/docs/tinacloud/overview | 2026-11-25 |
| 81 | Question 1's examples: a schema change, a lock file, code in each page | Rows 10, 15, 19–20 | 2026-11-25 |
| 82 | Opinions, written as ours: "mature visual editing" for React and Next.js; "Once wired, it works well"; prices "compare almost like for like"; "We think TinaCMS is right about Markdown in Git"; the table's `better` marks | Based on rows 1, 12, 18, 22, 35, 68. The `better` marks are our judgement (5 ours, 4 theirs, 3 even) | 2026-11-25 |

Not used, because TinaCMS's own pages disagree or don't say: that every npm
package is Apache-2.0 (`@tinacms/datalayer`, `@tinacms/graphql` and
`@tinacms/search` say "SEE LICENSE IN LICENSE", and the only such file points
to a datalayer licence file deleted in 2023, so the article says only that the
repository is Apache-2.0); real-time collaboration or presence (only the About
timeline says TinaCloud "added features like real-time collaboration"; no
current doc describes it); the TinaGPT chatbot (in the About timeline, with no
year and no word on whether it still exists); what "API (Beta)" on Business
is; which plan includes a separate content repository; a free trial of the
paid plans or overage prices (not on the pricing page); the date of the SSW
acquisition (only on adamcogan.com, not tina.io); the disabled SSO add-on in
the pricing page's data; customer logos and star counts. Left out for length,
though checked: the audit log on the roadmap ("Coming Soon"), the security
programme that "follows the criteria set forth by the SOC 2 Framework", v4
("v4 is still a work in progress", 19 November 2026), the 100 MB per-file cap,
the Copilot Instructions roadmap item, and the early migration-skills repo.

The research file and the live pages agreed on every point used. One reading
tool summarised the pricing page's AI Assist row differently; the page's own
data, read directly, matches the research (Free blank; Team, Business and
Enterprise "Coming soon").

Galley details new in this article, with their sources: TOML, including
Hugo's `+++` front matter, is read-only (`/docs/concepts/surgical-edits/`,
`/docs/configuration/collections/`); a list of objects with a `_template` key
becomes page sections (`/docs/concepts/detection/`); in MDX, Galley edits the
Markdown between components and never touches import/export lines or JSX
blocks (`/docs/astro/editable-sites/`); pull requests open on GitHub, or as a
compare link for GitLab or Bitbucket, and a site can commit with no remote
(`/docs/configuration/publishing/`); publishing over MCP can be switched off
(`/docs/integrations/mcp/`, "Modes and safety switches").

## After the independent check (2026-11-25)

61 statements confirmed; four said more than their source, one opinion read as first-hand use, and two prices in this file were quoted with words from a column heading. All corrected. On the page now:

| # | On the page now | Source | Read |
| --- | --- | --- | --- |
| C1 | The Data Layer database, which its docs say you can think of as "more of an ephemeral cache" | "You can think of the database as more of an ephemeral cache, since the single source of truth for your content is really your Markdown/JSON files." — https://tina.io/docs/reference/content-api/data-layer | 2026-11-25 |
| C2 | Visual editing for Vue "is currently in our backlog"; Vue sites get the basic editor | "Supporting Vue is currently in our backlog. In the meantime, you can use the basic editor…" — https://tina.io/docs/contextual-editing/vue | 2026-11-25 |
| C3 | By default, a block's type is under a `_template` key | "You can customise this with the templatesKey property" — https://tina.io/docs/reference/types/object | 2026-11-25 |
| C4 | Its Astro guide says clicking the headline should "open a form in the sidebar to edit live" | https://tina.io/docs/frameworks/astro | 2026-11-25 |
| C5 | "now maintained by SSW", in its Forestry page's words | "TinaCMS is the successor to Forestry.io, now maintained by SSW." — https://tina.io/forestry/ (elsewhere SSW is a logo, not text) | 2026-11-25 |
| C6 | TinaCloud currently works with GitHub only | FAQ: "Currently yes… Other Git providers may be available in the future." — https://tina.io/docs/introduction/faq | 2026-11-25 |
| C7 | Its TinaGPT chatbot answers questions on tina.io, not in the editor | https://tina.io/blog/Introducing-TinaGPT-Chatbot- (6 Jun 2024) | 2026-11-25 |
| C8 | Editing on the page: theirs (live as you type, in React and Astro) | https://tina.io/docs/contextual-editing/react ; https://tina.io/docs/contextual-editing/astro | 2026-11-25 |

Galley's side, corrected: a review site's pull request is opened for you on GitHub, or Galley gives a link to open one on GitLab or Bitbucket (`docs/configuration/publishing.md`).
