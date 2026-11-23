# Releasing

Nothing has been released yet. This is the checklist for the first release and
the ones after it — what has to be true, and the steps, in order. Items marked
**(first release)** are one-time work that hasn't been done.

## What a release is

One version number for the whole project, `MAJOR.MINOR.PATCH`, tagged
`vMAJOR.MINOR.PATCH` on `main`. It produces:

| Artifact | From | Where it goes |
| --- | --- | --- |
| `galley-cms` — the `galley` command | `packages/cli`: the single-file bundle `dist/galley.mjs`, with `web/`, `starters/` and the overlay beside it | npm |
| `@galley/adapter-kit` — the conformance kit | `packages/adapter-kit` | npm |
| Desktop installers | `apps/desktop`, built by `.github/workflows/desktop.yml` on the tag | the GitHub release |
| The container image | `Dockerfile` | a registry (not chosen yet) |
| The website and documentation | `apps/site` | the site's host |

The engine, server, web UI and overlay are not published on their own: they
are inside the CLI bundle. Their packages stay `"private": true`.

## Before the first release (first release)

- [ ] The repository is public at the address in `apps/site/src/data/site.json`
      (`repository`), with private vulnerability reporting turned on, and the
      `securityContact` and `conductContact` placeholders in that file
      replaced with real addresses (and mentioned in `SECURITY.md` and
      `CODE_OF_CONDUCT.md`).
- [ ] The npm names `galley-cms` and the `@galley` scope belong to the
      project's npm organisation.
- [ ] `packages/cli/package.json` can be installed from npm: it lists
      `@galley/core` and `@galley/server` as `dependencies`, which are private
      workspace packages. Since the bundle contains them, move them to
      `devDependencies` (or publish them).
- [ ] `packages/adapter-kit/package.json` exports TypeScript source
      (`./src/index.ts`) and depends on the private `@galley/core`. Publish
      compiled JavaScript with its types, with what it needs from the engine
      bundled or published.
- [ ] Remove `"private": true` from `packages/cli` and `packages/adapter-kit`
      only.
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
2. **Choose the version** — while 0.x, a minor bump for any change to
   `galley.config.json`, the HTTP API, the adapter API (`ADAPTER_API_VERSION`)
   or a CLI option; a patch otherwise.
3. **Set it everywhere** — one commit, "Release X.Y.Z":
   - `VERSION` in `packages/core/src/brand.ts` (the server, the CLI's
     `galley version` and the website read it from there);
   - `version` in the root `package.json` and every workspace `package.json`
     under `packages/`, `apps/` and `examples/` (the desktop app's
     `tauri.conf.json` reads `apps/desktop/package.json`);
   - `version` in `apps/desktop/src-tauri/Cargo.toml`;
   - the starter keeps its own version (`starters/astro-starter`), changed
     only when the starter changes.
4. **Changelog** — in `CHANGELOG.md`, rename *Unreleased* to
   `X.Y.Z — YYYY-MM-DD` and check every entry against what is merged. The
   website's `/changelog/` page is built from this file.
5. **Build the CLI bundle** and try it from a clean folder:
   ```sh
   pnpm --filter @galley/web build
   pnpm --filter galley-cms build
   node packages/cli/dist/galley.mjs version
   node packages/cli/dist/galley.mjs doctor <a copy of the starter>
   ```
   Then delete `packages/cli/dist`: `bin/galley.js` prefers the bundle when it
   exists, which would hide source changes in development.
6. **Tag and push** `vX.Y.Z`. The desktop workflow builds the installers for
   macOS (Apple silicon and Intel), Windows and Linux and uploads them.
7. **Publish to npm with provenance**, from CI rather than a laptop:
   `npm publish --provenance --access public` in `packages/cli` (after the
   bundle is built) and `packages/adapter-kit`, from a workflow with
   `permissions: id-token: write`. No release workflow exists yet; write one,
   or publish these two by hand from a clean checkout of the tag.
8. **The container**: build from the tag, run the health check, push with the
   version and `latest` tags.
9. **The website**: build and deploy `apps/site` (`.github/workflows/site.yml`
   can deploy it to GitHub Pages). On the first release, update
   `src/data/site.json`: `status`, `statusNote`, and `installCommand` if it
   changes; then remove the "nothing is published yet" notes from the docs
   (`grep -rn "once published\|not on npm\|Nothing is on npm" apps/site/src`).
10. **The GitHub release**: the changelog entry as its notes, the installers
    attached, and plainly whether they are signed.

## After a release

- Open a new *Unreleased* section at the top of `CHANGELOG.md`.
- A security fix gets a patch release and an advisory
  (see [SECURITY.md](./SECURITY.md)).
