---
title: "Quickstart: Galley on your Astro site"
navTitle: Quickstart
description: Clone Galley, open your Astro site (or a starter) in it, change a page, check the change in Proof and publish it as a commit. About ten minutes.
group: getting-started
order: 1
---

This page is for the developer who looks after an Astro site. By the end you will have Galley running from a clone of its repository, your site (or one of the starters) open in it, one change made, checked in Proof and published as a commit.

Galley is pre-release and not on npm yet, so today it runs from a clone.

## What you need

- **An Astro site in a git repository**, with its content in content collections (`src/content/…`) or data files (`src/data/…`). A clean working tree makes your first proof easiest to read. No site yet? Start from a starter (below).
- **Node.js 20.11 or newer** for Galley, plus whatever your site needs for `astro dev` (Astro 7 itself needs Node 22.23.4 or newer).
- **git**, and **pnpm 10** to install Galley's own dependencies (`corepack enable` provides it).
- **Optional: an Anthropic API key** for the assistant. Without one, everything except asking for changes works.

Nothing is installed into your project. Galley adds no dependency, integration or build plugin to your site. Tested on macOS; Linux and Windows have not been verified yet.

## Get Galley

```sh
$ git clone {repository}.git galley
$ cd galley
$ corepack enable
$ pnpm install
$ pnpm --filter @galley/web build
```

The last command builds the app's screens into `packages/web/dist`. Make the command available as `galley` for this shell session — every page in these docs writes it that way:

```sh
$ alias galley="node $PWD/packages/cli/bin/galley.js"
$ galley version
galley 0.1.0
```

## Check what Galley sees

Optional, but quick: in your site's folder, `galley doctor` reads the project without running any of its code and prints what it found — the framework and package manager, the dev and build commands, each collection with its fields, the media folders, git and the assistant's key:

```sh
$ galley doctor ~/sites/your-site
```

`doctor` exits with 1 only when something would stop Galley working. [Detection and schema inference](/docs/concepts/detection/) explains each step.

## Open a site

Your own Astro site:

```sh
$ galley ~/sites/your-site
```

Or a new site from one of the [starters](/starters/) — this copies the starter into a folder named after your site, installs its dependencies, records a first version with git, then opens it:

```sh
$ galley new my-site --starter astro-editorial
Creating “my-site” in /Users/you/my-site from astro-editorial…
Installing dependencies with npm (this can take a minute)…
✓ Dependencies installed
✓ Copied the starter and recorded the first version
Galley is running at http://127.0.0.1:4400
Site: my-site (/Users/you/my-site)
Open: http://127.0.0.1:4400/sites/ded6a46e6bca?token=…
Press Ctrl+C to stop.
```

Galley runs on your computer only (`127.0.0.1`) and opens your browser on the printed link; the token in it keeps everyone else on the network out. If port 4400 is taken, the next free one is used. `galley starters` lists the starters and their looks; `--port`, `--no-open` and the other options are in [Command line](/docs/reference/cli/).

When you open a page, Galley starts your site's own dev command behind a small proxy of its own, so the preview is your site as `astro dev` serves it.

## Make a change

Open **Pages** in the sidebar and choose the home page. The editor shows the page's form beside its preview. Change it any of three ways:

- **In the form** — open a section and retype a field.
- **On the page** — choose **Click to edit**, click a heading in the preview and retype it where it sits.
- **By asking** — with an assistant key in Settings, type what you want in the assistant pane.

Each change is written to the file straight away, and only those bytes change. [Surgical edits](/docs/concepts/surgical-edits/) shows what survives an edit, comments and quoting included.

## Proof it

Choose **Proof**. Every change waiting to be published is listed by page, in content terms — *Campaign hero › Heading*, the old words struck out and the new ones written in — with the page beside the live site and the file's own lines under **Source**. **Put back** undoes one change; nothing goes live until you publish. [Proof and publish](/docs/editing/proof-and-publish/) goes through the screen.

## Publish it

Press **Publish**, check the note for version history, then **Publish 1 change**. Galley commits the changed files as you, with a `Galley-Publish: 1` trailer, and pushes when the repository has a remote:

```sh
$ git log -1 --format=%B
Update Caddow — coats and knitwear, made in runs of forty

Galley-Publish: 1
$ git show --stat --format= HEAD
 src/content/pages/index.md | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)
```

If the push fails, the commit stays and the reason comes back in plain words. Pull-request mode commits to a new branch instead — see [Publishing](/docs/configuration/publishing/). **Undo this publish** in Version history is a new commit, never a rewrite.

## Stop

Press `Ctrl+C`. Galley stops the dev servers it started. Anything you didn't publish is still in your working tree as ordinary uncommitted changes.

## Next

- [Prompt, proof, publish](/docs/concepts/prompt-proof-publish/) — what happens underneath each step.
- [What Galley reads from an Astro project](/docs/astro/content-collections/) — and what it can't read.
- `galley doctor` prints what Galley detected in a site without opening anything; if detection got something wrong, `galley init` writes a `galley.config.json` for you to correct: [Configuration](/docs/configuration/).
