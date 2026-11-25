---
title: "Galley vs Contentful: a free Contentful alternative"
description: Contentful alternatives for a static site. How Galley and Contentful differ on where content lives, setup, AI, teams and price, and when Contentful wins.
kind: versus
product: Contentful
heading: Contentful keeps your content in its cloud. Galley keeps it in your repository.
name: Galley and Contentful
lead: Contentful is a hosted, API-first platform that serves one body of content to websites, apps and other channels, with years of team features behind it. Galley is a free, open-source Contentful alternative for static sites. It edits the files in your own Git repository, with an assistant and a check built in, and it is new.
published: "2026-11-25"
checked: November 2026
order: 3
draft: true
short:
  - Contentful is a hosted, API-first headless CMS. Your content lives in its cloud, on Amazon Web Services, and sites fetch it through its APIs. Asked whether you can host it yourself, its help centre answers "No." Galley's content is files in your own Git repository, and every publish is a commit.
  - As of November 2026, Contentful's Free plan costs nothing but may not be used for commercial work, Lite is $300 a month, and Enterprise is priced on request. Studio, AI Actions and Personalization are added to Enterprise. Galley is free and Apache-2.0. You pay for your own AI key and your own hosting.
  - With Contentful, a developer designs the content model first, then writes the code that fetches it, with a webhook to rebuild a static site and an SDK for live updates in the preview. Galley reads the site's collections and fields as they already are.
  - Contentful has AI Actions on Enterprise, a new Content Operations Agent that asks before it publishes, and an official MCP server free to all customers. Galley builds an assistant into the editor that never publishes, holds every change in a proof beside the live site, and lets other AI tools in over MCP.
  - Choose Contentful if the same content must reach apps and other channels, or your team needs custom roles, workflows, many locales, releases, support and an uptime agreement, most of them on Enterprise. Galley was first released in November 2026 and has little of that yet.
table:
  heading: Galley and Contentful, side by side.
  text: Where Contentful does more, the table says so.
  caption: Galley compared with Contentful
  columns: [What differs, Galley, Contentful]
  rows:
    - label: Your content
      ours: Files in your Git repository
      theirs: Entries in Contentful's cloud, on AWS
      better: even
    - label: Price
      ours: Free. Your AI key and hosting are yours
      theirs: Lite, $300 a month (Nov 2026)
      better: ours
    - label: Setup
      ours: Reads the site as it is
      theirs: A content model, and code to fetch it
      better: ours
    - label: Content for apps
      ours: No content API; it edits the site's files
      theirs: Delivery and GraphQL APIs on every plan
      better: theirs
    - label: Editing
      ours: A form, the page itself, or the assistant
      theirs: Entry forms beside a live preview
      better: even
    - label: Page building
      ours: The site's own sections (preview)
      theirs: Studio, for React sites (Enterprise)
      better: theirs
    - label: AI in the editor
      ours: An assistant that never publishes
      theirs: AI Actions (Enterprise); an agent that asks first
      better: even
    - label: Checking a change
      ours: Each change in the site's words, beside the live site
      theirs: Live preview, and tasks to finish first
      better: ours
    - label: Teams
      ours: Three roles on a hosted editor (new)
      theirs: Custom roles, Teams and SCIM on Enterprise
      better: theirs
    - label: Languages and scheduling
      ours: No multi-locale workflows or scheduling
      theirs: Locales; dated releases with Launch, from Lite
      better: theirs
    - label: Leaving
      ours: No content to export
      theirs: A JSON export to convert
      better: ours
    - label: Maturity
      ours: First released November 2026
      theirs: SOC 2 Type 2, ISO 27001; SLA on Enterprise
      better: theirs
faq:
  - q: Is Galley an alternative to Contentful?
    a: For a static website, yes. Galley edits the content files in your Git repository, needs no content model or API code for common setups, is free and open-source, and has an assistant built in. It is not an alternative when the same content must reach apps or other channels through an API, or when you need Contentful's roles, workflows, locales and support today.
  - q: Can you self-host Contentful?
    a: "No. Contentful's help centre answers the question directly: \"No. Contentful is a cloud-based web service that we manage. Downloading Contentful and hosting it yourself is not in our plans.\" It runs on Amazon Web Services, in the US by default, with EU data residency on Enterprise. Galley is open source and runs on your own computer, or on your own server with the hosted editor, which is new."
  - q: How much does Contentful cost?
    a: As of November 2026, the Free plan is $0, with 10 users and 100,000 API calls a month, and may be used only to test and learn, not for commercial use. Lite is $300 a month, with 20 users and a million API calls. Enterprise, and the Studio, AI Actions and Personalization added to it, are priced on request. Galley is free; the assistant uses your own Anthropic key.
  - q: Does Contentful have AI features and an MCP server?
    a: Yes. AI Actions, on any Enterprise plan, run set prompts such as translation, alt text and SEO metadata on entries, with a model you choose or bring. The Content Operations Agent, generally available since 9 November 2026, takes requests in plain language and asks before it publishes. An official hosted MCP server is available to all customers without charge.
  - q: What is the difference between Contentful and Sanity?
    a: Both are headless CMSs that keep your content in their own hosted cloud and serve it through APIs. The difference we'd point to first is the editor. Contentful's is its hosted web app, and the content model is built there or with scripted migrations. Sanity Studio is open-source React code you configure in TypeScript, with the schema in your repository, while the content stays in Sanity's Content Lake.
  - q: Can Galley edit content that is stored in Contentful?
    a: "No. Galley edits files in a Git repository: Markdown, JSON, YAML and TOML. A site whose words come from Contentful's API has nothing there for Galley to edit until those words are moved into files and the templates read them from there. Galley has no importer for Contentful. Its only guided move is from WordPress, and that is new and in final checks."
sources:
  - label: "Contentful, home page"
    href: https://www.contentful.com/
  - label: "Contentful, platform"
    href: https://www.contentful.com/products/platform/
  - label: "Contentful, pricing"
    href: https://www.contentful.com/pricing/
  - label: "Contentful Help Center, usage limits"
    href: https://www.contentful.com/help/admin/usage/usage-limit/
  - label: "Contentful Help Center, backup, security and hosting"
    href: https://www.contentful.com/help/faq/backup-security-and-hosting/
  - label: "Contentful blog, a new chapter for Contentful (1 June 2026)"
    href: https://www.contentful.com/blog/a-new-chapter-for-contentful/
  - label: "Contentful documentation, developer docs"
    href: https://www.contentful.com/developers/docs/
  - label: "Contentful documentation, domain model"
    href: https://www.contentful.com/developers/docs/concepts/domain-model/
  - label: "Contentful documentation, data model"
    href: https://www.contentful.com/developers/docs/concepts/data-model/
  - label: "Contentful documentation, technical limits"
    href: https://www.contentful.com/developers/docs/platform/technical-limits/
  - label: "Contentful documentation, scripting migrations with the CLI"
    href: https://www.contentful.com/developers/docs/tutorials/cli/scripting-migrations/
  - label: "Contentful documentation, automate site builds with webhooks"
    href: https://www.contentful.com/developers/docs/tutorials/general/automate-site-builds-with-webhooks/
  - label: "Contentful, Astro starter"
    href: https://www.contentful.com/astro-starter/
  - label: "Contentful, getting started with your framework"
    href: https://www.contentful.com/technologies-getting-started/
  - label: "Contentful Help Center, live preview"
    href: https://www.contentful.com/help/preview/live-preview/
  - label: "Contentful documentation, live preview"
    href: https://www.contentful.com/developers/docs/tutorials/general/live-preview/
  - label: "Contentful documentation, Experiences (Studio)"
    href: https://www.contentful.com/developers/docs/experiences/
  - label: "Contentful documentation, installing the Experiences SDK"
    href: https://www.contentful.com/developers/docs/experiences/installation/
  - label: "Contentful Help Center, Studio experiences"
    href: https://www.contentful.com/help/studio/experiences/
  - label: "Contentful Help Center, AI Actions"
    href: https://www.contentful.com/help/ai-automations/ai-actions/
  - label: "Contentful Help Center, bring your own model"
    href: https://www.contentful.com/help/ai-automations/ai-actions/bring-your-own-model/
  - label: "Contentful Help Center, Content Operations Agent"
    href: https://www.contentful.com/help/ai-automations/content-operations-agent/
  - label: "Contentful changelog, Content Operations Agent is now generally available"
    href: https://www.contentful.com/developers/changelog/content-operations-agent-is-now-generally-available/
  - label: "Contentful documentation, MCP server"
    href: https://www.contentful.com/developers/docs/tools/mcp-server/
  - label: "Contentful changelog, remote MCP server in GA"
    href: https://www.contentful.com/developers/changelog/remote-mcp-server-in-ga/
  - label: "Contentful Help Center, entry editor"
    href: https://www.contentful.com/help/content-and-entries/entry-editor/
  - label: "Contentful Help Center, tasks"
    href: https://www.contentful.com/help/content-and-entries/tasks/
  - label: "Contentful Help Center, workflows"
    href: https://www.contentful.com/help/ai-automations/workflows/
  - label: "Contentful Help Center, versions"
    href: https://www.contentful.com/help/content-and-entries/versions/
  - label: "Contentful Help Center, Timeline"
    href: https://www.contentful.com/help/timeline/
  - label: "Contentful Help Center, Launch"
    href: https://www.contentful.com/help/launch/
  - label: "Contentful Help Center, scheduled publishing"
    href: https://www.contentful.com/help/scheduled-publishing/
  - label: "Contentful documentation, near real-time audit logs"
    href: https://www.contentful.com/developers/docs/concepts/near-real-time-audit-logs/
  - label: "Contentful, marketplace"
    href: https://www.contentful.com/marketplace/
  - label: "Contentful Help Center, data export"
    href: https://www.contentful.com/help/admin/data-export/
  - label: "Contentful documentation, importing and exporting content with the CLI"
    href: https://www.contentful.com/developers/docs/tutorials/cli/import-and-export/
  - label: "Sanity documentation, deploying Sanity Studio"
    href: https://www.sanity.io/docs/studio/deployment
  - label: "Sanity, Sanity Studio"
    href: https://www.sanity.io/studio
  - label: "Galley, the FAQ for developers"
    href: /docs/project/faq/
  - label: "Galley, the tour: what is built and what isn't yet"
    href: /tour/
  - label: "Galley, over MCP"
    href: /docs/integrations/mcp/
  - label: "Galley, run a hosted install"
    href: /docs/running/hosted/
related: [types-of-cms, sanity, cloudcannon]
---

## How do Galley and Contentful differ at the root?

In where your content lives. Most of what follows comes from that.

Contentful's platform page calls it "A headless CMS at the core of Contentful's digital experience platform", and says "Contentful is API-first and cloud-native." Your content sits in a space, hosted on Amazon Web Services, and a website, an app or anything else asks for it through Contentful's APIs: the Content Delivery API for what is published, the Preview API for drafts, a GraphQL API and a Sync API, all on every plan. It runs only in Contentful's cloud. Its help centre asks "Can I self host/download Contentful?" and answers "No. Contentful is a cloud-based web service that we manage."

Galley keeps the content where a static site already keeps it: Markdown, JSON, YAML or TOML files in the site's own Git repository. There is no database. An unpublished change is a changed file, and publishing is a commit.

Two things follow. Contentful is built for one body of content that feeds many places; Galley edits the one website in the repository, with no API for anything else. And with Contentful your content lives in a vendor's system, on its plans, while with Galley it never leaves your repository.

One more fact from Contentful's own pages. On 1 June 2026 its blog said Contentful "has signed a definitive agreement to be acquired by Salesforce", and the footer of its site now reads "© Copyright 2026 Salesforce, Inc."

## How much does each cost?

As of November 2026, Contentful's pricing page lists three platform plans:

| Plan | Price | Users | Locales | API calls a month |
| --- | --- | --- | --- | --- |
| Free | $0, not for commercial use | 10 | 2 | 100,000, no overages |
| Lite | $300 a month | 20 | 3 | 1 million, then $5 per million |
| Enterprise | Priced on request | Custom | Custom | Unlimited |

Contentful's usage terms say the Free plan "may not be used to support commercial use cases." On Lite, a larger Lite Space, with 50 content types, 50,000 records and up to five workflows, costs $850 a month on top. Studio, AI Actions and Personalization are added to an Enterprise plan, through sales. Those figures are from [Contentful's pricing page](https://www.contentful.com/pricing/); check it before you decide, because plans change.

Galley costs nothing. It is open-source under Apache-2.0, with one edition and no paid tier today. Two things do cost money. The assistant runs on Anthropic's Claude with your own key, and each request is billed to whoever owns that key. And the site needs hosting, which for static files is often free or cheap, but is yours to arrange.

That holds for Contentful too. Its price covers the content and its delivery through a CDN, and the website is built and hosted elsewhere: its webhook tutorial covers Netlify and Heroku, and its Astro starter deploys to Netlify.

## What does a developer have to set up?

For Contentful, a content model, before anyone writes a word. "Each content type consists of a set of up to 50 fields that you define", from text and rich text to dates, media and references. A developer builds the model in the web app's visual modeler, or scripts it with Contentful's command-line tool. Then the site needs code to fetch the content, with keys for Contentful's APIs, and, for a static site, a webhook so that publishing starts a rebuild.

Preview takes a little more. Side-by-side preview needs only a preview platform set up in Contentful, but live updates and inspector mode need its live preview SDK, and the site has to let `app.contentful.com` show it in a frame. Studio, Contentful's visual page editor, takes the most: the Experiences SDK, React 18 or later, and your components and design tokens registered in code.

In return, developers get structured content, TypeScript definitions generated from the model, and guides for twenty technologies, from Astro and Next.js to Android, Swift and .NET.

Galley starts by reading the site. It works out the framework, the content collections and every field's type from the site's own schemas and files, without running any of its code. Astro fits deepest: Galley reads the content config and its schemas. Docusaurus, Nuxt, Next.js, SvelteKit, Eleventy, Hugo and Jekyll are recognised by their conventions. A `galley.config.json` file exists only to correct what it found, and editing on the page needs no markup.

The honest caveat on our side: detection is only as good as the site is tidy. A site that keeps its words in content files, with schemas, gets a good form with no work. A site whose copy is hard-coded in components gets less, until someone moves the words out.

## How does each one use AI?

Contentful's headline is "Built for humans. Ready for agents." It has built a good deal to back that up.

- **AI Actions** run set prompts on an entry or a single field, such as translation, image alt text or SEO metadata, with a model you pick or one you bring (OpenAI, AWS Bedrock, Google Gemini, Azure or any OpenAI-compatible endpoint). The pricing page says "AI Actions is available on any Enterprise plan", with credits included and pay-as-you-go beyond them.
- **The Content Operations Agent**, generally available since 9 November 2026, takes a request in plain language, and "the agent creates pages, audits content, applies metadata, and runs AI Actions across many entries at once." It asks first: "the agent never publishes, archives, or changes a content type without your explicit approval first." It is free to use through January 2027, within usage limits. From 9 January 2027 each operation uses 0.25 AI Consumption Units. Ask Contentful which plans include it.
- **An official MCP server**, hosted by Contentful: "The MCP server is available to all customers without charge." Cursor, VS Code, Claude Code, ChatGPT and Windsurf sign in to it with OAuth, and an admin installs its app in each space and environment and allows groups of tools, read-only or read/write. The tools include publishing entries. A local, open-source server exists too.

Galley puts one assistant inside the editor, beside the page. You ask in plain words. It reads the site before it edits, asks one short question when a request could mean two places, and says what it changed, quoting the new words. In content mode it can touch only content and media, and it has no shell or network tool. It never publishes: every change it makes waits in the proof, and a person presses Publish. Galley's [MCP server](/docs/integrations/mcp/) gives Claude Desktop, Claude Code, Cursor, VS Code or any MCP client the assistant's tools for reading and changing the site, and their changes wait in the same proof. Unlike the assistant, such a tool can also publish (its instructions say only when you ask) unless publishing over MCP is switched off. Publishing over MCP can be switched off, so that every publish happens in the app.

Both products keep a person in front of the button that makes a change live, and we think that is right. Where we think Galley does better is what that person sees: the change in the site's own words beside the live page, and a record that is a commit in your own repository. That's our view. A team running content across many markets may care more about bulk work and approval steps, and there Contentful is ahead.

## How do you check a change before it goes live?

In Contentful, live preview is on every plan, beside the entry editor: "As changes to the content are made, they are immediately reflected in the preview pane." A team can add tasks ("An entry can be published only after all tasks in it are completed"), and, with a Lite Space or on Enterprise, workflows of up to 20 steps. Each entry keeps versions, though only on the master environment. On Enterprise, Timeline lets you "create, schedule and preview multiple upcoming versions of the same digital experience".

In Galley every change, whether typed in the form, retyped on the page or made by the assistant, lands in [Proof](/how-to/proof-and-publish/): the change in the site's own words, old text struck out and new text written in, beside the live site. Any single change can be put back. Publishing is a commit to your repository, or a branch and a pull request if the site is set up for review. Undo is a new commit, and history is never rewritten.

The difference is in what the reviewer sees, and where the record lives. Contentful shows the new page and gives the team a process for approving it. Galley shows what changed, word by word, and the record is your Git log. Contentful's help centre adds: "If you accidentally deleted a specific content entry from a space, we do not offer the ability to restore it." In Galley, undoing the publish that deleted a page brings it back.

## How does the site get its content?

From Contentful's API, at build time or on each visit. A static site's build fetches entries through the Content Delivery API, and Contentful's tutorial sets up "webhooks that will be triggered when you publish or unpublish content in your space" to start the next build. The same API, through Contentful's global CDN, serves an app or anything else, and that is the point of it.

With Galley, the build reads files. Galley publishes to your repository, and your host builds from there, as it would after any commit. Galley hosts nothing. It can put a site online on Cloudflare, and that is verified on the real service; attaching a new domain of your own there has so far been tested only against stand-ins. Deploys to Vercel are built but still in progress.

## Which one suits a team?

For a large team today, Contentful. Free has two roles (Admin and Editor) and Lite adds Author. Enterprise adds custom roles, tag-based permissions, Teams, SCIM provisioning and near real-time audit logs. Comments and tasks are on every plan, and a presence indicator that shows "users who are actively working on an entry in real time" starts at Lite. Locales number two on Free, three on Lite and a custom number on Enterprise, up to 500 per environment, and what the pricing page calls "Localized workflows" are on Enterprise. Launch, from Lite, groups entries into releases and publishes them "either immediately or on a desired date in future", and single entries can be scheduled too. Contentful is "Certified to SOC 2 Type 2 and ISO 27001", and Enterprise adds 24/7 support and an uptime agreement of up to 99.99%.

Galley is behind here, and we'd rather say so than let you find out. Used on your own computer, it has no accounts: anyone who can open the app can publish, so the gate is pull-request mode and your code host's branch protection. A [hosted editor](/docs/running/hosted/), one site per install on a server you run, adds accounts with three roles (owner, editor and contributor), and each publish carries its author's name. The roles keep people out of each other's way; they aren't a security boundary. That hosted editor is new and still in final checks. Single sign-on is planned for later. Everyone on one hosted editor works on one shared copy of the site; a second save of a page someone has just changed is refused, not written over it. There is no live presence, no scheduled publishing, no editorial workflow across locales, and no approval chain beyond a pull request.

## Where does Galley fall short?

Beyond teams, in a few places.

- **It's young.** Version {version} of software first released in November 2026.
- **No content for apps.** Galley has no content API. If an app or a newsletter must read the same content as the website, Galley doesn't serve it.
- **Page building is in preview.** Galley builds pages from the site's own sections, and that part is still in preview. Contentful's Studio has a canvas where you "Drag and drop a component", for React sites on Enterprise.
- **No hosting, no support contract.** Galley is software you run. Help comes through the project's issues on GitHub, not a dedicated channel or an uptime agreement.
- **The assistant needs a key, and it's billed to you.** Everything except chat and image generation works without one.

## When is Contentful the better choice?

When one body of content has to reach a website, apps and other channels, which is the job Contentful was built for. When your team is large or regulated and needs custom roles, SCIM, near real-time audit logs, PCI DSS or EU data residency, all on Enterprise. When you publish in many languages, or plan campaigns as releases that go out on a date. When you want personalisation and A/B tests in the same system, through its Personalization add-on for Enterprise. When the CMS should plug into a marketplace of apps, among them Vercel, Slack, Microsoft Teams, Bynder and Cloudinary. And when you'd rather buy a service with a long record and someone to call than adopt a new open-source tool.

Galley fits a static website in a Git repository, kept by people who aren't developers: they ask for a change, see exactly what changed and publish it, and nobody designs a content model first. It also fits when you want no subscription.

## Can you move from one to the other?

Yes, but from Contentful it is a real migration, because the content has to come out of its database and become files.

Contentful's command-line tool exports a space with `contentful space export` (add `--download-assets` for the files) and writes the content types, entries, assets and locales as JSON. From there, someone has to turn each entry into a Markdown or JSON file, convert rich text, which Contentful stores as a JSON document, into Markdown, and change the site's templates to read files instead of calling the API. Comments, tasks, releases and workflows aren't in that export; Contentful lists them as available through its APIs. Galley has no importer for Contentful. Its only guided move is from WordPress, and that is new and in final checks. Once the content is files, run `npx galley-cms` in the site's folder.

The other way, from Galley to Contentful, means designing content types, writing the files into entries through Contentful's Management API, and rewriting the templates to fetch them.

## Three questions to ask before you choose a Contentful alternative

**Where does this content have to go?** If it is one website, files in the site's repository may be all it needs. If an app and a newsletter read it too, that is the job Contentful was built for.

**Who keeps the content model, and the code that fetches it, in step with the site?** Ask how much developer time a new field or a new kind of page takes, in either tool.

**What do you take with you if you leave?** With Contentful, a JSON export to turn into something your site can read. With Galley, the repository you already have. Know the answer for any tool before you need it.
