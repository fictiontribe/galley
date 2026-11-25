---
title: "Galley vs Keystatic: two open-source CMSs compared"
description: Keystatic and Galley both edit the content files in your codebase, for free. How setup, editing, AI, hosting and teams differ, and when to pick Keystatic.
kind: versus
product: Keystatic
heading: Keystatic and Galley agree that content is files. Keystatic has you describe them in TypeScript; Galley reads them.
name: Galley and Keystatic
lead: Both are free and open source, and both edit the Markdown, YAML and JSON in your codebase. Keystatic, a Thinkmill project, has developers describe the content in TypeScript, and its pages describe no AI features. Galley is new, needs no config file to start, and builds in an assistant and a check before anything goes live.
published: "2026-11-25"
checked: November 2026
order: 9
draft: false
short:
  - "Both keep your content as plain files in your codebase, with no database: Keystatic in YAML, JSON, Markdoc or MDX, Galley in Markdown, MDX, JSON or YAML. Leaving either needs no content migration, unless you keep images in Keystatic Cloud."
  - Both are free and open source, Keystatic under MIT and Galley under Apache-2.0. Keystatic Cloud, an optional service for signing in (and, on Pro, images), is free for up to three users per team, and its Pro plan starts at $10 a month (as of November 2026). With Galley you pay for your own AI key and hosting.
  - Keystatic asks a developer for a `keystatic.config.ts` that defines the content in TypeScript, and for admin routes in the site, which need a host that runs Node.js if people edit online. Galley reads the site's framework, collections and fields as they already are.
  - We found no AI feature and no MCP server in Keystatic (November 2026). Galley builds an assistant into the editor that never publishes, holds every change it makes in a proof beside the live site, and lets other AI tools in over MCP, where they can publish unless that is switched off.
  - Choose Keystatic if your developers want a typed content model, rich text with their own components, and editors who sign in through Keystatic Cloud without GitHub accounts. Its paid plan adds real-time co-editing, marked experimental. Keystatic has been public since 2023; Galley was first released in November 2026.
table:
  heading: Galley and Keystatic, side by side.
  text: Where Keystatic does more, the table says so.
  caption: Galley compared with Keystatic
  columns: [What differs, Galley, Keystatic]
  rows:
    - label: Your content
      ours: Files in your Git repository
      theirs: Files on your computer, or in a GitHub repository
      better: even
    - label: Price
      ours: Free, Apache-2.0. Your AI key and hosting
      theirs: Free, MIT; Cloud free for 3 users, Pro from $10 a month (Nov 2026)
      better: even
    - label: Setup
      ours: Reads the site as it is
      theirs: A TypeScript config (npm create starts it), plus admin routes
      better: ours
    - label: Content model
      ours: Worked out from the site's schemas and files
      theirs: In TypeScript, with types for your components
      better: theirs
    - label: Editing
      ours: A form, the page itself, or the assistant
      theirs: Forms, and rich text with your own components
      better: even
    - label: AI
      ours: An assistant that never publishes; MCP for other AI tools
      theirs: None found (Nov 2026)
      better: ours
    - label: Checking a change
      ours: Each change in the site's words, beside the live site
      theirs: Pull requests; a Next.js preview recipe
      better: ours
    - label: Editing online
      ours: A hosted editor on your own server (new)
      theirs: The admin in your site, on a Node.js host
      better: theirs
    - label: Git hosts
      ours: Whichever host you push to
      theirs: GitHub only (local mode just writes files)
      better: ours
    - label: Teams
      ours: Three roles on a hosted editor (new); they organise work, not security
      theirs: GitHub write access, or Keystatic Cloud teams
      better: even
    - label: Two people at once
      ours: One shared copy; a clashing save is refused
      theirs: Real-time co-editing on Cloud Pro (experimental)
      better: theirs
    - label: Maturity
      ours: First released November 2026
      theirs: Public since 2023; still 0.x
      better: theirs
faq:
  - q: Is Galley an alternative to Keystatic?
    a: For many static sites, yes. Both are free and open source, keep content as files in your repository and need no database. Galley reads the site without a config file, lets people edit on the page, and has an assistant and a proof built in. Keystatic gives developers a typed content model in TypeScript, rich-text components and, through Keystatic Cloud, sign-in for editors without GitHub accounts.
  - q: Is Keystatic free?
    a: "Yes. Keystatic itself is MIT-licensed and costs nothing. Keystatic Cloud, an optional service for signing in (and, on Pro, images), is free for up to three users per team. As of November 2026 its docs say Pro \"starts at $10/month\", and each user beyond three costs $5 a month. They name no currency and no yearly price. Galley is free too; its assistant uses your own Anthropic key."
  - q: Does Keystatic need a server?
    a: To edit on the deployed site, yes. The Admin UI at /keystatic and its API at /api/keystatic are server code, so the host must run Node.js, and an Astro site needs an adapter. In local mode you can edit on your computer and keep those routes off the live site. Galley adds no dependency or integration to the site; its editor runs on your computer or your own server (new).
  - q: Does Keystatic have AI features?
    a: Not that we found, as of November 2026. Its home page, documentation, blog and GitHub README describe no AI feature and no MCP server, and keystatic.com has no llms.txt. Because the content is plain files, a coding agent can still edit them like any other file in a repository. Galley has an assistant in the editor that never publishes, and an MCP server for other AI tools.
  - q: Can two people edit the same page at once?
    a: "In Keystatic, on Keystatic Cloud's paid Pro plan, whose docs list \"Multi-player editing (experimental)\" to \"collaborate with other editors in real-time on the same document.\" Galley has no real-time editing together. Everyone on one hosted editor works on one shared copy of the site, each publish carries the name of whoever pressed Publish, and a second save of a page someone has just changed is refused."
  - q: How is Keystatic different from TinaCMS?
    a: "Both are open source, keep content as files in your repository and model it in a config file in code (`keystatic.config.ts`, `tina/config.ts`). TinaCMS calls itself \"Git-backed headless\": it gives the site \"a queryable content API\", and offers visual editing on React sites. A Keystatic site reads the files through its server-side Reader API or the framework's own loader. Galley differs from both: there's no config file to write first."
sources:
  - label: "Keystatic, home page"
    href: https://keystatic.com/
  - label: "Keystatic documentation, quick start"
    href: https://keystatic.com/docs/quick-start
  - label: "Keystatic documentation, configuration"
    href: https://keystatic.com/docs/configuration
  - label: "Keystatic documentation, local mode"
    href: https://keystatic.com/docs/local-mode
  - label: "Keystatic documentation, GitHub mode"
    href: https://keystatic.com/docs/github-mode
  - label: "Keystatic documentation, Keystatic Cloud"
    href: https://keystatic.com/docs/cloud
  - label: "Keystatic documentation, format options"
    href: https://keystatic.com/docs/format-options
  - label: "Keystatic documentation, Reader API"
    href: https://keystatic.com/docs/reader-api
  - label: "Keystatic documentation, adding Keystatic to an Astro project"
    href: https://keystatic.com/docs/installation-astro
  - label: "Keystatic documentation, adding Keystatic to a Next.js project"
    href: https://keystatic.com/docs/installation-next-js
  - label: "Keystatic documentation, adding Keystatic to a Remix project"
    href: https://keystatic.com/docs/installation-remix
  - label: "Keystatic documentation, the Markdoc field"
    href: https://keystatic.com/docs/fields/markdoc
  - label: "Keystatic documentation, content components"
    href: https://keystatic.com/docs/content-components
  - label: "Keystatic documentation, entry layout"
    href: https://keystatic.com/docs/entry-layout
  - label: "Keystatic documentation, the Cloud Image field"
    href: https://keystatic.com/docs/fields/cloud-image
  - label: "Keystatic documentation, real-time previews with Next.js draft mode"
    href: https://keystatic.com/docs/recipes/real-time-previews
  - label: "Keystatic documentation, disabling the Admin UI in production on Astro"
    href: https://keystatic.com/docs/recipes/astro-disable-admin-ui-in-production
  - label: "Keystatic, blog"
    href: https://keystatic.com/blog
  - label: "Keystatic on GitHub"
    href: https://github.com/Thinkmill/keystatic
  - label: "Keystatic changelog, on GitHub"
    href: https://github.com/Thinkmill/keystatic/blob/main/packages/keystatic/CHANGELOG.md
  - label: "Keystatic on npm"
    href: https://www.npmjs.com/package/@keystatic/core
  - label: "TinaCMS documentation"
    href: https://tina.io/docs
  - label: "Galley, the FAQ for developers"
    href: /docs/project/faq/
  - label: "Galley over MCP"
    href: /docs/integrations/mcp/
  - label: "Galley, running a hosted editor"
    href: /docs/running/hosted/
  - label: "Galley, the tour: what is built and what isn't yet"
    href: /tour/
related: [cloudcannon, types-of-cms, /ai-first/]
---

## What do Galley and Keystatic have in common?

More than either has in common with WordPress or [a headless CMS](/compare/types-of-cms/). Keystatic's home page calls it "Content Management for your Codebase", and explains: "A tool that makes Markdown, JSON and YAML content in your codebase editable by humans." Galley works from the same idea. The words of the site are files beside its code, and there's no database.

Keystatic keeps each entry in YAML by default, or JSON, with long text in a Markdoc or MDX file. Its `local` mode works on the files on your computer and `github` mode on a GitHub repository. `cloud` mode uses a GitHub repository too, with Keystatic Cloud handling the sign-in. Galley edits Markdown, MDX, JSON and YAML files where they are, in your Git repository.

Both are free and open source. Keystatic is MIT-licensed, and its home page says "Keystatic is a Thinkmill project", made in Australia. Galley is Apache-2.0, and we make it.

So the choice isn't about where your content lives. It comes down to setup, what editors see, where the AI sits, where the editor runs, and the size of your team.

## How much does each cost?

Keystatic is free and MIT-licensed, and its local mode needs no account at all. Keystatic Cloud is an optional service on top. As of November 2026, its documentation describes two plans:

| Plan | Price | Users per team | What it adds |
| --- | --- | --- | --- |
| Free | Free | Up to 3 | Sign-in handled by Keystatic Cloud |
| Pro | From $10 a month | More than 3, at $5 a month for each one beyond 3 | Multi-player editing (experimental), Cloud Images |

The figures are from the [Keystatic Cloud page of its documentation](https://keystatic.com/docs/cloud); neither keystatic.com nor keystatic.cloud has a pricing page. The page names no currency, only a dollar sign, and doesn't say whether the $10 covers the first three users or whether there's a yearly price. A Pro plan applies to one team. Check the page before you decide.

Galley is free too: Apache-2.0, one edition, no paid tier today. The assistant runs on Anthropic's Claude with your own key, and each request is billed to whoever owns that key. Hosting is yours to arrange, and here the two differ: a Keystatic site that people edit online needs a host that runs Node.js, while a Galley site can stay plain built files.

## What does a developer have to set up?

Keystatic starts from code. `npm create @keystatic@latest` "creates a new project (Next.js, Astro or Remix), integrated with Keystatic." An existing project installs `@keystatic/core` and a package for its framework. Astro also needs its React and Markdoc integrations; Next.js needs three files for the Admin UI and an API route; Remix, two route files and a bundling setting.

Then the config. "Every Keystatic project expects an exported config", in `keystatic.config.ts` at the root. There you choose the storage and define, in TypeScript, the collections, the singletons ("one-off content structures, such as a settings or a contact page") and every field, from 27 field types in the docs. GitHub mode adds a GitHub App, which the setup walks you through creating, and environment variables to copy to the deployed site. Keystatic Cloud skips that: "No need to deal with environment variables and a custom GitHub app."

We think the typed config is what many developers like best about Keystatic, and with reason. The content model is code, reviewed and versioned with the rest, and the Reader API exports an `Entry` type, so a component can declare the props it expects.

Galley starts by reading the site. It works out the framework, the collections and every field's type from the site's own schemas and files, without running its code. Astro fits deepest. Docusaurus, Nuxt, Next.js, SvelteKit, Eleventy, Hugo and Jekyll are recognised by their conventions; Remix isn't. A `galley.config.json` file only corrects what Galley found. Galley doesn't use `keystatic.config.ts`.

The caveat on our side: detection is only as good as the site is tidy. A site whose words sit in content files, with schemas, gets a good form with no work. One whose copy is hard-coded in components gets less. With Keystatic, someone writes the model down, so nothing is guessed.

## What do editors see?

Keystatic's Admin UI is a set of forms, with every field stacked in one column by default, or the main text given most of the screen and the other fields moved to a sidebar. Markdoc and MDX fields get a rich-text editor (the docs call it WYSIWYG) with content components, "rich-text building blocks" of five kinds. A developer defines, say, a testimonial with fields for its author and role, and an editor adds one from a dropdown in the editor. We think this is Keystatic's best editing feature. We found no editing on the page, and no visual editor, in its docs.

Galley gives editors three ways in: a form made from the site's content model, the page itself, or the assistant. On the page you click the words in the preview and retype them, and when the same words come from two places, Galley asks which one you meant. All three end in the same proof.

Keystatic gives editors more where rich text is full of components. In MDX, Galley edits the Markdown between components and treats a component's props as code. Markdoc isn't among the formats Galley's documentation lists, so if your pages are `.mdoc` files, try Galley on a copy first.

## How does each one use AI?

As of November 2026 we found no AI feature and no MCP server in Keystatic. We looked at its home page, its documentation, its blog (one post, from June 2023) and its GitHub README, and keystatic.com/llms.txt gives a "Page not found" error. That doesn't stop you using AI: a coding agent can change plain files like any other file in the repository. Keystatic just doesn't build anything for it.

Galley puts the assistant inside the editor, beside the page. You ask in plain words, it reads the site before it edits, it asks one short question when a request is ambiguous, and it quotes the new words back. In content mode it can touch only content and media, and it has no shell or network tool. It never publishes: every change it makes waits in the proof, and a person presses Publish. For people who'd rather use their own AI tool, Galley's [MCP server](/docs/integrations/mcp/) gives Claude Desktop, Claude Code, Cursor, VS Code or any MCP client the assistant's tools for reading and changing the site, and their changes wait in the same proof. Unlike the assistant, such a tool can also publish (its instructions say only when you ask) unless publishing over MCP is switched off.

We think that is where AI in a CMS should sit: close to the person who knows what the page should say, with a check that a non-developer can read. If developers make most of the changes on your site, leaving AI to the tools they already use, as Keystatic does, is a fair choice.

## How do you check a change before it goes live?

In Keystatic's local mode a save writes the file on your computer, and you check it as you'd check any change to the code. In GitHub mode the Admin UI has a branch dropdown, so an editor can work on a branch, and since version 0.6.6 its changelog lists support for "GitHub rulesets to automatically create a branch when pull requests are required". Its docs describe the usual next step: "You typically need to open a PR and wait for deploy previews." A [recipe](https://keystatic.com/docs/recipes/real-time-previews) gives faster previews with Next.js's draft mode, in GitHub or Cloud mode. We found none for Astro or Remix.

In Galley every change, whether typed in the form, retyped on the page or made by the assistant, lands in [Proof](/how-to/proof-and-publish/): the change in the site's own words, old text struck out and new text written in, beside the live site. Any single change can be put back. Publishing is a commit to your repository, or a branch and a pull request if the site is set up for review. Undo is a new commit, and history is never rewritten.

The difference is what the reviewer sees. With Keystatic, it's a preview if a developer has built one, and the pull request's line-by-line difference on GitHub. With Galley, it's what changed on the page, in the site's own words.

## How does the site get its content?

Keystatic offers a reader of its own. "The Reader API is a Node.js API that lets you read Keystatic content from a storage of your own choice", a local folder or, with a personal access token, a GitHub repository. "The reader API code is meant to run on the server, and not in the browser." You don't have to use it: Keystatic's Astro guide reads the files with Astro's own content collections. Either way, rendering is the site's job: "you are responsible for rendering the Markdoc content."

The editor lives inside your site, at `/keystatic`, with its API at `/api/keystatic`, and that is server code. The Astro guide says "Because Keystatic needs to run serverside code and use Node.js APIs, you will need to add an Astro adapter to deploy your project", and the Next.js guide asks for a host that supports Node.js. In local mode you can keep the admin off the live site, as two recipes from its community show, and edit on a developer's computer.

Galley adds nothing to the site to edit it: no dependency, integration or build plugin. Publishing is a commit, and your host builds from there. The editor runs on your computer, or as a [hosted editor](/docs/running/hosted/) on your own server with Docker, which is new and still in final checks. The live site stays built files, with no login on it.

## Which one suits a team?

In Keystatic's GitHub mode, "Collaborators will need `write` access to this repository", and anyone with that access can sign in at `/keystatic`. Keystatic Cloud uses teams instead: "User access is set at the team level, so every user in team will have access to all projects within that team." Its editors need no GitHub account, which we think is one of Keystatic's best features. The free plan takes three users per team; Pro charges $5 a month for each one beyond that, and adds "Multi-player editing (experimental)", to "collaborate with other editors in real-time on the same document." As of November 2026 we found no roles, approval step, scheduled publishing or single sign-on in its docs.

Galley has roles where Keystatic's docs describe none, but they are new, and Galley has no scheduled publishing either. Used on your own computer, Galley has no accounts: anyone who can open the app can publish, so the gate is pull-request mode and your code host's branch protection. A hosted editor, one site per install on a server you run, adds accounts with three roles (owner, editor and contributor). People sign in with an e-mail and a password, and each publish carries its author's name. The roles keep people out of each other's way; they aren't a security boundary. That hosted editor is new and still in final checks, and single sign-on is planned for later. Everyone on it works on one shared copy of the site; a second save of a page someone has just changed is refused, not written over it.

## Where does Galley fall short?

- **It's young.** Version {version} of software first released in November 2026. Keystatic has been public since 2023, and its latest release, 0.6.10, came out on 17 November 2026. It is still at 0.x, and its README says "Things are experimental at the moment."
- **No editing together in real time.** Keystatic Cloud Pro offers it, marked experimental.
- **Rich text with components.** Keystatic edits Markdoc and MDX components in its editor. Galley treats the props of MDX components as code, and doesn't list Markdoc among its formats.
- **Editing online is new.** Keystatic's admin goes online with the site, on a host that runs Node.js. Galley's hosted editor needs Docker on a server you run.
- **Remix isn't among Galley's frameworks.** Keystatic has a package for it.
- **The assistant needs a key, and it's billed to you.** Everything except chat and image generation works without one.

## When is Keystatic the better choice?

When your developers want the content model in code, typed and reviewed in pull requests, and want their own code to read the content too, through its Reader API. When rich text is full of components, such as a testimonial with its author and role, that editors should fill in without touching markup. When editors who aren't on GitHub need to sign in and nobody wants to set up a GitHub App: Keystatic Cloud does it, free for up to three people per team. When you want to try typing together in real time, on Pro, knowing it's experimental. When images should live in a hosted service: Cloud Images, also on Pro, let you "upload, transform and serve optimized images without cluttering your GitHub repository." When the site is built with Remix. And when you'd rather adopt a tool with releases going back to 2023.

Galley fits when the people who change the site aren't developers, and you want them to ask for a change, see exactly what changed and publish it, with little setup for the CMS. It also fits when the site should stay plain built files, when your repository isn't on GitHub, and when the site uses Hugo, Eleventy, Jekyll or another framework Keystatic has no guide for.

## Can you move from one to the other?

Yes, and easily, because the content never leaves the repository. To try Galley on a Keystatic site, run `npx galley-cms` in the site's folder, or open the repository in the desktop app. Keystatic's config and routes can stay while you try. Galley has no importer for Keystatic, and needs none. Its only guided move is from [WordPress](/wordpress/), and that is new and still in final checks.

If you then leave Keystatic, remove its integration or route files and its config. Replace any Reader API calls with your framework's own way of reading files, as the Astro guide already does. If you used Cloud Images, that field "stores a reference to the image in the cloud", so bring those images into the repository first.

Going the other way, Galley leaves little behind: an optional `galley.config.json`, and its forms and consent banner if you added its site kit. You'd write a `keystatic.config.ts` for the content you have.

## Three questions to ask before you choose

**Who describes the content, and who keeps that description in step with the site?** A typed config is precise. It is also one more file to change with each new field.

**When an AI makes a change, who sees it before it is live, and in what form?** A pull request reads well to a developer. Ask what the marketer sees.

**Where will editors work, and what does that need?** A Node.js host for the admin, a GitHub account or a Keystatic Cloud seat, or an app on their own computer. Know which before you need it.
