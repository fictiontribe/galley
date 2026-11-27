---
title: "Galley vs Decap CMS: two free Git-based CMSs"
description: Decap CMS (formerly Netlify CMS) and Galley both edit your repository's files, free. How they differ on setup, previews, AI, translations, hosting and teams, and when Decap wins.
kind: versus
product: Decap CMS
heading: Decap CMS and Galley agree on Git and on price. They part ways on setup and AI.
name: Galley and Decap CMS
lead: Both are free, open-source editors for the files in your repository. Decap CMS, created in 2016, is a page on your site, set up by a developer in YAML, with no AI of its own (November 2026). Galley reads the site as it is, builds in an assistant, translations, search intelligence and a proof, and adds optional managed hosting on Galley Cloud.
published: "2026-11-25"
updated: "2026-11-27"
checked: November 2026
order: 5
draft: false
short:
  - "Both are Git-based and free. Your content stays as Markdown, YAML or JSON files in your own repository, and changes are recorded as commits: Decap commits every save; Galley commits when you publish. Decap is MIT-licensed, Galley Apache-2.0. Leaving either needs no export."
  - Decap is an app at `/admin` on your site. A developer writes a `config.yml` that lists every collection and field, and sets up how editors sign in. Galley reads the site's framework, collections and fields as they are, and runs locally, on your own server with Docker, or hosted on [Galley Cloud](/cloud/) (opening by invitation).
  - Decap has no AI features built in; a command-line tool for Decap Turbo with an MCP server is on its roadmap (Nov 2026). Galley has an assistant in the editor that never publishes, multilingual AI translation with Translation Memory and a Glossary, Search and AI intelligence, a proof beside the live site, and an MCP server.
  - Decap Turbo, an optional hosted service from Decap's maintainers, adds hosted sign-in, roles and an activity log (free plan; Pro €19 a month, as of November 2026). [Galley Cloud](/cloud/) (opening by invitation) hosts both the editor and your static site on Cloudflare's edge with real-time co-editing, monthly AI credits and no per-seat fees, from $35 a month per site ($99 on Agency for five sites).
  - Choose Decap if editors should reach the CMS from any browser at `/admin` with no server of its own, or if you need Draft/In review/Ready statuses, Notes on GitHub/GitLab issues, Open Authoring forks, or a tool with a record since 2016. Galley was first released in November 2026.
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
      ours: Free, Apache-2.0; optional Galley Cloud from $35/mo, no per-seat fees
      theirs: Free, MIT; Turbo free for 1 site, Pro €19 a month (Nov 2026)
      better: even
    - label: Where the editor runs
      ours: Local app/CLI, self-hosted Docker, or Galley Cloud (by invite)
      theirs: A page on your site, in any browser, no server of its own
      better: even
    - label: Setup
      ours: Reads the site as it is
      theirs: A config.yml (AI agents can write it), and a sign-in
      better: ours
    - label: Editing
      ours: A form, the page itself, or the assistant
      theirs: Forms, rich text and custom widgets
      better: even
    - label: Preview
      ours: The site itself, from its own dev server
      theirs: A preview pane; custom ones in React
      better: ours
    - label: Checking a change
      ours: Each change in words, beside the live site
      theirs: The preview; pull requests in the workflow
      better: ours
    - label: AI & search intelligence
      ours: Assistant that never publishes, AI translations, SEO/rankings intelligence, MCP
      theirs: None built in; MCP on Turbo's roadmap
      better: ours
    - label: Review and comments
      ours: Pull requests, if the site is set for review
      theirs: Draft, In review, Ready; Notes on entries
      better: theirs
    - label: Several languages
      ours: Built-in i18n, side-by-side editing, AI translation with memory and glossary
      theirs: Side by side, in three file layouts
      better: ours
    - label: Teams & collaboration
      ours: Three roles + OIDC SSO (new) self-hosted; live co-editing on Cloud
      theirs: Git host access; Turbo adds per-collection roles
      better: even
    - label: Maturity
      ours: First released November 2026
      theirs: Since 2016; about 19,500 GitHub stars (Nov 2026)
      better: theirs
faq:
  - q: Is Galley an alternative to Decap CMS?
    a: For many static sites, yes. Both edit the files in your Git repository and record changes as commits (Decap on each save, Galley when you publish), and both open-source editors cost nothing. Galley needs no config file for common setups, previews the real site, and builds in an AI assistant, multilingual AI translation and search intelligence (with optional managed hosting on [Galley Cloud](/cloud/)). Decap, called Netlify CMS until 2023, opens from any browser as a page on your site with no server of its own, with review statuses, Notes on entries, Open Authoring forks and a record since 2016.
  - q: How much does Decap CMS cost?
    a: Decap CMS is free under the MIT licence. Its optional hosted service, Decap Turbo, has a free plan for one site and one seat. As of November 2026, Pro is €19 a month for one site and five seats, then €10 a site and €6 a seat a month, and Enterprise is priced on request. Galley is free under Apache-2.0 (bringing your own AI key when self-hosted); [Galley Cloud](/cloud/) (opening by invitation) adds hosted editing, Cloudflare edge delivery and monthly AI credits from $35 a month per site ($99 on Agency for five sites), with no per-seat fees.
  - q: Does Decap CMS have AI features?
    a: "Not built in, as of November 2026. Its features page lists, for Decap Turbo, a command-line tool with an MCP server for AI agents as \"On the roadmap\" and says it is \"Not built yet\". Decap publishes its documentation in forms AI tools read well, llms.txt and llms-full.txt. Because the content is plain files, any coding agent can already edit it in the repository."
  - q: Is Decap CMS still maintained?
    a: Yes. Its State of Decap page counts 15 stable releases, 151 merged pull requests, from 43 people and automated dependency updates, and 170 closed issues between October 2025 and September 2026. The latest release, 3.18.0, came out on 18 November 2026. It is maintained by PM d.o.o., a Slovenian software company of about 30 people, with contributors from around the world.
  - q: Does Decap CMS need Netlify?
    a: "No. Its documentation says \"Decap CMS doesn't need Netlify\", and it works with GitHub, GitLab, Bitbucket, Gitea, Forgejo, Azure or its own Turbo service, though its GitHub and Bitbucket sign-in use Netlify's OAuth service unless you run your own. Its tutorial does use Netlify Identity with Git Gateway. Netlify's own docs now say \"Git Gateway is deprecated\" and don't recommend it for new setups, while Netlify Identity remains a supported sign-in option."
  - q: Can editors use Decap CMS without a GitHub account?
    a: Yes, with the right backend. With the GitHub backend, each editor needs a GitHub account with push access to the repository. Git Gateway, which Netlify has deprecated, lets you add editors without direct write access, and Decap Turbo invites them by email to sign in with Google, GitHub or an email and password. In Galley, both a self-hosted editor (with accounts and OIDC SSO, new) and [Galley Cloud](/cloud/) let editors sign in without GitHub accounts.
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

Nearly everything underneath. Both are Git-based: the site's words are files in its repository, and the CMS edits them for people who don't use a code editor. Decap's documentation says content "is stored in your Git repository alongside your code for easier versioning", and Galley edits the same kinds of file. Both are free and open source. Leaving either needs no export.

Netlify created Decap in 2016 as Netlify CMS, and in its own documentation's words, "In February 2023 Netlify CMS became Decap CMS." PM d.o.o., a software company in Ljubljana, has maintained it since, with contributors from around the world.

The difference is the editor: where it lives, and what it knows before you start. Decap is an app on your site: its install guide says "users navigate to `yoursite.com/admin/` to access it", and it learns your content from a `config.yml` file a developer writes. Galley's editor isn't on the live site. It runs on your computer (`npx galley-cms` or the Apple-signed macOS desktop app), on your own server with Docker (`ghcr.io/fictiontribe/galley`), or hosted on [Galley Cloud](/cloud/), and works out the content from the site's own files.

## How much does each cost?

Decap CMS costs nothing. Its home page says "It is free today and will remain free for everyone, always." The paid part is Decap Turbo, an optional hosted service from the same maintainers that runs the sign-in and a content proxy for you. As of November 2026, Turbo has three plans:

| Plan | Price | Included |
| --- | --- | --- |
| Free | €0 | 1 site and 1 seat |
| Pro | €19 a month | 1 site and 5 seats, then €10 a site and €6 a seat a month |
| Enterprise | Custom | Unlimited sites and seats (fair use) |

On Pro, custom roles are a €19-a-month add-on and priority support is €99 a month per organisation; Enterprise includes both. Prices are in euros, billed monthly with tax included, and Pro has a 14-day trial with no card. The figures are from [Decap Turbo's page](https://decapcms.org/turbo/); check it before you decide.

Without Turbo, a Decap site costs what its hosting and sign-in cost.

Galley is free and Apache-2.0 to run locally or self-host on your own server; you bring your own AI key and arrange static hosting (everything except chat, AI translation and image/video generation works without an AI key). For teams that want managed hosting with no keys to paste, [Galley Cloud](/cloud/) (opening by invitation) hosts both a dedicated editor machine per site and the live site on Cloudflare's global edge, with monthly AI credits and Search and AI intelligence included and **no per-seat fees** (up to 500 named people per workspace, 100 per site): Partner is $0 a month for agencies whose clients pay directly, Site is $35 a month, Agency is $99 a month (5 live sites included, then $15–$12 per extra site), and Business is $149 a month. On price, both have strong free open-source options and low-cost hosted paths.

## What does a developer have to set up?

This is where they differ most.

Decap's install is two files in an `admin` folder: an `index.html` that loads the app, and a `config.yml` the docs call "the heart of your Decap CMS installation". In it a developer lists every collection and each of its fields, with a widget for each: a string, an image, a date, a list, a relation. It's explicit, and the developer decides exactly what editors see. In our view it's also a second description of the content, to keep in step with the site.

In our view, sign-in takes the most thought. Decap ships backends for GitHub, GitLab, Gitea, Forgejo, Bitbucket and Azure, plus Git Gateway and the hosted Turbo, each with its own way in. "Because GitHub requires a server for authentication", GitHub needs an OAuth service: Netlify's, or your own, and the docs list 21 community projects for it. GitLab can use PKCE, which needs none. For repositories on GitHub or GitLab, Turbo replaces all of it with accounts of its own.

Git Gateway needs a note. Decap's tutorial uses it: "We're using Netlify for our hosting and authentication in this tutorial." Netlify, which makes Git Gateway, says on its own documentation page (last updated 17 September 2026) that "Git Gateway is deprecated". It still works where it is enabled, but "new Git Gateway configurations are not recommended". Netlify Identity, which Git Gateway needs, "will continue as a supported authentication option on Netlify", according to Netlify's update of 19 February 2026. Choose a backend with both in mind.

To make Decap's preview look like your site, you write preview templates. Its features page says "You can write them in React and CSS."

Galley starts by reading the site. It works out the framework, the content collections and every field's type from the site's own schemas and files, without running any of its code. Astro fits deepest. Docusaurus, Nuxt, Next.js, SvelteKit, Eleventy, Hugo and Jekyll are recognised by their conventions, and any folder of Markdown with front matter works. `galley.config.json` exists only to correct what Galley found. On your own computer there's no Galley account to set up, and the preview is the site itself, run by its own dev server.

Our caveat: detection is only as good as the site is tidy. Words hard-coded in components get a thinner form until someone moves them out. Decap's config says exactly what it says.

## How does each one use AI, translations and search intelligence?

Today, Decap doesn't include AI. We found no AI feature in the CMS or in Turbo, on its home page, features page, Turbo page or full documentation (November 2026). It does offer documentation for AI tools: an `llms.txt` index, the whole of the docs in one `llms-full.txt` file, and a page that begins, "AI assistants and coding agents can add Decap CMS to a site and write its config.yml." And since the content is plain files, any coding agent can edit it in the repository.

The plan is on Decap's features page, marked "On the roadmap" for Turbo: a command-line tool "for everything you do in the Turbo dashboard, such as creating sites and inviting members, with a built-in MCP server so AI agents like Claude, Cursor or Codex can do the same", and agents that "will also be able to fill in fields in the entry you have open in the CMS", after which "you review the change and click Save." It is "Not built yet, and not available on any plan, including Enterprise."

Galley puts AI, translation and search intelligence inside the editor today:

- **The built-in assistant.** You [ask in plain words](/how-to/ask-the-assistant/); it reads the site before it edits, asks one short question when a request is ambiguous, quotes the new words back, touches only content and media in content mode, has no shell or network tool, and never publishes. Image and short video generation run across OpenAI, Google Gemini and OpenRouter models.
- **Multilingual (`i18n`) translation.** Both products edit languages side by side. Galley adds localized URL slugs, `hreflang` alternates, Astro `<LanguageSelector />` / `<LocaleHead />` components, automatic out-of-sync flags when the source page changes, and AI translation for single pages or the whole site — using a Git-tracked Translation Memory, a brand/product Glossary and a clear upfront cost estimate before anything runs, with every translated page waiting in Proof.
- **Search and AI intelligence.** Built-in SEO and structured-data checks, Markdown twins, `llms.txt`, per-AI-crawler `robots.txt` controls, live Google search rankings, striking-distance (`#4–#15`) quick wins, keyword research, competitor content gaps, broken-404 backlink recovery with one-click redirects, and AI search answer citations — included on Galley Cloud (at zero AI credits for lookups) or self-hosted with your own search data key.
- **MCP server.** Galley's [MCP server](/docs/integrations/mcp/) gives Claude Desktop, Claude Code, Cursor, VS Code or any MCP client the assistant's tools for reading and changing the site, waiting in Proof. Unlike the assistant, such a tool can also publish (its instructions say only when you ask) unless publishing over MCP is switched off.

We think Decap's roadmap points the right way: the agent fills in the fields, and a person checks and saves. That's close to how Galley works now. The difference, in November 2026, is that ours is built and theirs is a plan. We'd judge theirs when it ships.

## How do you check a change before it goes live?

In Decap, a live preview sits beside the form, and an option lets editors click on content in it to jump to the field that holds it. Without the editorial workflow, saving commits to the branch you configured. With it, "Save draft" commits to a new branch and opens a pull request, the entry shows a status of Draft, In review or Ready, and "Approve and publish" merges the pull request. If your host builds previews of pull requests, Decap's deploy preview links open the unpublished page.

In Galley, every change, from the form, the page, translation or the assistant, lands in [Proof](/how-to/proof-and-publish/): the change in the site's own words, old text struck out and new text written in, beside the live site. Any single change can be put back. Publishing is a commit to your repository, or a branch and a pull request if the site is set up for review. Undo is a new commit. On Galley Cloud, you can also share preview links for unpublished changes and roll back to an earlier version instantly without rebuilding.

The difference is what the reviewer reads. Decap shows the entry in its preview, and a pull request shows the lines that changed. Galley shows what changed on the page, in words.

## How does the site get its content, and who hosts it?

The same way for both: the site's build reads the files. Decap "doesn't deliver content", its docs say, and turning the files into pages is up to the developers and the site generator. Decap doesn't host the site.

Decap's tutorial uses Netlify, but its docs say it "has never been locked to the Netlify platform (despite the name)". Turbo sits between the editor and your Git host: it "mirrors the repo into its own database and serves collections from there", while every save is still "a real commit in your GitHub or GitLab repo". For sites on GitHub, Turbo also tells editors when a saved change is live. Media goes into the repository by default; Cloudinary and Uploadcare can be connected, and Turbo Pro adds a media library in your own S3-compatible bucket (in beta).

Galley publishes to your repository, and your host builds from there. It can also put a site online on Cloudflare (verified on the real service; Vercel deploys are in progress), includes forms and redirects, and supports external media buckets in Cloudflare R2 (verified on the real service), Amazon S3 / S3-compatible stores and Cloudflare Images (in progress). On [Galley Cloud](/cloud/) (opening by invitation), Galley hosts both the editor and your published static site on Cloudflare's global edge, with automatic SSL, custom domains in one DNS record, and nightly repository backups kept 30–90 days.

## Which one suits a team?

Each has a different strength for teams.

In plain Decap, "Your Git host is the gatekeeper": with the Git-host backends, editors sign in with their Git host account, and the CMS can do only what that account may. With the GitHub backend, every editor needs push access to the repository. The editorial workflow and its three statuses work on most of its backends. Notes let editors comment on an entry, stored as comments on an issue on GitHub or GitLab (with the editorial workflow, and off until you turn them on). Several languages can be edited side by side, with three ways to lay out the files. And Open Authoring lets people without access to the repository propose changes through a fork, on GitHub or Forgejo.

Turbo invites editors by email to a Turbo account. Owner and member roles are free on every plan, roles per collection are a Pro add-on enforced on the server, and an activity log shows who saved which entry. Single sign-on, and seeing who else has an entry open, are both "Under consideration". We found no scheduled publishing in Decap's documentation, and Galley has none either.

Galley handles sign-in and collaboration in two ways:

- **Self-hosted ([hosted install](/docs/running/hosted/)):** One isolated container per site (`ghcr.io/fictiontribe/galley`) adds owner, editor and contributor accounts plus **OpenID Connect (OIDC) single sign-on** (new, in final checks — Authorization Code with PKCE, IdP role-claim mapping, `GALLEY_OIDC_ONLY`, Back-Channel Logout) built into the free Apache-2.0 server; see [`/enterprise/`](/enterprise/). Editors share one copy, each publish carries its author's name, and a conflicting save is refused rather than silently overwritten; roles keep people out of each other's way rather than acting as a security boundary.
- **On [Galley Cloud](/cloud/) (opening by invitation):** Real-time collaboration and live presence are built in (faces in the top bar and page list, active field outlines, simultaneous Markdown typing, per-author Proof), with no per-seat fees (up to 500 named people per workspace, 100 per site).

Where Decap still does more for teams: Draft / In review / Ready workflow statuses, Notes (comments) on entries, Open Authoring through forks, and per-collection roles on Turbo Pro.

## Where does Galley fall short?

Beside Decap, in a few clear places:

- **It's young.** Version {version}, first released in November 2026. In the year to September 2026 alone, Decap shipped 15 stable releases and merged 151 pull requests, from 43 people and automated dependency updates.
- **No `/admin` page without a server.** Decap runs purely in the editor's browser as a static page on your site. Galley runs on your computer, on your own server with Docker, or on Galley Cloud (opening by invitation).
- **No editorial statuses, Notes or Open Authoring forks.** Galley relies on Proof and Git pull requests rather than Draft/In review/Ready statuses, issue-backed entry comments or fork-based contributions.
- **The desktop app is verified on macOS only.** The macOS desktop app is Apple-signed and notarized; Windows and Linux builds haven't yet been verified in a person's hands.
- **Page building is in preview.**
- **Self-hosted AI needs your own keys.** Galley Cloud includes monthly AI credits; on local or self-hosted installs, chat, AI translation and image/video generation use your own API keys.

## When is Decap CMS the better choice?

When you want a free CMS that ships as part of the site, with "No server or database of its own", which editors open from any browser, on GitHub, GitLab, Bitbucket, Gitea, Forgejo or Azure. When your team needs Draft/In review/Ready statuses, Notes on entries, or three specific i18n file layouts without running a server. When outside contributors should propose changes without access to the repository through Open Authoring forks. When you'd pay €19 a month for Turbo Pro's hosted sign-in and per-collection roles today without waiting for an invitation. And when a long record matters: Decap has been in use since 2016, has about 19,500 stars on GitHub (Nov 2026), and has a company behind it.

Galley fits when the people who change the site aren't developers, and you want them to ask for a change in words, translate pages with AI and a Translation Memory, check live search rankings, see every edit side by side in Proof and publish — on a site that needs no CMS configuration to start, with free OIDC SSO self-hosted or real-time collaboration and Cloudflare hosting on [Galley Cloud](/cloud/). See [what Galley does today](/tour/).

## Can you move from Decap CMS to Galley?

Yes, and there's little to move. The content is already files in your repository, so Galley needs no importer for it, and it has none. (Its only guided move is from [WordPress](/wordpress/), and that one is new, in final checks.) To try Galley, run `npx galley-cms` in the site's folder, or open the repository in the desktop app. Galley doesn't use Decap's `config.yml`; it reads the collections from the site's own files and schemas. Galley doesn't read the `admin` folder, so we expect it can stay while you try.

To leave Decap, take out the `admin` folder and whatever sign-in it used, such as an OAuth handler or Git Gateway. Notes stay where Decap kept them, in an issue on your repository host.

For Decap's model with a different editor, Decap's own comparison page calls Sveltia CMS "the closest alternative to Decap", a rewrite that "reads the same config.yml".

## Three questions to ask before you choose

**Who writes the description of your content, and who keeps it in step with the site?** With Decap it's a `config.yml` a developer looks after. Ask how many lines a new collection takes.

**How will editors sign in, and what does that depend on?** Name the backend, ask whether it needs an OAuth service, and check that the company running that service still recommends it for new sites.

**When an AI makes a change, who sees it before it's live, and in what form?** A pull request reads well to a developer. Ask what the person who knows the page will see.
