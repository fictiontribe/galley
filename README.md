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

## Try it

You need Node.js 20.11 or newer and git. A new site, from one of the
starters (they are Astro 7 sites, so they need Node.js 22.23.4):

```sh
npm create galley@latest
```

A site you already have — run this in its folder:

```sh
npx galley-cms
```

It prints a link with a session token and opens your browser on it;
everything listens on `127.0.0.1`. `npx galley-cms doctor` shows what it
detected without opening anything.

To change Galley itself, run it from a clone: [CONTRIBUTING.md](CONTRIBUTING.md#dev-setup).

## Astro first, adapters for the rest

Astro is the deepest fit: Galley reads `astro.config.*`, the content config
and its zod schemas (discriminated unions become page sections) and the
routes in `src/pages` — statically — and previews with `astro dev`; the site
kit and the starters are Astro. Eleventy, Hugo, Jekyll, Next.js, Nuxt, SvelteKit
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

Version 0.1.1, on npm as `galley-cms` and `create-galley` (first released
2026-11-23).
While the version starts with `0.`, the config file, the API and the
command-line options can still change between minor versions
([what the numbers mean](RELEASING.md)).

- **Built**: editing three ways (a form, the page itself, the assistant);
  Proof; publishing to your own repository, with undo; forms and the inbox;
  scripts with consent; plugins, image and video generation among them;
  one-click deploys to Cloudflare, verified on the real service; many sites
  in one app; the macOS desktop app and the web app; MCP; three starters.
- **New, in final checks**: redirects; the brand set-up; the Search and AI
  checks; the guided move from WordPress.
- **Preview**: the page builder.
- **In progress**: deploys to Vercel (built, not yet run on the real
  service); agent-readable pages for the sites Galley builds; a switch per
  AI-crawler family; the Shopify storefront starter.
- **Not verified yet**: Windows and Linux; code signing (the desktop app is
  unsigned); the OpenAI and Google image providers; the assistant's fallback
  request profile; setting redirects on Cloudflare itself (Bulk Redirects)
  against the real service; the container image and a hosted install behind
  a reverse proxy.
- **Not on npm as packages**: the site kit `@galley/astro` (sites carry it
  vendored), `@galley/adapter-kit` and `@galley/plugin-kit`. The plugins are
  built into `galley-cms`.

Every push runs the type checks, the tests, the app build and the site build
in [GitHub Actions](.github/workflows/ci.yml). The same list, kept current,
is on [the website](https://galley.fictiontribe.com/).

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
