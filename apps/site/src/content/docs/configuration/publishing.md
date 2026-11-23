---
title: Publishing
description: Which branch and remote a publish goes to, commit or pull-request mode, pushing, the live addresses the proof compares with, and every message a publish can end with.
group: configuration
order: 3
---

This page is for developers. Publishing is `git commit` — and `git push`, or a branch and a pull request — so its settings are git settings, kept under `publish` in `galley.config.json`. The live addresses the proof compares with are under `urls`. The code is [`workspace/publish.ts`]({repository}/blob/main/packages/core/src/workspace/publish.ts).

## The settings

| Key | Default | Meaning |
| --- | --- | --- |
| `publish.mode` | `commit` | `commit`: commit on the current branch and push. `pull-request`: commit on a new branch, push it and open a pull request. |
| `publish.branch` | the branch checked out | Commit mode: publishing is refused unless the site is on this branch. Pull-request mode: the branch the pull request targets. |
| `publish.remote` | `origin` if it exists, else the first remote, else `null` | Which remote to push to. A name the repository doesn't have counts as no remote. |
| `publish.push` | `true` when there is a remote | `false`: commit only, never push. |
| `urls.production` | from the framework (`site` in the Astro config), `CNAME`, or `homepage` in `package.json` | The live site. |
| `urls.staging` | none | A staging deployment. When set, the side-by-side view compares with it instead of production. |

```json galley.config.json
{
  "urls": { "production": "https://www.harbourbakery.example", "staging": "https://staging.harbourbakery.example" },
  "publish": { "mode": "pull-request", "branch": "main" }
}
```

`publish.mode` can also be chosen per publish (`POST /api/sites/<id>/publish` takes `mode`), which is how the UI offers **Send for review** next to **Publish**.

## What a publish does

1. **Chooses the files**: the paths asked for, or everything pending. Paths under `.git/` or `node_modules/` and `.env` files are never committed, whatever is selected.
2. **Commits them** as the person publishing — App settings › You, which starts from this computer's git `user.name` and `user.email` (a site's own author in Site settings › Connections wins) — with the message they wrote (or one suggested from the changes) and a `Galley-Publish: 1` trailer. The site's own git hooks run, for up to five minutes.
3. **Pushes** to `publish.remote`, when there is one and `push` is on.

In pull-request mode, step 2 commits onto a new branch named from the message and the commit — `galley/reword-the-home-page-heading-1a2b3c4` — without touching the branch you are on; step 3 pushes that branch. Then Galley opens the pull request with the GitHub CLI if `gh` is installed and signed in for that host, and otherwise returns a compare link for GitHub, GitLab or Bitbucket (`pullRequestUrl` in the result).

```json
{"ok":true,"commit":"e594efa7066139db2a34144b7f06a3a7ecdb9c97","branch":"main","files":["src/content/blog/opening-hours.md"],"pushed":false}
```

**Undo this publish** is `git revert --no-edit` on that commit, committed as *Undo “…”* with the trailer, and pushed the same way.

## When it doesn't work

A failed publish never loses work: either nothing was committed and the files are as they were, or the commit was made and only the push failed (`pushError`). The messages, as the person sees them:

| Message | Means |
| --- | --- |
| There's nothing to publish. | No pending changes. |
| None of those files have changes to publish. | The paths asked for are clean. |
| This folder isn't under version control yet, so there's nowhere to publish to. … | No `.git`. Run `git init`. |
| The site isn't on a branch right now (someone checked out an older version), so there's nowhere to publish. … | Detached `HEAD`. |
| The site's version history is in the middle of another operation that was started outside the app. … | A merge, rebase, cherry-pick or revert is in progress. |
| Publishing is set to go to “main”, but the site is on “draft” right now. … | `publish.branch` differs from the checked-out branch (commit mode). |
| The site's own checks stopped the publish, so nothing was published. Fix what they report, then try again. | A git hook failed; its output is in `detail`. |
| The site's own checks took too long, so nothing was published. Try again. | A hook ran for over five minutes. |
| Someone else published first — pull the latest and try again. | The push was rejected as non-fast-forward. `POST /api/sites/<id>/pull` runs `git pull --ff-only`. |
| The code host doesn't allow changes to go straight to this branch. Publish as a pull request instead. | Branch protection. Use pull-request mode. |
| The code host didn't accept your sign-in. Make sure you're signed in to it on this computer, then publish again. | No or bad credentials for the remote. |
| Couldn't reach the code host. Your change is saved on this computer — check your connection and publish again. | Network. |
| The very first version of a site can't be sent as a pull request. Publish it directly once, then pull requests will work. | Pull-request mode in a repository with no commits. |
| Pull requests need the site to be connected to a code host, and this one isn't. … | Pull-request mode without a remote. |

## Next

- [The working tree is the draft](/docs/concepts/working-tree/).
- [Media](/docs/configuration/media/).
