# Galley

Galley is an open-source AI CMS for static sites whose content lives in git:
point it at a site and anyone can change it — in a form, on the page, or by
asking — check exactly what changed, and publish it as a commit.

**Prompt it. Proof it. Publish it.**

![Galley's Proof: the live site beside the proposed page, the changed headline marked.](apps/site/public/video/galley-explainer-poster.webp)

## What it does

- **Reads your site, with no configuration.** It works out the framework, the
  content collections, every field's type and the page sections from your
  schemas and the files themselves — without running any of your code.
- **Three ways to change a page.** A form generated from the content model,
  click-to-edit text in the live preview, and an assistant (Anthropic's
  Claude, with your own key) that edits through the same guarded functions.
- **Surgical edits.** Changing one value changes those bytes and nothing else:
  comments, quoting, key order and the markdown body survive byte for byte.
- **The working tree is the draft.** A pending change is an uncommitted
  change; the proof is `git diff`; Publish is `git commit` and `git push`, or
  a branch and a pull request. No database, nothing to migrate, nothing
  trapped.
- **Your own AI tool, too.** An MCP server gives Claude Desktop, Claude
  Code, Cursor, VS Code or any MCP client the same tools as the built-in
  assistant ([`docs/mcp.md`](docs/mcp.md)) — and because the draft is just
  files, any editor or script works as well.
- **Runs your way.** One command on your machine, a desktop app, or one server
  behind a password for a team. Apache-2.0, no account, no telemetry.

## Try it in 60 seconds (from source)

Nothing is published yet, so today you run Galley from a clone. You need
Node.js 22.23.4+ (Astro 7's minimum; Galley itself needs 20.11), git, and
pnpm 10 via corepack.

```sh
git clone https://github.com/fictiontribe/galley.git
cd galley
corepack enable
pnpm install
pnpm --filter @galley/web build
node packages/cli/bin/galley.js ~/sites/your-astro-site
```

It prints a link with a session token and opens your browser on it; everything
listens on `127.0.0.1`. `node packages/cli/bin/galley.js doctor <site>` shows
what it detected without opening anything; `… new my-site` starts a site from
the Astro starter.

Once the `galley-cms` package is published, the same thing will be one line in
your site's folder:

```sh
npx galley-cms
```

## Built for Astro, adapters for the rest

Astro is the framework Galley is built around and tested against: it reads
`astro.config.*`, the content config and its zod schemas (discriminated unions
become page sections) and the routes in `src/pages` — statically — and
previews with `astro dev`. Eleventy, Hugo, Jekyll, Next.js, Nuxt, SvelteKit
and Docusaurus are recognised by convention, and any folder of markdown with
front matter works. Every other framework arrives through the public
[adapter API](docs/adapters.md), with a conformance kit to prove an adapter
works and a worked [Eleventy example](examples/adapter-eleventy).

Astro is a trademark of its respective owner. Galley is an independent
project, not affiliated with or endorsed by the Astro project.

## How it works

| Step | What the person does | Underneath |
| --- | --- | --- |
| **Prompt** | Edits a field, retypes text on the page, or asks the assistant | A file in the checkout changes — only the bytes that needed to |
| **Proof** | Reviews the change list and the proposed page beside the live one | `git diff` against the last commit, shown as fields |
| **Publish** | Presses Publish | `git commit` with a `Galley-Publish: 1` trailer, then `git push` — or a branch and a pull request |

Changing a page heading on the Astro starter produces exactly this:

```diff
-    heading: Make more of the *home you already have*.
+    heading: Make more of the *house you already have*.
```

The principles behind it are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## What is in the repository

| Path | What |
| --- | --- |
| [`packages/core`](packages/core) | `@galley/core`, the engine: detection, inference, surgical edits, the workspace and git, the preview, the assistant, images, settings |
| [`packages/server`](packages/server) | `@galley/server`: the HTTP API, live events, the web UI, local and hosted security |
| [`packages/cli`](packages/cli) | `galley-cms`, the `galley` command |
| [`packages/web`](packages/web) | `@galley/web`, the React UI |
| [`packages/overlay`](packages/overlay) | `@galley/overlay`, the click-to-edit script in the preview |
| [`packages/adapter-kit`](packages/adapter-kit) | `@galley/adapter-kit`, the conformance kit for adapters |
| [`packages/mcp`](packages/mcp) | `@galley/mcp`, the Model Context Protocol server behind `galley mcp` — new |
| [`packages/astro`](packages/astro) | `@galley/astro`, an optional Astro Dev Toolbar app that opens the current page in Galley — new |
| [`apps/desktop`](apps/desktop) | the desktop app (Tauri 2, Rust) |
| [`apps/site`](apps/site) | the website and documentation — itself a site Galley can edit |
| [`starters/astro-starter`](starters/astro-starter) | the Astro site `galley new` copies |
| [`examples/adapter-eleventy`](examples/adapter-eleventy) | a worked adapter |
| [`brand`](brand) | the brand guide, voice, tokens and logo |

## Status

Pre-release. Honestly:

- **Done and tested**: the engine; the server; the CLI; the Astro starter; the
  adapter API and conformance kit; the desktop app on macOS; the web UI's
  shell, Sites, site home, settings, version history and editor container.
- **In progress**: the web UI's content form, media library, chat, proof,
  preview pane and new-site screen; the MCP server (`galley mcp`, over stdio
  or HTTP — usable from source, still being finished; no OAuth for remote
  connectors yet); the optional `@galley/astro` toolbar app.
- **Not verified yet**: the assistant's fallback request profile (the normal
  one has been run against the live Anthropic API); the OpenAI and Google
  image providers; the `Dockerfile` (never built); Windows and Linux; hosted
  previews behind a reverse proxy or a fixed port mapping (they use random
  ports today); code signing.
- **Not published**: no npm package, no public repository, no website yet.

Tests, as last run on the build machine (macOS, Node 23.6, 2026-11-23) with
`pnpm -r --no-bail --if-present test` — all passing:

| Package | Tests |
| --- | ---: |
| `packages/core` | 503 in 35 files |
| `packages/server` | 281 in 12 files |
| `packages/web` | 136 in 13 files |
| `packages/cli` | 63 in 3 files |
| `examples/adapter-eleventy` | 34 in 1 file |
| `packages/mcp` | 32 in 3 files |
| `packages/overlay` | 28 in 3 files |
| `packages/adapter-kit` | 25 in 3 files |
| `packages/astro` | 23 in 4 files |

`pnpm -r --if-present typecheck` passed in every package on the same day.
Several packages were still changing then — an earlier run had one failing
engine test and a type error in `packages/web`'s tests, both fixed since. CI
has not run yet.

What is missing is in [ROADMAP.md](ROADMAP.md); what the first release will
contain, in [CHANGELOG.md](CHANGELOG.md).

## Development

```sh
pnpm install --frozen-lockfile
pnpm -r --if-present typecheck
pnpm -r --if-present test
pnpm --filter @galley/web build
pnpm --filter @galley/site build     # checks the docs against the code, then builds the site
pnpm dev                             # the server from source, on the site in GALLEY_SITE or this folder
```

[CONTRIBUTING.md](CONTRIBUTING.md) has the setup per package, the checks a
pull request must pass, the code and copy conventions, and how to propose an
adapter. Every commit is signed off under the [DCO](DCO).

## Licence and trademarks

Galley is licensed under the [Apache License 2.0](LICENSE); see also
[NOTICE](NOTICE). "Galley" and the Galley logo are marks of Fiction Tribe —
[TRADEMARKS.md](TRADEMARKS.md) says how they may be used. Security reports:
[SECURITY.md](SECURITY.md). Everyone follows the
[Code of Conduct](CODE_OF_CONDUCT.md).

Made by [Fiction Tribe](https://fictiontribe.com).
