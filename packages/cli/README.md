# galley-cms

The `galley` command: opens a site in the browser, runs Galley for a team,
writes a starter config, checks a site, and starts new sites. It wraps the
engine (`@galley/core`) and the server (`@galley/server`); argument parsing is
`node:util`'s `parseArgs`, with no other dependency.

Not published yet. From the repository:

```sh
node packages/cli/bin/galley.js --help
node packages/cli/bin/galley.js doctor starters/astro-starter
```

`bin/galley.js` runs the bundle in `dist/galley.mjs` when it exists, and the
TypeScript source through `tsx` otherwise — so delete `dist/` after building
it, or it hides changes to the source. Once published, `npx galley-cms` will run
the same thing.

| Command | Does |
| --- | --- |
| `galley [path]` | Open the site in `path` (default: this folder) and the browser, on 127.0.0.1 |
| `galley serve` | Hosted mode, behind `GALLEY_PASSWORD` |
| `galley init [path]` | Write `galley.config.json` from what detection finds |
| `galley doctor [path]` | Check the site and this computer |
| `galley new <name>` | Start a new site from a starter (`--starter`, `--look`), with its own name and no pending changes |
| `galley starters` | List the starters and the looks each one ships |
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

The published package is the bundle alone: `bin/galley.js` and `dist/`
(`galley.mjs`, `web/`, `starters/`, `overlay.js`, `LICENSE`, `NOTICE`). It
has no runtime dependencies — the engine, server and MCP packages are bundled
in, so they are `devDependencies` here. npm never packs a `.gitignore`, so
the build stores each starter's as `gitignore` and `galley new` puts the dot
back.
