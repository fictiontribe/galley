---
title: Prompt, proof, publish
description: The loop at the centre of Galley — the three ways to make a change, what the proof shows, what Publish does — and the git that does the work underneath.
group: concepts
order: 1
---

Galley has one loop. Someone makes a change, checks it, and makes it live. Everything in the product exists to make one of those three steps easier, safer or clearer.

This page is for developers, and anyone who wants to know what happens underneath each step. The screens themselves are in [Edit a site](/docs/editing/tour/).

> **Prompt it. Proof it. Publish it.**

## The working tree is the draft

There is no draft database and no overlay format. A pending change is an **uncommitted change** in the site’s git checkout:

| In Galley | Underneath |
| --- | --- |
| A change waiting to be published | An uncommitted change in the working tree |
| The proof | `git diff` against the last commit |
| Discard | `git restore` of that file |
| Publish | `git commit`, then `git push` — or a branch and a pull request |
| Undo this publish | `git revert` — a new commit |
| Version history | `git log` |

This is what lets every site preview with its **own** dev server: the files on disk are the draft, so the site simply runs. It is also why there is nothing to migrate in and nothing trapped if you leave.

## Prompt: three ways to make a change

All three end the same way — a file in the working tree changes, and only the bytes that needed to.

### In the form

Fields are generated from the collection’s content model: text, long text, markdown, numbers, toggles, dates, selects, images, links, colours, tags, lists, nested objects, references to other entries, and **page sections** (a list of blocks, each type with its own fields). Each field shows its key, small and in mono, for the developers.

### On the page

The preview is the site running on its own dev server. In edit mode, hovering outlines text and images; clicking text lets you retype it in place. Galley has to know which line of which file the words came from, so it looks for them in the entry behind the page first, then across the site. When exactly one place matches, you can edit it. When several do — three identical “Learn more” links, say — Galley lists them and asks. It never picks one for you.

### In chat

The assistant edits through the same guarded functions the form uses. It reads before it edits, asks one short question when a request is ambiguous, quotes the new text so you can check it without opening the proof, and never says it changed something unless the edit was accepted. In content mode it can only touch content and media; it has no shell and no network access.

Each assistant turn opens a checkpoint. **Undo** on a turn puts back exactly the files that turn changed and leaves your other edits alone. A page that was changed again after the turn — by you or by someone else — is left as it is, and the reply says which: putting the whole page back would take the later change with it.

## Proof: see it before anyone else does

The proof is where every pending change waits. It shows:

- **a plain-language change list** — each change in content terms, *Home › Hero › Heading*, with the words before and after, marked the way an editor marks a galley proof: a caret for what was inserted, the dele mark for what was removed;
- **the visual split** — the proposed page beside the deployed site, so you see the change in place;
- **per-file detail** — for whoever wants the diff;
- **Discard**, per file.

Because edits are surgical, the proof is honest. Changing one value changes those bytes and nothing else: YAML is never re-serialised to change a scalar, so comments, quoting, key order and the markdown body survive byte for byte. A diff that shows more than the person changed is treated as a bug.

## Publish: make it live

Publish stages the chosen files and commits them as the configured author, with a `Galley-Publish: 1` trailer, then pushes when the repository has a remote.

- **If the push fails**, the commit stays where it is and Galley says what happened in plain words — nothing is lost, and you can try again.
- **In pull-request mode**, the commit goes to a new branch named from the message and the commit, such as `galley/update-the-opening-hours-1a2b3c4`, which is pushed, and Galley hands back the pull request (opened with the GitHub CLI when it is signed in) or a ready-to-open compare link for GitHub, GitLab or Bitbucket.
- **Undo this publish** reverts it with a new commit. Galley never force-pushes and never rewrites history.

## The rules underneath

A few principles keep the loop trustworthy. They are written down in full in [`docs/ARCHITECTURE.md`]({repository}/blob/main/docs/ARCHITECTURE.md).

- **Zero config, then config.** Opening a folder is enough; `galley.config.json` only corrects or extends what detection found.
- **Never guess.** When something is ambiguous, Galley asks or declines.
- **Plain words.** Editors see Publish, Changes, Proof, Discard, Undo and Version history — never commit, diff or revert.
- **Closed write surface.** Writes stay inside the site, within the mode’s allowed files. `.git/`, `node_modules/`, `.env*` and lockfiles are never written.

## Next

- [The working tree is the draft](/docs/concepts/working-tree/) — the git underneath, command by command.
- [Surgical edits](/docs/concepts/surgical-edits/) — why the proof shows only what changed.
- [Never guess](/docs/concepts/never-guess/) — how a click on the page finds its line in a file.
