---
title: "Galley: context for an AI coding agent"
description: A brief an AI coding agent can follow to install and operate Galley on a person's site. Served as /agent.md.
noindex: true
---

# Galley: context for an AI coding agent

You are helping a person run Galley {version} on their website. Read this whole file before you run anything. The full documentation is at {site}/docs/, the index for agents is {site}/llms.txt, and the whole site is one file at {site}/llms-full.txt.

> Galley is pre-release ({version}) and not on npm yet: it runs from a clone of its repository. Below, `galley` means `node <clone>/packages/cli/bin/galley.js` (or an alias to it). If a command below fails, say so plainly to the person — do not invent a workaround.

## What it is

An AI CMS for static sites whose content lives in git. Galley detects a site's framework, content collections and fields by itself, then lets people change the site three ways — a generated form, click-to-edit on the live preview, or an assistant in chat. Every change is an **uncommitted change in the working tree**; the **proof** shows it (a plain-language change list, the proposed page beside the deployed site, per-file diffs); **Publish** is `git commit` plus `git push`, or a new branch and a pull request.

Astro is first-class: `src/content.config.ts` is parsed statically (never executed) and zod schemas become form fields; discriminated unions become page sections. Eleventy, Hugo, Jekyll, Next.js, Nuxt Content, SvelteKit and Docusaurus get basic detection; any folder with two or more markdown files with front matter becomes a collection.

## Before you start

1. Confirm the site is a git repository (`git rev-parse --show-toplevel`). Galley publishes by committing; it does not work outside git.
2. Check `git status`. Tell the person about uncommitted changes before you start: Galley will show them as pending changes in its proof, and Publish could include them.
3. Check Node.js is 20.11 or newer (`node --version`).

## Setting it up

1. **Get Galley** (once, anywhere outside the person's site):

   ```sh
   git clone {repository}.git galley
   cd galley
   corepack enable
   pnpm install
   pnpm --filter @galley/web build
   alias galley="node $PWD/packages/cli/bin/galley.js"
   ```

2. **See what detection found, without opening anything:** `galley doctor <site folder>` — framework, package manager, dev and build commands, collections with entry counts and fields, media folders, detection's notes, git state and the assistant's key.
3. **Open the site:** `galley <site folder>` — starts the site's own dev server behind a preview proxy, binds to `127.0.0.1`, and opens the editor in a browser with a session token in the address. It runs until stopped with Ctrl+C. `--no-open` prints the address instead; `--port` picks the port.
4. **No site yet:** `galley new <name> --starter <id>` copies a starter (`galley starters` lists them: `astro-editorial` Caddow, `astro-saas` Ferrow, `astro-starter` Lowfield Studio), installs it, records a first version and opens it.
5. **Write a config to correct detection:** `galley init <site folder>` writes `galley.config.json` from what was detected. Edit only what is wrong; precedence is config > schema > inferred.
6. **Host it for a team:** `GALLEY_PASSWORD=<at least 12 characters> galley serve` — hosted mode refuses to start without a password.
7. **The assistant** needs an Anthropic API key, entered in Galley's Settings or set as `ANTHROPIC_API_KEY`. Everything except asking for changes works without one.

The quickstart walks a person through the same steps: {site}/docs/getting-started/quickstart/

## Rules to follow

1. **Never publish on the person's behalf.** Publishing is their button. You may prepare changes; they press Publish.
2. **Never commit, push or force-push Galley's pending changes yourself.** The working tree is Galley's draft. If you must commit your own work, tell the person first and keep it separate from their content edits.
3. **Never write secrets into files.** API keys go in Galley's Settings or the environment, never in `galley.config.json`, the repository, or a chat.
4. **Don't hand-edit what Galley manages while it runs** unless asked. If you do edit content files, Galley's watcher shows the change in its proof as an external edit — say so.
5. **Keep `galley.config.json` minimal.** It exists to correct or extend detection, not to restate it. Validate it by running `galley doctor` afterwards.
6. **Don't add Galley to the site.** It needs no dependency, integration or build plugin. If you find yourself adding one, stop.
7. **Speak the person's language.** To editors, say Publish, Changes, Proof, Discard, Undo and Version history — not commit, diff or revert.

## galley.config.json, briefly

```json
{
  "name": "My site",
  "urls": { "production": "https://example.com" },
  "publish": { "mode": "pull-request" },
  "collections": [
    { "id": "blog", "label": "Journal", "singular": "post", "url": "/journal/{slug}/" },
    { "id": "team", "url": null }
  ]
}
```

Top-level settings: `name`, `framework`, `dev` (`command`, `port`), `build` (`command`, `outDir`), `urls` (`production`, `staging`), `media` (`dir`, `publicPath`, `roots`), `publish` (`branch`, `mode`: `commit` | `pull-request`, `remote`, `push`), `ai` (`instructions`: files the assistant reads, `allowBuild`), `writable` (`content`, `build` globs), `collections` (each matched by `id`; `url: null` means no page of its own). Unknown keys are rejected with a readable message.

## What Galley never does

Executes the site's config to read it (the preview does run the site's own dev command, as `npm run dev` would); adds a dependency or build plugin; writes `.git/`, `node_modules/`, `.env*` or lockfiles; re-serialises a YAML file to change one value; rewrites git history; binds beyond `127.0.0.1` unless hosted mode is chosen.
