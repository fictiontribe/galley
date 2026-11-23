# Galley — positioning and messaging

Source copy for the marketing site, docs, listings and decks. Every claim here
is backed by `docs/ARCHITECTURE.md`; if the product changes, change this file.
Voice rules: [voice.md](voice.md).

**Line:** Prompt it. Proof it. Publish it.
**Descriptor:** The AI CMS for static sites.
**Maker credit:** Galley by Fiction Tribe.

---

## Descriptions

**One sentence**

> Galley is the AI CMS for static sites: anyone on the team can change the
> site by typing, clicking or asking, see exactly what changed, and publish —
> while the content stays in your git repo as plain files.

**One paragraph**

> Galley is the AI CMS for static sites. Point it at a site and it works out
> the content model on its own — no schema to write. Then anyone can change
> the site three ways: type in a form, click text on the live page, or ask the
> assistant in chat. Every change waits in a proof — the proposed page beside
> the live one, plus a plain-language list of what changed — until someone
> presses Publish. Underneath it's just your repo: markdown, clean diffs, no
> database, no lock-in.

**100 words**

> Galley is the AI CMS for static sites. Developers keep the stack they chose —
> Astro and friends, content in git. Editors finally get a way in. Open a site
> and Galley detects its collections and fields by itself. Change it by typing
> in a form, retyping text on the page, or asking the assistant. Before
> anything goes live, the proof shows exactly what changed: the proposed page
> next to the live site, and every edit in plain words. Publish makes it live;
> Undo takes it back. Edits are surgical — one value changed means one value
> changed. Desktop app, command line, or hosted.

---

## Headlines

Five options, each built on the proof idea. Headline + subhead pairs; use one
per page.

1. **Prompt it. Proof it. Publish it.**
   The AI CMS for static sites. Change your site by typing, clicking or
   asking — check exactly what changed — then publish. It's just your repo
   underneath.

2. **Every change is a proof.**
   Galley shows the change before the world does: the proposed page beside the
   live one, and every edit marked up in plain words. Nothing goes live until
   you press Publish.

3. **Nothing goes live unproofed.**
   Your team can edit the static site your developers built — in a form, on
   the page, or in chat — and see every word that changed before it ships.

4. **The blue pencil for static sites.**
   Editors mark it up. Galley sets it. Your repo keeps it. No database, no
   migration, no learning git.

5. **Mark it up. Send it live.**
   Click the text you want to change and retype it, or just ask. Galley turns
   it into a clean, reviewable change to your content — and publishes it when
   you say so.

Supporting lines (sections, ads, social): "See it before they do." · "It's
just your repo." · "You can't break it. You can see everything." · "Edits as
small as the change you made." · "Zero config, then config." · "Content in
git. Editors in charge."

---

## Audiences

### Editors and marketers

**Pains**
- Every small text change waits in a developer's queue.
- The site's CMS (if there is one) is a form far away from the page; you
  can't see what you're changing until it's live.
- Fear: one wrong click and the site breaks, and nobody can say what changed.

**Promise**
You can change the site yourself, see exactly what you changed, and you can't
break anything. You never have to learn git.

**Proof points**
- Three ways in: a form generated from your content, **click-to-edit on the
  live page**, or **ask the assistant** in plain language.
- **The proof**: your proposed page next to the live site, and a list of every
  change in content terms — "Home › Hero › Heading" — with before and after.
- Nothing is live until you press **Publish**; any unpublished change can be
  **discarded**, any assistant turn **undone**, any publish **undone** from
  **Version history**.
- The assistant asks when a request is ambiguous ("Which pricing page?")
  instead of guessing, and never says it changed something it didn't.
- Generate images from a description, right in the media library.

### Developers

**Pains**
- You picked a static stack for speed, simplicity and owning your content —
  and now you're the CMS.
- Most CMSs want a database, an API, a schema written twice, or editable-region
  markup through your templates.
- Tools that rewrite files leave noisy diffs: reordered keys, lost comments,
  re-quoted strings.

**Promise**
It's just your repo: markdown and data files, clean diffs, no lock-in, no
database. Your site previews with its own dev server.

**Proof points**
- **Zero config, then config.** Detection reads your framework, your content
  collections and the content itself; Astro's `content.config` is read
  statically (never executed). Eleventy, Hugo, Jekyll, Next, Nuxt Content,
  SvelteKit and Docusaurus are detected too. `galley.config.json` exists only
  to correct or extend what was found.
- **Surgical edits.** Changing a value changes those bytes and nothing else.
  Comments, quoting style, key order and the markdown body survive
  byte-identical. A diff bigger than the change is treated as a bug.
- **The working tree is the draft.** A pending change is an uncommitted change;
  publishing is a commit (and push), or a branch and pull request if you
  want to review first. Undoing a publish is a revert — history is never
  rewritten, nothing is force-pushed.
- **Closed write surface.** In content mode, only content and media can be
  written. `.git/`, `node_modules/`, `.env*` and lockfiles are never written.
  The assistant has no shell and no network tool.
- Runs as `npx galley` in the site folder, as a desktop app, or hosted.

### Agency owners

**Pains**
- Handing over a fast static site means handing over a support contract for
  every typo fix — or bolting on a CMS that erodes the speed you sold.
- Every client site is configured differently; CMS setup is unbillable
  overhead.
- You need something you can put your name on.

**Promise**
Ship the static site you wanted to build, and hand over editing that clients
can't break — under your brand.

**Proof points**
- **No per-site schema work** for common setups: open the site and it's
  editable. Configure only the exceptions.
- **White-label:** a deployment can replace the product name, logo and accent
  colour with a brand file; the interface re-derives every accent shade and
  keeps text legible automatically.
- **Pull-request mode** keeps your team in the loop: client changes arrive as
  reviewable branches, not surprise deploys.
- **Build a new site from a brief:** a starter is copied and the assistant
  builds it while the preview fills in — a fast first draft for pitches and
  small sites.
- Content stays in the client's repo in plain files. If they leave, nothing is
  trapped.

---

## Features → benefits

| Feature | What it does | Why it matters |
| --- | --- | --- |
| **Zero-config detection** | Reads the framework, content collections and the shape of the content; infers field types (dates, images, links, long text, lists, page sections). | Open a site and start editing in minutes. No schema to write or keep in sync. |
| **Form editing** | Generates fields from the inferred model: text, selects, toggles, images, lists, page sections, and a markdown body. | Editors fill in fields instead of editing files. Each field shows its key for developers. |
| **Click-to-edit on the live page** | Hover outlines text on the real page; click to retype it in place. When the same text appears more than once, Galley asks which one. | Edit where you see it. No hunting for the right field. |
| **Chat editing** | An assistant that reads before it edits, asks one short question when unsure, quotes the new text, and can be undone turn by turn. | Ask for what you want in plain words. Bulk or fiddly changes become one sentence. |
| **Proof view** | A plain-language list of every change, the proposed page beside the deployed site, per-file detail, and discard per file. | See exactly what will change — and only that — before anyone else does. |
| **Publish, Undo, Version history** | Publish commits (and pushes, or sends a branch for review as a pull request). Undo a publish with a new version. Browse what was published, when and by whom. | Safe to try things. Every published state can be returned to. |
| **Image generation** | Describe an image; pick from candidates; save it into the site's media. Works offline with placeholder images when no provider is set. | Fill a gap without leaving the editor or hunting stock sites. |
| **Build a site from a brief** | Copies a starter and lets the assistant build the site, with the preview filling in as it goes. | A credible first draft fast — still a normal repo you own. |
| **Desktop, CLI, hosted** | One engine: `npx galley` in a site folder, a desktop app with a native folder picker and OS keychain, or a password-protected hosted URL. | Developers stay in the terminal, editors get an app, teams get a link. |
| **White-label** | Product name, logo and accent colour come from a brand file; no string hard-codes the name. | Agencies hand over editing under their own brand. |

---

## How it compares

Category-level and factual. Every category below is good at things Galley
doesn't try to do; say so when it's true.

| | Hosted git-based visual editors | Open-source git CMSs | Traditional & headless CMSs | AI site builders | **Galley** |
| --- | --- | --- | --- | --- | --- |
| Where content lives | Your git repo | Your git repo | The CMS's database, served by API | The builder's platform | **Your git repo, as plain files** |
| Setup per site | Usually configuration files and/or editable-region markup | A config file describing every collection and field | Content modelling + migrating content in | None — the site starts there | **Detected automatically; config only to correct it** |
| Editing | Visual and form editing | Form editing in an admin page | Form editing, rich workflows | Prompting and visual editing | **Form, click-on-the-page, and chat** |
| Reviewing a change | Varies; often a preview of the page | A preview pane | Drafts and preview environments | Varies | **Proof: proposed vs live side by side, plus a plain-language change list** |
| Leaving | Content stays in your repo | Content stays in your repo | Export and migrate | Export varies by platform | **Nothing to leave: it's your repo** |

**Against hosted git-based visual editors.** These share Galley's premise —
content in git — and are mature, with hosted infrastructure and team
features. Galley differs in needing no per-site configuration for common
setups, in running locally or self-hosted, and in treating AI editing and the
proof as the centre of the product rather than an add-on.

**Against open-source git CMSs.** These are free, proven, and add an admin
page to the site itself. They require a configuration file that describes
every collection and field, and their previews are usually approximations of
the page. Galley infers the model, previews with the site's own dev server,
and adds click-to-edit and chat. It does run a process (the app, the CLI or a
server), where an admin page doesn't.

**Against traditional and headless CMSs.** These are the right choice when
content must serve many channels through an API, or when you need roles,
scheduled publishing, localisation workflows and large editorial teams. They
also mean a database, a content API and a migration. Galley keeps content
where a static site already keeps it and adds no infrastructure.

**Against AI site builders.** These get a non-developer from nothing to a
hosted site fastest, with hosting included. The site lives on their platform.
Galley's "build from a brief" produces a normal repository your developers can
take over, and the same editor keeps working after launch.

**When Galley isn't the right fit (say this plainly in sales).** You need
per-user roles and approval chains beyond pull requests; scheduled
publishing; multi-locale editorial workflows; content delivered to apps and
other channels via API; or your site isn't in a git repository and won't be.

---

## FAQ

**Do I need to know git?**
No. Editors see Changes, Proof, Publish, Discard, Undo and Version history.
Git does the work underneath; you never type a git command.

**Will it mess up our files?**
Edits are surgical: changing one value changes only those bytes. Comments,
quoting, key order and the markdown body are preserved byte-for-byte. Galley
never writes to `.git/`, `node_modules/`, `.env` files or lockfiles.

**Which frameworks does it work with?**
Astro is first-class, including its content collections. Eleventy, Hugo,
Jekyll, Next, Nuxt Content, SvelteKit and Docusaurus sites are detected from
their conventional content folders. Any folder of markdown files with front
matter is treated as a collection.

**Do I have to configure anything?**
Usually not. Galley reads the site's framework, collections and content and
infers the fields. Add a `galley.config.json` only to correct or extend what
it found; `galley init` writes a starter from what was detected.

**Is there a database? Where is our content?**
No database. Content stays in your repository as the markdown, YAML, JSON or
TOML files it already is. An unpublished change is simply an uncommitted
change in the working copy.

**How does the preview work?**
Galley runs your site's own dev server and shows it beside the editor, so the
preview is exactly your site — no separate renderer. The proof can also show
your deployed site next to the proposed one.

**Can we review changes before they go live?**
Yes. Every change waits in the proof until someone presses Publish. In
pull-request mode, publishing pushes a new branch and hands you the pull
request (or a ready-to-open compare link) instead of changing the live site
directly.

**Can I undo a publish?**
Yes. Undoing a publish creates a new version that reverses it. History is
never rewritten, and every published version is listed in Version history.

**What can the assistant do — and not do?**
It reads, searches, edits and creates content and images through the same
guarded functions the editor uses. In content mode it can only touch content
and media; it has no shell and no network access; it asks when a request is
ambiguous; and it never says a change was made unless the edit was accepted.
Every assistant turn can be undone on its own.

**Which AI does it use? Do we need an API key?**
The assistant runs on Anthropic's Claude models with your own API key; the
model and effort level are settings. Image generation can use an OpenAI or
Google key, or an offline placeholder mode. Keys are stored locally (in the
OS keychain in the desktop app) and are never sent to the browser.

**Where does Galley run?**
Three ways, one engine: `npx galley` in your site's folder; a desktop app; or
hosted at a URL behind a password. Locally, everything binds to your own
machine.

**Can we put our own brand on it?**
Yes. A brand file replaces the product name, logo and accent colour. The
interface is built so text stays legible whatever accent you choose.

---

## Boilerplate

**Short (≈ 35 words)**
Galley is the AI CMS for static sites. Teams change a site by typing, clicking
or asking, proof exactly what changed, and publish — while content stays in
git as plain files. Galley is made by Fiction Tribe.

**Long (≈ 80 words)**
Galley is the AI CMS for static sites. It detects a site's content model
automatically and gives editors three ways to change it — a generated form,
click-to-edit on the live page, and an assistant in chat. Every change waits
in a proof that shows the proposed page beside the live one before anyone
presses Publish. Content stays in the site's git repository as plain files,
with no database and no lock-in. Galley runs as a desktop app, from the
command line, or hosted, and is made by Fiction Tribe.
