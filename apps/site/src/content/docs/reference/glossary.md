---
title: Glossary
description: The words editors see in Galley and what they are underneath, for developers explaining the product, writing support answers or reading the code.
group: reference
order: 5
---

This page is for developers. Galley's interface speaks to people who may never have heard of git, so it uses one set of words; the code, the CLI and these developer docs use another. Both are exact. This table is the bridge, from the vocabulary in [`brand/voice.md`]({repository}/blob/main/brand/voice.md).

| Editors see | Underneath | In the code |
| --- | --- | --- |
| **Publish** | `git commit` with a `Galley-Publish: 1` trailer, then `git push` | `publish()`, `POST …/publish` |
| **Send for review** | Publish in pull-request mode: a `galley/…` branch, pushed, and a pull request | `publish.mode: "pull-request"` |
| **Changes** | Uncommitted changes in the working tree, untracked files included | `ChangeSet`, `GET …/changes` |
| **Proof** | `git diff` against `HEAD`, shown as field changes, a side-by-side preview and per-file detail | `FileChange`, `FieldChange`, `GET …/diff` |
| **Discard** | Restore the file to `HEAD`; delete it if `HEAD` doesn't have it | `POST …/discard` |
| **Undo** (an assistant reply) | Restore the files that reply changed from its checkpoint | `Checkpoint`, `POST …/threads/:id/undo` |
| **Undo this publish** | `git revert --no-edit`: a new commit | `POST …/revert` |
| **Version history** | `git log`; commits with the trailer are marked `viaGalley` | `HistoryEntry`, `GET …/history` |
| **Version** | A commit | `commit`, `shortCommit` |
| **Live site** | The deployed production (or staging) URL | `urls.production`, `urls.staging` |
| **Preview** | The site's own dev server, behind Galley's proxy | `PreviewStatus`, `workspace/preview/` |
| **Site** | A git checkout Galley has opened | `SiteService`, `SiteSummary` |
| **Page**, **post**, **team member**… | An entry: one file in an entries collection | `Entry`, `EntrySummary` |
| *(the collection's own name)* | A collection: a folder of entries, or one data file | `Collection` |
| **Field** | A key in front matter or a data file, with a type | `Field`, `FieldPath` (`["hero", "heading"]`) |
| **Section** | One item of a blocks field, typed by its discriminator | `blocks`, `BlockType` |
| **Image**, **media** | A file under a media root | `MediaItem`, `media.dir` |
| **Assistant** | The model, its tools and the conversation loop | `ai/`, `AgentRuntime`, threads |
| **Content mode** / **build mode** | The write surface: content and media only, or source files too | `AgentMode`, `writable` |
| **App settings › You** | The commit author | `settings.author` |
| **Site settings** | `galley.config.json` | `GalleyConfig` |

A few developer words that never reach an editor: *detection* (reading a site to build its `SiteModel`), *adapter* (a framework's description of a site), *inference* (field types from the files), *surgical edit* (splicing a value at its byte range), *baseline* (the deployed site behind its proxy), *overlay* (the script in the preview), *Galley home* (`~/.galley`).

## Next

- [Prompt, proof, publish](/docs/concepts/prompt-proof-publish/).
- [HTTP API](/docs/reference/api/).
