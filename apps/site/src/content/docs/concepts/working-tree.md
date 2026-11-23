---
title: The working tree is the draft
navTitle: Working tree as draft
description: Galley keeps no draft database. A pending change is an uncommitted change in the checkout, the proof is git diff, Discard restores the file, Publish commits. What that means for developers, command by command.
group: concepts
order: 2
---

This page is for developers. It explains the second of Galley's principles: there is no draft store, no overlay format, no copy of your content anywhere else. The files in the site's git checkout *are* the draft.

## Every action is a git operation

| In Galley | Underneath | Source |
| --- | --- | --- |
| An edit (form, page, assistant) | The file is rewritten in place, atomically (temp file + rename) | [`workspace/files.ts`]({repository}/blob/main/packages/core/src/workspace/files.ts) |
| Changes, Proof | `git status --porcelain` and `git diff` against `HEAD`, untracked files included, ignored files left out | [`workspace/changes.ts`]({repository}/blob/main/packages/core/src/workspace/changes.ts) |
| Discard | The file goes back to its `HEAD` version; a file `HEAD` doesn't have is deleted | [`workspace/workspace.ts`]({repository}/blob/main/packages/core/src/workspace/workspace.ts) |
| Publish | Stage the chosen paths, `git commit` with a `Galley-Publish: 1` trailer, `git push` when there is a remote | [`workspace/publish.ts`]({repository}/blob/main/packages/core/src/workspace/publish.ts) |
| Undo this publish | `git revert --no-edit`, a new commit | same |
| Get the latest | `git pull --no-rebase --ff-only` | same |
| Version history | `git log`, with `viaGalley: true` on commits that carry the trailer | same |

git runs as a child process with argument arrays, never a shell string, and with prompts, pagers and editors turned off. Galley never force-pushes, never rewrites history and never changes git configuration outside the repository.

## Why

- **Every site previews with its own dev server.** The files on disk are what `astro dev` already watches, so the preview is your site exactly as it builds — no renderer of Galley's in the loop.
- **Nothing to migrate, nothing trapped.** Stop using Galley and your content is where it always was. A colleague's `git pull` sees exactly what was published.
- **Other tools keep working.** Run `git diff` in a terminal and you see what Galley sees.

## Any tool can edit the site

Because the draft is just files, Galley is never the only way in. An edit made by anything else — your code editor, a script, `git pull`, another AI agent working in the folder — lands in the same working tree, and Galley's watcher picks it up and shows it in the proof as an outside change (origin `external`), ready to be proofed and published like any other. Nothing has to go through Galley's API or UI for Galley to see it, and nothing Galley does needs to be undone in a database if you stop using it. This is the first of three open doors; the other two are the [MCP server](/docs/integrations/mcp/), which gives any AI tool the assistant's own tools, and the [HTTP API](/docs/reference/api/) the UI itself uses.

## What a change looks like

`GET /api/sites/<id>/changes` is the data behind the proof. After two field edits and a tag added to a blog post, on the starter:

```json
{
  "branch": "main",
  "files": [
    {
      "path": "src/content/blog/opening-hours.md",
      "status": "modified",
      "kind": "content",
      "additions": 3,
      "deletions": 3,
      "summary": "Changed the title and 2 other fields.",
      "collection": "blog",
      "fieldChanges": [
        { "field": ["title"], "label": "Title", "kind": "changed", "before": "Winter opening hours", "after": "Winter opening hours, 2026" },
        { "field": ["date"], "label": "Date", "kind": "changed", "before": "2026-11-20", "after": "2026-11-21" },
        { "field": ["tags"], "label": "Tags", "kind": "changed", "before": ["Studio", "News"], "after": ["Studio", "News", "Hours"] }
      ],
      "bodyChanged": false,
      "url": "/blog/opening-hours/",
      "title": "Winter opening hours, 2026"
    }
  ],
  "totals": { "files": 1, "additions": 3, "deletions": 3 }
}
```

(Abridged: `baseCommit` and `binary` left out.) Each file is classified as `content`, `media`, `code`, `config` or `other`; content entries are parsed in both versions so the proof can say *Title* rather than *line 3*.

## Things to know

- **A repository with no commits works.** Every file is pending until the first publish creates the first commit. `galley new` records a first version so the first proof is readable.
- **Not a git repository?** Editing works; publishing says *This folder isn't under version control yet, so there's nowhere to publish to.* Run `git init`.
- **Your own uncommitted changes count.** Galley can't tell your edits from an editor's: anything pending in the working tree is in the proof and can be published. Start from a clean tree, or publish only the files you mean.
- **Concurrent edits are detected, not merged.** Every read returns a hash of the file; an edit sent with that `baseHash` is refused if the file changed meanwhile: *This file changed since you opened it, so your edit wasn't saved.*
- **Some paths are never committed**, whatever is selected: anything under `.git/` or `node_modules/`, and `.env` files.
- **Your git hooks run.** A pre-commit hook that fails stops the publish: *The site's own checks stopped the publish, so nothing was published.* Its output is in the result's `detail`. Hooks get five minutes.
- **A detached `HEAD`, or a merge or rebase in progress** outside the app, stops publishing until it is resolved, with a message saying so.

## Next

- [Surgical edits](/docs/concepts/surgical-edits/) — why a diff shows only what changed.
- [Publishing](/docs/configuration/publishing/) — branch, remote, push and pull-request mode.
