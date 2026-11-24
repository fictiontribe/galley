---
title: "Release process and versioning"
navTitle: "Releases"
description: "What a Galley release produces, how versions are numbered, and the checklist for cutting one — including the one-time work the first release still needs."
group: "project"
order: 2
---

<!-- Generated from RELEASING.md by apps/site/scripts/sync-docs.mjs. Edit that file, not this one. -->

> This page is [`RELEASING.md`]({repository}/blob/main/RELEASING.md) from the repository, for maintainers and anyone curious about how Galley ships.

0.1.0, the first release, went to npm on 2026-11-23 as `galley-cms` and
`create-galley`. This is the checklist for each release — what has to be true,
and the steps, in order. Items marked **(first release)** were one-time work
for 0.1.0; this file doesn't record which of them were finished.

## What a release is

One version number for the whole project, `MAJOR.MINOR.PATCH`, tagged
`vMAJOR.MINOR.PATCH` on `main`. It produces:

| Artifact | From | Where it goes |
| --- | --- | --- |
| `galley-cms` — the `galley` command, and what `npx galley-cms` runs | `packages/cli`: the single-file bundle `dist/galley.mjs`, with `web/`, `starters/` and the overlay beside it | npm, by `.github/workflows/release.yml` |
| `create-galley` — what `npm create galley@latest` runs | `packages/create-galley`: a few lines that hand over to `galley new` from `galley-cms` | npm, by the same workflow |
| Desktop installers | `apps/desktop`, built by `.github/workflows/desktop.yml` on the tag | the GitHub release |
| The container image | `Dockerfile` | a registry (not chosen yet) |
| The website and documentation | `apps/site` | the site's host |

The engine, server, web UI and overlay are not published on their own: they
are inside the `galley-cms` bundle. The `@galley/*` workspace packages
(including `@galley/adapter-kit`) are internal and stay `"private": true`.
The npm name `galley` belongs to someone else; never publish under it.

### What the version numbers mean before 1.0

While the version starts with `0.`, anything may change between minor
versions:

- **minor** (`0.1.0` → `0.2.0`): any change to `galley.config.json`, the HTTP
  API, the adapter API (`ADAPTER_API_VERSION`), a command-line option or a
  starter's name;
- **patch** (`0.1.0` → `0.1.1`): fixes, and additions that leave what is
  already there working as it did (a new command, a new optional setting);
- **release candidate** (`0.2.0-rc.1`): published under npm's `next` tag, so
  `npm create galley@latest` and `npx galley-cms` keep giving people the last
  release; `npm create galley@next` tries the new one.

`1.0.0` is the promise that the config file, the API and the options stay
compatible within a major version.

### How the starters travel

Inside `galley-cms` (`dist/starters/`), copied from git's own list of the
starters' files, so `npm create galley` works offline once npm has the
package. Measured for 0.1.0: the tarball is 13.0 MB (22.9 MB unpacked),
of which the starters are 13.2 MB unpacked — mostly the Caddow photographs,
already WebP at under 190 kB each. `verify-pack.mjs` fails the release above
15 MB. When the starters grow past that, the plan is to fetch each one from
the tagged GitHub release instead (a `starters-<id>.tgz` asset per starter,
its SHA-256 recorded in the bundle and checked after download, and a plain
sentence when the computer is offline) — not built yet, because today it
would only add a download.

## Before the first release (first release)

- [ ] The repository is public at the address in `apps/site/src/data/site.json`
      (`repository`), with private vulnerability reporting turned on, and the
      `securityContact` and `conductContact` placeholders in that file
      replaced with real addresses (and mentioned in `SECURITY.md` and
      `CODE_OF_CONDUCT.md`).
- [ ] The npm names `galley-cms` and `create-galley` are still free (they were
      on 2026-11-23), and belong to the project's npm account or organisation
      after the first publish.
- [ ] **The npm token.** On npmjs.com, signed in as the account that will own
      the packages: *Access Tokens › Generate New Token › Granular Access
      Token*, with **Read and write** permission. Before the first publish the
      packages don't exist, so choose *All packages*; after it, replace the
      token with one limited to `galley-cms` and `create-galley`. If the
      account requires two-factor authentication for publishing, tick *Bypass
      two-factor authentication* — the workflow can't type a code. Write
      tokens expire (90 days at most), so note the date. In the repository:
      *Settings › Secrets and variables › Actions › New repository secret*,
      named **`NPM_TOKEN`**. (Later, npm's *trusted publishing* can replace the
      token altogether: it trusts `release.yml` itself.)
- [ ] Run the release workflow once by hand with *Dry run* on (Actions ›
      Release › Run workflow) and download the tarballs it attaches.
- [ ] The JSON Schema is served where `galley init` points `$schema`:
      `https://galley.fictiontribe.com/schema/galley.config.json` (from
      `configJsonSchema()` in `packages/core/src/content/config/schema.ts`).
- [ ] The `Dockerfile` has been built and run, and the image has a name.
- [ ] Code-signing certificates exist for macOS and Windows, and the secrets
      named in the header of `.github/workflows/desktop.yml` are set — or the
      release notes say the installers are unsigned.

## Every release

1. **Green on `main`.** CI passes: frozen install, typecheck, tests, the web
   build, the site build with its documentation checks. Run the opt-in live
   assistant check with a real key
   (`pnpm --filter @galley/core exec tsx test/ai/live-smoke.mts`).
2. **Choose the version** (see *What the version numbers mean* above).
3. **Set it everywhere** — one commit, "Release X.Y.Z":
   - `VERSION` in `packages/core/src/brand.ts` (the server, the CLI's
     `galley version` and the website read it from there);
   - `version` in the root `package.json` and every workspace `package.json`
     under `packages/` (including `packages/create-galley`), `apps/` and
     `examples/` (the desktop app's `tauri.conf.json` reads
     `apps/desktop/package.json`);
   - `version` in `apps/desktop/src-tauri/Cargo.toml`;
   - the starters and `examples/plugin-example` keep their own versions,
     changed only when they change;
   - `KIT_VERSION` in `packages/astro/src/client/forms.js`, then copy the kit
     into the starters and the website again
     (`node packages/astro/scripts/vendor.mjs <folder>` for each of
     `starters/*` and `apps/site`), so every copy says which kit it is.
   - the repository's `docker-compose.yml`, `Caddyfile` and `.env.example`,
     which name the image's version: write them again from the recipe by
     running `packages/core/test/hosting/compose-example.test.ts` with the
     update switch its header names, in `packages/core` (without it, the same
     test fails while they disagree with the recipe).

   The release workflow refuses to publish when the tag, the two packages and
   `brand.ts` disagree.
4. **Changelog** — in `CHANGELOG.md`, rename *Unreleased* to
   `X.Y.Z — YYYY-MM-DD` and check every entry against what is merged. The
   website's `/changelog/` page is built from this file.
5. **Try the packages from a clean folder** (optional — the workflow does the
   same):
   ```sh
   mkdir -p /tmp/galley-pack
   pnpm --filter galley-cms pack --pack-destination /tmp/galley-pack
   pnpm --filter create-galley pack --pack-destination /tmp/galley-pack
   node packages/cli/scripts/verify-pack.mjs /tmp/galley-pack/*.tgz
   cd /tmp/galley-pack
   npm exec --yes --package=./galley-cms-X.Y.Z.tgz --package=./create-galley-X.Y.Z.tgz -- create-galley my-site --starter caddow
   ```
   `galley-cms`'s `prepack` builds the web UI, the bundle, the site kit and
   the starters into `packages/cli/dist`, and `postpack` deletes it again
   (`bin/galley.js` prefers the bundle when it exists, which would hide source
   changes in development). Pack `create-galley` with pnpm, not npm: pnpm
   turns its `workspace:*` dependency into the exact version.
6. **Tag and push** `vX.Y.Z`:
   ```sh
   git tag -a vX.Y.Z -m "Galley X.Y.Z"
   git push origin vX.Y.Z
   ```
   Two workflows start: `desktop.yml` builds the installers, and
   `release.yml` builds, tests, packs, verifies, makes and opens a site from
   the tarballs, then publishes `galley-cms` and then `create-galley` to npm
   with provenance (the exact tarballs it checked, also attached to the run).
7. **Check npm**: `npm view galley-cms version`, `npm view create-galley
   version`, and from an empty folder `npm create galley@latest` and
   `npx galley-cms --version`.
8. **The container**: build from the tag, run the health check, push with the
   version and `latest` tags.
9. **The website**: build and deploy `apps/site` (`.github/workflows/site.yml`
   can deploy it to GitHub Pages). On the first release, set `install.published`
   to `true` in `apps/site/src/data/site.json` — the site then shows
   `npm create galley@latest` and `npx galley-cms` instead of the
   from-a-clone steps — and update `status` and `statusNote`; then remove the
   "nothing is published yet" notes from the docs
   (`grep -rn "once published\|not on npm\|Nothing is on npm" apps/site/src`)
   and from `starters/*/README.md`.
10. **The GitHub release**: the changelog entry as its notes, the installers
    attached, and plainly whether they are signed.

## Undoing a bad release

npm never lets a version number be used twice, so a bad release is replaced,
not edited.

- **First, point people away from it** (works at any age):
  ```sh
  npm dist-tag add galley-cms@<last good> latest
  npm dist-tag add create-galley@<last good> latest
  npm deprecate galley-cms@<bad> "Broken: use <last good> or later"
  npm deprecate create-galley@<bad> "Broken: use <last good> or later"
  ```
  `npm create galley@latest` and `npx galley-cms` then fetch the good one
  again; anyone who asks for the bad version by number is warned.
- **Then fix forward**: a patch release (`X.Y.Z+1`) with the fix, which moves
  `latest` on as usual.
- **Unpublishing** (`npm unpublish galley-cms@<bad>`) is only allowed within
  72 hours and while nothing depends on the version — and `create-galley`
  depends on `galley-cms`, so unpublish `create-galley@<bad>` first. Use it
  only for something that must not stay public (a leaked secret, a licence
  problem); for anything else, deprecate. An unpublished number can never be
  published again.
- **The tag**: leave it. If no package was published from it (the workflow
  failed), delete it (`git push origin :refs/tags/vX.Y.Z`, `git tag -d
  vX.Y.Z`), fix, and tag again.

## After a release

- Open a new *Unreleased* section at the top of `CHANGELOG.md`.
- A security fix gets a patch release and an advisory
  (see [SECURITY.md]({repository}/blob/main/SECURITY.md)).
