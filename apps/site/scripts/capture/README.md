# Re-making the app pictures

The pictures in `public/screens/`, `public/docs/` and `public/howto/` (and the words in
`src/data/howto.json`) come from `../capture-screens.mjs`, which drives a real Galley in a
browser. These are the steps to set that Galley up. Everything runs with a throwaway home, so no
real settings, keys or site lists are read or written, and every address in the pictures is made up.

You need: Node 22 or later, `pnpm install` done in this repository (for the stand-in servers'
`tsx`), network access for `npx`, `cwebp` and `webpinfo` (libwebp), and a `node_modules`
folder with `playwright-core` and its Chromium. The assistant steps need an Anthropic key.

## 1. Start everything

From the repository root. Pick the folder everything throwaway goes in, and a throwaway
password (12 characters or more) for the hosted install:

```sh
export CAPTURE_DIR=/tmp/galley-capture
export HOSTED_PASSWORD=choose-a-throwaway-one
sh apps/site/scripts/capture/start.sh sites
sh apps/site/scripts/capture/start.sh host
sh apps/site/scripts/capture/start.sh wordpress
sh apps/site/scripts/capture/start.sh hosting
ANTHROPIC_API_KEY=… sh apps/site/scripts/capture/start.sh galley
sh apps/site/scripts/capture/start.sh hosted
```

- `sites` makes the two throwaway sites with the released CLI (`galley-cms new`, Caddow and
  Lowfield) in `$CAPTURE_DIR/home/sites/`, and sets their git author to Tobiah Rusk, an invented
  person from the Caddow starter.
- `host` starts the stand-in Cloudflare (`serve-host.mts`, the engine's own test fake with a
  made-up account, `caddow.example-studio.workers.dev` and the zone `caddow.example`). It prints
  the key it accepts — a fixed test value, not a credential.
- `wordpress` starts the importer's stand-in WordPress site, Fernhill Garden Studio (12 posts,
  6 pages, 2 of them built with Elementor).
- `hosting` starts the stand-in Fly.io (and Cloudflare) that "Host the editor online" talks to
  (`scripts/rehearse-hosting.mjs`), and writes the variables `galley` needs to
  `$CAPTURE_DIR/hosting.env` (the stand-ins' addresses and the stand-in Fly.io's made-up key). Run
  it before `galley`.
- `galley` starts the released app (`npx galley-cms@0.2.0`, or `GALLEY_VERSION`) on port 4790, open
  on Caddow, pointed at the stand-ins. The key is taken from your shell's `ANTHROPIC_API_KEY` and
  given to that process only; the script reads no key file. Its log
  (`$CAPTURE_DIR/logs/galley.log`) has the `Open:` line with the token.
- `hosted` starts a hosted install (`galley serve`, no site connected) at
  `http://cms.localhost:4797`, with `HOSTED_PASSWORD` as its password, for its sign-in and first-run
  pictures. It listens on this computer only.

To keep later edits to the repository from changing a run, copy
`packages/core/test/deploy/fakes/` and `packages/import-wordpress/test/{serve-fake-site,fake-site,png}.ts`
somewhere else (with a `package.json` saying `{"type":"module"}`) and point `FAKES` / `WP_FAKES` at the
copies.

## 2. Open the second site and find the ids

```sh
export TOKEN=$(sed -n 's/.*token=\([A-Za-z0-9_-]*\).*/\1/p' "$CAPTURE_DIR/logs/galley.log" | head -1)
curl -s -X POST -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{\"path\":\"$CAPTURE_DIR/home/sites/lowfield\"}" http://127.0.0.1:4790/api/sites/open
curl -s -H "authorization: Bearer $TOKEN" http://127.0.0.1:4790/api/sites
```

## 3. Capture

From `apps/site/`, with the two ids from the last command and the key `host` printed:

```sh
GALLEY_ORIGIN=http://127.0.0.1:4790 GALLEY_TOKEN=$TOKEN GALLEY_SITE=<Caddow id> SITE_DIR=$CAPTURE_DIR/home/sites/caddow WP_SITE=<Lowfield id> WP_URL=http://127.0.0.1:4792 CF_KEY=<the stand-in key> HOSTED_URL=http://cms.localhost:4797 HOSTED_PASSWORD=$HOSTED_PASSWORD PLAYWRIGHT_MODULES=<node_modules with playwright-core> node scripts/capture-screens.mjs
```

With no step names it runs the whole session in order (about an hour; the assistant steps cost
about $0.50 together). Name steps to re-make only those; the header of `capture-screens.mjs` lists
them. Each step changes the throwaway sites as a person would, so the full run expects fresh ones.

## 4. Stop

```sh
sh apps/site/scripts/capture/start.sh stop
```

It stops what it started by PID. The throwaway sites stay in `$CAPTURE_DIR/home/sites/` for a
re-capture.

Then check every picture for anything private before keeping it, and run
`node scripts/check-docs.mjs` (the docs pictures must keep the sizes their pages declare).
