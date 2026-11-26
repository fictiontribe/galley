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
| The container image | `Dockerfile` (`linux/amd64`, `linux/arm64`) | `ghcr.io/fictiontribe/galley`, by `.github/workflows/release.yml` |
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
package. Measured for 0.4.3: the tarball is 13.6 MB (24.5 MB unpacked), the
four starters 13.5 MB of it unpacked — mostly photographs, already WebP.
`verify-pack.mjs` fails the release above 15 MB.

A starter whose `starter.json` says `"download": true` travels apart
instead, downloaded each time a site is made from it (starters/README.md):

- `build.mjs` writes its archive, `packages/cli/starter-assets/starters-<id>.tgz`
  — a plain tar, gzipped, the same bytes for the same files on every
  system — and leaves in `dist/starters/<id>/` only what shows it, with
  `starter-download.json`: the archive's name, size and SHA-256.
- `verify-pack.mjs` checks the record against the archive, byte for byte.
- `release.yml` makes a site from each such starter with the archive served
  from the runner, then publishes the archives on a release of their own,
  `starters-vX.Y.Z` (a prerelease, so `…/releases/latest` keeps naming the
  version's release), **before** it publishes `galley-cms`. That is a job
  of its own, the only one that may write to the repository; the job that
  installs and builds has a read-only token, and npm is published by a
  third job once the archives are in place. Not on the
  version's own release: that stays a draft until a person publishes it
  (step 10), and a `galley-cms` on npm would meanwhile find nothing to
  download. Run again, an archive already on that release is kept and must
  be the same bytes.
- Making a site from it (the wizard, `galley new`, a hosted editor's first
  run, the desktop app) downloads the archive into a fresh temporary
  folder, refuses one that isn't exactly the recorded size and hash, and
  says in a plain sentence when it can't be downloaded — offline, or not
  published yet. `GALLEY_STARTER_DOWNLOADS` points it at another folder
  address (a mirror, a test).

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
- [x] macOS: the signing and notarisation secrets named in the header of
      `.github/workflows/desktop.yml` are set, and a build signed with them
      has been checked in CI.
- [ ] Windows: the Azure Artifact Signing secrets named in the same header
      are set and a build signed with them has been checked in CI — until
      then the release notes say the Windows installers are unsigned (the
      draft the workflow writes already does).

## Every release

1. **Green on `main`.** CI passes: frozen install, typecheck, tests, the web
   build, the site build with its documentation checks. Run the opt-in live
   assistant check with a real key
   (`pnpm --filter @galley/core exec tsx test/ai/live-smoke.mts`).
   Run the theme parity check too, in the newest Chromium you can get: CI
   skips it, because it needs a browser, and a new browser version can
   change what the page's colour recipes compute to (Chrome 159 did, and
   every derived colour in the app turned pink). It paints each theme's
   derived colours and compares the pixels with what the engine derives:
   ```sh
   THEME_PARITY_PLAYWRIGHT=/path/to/project pnpm --filter @galley/web exec vitest run test/themes/parity.browser.test.ts
   ```
   `/path/to/project` is any folder whose `node_modules` has
   `playwright-core` with its Chromium installed
   (`npx playwright-core install chromium`); a fresh install brings the
   newest Chromium Playwright ships, which is ahead of the one most people
   have. When it passes after the mirrored CSS changed, record the new hash
   in `packages/web/test/themes/parity-guard.test.ts`.
2. **Choose the version** (see *What the version numbers mean* above).
3. **Set it everywhere** — one commit, "Release X.Y.Z":
   - `VERSION` in `packages/core/src/brand.ts` (the server, the CLI's
     `galley version` and the website read it from there);
   - `version` in the root `package.json` and every workspace `package.json`
     under `packages/` (including `packages/create-galley`), `apps/` and
     `examples/` (the desktop app's `tauri.conf.json` reads
     `apps/desktop/package.json`);
   - `version` in `apps/desktop/src-tauri/Cargo.toml`;
   - the starters, `examples/plugin-example` and the plugins under
     `packages/plugins/` keep their own versions, changed only when they
     change;
   - `KIT_VERSION` in `packages/astro/src/client/forms.js`, then copy the kit
     into the starters and the website again
     (`node packages/astro/scripts/vendor.mjs <folder>` for each of
     `starters/*` and `apps/site`), so every copy says which kit it is.
   - the repository's `docker-compose.yml`, `Caddyfile` and `.env.example`,
     which name the image's version: write them again from the recipe by
     running `packages/core/test/hosting/compose-example.test.ts` with the
     update switch its header names, in `packages/core` (without it, the same
     test fails while they disagree with the recipe).
   - the desktop app's own entry in `apps/desktop/src-tauri/Cargo.lock`: the
     `version` line under `name = "galley-desktop"`. Other crates in that
     file can carry the same number; leave them.
   - the website's data: `version` and `released` in
     `apps/site/src/data/downloads.json`, and "Version X.Y.Z" in the summary
     in `apps/site/src/data/visibility.json`;
   - the image's tag (`ghcr.io/…/galley:X.Y.Z`) wherever it is written out:
     `docs/cloud-install.md` and
     `apps/site/src/content/docs/running/hosted.md`;
   - in `apps/site/scripts/reference-cli.mjs`, a note that calls a command
     "not in a release yet" becomes "New in X.Y.Z"; then
     `pnpm --filter @galley/site sync-docs`, which writes the command-line
     reference again (it carries the image's default tag) and the
     documentation's copy of this file;
   - the release the picture capture runs by default: the `V=` line in
     `apps/site/scripts/capture/start.sh` and the comment above it, and the
     same number in `apps/site/scripts/capture/README.md`;
   - a line under *Shipped so far* in `ROADMAP.md`;
   - "captured" in `apps/site/screens.json`, when the pictures were taken
     again for this release;
   - the website's demo, `apps/site/public/demo/`, last of all, when nothing
     else in the commit will change. It is a build of the app, and it is
     stale as soon as the version is:
     ```sh
     pnpm --filter @galley/web build:demo
     pnpm --filter @galley/web demo:publish
     pnpm --filter @galley/web demo:check
     ```
     `demo:check` passes when the committed demo was built from the files as
     they are now. Then build the site, open `/demo/` and walk its tour once.

   To find a place this list doesn't name, search for the old number:
   ```sh
   git grep -n -F "A.B.C" -- . ':!CHANGELOG.md' ':!pnpm-lock.yaml' ':!apps/site/public/demo'
   ```
   What may remain, and should: other crates in `Cargo.lock`; the old
   release's own line in `ROADMAP.md`; lines that say which release
   something arrived in ("New in A.B.C" in the command-line reference,
   "Released in A.B.C" in `apps/site/CLAIMS.md`); and the "captured" lines in
   `apps/site/screens.json` and `apps/site/src/data/howto.json`, which name
   the release the pictures were taken from until they are taken again.

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
   the tarballs, publishes `galley-cms` and then `create-galley` to npm with
   provenance (the exact tarballs it checked, also attached to the run), and
   runs the `docker` job to smoke-test `/healthz` on `linux/amd64` and push
   the multi-arch container image (`linux/amd64`, `linux/arm64`) to
   `ghcr.io/fictiontribe/galley`.
7. **Check npm**: `npm view galley-cms version`, `npm view create-galley
   version`, and from an empty folder `npm create galley@latest` and
   `npx galley-cms --version`.
   The registry accepts `galley-cms` at once and then takes some minutes
   over its tarball before anyone can install it (eight to ten, on 0.4.0,
   0.4.1 and 0.4.2). So the workflow publishes `galley-cms` under a tag of
   its own, `incoming`, which nobody asks for; waits until the registry
   lists the version and its tarball answers; then moves `latest` to it
   (`next`, for a release candidate), and only then publishes
   `create-galley`. Without that, `npx galley-cms` and
   `npm create galley@latest` both fail for everyone for as long as the
   registry takes. On 0.4.2, the first release done this way, `latest`
   stayed on 0.4.1 for the 495 seconds the registry took, and moved when the
   tarball answered.

   `incoming` is left pointing at the release: the release's token may add
   or move a tag and may not remove one (0.4.2: the removal was refused),
   and the next release moves it. So `npm view galley-cms dist-tags` shows
   `incoming` beside `latest`, both at the same version once a release is
   done. That is as meant.

   Run again from the tag (*Dry run* off), the workflow does only what is
   left, so that is the way out of each place it can stop:
   - **The wait runs out** (20 minutes at most). `galley-cms` is on npm
     under `incoming` and nothing else has changed, which breaks nothing.
     Run it again once the tarball answers.
   - **npm refuses to move the tag.** It didn't on 0.4.2: moving a tag is a
     write to the package, as publishing is. If it ever does, move it by
     hand, signed in as an owner
     (`npm dist-tag add galley-cms@X.Y.Z latest`), and run the workflow
     again: it finds the tag in place and publishes `create-galley`.
   - **A release that was finished before** (`create-galley` at that
     version is on npm) is left alone, tags and all. A run from an older
     release's tag can't bring `latest` back to it.

   To finish wholly by hand instead: `npm dist-tag add galley-cms@X.Y.Z
   latest`, then publish the `create-galley` tarball the run attached.
   `create-galley` itself is listed a few minutes after it is published
   (three and a half, on 0.4.2); until then `npm create galley@latest` gives
   the release before, which still installs.
8. **The container**: the `docker` job in `release.yml` builds `Dockerfile`
   for `linux/amd64`, starts it and checks that `GET /healthz` answers
   `{"ok":true}`, then logs in to `ghcr.io` with `GITHUB_TOKEN` and pushes a
   multi-arch (`linux/amd64`, `linux/arm64`) image tagged
   `ghcr.io/fictiontribe/galley:X.Y.Z` (plus `X.Y` and `latest` when the
   version is not a prerelease). On a dry run it builds `linux/amd64` and runs
   the `/healthz` smoke test without pushing; on a re-run for a version already
   published for both architectures it skips pushing so existing tags stay as
   they are. Confirm the published manifest with
   `docker buildx imagetools inspect ghcr.io/fictiontribe/galley:X.Y.Z` (on the
   first push, make sure the package's visibility on GitHub Packages is set to
   Public).
9. **The website**: build and deploy `apps/site` (`.github/workflows/site.yml`
   can deploy it to GitHub Pages). On the first release, set `install.published`
   to `true` in `apps/site/src/data/site.json` — the site then shows
   `npm create galley@latest` and `npx galley-cms` instead of the
   from-a-clone steps — and update `status` and `statusNote`; then remove the
   "nothing is published yet" notes from the docs
   (`grep -rn "once published\|not on npm\|Nothing is on npm" apps/site/src`)
   and from `starters/*/README.md`.
10. **The GitHub release**: `desktop.yml` leaves a draft for the tag with the
    installers that were built, `SHA256SUMS.txt`, and notes that say plainly
    which are signed. Check that every platform is there, put the changelog
    entry above those notes, and publish it. The file names carry no version
    (`Galley-mac-apple-silicon.dmg` …), so
    `…/releases/latest/download/<name>` always points at the newest.

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
