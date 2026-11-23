---
title: "Quickstart: Galley on your Astro site"
navTitle: Quickstart
description: Open your Astro site in Galley, change a page, check it in Proof and publish it. About ten minutes.
group: getting-started
order: 1
---

Start here if you look after an Astro site. In ten minutes you'll change a page, check the change, and publish it to the site's own git repository.

No site yet? [Create a new site](/docs/getting-started/new-site/) instead.

## What you need

- An Astro site in a git repository.
- [Node.js](https://nodejs.org) 20.11 or newer — and whatever your site needs (Astro 7 needs 22.23.4) — and git.
- Optional: an Anthropic API key, for the assistant.

Galley adds nothing to your site: no dependency, no integration, no build step.

## Open your site

<!-- if install.published -->
In your site's folder, run:

```sh
{install.run}
```
<!-- else -->
Galley isn't on npm yet, so today you run it from a copy of its code. Replace `~/sites/your-site` with your site's folder:

```sh
{install.fromClone}
```

The first five commands get Galley, once; the last one opens your site.
<!-- end -->

```output
{install.running}
…
```

Your browser opens on the site. Galley runs on your computer only, until you press **Ctrl+C**.

## Change a page

1. Open **Pages** in the sidebar and choose a page.
2. Change it any of three ways: type in the form on the left, choose **Click to edit** and retype words on the page, or ask the assistant on the right.
3. The change is saved as you type. Nothing is live yet.

## Check it

Press **Proof** in the top bar. Each change is listed in the site's own words — the old words struck through, the new ones written in. **Put back** undoes one.

## Publish it

Press **Publish**, then **Publish 1 change**. Galley commits the changed file as you, and pushes when the repository has a remote. To see the commit:

```sh
git log -1 --stat
```

```output
…
    Update Caddow — coats and knitwear, made in runs of forty
…
 src/content/pages/index.md | 2 +-
```

Undoing a publish later is a new commit, never a rewrite.

## If something's different

- **Galley says the folder doesn't look like a site.** Point it at the folder with `package.json` in it.
- **Port 4400 is taken.** Galley uses the next free one and says so.
- **The preview stays blank.** Your site's own `astro dev` must work first; run `galley doctor` in its folder to see what Galley finds.
- **You want the command as `galley`.** Other pages write it that way. From a clone, run this inside the `galley` folder, for this terminal:

  ```sh
  alias galley="node $PWD/packages/cli/bin/galley.js"
  ```

## Next

1. [How Galley reads your site](/docs/astro/content-collections/) — and what it can't read.
2. [Connect the assistant](/docs/getting-started/assistant/).
3. [Hand the site to an editor](/docs/getting-started/handover/).
