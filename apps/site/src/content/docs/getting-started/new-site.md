---
title: Create a new site
description: One command copies a starter — Caddow, Ferrow, Lowfield Studio or Sarking — into a folder of its own and opens it in Galley, ready to edit.
group: getting-started
order: 2
---

Start here if you don't have a site yet. You'll get a complete Astro site, made from one of Galley's starters, open in your browser and ready to edit.

You need [Node.js](https://nodejs.org) 22.23.4 or newer and git.

## Create it

Run this in a terminal:

```sh
{install.create}
```

It asks what to call the site and which starter to use, then makes the folder, installs the site, records its first version and opens it in Galley.

To skip the questions, give the folder and the starter:

```sh
{install.createStarter folder=my-site starter=caddow}
```

```output
Making “My site” from Caddow in my-site
✓ Copied the starter
…
{install.running}
```

With pnpm, Yarn or Bun it is `pnpm create galley my-site --starter caddow` (or `yarn create galley`, `bun create galley`), and the site is installed with that one. Only the npm form was tried for these pages.

Your browser opens on the new site. Leave the terminal open: Galley runs until you press **Ctrl+C**.

## Choose a starter

- **Caddow** (`caddow`) — a fashion label: full-screen photographs, lookbooks, a journal.
- **Ferrow** (`ferrow`) — a software company: product pages, pricing, customer stories, a blog.
- **Lowfield Studio** (`lowfield`) — a small studio or local business: services, about, contact, a journal.
- **Sarking** (`sarking`) — a blog for long-form writing with charts, comparison tables, verdicts and timelines in plain Markdown.

Put its short name after `--starter`. Without one, it asks (Lowfield is the default).

Each one has three looks to choose from. The people and companies in them are made up, and so are the photographs. More: [Starters](/docs/astro/starters/).

## If something's different

- **"There's no starter called …"** Use one of the names the message lists.
- **The folder already exists.** Choose another name.
- **The browser didn't open.** Open the address the terminal printed, with the `token=` part.
- **Want another folder or look?** Every option is in [Command line](/docs/reference/cli/#galley-new).

## Next

1. [Change a page](/docs/editing/form/).
2. [Connect the assistant](/docs/getting-started/assistant/), to ask for changes in words.
3. [Put the site online](/docs/editing/online/).
