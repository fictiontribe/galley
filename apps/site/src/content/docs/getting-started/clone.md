---
title: Open a site from a git repository
navTitle: Open a site from GitHub
description: Clone a site from GitHub or any git host from the Sites screen, where the copy goes, which credentials are used, and what each failure means.
group: getting-started
order: 3
---

This page is for a developer setting Galley up on a site that is not on this computer yet. The **Sites** screen offers three ways in: open a folder, clone a site, or create a new one. Cloning is the one for a site that lives on GitHub, GitLab, Bitbucket or your own git server.

## Clone a site

On the Sites screen, choose **Clone a site** and paste the address you would give `git clone`:

- **Site address** — `https://…` or an ssh address (`git@github.com:org/site.git`, `ssh://…`). Anything else is refused with *“url” isn't right: it must be an https or ssh address.* — including local paths, `file://` and `ext::` URLs.
- **Which version (optional)** — a branch name. Leave it empty for the repository's default branch, which is usually the one the site publishes from.

Galley clones it with your machine's own git ([source]({repository}/blob/main/packages/core/src/workspace/scaffold.ts)), shows the progress, and opens the site when it is done. The same thing over the API:

```sh
$ curl -s -X POST -H "Authorization: Bearer $GALLEY_TOKEN" -H "Content-Type: application/json" \
    http://127.0.0.1:4400/api/sites/clone -d '{"url":"https://github.com/octocat/Hello-World.git"}'
{"id":"cf179c48-…","kind":"clone","label":"Downloading Hello-World","state":"running","startedAt":1795419148237}
$ curl -s -H "Authorization: Bearer $GALLEY_TOKEN" http://127.0.0.1:4400/api/jobs/cf179c48-…
{"id":"cf179c48-…","kind":"clone","label":"Downloading Hello-World","state":"done",…,"detail":"The site is ready.","progress":1,"siteId":"dcd2985adf23",…}
```

## Where the copy goes

Into `GALLEY_SITES_DIR`, which defaults to `sites/` inside the Galley home (`~/.galley/sites/`), in a folder named after the repository (`Hello-World`); a name already taken gets a free variant. In [hosted mode](/docs/running/hosted/) that folder is the only place sites can be cloned into, opened from or created in.

Galley does not install the site's dependencies when it clones. The preview does that the first time it starts, with the package manager the lockfile names.

## Credentials

Galley has no credential store of its own for git. It runs `git` as you, with terminal prompts turned off (`GIT_TERMINAL_PROMPT=0`), so whatever already lets `git clone` work in your terminal — a credential helper, the macOS keychain, an SSH agent, `gh auth login` — is what Galley uses. A private repository that would ask for a password in a terminal fails here instead of hanging.

The same credentials are used to push when you publish. In hosted mode they are the credentials of the user the server runs as — in the [container](/docs/running/hosted/#run-it-in-a-container), whatever you mount or configure for the `node` user.

## When a clone fails

The copy is removed and the job ends in `error` with one of these, taken from what git printed:

| Message | Usually means |
| --- | --- |
| That repository wasn't found. Check the address — and that you have access to it. | A typo, or a private repository your credentials can't see. GitHub answers both the same way. |
| The code host didn't accept your sign-in for that repository. Sign in to it on this computer, then try again. | No credentials for that host, or rejected ones. |
| That branch doesn't exist in the repository. | The *Which version* field names no branch. |
| Couldn't reach the code host. Check your internet connection and try again. | DNS, a proxy, or the host is down. |
| Downloading the site took too long and was stopped. Check your connection and try again. | The clone ran for 30 minutes. |
| That folder already has files in it. Choose an empty folder or a new name. | A `directory` was given and is not empty. |

## Open a folder instead

For a checkout you already have, **Open a folder** browses the server's disk (the browser can't see it, so the server lists folders through `GET /api/fs/list`, marking the ones that look like sites). From a terminal, `galley <folder>` does the same and opens the browser on it.

## Next

- [Connect the assistant](/docs/getting-started/assistant/).
- [Publishing](/docs/configuration/publishing/) — which branch and remote a publish goes to.
- [Hand a site over to an editor](/docs/getting-started/handover/).
