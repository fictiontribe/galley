---
title: Traditional vs headless vs Git-based CMS, explained
description: Traditional, headless and Git-based CMSs keep your content in different places. What each kind costs you, which sites each suits, and where AI fits in.
kind: guide
heading: There are three main kinds of CMS. The difference is where your words live.
name: Traditional, headless and Git-based CMSs
lead: A traditional CMS keeps them in its own database. A headless one serves them to your site through an API. A Git-based one keeps them as files beside the code. Most of what matters follows from that one choice.
published: "2026-11-25"
updated: "2026-11-28"
checked: November 2026
order: 1
draft: false
short:
  - "**Traditional** (WordPress, Drupal, Joomla): the content, the templates and the editor are one system, with a database and a server. The quickest start, and the most to keep patched."
  - "**Headless, or API-based** (Contentful, Sanity, Strapi, Storyblok): the content sits in a database and reaches any front end through an API. The right shape when one body of content feeds a website, an app and more."
  - "**Git-based** (CloudCannon, TinaCMS, Decap CMS, Galley): the content is files in the site's own repository, and the CMS is an editor for those files. Often nothing runs behind the live site but the built pages, and there is no content to export when you leave."
  - Every kind now sells AI. The difference is where an AI's change lands and who checks it before it goes live.
  - We think the Git-based kind handles that best, because every change is already a record in your own repository. We make one of them, Galley, so weigh the opinion accordingly.
faq:
  - q: What is the difference between a headless CMS and a traditional CMS?
    a: A traditional CMS stores the content and also builds the pages visitors see, in one system with its own database. A headless CMS stores and edits the content but leaves the pages to a separate front end, which fetches the content through an API. Headless suits content that feeds several channels; traditional suits one website that wants everything in one place.
  - q: Is a Git-based CMS a headless CMS?
    a: "Partly. Like a headless CMS, it keeps editing separate from how the pages are built. Most Git-based tools have no content database or delivery API, because the content is files that the site's build reads. Some sit in between: TinaCMS, which calls itself \"Git-backed headless\", adds a GraphQL API over the files."
  - q: Can WordPress be used as a headless CMS?
    a: Yes. WordPress has a REST API that, in its own documentation's words, lets applications "interact with your WordPress site by sending and receiving data as JSON", so a separate front end can read its content. You still run WordPress, its database and its updates behind that front end.
  - q: What is an AI CMS?
    a: "A CMS that lets you change content by asking in plain words, not only by filling in fields. Most CMSs now add some AI, from writing helpers to connections for outside AI tools. The question to ask is what happens to an AI's change: whether it waits for a person to check it, and whether you can see and undo exactly what it did."
  - q: Do editors need to know Git to use a Git-based CMS?
    a: No. A Git-based CMS exists so they don't have to. Editors see pages, fields, a preview and a publish button; the commits happen underneath. In Galley, editors see Changes, Proof, Publish and Undo, and never type a Git command.
  - q: Which kind of CMS is best for a static site?
    a: We think usually a Git-based one, because a static site already keeps its content as files in a repository and a Git-based CMS edits those files where they are. We make one, so weigh that. A headless CMS also works with a static site, at build time, and is the better choice when the same content must reach apps or other channels too.
sources:
  - label: "W3Techs, usage statistics of content management systems (25 November 2026)"
    href: https://w3techs.com/technologies/overview/content_management
  - label: "WordPress.org, about WordPress"
    href: https://wordpress.org/about/
  - label: "WordPress.org, history"
    href: https://wordpress.org/about/history/
  - label: "WordPress documentation, roles and capabilities"
    href: https://wordpress.org/documentation/article/roles-and-capabilities/
  - label: "WordPress documentation, post status"
    href: https://wordpress.org/documentation/article/post-status/
  - label: "Drupal documentation, content moderation"
    href: https://www.drupal.org/docs/8/core/modules/content-moderation
  - label: "WordPress 7.0 release post"
    href: https://wordpress.org/news/2026/05/armstrong/
  - label: "WordPress REST API handbook"
    href: https://developer.wordpress.org/rest-api/
  - label: "Contentful, Content Delivery API reference"
    href: https://www.contentful.com/developers/docs/references/content-delivery-api/
  - label: "Sanity, Content Lake"
    href: https://www.sanity.io/content-lake
  - label: "Strapi, home page"
    href: https://strapi.io/
  - label: "Strapi documentation, database configuration"
    href: https://docs.strapi.io/cms/configurations/database
  - label: "Payload documentation, database overview"
    href: https://payloadcms.com/docs/database/overview
  - label: "CloudCannon, official AI information"
    href: https://cloudcannon.com/ai-info/
  - label: "TinaCMS documentation"
    href: https://tina.io/docs
  - label: "TinaCMS documentation, self-hosted backend"
    href: https://tina.io/docs/self-hosted/overview
  - label: "Keystatic, installing with Astro"
    href: https://keystatic.com/docs/installation-astro
  - label: "CloudCannon documentation, creating the configuration file"
    href: https://cloudcannon.com/documentation/developer-articles/create-your-cloudcannon-configuration-file/
  - label: "Decap CMS, introduction"
    href: https://decapcms.org/docs/intro/
  - label: "Decap CMS, installing"
    href: https://decapcms.org/docs/install-decap-cms/
  - label: "Decap CMS, configuration options"
    href: https://decapcms.org/docs/configuration-options/
  - label: "Keystatic, configuration"
    href: https://keystatic.com/docs/configuration
  - label: "Pages CMS, configuration"
    href: https://pagescms.org/docs/configuration/
  - label: "Prismic, MCP"
    href: https://prismic.io/features/mcp
  - label: "Galley, the FAQ for developers"
    href: /docs/project/faq/
  - label: "Galley Cloud"
    href: /cloud/
  - label: "Galley for enterprise and security teams"
    href: /enterprise/
related: [cloudcannon, /wordpress/, /ai-first/]
---

## What is a traditional CMS?

A traditional CMS, sometimes called monolithic or coupled, is one application that stores the content, builds the pages and hosts the editor. Editors log in to the same system that serves the site to visitors.

WordPress is the one most people know. WordPress.org describes it as "built on PHP and MariaDB, and licensed under the GPLv2", and W3Techs counted it on 38.4% of all websites in November 2026, a 57.3% share of sites that use a CMS it can identify. Drupal and Joomla work the same way.

Hosted site builders such as Shopify, Wix and Squarespace, which W3Techs ranks next after WordPress, are something else again: the CMS, the design tool and the hosting are one product. This page leaves them aside.

**What it's good at.** One install does everything: pages, editor, users and roles, comments, a shop if you add one. WordPress has roles, posts waiting for review and scheduled posts built in, and Drupal's core includes moderation workflows and translation. More than twenty years of themes and plugins mean that whatever you need, someone has probably built it. And a great many editors have used WordPress before.

**What it costs you.** A server and a database to run, back up and keep patched, along with core, theme and plugin updates. There's a login page on the live site that anyone can find. And the content sits in database rows shaped by the CMS, so leaving means an export and a migration. (We wrote a whole page on [leaving WordPress](/wordpress/), including the rows where WordPress is stronger.)

## What is a headless, or API-based, CMS?

A headless CMS keeps the content and the editing app and drops the "head", the part that builds pages. You model the content as types and fields, it's stored in a database, and any front end can ask for it through an API: a website, a mobile app, a screen in a shop.

Contentful describes its Content Delivery API as "a read-only API for delivering content from Contentful to apps, websites and other media." Sanity keeps content in what it calls the Content Lake, "the database optimized for content operations", which it hosts. Strapi is open source and runs on your own servers or on Strapi Cloud, with your content in SQLite, MySQL, MariaDB or PostgreSQL. Payload, also open source, runs on a database you choose; its docs say "it's up to you to decide which database to use." You'll also see these called API-first or decoupled.

**What it's good at.** One source of content for many channels, which is what it's for. Structured content that developers can query precisely. The front end is the developer's free choice. And the larger products have years of work in team features: roles, workflows, scheduled publishing and many languages, with the details varying by product and plan.

**What it costs you.** Someone has to design the content model before anyone writes a word, and keep it in step with the site. The website has to fetch its content from the API, at build time or on each visit, and previews need wiring. Where the vendor hosts the database, your content lives in their system, on their plans, and leaving means exporting through the API and rebuilding the model somewhere else. With a self-hosted one such as Strapi or Payload, the database is yours.

## What is a Git-based CMS?

A Git-based CMS edits the files a site is already made of: Markdown pages, data files in JSON or YAML, images. Those files live in the site's own Git repository, beside its code. Saving a change is a commit (in Galley, publishing one is), and the site rebuilds from the repository the same way it would after a developer's commit. Most Git-based CMSs are used with static sites, which are built ahead of time and served as files.

The kind has a long list of members. CloudCannon, a commercial hosted service, says it "stores content as files in your Git repo — Markdown, JSON, YAML, or TOML — and builds your static site directly from them." TinaCMS says that "when users make a change in the CMS, a commit is made back to your Git repository." Decap CMS, which was Netlify CMS until February 2023, is open source and runs as an admin page on the site itself. Keystatic, Pages CMS and Sveltia CMS are open-source options too. And there's Galley, which is ours.

**What it's good at.** The content isn't in a database, and with many of these tools nothing runs behind the live site but the built pages. Content and code are versioned together, so every change has an author, a date and an exact record of what moved, and can be undone with another commit. Leaving is easy, because the content never left your repository. And several good tools are free.

**What it costs you.** Most Git-based CMSs need a configuration file that lists the collections and their fields before an editor sees a form: `config.yml` for Decap, `tina/config` for TinaCMS, `keystatic.config` for Keystatic, `.pages.yml` for Pages CMS. CloudCannon starts from a small file its app can create, and infers the fields it isn't told about. Some tools also add an admin page or server code to the site: Decap and TinaCMS are reached at `/admin` on the site by default, and Keystatic needs server code. And the kind mostly serves the website it sits in, not apps that want an API, though TinaCMS adds a GraphQL API over the files. Each published change rebuilds the site, which takes longer on a big site. And team features vary widely: some tools offer roles and review workflows, others only what your code host's pull requests give you.

## How do the three kinds compare?

| | Traditional | Headless (API-based) | Git-based |
| --- | --- | --- | --- |
| Where the words live | The CMS's own database | A database, often the vendor's cloud | Files in your Git repository |
| What runs behind the live site | The CMS, its database and a login page | The content API, if pages fetch it on each visit | Often only the built pages; some tools add an admin page |
| How pages get the words | The CMS builds them | Your front end asks the API | The build reads the files |
| Before anyone can edit | An install, usually a theme and plugins | A content model, and a front end that reads it | Usually a config file listing collections and fields |
| The record of a change | Inside the CMS | Inside the CMS | A commit in your repository |
| Content for apps and other channels | Possible, through its API | What it's built for | Mostly not its job |
| Large editorial teams | Roles, review and scheduling built in; more in Drupal and plugins | Strong in the larger products | Varies; often pull requests |
| Leaving | Export, then migrate | Export (through the API, if they host it), rebuild the model | No content to export |
| Examples | WordPress, Drupal, Joomla | Contentful, Sanity, Strapi, Storyblok, Payload | CloudCannon, TinaCMS, Decap CMS, Keystatic, Galley |

## Which kind fits which site?

**If the same content feeds a website, an app and a newsletter,** choose headless. That's the problem it was designed for. The other two kinds can do it, but aren't designed around it.

**If you need a plugin for everything and your team knows WordPress,** a traditional CMS may still be the practical choice, at least until the plugins you depend on have somewhere else to go.

**If developers build the site and the content is mostly the website itself,** choose Git-based. You get a fast static site with nothing behind it to patch, and the editors get a way in without learning Git.

**If you have a large editorial team that needs scheduled publishing, multi-stage approval chains and granular field-level permissions today,** choose one of the larger headless products, or a traditional CMS built for it such as Drupal, whatever we'd like to tell you. Some Git-based tools are catching up, but that is where the other two kinds have the most years of work.

## Every kind sells AI now. What actually differs?

Read the home pages in November 2026 and you'd think the categories had merged into one. Contentful's headline is "Built for humans. Ready for agents." Sanity's is "One content platform for every agent, site, and workflow." Payload calls itself "The Agentic Content Framework". CloudCannon offers "Visual editing for your team on the stack AI already knows." WordPress 7.0 added "a new AI Client in Core". Most of the headless products, and WordPress through a plugin, now offer an MCP server. MCP is an open standard that many AI tools use to connect to other software.

So the useful question is no longer whether a CMS has AI. It's what happens to a change an AI makes. Does it go live by itself, or wait for a person? Can a non-developer see exactly what it changed, beside the page? And is the record of it yours?

Products in every kind are answering those questions in their own way. Prismic, for example, says its MCP server "stages every change in a release for your review." Our answer is below.

## Why we think the Git-based kind is the modern one

This is our opinion, and we have an interest: Galley is a Git-based CMS and we make it. Here are the reasons, so you can argue with them.

**The repository is already the record.** In a Git-based site every change is a commit: who made it, when, and exactly which lines moved. Undo is another commit. None of that is new. Developers have worked this way for about twenty years, and it turns out to be what you want once an AI writes some of the changes. An assistant's edit can be read, approved and reversed the same way a developer's is, and the record stays in your repository, not in a vendor's database.

**AI tools already work on files.** Coding agents and MCP clients read and write the files in a repository today. A CMS whose content is those files gives them nothing new to learn. A CMS whose content sits behind an API has to build its own door for them, and many now have.

**Nothing needs to run behind the live site.** With the tools that keep the editor off the site, Galley among them, visitors get only files that were built ahead of time. There's no database online and no login page to find on the live site, so there's no CMS on the live site to patch at two in the morning.

**You can leave.** The content is Markdown and data files in your own repository, readable by any editor, script or person. There's no content to export, because none was ever taken in.

None of that makes the Git-based kind right for every site. The next section is where it isn't.

## Where does the Git-based kind fall short?

In four places, and they are real.

**Content for many channels.** If an app, a kiosk and a newsletter all read the same product descriptions, you want them behind an API, and that's what headless systems are built for. A Git-based CMS serves the website it sits in.

**Large editorial teams.** Scheduled publishing, approval chains with several steps, and dozens of people with granular field-level permissions: the bigger headless products, and Drupal, have years of work here. Most Git-based tools offer less.

**Setup.** Most Git-based CMSs ask a developer to describe the collections and their fields in a configuration file before an editor sees a form, and to keep that file in step with the site.

**Builds and media.** Each published change rebuilds the site, which takes seconds on a small site and longer on a big one. And large images and video are heavy to keep in Git, so many teams move them to a storage bucket (such as Cloudflare R2 or Amazon S3).

## Where Galley fits

Galley is our open-source AI CMS for static sites, Apache-2.0 and free to run locally (`npx galley-cms` or the Apple-signed and notarized macOS desktop app) or self-host with Docker (`ghcr.io/fictiontribe/galley`, including OpenID Connect SSO, new in final checks; [`/enterprise/`](/enterprise/)) — with optional managed hosting on [Galley Cloud](/cloud/) (opening by invitation: dedicated editor machine per site, Cloudflare edge delivery, preview links, instant version rollback without rebuilding, 30–90 day nightly backups, real-time collaboration and live presence, monthly AI credits, and **no per-seat fees** from $35 a month per site). First released in November 2026, it's built around the shift above: the assistant can write a change, and a person checks it and presses Publish.

- **No configuration file to write first.** Galley reads the site's framework, content collections and fields from its schemas and files, without running its code. Astro fits deepest; Docusaurus, Nuxt, Next.js, SvelteKit, Eleventy, Hugo and Jekyll are recognised by their conventions.
- **Four ways to change a page.** In a form made from the site's own content model, by retyping the words on the page, by building and arranging sections visually in the built-in [Arrange page builder](/docs/editing/page-builder/) (drag, reorder, duplicate and drop sections from a visual thumbnail palette with live layout options and zero SSR), or by asking the assistant. All four end in the same [proof](/how-to/proof-and-publish/), beside the live site.
- **Publishing is a commit, with scheduled publishing built in.** Publish straight to your own repository, or to a branch and a pull request; undo is a new commit. Schedule releases ahead of time on both open source (via the server scheduler or `galley schedule` while keeping other edits moving, plus `publishAt` date/time matching and a 1-click GitHub Actions workflow) and [Galley Cloud](/cloud/) (pre-built zero-latency Cloudflare edge deploys verified with a shareable preview link and promoted at the exact scheduled minute, included on every plan).
- **Built-in AI, translations and search intelligence.** The assistant never publishes (using your own Anthropic key self-hosted, or monthly AI credits on Galley Cloud); image and short video generation run across OpenAI, Google Gemini and OpenRouter; built-in multilingual (`i18n`) translation includes a Git-tracked Translation Memory and brand/product Glossary; published output is AI-first (`llms.txt`, `llms-full.txt`, `agent.md`, Markdown twins and per-AI-crawler `robots.txt`); and Search and AI intelligence tracks live Google rankings, keyword gaps and 404 backlink recovery. Outside AI tools can also connect over [MCP](/docs/integrations/mcp/) (publishing over MCP can be switched off).

It's young, and some parts are still growing: self-hosted accounts and OIDC SSO are new in final checks (real-time co-editing and live presence live on Galley Cloud, while local and self-hosted installs use one shared copy with safe save checks), and there's no SOC 2 report or SLA yet. See [what it does today](/tour/), or set it beside [CloudCannon](/compare/cloudcannon/), the Git-based product closest to it.

## Three questions to ask any CMS

**Where do the words live, and can you read them without the CMS?** If the answer is "in our cloud, through our API", ask what an export looks like and who has done one.

**What runs behind the live site, and who patches it?** Every database, server and login is a standing chore with somebody's name on it.

**When an AI makes a change, who sees it before it's live?** Before and after, in words, beside the page. We don't think a summary written by the same model that made the change is enough.

Pick the kind for where your content has to go. Then pick the product.
