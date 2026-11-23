# galley-cms

[Galley](https://galley.fictiontribe.com) is an open-source AI CMS for Astro:
change a page in a form, on the page or by asking, check every change in
Proof beside the live site, then publish it to your own git repository.
Everything stays on your computer.

A new site, from one of Galley's starters, with Galley running on it:

```sh
npm create galley@latest
```

An Astro site you already have — run this in its folder:

```sh
npx galley-cms
```

It needs Node 20.11 or newer (22.23.4 for the starters, which are Astro 7
sites) and git. There are no install scripts and nothing native: the package
is one bundled file with the web app and the starters beside it.

Inside this repository, before anything is published:

```sh
node packages/cli/bin/galley.js --help
node packages/cli/bin/galley.js doctor starters/astro-starter
```

`bin/galley.js` runs the bundle in `dist/galley.mjs` when it exists, and the
TypeScript source through `tsx` otherwise — so delete `dist/` after building
it, or it hides changes to the source.

| Command | Does |
| --- | --- |
| `galley [path]` | Open the site in `path` (default: this folder) and the browser, on 127.0.0.1 |
| `galley serve` | Hosted mode, behind `GALLEY_PASSWORD` |
| `galley init [path]` | Write `galley.config.json` from what detection finds |
| `galley doctor [path]` | Check the site and this computer |
| `galley new [name]` | Start a new site from a starter (`--starter caddow`, `ferrow`, `lowfield` or `storefront`; `--look`, `--use`, `--no-install`, `--no-open`): asks for what's missing in a terminal, installs with the package manager that ran it, records the first version and opens Galley on it. `npm create galley` runs this |
| `galley starters` | List the starters: what each is, what's inside, its looks and the command that makes a site from it |
| `galley mcp [path]` | Let an AI tool edit the site over the Model Context Protocol (`galley mcp config`, `galley mcp token`) |
| `galley schema` | Print the JSON Schema of `galley.config.json` (what `$schema` in the file points at). `--out <folder>` writes every schema the app's files name (`galley.config.json`, `brand.json`) and lists the address each must be served at |
| `galley version` | Print the version |
| `galley desktop` | The server for the desktop app (not for people) |

Every option, with the real help text: the documentation's *Command line*
page (`apps/site/src/content/docs/reference/cli.md`).

## Build and test

```sh
pnpm --filter galley-cms test         # vitest
pnpm --filter galley-cms typecheck
pnpm --filter @galley/web build && pnpm --filter galley-cms build   # dist/galley.mjs, with web/, starters/ and the overlay beside it
```

Exit codes: 0 success, 1 it couldn't do it, 2 the command was typed wrong. A
setting the operator got wrong (a brand file, a port range) is one plain line
and exit 1, never a stack trace.

## What `npm pack` publishes

`prepack` (`node build.mjs --release`) builds the web UI, the bundle, the
site kit and the starters into `dist/`; `postpack` deletes `dist/` again.
The tarball is `bin/galley.js` and `dist/` (`galley.mjs`, `web/`,
`starters/`, `overlay.js`, `LICENSE`, `NOTICE`), about 13 MB. It has no
runtime dependencies — the engine, server and MCP packages are bundled in, so
they are `devDependencies` here. The starters are copied as git lists them,
never what else is in their folders. npm never packs a `.gitignore`, so the
build stores each starter's as `gitignore` and `galley new` puts the dot back.

`node scripts/verify-pack.mjs <tarball>…` checks a packed tarball before it
is published (the release workflow runs it): nothing private, no tests or
source maps, no paths from the machine that built it, the size limit, and
that it starts. See [RELEASING.md](../../RELEASING.md).
