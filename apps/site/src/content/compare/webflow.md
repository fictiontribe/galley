---
title: "Galley vs Webflow: a Git-based Webflow alternative"
description: "A Webflow alternative for static sites: Galley edits your site's files in Git. Design, AI, hosting, teams and price, and when Webflow is the better choice."
kind: versus
product: Webflow
heading: Webflow is the whole website in one product. Galley edits a site that lives in your own repository.
name: Galley and Webflow
lead: "In Webflow, designers build on a visual canvas, and the design, the content and the hosting live on Webflow's platform. Galley is a Webflow alternative of another shape: free and open-source, it edits a static site's files in your own Git repository, and the site's code stays your developers'."
published: "2026-11-25"
checked: November 2026
order: 10
draft: false
short:
  - Webflow is a hosted visual site builder with a CMS. Designers build on a canvas without code, CMS content sits in Webflow's database, and paid Site plans include hosting. Galley edits a static site that developers built, as files in your own Git repository.
  - As of November 2026, Premium, Webflow's Site plan for sites that use the CMS, is $25 a month paid yearly or $39 monthly, per site, with Workspace plans and seats billed apart. Galley is free and Apache-2.0. You pay for your own AI key and your own hosting.
  - Webflow has a long list of AI features on a credit system, and a hosted MCP server on every Site plan that uses no Webflow AI credits of its own (Campaigns work excepted). Galley has an assistant in the editor that never publishes, and every change it makes waits in a proof beside the live site; other AI tools can connect over MCP and can publish unless that is switched off.
  - Leaving Webflow with CMS content means a rebuild. Its code export is static HTML, CSS and JavaScript without the CMS content, which comes out as CSV, one Collection at a time. With Galley the content stays in your repository, as files.
  - Choose Webflow if designers should build without code, with design, content and hosting in one product, real-time co-editing, comments, scheduled posts and translation. Galley is not a design tool, it needs developers to build the site first, and it was first released in November 2026.
table:
  heading: Galley and Webflow, side by side.
  text: Where Webflow does more, the table says so.
  caption: Galley compared with Webflow
  columns: [What differs, Galley, Webflow]
  rows:
    - label: Where the site lives
      ours: Files in your own Git repository
      theirs: On Webflow; CMS content in its database
      better: ours
    - label: Price
      ours: Free. Your AI key and hosting are yours
      theirs: Starter free (webflow.io, 2 pages); Premium $25 a month yearly + seats (Nov 2026)
      better: even
    - label: Designing pages
      ours: Not a design tool; arranges sections (preview)
      theirs: A visual canvas, no code; page templates
      better: theirs
    - label: Editing
      ours: A form, the page itself, or the assistant
      theirs: On the canvas, or in CMS fields
      better: even
    - label: AI in the editor
      ours: An assistant that never publishes
      theirs: Site builder, Assistant, copy and SEO tools
      better: even
    - label: Checking a change
      ours: Every change marked up beside the live site
      theirs: Live canvas and preview; branches on Team and up
      better: ours
    - label: Other AI tools (MCP)
      ours: An MCP server with the assistant's tools
      theirs: Hosted, on every Site plan, no AI credits of its own
      better: theirs
    - label: Hosting
      ours: Yours to choose; deploys to Cloudflare
      theirs: Included in paid Site plans, managed
      better: theirs
    - label: Two people at once
      ours: One shared copy; a clashing save is refused
      theirs: Live co-editing for up to 25 people
      better: theirs
    - label: Teams
      ours: Three roles on a hosted editor (new); they organise work, not security
      theirs: Eight roles; SSO and custom roles on Enterprise
      better: theirs
    - label: Leaving
      ours: Nothing to export; the files are yours
      theirs: Static code export; CMS as CSV per Collection
      better: ours
    - label: Maturity
      ours: First released November 2026
      theirs: Founded 2013; SOC 2 Type II, ISO 27001
      better: theirs
faq:
  - q: Is Galley an alternative to Webflow?
    a: For some sites, yes, but they are different kinds of product. Webflow is where a site is designed, stored and hosted, with no code needed. Galley edits a static site that developers built in code and keep in a Git repository. If designers build your site in Webflow without developers, Galley doesn't replace it. If developers build it, Galley gives everyone else a way to edit it.
  - q: How much does Webflow cost?
    a: As of November 2026, Premium, Webflow's Site plan for sites that use the CMS, is $25 a month paid yearly or $39 paid monthly, per site. Basic, without a CMS, is $15 or $25, and Starter is free on a webflow.io address. Workspace plans and seats are billed separately. Team is $2,500 a month on an annual contract. Galley is free; you pay for your own AI key and hosting.
  - q: Can you export a Webflow site?
    a: Partly. On paid Workspace plans, Webflow exports the site's HTML, CSS, JavaScript and images as a ZIP file. CMS content, Ecommerce, localised pages, site search, form handling and code components don't come with it, and Collection pages export empty. CMS content comes out separately, as a CSV file for each Collection, with images as links to files Webflow hosts.
  - q: What happened to the Webflow Editor?
    a: Webflow retired its legacy Editor, and since 5 October 2026 it can no longer be opened. Anyone who edits a Webflow site now signs in with a Webflow account that has a seat in the site's Workspace. Editors who were moved across automatically were given the Content editor role. As of November 2026, a limited seat for an editor is $15 a month paid yearly, or $19 monthly; editors moved over from the old Editor got their seats free, and freelancer and agency plans include free client seats.
  - q: Does Webflow have an MCP server?
    a: Yes. Webflow runs an official, hosted MCP server that tools such as Claude, ChatGPT and Codex connect to with OAuth. It is on every Site plan, Starter included, and uses no Webflow AI credits of its own (Campaigns work excepted). Galley's MCP server gives AI tools the assistant's tools for the site. Unlike the assistant, such a tool can also publish (its instructions say only when you ask) unless publishing over MCP is switched off.
  - q: Is Galley a design tool like Webflow?
    a: No. Galley edits the words, pictures and sections of a site that developers have already built. Its page builder, which is in preview, arranges the site's own sections on the page, but it doesn't change spacing, columns or sizes, and new kinds of section are added in code. Designing a site visually, without code, is what Webflow is for.
sources:
  - label: "Webflow, home page"
    href: https://webflow.com/
  - label: "Webflow, pricing"
    href: https://webflow.com/pricing
  - label: "Webflow, the platform"
    href: https://webflow.com/platform
  - label: "Webflow, CMS"
    href: https://webflow.com/feature/cms
  - label: "Webflow, editing content"
    href: https://webflow.com/feature/edit-content
  - label: "Webflow, hosting"
    href: https://webflow.com/feature/hosting
  - label: "Webflow, about"
    href: https://webflow.com/company/about
  - label: "Webflow, security"
    href: https://webflow.com/security
  - label: "Webflow, apps"
    href: https://webflow.com/apps
  - label: "Webflow Help Center, intro to the Webflow CMS"
    href: https://help.webflow.com/hc/en-us/articles/33961307099027-Intro-to-the-Webflow-CMS
  - label: "Webflow Help Center, choose a Site plan"
    href: https://help.webflow.com/hc/en-us/articles/33961232582419-Choose-a-Site-plan
  - label: "Webflow Help Center, updated pricing and simplified plans for May 2026"
    href: https://help.webflow.com/hc/en-us/articles/51059955082387-Updated-pricing-and-simplified-plans-for-May-2026
  - label: "Webflow Help Center, Webflow hosting overview"
    href: https://help.webflow.com/hc/en-us/articles/33961342422547-Webflow-hosting-overview
  - label: "Webflow Help Center, seats, roles and permissions"
    href: https://help.webflow.com/hc/en-us/articles/33961273067411-Seats-roles-and-permissions-overview
  - label: "Webflow Help Center, legacy Editor deprecation FAQ"
    href: https://help.webflow.com/hc/en-us/articles/48412420902675-Legacy-Editor-deprecation-FAQ
  - label: "Webflow Help Center, edit site content as a content editor"
    href: https://help.webflow.com/hc/en-us/articles/33961251014931-Edit-site-content-as-a-content-editor
  - label: "Webflow Help Center, page building"
    href: https://help.webflow.com/hc/en-us/articles/33961210206483-Page-building
  - label: "Webflow Help Center, real-time collaboration"
    href: https://help.webflow.com/hc/en-us/articles/43232037920275-Real-time-collaboration
  - label: "Webflow Help Center, comments"
    href: https://help.webflow.com/hc/en-us/articles/33961339882131-Comments
  - label: "Webflow Help Center, scheduled publishing"
    href: https://help.webflow.com/hc/en-us/articles/33961272476563-Scheduled-publishing
  - label: "Webflow Help Center, page branching"
    href: https://help.webflow.com/hc/en-us/articles/46651751861139-Page-branching
  - label: "Webflow Help Center, design approvals"
    href: https://help.webflow.com/hc/en-us/articles/46651772348947-Design-approvals
  - label: "Webflow Help Center, custom roles"
    href: https://help.webflow.com/hc/en-us/articles/46651804072467-Create-and-manage-custom-roles
  - label: "Webflow Help Center, single sign-on"
    href: https://help.webflow.com/hc/en-us/articles/46651862433683-Single-Sign-On-SSO-Login
  - label: "Webflow Help Center, Webflow Localize overview"
    href: https://help.webflow.com/hc/en-us/articles/33961240752147-Webflow-Localize-overview
  - label: "Webflow Help Center, Webflow AI overview"
    href: https://help.webflow.com/hc/en-us/articles/34297897805715-Webflow-AI-overview
  - label: "Webflow Help Center, Webflow AI credits"
    href: https://help.webflow.com/hc/en-us/articles/51060121155347-Webflow-AI-credits
  - label: "Webflow Help Center, Webflow MCP server overview"
    href: https://help.webflow.com/hc/en-us/articles/52536562285203-Webflow-MCP-server-overview
  - label: "Webflow Help Center, connect your AI tools to the Webflow MCP server"
    href: https://help.webflow.com/hc/en-us/articles/52536616701971-Connect-your-AI-tools-to-the-Webflow-MCP-server
  - label: "Webflow developer documentation, getting started with the MCP server"
    href: https://developers.webflow.com/mcp/reference/getting-started
  - label: "Webflow Help Center, how to export your site code"
    href: https://help.webflow.com/hc/en-us/articles/33961386739347-How-do-I-export-my-Webflow-site-code
  - label: "Webflow Help Center, importing and exporting CMS content"
    href: https://help.webflow.com/hc/en-us/articles/33961290794771-How-do-I-import-content-into-the-Webflow-CMS
  - label: "WordPress.org, about WordPress"
    href: https://wordpress.org/about/
  - label: "Cloudflare Pages, pricing"
    href: https://developers.cloudflare.com/pages/functions/pricing/
  - label: "Galley, the FAQ for developers"
    href: /docs/project/faq/
  - label: "Galley, the tour: what is built and what isn't yet"
    href: /tour/
related: [/wordpress/, types-of-cms, cloudcannon]
---

## Is Galley really a Webflow alternative?

For some teams. They are different kinds of product, so the answer depends on what you need from a website.

Webflow is a hosted visual site builder with a CMS built in. A designer builds the site on Webflow's canvas without code; in Webflow's words, "You design, we generate the code". Content with a shared structure, such as blog posts, lives in Webflow's CMS, which its documentation calls "a structured database", and paid Site plans include hosting. Design, content and hosting are one product, on Webflow's platform. Webflow started in 2013 and counts 300,000 organisations using it (November 2026).

Galley edits a static site that developers have built in a framework such as Astro and keep in a Git repository. The words are Markdown, JSON and YAML files beside the code. Everyone else changes them in a form, on the page or by asking an assistant, and each publish is a commit to your repository. The code stays your developers', on the host you choose.

So the real question is who makes the site. If designers build it and nobody writes code, Webflow is made for that and Galley isn't. If developers build it and the rest of the team keeps it fresh, Galley is one way to do that.

People weighing Webflow often look at WordPress too, a third shape again, with its own database behind the site. We set Galley beside it on [its own page](/wordpress/).

## How much does each cost?

As of November 2026, Webflow charges for each site and for the team separately. Its Site plans, per site, in US dollars:

| Plan | Paid yearly | Paid monthly | What it covers |
| --- | --- | --- | --- |
| Starter | Free | Free | A webflow.io address, 2 static pages, 50 CMS items in 20 Collections |
| Basic | $15 a month | $25 a month | Your own domain, 300 static pages, no CMS |
| Premium | $25 a month | $39 a month | The CMS: 20,000 items in 40 Collections, 50 GB of bandwidth |
| Team | $2,500 a month | Not offered | A Platform plan: a site, 5 full and 5 limited seats, 100 Collections |
| Enterprise | Priced on request | Priced on request | Custom roles, single sign-on, EU hosting |

Premium is new: from 13 May 2026 it replaced the CMS and Business plans for new sites, and existing sites move to it at their first renewal from 29 June 2026, or from November for some accounts. The team is billed on a Workspace plan: for in-house teams, Starter is free, Core is $19 a month paid yearly ($28 monthly) and Growth $49 ($60); for freelancers and agencies, Freelancer is $16 ($24) and Agency $35 ($42). Seats beyond the owner's cost extra: $39 a month paid yearly ($45 monthly) for a full seat, which designs, and $15 ($19) for a limited seat, which edits content. Reviewers are free. Those figures are from [Webflow's pricing page](https://webflow.com/pricing), read on both its yearly and its monthly setting. Check it before you decide, because plans change.

Galley costs nothing: Apache-2.0, one edition, no paid tier. The assistant runs on Anthropic's Claude with your own key, billed to whoever owns it, and hosting is yours to arrange: static files cost little to host, and Cloudflare Pages, for one, serves static assets free on every plan.

It isn't like for like: Webflow's price includes the design tool and the hosting, and a Galley site needs developers to build it, whose time is part of the price.

## Who designs the site?

In Webflow, designers do, without code. The Designer is a visual canvas for layouts, styles, components and interactions, and Webflow writes the code underneath. For people who shouldn't touch the design, designers make page templates and components, and marketers build pages from those "designer-approved building blocks".

In Galley, your developers do, in code. Galley is not a design tool. Content mode, the default for everyone, the assistant included, can change content and media only. The page builder, which is in preview, lets an editor drag the site's own sections into place and switch their options, but it doesn't change spacing, columns or sizes, and new kinds of section are added in code. The assistant's Build mode can change layouts and styles, for whoever looks after the site, and the site's settings can turn it off.

## What does a developer have to set up?

In Webflow, most of it happens in Webflow itself. A Collection and its fields are set up in the CMS, and the Collection page template is designed on the canvas. Site managers and designers decide, element by element, what content editors may change. Custom code needs a paid plan, and components built by developers can go on the canvas on Premium. A REST API adds, updates and removes CMS items from outside. There is no editor to install.

In Galley, developers build the site as they would without a CMS. Then Galley reads it: the framework, the content collections and every field's type, from the site's own schemas and files, without running its code. Astro fits deepest; Docusaurus, Nuxt, Next.js, SvelteKit, Eleventy, Hugo and Jekyll are recognised by their conventions. A `galley.config.json` file exists only to correct what Galley found.

The caveat on our side: detection is only as good as the site is tidy. Copy hard-coded in components gets a thinner form until someone moves it into content files.

## How does each one use AI?

Webflow AI is, in Webflow's words, "the collective name for Webflow's AI-powered features", and there are many. The AI site builder makes a site from a prompt. The AI Assistant answers questions in the app, designs new sections (in beta, so far only on a few free templates and sites made by the AI site builder) and writes React code components. Webflow AI also writes copy, generates CMS items, and fills in missing alt text, meta titles, descriptions and schema markup, for SEO and AEO. Localize adds AI translation.

Since May 2026, much of this uses AI credits, shared across a Workspace: 200 a month on the free Starter Workspace plan, 300 on Core or Freelancer, 400 on Growth or Agency, and 100,000 a year on Team. More can be bought, and Webflow "doesn't publish a rate card".

Webflow also runs an official, hosted MCP server. Tools such as Claude, ChatGPT, Codex and Gemini connect to it with OAuth, and can design pages, manage CMS content, work on SEO and publish. It is "available on all Site plans, including the free Starter plan", and uses no Webflow AI credits of its own (Campaigns work excepted).

Galley puts [one assistant](/how-to/ask-the-assistant/) inside the editor, beside the page. It reads the site before it edits, asks one short question when a request is ambiguous, and quotes the new words back. In content mode it can touch only content and media, and it has no shell or network tool. It never publishes: every change it makes waits in the proof, and a person presses Publish. Galley's [MCP server](/docs/integrations/mcp/) gives Claude Desktop, Claude Code, Cursor, VS Code or any MCP client the assistant's tools for reading and changing the site. Unlike the assistant, such a tool can also publish (its instructions say only when you ask) unless publishing over MCP is switched off.

Webflow's AI is broader by a distance, and most of it helps build and fill a site. We think what matters most once a site is live is the check: who sees a change, in what form, before it goes out. Galley is built around that. For making new pages and sections, Webflow offers far more today.

## How do you check a change before it goes live?

In Webflow you edit the page itself and, as its CMS page puts it, "see changes rendered in real time". Changes save as you go and reach the live site when someone publishes. CMS items wait as drafts you can preview, and a site can go to its webflow.io staging address first. On Premium and above, a new CMS item can be scheduled. On Team and Enterprise, page branching gives the team a working copy of a page, staged at its own address and merged after a summary of what changed; on Enterprise, design approvals add a sign-off first. Reviewers comment on the page itself, and people without a Webflow account can too, through a link.

In Galley every change, from the form, the page or the assistant, lands in [Proof](/how-to/proof-and-publish/): in the site's own words, old struck out and new written in, beside the live site. Any single change can be put back. Publishing is a commit to your repository, or a branch and a pull request. Undo is a new commit, and history is never rewritten.

We think a list of each change in words is easier to check than a page compared by eye, especially after an AI made the change. For a design team reviewing together, Webflow's comments and branches do more.

## Who hosts the site?

Webflow does. Hosting "is included with all paid Webflow Site plans", and Webflow manages it, so scaling and security patches are its job. Each site on its own domain needs its own Site plan; the free Starter plan publishes to a webflow.io address. For a team that wants nothing to wire up, that is a real advantage, and Galley doesn't match it. The other side is that a Webflow site is made in Webflow. Its pricing page says, "No, you can only develop websites in Webflow. If you export your code, it can’t be reimported."

Galley doesn't host anything. It publishes to your repository, and your host builds from there. It can put a site online on Cloudflare, and that is verified on the real service, though attaching a new domain of your own there has been tested only against stand-ins. Deploys to Vercel are in progress. Forms and redirects are built.

## Which one suits a team?

For a team today, Webflow, by a distance. It has eight roles, from Owner and Designer to Content editor, Reviewer and Guest, and the Content editor, who "only edits content", is on every Workspace plan. Real-time collaboration is on every site, whatever the plan, for up to 25 people at once, with avatars showing who is where; when edits overlap, "The last change that hits our servers is the one saved". Every role can comment. Growth and Agency plans can decide who may publish, and Enterprise adds custom roles and single sign-on. Webflow holds SOC 2 Type II and ISO 27001.

One change is recent: "As of October 5, 2026, the legacy Editor is fully deprecated and can no longer be accessed." Everyone who edits a Webflow site now signs in with an account that has a seat in its Workspace: for someone who only edits, usually a limited seat, or one of the free client seats in Workspace plans for freelancers and agencies.

Galley is behind here. On your own computer it has no accounts: anyone who can open the app can publish, so the gate is pull-request mode and your code host's branch protection. A hosted editor, one site per install on a server you run, adds accounts with three roles (owner, editor and contributor), and each publish carries its author's name. The roles keep people out of each other's way; they aren't a security boundary. That hosted editor is new and still in final checks, and single sign-on is planned for later. Everyone on it works on one shared copy of the site, and a second save of a page someone has just changed is refused, not written over it. There is no live presence.

## Where does Galley fall short?

In more places than it does [beside CloudCannon](/compare/cloudcannon/), because Webflow does more jobs.

- **It isn't a design tool.** It changes words, pictures and the order of sections. Layout, style and new kinds of section are code.
- **It needs developers first.** Someone has to build the site before Galley has anything to edit.
- **It's young.** Version {version} of software first released in November 2026. Webflow started in 2013.
- **No hosting, no support contract.** Help comes through the project's issues on GitHub.
- **No editing together, scheduling or languages.** There is no real-time co-editing or presence, no scheduled publishing and no multi-locale editorial workflow. Webflow has all three: co-editing and scheduling on the plans named above, and languages through Localize, priced below.
- **TOML is read-only.** Galley reads TOML but refuses to change it.
- **The assistant needs a key, billed to you.** Everything except chat and image generation works without one.

## When is Webflow the better choice?

When designers build the site and nobody wants to write code. When you want design, content and hosting in one product. When several people work on the same pages at once. When you need scheduled posts, on Premium, or several languages, through the Localize add-on, from $9 a month for one locale paid yearly. When you need a shop, or single sign-on, custom roles and design approvals, which are on Enterprise. When you want AI to build pages and sections, not only change words. And when you'd rather buy a service with thirteen years of use, hundreds of apps in its marketplace and a support team.

Galley fits when developers build your site and the people who change it aren't developers: they ask for a change, see exactly what changed and publish it. And when you want the site as files you own, on the host you choose, with no subscription.

## Can you move from one to the other?

From Webflow to Galley, it's a rebuild. Galley has no importer for Webflow; its only guided move is from WordPress, and that is new and in final checks. Webflow's code export, on paid Workspace plans, gives you the site's HTML, CSS, JavaScript and images in a ZIP file. It leaves out the CMS content, Ecommerce, localised pages (only the primary locale comes), form handling, site search and code components, and Collection pages come out empty. CMS content is exported apart, one Collection at a time, as CSV: rich text as HTML, and images and files as links to Webflow-hosted copies, which break if you delete the site. So a developer rebuilds the site in a framework, turns each CSV into Markdown or data files and downloads the images. Then Galley can read it.

From Galley to Webflow, the content is already files in your repository. But Webflow can't take the site's code, so the design is rebuilt in its Designer and the content goes in by CSV import.

## Three questions to ask before you choose

**Who will make the site, and who will change it after launch?** If designers do both, Webflow. If developers make it and marketers change it, ask how each tool keeps the design safe.

**When the AI makes a change, who sees it before it is live, and in what form?** A canvas shows the new page; on Team and Enterprise, a branch merge shows a summary. Ask what a reviewer sees on your plan.

**What do you take with you if you leave?** From Webflow, a static export and a CSV file per Collection. From Galley, the repository. Know the answer before you need it.
