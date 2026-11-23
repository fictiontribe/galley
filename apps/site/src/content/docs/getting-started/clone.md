---
title: Open a site from a git repository
navTitle: Open a site from GitHub
description: Clone a site from GitHub or any git host on the Sites screen; Galley uses your computer's own git sign-in.
group: getting-started
order: 3
---

Start here when the site lives on GitHub, GitLab, Bitbucket or your own git server, and isn't on this computer yet.

## Clone it

1. On the **Sites** screen, press **Add sites**, then **Clone a site…**.
2. In **Site address**, paste the address you'd give `git clone` — `https://…` or `git@github.com:org/site.git`.
3. Leave **Which version (optional)** empty to edit the version the site publishes from, or type a branch name.
4. Press **Clone site**. A progress bar shows the download; the site opens when it's done.

The copy goes into the Galley home's `sites/` folder (`~/.galley/sites/`), named after the repository.

## Signing in to the git host

Galley has no git sign-in of its own. It runs `git` as you, so whatever lets `git clone` work in your terminal — a credential helper, the macOS keychain, an SSH agent, `gh auth login` — works here too. The same sign-in is used to push when you publish.

## If something's different

- **Already have the site on this computer?** Use **Add sites** › **Open one folder…**, or run `galley <folder>` in a terminal.
- **"That repository wasn't found."** Check the address, and that you can see the repository. GitHub says the same for a private one you can't reach.
- **"The code host didn't accept your sign-in for that repository."** Sign in to the host on this computer (for example `gh auth login`), then try again.
- **"That branch doesn't exist in the repository."** Fix the name, or leave the field empty.
- **"Couldn't reach the code host."** Check the internet connection.
- **The address is refused.** Only `https` and ssh addresses work — not local paths.

Galley doesn't install the site's dependencies when it clones; the preview does that the first time it starts. On a shared Galley, the git sign-in is that of the server ([Self-hosting](/docs/running/hosted/)). The same over the API: `POST /api/sites/clone` ([HTTP API](/docs/reference/api/#sites)).

## Next

1. [Change a page](/docs/editing/form/).
2. [Connect the assistant](/docs/getting-started/assistant/).
3. [Hand the site to an editor](/docs/getting-started/handover/).
