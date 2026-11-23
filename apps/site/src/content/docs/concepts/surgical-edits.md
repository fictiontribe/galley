---
title: Surgical edits
description: Changing one value changes those bytes and nothing else. How Galley splices YAML scalars at their byte range, what survives an edit, what happens to structural changes, and what it refuses.
group: concepts
order: 3
---

This page is for developers. It explains the third principle: an edit changes the bytes the person changed and nothing else, so the diff in the proof — and in your pull request — shows exactly what they did. A diff that shows more is treated as a bug.

## A real edit

This blog post was committed to a copy of the starter, with a comment, a single-quoted title, a folded description and a flow-style list with a trailing comment:

```yaml
---
# Shown on the blog index and in search results.
title: 'Winter opening hours'
description: >
  We close for the last week of December
  and reopen on the second of January.
date: 2026-11-20
author: tomas-reyes
image: /images/blog/measured-survey.svg
tags: [Studio, News]   # keep to two tags
---

The studio is closed from the 24th.
```

Two edits went through the same route the form uses:

```sh
$ curl -s -X PATCH -H "Authorization: Bearer $GALLEY_TOKEN" -H "Content-Type: application/json" \
    "http://127.0.0.1:4400/api/sites/$SITE/entry?path=src/content/blog/opening-hours.md" \
    -d '{"ops":[{"op":"set","path":["title"],"value":"Winter opening hours, 2026"},{"op":"set","path":["date"],"value":"2026-11-21"}]}'
```

and `git diff` afterwards:

```diff
@@ -1,10 +1,10 @@
 ---
 # Shown on the blog index and in search results.
-title: 'Winter opening hours'
+title: 'Winter opening hours, 2026'
 description: >
   We close for the last week of December
   and reopen on the second of January.
-date: 2026-11-20
+date: 2026-11-21
 author: tomas-reyes
 image: /images/blog/measured-survey.svg
 tags: [Studio, News]   # keep to two tags
```

The title kept its single quotes; the comment, the folded description, the key order and the body are byte-identical. Then a structural edit — adding a tag:

```sh
-d '{"ops":[{"op":"insert","path":["tags"],"index":2,"value":"Hours"}]}'
```

```diff
-tags: [Studio, News]   # keep to two tags
+tags: [Studio, News, Hours]   # keep to two tags
```

The list stayed in flow style and its comment stayed where it was. (The comment now disagrees with the content — Galley preserves comments; it doesn't read them.)

## How it works

[`applyEdits(source, format, ops)`]({repository}/blob/main/packages/core/src/content/edit/apply.ts) returns the new text, how many operations changed it, and a reason for every one it refused.

- **Setting a scalar in YAML** finds the node's exact byte range in the front matter and splices the new value in, rendered in the same style as the old one where it can be (plain, single- or double-quoted, block). The rest of the file is never re-serialised. ([`content/edit/yaml/`]({repository}/tree/main/packages/core/src/content/edit/yaml))
- **Structural edits** — inserting, moving or removing a list item or a page section, removing a key, adding a key that wasn't there, setting a value that is an object or a list — go through the `yaml` library's document API, which keeps comments and the formatting of everything it doesn't touch.
- **JSON files** keep their indentation and their trailing newline.
- **The markdown body** is edited as text after the closing fence: replace all of it, or replace one passage. A passage that appears more than once is refused unless `all` is set.
- **TOML is read-only.** Hugo-style `+++` front matter and `.toml` data files can be read and shown, but every edit is refused with a reason, rather than risk rewriting the file.

## The operations

| `op` | Fields | Does |
| --- | --- | --- |
| `set` | `path`, `value` | Set a field. `path` is a list of keys and list positions: `["sections", 0, "heading"]`. |
| `unset` | `path` | Remove a key. |
| `insert` | `path`, `index`, `value` | Insert into a list; `index` equal to the length appends. |
| `move` | `path`, `from`, `to` | Move a list item (reorder page sections). |
| `remove` | `path`, `index` | Remove a list item. |
| `body` | `value` | Replace the whole markdown body. |
| `body-replace` | `find`, `replace`, `all?` | Replace text in the body. |
| `raw` | `value` | Replace the whole file. |

Operations apply in order, each to the result of the one before. A refused one doesn't stop the others:

```json
{"applied":1,"refused":[{"index":1,"op":{"op":"set","path":["tags",9],"value":"x"},"reason":"There is no item 10 in “Tags”."}]}
```

Refusal reasons are written for the person: *That text appears 3 times in the main text. Include more of the surrounding words so it is clear which one to change, or replace all of them.*

## What it means for you

- Pull requests from Galley are reviewable: one field changed, one line in the diff.
- Hand-written YAML stays hand-written. Comments explaining a field to the next developer survive an editor's changes.
- The proof can be trusted, because it is `git diff` and `git diff` has nothing extra to show.

## Next

- [Detection and schema inference](/docs/concepts/detection/) — where the fields being edited come from.
- [Never guess](/docs/concepts/never-guess/) — how a click on the page becomes a `path`.
