---
title: "Galley vs Decap CMS: two free Git-based CMSs"
description: Decap CMS (formerly Netlify CMS) and Galley both edit your repository's files, free. How they differ on setup, previews, AI and teams, and when Decap wins.
kind: versus
product: Decap CMS
heading: Decap CMS and Galley agree on Git and on price. They part ways on setup and AI.
name: Galley and Decap CMS
lead: Both are free, open-source editors for the files in your repository. Decap CMS, created in 2016, is a page on your site, set up by a developer in YAML, with no AI of its own. Galley reads the site as it is and builds an assistant and a check into the editor, and it is new.
published: "2026-11-25"
checked: November 2026
order: 5
draft: true
short:
  - Both are Git-based and free. Your content stays as Markdown, YAML or JSON files in your own repository, and each change ends as a commit. Decap commits every save; Galley commits when you publish. Decap is MIT-licensed, Galley Apache-2.0. Leaving either needs no export.
  - Decap is an app at /admin on your site. A developer writes a config.yml that lists every collection and field, and sets up how editors sign in. Galley reads the site's framework, collections and fields as they are, and runs on your computer or your own server (new).
  - Decap has no AI features built in. A command-line tool for Decap Turbo, with an MCP server, is on its roadmap (Nov 2026). Galley has an assistant in the editor that never publishes, a proof of every change beside the live site, and an MCP server.
  - Decap Turbo, an optional hosted service from Decap's maintainers, adds hosted sign-in, roles and an activity log. It has a free plan, and Pro is €19 a month (as of November 2026). Galley has no paid tier.
  - Choose Decap if editors should reach the CMS from any browser with no server of its own, or if you need review statuses, comments on entries, several languages, or a tool that dates from 2016. Galley was first released in November 2026.
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
      ours: Free, Apache-2.0; your AI key and hosting
      theirs: Free, MIT; Turbo Pro €19 a month (Nov 2026)
      better: even
    - label: Where the editor runs
      ours: Your computer, or your own server (new)
      theirs: A page on your site, in any browser
      better: theirs
    - label: Setup
      ours: Reads the site as it is
      theirs: A config.yml of collections, and a sign-in
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
    - label: AI in the editor
      ours: An assistant that never publishes, and MCP
      theirs: None built in; MCP on Turbo's roadmap
      better: ours
    - label: Review and comments
      ours: Pull requests, if the site is set for review
      theirs: Draft, In review, Ready; Notes on entries
      better: theirs
    - label: Several languages
      ours: No multi-locale workflow
      theirs: Side by side, in three file layouts
      better: theirs
    - label: Teams
      ours: Three roles on a hosted editor (new)
      theirs: Git host access; Turbo adds roles
      better: theirs
    - label: Maturity
      ours: First released November 2026
      theirs: Since 2016; about 19,500 GitHub stars
      better: theirs
faq:
  - q: Is Galley an alternative to Decap CMS?
    a: For many static sites, yes. Both edit the files in your Git repository, commit each change and cost nothing. Galley needs no config file for common setups, previews the real site and has an assistant built in. Decap, called Netlify CMS until 2023, opens from any browser as a page on your site, with an editorial workflow, comments on entries, several languages and a far longer record.
  - q: How much does Decap CMS cost?
    a: Decap CMS is free under the MIT licence. Its optional hosted service, Decap Turbo, has a free plan for one site and one seat. As of November 2026, Pro is €19 a month for one site and five seats, then €10 a site and €6 a seat a month, and Enterprise is priced on request. Galley is free too; its assistant uses your own Anthropic key.
  - q: Does Decap CMS have AI features?
    a: "Not built in, as of November 2026. Its features page lists, for Decap Turbo, a command-line tool with an MCP server for AI agents as \"On the roadmap\" and says it is \"Not built yet\". Decap publishes its documentation in forms AI tools read well, llms.txt and llms-full.txt. Because the content is plain files, any coding agent can already edit it in the repository."
  - q: Is Decap CMS still maintained?
    a: Yes. Its State of Decap page counts 15 stable releases, 151 merged pull requests, from 43 people and automated dependency updates, and 170 closed issues between October 2025 and September 2026. The latest release, 3.18.0, came out on 18 November 2026. It is maintained by PM d.o.o., a Slovenian software company of about 30 people, with contributors from around the world.
  - q: Does Decap CMS need Netlify?
    a: "No. Its documentation says \"Decap CMS doesn't need Netlify\", and it works with GitHub, GitLab, Bitbucket, Gitea, Forgejo, Azure or its own Turbo service, though its GitHub and Bitbucket sign-in use Netlify's OAuth service unless you run your own. Its tutorial does use Netlify Identity with Git Gateway. Netlify's own docs now say \"Git Gateway is deprecated\" and don't recommend it for new setups, while Netlify Identity remains a supported sign-in option."
  - q: Can editors use Decap CMS without a GitHub account?
    a: Yes, with the right backend. With the GitHub backend, each editor needs a GitHub account with push access to the repository. Git Gateway, which Netlify has deprecated, lets you add editors without direct write access, and Decap Turbo invites them by email to sign in with Google, GitHub or an email and password. In Galley, a hosted editor (new) has accounts of its own.
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
  - label: "Sveltia CMS, home page"
    href: https://sveltiacms.app/
  - label: "Galley, the FAQ for developers"
    href: /docs/project/faq/
  - label: "Galley, the tour: what is built and what isn't yet"
    href: /tour/
  - label: "Galley over MCP"
    href: /docs/integrations/mcp/
  - label: "Galley, run a hosted install"
    href: /docs/running/hosted/
related: [cloudcannon, tinacms, types-of-cms]
---

## Decap CMS and Galley: what do they have in common?

Nearly everything underneath. Both are Git-based: the site's words are files in its repository, and the CMS edits them for people who don't use a code editor. Decap's documentation says content "is stored in your Git repository alongside your code for easier versioning", and Galley edits the same kinds of file. Both are free and open source. Leaving either needs no export.

Netlify created Decap in 2016 as Netlify CMS, and in its own documentation's words, "In February 2023 Netlify CMS became Decap CMS." PM d.o.o., a software company in Ljubljana, has maintained it since, with contributors from around the world.

The difference is the editor: where it lives, and what it knows before you start. Decap is an app on your site: its install guide says "users navigate to `yoursite.com/admin/` to access it", and it learns your content from a `config.yml` file a developer writes. Galley's editor isn't on the site. It runs on your computer, or on a server you run (new), and works out the content from the site's own files.

## How much does each cost?

Decap CMS costs nothing. Its home page says "It is free today and will remain free for everyone, always." The paid part is Decap Turbo, an optional hosted service from the same maintainers that runs the sign-in and a content proxy for you. As of November 2026, Turbo has three plans:

| Plan | Price | Included |
| --- | --- | --- |
| Free | €0 | 1 site and 1 seat |
| Pro | €19 a month | 1 site and 5 seats, then €10 a site and €6 a seat a month |
| Enterprise | Custom | Unlimited sites and seats (fair use) |

On Pro, custom roles are a €19-a-month add-on and priority support is €99 a month per organisation; Enterprise includes both. Prices are in euros, billed monthly with tax included, and Pro has a 14-day trial with no card. The figures are from [Decap Turbo's page](https://decapcms.org/turbo/); check it before you decide.

Without Turbo, a Decap site costs what its hosting and sign-in cost.

Galley is free and Apache-2.0, with one edition and no paid tier. The assistant runs on Anthropic's Claude with your own key, and each request is billed to whoever owns that key. You arrange the hosting. Everything except chat and image generation works without a key. On price, the two are even.

## What does a developer have to set up?

This is where they differ most.

Decap's install is two files in an `admin` folder: an `index.html` that loads the app, and a `config.yml` the docs call "the heart of your Decap CMS installation". In it a developer lists every collection and each of its fields, with a widget for each: a string, an image, a date, a list, a relation. It's explicit, and the developer decides exactly what editors see. It's also a second description of the content, to keep in step with the site.

Sign-in takes the most thought. Decap ships backends for GitHub, GitLab, Gitea, Forgejo, Bitbucket and Azure, plus Git Gateway and the hosted Turbo, each with its own way in. "Because GitHub requires a server for authentication", GitHub needs an OAuth service: Netlify's, or your own, and the docs list 21 community projects for it. GitLab can use PKCE, which needs none. For repositories on GitHub or GitLab, Turbo replaces all of it with accounts of its own.

Git Gateway needs a note. Decap's tutorial uses it: "We're using Netlify for our hosting and authentication in this tutorial." Netlify, which makes Git Gateway, says on its own documentation page (last updated 17 September 2026) that "Git Gateway is deprecated". It still works where it is enabled, but "new Git Gateway configurations are not recommended". Decap's Git Gateway page doesn't mention this. Netlify Identity, which Git Gateway needs, "will continue as a supported authentication option on Netlify", according to Netlify's update of 19 February 2026. Choose a backend with both in mind.

To make Decap's preview look like your site, you write preview templates. Its features page says "You can write them in React and CSS."

Galley starts by reading the site. It works out the framework, the content collections and every field's type from the site's own schemas and files, without running any of its code. Astro fits deepest. Docusaurus, Nuxt, Next.js, SvelteKit, Eleventy, Hugo and Jekyll are recognised by their conventions, and any folder of Markdown with front matter works. `galley.config.json` exists only to correct what Galley found. On your own computer there's no Galley account to set up, and the preview is the site itself, run by its own dev server.

Our caveat: detection is only as good as the site is tidy. Words hard-coded in components get a thinner form until someone moves them out. Decap's config says exactly what it says.

## How does each one use AI?

Today, Decap doesn't. We found no AI feature in the CMS or in Turbo, on its home page, features page, Turbo page or full documentation (November 2026). It does offer documentation for AI tools: an `llms.txt` index, the whole of the docs in one `llms-full.txt` file, and a page that begins, "AI assistants and coding agents can add Decap CMS to a site and write its config.yml." And since the content is plain files, any coding agent can edit it in the repository.

The plan is on Decap's features page, marked "On the roadmap" for Turbo: a command-line tool "for everything you do in the Turbo dashboard, such as creating sites and inviting members, with a built-in MCP server so AI agents like Claude, Cursor or Codex can do the same", and agents that "will also be able to fill in fields in the entry you have open in the CMS", after which "you review the change and click Save." It is "Not built yet, and not available on any plan, including Enterprise."

Galley puts the assistant in the editor, beside the page. You [ask in plain words](/how-to/ask-the-assistant/); it reads the site before it edits, asks one short question when a request is ambiguous, and quotes the new words back. In content mode it can touch only content and media, and it has no shell or network tool. It never publishes: every change waits in the proof until a person presses Publish. Galley's [MCP server](/docs/integrations/mcp/) gives Claude Desktop, Claude Code, Cursor, VS Code or any MCP client the assistant's tools for reading and changing the site, and their changes wait in the same proof. Unlike the assistant, such a tool can also publish (its instructions say only when you ask) unless publishing over MCP is switched off.

We think Decap's roadmap points the right way: the agent fills in the fields, and a person checks and saves. That's close to how Galley works now. The difference, in November 2026, is that ours is built and theirs is a plan. We'd judge theirs when it ships.

## How do you check a change before it goes live?

In Decap, a live preview sits beside the form, and an option lets editors click on content in it to jump to the field that holds it. Without the editorial workflow, saving commits to the branch you configured. With it, "Save draft" commits to a new branch and opens a pull request, the entry shows a status of Draft, In review or Ready, and "Approve and publish" merges the pull request. If your host builds previews of pull requests, Decap's deploy preview links open the unpublished page.

In Galley, every change, from the form, the page or the assistant, lands in [Proof](/how-to/proof-and-publish/): the change in the site's own words, old text struck out and new text written in, beside the live site. Any single change can be put back. Publishing is a commit to your repository, or a branch and a pull request if the site is set up for review. Undo is a new commit.

The difference is what the reviewer reads. Decap shows the entry in its preview, and a pull request shows the lines that changed. Galley shows what changed on the page, in words.

## How does the site get its content, and who hosts it?

The same way for both: the site's build reads the files. Decap "doesn't deliver content", its docs say, and turning the files into pages is up to the developers and the site generator. Neither tool hosts the site.

Decap's tutorial uses Netlify, but its docs say it "has never been locked to the Netlify platform (despite the name)". Turbo sits between the editor and your Git host: it "mirrors the repo into its own database and serves collections from there", while every save is still "a real commit in your GitHub or GitLab repo". For sites on GitHub, Turbo also tells editors when a saved change is live. Media goes into the repository by default; Cloudinary and Uploadcare can be connected, and Turbo Pro adds a media library in your own S3-compatible bucket (in beta).

Galley publishes to your repository, and your host builds from there. It can also put a site online on Cloudflare, verified on the real service; deploys to Vercel are built but still in progress. Forms and redirects are built in. Keeping media in a bucket is in progress.

## Which one suits a team?

For most teams today, Decap, and more so with Turbo.

In plain Decap, "Your Git host is the gatekeeper": with the Git-host backends, editors sign in with their Git host account, and the CMS can do only what that account may. With the GitHub backend, every editor needs push access to the repository. The editorial workflow and its three statuses work on most of its backends. Notes let editors comment on an entry, stored as comments on an issue on GitHub or GitLab (with the editorial workflow, and off until you turn them on). Several languages can be edited side by side, with three ways to lay out the files. And Open Authoring lets people without access to the repository propose changes through a fork, on GitHub or Forgejo.

Turbo invites editors by email to a Turbo account. Owner and member roles are free on every plan, roles per collection are a Pro add-on enforced on the server, and an activity log shows who saved which entry. Single sign-on, and seeing who else has an entry open, are both "Under consideration". We found no scheduled publishing in Decap's documentation, and Galley has none either.

Galley is behind here. On your own computer it has no accounts: anyone who can open the app can publish, so the gate is pull-request mode and your code host's branch protection. A [hosted editor](/docs/running/hosted/), one site per install on a server you run, adds accounts with three roles (owner, editor and contributor), and each publish carries its author's name. It is new and still in final checks. Everyone on it works on one shared copy of the site, and a second save of a page someone has just changed is refused rather than written over it. There are no comments on entries, no review statuses beyond pull requests, no presence, and no single sign-on yet.

## Where does Galley fall short?

Beyond teams, in a few places.

- **It's young.** Version {version}, first released in November 2026. In the year to September 2026 alone, Decap shipped 15 stable releases and merged 151 pull requests, from 43 people and automated dependency updates.
- **One language at a time.** Galley has no multi-locale workflow.
- **Editors need the app, or a server.** Each person runs Galley on their own computer, or you run a hosted editor, which is new. Decap's editors open a page on the site.
- **The desktop app is verified on macOS only.** The Windows and Linux builds haven't yet been tried in a person's hands.
- **Page building is in preview.**
- **The assistant needs a key, and it's billed to you.**

## When is Decap CMS the better choice?

When you want a free CMS that ships as part of the site, with "No server or database of its own", which editors open from any browser, on GitHub, GitLab, Bitbucket, Gitea, Forgejo or Azure. When your team needs review statuses, Notes or several languages, without paying for them. When outside contributors should propose changes without access to the repository. When you'd pay a monthly fee for hosted sign-in and roles per collection. And when a long record matters: Decap has been in use since 2016, has about 19,500 stars on GitHub, and has a company behind it.

Galley fits when the people who change the site aren't developers, and you want them to ask for a change in words, see exactly what changed beside the live page and publish it, on a site that needs no CMS configuration to start. And when you want the assistant in the editor today, not on a roadmap. See [what Galley does today](/tour/).

## Can you move from Decap CMS to Galley?

Yes, and there's little to move. The content is already files in your repository, so Galley needs no importer for it, and it has none. (Its only guided move is from [WordPress](/wordpress/), and that one is new, in final checks.) To try Galley, run `npx galley-cms` in the site's folder, or open the repository in the desktop app. Galley doesn't use Decap's `config.yml`; it reads the collections from the site's own files and schemas. Galley doesn't read the `admin` folder, so we expect it can stay while you try.

To leave Decap, take out the `admin` folder and whatever sign-in it used, such as an OAuth handler or Git Gateway. Notes stay where Decap kept them, in an issue on your repository host.

For Decap's model with a different editor, Decap's own comparison page calls Sveltia CMS "the closest alternative to Decap", a rewrite that "reads the same config.yml". Sveltia calls itself "The successor to Netlify CMS and Decap CMS". That's its claim, not ours.

## Three questions to ask before you choose

**Who writes the description of your content, and who keeps it in step with the site?** With Decap it's a `config.yml` a developer looks after. Ask how many lines a new collection takes.

**How will editors sign in, and what does that depend on?** Name the backend, ask whether it needs an OAuth service, and check that the company running that service still recommends it for new sites.

**When an AI makes a change, who sees it before it's live, and in what form?** A pull request reads well to a developer. Ask what the person who knows the page will see.
