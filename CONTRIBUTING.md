# Contributing to Galley

Thank you. This page is the whole process. If something here is unclear, open
an issue and we will fix the page.

Galley is on npm as `galley-cms`; to use it, the
[README](README.md#try-it) has the one command. The setup below is for
changing Galley itself: it runs Galley from a clone.

## Dev setup

Node.js 22.23.4 or newer (the site and the Astro starter need it; the engine,
server and CLI need 20.11), pnpm 10 through corepack, and git.

```sh
git clone https://github.com/fictiontribe/galley.git
cd galley
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @galley/web build      # the UI the server hosts
node packages/cli/bin/galley.js doctor starters/astro-starter
```

`node packages/cli/bin/galley.js <site folder>` then opens a site in the
Galley you are changing.

The engine (`packages/core`) is imported as TypeScript source inside the
monorepo — there is no build step — and the CLI runs it through `tsx`. Work on
one part at a time:

| Package | Run it | Test it |
| --- | --- | --- |
| `packages/core` — the engine | through the CLI or the server | `pnpm --filter @galley/core test` |
| `packages/server` — HTTP API, events, UI hosting | `pnpm dev` (opens `GALLEY_SITE` or the current folder, state in `./.galley-home`) | `pnpm --filter @galley/server test` |
| `packages/cli` — the `galley` binary | `node packages/cli/bin/galley.js <command>` | `pnpm --filter galley-cms test` |
| `packages/web` — the React UI | `pnpm dev:web` (Vite, against a running server), or `pnpm --filter @galley/web dev:mock` (no server) | `pnpm --filter @galley/web test` |
| `packages/overlay` — the preview script | built on demand by the server | `pnpm --filter @galley/overlay test` |
| `packages/mcp` — the MCP server | `node packages/cli/bin/galley.js mcp <site>` (an MCP client starts it) | `pnpm --filter @galley/mcp test` |
| `packages/astro` — the optional Astro toolbar app | in an Astro site's `astro.config` | `pnpm --filter @galley/astro test` |
| `packages/adapter-kit` — the conformance kit | `node packages/adapter-kit/bin/galley-adapter-check.js <adapter> <fixture>` | `pnpm --filter @galley/adapter-kit test` |
| `apps/desktop` — the Tauri shell | `pnpm --filter @galley/desktop dev` (needs Rust; see its README) | `pnpm --filter @galley/desktop test:rust` |
| `apps/site` — website and documentation | `pnpm --filter @galley/site dev` | `pnpm --filter @galley/site check` |

In a terminal driven by an AI coding agent, run Astro commands (the site, the
starter) with a clean environment — `env -i PATH="$PATH" HOME="$HOME" …` —
because Astro 7 backgrounds its dev server when it sees agent variables.

## What a pull request must pass

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs, on Node 22:

```sh
pnpm install --frozen-lockfile
pnpm -r --if-present typecheck
pnpm -r --if-present test
pnpm --filter @galley/web build
pnpm --filter @galley/site build     # runs the documentation checks first
```

Run them before you open the pull request. Engine code is tested against real
files and real temporary git repositories, not mocks. A behaviour change comes
with its test; a bug fix with the test that would have caught it.

If you change a command, an option, a config key, an environment variable, a
route or a message that the documentation shows, update the page in
`apps/site/src/content/docs/` in the same pull request — `pnpm --filter
@galley/site check` fails until you do. How the docs are wired and checked:
[Contributing to the docs](apps/site/src/content/docs/project/contributing.md).

## Code conventions

From [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), which is the blueprint —
if the code and that document disagree, fix whichever is wrong in the same
pull request:

- TypeScript strict, ESM, `import type` for types, named exports only.
- No new dependency without a reason you could say out loud; prefer the
  platform. Add one with `pnpm add --filter <package> <dep>`.
- Paths in data are repo-relative POSIX; convert at the filesystem boundary.
- Throw `GalleyError` for anything a person should read. Never swallow an
  error silently; never log a secret.
- Comments explain *why*. No narration, no commented-out code, no TODOs
  without an owner.
- The product name lives in `packages/core/src/brand.ts` only. No user-facing
  string hard-codes it, and no client name, sample company or site-specific
  assumption appears in the code.
- Edits are surgical. A diff that shows more than the person changed is a bug.
- Writes stay inside the write surface. Nothing writes `.git/`,
  `node_modules/` or `.env*`, ever.

## Copy conventions

Every string a person reads follows [`brand/voice.md`](brand/voice.md):

- Editor-facing UI says **Publish, Changes, Proof, Discard, Undo, Version
  history** — never commit, diff, checkout, revert. The CLI, developer docs and
  "Technical details" may use git's words.
- Errors say what happened, then what to do, in plain words, without blame.
  Never "Something went wrong" on its own.
- Sentence case, no exclamation marks, curly quotes in UI copy, digits for
  numbers. The interface never says "we".
- It is true: a message says something happened only when it did.

## Proposing an adapter

A new framework arrives as an adapter. The guide is
[`docs/adapters.md`](docs/adapters.md); a worked example is
[`examples/adapter-eleventy`](examples/adapter-eleventy).

1. Open an [adapter request](.github/ISSUE_TEMPLATE/adapter.yml) issue first,
   with the framework's documentation and the shapes its content takes.
2. Write the adapter against the public API only (`GalleyAdapter`,
   `AdapterContext` and its helpers). If you need something the context lacks,
   propose the helper.
3. Prove it with the conformance kit on at least two small, invented fixture
   sites — no real company's content — with no failures.
4. A built-in adapter goes under `packages/core/src/adapters/<id>/` and is
   registered before the generic one; the full bar is in
   [Proposing an adapter as a built-in](docs/adapters.md#proposing-an-adapter-as-a-built-in).
   An adapter can also live in its own package, `galley-adapter-<framework>`.

## Bigger changes

Open an issue before you write a lot of code: what you want to change, why,
and the shape of the change. It saves you work the project can't take.

## Sign-off (DCO)

Every commit must carry a `Signed-off-by:` line with your real name and email,
certifying the [Developer Certificate of Origin 1.1](DCO):

```sh
git commit -s -m "Read Hugo's front matter in YAML as well as TOML"
```

There is no CLA. Inbound equals outbound: your contribution is accepted under
the Apache License 2.0, the licence of the project ([LICENSE](LICENSE)).

## Commit and pull-request style

- One change per pull request; the title says what changed, in the imperative.
- The pull-request template asks for the commands you ran and their output.
  Measure before claiming.
- Keep unrelated formatting out of the diff.

## Review

A maintainer replies to pull requests and issues; see
[GOVERNANCE.md](GOVERNANCE.md) for how decisions are made.

## Code of conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
