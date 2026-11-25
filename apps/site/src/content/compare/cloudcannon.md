---
title: "Galley vs CloudCannon: two Git-based CMSs compared"
description: Galley and CloudCannon both keep your content in Git. How they differ on setup, AI, hosting, teams and price, and when CloudCannon is the better choice.
kind: versus
product: CloudCannon
heading: CloudCannon and Galley agree about Git. They part ways on where the AI sits.
name: Galley and CloudCannon
lead: Both edit the plain files in your repository and record changes as commits. CloudCannon is a hosted service, founded in 2013, that leaves AI to the agents you bring. Galley is free, open-source and new, with the assistant and the check built into the editor.
published: "2026-11-25"
checked: November 2026
order: 1
draft: false
short:
  - Both are Git-based. Your content stays as Markdown, JSON, YAML or TOML files in your own repository, and a change becomes a commit when you save in CloudCannon and when you publish in Galley. Leaving either one needs no content migration.
  - CloudCannon is a paid, hosted service that also builds and hosts the site. Its Standard plan is $55 a month for three users, or $49 a month paid yearly (as of November 2026). Galley is free and Apache-2.0. You pay for your own AI key and your own hosting.
  - CloudCannon asks a developer for a configuration file and, for visual editing, markup in the templates. Galley reads the site's framework, collections and fields as they already are.
  - CloudCannon's AI story is the agents you already use, such as Cursor, Claude Code or Copilot, working in the repository. Galley builds an assistant into the editor, holds every change in a proof beside the live site, and lets other AI tools in over MCP.
  - Choose CloudCannon if you need what thirteen years have built. That means custom permissions, single sign-on, SOC 2, scheduled content, hosting, support and an uptime agreement. Galley was first released in November 2026 and has little of that yet.
table:
  heading: Galley and CloudCannon, side by side.
  text: Where CloudCannon does more, the table says so.
  caption: Galley compared with CloudCannon
  columns: [What differs, Galley, CloudCannon]
  rows:
    - label: Your content
      ours: Files in your Git repository
      theirs: Files in your Git repository
      better: even
    - label: Price
      ours: Free. Your AI key and hosting are yours
      theirs: Standard, $55 a month for 3 users, hosting included (Nov 2026)
      better: even
    - label: Setup
      ours: Reads the site as it is
      theirs: A config file (its app or CLI can draft it); markup for editing on the page
      better: ours
    - label: Editing
      ours: A form, the page itself, or the assistant
      theirs: Visual, content, data and source editors
      better: even
    - label: Page building
      ours: The site's own sections (preview)
      theirs: Components in the visual editor
      better: theirs
    - label: AI in the editor
      ours: An assistant that never publishes
      theirs: None built in (Nov 2026); bring your own agents
      better: ours
    - label: Checking a change
      ours: Each change in the site's words, beside the live site
      theirs: Live preview and a list of changed files
      better: ours
    - label: Building and hosting
      ours: Deploys to Cloudflare; Vercel in progress
      theirs: Builds and hosts, with forms and redirects
      better: theirs
    - label: Teams
      ours: Three roles on a hosted editor (new)
      theirs: Five roles; custom groups; SSO on Enterprise
      better: theirs
    - label: Two people at once
      ours: One shared copy; a clashing save is refused
      theirs: One editor per file, others watch live
      better: theirs
    - label: Where it runs
      ours: Your computer, or your own server (new)
      theirs: CloudCannon's hosted app
      better: even
    - label: Maturity
      ours: First released November 2026
      theirs: Founded 2013; SOC 2 Type 2
      better: theirs
faq:
  - q: Is Galley an alternative to CloudCannon?
    a: For many static sites, yes. Both edit the files in your Git repository and record changes as commits (CloudCannon on each save, Galley when you publish). Galley is free and open-source, needs no configuration or template markup for common setups, and has an assistant built in. CloudCannon adds hosting, mature team permissions, single sign-on and support that Galley does not have yet.
  - q: Is CloudCannon open source?
    a: The CMS itself isn't described as open source on CloudCannon's pages, and they don't offer a self-hosted version for editors. Its command-line tool can run the app against local files, for developers building the setup. CloudCannon does publish open-source tools, among them Pagefind for search, Bookshop for components and Rosey for translations. Galley is open source under Apache-2.0. It runs on your own computer, or on your own server with the hosted editor, which is new and still in final checks.
  - q: Does CloudCannon have AI features?
    a: As of November 2026, its pages describe no AI assistant built into the CMS. CloudCannon calls itself "AI-ready". Because content is plain files in Git, outside agents such as Cursor, Claude Code or Copilot can work on it, and their changes go through pull requests. It also publishes agent skills that help coding agents set sites up on CloudCannon.
  - q: How much does CloudCannon cost?
    a: As of November 2026, Standard is $55 a month or $49 a month paid yearly, with three users. Team is $350 a month or $300 paid yearly, with fifteen. Enterprise is priced on request, and extra users are $10 a month each. There is a 21-day free trial and no free plan. Galley is free; the assistant uses your own Anthropic key.
  - q: Can two people edit the same page at once?
    a: Not in either, in the sense of typing together. In CloudCannon one person edits a file while others watch the changes live, with avatars showing who is where. In Galley everyone on one hosted editor works on one shared copy of the site, each publish carries the name of whoever pressed Publish, and a second save of a page someone has just changed is refused rather than written over it. Galley shows no presence.
  - q: Do I have to change my templates to use Galley?
    a: "No. Galley adds no dependency, integration or build plugin, and editing needs no markup. A site that keeps its words in content files gets a better form, and Astro sites with schemas get the most. Galley's forms and consent banner are the exception: they come from its site kit, which it adds as changes you check first."
sources:
  - label: "CloudCannon, home page"
    href: https://cloudcannon.com/
  - label: "CloudCannon, pricing"
    href: https://cloudcannon.com/pricing/
  - label: "CloudCannon, AI-ready CMS"
    href: https://cloudcannon.com/ai-llm-cms/
  - label: "CloudCannon, official AI information"
    href: https://cloudcannon.com/ai-info/
  - label: "CloudCannon, for developers"
    href: https://cloudcannon.com/for-developers/
  - label: "CloudCannon, open source"
    href: https://cloudcannon.com/open-source/
  - label: "CloudCannon agent skills, on GitHub"
    href: https://github.com/CloudCannon/agent-skills
  - label: "CloudCannon, company"
    href: https://cloudcannon.com/company/
  - label: "CloudCannon documentation, what is the configuration file"
    href: https://cloudcannon.com/documentation/developer-articles/what-is-the-cloudcannon-configuration-file/
  - label: "CloudCannon documentation, the command-line tool"
    href: https://cloudcannon.com/documentation/developer-reference/cli/
  - label: "CloudCannon documentation, the publishing page"
    href: https://cloudcannon.com/documentation/user-articles/what-is-the-publishing-page/
  - label: "CloudCannon documentation, an overview of Editable Regions"
    href: https://cloudcannon.com/documentation/developer-guides/set-up-visual-editing/an-overview-of-editable-regions/
  - label: "CloudCannon documentation, editing sessions and collaboration"
    href: https://cloudcannon.com/documentation/user-guides/editing-in-cloudcannon/editing-sessions-and-collaboration/
  - label: "CloudCannon documentation, default permission groups"
    href: https://cloudcannon.com/documentation/user-articles/what-are-default-permission-groups/
  - label: "CloudCannon documentation, publishing methods"
    href: https://cloudcannon.com/documentation/user-articles/what-are-publishing-methods/
  - label: "CloudCannon documentation, forms"
    href: https://cloudcannon.com/documentation/developer-articles/what-is-a-form/
  - label: "CloudCannon, security"
    href: https://cloudcannon.com/security/
  - label: "CloudCannon, changelog"
    href: https://cloudcannon.com/documentation/changelog/
  - label: "Galley, the FAQ for developers"
    href: /docs/project/faq/
  - label: "Galley, the tour: what is built and what isn't yet"
    href: /tour/
related: [types-of-cms, /wordpress/, /ai-first/]
---

## What do Galley and CloudCannon have in common?

More than either has in common with WordPress or a headless CMS. Both are Git-based: the words of the site are the files in its repository, and the CMS is a way to change those files without opening a code editor. CloudCannon puts it plainly: "CloudCannon stores content as files in your Git repo — Markdown, JSON, YAML, or TOML — and builds your static site directly from them." Galley edits Markdown, JSON and YAML the same way; it reads TOML but doesn't change it yet.

That shared starting point has two consequences worth knowing before anything else. There is no database behind the live site to run or patch. And neither tool holds your content hostage. CloudCannon's developer page says "If you ever leave CloudCannon, you leave with everything." We say the same about Galley, for the same reason.

So the choice between them isn't about where your content lives. It comes down to four other things: who sets the editor up, where the AI sits, who hosts the site, and how big your team is.

## How much does each cost?

As of November 2026, CloudCannon has three plans you can buy and one for agency partners:

| Plan | Monthly | Paid yearly | Users included |
| --- | --- | --- | --- |
| Standard | $55 a month | $49 a month | 3 |
| Team | $350 a month | $300 a month | 15 |
| Enterprise | Priced on request | Priced on request | Agreed with you |

Every plan covers unlimited sites. Extra users are $10 a month each, and bandwidth beyond the plan's allowance (110 GB on Standard, 700 GB on Team) is $15 per 100 GB. A Lite plan at $10 a month is for agency partners' smaller clients. There is a 21-day trial and no free plan. Those figures are from [CloudCannon's pricing page](https://cloudcannon.com/pricing/); check it before you decide, because plans change.

Galley costs nothing. It is open-source under Apache-2.0, with one edition and no paid tier today. Two things do cost money. The assistant runs on Anthropic's Claude with your own key, and each request is billed to whoever owns that key. And the site needs hosting, which for static files is often free or cheap, but is yours to arrange.

The comparison isn't quite like for like, because CloudCannon's price includes building and hosting the site. If you'd pay for hosting anyway, set that against it.

## What does a developer have to set up?

This is the biggest practical difference.

CloudCannon starts from a configuration file in the root of your repository. Its documentation calls the file "the heart of your CloudCannon experience" and says creating it "should be the first thing you do". At minimum it names the site generator and the source folder. From there, a developer adds collections, schemas, inputs and snippets as the site needs them. Since August 2026 CloudCannon's command-line tool can draft much of this: its `configure generate` command finds the content collections and suggests build settings, though not the inputs. Fairly, CloudCannon also guesses: if inputs aren't configured, it "will attempt to determine the correct editing interface for your data using the Input value and key name." And a Configuration Mode in the app writes the file for you as you click.

Editing on the page in the Visual Editor, CloudCannon's headline feature, needs markup in your templates (its sidebar of fields works without). You mark each editable part with an attribute such as `data-editable="text"` or a tag such as `<editable-text>`. Components you want to edit on the page also need an integration package, and the site has to build successfully on CloudCannon before the visual editor works.

Galley starts by reading the site. It works out the framework, the content collections and every field's type from the site's own schemas and files, without running any of its code. Astro fits deepest: Galley reads the content config and its schemas, and a list of page sections becomes sections you can arrange. Docusaurus, Nuxt, Next.js, SvelteKit, Eleventy, Hugo and Jekyll are recognised by their conventions. A `galley.config.json` file exists only to correct what it found. Editing on the page needs no markup, because Galley maps the words in the preview back to their fields, and asks which one you meant when the same words come from two places.

The honest caveat on our side: detection is only as good as the site is tidy. A site that keeps its words in content files, with schemas, gets a good form with no work. A site whose copy is hard-coded in components gets less, until someone moves the words out.

## How does each one use AI?

Here the two products have made opposite choices, and both are defensible.

CloudCannon calls itself "the CMS your AI tools can actually read". Its argument is that the whole project sits in one Git repository as plain files, so "AI agents can read, write, and deploy without translation layers or proprietary schemas standing in the way." You bring the agent: "Cursor, Claude Code, GitHub Copilot, a locally hosted model, or something you built yourself." Agents "propose changes on a branch, and those changes go through the same review as any other pull request." CloudCannon also publishes open-source agent skills that help a coding agent move a site onto CloudCannon and configure it. As of November 2026 we found no AI assistant built into CloudCannon's editor itself, on its pages, pricing or changelog.

That works well for developers. We think it does less for a marketer who wants the AI to make a change without opening a terminal or reading a pull request.

Galley puts the assistant inside the editor, beside the page. You ask in plain words, it reads the site before it edits, it asks one short question when a request is ambiguous, and it quotes the new words back. In content mode it can touch only content and media, and it has no shell or network tool. It never publishes: every change it makes waits in the proof, and a person presses Publish. For people who'd rather use their own AI tool, Galley's MCP server gives Claude Desktop, Claude Code, Cursor, VS Code or any MCP client the assistant's tools for reading and changing the site, and their changes wait in the same proof. Unlike the assistant, such a tool can also publish (its instructions say only when you ask) unless publishing over MCP is switched off.

We think that is where AI in a CMS should sit: close to the person who knows what the page should say, with a check that a non-developer can read. That's our view, and CloudCannon's approach suits a team where developers drive.

## How do you check a change before it goes live?

In CloudCannon the visual editor shows the page as you change it, and "Changes render live in real time, exactly as they'll appear in production." Saving commits the change and rebuilds the site. Teams that want a gate can set a site to publish by pull request, which then "must be reviewed and approved by another Organization Member in your Git Provider". Branching workflows and deploy previews for pull requests are on the Team and Enterprise plans.

In Galley every change, whether typed in the form, retyped on the page or made by the assistant, lands in [Proof](/how-to/proof-and-publish/): the change in the site's own words, old text struck out and new text written in, beside the live site. Any single change can be put back. Publishing is a commit to your repository, or a branch and a pull request if the site is set up for review. Undo is a new commit, and history is never rewritten.

The difference is what the reviewer sees. CloudCannon shows the new page and a list of the files that changed, with the line-by-line difference on your Git host. Galley shows what changed on the page, in the site's own words.

## Who builds and hosts the site?

CloudCannon, if you want. It builds the site with your own build command on every push and hosts it on Cloudflare's network, with SSL, DNS, redirects, forms and password-protected sites included. You can also host elsewhere and use CloudCannon only to edit. For a team that wants one bill and nothing to wire up, this is a real advantage, and Galley doesn't match it.

Galley doesn't host anything. It edits the site and publishes to your repository, and your host builds from there, as it would after any commit. It can put a site online on Cloudflare, and that is verified on the real service; attaching a new domain of your own there has so far been tested only against stand-ins. Deploys to Vercel are built but still in progress. Forms are built: they send to HubSpot, Marketo, Salesforce, Pardot, a webhook or Galley's own inbox, which takes a live site's answers only when the editor runs on a public server. Redirects are built too, and Galley keeps the host's redirects file in step.

## Which one suits a team?

For a large team today, CloudCannon. Every plan has five default roles: Owners, Developers, Technical Editors, Editors and Billing. Team and Enterprise add custom permission groups that can be narrowed to particular files. Enterprise adds single sign-on through SAML. CloudCannon holds a SOC 2 Type 2 certification. When two people open the same file, "One person can edit a file at a time, while others can view the changes in real time", and avatars show who is where.

Galley is behind here, and we'd rather say so than let you find out. Used on your own computer, it has no accounts: anyone who can open the app can publish, so the gate is pull-request mode and your code host's branch protection. A hosted editor, one site per install on a server you run, adds accounts with three roles (owner, editor and contributor), and each publish carries its author's name. The roles keep people out of each other's way; they aren't a security boundary. That hosted editor is new and still in final checks. Single sign-on is planned for later. Everyone on one hosted editor works on one shared copy of the site; a second save of a page someone has just changed is refused, not written over it. There is no live presence.

## Where does Galley fall short?

Beyond teams, in a few places.

- **It's young.** Version {version} of software first released in November 2026. CloudCannon has a changelog going back to 2015.
- **Page building is in preview.** Galley builds pages from the site's own sections, and that part is still in preview. CloudCannon has offered component editing for years, and its newer Component Editable Regions now cover most frameworks.
- **No hosting, no support contract.** Galley is software you run. Help comes through the project's issues on GitHub, not a dedicated channel or an uptime agreement.
- **TOML is read-only.** Galley reads TOML files and Hugo's TOML front matter but refuses to change them, rather than risk rewriting the file. CloudCannon edits TOML.
- **The assistant needs a key, and it's billed to you.** Everything except chat and image generation works without one.

## When is CloudCannon the better choice?

When your team is large, regulated or both, and needs custom permissions, enforced two-factor sign-in, single sign-on and a SOC 2 report this quarter. When you need scheduled publishing, which CloudCannon offers (with more of it on Team) and Galley doesn't, or a site in several languages, which its open-source Rosey tool is built for. When your images live in a store such as Amazon S3, Cloudinary or Azure and the CMS should connect to it. When you want building, hosting, forms and the CMS on one bill, with someone to call. When your developers already run AI agents against the repository and want the CMS to stay out of their way. And when you'd simply rather buy a service with a long record than adopt a new open-source tool.

Galley fits when the people who change the site aren't developers and you want them to be able to ask for a change, see exactly what changed and publish it, on a site that needs little or no setup work for the CMS. It also fits when you want no subscription, and when you want to run the editor on your own computer, or on your own server (the hosted editor is new).

## Can you move from one to the other?

Yes, and it's easier than most CMS moves, because the content never leaves the repository. To try Galley on a site that uses CloudCannon, run `npx galley-cms` in the site's folder, or open the repository in the desktop app. CloudCannon's own files (`cloudcannon.config.*`, the `.cloudcannon` folder, and the editable-region attributes in templates) can stay while you try. If you leave CloudCannon, its forms, redirects and hosting stop with it, and those are the parts to replace. Galley has forms and redirects of its own, and puts sites online on Cloudflare.

## Three questions to ask before you choose

**Who sets up the editor, and who keeps it in step with the site?** Ask how many files and how much template markup a new collection takes.

**When the AI makes a change, who sees it before it is live, and in what form?** A pull request reads well to a developer. Ask what the marketer sees.

**What happens to the site if you stop paying?** With CloudCannon, your files stay in your repository, but its hosted domains go offline and you can no longer edit there. With Galley there's no subscription to stop. Know the answer for any tool before you need it.
