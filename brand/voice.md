# Galley — voice

Galley talks like a good production editor: calm, exact, brief. It tells you
what is on the page, what changed, and what happens when you press the
button. It never makes you feel you broke something, and it never claims to
have done something it didn't.

**Three tests for every string**

1. **Could an editor who has never heard of git act on it?** If not, rewrite.
2. **Is it true?** Every claim must come from something the system actually
   reported. "Published" means the publish succeeded, not that it started.
3. **Can a word go?** Then it goes.

---

## Vocabulary

Editor-facing UI uses the left column. The right column may appear only where
the reader is a developer: the CLI, developer docs, `galley doctor`, the
"Technical details" disclosure in an error, and the Settings › Site
configuration page.

| Say | Not | Meaning / note |
| --- | --- | --- |
| **Publish** | commit, push, deploy, merge | Make pending changes live. In pull-request mode: **Send for review**. |
| **Changes** | diff, modifications, delta, working tree | Everything edited since the last publish. "3 changes". |
| **Proof** (noun and verb) | diff view, review, preview diff | The screen where you check changes before publishing. "Open the proof." "Proof your changes." |
| **Discard** | revert, reset, restore, checkout | Throw away an *unpublished* change. |
| **Undo** | revert | Reverse the last action. After publishing: **Undo this publish** (it creates a new version — say so in docs, not in the button). |
| **Version history** | git log, commits, history graph | The list of published versions. |
| **Version** | commit, SHA, revision | One published state. Show a date and author, never a hash, to editors. |
| **Live site** | production, prod, origin, remote | What visitors see now. |
| **Preview** | dev server, localhost | The site running with your changes. |
| **Page / post / entry** | file, document, markdown file | Use the collection's own noun ("post", "team member"). Fall back to "entry". |
| **Section** | block, component | A repeatable part of a page. (`blocks` is fine in dev docs.) |
| **Field** | key, property, front matter | A labelled input. The key (`hero.heading`) is shown small, in mono, for people who want it. |
| **Image** / **media** | asset, file upload, binary | |
| **Site** | repo, repository, project, workspace | The thing you opened. "Open a site", "Clone a site from GitHub" is fine on the Sites screen. |
| **Assistant** | AI, bot, agent, model, Claude | The chat partner. Name the model only in Settings. |
| **Ask** | prompt (verb) | "Ask for a change." *Prompt it* is marketing only. |
| **Can't** / **Couldn't** | failed, error, exception, fatal | Say what didn't happen. |

Never in editor-facing copy: *commit, diff, checkout, revert, branch, merge,
rebase, stage, HEAD, origin, SHA, repo, YAML, front matter, JSON, schema,
token, endpoint, 404, stack trace, invalid, fatal, oops, uh-oh, whoops.*

**The product's own name.** Galley is white-labelable, so UI copy never
hard-codes "Galley". Refer to the product by its function ("the assistant",
"this app") or by the `{product}` value from `/api/meta`. Marketing and docs
may say Galley.

---

## Grammar and mechanics

- **Sentence case everywhere** — buttons, titles, menu items, tabs, labels:
  "Version history", "Add section", not "Add Section".
- **Proper nouns keep their case:** GitHub, Astro, Markdown (as a format name
  in docs), macOS. Field labels come from the site — show them as the site
  spells them.
- **Mono uppercase labels** (eyebrows, field paths) are styled with CSS
  `text-transform`; write them in sentence case in the source so screen
  readers don't spell them out.
- **No full stop** on buttons, labels, tabs, tags, menu items, toasts' titles,
  or one-line hints. **Full stops** on any sentence of body text, error body,
  empty-state body and assistant reply.
- **No exclamation marks.** Not even on success.
- **Contractions are fine:** can't, couldn't, it's, you'll.
- **Who's speaking:** the interface never says “we” (a white-labelled product
  has no “we”); it states facts and addresses “you”. The assistant says “I”.
- **Numbers as digits:** "3 changes", "1 image". Pluralise correctly — never
  "1 changes" or "change(s)".
- **Quotes:** curly “ ” and ’ in UI copy. Quote a user's own text exactly,
  including its punctuation.
- **Ellipsis** (…, one character) only on a control that opens something
  that needs more input ("Rename…") and in placeholders ("Ask for a change…").
- **Breadcrumb separator** is `›` with a space each side: Home › Hero › Heading.
- **Times:** relative when recent ("2 min ago", "yesterday"), absolute after a
  week ("12 Mar, 14:05"). Use the viewer's locale and clock.
- **Paths and keys** appear in mono, secondary weight, and never on their own:
  always under the human title.
- **Oxford comma:** yes.
- **Spelling:** the product follows the user's locale; source strings use
  US English ("color" in code, "colour" never in UI strings).

---

## Patterns

### Buttons
Verb first, specific object when there's room. Say what will happen, not what
the button is.

- One primary button per view. Usually **Publish**.
- Destructive actions name the thing and the count: **Discard 3 changes**,
  **Delete page** — never just "OK" or "Yes".
- Paired buttons: the safe one says what you keep doing — **Keep editing**,
  **Not yet** — not "Cancel" when a clearer phrase fits.
- Progress state replaces the label: **Publish** → **Publishing…** → (toast).
- 1–3 words. If it needs more, it's a sentence, not a button.

### Empty states
Say what will appear here and the one way to make it appear. One headline
(display face, ends with a full stop), one sentence, one action.

### Errors
**What happened. What to do.** In that order, in plain words, without blame.

- Lead with what didn't happen, in the user's terms ("Couldn't publish").
- Say whether their work is safe — it nearly always is. Say so.
- Give one next step, as a button if possible ("Try again", "Open settings").
- Put the raw message, exit code or log behind **Technical details**, closed
  by default, selectable and copyable.
- Field errors sit under the field, start with what's wrong and, when the
  system knows, suggest the fix: "No page lives at /contat/. Did you mean
  /contact/?"
- Never: "Something went wrong", "An error occurred", "Invalid input",
  error codes on their own, or apologies longer than "Sorry —".

### Confirmations
Only for what can't be undone with one click (discarding unpublished
changes, deleting an entry, undoing a publish). Title is the question with the
specifics; body says exactly what goes and what stays; buttons repeat the
verb.

> **Discard 3 changes?**
> This removes your unpublished edits to Home page, About page and one image.
> What's already published stays as it is.
> [Keep editing] [Discard 3 changes]

Everything else — publishing, undoing an assistant turn, discarding one field —
happens immediately and offers **Undo** in a toast.

### Success
Quiet, factual, and only after it's true. Say what is now the case and how
soon it shows. Offer Undo.

### The assistant

The assistant is a careful colleague, not a mascot.

- **Short.** One or two sentences after a change. Lists only when it changed
  more than three things.
- **Plain.** Content words only: page, section, heading, image. Never tool
  names, file formats, JSON, YAML, or "I called update_entry".
- **True.** It describes what a tool reported. If nothing was changed, it
  says so. It never says "I've updated…" before an edit was accepted, and it
  never says "done" about a publish — publishing is the person's button.
- **Asks, doesn't guess.** When a request is ambiguous it asks one short
  question with 2–4 options, never two questions in a row.
- **Quotes exactly.** When it changes text it quotes the new text in curly
  quotes, so the person can check it without opening the proof.
- **Points to the proof.** Every change reply ends by noting the change is
  waiting in Proof (or saying nothing was changed).
- **No filler.** No "Great question", "Certainly!", "I hope this helps",
  "As an AI…". No emoji.
- **First person, sparingly.** "I changed…" is fine. "I think" only for a
  genuine judgement the person asked for ("Which reads better?").
- **Refuses plainly.** "I can't change the site's code in content mode. You
  can switch to build mode in Settings." — no lecture.

Tool-activity lines (`.g-activity`) are written in the past tense with the
content path: "Edited Home › Hero › Heading", "Read Pricing page",
"Searched for “pricing” · 2 pages", "Couldn't save image — file too large".

---

## Before → after

Thirty strings, rewritten. The "before" column is the kind of thing a CMS or a
git tool usually says.

### Errors

| # | Before | After |
| --- | --- | --- |
| 1 | `Error: failed to push some refs to origin` | **Couldn't publish.** Your changes are saved here, but the site's host didn't accept them. [Try again] · Technical details |
| 2 | `fatal: not a git repository` | **This folder isn't set up for publishing yet.** You can still edit and preview. [Set up publishing] |
| 3 | `fatal: Not possible to fast-forward, aborting.` | **The live site has newer changes than this copy.** Publishing is paused so nothing gets overwritten. Your edits are safe. · Technical details |
| 4 | `ENOENT: no such file or directory, open 'public/img/hero.png'` | **The image “hero.png” is missing.** It may have been moved or renamed. [Choose another image] |
| 5 | `YAMLException: bad indentation of a mapping entry (12:3)` | **Team page's details can't be read,** so its fields can't be edited in the form until a developer fixes them. The page itself still works. · Technical details |
| 6 | `Invalid URL` | **That link doesn't go anywhere on this site.** Check the address, or choose a page. |
| 7 | `Dev server exited with code 1` | **The preview stopped.** The site's own build reported a problem. [Restart preview] · Technical details |
| 8 | `401 Unauthorized (Anthropic API)` | **The assistant can't connect.** The API key in Settings was rejected. [Open settings] |
| 9 | `Request timed out` | **The assistant is taking too long to answer.** Nothing was changed. [Try again] |
| 10 | `Write denied: path outside allowed globs` | **That file can't be edited here.** In content mode the assistant can change pages and images only. |

### Empty states

| # | Before | After |
| --- | --- | --- |
| 11 | `No changes.` | **Nothing to proof yet.** Edit a field, click text on the page, or ask in chat. Every change lands here before anything goes live. |
| 12 | `No results found.` | **No pages mention “pricing”.** Try a shorter word, or search all collections. |
| 13 | `No items in this collection.` | **No posts yet.** Posts you add show up here and on the blog. [New post] |
| 14 | `History is empty.` | **Nothing published yet.** Each time you publish, a version appears here — and you can undo it. |
| 15 | `No media.` | **No images yet.** Drop images here, or describe one and the assistant will make it. [Upload] [Generate] |

### Onboarding

| # | Before | After |
| --- | --- | --- |
| 16 | `Select a repository to initialize workspace` | **Open a site.** Choose the folder your site lives in. Nothing changes until you publish. |
| 17 | `Detecting framework… parsing content.config.ts…` | **Reading your site…** Found 4 collections and 63 pages. |
| 18 | `Schema inference complete. 3 warnings.` | **Your site is ready to edit.** 2 fields look unusual, so they're kept as plain text. [Review] |
| 19 | `Enter Anthropic API key` | **Connect the assistant.** Paste an API key. It's stored on this computer only. |
| 20 | `Welcome to Galley! 🎉 Let's get started!` | **Three ways to change your site:** type in the form, click text on the page, or ask in chat. |

### Publish outcomes

| # | Before | After |
| --- | --- | --- |
| 21 | `Committed 3 files (a1b2c3d) and pushed to origin/main` | **Published.** 3 changes are live. The site usually updates within a minute. [Undo] |
| 22 | `Commit succeeded, push failed` | **Saved, not live yet.** Your changes are recorded here but didn't reach the site's host. [Try again] |
| 23 | `Created branch galley/update-hero and opened PR #42` | **Sent for review.** A developer can approve “Update hero” before it goes live. [View request] |
| 24 | `Revert commit created` | **Publish undone.** The site is back to how it was on 12 Mar at 14:05. That undo is now in Version history too. |
| 25 | `Nothing to commit, working tree clean` | **Nothing to publish.** Everything here already matches the live site. |
| 26 | `Are you sure? This cannot be undone. [OK] [Cancel]` | **Publish 3 changes?** Home page, About page and one new image will go live. You can undo this from Version history. [Not yet] [Publish] |

### Assistant replies

| # | Before | After |
| --- | --- | --- |
| 27 | "Certainly! I've gone ahead and updated the hero section's heading field in index.md to make it more engaging. Let me know if you need anything else! 😊" | The heading now reads “Brand and web design for teams that ship.” It's waiting in Proof. |
| 28 | "I've updated the pricing page." *(two pages matched; it picked one)* | There are two pricing pages. Which one? [Pricing · /pricing/] [Team plans · /teams/pricing/] [Both] |
| 29 | "Done! Your changes have been published." *(it can't publish)* | I changed 3 headings on the Services page. They're in Proof — publish when you're happy. |
| 30 | "I updated the image." *(the tool refused: file not found)* | I couldn't change the image — there's no file called “team-photo.jpg” in your media. Want to pick one from Media, or should I generate one? |
| 31 | "As an AI, I don't have access to statistics, but here's a compelling figure: 87% of users…" | I don't have a source for that number, so I left it out. If you have one, paste it and I'll add it. |
| 32 | "Error calling tool write_file: path not in writable globs for mode 'content'" | I can't edit the site's code in content mode — only pages and images. You can switch to build mode in Settings. |

---

## Developer-facing copy

The CLI, developer docs and `galley doctor` speak to developers, so the
technical words are allowed and preferred — precision beats translation:

```
$ galley doctor
✓ Astro 5.2 · pnpm · dev: astro dev (port 4321)
✓ 4 collections: pages (8), blog (42), team (6), settings (data)
! team.role: 9 distinct values in 12 files — kept as text (add an enum to make it a select)
✓ git: clean working tree on main · remote origin (github.com)
```

Even here: lead with the outcome, one line per fact, say how to fix what's
flagged, no exclamation marks, no emoji beyond ✓ and !.
