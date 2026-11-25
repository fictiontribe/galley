---
title: Modes and the write surface
description: Content mode and build mode, the writable globs each one gets, the deny-list no mode can cross, and how paths are contained to the site folder.
group: concepts
order: 5
---

This page is for developers. It explains the sixth principle — a closed write surface. Every write in Galley, whoever asks for it (the form, click-to-edit, the assistant, an API client), passes the same two checks in the engine: is the path inside the site, and may this mode write it ([`workspace/policy.ts`]({repository}/blob/main/packages/core/src/workspace/policy.ts), [`workspace/paths.ts`]({repository}/blob/main/packages/core/src/workspace/paths.ts)).

## Two modes

| Mode | May write | Used by |
| --- | --- | --- |
| **content** | the globs in `writable.content`: each collection's folder or data file, and the media folders | every conversation by default; the form; click-to-edit; media uploads |
| **build** | `writable.content` plus `writable.build` (default `**/*`: every file not on the deny-list) | the assistant when a conversation is switched to build mode; `PUT /api/sites/<id>/file` with `"mode": "build"` |

Detection writes the content globs for you. For the starter they are:

```text
src/content/pages/**
src/content/blog/**
src/content/team/**
src/data/navigation.json
src/data/site.json
public/images/**
public/**/*.{png,jpg,jpeg,gif,webp,avif,svg,ico,mp4,webm,pdf}
```

A collection added in `galley.config.json` adds its folder; `writable.content` in the config replaces the list outright. See [Assistant instructions and build mode](/docs/configuration/assistant/).

For an account **below build-mode level**, what content mode may change is a short list, not the writable files with the dangerous ones removed — because some content is run by the build (MDX runs its `import`s, `{ }` expressions and `<Component>`s; frameworks like Docusaurus, Eleventy and Jekyll run a template language in their content; Astro loads the layout and the images a Markdown page names), and a collection's folder can be the repo root. Such an account may change Markdown on Astro, on a Markdown site where the editor sees no build tool (no `package.json` with scripts or dependencies, no generator's or host's settings, no Gemfile or Python package list, no Makefile, Dockerfile or CI workflow, and no build command in the settings — a guess, so it leans to refusing; the owner can mark the collection `plain`), and in a collection the owner marks `plain`; a data file in a collection (on Astro, JSON only; never a build tool's or a host's settings file, a file in a framework's template folder, or anything in a folder whose name starts with a dot); pictures, PDFs and videos in a media folder (on Astro, also beside a collection's entries); and the redirects list (unless the settings name it like one of those files). On Astro the editor also refuses such an account's adding or changing a page's `layout` (keeping or removing one is fine), and an image it adds that the editor doesn't recognise as a picture, PDF or video in the site. On Jekyll, and on a site the editor doesn't recognise, a file other than an entry that starts with `---` is refused too: the build would turn it into a page. It may not change MDX, other frameworks' content, the site's settings or source, or the files assistants read as their instructions — STYLE.md and the other names the assistant reads, what `ai.instructions` names, the brand folder, and AGENTS.md, CLAUDE.md, GEMINI.md and their variants at any depth, a page with such a name included. It may not turn a script on, or change what one that is on runs (its settings, or whether it runs in the preview); it may turn one off, remove it, or change where it loads and how consent is asked. It may delete only what it may write. A person at build-mode level keeps their level in the app, in either mode. Some writes are held to the same list whoever is signed in: a save the previewed page asks for (click to edit, Arrange), and, on a hosted install, the assistant outside build mode — in a content conversation, in a writing batch, and for an AI client over MCP in content mode, the operator's own token included. Turning a script on, or changing what one that is on runs, needs the site to allow build mode, for everyone, owners included, locally too, as a form's custom code does; and the assistant, an MCP client or a write of the whole file (`PUT …/file`) needs build mode for it — an edit through the form, as on the Scripts screen, counts as build mode for a person at build-mode level. Otherwise, local use (where there is no account) is unaffected.

In content mode, a write anywhere else is refused:

```json
{"error":{"code":"forbidden","message":"Only content and media can be changed in content mode. Switch to build mode to change the site's code.","detail":"src/components/Header.astro"}}
```

## Who chooses the mode

- **The assistant**: each conversation starts in content mode; the person can switch it to build mode. When they do, the model is told, and the build-only tools (`list_files`, `read_file`, `write_file`, `edit_file`, `run_build`, `save_site_config`) become available. The tools being offered is a convenience for the model — the engine checks the mode again on every write, so a tool call in the wrong mode fails whatever the prompt said.
- **`"ai": { "allowBuild": false }`** turns build mode off for the site, for the assistant and for everyone else, owners included: switching is refused with *Build mode is turned off for this site, so the assistant can change content only.*, a build-mode write over the HTTP API or MCP is refused, and nobody can turn a script on, change what one that is on runs, or add custom code to a form. An owner can turn it back on in Site settings › Assistant.
- **The HTTP API**: `PUT /api/sites/<id>/file` takes `mode`, default `content`. A signed-in client may ask for `build` where the site allows it (`allowBuild`) and its account's role does. Modes protect a site from the assistant and from mistakes, not from someone who can already sign in — that is the job of [authentication](/docs/running/security/).
- **The person's role, on a hosted install**: build mode needs an editor or owner, whichever way it is asked for — the assistant, the HTTP API, custom code in a form — and a contributor's request for it is refused, never written in content mode instead. The site's settings file, `galley.config.json`, is an owner's in either mode. See [Security model](/docs/running/security/#a-hosted-install).

## The deny-list

No mode can write these, compared case-insensitively (macOS and Windows filesystems are case-insensitive), each refused with its own message:

| Path | Refused with |
| --- | --- |
| anything under `.git/` | Version-history files can't be changed from here. |
| anything under `node_modules/` | Installed packages can't be changed from here. |
| any file whose name starts with `.env` (`.env`, `.env.local`, `.env-production`, `.envrc`), and anything in a folder so named | Environment files can hold passwords and keys, so they can't be changed from here. |
| lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `Cargo.lock`, `go.sum`, …) | Lockfiles are managed by the package manager and can't be changed by hand. |
| anything inside a hidden folder (`.vscode/`, `.astro/`, …) | Files inside hidden settings folders can't be changed from here. |
| the site folder itself | The site folder itself can't be overwritten. |

One exception: in build mode, `.github/` at the top of the site is writable, because workflows are part of a site's source.

## Containment

Before any policy check, a path is normalised strictly: absolute paths, `~`, backslashes, NUL bytes and any `..` segment are refused outright (not resolved), with *That file is outside the site folder, so it can't be opened or changed here.* The path is then re-checked against its real location on disk, so a symlink inside the site that points elsewhere can't be used to escape; a dangling symlink is not followed. Writes are atomic: a temporary file, then a rename.

The same rule applies to what is shown. The editor's own routes refuse a secrets file, anything under `.git/`, and their changes; the assistant's tools don't read them; the preview refuses an address that names one. A file is taken for a secrets file by how its name starts, so a harmless `.envoy.yaml` is refused too, and so is anything in a folder named that way. It is a rule about names: a secret kept under another name (`.npmrc`, `.dev.vars`, a `.pem` or `.key` file) is not covered by it, so keep those out of the repository. And the preview runs the site's own code, so what a page shows is the site's to decide; [the levels](/docs/running/hosted/) keep people out of each other's way and are not a wall against someone who means harm.

The server sends a site's HTML, JavaScript and XML as plain text from its own origin.

## What the assistant does not have

No shell and no network tool. In build mode it can run exactly one command — the site's configured build — and read its output. Everything else it does is one of the tools listed in [Connect the assistant](/docs/reference/assistant/#what-it-can-do), each going through the checks above.

## Next

- [Never guess](/docs/concepts/never-guess/).
- [Security model](/docs/running/security/) — authentication, origins and what leaves the machine.
