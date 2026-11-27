---
title: What is an AI CMS? And what it should never do
description: An AI CMS lets you change a site by asking in plain words. What CMSs mean by AI in 2026, what can go wrong, and four questions to ask of any of them.
kind: guide
name: What an AI CMS is
heading: Most CMSs sell AI now. The question is who presses Publish.
lead: An AI CMS lets you change a website by asking for the change in plain words. Most of the CMSs we looked at now offer some of that. What separates them is what happens to a change after the AI has made it.
published: "2026-11-25"
updated: "2026-11-27"
checked: November 2026
order: 2
draft: false
short:
  - An AI CMS lets you change content by asking, not only by filling in fields. In November 2026 most of the large hosted CMSs sell some form of it.
  - "The features come in roughly four kinds: writing help inside the editor, actions that change content in bulk, agents that carry out tasks you describe, and MCP servers that let outside AI tools such as Claude or Cursor in."
  - "The question that matters is what happens next. Does the change wait for a person? Can that person see exactly what changed, beside the page? Can one change be undone? Who keeps the record?"
  - We think the safe design is simple. The AI writes, and a person checks and presses Publish. Galley's built-in assistant is built that way, and Galley is ours, so weigh the opinion accordingly.
faq:
  - q: What is an AI CMS?
    a: A content management system that lets you change a site by asking in plain words, as well as by filling in fields. It may draft or translate text, change many entries at once, carry out tasks you describe, or let outside AI tools connect to it. What matters most is whether its changes wait for a person to check and publish them.
  - q: Which CMS works best with Claude?
    a: "Two ways to read the question. Several CMSs offer an MCP server that Claude Desktop or Claude Code can connect to, among them Sanity, Contentful, Storyblok, Strapi, Prismic and Hygraph, and WordPress through a plugin. Contentful lists Claude among the models for its AI Actions. Galley's built-in assistant runs on Claude itself (with your own Anthropic key when self-hosted, or included monthly AI credits on [Galley Cloud](/cloud/)), and its MCP server lets Claude Desktop or Claude Code work on the site's files, with their changes waiting in the same proof; those tools can publish too (their instructions say only when you ask, and Galley doesn't check that you did), unless publishing over MCP is switched off."
  - q: Can an AI assistant safely edit a live website?
    a: "We think it can if it is unable to publish. The assistant should change content, not code, and every change should wait where a person can see it beside the live page before anything goes out. In Galley the assistant never publishes: its changes wait in Proof until someone presses Publish, and each one can be put back."
  - q: How do I connect a CMS to an AI agent?
    a: Through MCP, the Model Context Protocol, an open standard many AI tools use to talk to other software. A CMS that offers an MCP server lets an AI client read and change its content. Check what the server can do on its own, such as publish, and whether its changes land somewhere a person reviews first.
  - q: Is a headless CMS better for AI search?
    a: "The kind of CMS matters less than what each page serves: readable text in the HTML, accurate structured data, and, on some sites, a plain markdown copy for AI tools, though Google says its AI features don't need one. Any kind of CMS can produce those. No CMS can promise that an AI answer will cite you."
  - q: Do I need my own AI key?
    a: "It depends on the product. Some include AI use in a plan or sell credits; others use a key you bring. When you run Galley locally or self-host it, the assistant and AI translation use your own Anthropic key and image or video generation uses your own OpenAI, Google Gemini or OpenRouter key; everything else works without a key. On [Galley Cloud](/cloud/) (opening by invitation), monthly AI credits are included on every plan with no API keys to paste."
sources:
  - label: "Sanity documentation, AI in Sanity"
    href: https://www.sanity.io/docs/ai
  - label: "Sanity, pricing"
    href: https://www.sanity.io/pricing
  - label: "Contentful, pricing"
    href: https://www.contentful.com/pricing/
  - label: "Contentful, AI"
    href: https://www.contentful.com/products/ai/
  - label: "Storyblok, AI Suite"
    href: https://www.storyblok.com/lp/ai-suite
  - label: "Strapi, Strapi AI"
    href: https://strapi.io/ai
  - label: "WordPress 7.0 release post"
    href: https://wordpress.org/news/2026/05/armstrong/
  - label: "Hygraph documentation, Hygraph AI"
    href: https://hygraph.com/docs/hygraph-ai
  - label: "Prismic, MCP"
    href: https://prismic.io/features/mcp
  - label: "CloudCannon, AI-ready CMS"
    href: https://cloudcannon.com/ai-llm-cms/
  - label: "TinaCMS, pricing"
    href: https://tina.io/pricing
  - label: "Model Context Protocol"
    href: https://modelcontextprotocol.io/
  - label: "Storyblok, pricing"
    href: https://www.storyblok.com/pricing
  - label: "Sanity, AI Assist"
    href: https://www.sanity.io/ai-assist
  - label: "Sanity documentation, Agent Actions"
    href: https://www.sanity.io/docs/agent-actions
  - label: "Sanity documentation, Content Agent"
    href: https://www.sanity.io/docs/content-agent/introduction
  - label: "Contentful, changelog"
    href: https://www.contentful.com/developers/changelog/
  - label: "Contentful, the Content Operations Agent"
    href: https://www.contentful.com/help/ai-automations/content-operations-agent/
  - label: "Hygraph documentation, the MCP server"
    href: https://hygraph.com/docs/hygraph-ai/mcp-server
  - label: "Google Search Central, AI features and your website"
    href: https://developers.google.com/search/docs/appearance/ai-features
  - label: "Galley, ask the assistant"
    href: /docs/editing/assistant/
  - label: "Galley, never guess"
    href: /docs/concepts/never-guess/
  - label: "Galley Cloud"
    href: /cloud/
  - label: "Galley for enterprise and security teams"
    href: /enterprise/
related: [types-of-cms, cloudcannon, git-based-cms]
---

## What is an AI CMS?

An AI CMS is a content management system that lets you change a site by asking in plain words, as well as by filling in fields. "Make the pricing page shorter." "Translate the team page into German." "Add alt text to every image that hasn't got any." The CMS turns the request into changes to the content.

That much is now ordinary. The interesting part is what the CMS does with the change once the AI has made it.

## What do CMSs mean by AI today?

Read the product pages in November 2026 and the features fall into four kinds.

**Writing help inside the editor.** A button or a side panel that drafts, rewrites, translates or summarises the field you're in. Sanity's AI Assist is one: it is a plugin for its Studio, on the Growth plan and up, and does translation, image descriptions and SEO tasks among other things. Hygraph says its AI Assist is "available out of the box on all Hygraph plans". WordPress 7.0, released in May 2026, added "a new AI Client in Core", with a plugin to "generate and edit images, create titles or excerpts, or even suggest alt text."

**Actions that change content in bulk.** The same kinds of task, run on many entries at once or from code. Contentful's AI Actions (translation, rewriting, alt text, SEO metadata and more) are, in its words as of November 2026, "available on any Enterprise plan". Sanity's Agent Actions run "anywhere you can run code" and are paid for in AI credits on every plan. Storyblok meters its AI in credits: as of November 2026 its free Starter plan includes 25,000 AI credits and AI translations, AI alt text starts on Growth and AI SEO on Premium.

**Agents that carry out a task you describe.** A chat that can read across the content and make the changes. Sanity calls its one Content Agent. Contentful made its Content Operations Agent generally available on 9 November 2026; ask Contentful which plans include it.

**Doors for outside AI tools.** An MCP server lets an AI client you already use, such as Claude Desktop, Claude Code or Cursor, read and change the CMS's content. Sanity, Contentful, Storyblok, Strapi, Prismic and Hygraph each offer one, Payload has an MCP plugin, and WordPress has an MCP Adapter plugin. CloudCannon takes the same idea further in its own way: its content is files in Git, so it invites you to bring "Cursor, Claude Code, GitHub Copilot, a locally hosted model, or something you built yourself".

Some products are still on the way: as of November 2026 TinaCMS lists its AI features as "coming soon" on its pricing page. Others don't fit the four kinds neatly, such as AI that drafts a content model (Strapi AI) or content served to your own agents (Sanity Context). So the question is rarely whether a CMS has AI. It's how the AI's changes are handled.

## What can go wrong when an AI edits a website?

Nothing exotic. The same things that go wrong when a person edits it, faster and at a larger scale.

- **A change goes live that nobody read.** An AI that can publish will, sooner or later, publish something wrong: a price, a date, a name, a claim the company can't stand behind.
- **It changes more than you asked.** You asked for a shorter heading and it also reworded the paragraph under it. If nobody can see the whole difference, nobody catches it.
- **It invents something.** A model asked for a figure it doesn't have may supply one. Instructions not to are instructions, not guarantees.
- **The record isn't yours.** If the history of who changed what lives inside a vendor's system, it goes where the vendor goes.
- **It can't be taken back cleanly.** Undoing one bad change shouldn't mean restoring a backup of everything.

## What should an AI CMS never do?

Publish by itself. That's our view, and the rest follows from it.

Typing a change is now close to free. What is left is the checking, and the checking is the part worth designing. A model can be told to behave. It can't be trusted to have behaved. So the change should wait where a person can see it, in the page's own words and beside the live page, and only that person should be able to send it out.

Several products are arriving at the same place in their own ways. Prismic says of its MCP server: "Everything saves to a release, so nothing goes live without you." Sanity says of its Content Agent: "Publishing is always a separate step that you take yourself, so a human stays in the loop for final review." Contentful's agent "never publishes, archives, or changes a content type without your explicit approval first." Hygraph's docs say agent runs started over MCP land in draft: "MCP does not publish agent output." Strapi says "AI and agent changes go through the approval stages you already use" (Review Workflows are on its Enterprise plan). CloudCannon has outside agents "propose changes on a branch" that go through "the same review as any other pull request." The details differ. Most of these products' MCP servers can also publish when asked, as Galley's can unless that is switched off. The principle, a person between the AI and the live site, is the one to look for.

## Four questions to ask of any AI CMS

**Can the AI make a change live without a person?** We think the right answer is no. If the answer is "only when it's confident", ask who measures the confidence.

**Can a non-developer see exactly what changed?** Before and after, in words, next to the live page. A summary written by the same model that made the change doesn't count.

**Can you undo one change, and do you own the record?** One change, not a whole restore. And a history you can't take with you is a history the vendor keeps.

**What is sent to the model, and who pays for it?** Some products include AI use in a plan, some sell credits, some use a key you bring. Know which, and know what of your content goes with each request.

## How does Galley do it?

Galley is our open-source AI CMS for static sites, Apache-2.0 and free to run locally or self-host — with optional managed hosting on [Galley Cloud](/cloud/) (opening by invitation) — first released in November 2026. It's built around the answer above.

- **The assistant writes; a person publishes.** You ask in plain words, beside the page. The assistant reads the site before it edits, asks one short question when a request is ambiguous, and quotes the new words back. Its documentation is blunt: "It never publishes." You can also generate images and short video clips across OpenAI, Google Gemini and OpenRouter models.
- **Every change waits in Proof.** Old words struck out, new ones written in, beside the live site, whether the change came from the assistant, the form, retyping on the page or translation. Any one change can be put back. Nothing the assistant does is live until someone presses [Publish](/how-to/proof-and-publish/).
- **The record is yours.** Publishing is a commit to your own Git repository, or a branch and a pull request. Undo is a new commit. History is never rewritten.
- **Content, not code.** In content mode the assistant can change only content and media, and it has no shell or network tool. Build mode, which can change code, is for whoever maintains the site, and a site's settings can turn it off. It's told not to invent figures, prices or quotes, and the docs call those rules "instructions to a model, not guarantees", which is why the proof exists.
- **Multilingual (`i18n`) translation with Proof.** Configure target languages, localized URL slugs, `hreflang` alternates and Astro `<LanguageSelector />` / `<LocaleHead />` components; translate side by side (with out-of-sync flags when the source changes) or translate individual pages or the whole site with AI using a Git-tracked Translation Memory (reusing approved phrases at zero cost), a brand/product Glossary and a clear upfront cost estimate before anything runs — every translated page waiting in Proof.
- **Built-in Search and AI intelligence.** On-site SEO and structured-data checks, one-click fixes into Proof, Markdown twins, `llms.txt` and per-AI-crawler `robots.txt` controls, plus live Google search rankings, striking-distance (`#4–#15`) quick wins, keyword research, competitor content gaps, broken-404 backlink recovery with one-click redirects, and AI search answer citations — included on every [Galley Cloud](/cloud/) plan (at zero AI credits for lookups) or self-hosted with your own search data key.
- **Your own AI tools, too.** Galley's [MCP server](/docs/integrations/mcp/) gives Claude Desktop, Claude Code, Cursor, VS Code or any MCP client the assistant's tools for reading and changing the site, and their changes wait in the same proof. Unlike the assistant, such a tool can also publish (its instructions say only when you ask) unless publishing over MCP is switched off. By our own rule above, switch it off (`--no-publish`, or `GALLEY_MCP_PUBLISH=0` on a server) if no AI should publish.

Where it falls short: on local or self-hosted installs, the assistant and AI translation run on Anthropic's Claude with your own key (billed to you), while [Galley Cloud](/cloud/) includes monthly AI credits on every plan and is opening by invitation. Galley is young (first released November 2026), its page builder is in preview, and self-hosted accounts and OpenID Connect SSO are new and in final checks (roles organize work while the container is the security boundary; see [`/enterprise/`](/enterprise/)). It has no scheduled publishing, no multi-stage per-locale approval chains or external TMS integrations (where Contentful, Storyblok, Sanity and Hygraph still lead for large localization teams), and no SOC 2 report or SLA yet. And it suits websites, not content that has to reach apps through an API. For that, see [the three kinds of CMS](/compare/types-of-cms/).

The machine can do the typing. Keep the button.
