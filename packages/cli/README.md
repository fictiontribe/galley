<div align="center">

<a href="https://galley.fictiontribe.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/fictiontribe/galley/main/brand/logo/lockup-reverse.svg">
    <img src="https://raw.githubusercontent.com/fictiontribe/galley/main/brand/logo/lockup.svg" alt="Galley" width="200">
  </picture>
</a>

<p><strong>galley-cms</strong> · the open-source AI CMS for static sites<br>
Prompt it. Proof it. Publish it.</p>

<p>
<a href="https://www.npmjs.com/package/galley-cms"><img alt="galley-cms on npm" src="https://img.shields.io/npm/v/galley-cms"></a>
<a href="https://github.com/fictiontribe/galley/actions/workflows/ci.yml"><img alt="CI on main" src="https://github.com/fictiontribe/galley/actions/workflows/ci.yml/badge.svg?branch=main"></a>
<a href="https://github.com/fictiontribe/galley/blob/main/LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/npm/l/galley-cms"></a>
<a href="https://nodejs.org"><img alt="Node.js 20.11 or newer" src="https://img.shields.io/node/v/galley-cms"></a>
</p>

<p>
<a href="https://galley.fictiontribe.com">Website</a> ·
<a href="https://galley.fictiontribe.com/tour/">Tour</a> ·
<a href="https://galley.fictiontribe.com/docs/">Docs</a> ·
<a href="https://github.com/fictiontribe/galley">GitHub</a>
</p>

</div>

<p align="center">
  <img src="https://raw.githubusercontent.com/fictiontribe/galley/main/apps/site/public/screens/form.webp" width="760" alt="Galley's editor on Caddow, a made-up fashion label's site. On the left, a form for the home page with the heading field marked Edited; on the right, the page itself with the new heading “Coats for low sun.”">
</p>

Galley opens a site whose content lives in git and lets anyone change it —
in a form, on the page or by asking the assistant. You check every change in
Proof beside the live site, then publish it as a commit to your own
repository. It runs on your computer.

## Run it

In a site you already have, run this in its folder:

```sh
npx galley-cms
```

Galley opens in your browser on `127.0.0.1`, ready to edit the site. For a new
site from one of the starters, use
[`create-galley`](https://www.npmjs.com/package/create-galley):

```sh
npm create galley@latest
```

It needs Node.js 20.11 or newer and git (22.23.4 or newer for the starters,
which are Astro 7 sites). There are no install scripts and nothing native:
the package is one bundled file, with the web app and the starters beside it.

## Commands

| Command | Does |
| --- | --- |
| `galley [path]` | Open the site in `path` (default: this folder) in the browser |
| `galley serve` | A hosted install: one site, behind a password, everything in its data folder. With no password yet it prints a one-time setup link; `--reset-password` makes a new one |
| `galley backup` | `create --out <file>` / `restore <file>`: a hosted install's data folder as one file sealed with a passphrase, with the server stopped |
| `galley host [path]` | Host the editor online for the site, on your own account (Fly.io, Cloudflare in front of a computer of yours, any server with Docker); `galley host recipe` writes one install's files |
| `galley init [path]` | Write `galley.config.json` from what detection finds |
| `galley doctor [path]` | Check that a site and this computer are ready |
| `galley deploy [path]` | Put the site online with Cloudflare or Vercel |
| `galley domain [path]` | Use your own domain for a site that is online |
| `galley new <name>` | Start a new site from a starter (`npm create galley` runs this) |
| `galley import …` | Bring a WordPress site into a site |
| `galley starters` | List the starters and their looks |
| `galley mcp [path]` | Let an AI tool edit the site over MCP |
| `galley plugin …` | Add plugins, list them, turn them on or off |
| `galley schema` | Print the JSON Schema of `galley.config.json` |
| `galley version` | Print the version |

`galley <command> --help` lists a command's options; every option, with the
real help text and the exit codes, is on the
[Command line](https://galley.fictiontribe.com/docs/reference/cli/) page.

## Working on Galley itself

This package is [`packages/cli`](https://github.com/fictiontribe/galley/tree/main/packages/cli)
in the Galley repository. From a clone, `node packages/cli/bin/galley.js` runs
the bundle in `dist/galley.mjs` when it exists and the TypeScript source
otherwise, so delete `dist/` after building it or it hides changes to the
source. The setup is in
[CONTRIBUTING.md](https://github.com/fictiontribe/galley/blob/main/CONTRIBUTING.md#dev-setup);
how the package is built, checked and published is in
[RELEASING.md](https://github.com/fictiontribe/galley/blob/main/RELEASING.md).

Apache-2.0. Made by [Fiction Tribe](https://www.fictiontribe.com).
