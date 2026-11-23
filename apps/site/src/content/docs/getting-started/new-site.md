---
title: Create a new site
description: One command copies a starter — Caddow, Ferrow or Lowfield Studio — into a folder of its own and opens it in Galley, ready to edit.
group: getting-started
order: 2
---

Start here if you don't have a site yet. You'll get a complete Astro site, made from one of Galley's starters, open in your browser and ready to edit.

You need [Node.js](https://nodejs.org) 22.23.4 or newer and git.

## Create it

<!-- if install.published -->
Run this in a terminal:

```sh
{install.createStarter folder=my-site starter=caddow}
```

It makes a folder called `my-site` with the Caddow starter in it, and opens it in Galley.
<!-- else -->
Galley isn't on npm yet, so today you run it from a copy of its code.

1. Get Galley. This takes a few minutes, once:

   ```sh
   {install.fromClone take=5}
   ```

2. Create the site:

   ```sh
   node packages/cli/bin/galley.js new my-site --starter caddow --dir ~/sites
   ```

   ```output
   Making “My site” from Caddow in /Users/you/sites/my-site
   …
   {install.running}
   ```

That makes `~/sites/my-site` with the Caddow starter in it. When Galley is on npm, this becomes one command.
<!-- end -->

Your browser opens on the new site. Leave the terminal open: Galley runs until you press **Ctrl+C**.

## Choose a starter

- **Caddow** (`caddow`) — a fashion label: full-screen photographs, lookbooks, a journal.
- **Ferrow** (`ferrow`) — a software company: product pages, pricing, customer stories, a blog.
- **Lowfield Studio** (`lowfield`) — a small studio or local business: services, about, contact, a journal.

Put its short name after `--starter`. Without one you get Lowfield.

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
