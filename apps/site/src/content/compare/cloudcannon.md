---
title: "Galley vs CloudCannon: two Git-based CMSs compared"
description: Galley and CloudCannon both keep your content in Git. How they differ on setup, AI, translations, hosting, collaboration, teams and price, and when CloudCannon is the better choice.
kind: versus
product: CloudCannon
heading: CloudCannon and Galley agree about Git. They part ways on where the AI sits.
name: Galley and CloudCannon
lead: Both edit the plain files in your repository and record changes as commits. CloudCannon is a hosted service, founded in 2013, that leaves AI to the agents you bring. Galley is open source (Apache-2.0) with optional managed hosting on Galley Cloud, and builds the assistant, proof, translations, and search intelligence into the editor.
published: "2026-11-25"
updated: "2026-11-27"
checked: November 2026
order: 1
draft: false
short:
  - Both are Git-based. Your content stays as Markdown, JSON, YAML or TOML files in your own repository, and a change becomes a commit when you save in CloudCannon and when you publish in Galley. Leaving either one needs no content migration.
  - CloudCannon is a paid, hosted service starting at $55 a month for three users ($49 paid yearly, as of November 2026), with extra users at $10 a month. Galley is free and Apache-2.0 to run locally or self-host on your own server; [Galley Cloud](/cloud/) (opening by invitation) adds hosted editing, Cloudflare edge delivery and monthly AI credits from $35 a month per site ($99 for five sites on Agency), with no per-seat fees.
  - CloudCannon asks a developer for a configuration file and, for visual editing, markup in the templates. Galley reads the site's framework, collections and fields as they already are.
  - CloudCannon leaves AI to outside agents such as Cursor, Claude Code or Copilot working in the repository. Galley builds an assistant, multilingual AI translation (with Translation Memory and a Glossary), and Search and AI intelligence into the editor, holds every change in Proof beside the live site, and lets other AI tools in over MCP.
  - "Choose CloudCannon if you need what thirteen years have built: live-today hosted service without an invitation, custom file-level permissions, SAML SSO, SOC 2 Type 2, scheduled publishing, and an uptime agreement. Galley was first released in November 2026 and doesn't have a SOC 2 report, scheduled publishing or an SLA yet."
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
      ours: Free open source; Galley Cloud from $35/mo, no per-seat fees (Nov 2026)
      theirs: Standard, $55 a month for 3 users (+$10/seat), hosting included (Nov 2026)
      better: ours
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
      ours: Assistant that never publishes, AI translations, image/video gen, MCP
      theirs: None built in (Nov 2026); bring your own agents
      better: ours
    - label: Checking a change
      ours: Each change in the site's words, beside the live site
      theirs: Live preview and a list of changed files
      better: ours
    - label: Languages
      ours: Built-in i18n, side-by-side editing, AI translation with memory and glossary
      theirs: Open-source Rosey tool
      better: ours
    - label: Search & AI visibility
      ours: Built-in SEO checks, live rankings, keyword gaps, 404 recovery and llms.txt
      theirs: None built in; bring your own tools
      better: ours
    - label: Building and hosting
      ours: Deploys to Cloudflare; Galley Cloud (by invite) hosts editor + Cloudflare edge
      theirs: Builds and hosts on Cloudflare today, with forms and redirects
      better: theirs
    - label: Teams & SSO
      ours: Three roles + OIDC SSO (new) self-hosted; no per-seat fees on Cloud
      theirs: Five roles; custom file-level groups; SAML SSO on Enterprise
      better: theirs
    - label: Two people at once
      ours: Real-time co-editing and live presence on Cloud; safe save checks self-hosted
      theirs: One editor per file, others watch live
      better: ours
    - label: Where it runs
      ours: Local app/CLI, self-hosted Docker, or Galley Cloud (by invite)
      theirs: CloudCannon's hosted app
      better: ours
    - label: Maturity
      ours: First released November 2026; no SOC 2 or SLA yet
      theirs: Founded 2013; SOC 2 Type 2, scheduled publishing, SLA
      better: theirs
faq:
  - q: Is Galley an alternative to CloudCannon?
    a: For many static sites, yes. Both edit the files in your Git repository and record changes as commits (CloudCannon on each save, Galley when you publish). Galley is free and Apache-2.0 to run locally or self-host (with optional managed hosting on [Galley Cloud](/cloud/)), needs no configuration or template markup for common setups, and builds in an AI assistant, multilingual translation and search intelligence. CloudCannon adds a thirteen-year track record, scheduled publishing, custom file-level permissions, SOC 2 Type 2 and an uptime agreement.
  - q: Is CloudCannon open source?
    a: "The CMS itself isn't described as open source on CloudCannon's pages, and they don't offer a self-hosted version for editors. Its command-line tool can run the app against local files, for developers building the setup. CloudCannon does publish open-source tools, among them Pagefind for search, Bookshop for components and Rosey for translations. Galley is open source under Apache-2.0: it runs on your own computer (CLI or Apple-signed macOS desktop app), on your own server with Docker (`ghcr.io/fictiontribe/galley`), or hosted on [Galley Cloud](/cloud/)."
  - q: Does CloudCannon have AI features?
    a: As of November 2026, its pages describe no AI assistant built into the CMS. CloudCannon calls itself "AI-ready". Because content is plain files in Git, outside agents such as Cursor, Claude Code or Copilot can work on it, and their changes go through pull requests. It also publishes agent skills that help coding agents set sites up on CloudCannon.
  - q: How much does CloudCannon cost?
    a: As of November 2026, Standard is $55 a month or $49 a month paid yearly, with three users. Team is $350 a month or $300 paid yearly, with fifteen. Enterprise is priced on request, and extra users are $10 a month each. There is a 21-day free trial and no free plan. Galley is free and open-source when you run it locally or self-host (bringing your own AI key); [Galley Cloud](/cloud/) (opening by invitation) starts at $35 a month for a handed-over client Site or $99 a month on Agency (five live sites included, then $15–$12 per extra site), with monthly AI credits included and no per-seat fees.
  - q: Can two people edit the same page at once?
    a: On [Galley Cloud](/cloud/), yes — teammates see live presence in the top bar and page list, active field outlines with each person's name, and simultaneous typing in Markdown body text, with each author attributed in Proof. On local or self-hosted Galley installs, editors share one copy and a conflicting save is refused rather than silently overwritten. In CloudCannon, one person edits a file at a time while others watch the changes live, with avatars showing who is where.
  - q: Do I have to change my templates to use Galley?
    a: "No. Galley adds no dependency, integration or build plugin, and editing needs no markup. A site that keeps its words in content files gets a better form, and Astro sites with schemas get the most. Optional features such as forms, the consent banner, and multilingual `<LanguageSelector />` / `<LocaleHead />` components come from its site kit, added as changes you check in Proof first."
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
  - label: "Galley Cloud"
    href: /cloud/
  - label: "Galley for enterprise and security teams"
    href: /enterprise/
related: [types-of-cms, /wordpress/, /ai-first/]
---

## What do Galley and CloudCannon have in common?

More than either has in common with WordPress or a headless CMS. Both are Git-based: the words of the site are the files in its repository, and the CMS is a way to change those files without opening a code editor. CloudCannon puts it plainly: "CloudCannon stores content as files in your Git repo — Markdown, JSON, YAML, or TOML — and builds your static site directly from them." Galley edits Markdown, JSON and YAML the same way; it reads TOML but doesn't change it yet.

That shared starting point has two consequences worth knowing before anything else. There is no database behind the live site to run or patch. And neither tool holds your content hostage. CloudCannon's developer page says "If you ever leave CloudCannon, you leave with everything." We say the same about Galley, for the same reason.

So the choice between them isn't about where your content lives. It comes down to four other things: who sets the editor up, where the AI sits, how you want to host and pay for seats, and how mature a vendor you need today.

## How much does each cost?

As of November 2026, CloudCannon has three plans you can buy and one for agency partners:

| Plan | Monthly | Paid yearly | Users included |
| --- | --- | --- | --- |
| Standard | $55 a month | $49 a month | 3 |
| Team | $350 a month | $300 a month | 15 |
| Enterprise | Priced on request | Priced on request | Agreed with you |

Every plan covers unlimited sites. Extra users are $10 a month each, and bandwidth beyond the plan's allowance (110 GB on Standard, 700 GB on Team) is $15 per 100 GB. A Lite plan at $10 a month is for agency partners' smaller clients. There is a 21-day trial and no free plan. Those figures are from [CloudCannon's pricing page](https://cloudcannon.com/pricing/); check it before you decide, because plans change.

Galley comes in two shapes. The open-source software is free under Apache-2.0: run it on your own computer (`npx galley-cms` or the Apple-signed and notarized macOS desktop app) or self-host it on your own server with Docker (`ghcr.io/fictiontribe/galley`), bringing your own AI key and arranging static hosting yourself.

If you want managed hosting with no keys to paste, [Galley Cloud](/cloud/) (opening by invitation as of November 2026) runs a dedicated editor machine for each site, serves the live site on Cloudflare's global edge, and includes monthly AI credits and Search and AI intelligence on every plan — with **nobody charged by the seat** (up to 500 named people per workspace, 100 per site):

| Plan | Price | What's included |
| --- | --- | --- |
| Partner | $0 a month | For agencies whose clients pay directly; earns 15% of handed-over Site invoices |
| Site | $35 a month | One handed-over client site, 4,000 AI credits a month |
| Agency | $99 a month | 5 live sites included ($15–$12 per extra site) |
| Business | $149 a month | 12,000 AI credits a month, 90-day nightly repository backups |

The difference for growing teams is per-seat billing. CloudCannon gives unlimited sites on every plan and charges $10 a month per extra user past 3 on Standard or 15 on Team. Galley Cloud prices by site and AI credits, and never charges per editor seat.

## What does a developer have to set up?

This is the biggest practical difference.

CloudCannon starts from a configuration file in the root of your repository. Its documentation calls the file "the heart of your CloudCannon experience" and says creating it "should be the first thing you do". At minimum it names the site generator and the source folder. From there, a developer adds collections, schemas, inputs and snippets as the site needs them. Since August 2026 CloudCannon's command-line tool can draft much of this: its `configure generate` command finds the content collections and suggests build settings, though not the inputs. Fairly, CloudCannon also guesses: if inputs aren't configured, it "will attempt to determine the correct editing interface for your data using the Input value and key name." And a Configuration Mode in the app writes the file for you as you click.

Editing on the page in the Visual Editor, CloudCannon's headline feature, needs markup in your templates (its sidebar of fields works without). You mark each editable part with an attribute such as `data-editable="text"` or a tag such as `<editable-text>`. Components you want to edit on the page also need an integration package, and the site has to build successfully on CloudCannon before the visual editor works.

Galley starts by reading the site. It works out the framework, the content collections and every field's type from the site's own schemas and files, without running any of its code. Astro fits deepest: Galley reads the content config and its schemas, and a list of page sections becomes sections you can arrange. Docusaurus, Nuxt, Next.js, SvelteKit, Eleventy, Hugo and Jekyll are recognised by their conventions. A `galley.config.json` file exists only to correct what it found. Editing on the page needs no markup, because Galley maps the words in the preview back to their fields, and asks which one you meant when the same words come from two places.

The honest caveat on our side: detection is only as good as the site is tidy. A site that keeps its words in content files, with schemas, gets a good form with no work. A site whose copy is hard-coded in components gets less, until someone moves the words out.

## How does each one use AI, translations and search intelligence?

Here the two products have made opposite choices, and both are defensible.

CloudCannon calls itself "the CMS your AI tools can actually read". Its argument is that the whole project sits in one Git repository as plain files, so "AI agents can read, write, and deploy without translation layers or proprietary schemas standing in the way." You bring the agent: "Cursor, Claude Code, GitHub Copilot, a locally hosted model, or something you built yourself." Agents "propose changes on a branch, and those changes go through the same review as any other pull request." CloudCannon also publishes open-source agent skills that help a coding agent move a site onto CloudCannon and configure it, and its open-source Rosey tool handles translations on static builds. As of November 2026 we found no AI assistant built into CloudCannon's editor itself, on its pages, pricing or changelog.

That works well for developers. We think it does less for a marketer who wants the AI to make a change without opening a terminal or reading a pull request.

Galley puts AI, translation and search intelligence directly inside the editor, with every change landing in Proof:

- **The built-in assistant.** Ask in plain words beside the page. It reads the site before it edits, asks one short question when a request is ambiguous, and quotes the new words back. In content mode it touches only content and media, has no shell or network tool, and never publishes. You can also generate images and short video clips across OpenAI, Google Gemini and OpenRouter models.
- **Built-in multilingual (`i18n`) translation.** Configure target languages, localized URL slugs (such as `/pricing/` and `/es/precios/`), `hreflang` alternates and Astro `<LanguageSelector />` / `<LocaleHead />` components. Translate manually side by side against the source language (with automatic out-of-sync flags when the source changes), or translate individual pages or the whole site with AI using a Git-tracked Translation Memory (reusing approved phrases at zero cost), a brand/product Glossary, and a clear upfront cost estimate before anything runs — every translated page waiting in Proof.
- **Built-in Search and AI intelligence.** On-site SEO and structured-data checks, one-click fixes into Proof, Markdown twins, `llms.txt` and per-AI-crawler `robots.txt` controls, plus live Google search rankings, striking-distance (`#4–#15`) quick wins, keyword research, competitor content gaps, broken-404 backlink recovery with one-click redirects, and AI search answer citations — included on every [Galley Cloud](/cloud/) plan (at zero AI credits for lookups) or self-hosted with your own search data key.
- **Outside AI tools over MCP.** Galley's [MCP server](/docs/integrations/mcp/) gives Claude Desktop, Claude Code, Cursor, VS Code or any MCP client the assistant's tools for reading and changing the site, with their changes waiting in the same proof. Unlike the built-in assistant, an MCP client can also publish (its instructions say only when you ask) unless publishing over MCP is switched off.

We think that is where AI in a CMS should sit: close to the person who knows what the page should say, with a check that a non-developer can read. CloudCannon's approach suits a team where developers drive.

## How do you check a change before it goes live?

In CloudCannon the visual editor shows the page as you change it, and "Changes render live in real time, exactly as they'll appear in production." Saving commits the change and rebuilds the site. Teams that want a gate can set a site to publish by pull request, which then "must be reviewed and approved by another Organization Member in your Git Provider". Branching workflows and deploy previews for pull requests are on the Team and Enterprise plans.

In Galley every change, whether typed in the form, retyped on the page, translated or made by the assistant, lands in [Proof](/how-to/proof-and-publish/): the change in the site's own words, old text struck out and new text written in, beside the live site. Any single change can be put back. Publishing is a commit to your repository, or a branch and a pull request if the site is set up for review. Undo is a new commit, and history is never rewritten.

The difference is what the reviewer sees. CloudCannon shows the new page and a list of the files that changed, with the line-by-line difference on your Git host. Galley shows what changed on the page, in the site's own words.

## Who builds and hosts the site?

CloudCannon, if you want, today without waiting for an invitation. It builds the site with your own build command on every push and hosts it on Cloudflare's network, with SSL, DNS, redirects, forms and password-protected sites included. You can also host elsewhere and use CloudCannon only to edit.

Galley gives you both paths. You can host your site wherever you like (AWS, Google Cloud, Azure, Cloudflare, Vercel, Netlify, or your own CI/CD) and use Galley purely as the editing GUI for your repository — or deploy straight to Cloudflare from the editor (verified on the real service; attaching a fresh domain is tested against stand-ins; Vercel deploys are in progress). Forms route to HubSpot, Marketo, Salesforce, Pardot, a webhook or Galley's inbox, redirects keep the host's `_redirects` file in step, and external media buckets support Cloudflare R2 (verified on the real service), Amazon S3 / S3-compatible stores and Cloudflare Images (in progress).

On [Galley Cloud](/cloud/) (opening by invitation), Galley hosts both a dedicated editor machine for each site and the published static site on Cloudflare's global edge, with automatic SSL certificates, custom domains in one DNS record, preview links for unpublished changes, instant version rollback without rebuilding, and nightly repository backups kept 30–90 days.

## Which one suits a team?

Each is stronger in a different place.

CloudCannon has five default roles on every plan (Owners, Developers, Technical Editors, Editors and Billing), custom file-level permission groups on Team and Enterprise, SAML single sign-on on Enterprise, and a SOC 2 Type 2 certification. When two people open the same file, "One person can edit a file at a time, while others can view the changes in real time", and avatars show who is where.

On [Galley Cloud](/cloud/), real-time collaboration and live presence are built in with no per-seat fees (up to 500 named people per workspace, 100 per site): teammates see faces in the top bar and page list, jump straight to each other's page, see active field outlines with each person's name, type together simultaneously in Markdown body text, and see each author attributed in Proof.

On self-hosted Galley installs (`ghcr.io/fictiontribe/galley`, one isolated container per site), Galley includes owner, editor and contributor accounts plus **OpenID Connect (OIDC) single sign-on** (new, in final checks — Authorization Code with PKCE, IdP role-claim mapping, passwordless `GALLEY_OIDC_ONLY`, and Back-Channel Logout) built into the free Apache-2.0 server, without paying for an enterprise tier; see [`/enterprise/`](/enterprise/). On self-hosted and local installs, editors share one copy of the site, each publish carries its author's name, and a conflicting save of a page someone just changed is refused rather than silently overwritten. Roles on self-hosted installs keep people out of each other's way; the container is the security boundary.

## Where does Galley fall short?

Even with Galley Cloud, SSO, translations and live collaboration, CloudCannon still leads in clear places:

- **It's young.** Version {version} of software first released in November 2026, with no SOC 2 Type 2 report or published uptime SLA yet. CloudCannon has a changelog going back to 2015.
- **Galley Cloud is opening by invitation.** CloudCannon's hosted service is open for immediate self-serve sign-up today.
- **No scheduled publishing.** CloudCannon offers content scheduling (with more of it on Team); Galley does not.
- **Page building is in preview.** Galley builds pages from the site's own sections, and that part is still in preview. CloudCannon has offered component editing for years, and its newer Component Editable Regions cover most frameworks.
- **Coarser permissions.** CloudCannon's Team and Enterprise plans offer custom permission groups narrowed to particular files. Galley has three fixed roles.
- **TOML is read-only.** Galley reads TOML files and Hugo's TOML front matter but refuses to change them, rather than risk rewriting the file. CloudCannon edits TOML.
- **Self-hosted AI needs your own keys.** On Galley Cloud monthly AI credits are included; on local or self-hosted installs, chat, AI translation and image/video generation use your own API keys (everything else works without one).

## When is CloudCannon the better choice?

When your team is large, regulated or both, and needs custom file-level permissions, enforced two-factor sign-in, SAML SSO, a SOC 2 Type 2 report and an uptime SLA this quarter. When you need scheduled publishing, which CloudCannon offers and Galley doesn't. When your media lives in Cloudinary or Azure Blob Storage and the CMS should connect directly to it. When you want a hosted CMS open for self-serve sign-up today, with thirteen years of production history and a dedicated support contract. When your developers already run AI agents against the repository and want the CMS to stay out of their way.

Galley fits when the people who change the site aren't developers and you want them to ask for a change, translate pages with a glossary and Translation Memory, check live search rankings, see every edit side by side in Proof and publish — on a site that needs little or no CMS setup. It also fits when you want free open-source software (with OIDC SSO built in), real-time co-editing on Galley Cloud, or predictable hosting without per-seat fees.

## Can you move from one to the other?

Yes, and it's easier than most CMS moves, because the content never leaves the repository. To try Galley on a site that uses CloudCannon, run `npx galley-cms` in the site's folder, or open the repository in the macOS desktop app. CloudCannon's own files (`cloudcannon.config.*`, the `.cloudcannon` folder, and the editable-region attributes in templates) can stay while you try. If you leave CloudCannon, its forms, redirects and hosting stop with it, and those are the parts to replace. Galley has forms and redirects of its own, deploys directly to Cloudflare, and offers managed Cloudflare edge hosting on [Galley Cloud](/cloud/).

## Three questions to ask before you choose

**Who sets up the editor, and who keeps it in step with the site?** Ask how many files and how much template markup a new collection takes.

**When the AI makes a change, who sees it before it is live, and in what form?** A pull request reads well to a developer. Ask what the marketer sees.

**What happens to the site if you stop paying, or add ten more editors?** With CloudCannon, your files stay in your repository, its hosted domains go offline when a subscription stops, and extra seats cost $10 a month each. With Galley, you can always keep editing locally or self-host the open-source server at zero licence cost, and Galley Cloud doesn't charge per seat. Know the answer for any tool before you need it.
