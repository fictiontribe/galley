# Claims in /compare/git-based-cms/

Every statement the article makes about another product (in the body, the
table, the short version and the answers), with the page that supports it.
All read on 2026-11-25.

- **Pages CMS, Sveltia CMS and Front Matter CMS** have no versus page. Their
  pages were downloaded fresh today with curl, turned into text, and every
  quotation below was copied from that text, with the sentence around it.
- **CloudCannon, TinaCMS, Decap CMS and Keystatic** reuse the corrected,
  independently checked wording of their versus pages. Where a row cites one
  of those claims files (`claims/cloudcannon.md`, `claims/tinacms.md`,
  `claims/decap-cms.md` in galley-compare-2, `claims/keystatic.md` in
  galley-compare-3), the row number is given. Every quotation from those four
  products on this page was also re-read on the live page today.
- Statements about Galley follow [`../CLAIMS.md`](../CLAIMS.md),
  `research/galley-facts.md` and `src/data/status.json`; the few Galley
  details new to this page are listed at the end.
- Statements about the kind as a whole ("most", "several", "some") are the
  article's own summary of the rows below, and say which products they rest on.
- Inside a quotation from a page, " / " marks where a heading, a card title or
  a table cell meets the line beside it, and "…" marks words left out.
  Apostrophes are copied as each page sets them (some use ’). Words in quotation
  marks inside the "On the page" column, such as table cells, are this
  article's own words.

## CloudCannon

| # | On the page | Source | Read |
| --- | --- | --- | --- |
| 1 | Quote: CloudCannon calls itself a "Git-based CMS built for speed, security, and zero headaches." | Visible text, the line under the H1 ("Visual editing for your team / on the stack AI already knows."): "Git-based CMS built for speed, security, and zero headaches." — https://cloudcannon.com/ | 2026-11-25 |
| 2 | A commercial hosted service (body; table "Runs as"; short 2 "a hosted service") | Paid plans only; the app runs at app.cloudcannon.com and no page describes a self-hosted version for editors — https://cloudcannon.com/pricing/ ; `claims/cloudcannon.md` row 42 | 2026-11-25 |
| 3 | Founded in New Zealand in 2013; "since 2013" (which fits) | "The company was founded in New Zealand in 2013 and the team is distributed." and "Founded: 2013" — https://cloudcannon.com/ai-info/ | 2026-11-25 |
| 4 | It can also build and host the site (body; table "also builds and hosts"; which fits "edits, builds and hosts"; answer 4 "with hosting included") | "CloudCannon builds and hosts your site (or BYO hosting). It's static, secure, and seriously fast." — https://cloudcannon.com/ ; "Hosting is included on all plans (CDN via Cloudflare), but you can also deploy to any hosting provider that supports Git-based deploys." — https://cloudcannon.com/llms.txt | 2026-11-25 |
| 5 | A developer starts with a configuration file that names at least the site generator and the source folder (body; table "A config file") | "At minimum, your CloudCannon Configuration File should define your Static Site Generator (SSG) and Source Folder." — https://cloudcannon.com/documentation/developer-articles/create-your-cloudcannon-configuration-file/ ; `claims/cloudcannon.md` rows 15–16 | 2026-11-25 |
| 6 | Its app or command-line tool can draft that file (body; table "its app can draft") | Configuration Mode writes the file as you click — https://cloudcannon.com/documentation/developer-articles/what-is-configuration-mode/ ; the CLI's `configure generate` "generates a cloudcannon.config.yml to get you started" — `claims/cloudcannon.md` rows 19 and 46 | 2026-11-25 |
| 7 | It guesses an editing interface for fields it isn't told about (our paraphrase) | "If you have not configured your Inputs, CloudCannon will attempt to determine the correct editing interface for your data using the Input value and key name." — https://cloudcannon.com/documentation/developer-articles/what-is-visual-editing/ (`claims/cloudcannon.md` row 18) | 2026-11-25 |
| 8 | On-page editing in the Visual Editor needs markup in the templates; the sidebar of fields works without (body; table "markup for on-page editing"; which fits) | `data-editable="text"` or `<editable-text>` — https://cloudcannon.com/documentation/developer-guides/set-up-visual-editing/an-overview-of-editable-regions/ ; `claims/cloudcannon.md` rows 20 and 47 | 2026-11-25 |
| 9 | Connects to GitHub, GitLab and Bitbucket (body; table; answer 5) | "Git providers: GitHub, GitLab, Bitbucket" — https://cloudcannon.com/ai-info/ ; "Connect your GitHub, GitLab, or Bitbucket repositories to CloudCannon." — https://cloudcannon.com/pricing/ | 2026-11-25 |
| 10 | Every save is a commit (body; "When a change becomes a commit") | "CloudCannon supports GitHub, GitLab, and Bitbucket as Git providers. Every editor action results in a Git commit." — https://cloudcannon.com/llms.txt ; saving will "add a permanent record of your changes in your website's files" — https://cloudcannon.com/documentation/user-guides/editing-in-cloudcannon/saving-your-changes/ | 2026-11-25 |
| 11 | Five default roles on every plan; custom permission groups on Team and Enterprise; single sign-on on Enterprise (body; which fits) | `claims/cloudcannon.md` rows 34–36 ; "Single sign-on / Integrate your SSO/SAML provider to authenticate with CloudCannon." in the pricing table — https://cloudcannon.com/pricing/ | 2026-11-25 |
| 12 | No AI assistant in its editor and no MCP server found, as of November 2026 (body; table "None built in"; answer 6) | Absence. Downloaded https://cloudcannon.com/ , /ai-llm-cms/ , /ai-info/ , /pricing/ , /llms.txt and /documentation/llms.txt (every doc title) and searched them for "MCP" and "Model Context Protocol": no matches. No AI feature rows on the pricing page. Earlier search of the changelog and blog: `claims/cloudcannon.md` row 28 | 2026-11-25 |
| 13 | Quote: its approach is the agents you already use, "Cursor, Claude Code, GitHub Copilot, a locally hosted model, or something you built yourself" (body; table "bring your own agents"; answer 6) | "CloudCannon projects are local-first. Clone the repo and work on your own machine with whatever AI tooling you prefer — Cursor, Claude Code, GitHub Copilot, a locally hosted model, or something you built yourself." — https://cloudcannon.com/ai-llm-cms/ | 2026-11-25 |
| 14 | Open-source agent skills | `claims/cloudcannon.md` row 27 (https://github.com/CloudCannon/agent-skills) | 2026-11-25 |
| 15 | Standard $55 a month, or $49 paid yearly, for three users; 21-day trial; no free plan (body; table; short 4; answer 4) | "$55", "$49", "Standard plan includes:" / "3 users", "Start 21-day trial" — https://cloudcannon.com/pricing/ ; `claims/cloudcannon.md` rows 7 and 14 | 2026-11-25 |
| 16 | Best for: roles, content scheduling and support on every plan; single sign-on and an uptime agreement on Enterprise | "Content scheduling" (Standard) and "Advanced content scheduling" (Team, Enterprise); "Uptime SLA / Service Level Agreement to guarantee uptime on your site."; "Single sign-on" — https://cloudcannon.com/pricing/ ; Standard support and five roles on every plan — `claims/cloudcannon.md` rows 34 and 39 | 2026-11-25 |
| 17 | Content scheduling is on CloudCannon's plans (where it falls short) | Row 16 | 2026-11-25 |

## Decap CMS

| # | On the page | Source | Read |
| --- | --- | --- | --- |
| 18 | Quote: Decap CMS calls itself "Open source content management for your Git workflow" | The H1 of https://decapcms.org/ (visible text) | 2026-11-25 |
| 19 | Netlify created it in 2016 as Netlify CMS | "Netlify created Netlify CMS in 2016. In February 2023 it became Decap CMS, with PM d.o.o. as its maintainer." — https://decapcms.org/state-of-decap/ | 2026-11-25 |
| 20 | Quote: "In February 2023 Netlify CMS became Decap CMS", in its documentation's words (body; answer 2) | "For that reason, Netlify CMS is made to be community-driven, and has never been locked to the Netlify platform (despite the name). In February 2023 Netlify CMS became Decap CMS." — https://decapcms.org/docs/intro/ | 2026-11-25 |
| 21 | PM d.o.o., a software company in Slovenia, maintains it (body; answer 2) | Row 19 ; "PM d.o.o. is a software company of about 30 people, six of them developers, and Decap CMS is part of its regular work, with contributors from around the world alongside." — https://decapcms.org/state-of-decap/ ; registered in Slovenia — https://decapcms.org/turbo/terms/ (`claims/decap-cms.md` row 9) | 2026-11-25 |
| 22 | A JavaScript app on your site, reached at `/admin`; an `index.html` that loads it and a `config.yml` listing every collection and field (body; table "A page on your site", "`config.yml` of collections and fields"; short 2) | "No server or database of its own. Decap CMS is a JavaScript app that runs in the editor’s browser." — https://decapcms.org/state-of-decap/ ; "users navigate to yoursite.com/admin/ to access it"; "Inside the admin folder, you’ll create two files" — https://decapcms.org/docs/install-decap-cms/ ; `claims/decap-cms.md` rows 10–12 | 2026-11-25 |
| 23 | The developer also sets up how editors sign in (body; table "a sign-in") | `claims/decap-cms.md` rows 22–23 | 2026-11-25 |
| 24 | Backends for GitHub, GitLab, Bitbucket, Gitea, Forgejo and Azure, plus Git Gateway (body; table; answer 5; which fits "the most Git hosts") | "Decap ships backends for GitHub, GitLab, Gitea, Forgejo, Bitbucket, Azure and Git Gateway, plus the hosted Decap Turbo backends (turbo-github and turbo-gitlab), which add server-side auth and a caching proxy in front of" … — https://decapcms.org/docs/backends-overview/ . "The most Git hosts" is our count across the eight rows of the table (six hosts plus Git Gateway, against four for Sveltia and three for CloudCannon) | 2026-11-25 |
| 25 | Git Gateway is Netlify's, and Netlify has deprecated it | "Git Gateway is deprecated. While Git Gateway continues to function for sites that currently have it enabled, new Git Gateway configurations are not recommended." — https://docs.netlify.com/manage/security/secure-access-to-sites/git-gateway/ ; "Git Gateway is a Netlify open source project" — https://decapcms.org/docs/git-gateway-backend/ (`claims/decap-cms.md` row 29) | 2026-11-25 |
| 26 | GitHub sign-in needs an OAuth service, Netlify's or your own | `claims/decap-cms.md` row 23 and C5 | 2026-11-25 |
| 27 | Editors get forms, rich text and a preview pane | "Decap provides a web editor with structured fields, rich text, and live preview" — https://decapcms.org/ (`claims/decap-cms.md` rows 40, 69) | 2026-11-25 |
| 28 | An editorial workflow with Draft, In review and Ready | https://decapcms.org/docs/editorial-workflows/ (`claims/decap-cms.md` row 43) | 2026-11-25 |
| 29 | Comments on entries, called Notes, kept on GitHub or GitLab | "Notes let editors leave comments on an entry without touching its content. … stored on your repository host as comments on an issue"; GitHub, GitLab, or Decap Turbo on either — https://decapcms.org/docs/notes/ (`claims/decap-cms.md` row 55) | 2026-11-25 |
| 30 | Several languages side by side (body; which fits) | "The CMS can provide a side by side interface for authoring content in multiple languages." — https://decapcms.org/docs/i18n/ (`claims/decap-cms.md` row 56) | 2026-11-25 |
| 31 | Each save is a commit (body; "When a change becomes a commit") | "it always fetches and commits files in your hosted repository (for example, on GitHub), on the branch you configured in your Decap CMS config.yml file." — https://decapcms.org/docs/access-your-content/ ; "Every change is a commit you can review and revert." — https://decapcms.org/state-of-decap/ ; the table row "Save draft" / "Commits to a new branch (named according to the pattern cms/collectionName/entr…" — https://decapcms.org/docs/editorial-workflows/ | 2026-11-25 |
| 32 | No AI features built in (body; table "None"; answer 6) | Absence: `claims/decap-cms.md` row 36 (home page, features page, Turbo page, llms-full.txt) | 2026-11-25 |
| 33 | Quote: a command-line tool with an MCP server for Decap Turbo is "On the roadmap" (body; table "MCP on Turbo's roadmap"; answer 6) | Under the heading "Roadmap" ("Not built yet, and not available on any plan, including Enterprise. On the roadmap means we have decided to build it; Under consideration is an idea we have not committed to."), the item "Command-line tool and MCP server for AI agents", labelled "Decap Turbo" and "On the roadmap": "A decap command-line tool for everything you do in the Turbo dashboard, such as creating sites and inviting members, with a built-in MCP server so AI agents like Claude, Cursor or Codex can do the same." — https://decapcms.org/features/ | 2026-11-25 |
| 34 | Free under the MIT licence (body; table; answer 4) | "Decap CMS is MIT-licensed. It is free today and will remain free for everyone, always." — https://decapcms.org/ | 2026-11-25 |
| 35 | Decap Turbo, an optional hosted service for sign-in, roles and a faster backend; a free plan; Pro €19 a month (body; table; short 4; answer 4) | "Decap Turbo became generally available in 3.17.0 (14 October 2026): an optional hosted backend with login, roles, a faster content proxy, and deploy status" — https://decapcms.org/state-of-decap/ ; "€0", "€19", "Pro starts at €19/month and grows by the unit" — https://decapcms.org/turbo/ | 2026-11-25 |
| 36 | Best for: ships with the site, opens in any browser, almost any Git host, review statuses and several languages at no cost | Rows 22, 24, 28, 30, 34 ; `claims/decap-cms.md` rows 63–65 | 2026-11-25 |
| 37 | Answer 2: the State of Decap page answers "Is Decap CMS still maintained?" with "Yes" | "Is Decap CMS still maintained? Yes. Releases, contributors, issues closed and security fixes over the last four quarters, and how we counted them." This is the visible lead under the H1 "State of Decap CMS", and also the page's meta description. — https://decapcms.org/state-of-decap/ | 2026-11-25 |
| 38 | Answer 2: 15 stable releases between October 2025 and September 2026 | "From 1 October 2025 to 30 September 2026 (Q4 2025–Q3 2026):" … "Stable releases 15" — https://decapcms.org/state-of-decap/ | 2026-11-25 |
| 39 | Answer 2: latest release 3.18.0, on 18 November 2026; Decap released new versions in 2026 (Sveltia paragraph) | "Our latest release is 3.18.0 published on November 18, 2026." — https://decapcms.org/docs/releases/ ; "The latest release is 3.18.0, from 18 November 2026." — https://decapcms.org/state-of-decap/ | 2026-11-25 |
| 40 | Scheduled publishing not found in Decap (where it falls short) | Absence: `claims/decap-cms.md` row 60 | 2026-11-25 |
| 40a | Which fits: Decap CMS, in use since 2016, lists single sign-on for Decap Turbo as under consideration | Since 2016: row 19. the item "SSO/SAML", labelled "Decap Turbo" and "Under consideration": "Let editors sign in through your organization’s own identity provider instead of an email and password." — https://decapcms.org/features/ (`claims/decap-cms.md` row 59) | 2026-11-25 |

## Front Matter CMS

| # | On the page | Source | Read |
| --- | --- | --- | --- |
| 41 | Quote: Front Matter calls itself a "Headless CMS right in your code editor" (body; answer 3) | The H1 has two parts, "Front Matter" and, under it, "Headless CMS right in your code editor"; the quotation is the second part. The page title is "Headless CMS right in your code editor \| Front Matter". — https://frontmatter.codes/ | 2026-11-25 |
| 42 | An extension for Visual Studio Code; quote "the CMS that runs within Visual Studio Code, GitPod, and many more" (body; table "In your code editor (VS Code)"; short 2) | "Experience the best of both worlds with Front Matter, the CMS that runs within Visual Studio Code, GitPod, and many more." — https://frontmatter.codes/ ; "You can get the extension via: The VS Code marketplace" — https://frontmatter.codes/docs/getting-started | 2026-11-25 |
| 43 | Elio Struyf built it when he moved from WordPress to Hugo | "Initially, Elio Struyf developed the Front Matter extension when migrating from WordPress to Hugo (static-site Generator), in order to facilitate content management." — https://frontmatter.codes/docs | 2026-11-25 |
| 44 | No server and no account | "Front Matter is a content management system that's built right into Visual Studio Code - no need for separate accounts or dependencies on websites or APIs." — https://frontmatter.codes/ ; "Front Matter gives you the power and control of a full-blown CMS, without the hassle of dealing with servers, websites, or APIs." — https://frontmatter.codes/docs | 2026-11-25 |
| 45 | Works on the files of the project you have open, with dashboards for content, media, snippets and data files, a site preview and SEO checks | Feature headings "Content, media, snippets, and data dashboard", "Full site/page preview", "SEO Checks" — https://frontmatter.codes/ ; "With Front Matter, you can create and manage your content directly in Visual Studio Code" — https://frontmatter.codes/docs | 2026-11-25 |
| 46 | Setting it up creates a `frontmatter.json` at the root, where you register content folders and describe content types; on Astro it can generate them from content collections (body; table "made when you set it up") | "In this step, you will need to initialize the project. This will create a frontmatter.json file and a .frontmatter folder in the root of your project in which the media database and templates will be stored."; "Step 3: Register content folder(s)"; "we have added a feature to generate the content types based on the Astro Content Collection(s) you have defined." — https://frontmatter.codes/docs/getting-started ; "open your frontmatter.json and write an entry for the frontMatter.taxonomy.contentTypes setting" — https://frontmatter.codes/docs/content-creation/content-types | 2026-11-25 |
| 47 | An optional Git integration syncs changes to and from the repository | "If you are using git to manage your content, Front Matter CMS can be used to sync your changes from and to your git repository." ; "To enable this feature, you will need to set the frontMatter.git.enabled setting to true." — https://frontmatter.codes/docs/git-integration | 2026-11-25 |
| 48 | Table: Git hosts "—", because its pages name none; we'd expect any host to work, but its documentation doesn't say | Searched the home page, the docs index (https://frontmatter.codes/llms.txt), the Git integration page and getting started for GitHub, GitLab, Bitbucket or any host: none is named. The expectation is our reading of row 47 | 2026-11-25 |
| 49 | AI: GitHub Copilot's model, with the Copilot extension, suggests titles, descriptions and tags (body; table; short 4; answer 6) | "Front Matter CMS allows you to make use of the GitHub Copilot’s Large Language Model (LLM) to provide you title, description, and taxonomy suggestions." ; "When creating new content when you have the GitHub Copilot extension installed, you will get title suggestions based on the provided title." ; "For descriptions and tags, you will get a new field action button which allows you to generate suggestions based on the content." — https://frontmatter.codes/docs/ai-features | 2026-11-25 |
| 50 | It can machine-translate content through DeepL or Azure AI Translator | "By default, the multilingual feature does not include automatic language translation of content. However, you can make use of DeepL or Azure AI Translator for automatic language translation." — https://frontmatter.codes/docs/content-creation/multilingual | 2026-11-25 |
| 51 | No MCP server found | Absence. Searched the home page, the AI features page, the docs index (https://frontmatter.codes/llms.txt) and the full CHANGELOG.md (https://github.com/estruyf/vscode-front-matter/blob/main/CHANGELOG.md) for "MCP": no matches | 2026-11-25 |
| 52 | Free and MIT-licensed, supported by sponsors (body; table; answer 4) | "Front Matter CMS is a free and open-source platform, dedicated to making it one of the best CMSs for your static site generator. If you'd like to support our efforts, consider becoming one of our sponsors." — https://frontmatter.codes/ ; licence MIT (GitHub API, SPDX `MIT`) — https://github.com/estruyf/vscode-front-matter | 2026-11-25 |
| 53 | Latest release 10.14.0, on 11 November 2026 | GitHub release `v10.14.0`, published 2026-11-11T13:18:55Z — https://github.com/estruyf/vscode-front-matter/releases ; "## [10.14.0] - 2026-11-11" — CHANGELOG.md | 2026-11-25 |
| 54 | Front Matter handles multilingual content (which fits) | "Front Matter CMS supports multilingual content. This means that you can create content in multiple languages and manage them in the same workspace." — https://frontmatter.codes/docs/content-creation/multilingual | 2026-11-25 |
| 55 | Best for (written as "we think"): developers and writers who already work in VS Code; people who don't use a code editor are better served elsewhere | Our opinion, from rows 42 and 44. (Decap's comparison page says Front Matter "doesn’t serve non-technical editors"; we didn't quote it) | 2026-11-25 |

## Keystatic

| # | On the page | Source | Read |
| --- | --- | --- | --- |
| 56 | Quote: "a Thinkmill project" | "Keystatic is a Thinkmill project" (under the `npm create @keystatic@latest` box) — https://keystatic.com/ | 2026-11-25 |
| 57 | Quote: "A tool that makes Markdown, JSON and YAML content in your codebase editable by humans." | The line under the H1 "Content Management for your Codebase": "A tool that makes Markdown, JSON and YAML content in your codebase editable by humans. Live edit content on GitHub or your local file system, without disrupting your existing code and workflows." — https://keystatic.com/ | 2026-11-25 |
| 58 | Added to an Astro, Next.js or Remix project; `keystatic.config.ts` defines the collections, singletons and every field in TypeScript (body; table) | `claims/keystatic.md` rows 17, 21–23, 56 | 2026-11-25 |
| 59 | The admin lives inside the site at `/keystatic`, as server code; editing on the deployed site needs a host that runs Node.js (body; table "with server code") | `claims/keystatic.md` rows 45–47 | 2026-11-25 |
| 60 | In local mode, people edit the files on their own computer (body; table "or local files") | `claims/keystatic.md` rows 7 and 48 | 2026-11-25 |
| 61 | Forms, and a rich-text editor for Markdoc and MDX with content components the developer defines | `claims/keystatic.md` rows 28–31 | 2026-11-25 |
| 62 | GitHub mode needs a GitHub App and lets in anyone with write access to the repository | `claims/keystatic.md` rows 25 and 49 | 2026-11-25 |
| 63 | Keystatic Cloud handles sign-in, so editors need no GitHub account | "It skips the more complicated process of setting up GitHub mode, while also allowing team members to edit content without needing a GitHub account." — https://keystatic.com/docs/cloud | 2026-11-25 |
| 64 | GitHub is its only Git host (body; table; short 3; answer 5; "Which Git hosts") | `claims/keystatic.md` row 8 | 2026-11-25 |
| 65 | No AI feature and no MCP server found, November 2026 (body; table "None found"; answer 6) | Absence: `claims/keystatic.md` row 33 | 2026-11-25 |
| 66 | Free under MIT; Cloud free for up to three users per team; quote Pro "starts at $10/month"; Pro adds experimental real-time co-editing and Cloud Images (body; table; short 4; answer 4) | "The free plan allows for up to 3 users per team." ; "Keystatic Cloud Pro starts at $10/month. Adding beyond 3 users to a team costs $5/month per user." ; "Multi-player editing (experimental): collaborate with other editors in real-time on the same document." — https://keystatic.com/docs/cloud ; MIT — `claims/keystatic.md` row 4 | 2026-11-25 |
| 67 | Keystatic's docs show a dollar sign and name no currency (table note) | `claims/keystatic.md` row 14 | 2026-11-25 |
| 68 | Public since 2023; still at 0.x | `claims/keystatic.md` rows 53–54 | 2026-11-25 |
| 69 | Scheduled publishing not found in Keystatic (where it falls short) | Absence: `claims/keystatic.md` row 52 | 2026-11-25 |

## Pages CMS

| # | On the page | Source | Read |
| --- | --- | --- | --- |
| 70 | Quote: Pages CMS calls itself "The simplest CMS you'll ever need" | The H1 of https://pagescms.org/ (visible text). The line under it: "Manage content and media right in your GitHub repository. No database, no API, no extra backend." (also the page's meta description) | 2026-11-25 |
| 71 | Quote: its docs say it "is an open-source CMS for static sites stored in GitHub repositories." | "Pages CMS is an open-source CMS for static sites stored in GitHub repositories. It edits files in your repository directly. There is no separate CMS database for content." — https://pagescms.org/docs/ | 2026-11-25 |
| 72 | The hosted app: sign in with GitHub, install its GitHub App on the repository, create a `.pages.yml` when prompted (body; table "A hosted service"; short 2) | "If you just want to try Pages CMS, use the hosted app. Go to app.pagescms.org. Sign in with GitHub. Install the GitHub App on the account or organization that owns your repository. Open the repository you want to edit. Create .pages.yml when prompted. Start editing." — https://pagescms.org/docs/quick-start/ | 2026-11-25 |
| 73 | `.pages.yml` at the root lists the media folder, the collections and their fields (body; table) | ".pages.yml is the single source of truth for Pages CMS configuration. Place it at the repository root. Pages CMS reads it per repository and per branch." ; in the table of top-level keys, `media` / "Defines where uploaded files are stored and what URLs are written." and `content` / "Defines editable collections and files." — https://pagescms.org/docs/configuration/ | 2026-11-25 |
| 74 | You can deploy it on Vercel or host it yourself, with a PostgreSQL database for its own state, such as sign-ins and collaborators; the content stays in GitHub (body; table "or one you host") | "Yes, Pages CMS is 100% free, whether you want to use the online version, deploy it for free on Vercel, or self-host it." — https://pagescms.org/ ; "Pages CMS stores app state in PostgreSQL: auth data, collaborators, parsed config, and cache metadata. Content itself stays in GitHub." — https://pagescms.org/docs/development/database/ ; "Step 1: Create a PostgreSQL database" — https://pagescms.org/docs/guides/installing/self-host/ | 2026-11-25 |
| 75 | Editors get forms with a rich-text editor, a media manager and search | Feature cards "Visual editor / Rich-text, syntax highlighting, and more.", "Media manager / Drag and drop upload, multi-file selection, and more.", "Search / Fast, full-text and faceted search across your content." — https://pagescms.org/ | 2026-11-25 |
| 76 | People without a GitHub account can be invited by email as collaborators | "Collaborators are invited by email. Use them when someone needs to edit content or media but does not have a GitHub account." — https://pagescms.org/docs/configuration/collaborators/ | 2026-11-25 |
| 77 | Saves are written back to GitHub as commits (body; "When a change becomes a commit") | "Save changes back to GitHub." (How it works) — https://pagescms.org/docs/ ; default commit messages "Create {path} (via Pages CMS)", "Update {path} (via Pages CMS)", "Delete {path} (via Pages CMS)" — https://pagescms.org/docs/configuration/settings/ ; "How collaborator commits work" — https://pagescms.org/docs/configuration/collaborators/ | 2026-11-25 |
| 78 | Quote: its FAQ asks "Do you only support GitHub?" and answers "Yes." (body; table "GitHub only"; short 3; answer 5) | FAQ heading "Do you only support GitHub?", answer "Yes. Supposedly, we could add GitLab and Bitbucket support, but the assumption is the vast majority of users will be on GitHub." — https://pagescms.org/ | 2026-11-25 |
| 79 | Quote: scheduling, permissions and comments are marked "Soon" on its home page (body; where it falls short) | Feature cards "Scheduling Soon / Easily schedule one-off or recurring content updates.", "Permissions Soon / Granular access control for different content types.", "Comments Soon / Let your team leave inline comments on any part of your content." (File storage and Analytics are also marked "Soon") — https://pagescms.org/ | 2026-11-25 |
| 80 | No AI feature in the editor and no MCP server found (body; table "None found"; answer 6) | Absence. Downloaded the home page, all 38 docs pages listed in https://pagescms.org/llms.txt and the README (https://github.com/hunvreus/pagescms), and searched them for "AI", "MCP", "LLM", "agent", "Claude", "OpenAI" and "ChatGPT". The only matches are the "Open in ChatGPT" and "Open in Claude" buttons on every docs page, which open the docs page itself in those tools | 2026-11-25 |
| 81 | It proposes CONTENT.md, a file that describes a repository's content model for people, tools and AI agents | "CONTENT.md is a proposed standard for describing the editable content and media structure of a repository." and "It is intended for:", followed by the list items "contributors editing content directly in Git,", "AI agents making content changes in a repository," and "CMSs and tooling that need a portable content contract." — https://pagescms.org/CONTENT.md | 2026-11-25 |
| 82 | Quote: "100% free" under MIT (body; table; answer 4) | "Yes, Pages CMS is 100% free, whether you want to use the online version, deploy it for free on Vercel, or self-host it. It's MIT licensed through and through, feel free to extend it as you see fit." — https://pagescms.org/ ; GitHub API licence SPDX `MIT` — https://github.com/hunvreus/pagescms | 2026-11-25 |
| 83 | Made by Ronan Berder | Under "Who built this?": "My name is Ronan Berder (@hunvreus). I live in Singapore." ; footer "© Ronan Berder" — https://pagescms.org/ | 2026-11-25 |
| 84 | Latest release 2.1.8, June 2026; released new versions in 2026 (Sveltia paragraph) | GitHub release `2.1.8`, "2.1.8: Fix collaborator access and GitHub rate-limit handling", published 2026-06-08T13:20:35Z; earlier 2026 releases include 2.1.7 (4 June), 2.1.6 and 2.1.5 (30 April) and 2.1.3 (1 April) — https://github.com/hunvreus/pagescms/releases | 2026-11-25 |
| 85 | Which fits: Pages CMS's hosted app is a free and simpler take on a hosted editor, for GitHub only | Rows 72, 78, 82; "simpler" is our judgement, matching its own H1 (row 70) | 2026-11-25 |

## Sveltia CMS

| # | On the page | Source | Read |
| --- | --- | --- | --- |
| 86 | Quote: Sveltia CMS calls itself "Git-based headless CMS, made right." (body; answer 3 "Git-based headless CMS") | The H1 of https://sveltiacms.app/ (visible text; the markup breaks the line after "CMS,"). The line under it: "The most powerful open-source Git-based CMS platform, offering fast, user-friendly content editing for any static site. No subscription required. No server to maintain." | 2026-11-25 |
| 87 | A rewrite of Netlify CMS in Svelte | "Sveltia CMS is a complete rewrite of Netlify CMS with a focus on addressing its shortcomings and providing a better user experience. It’s not a fork of Netlify/Decap CMS, but a new project built from the ground up using Svelte instead of React." — https://sveltiacms.app/docs/faq | 2026-11-25 |
| 88 | It reads an existing Netlify or Decap configuration (body; table "in Decap's format"; which fits "the same configuration") | "Sveltia CMS is the successor to both Netlify CMS and Decap CMS, offering a complete modern rewrite and serving as a direct replacement. It reads your existing configuration, so migrating most sites is as simple as swapping one script tag." — https://sveltiacms.app/ ; "while maintaining compatibility with its configuration format, API and workflow" — https://sveltiacms.app/docs/intro | 2026-11-25 |
| 89 | Quote, attributed to Sveltia: its home page calls it "The successor to Netlify CMS and Decap CMS" | The banner link above the H1 reads "The successor to Netlify CMS and Decap CMS" followed by an arrow — https://sveltiacms.app/ | 2026-11-25 |
| 90 | Quote, attributed to Decap: Decap's own comparison page calls it "the closest alternative to Decap" | "Sveltia CMS is the closest alternative to Decap: a rewrite of Netlify CMS in Svelte that reads the same config.yml, so most sites can switch with small changes." — https://decapcms.org/compare/git-based-cms/ | 2026-11-25 |
| 91 | A page on your site: an `index.html` that loads its script and a `config.yml` of collections and fields (body; table; short 2) | "Create a folder named admin (or any name you prefer) inside your site’s static files folder. Then, under the folder, create an index.html file and a config.yml file with the following content:" ; the index.html loads `https://unpkg.com/@sveltia/cms/dist/sveltia-cms.js` — https://sveltiacms.app/docs/start | 2026-11-25 |
| 92 | Quote: it "runs entirely in the browser", with no server of its own | "The CMS is a small JavaScript bundle served via a content delivery network (CDN) and runs entirely in the browser. Always up-to-date. No build tools or servers required." — https://sveltiacms.app/docs/intro ; "No server to maintain." — https://sveltiacms.app/ | 2026-11-25 |
| 93 | GitHub, GitLab, Gitea and Forgejo, but not Bitbucket or Azure (body; table; answer 5; which fits) | "Sveltia CMS supports the following Git-based backends: GitHub GitLab Gitea/Forgejo" ; "For performance reasons, Sveltia CMS does not support the Azure DevOps, Bitbucket and Git Gateway backends." — https://sveltiacms.app/docs/backends | 2026-11-25 |
| 94 | An asset library, full-text search, languages side by side and an editorial workflow (body; which fits) | "Full-fledged asset library with folders, filters and previews"; "Instant full-text search across every collection and asset"; "Edit languages side by side, translate in one click"; "Editorial Workflow for reviewing changes before they go live" — https://sveltiacms.app/ | 2026-11-25 |
| 95 | AI translation: a field translated by Google Cloud Translation or a model from Anthropic, OpenAI and others, with your own API key (body; table "Translation, with your own key"; short 4; answer 6; which fits) | "With the help of AI, any text field can be translated from another locale without leaving the Content Editor, making it easier to manage multilingual content." ; supported: "Google: Cloud Translation", "Anthropic: Claude Haiku 5.5", "DeepSeek: DeepSeek-V4.1-Flash", "Google: Gemini 3.5 Flash-Lite", "Mistral AI: Mistral Small 4", "OpenAI: GPT-6 Luna" ; "You need to obtain an API key from the translation service provider of your choice." — https://sveltiacms.app/docs/integrations/translations ; "Translate a whole entry or a single field using Google Cloud Translation or an AI model from Anthropic, OpenAI and others — just add your own API key." — https://sveltiacms.app/ | 2026-11-25 |
| 96 | Its MCP server is for its documentation, read-only, helps coding assistants write the configuration, and doesn't edit content | "We provide an MCP server, an official Agent Skill and llms.txt files to help AI agents understand the structure and syntax of the Sveltia CMS configuration." ; "The server is free and read-only, and it doesn’t need an account or an API key." ; "The server provides these read-only tools:", followed by the list items `search_docs`, `get_page`, `list_pages` and `get_navigation` — https://sveltiacms.app/docs/working-with-ai . "Doesn't edit content" is our reading of that tool list | 2026-11-25 |
| 97 | Free under MIT (body; table; answer 4) | "Yes. Sveltia CMS is an open source project released under the MIT License. You can use it for free in both personal and commercial projects." — https://sveltiacms.app/docs/faq | 2026-11-25 |
| 98 | Sveltia CMS Additions: a free service you deploy to your own Cloudflare account; accounts with roles, entry locks and comments; GitHub only | "Sveltia CMS Additions is a free, open-source service that adds the features a team needs to Sveltia CMS. You deploy it to your own Cloudflare account, on the Workers Free plan, and connect it to your site’s GitHub repository." ; "user management with admin, editor and viewer roles"; "entry locks"; "a Conversation panel for comments on each entry"; Requirements: "The GitHub backend. GitHub Enterprise isn’t supported yet." — https://sveltiacms.app/docs/additions | 2026-11-25 |
| 99 | In beta; quote 1.0 "scheduled for release in late 2026"; one developer, Kohei Yoshino, maintains it | "Sveltia CMS is currently in beta, with version 1.0 (GA) scheduled for release in late 2026." ; "This is currently a personal project maintained by a single developer." ; "Sveltia CMS is created and maintained by Kohei Yoshino, a seasoned UX engineer based in Toronto, Canada." — https://sveltiacms.app/docs/intro | 2026-11-25 |
| 100 | Quote, attributed to Sveltia: most open-source Git-based CMSs "either become abandoned or are barely maintained", naming Decap CMS and Pages CMS; "That is Sveltia's view" | "Most open source, Git-based CMS projects either become abandoned or are barely maintained. This includes Netlify CMS, Decap CMS, Static CMS and Pages CMS, among others." — https://sveltiacms.app/docs/intro . Against it: Decap 3.18.0 on 18 November 2026 (row 39), Pages CMS 2.1.8 on 8 June 2026 (row 84) | 2026-11-25 |
| 101 | Quote: its own docs say Git-based CMSs like it "are best suited for small to medium-sized projects." | "Due to these limitations, Git-based CMSs like Sveltia CMS are best suited for small to medium-sized projects. For large projects involving thousands of entries and assets, consider a more robust CMS solution designed for enterprise use." — https://sveltiacms.app/docs/intro | 2026-11-25 |
| 102 | Saving makes a commit, on the main branch or through a pull request ("When a change becomes a commit") | "Simple Workflow: no review process, editors can directly commit changes to the main branch." ; "Preview Workflow: each change is saved to a pull request, so it can be checked on a deploy preview before it’s published, without a review process." ; "Editorial Workflow: includes a review and approval process before changes are merged into the main branch." — https://sveltiacms.app/docs/workflows | 2026-11-25 |
| 103 | Scheduled posts are planned for Sveltia CMS Additions (where it falls short) | "Planned Features" list: "Scheduled posts" — https://sveltiacms.app/docs/additions | 2026-11-25 |

## TinaCMS

| # | On the page | Source | Read |
| --- | --- | --- | --- |
| 104 | Quote: "an open-source, Git-backed headless content management system (CMS)" (body; answer 3 "Git-backed headless") | "TinaCMS is an open-source, Git-backed headless content management system (CMS). It allows you to craft a no-code editing experience on top of your website." — https://tina.io/docs | 2026-11-25 |
| 105 | Editors work at `/admin` on your site (body; table "A page on your site"; short 2) | "Users interact with the CMS by navigating to the /admin page on your site." — https://tina.io/docs | 2026-11-25 |
| 106 | Behind it a backend: TinaCloud, its hosted service, or one you run yourself with a database (body; table "plus a backend") | "Out of the box, we provide an easy-to-use hosted version of the backend, called TinaCloud." — https://tina.io/docs ; "This allows you to run your own TinaCMS Backend, with the flexibility to provide your own database, authentication, and Git integration, independent of TinaCloud." — https://tina.io/docs/self-hosted/overview (`claims/tinacms.md` rows 26, 34, 57) | 2026-11-25 |
| 107 | A schema in `tina/config`; `tinacms build` added to the build (body; table) | `claims/tinacms.md` rows 10 and 16 | 2026-11-25 |
| 108 | Visual editing, where the page changes beside the form as you type, wired per page in React or Astro; other frameworks get forms (body; which fits) | `claims/tinacms.md` rows 12, 18–20 | 2026-11-25 |
| 109 | A GraphQL API with a typed client, so a second front end can read it (body; answer 3; which fits; where it falls short) | `claims/tinacms.md` rows 17 and 59 | 2026-11-25 |
| 110 | Every save is a commit (body; "When a change becomes a commit") | "When users make a change in the CMS, a commit is made back to your Git repository." — https://tina.io/docs | 2026-11-25 |
| 111 | TinaCloud works with GitHub only (body; table; short 3; answer 5; "Which Git hosts") | "Currently yes, the first Git provider that TinaCloud integrates with is GitHub. Other Git providers may be available in the future." — https://tina.io/docs/introduction/faq | 2026-11-25 |
| 112 | A self-hosted backend supports GitHub by default, or a Git provider you write (body; table "your own provider if self-hosted"; answer 5) | "By default, we support a GitHub Git Provider. If you do not use GitHub, you can make your own." — https://tina.io/docs/reference/self-hosted/git-provider/overview | 2026-11-25 |
| 113 | On Team and above, an editorial workflow puts each editor's changes on a branch with a pull request | `claims/tinacms.md` row 48 | 2026-11-25 |
| 114 | Enterprise adds single sign-on (body; which fits) | `claims/tinacms.md` row 63 | 2026-11-25 |
| 115 | Quote: its pricing page lists "AI features (coming soon)" (body; table "Marked "coming soon""; short) | Team card "AI features (coming soon)"; the comparison row "AI Assist" reads "Coming soon" on the paid plans — https://tina.io/pricing (`claims/tinacms.md` row 40) | 2026-11-25 |
| 116 | Quote: its roadmap has an MCP server under "Coming Soon" (body; table; answer 6) | Under the heading "Coming Soon": "MCP Server / We're working on some ways to leverage AI in the content creation process." — https://tina.io/roadmap | 2026-11-25 |
| 117 | TinaCMS itself is Apache-2.0 (body; table; answer 4) | `claims/tinacms.md` row 74 | 2026-11-25 |
| 118 | TinaCloud free for two users; Team $29 a month per project, or $290 a year (body; table; short 4; answer 4; table note) | Plan data "monthlyPrice":0 ("For trying TinaCMS"), "monthlyPrice":29 ("For growing teams"); "$290" — https://tina.io/pricing ; `claims/tinacms.md` rows 27–28 | 2026-11-25 |
| 119 | It began at Forestry.io; its repository dates from 2019 ("since 2019" in which fits); SSW maintains it | "TinaCMS is the successor to Forestry.io, now maintained by SSW." — https://tina.io/forestry ; repository created 2019-07-23 — `claims/tinacms.md` rows 1 and 68 | 2026-11-25 |
| 120 | TinaCMS's docs show two ways to model several languages (which fits) | `claims/tinacms.md` row 66 | 2026-11-25 |
| 121 | Scheduled publishing not found in TinaCMS (where it falls short) | Absence: `claims/tinacms.md` row 67 | 2026-11-25 |

## Statements about several products at once

| # | On the page | Rests on | Read |
| --- | --- | --- | --- |
| 122 | All eight keep content as files in your own repository, which stays its home (heading; short 1) | CloudCannon row 9 and "Content lives in your Git repository as plain files" (https://cloudcannon.com/ai-info/); Decap "Content is stored in your Git repository alongside your code" (https://decapcms.org/docs/intro/); Front Matter row 45; Keystatic row 57 and "No database" (https://keystatic.com/); Pages CMS row 71; Sveltia "Content is stored in your Git repository, giving you full control, complete version history and collaboration capabilities. No database is required." (https://sveltiacms.app/docs/intro); TinaCMS "doesn't lock you into a proprietary database" (`claims/tinacms.md` row 5). TinaCMS's Data Layer and Decap Turbo's mirror are caches of the repository, not its replacement (`claims/tinacms.md` row 8; `claims/decap-cms.md` row 49) | 2026-11-25 |
| 123 | Leaving any of them is "mostly" removing the editor, not exporting the words (short 1) | Row 122. The hedge covers what does sit outside the files: Keystatic Cloud Images keep a reference to a hosted image (`claims/keystatic.md` row 16), Decap's Notes live in an issue (row 29), Pages CMS keeps collaborators in its own database (row 74), Sveltia CMS Additions stores comments in its own service (row 98) | 2026-11-25 |
| 124 | Several call themselves headless (body; answer 3) | Rows 86 (Sveltia), 104 (TinaCMS), 41 (Front Matter) | 2026-11-25 |
| 125 | Most need a configuration file listing the collections and every field; some also need code or markup in templates | Config: Decap row 22, Keystatic row 58, Pages CMS row 73, Sveltia row 91, TinaCMS row 107, Front Matter row 46; CloudCannon's is smaller and its fields can be inferred (rows 5–7). Templates: CloudCannon row 8, TinaCMS row 108 | 2026-11-25 |
| 126 | With some tools every editor needs a Git-host account with write access; others invite by email; a few add roles or single sign-on | Write access: Decap's GitHub backend (`claims/decap-cms.md` row 53), Keystatic GitHub mode (row 62), Sveltia by default ("Each user needs an account with the chosen Git service provider (e.g. GitHub)" — https://sveltiacms.app/docs/intro). Email: Pages CMS row 76, Decap Turbo (`claims/decap-cms.md` row 26). Roles or SSO: CloudCannon row 11, TinaCMS row 114, Sveltia CMS Additions row 98, Decap Turbo row 35 | 2026-11-25 |
| 127 | The eight range from an assistant in the editor to nothing at all; some offer MCP, some only on a roadmap; we found an assistant you can ask for a change only in Galley (body; short 4; answer 6) | Nothing found: Keystatic row 65, Pages CMS row 80. No assistant: CloudCannon row 12, Decap row 32, TinaCMS row 115, Front Matter rows 49–50 (suggestions and translation, not an assistant you ask for a change), Sveltia row 95 (translation). MCP: Sveltia (docs only, row 96); roadmaps: TinaCMS row 116, Decap row 33 | 2026-11-25 |
| 128 | Most of the software is free and open source (short 4; body; answer 4); licences in answer 4 | Seven of eight: Decap row 34, Front Matter row 52, Keystatic row 66, Pages CMS row 82, Sveltia row 97, TinaCMS row 117, Galley; CloudCannon is paid (row 15) | 2026-11-25 |
| 129 | "If an app also needs the content through an API, TinaCMS has one"; "the others leave reading the files to the site's build" | TinaCMS row 109. Decap "provides editorial and admin features via a webpage in a browser, but it doesn’t deliver content." (https://decapcms.org/docs/basic-steps/ ; `claims/decap-cms.md` row 46); CloudCannon "There's no proprietary content API to integrate with" (https://cloudcannon.com/ai-info/); Pages CMS "No database, no API, no extra backend." (row 70); Front Matter "without the hassle of dealing with servers, websites, or APIs" (row 44); Sveltia "it simply reads and writes data files without interacting with your chosen framework" (https://sveltiacms.app/docs/intro); Keystatic's Reader API is a server-side library the site itself calls to read the files (`claims/keystatic.md` rows 41–43) | 2026-11-25 |
| 130 | The opinions, written as ours: every "Best for" line, "Which one fits which site?", answer 1 and short 5 | Our judgement from the rows above; the Galley ones are marked "we think" and "we make it" | 2026-11-25 |

## Galley details new to this page

- Publishes to whatever Git remote the site has, or commits with none ("Any
  Git remote, or none"): `publish.remote` and `publish.push` in
  `/docs/configuration/publishing/`.
- TOML is read-only: `/docs/concepts/surgical-edits/`.
- Roles on a hosted editor keep people out of each other's way and aren't a
  security boundary: `/docs/running/security/` ("Roles are not a security
  boundary").
- The desktop app: `status.json` item `apps` ("A macOS desktop app, and a web
  app.", built).
- The MCP sentence is the coordinator's exact wording; the hosted editor is
  marked "new" and "new and still in final checks" (`status.json`
  `hosted-install`).

## Left out, and why

Left out because the products' own pages disagree with each other, are
someone's opinion of a rival, or don't say:

- **Sveltia's opinions of other products.** Its FAQ says Decap "has been
  incredibly neglected" and "has been stagnant for years"
  (https://sveltiacms.app/docs/faq). Its introduction says "Sveltia CMS is the
  only option that offers first-class multilingual content management
  capabilities right out of the box." and "Tina is a commercial entity that
  mainly caters to large-scale Next.js projects."
  (https://sveltiacms.app/docs/intro). Decap's State of Decap page counts
  15 stable releases and 151 merged pull requests in the year to September
  2026, and Decap, Front Matter and TinaCMS all document multilingual content.
  The article keeps one of Sveltia's claims, attributed, with the release dates
  that answer it (row 100).
- **Download and star counts.** Sveltia's home page says "40k+" weekly npm
  downloads; Decap's comparison page, measuring "the same way for everyone",
  gives Sveltia 5,654 a week and Decap 15,558. The two count differently, so
  neither number is used.
- **Pages CMS on Decap.** Its FAQ calls Decap "Really cool project, but I've
  never been a fan of the user experience." An opinion; not used.
- **Decap's view of Front Matter.** Its comparison page says Front Matter
  "doesn’t serve non-technical editors". We reached a similar view and wrote it
  as our own (row 55), without quoting Decap.
- **Pages CMS and CONTENT.md generation.** The page says "Pages CMS can generate
  a CONTENT.md file from repository configuration", but no docs page shows how,
  so the article says only that Pages CMS proposes the standard.
- **Pages CMS activity after June 2026.** GitHub reports a push on 2026-10-16,
  but the latest release and the last commit on the default branch are from
  June; the article gives only the release. Its repository has moved:
  github.com/pages-cms/pages-cms and github.com/pagescms/pagescms both redirect
  to github.com/hunvreus/pagescms.
- **Front Matter's documentation banner.** frontmatter.codes shows "You are
  currently viewing the BETA version of Front Matter documentation", though the
  banner links back to frontmatter.codes and the getting-started page says the
  beta docs are on beta.frontmatter.codes. The pages were used as they are.
- **Front Matter's older "Front Matter AI".** A sponsors-only feature its
  changelog says was removed ("Removal of the `frontMatter.sponsors.ai.enabled`
  features"); not mentioned.
- **Front Matter's Git hosts.** Not named on its pages, so the table cell is a
  dash, explained under the table (row 48).
- **Keystatic Cloud's currency, and whether $10 includes the first three
  users.** Not stated (`claims/keystatic.md` row 14).
- **Sveltia's translation model names** (for example "Claude Haiku 5.5", "GPT-6
  Luna") are in this file only; Sveltia changes them often, so the article
  names the providers, not the models.
- **TinaCMS's "AI Assist" pricing row** and Decap Turbo's add-on prices: true,
  but more detail than a one-paragraph summary needs; they are on the versus
  pages.

The research files and the live pages agreed on every fact used here. Front
Matter's AI features, its translation through DeepL and Azure AI Translator,
and its Git integration aren't in `research/cms-kinds.md`; they come from its
live pages, read today.

## After the independent check (2026-11-25)

121 statements confirmed, every quotation verbatim. Corrected on the page: CloudCannon's price everywhere as "Standard is $55 a month, or $49 a month paid yearly" (one line said "from $55"); "published changes end up as commits" (in Galley, publishing is the commit; Front Matter's Git sync is optional; Keystatic local mode only writes files); Galley's server carries "(new)" and its accounts "also new"; "plain files, normally in your own Git repository" (Git is optional in Front Matter); CloudCannon's sidebar updates the preview without markup, only editing on the page needs it; Sveltia's speed is attributed to Sveltia; Front Matter's AI cell adds translation through DeepL or Azure AI Translator; Sveltia's config cell adds a sign-in; "its public agent skills" (the repository has no licence file); Decap "the most Git hosts of the editors that run in the browser"; Decap Turbo Pro "from €19"; every "Best for" carries "we think"; every price in the paragraphs carries its month.
