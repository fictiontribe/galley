# Re-making the app pictures

The pictures in `public/screens/`, `public/docs/` and `public/howto/` (and the words in
`src/data/howto.json`) come from `../capture-screens.mjs`, which drives a real Galley in a
browser. These are the steps to set that Galley up. Everything runs with a throwaway home, so no
real settings, keys or site lists are read or written, and every address in the pictures is made up.

You need: Node 22 or later, `pnpm install` done in this repository (for the stand-in servers'
`tsx`), network access for `npx`, `cwebp` (libwebp: `brew install webp`), and a `node_modules`
folder with `playwright-core` and its Chromium. The assistant steps need an Anthropic key. The
`drag` recording uses the ffmpeg Playwright installs beside its browsers, or `ffmpeg` on the PATH.

The pictures have no scroll bars and no room kept for them, whatever this computer's own setting:
the script puts a style into every page of its own browser for that. It prints the Chromium it used.

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
sh apps/site/scripts/capture/start.sh media
ANTHROPIC_API_KEY=… sh apps/site/scripts/capture/start.sh galley
sh apps/site/scripts/capture/start.sh hosted
sh apps/site/scripts/capture/start.sh second
```

- `sites` makes the two throwaway sites with the released CLI (`galley-cms new`, Caddow and
  Lowfield) in `$CAPTURE_DIR/home/sites/`, and sets their git author to Tobiah Rusk, an invented
  person from the Caddow starter.
- `host` starts the stand-in Cloudflare (`serve-host.mts`, the engine's own test fake with a
  made-up account, `caddow.example-studio.workers.dev` and the zone `caddow.example`). It prints
  the key it accepts — a fixed test value, not a credential.
- `wordpress` starts the importer's stand-in WordPress site, Fernhill Garden Studio (12 posts,
  6 pages, 2 of them built with Elementor).
- `hosting` starts the stand-in Fly.io (and Cloudflare, and a stand-in Google Cloud on port 4544)
  that "Host the editor online" talks to (`scripts/rehearse-hosting.mjs`), and writes the variables `galley` needs to
  `$CAPTURE_DIR/hosting.env` (the stand-ins' addresses and the stand-in Fly.io's made-up key). Run
  it before `galley`.
- `media` starts the stand-in bucket for the `media-bucket` step (below, "Media in a bucket"). Run
  it before `galley`.
- `galley` starts the released app (`npx galley-cms@0.4.3`, or `GALLEY_VERSION`) on port 4790, open
  on Caddow, pointed at the stand-ins. The key is taken from your shell's `ANTHROPIC_API_KEY` and
  given to that process only; the script reads no key file. Its log
  (`$CAPTURE_DIR/logs/galley.log`) has the `Open:` line with the token.
- `second` starts a second Galley on port 4802, with a home of its own, on a copy of Lowfield: the
  other computer a theme is brought into (below, "Themes").
- `hosted` starts a hosted install (`galley serve`, no site connected) at
  `http://cms.localhost:4797`, with `HOSTED_PASSWORD` as its password, for its sign-in and first-run
  pictures. It listens on this computer only.

### Pictures of what isn't released yet

`start.sh` runs the released package. To take the pictures from this repository as it is (a look
or a screen no release has yet), build the app and a bundle of the CLI once, and give `start.sh`
the bundle as `GALLEY_CLI`; every command above then runs it instead of `npx galley-cms`:

```sh
pnpm --filter @galley/web build
GALLEY_CLI_DIST=$CAPTURE_DIR/cli node packages/cli/build.mjs
export GALLEY_CLI=$CAPTURE_DIR/cli/galley.mjs
```

The bundle is a copy: later edits to the repository don't change a run in progress. The words
"captured … Galley X.Y.Z" in `howto.json` are the version that build reports, which is the last
release's until the version is raised. Say what the build was with `CAPTURE_BUILD` when you run
the capture (`CAPTURE_BUILD="built from 1a2b3c4, before 0.5.0"`): the words follow the version.

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

To try a run without touching the committed pictures, add `CAPTURE_OUT=<a folder>`: the pictures
and `howto.json` go there, in the same layout (`public/screens/…`, `src/data/howto.json`).

The script sets the app to its light appearance and the Quiet theme, so the pictures don't depend
on the install's default theme.

With no step names it runs the whole session in order (about an hour; the assistant steps cost
about $0.50 together). Name steps to re-make only those; the header of `capture-screens.mjs` lists
them. Each step changes the throwaway sites as a person would, so the full run expects fresh ones.

## Accounts (the `people` step)

The People pictures need a hosted install that already has a site, with nobody signed up yet. It
needs no code host: give a fresh data folder a site folder and list it in `sites.json`, and the
install adopts it when it starts. From the repository root, with `CAPTURE_DIR` set as above:

```sh
mkdir -p "$CAPTURE_DIR/people/sites"
git clone -q "$CAPTURE_DIR/home/sites/caddow" "$CAPTURE_DIR/people/sites/caddow"
printf '{"sites":[{"root":"%s","name":"Caddow","branch":"main"}]}\n' "$CAPTURE_DIR/people/sites/caddow" > "$CAPTURE_DIR/people/sites.json"
sh apps/site/scripts/capture/start.sh people
```

`start.sh people` starts `galley serve` on `http://cms.localhost:4801` with that data folder; its log
(`$CAPTURE_DIR/logs/people.log`) prints a one-time `Setup:` link. Give the link to the capture as
`PEOPLE_SETUP` (the step needs nothing else):

```sh
PEOPLE_SETUP=$(sed -n 's/^Setup: *//p' "$CAPTURE_DIR/logs/people.log" | head -1) PLAYWRIGHT_MODULES=<node_modules with playwright-core> node scripts/capture-screens.mjs people
```

The step creates the owner (Tobiah Rusk), invites an editor (Ines Marrow) and a contributor (Corin
Vale) and signs each in with a browser of their own, with passwords it makes and keeps nowhere; then
it captures `contributor-home`, `people` and `invite`. The link in `invite` is real for that install:
stop it (`start.sh stop`) and delete `$CAPTURE_DIR/people` afterwards. Run it on a fresh data folder
each time: the Setup: link works once.

The `dark` step (`dark-editor`, `dark-proof`) uses the ordinary local app, with changes waiting in
Proof (the `ask` step leaves some), so the whole session runs it before `publish`; it switches to
dark with the switch at the foot of the sidebar and back to light when it's done.

## Themes (the `themes` step)

The step chooses Plate, switches to dark and back, makes a theme from Quiet (named Workroom), shows
the readability check refusing a pencil too close to grey, saves the theme and exports it. The last
picture brings the exported file into another Galley, so start one more, with a home of its own, on
a copy of Lowfield:

```sh
sh apps/site/scripts/capture/start.sh second
```

Its log (`$CAPTURE_DIR/logs/second.log`) has an `Open:` line with its token; give it to the capture
as `SECOND_TOKEN`. Without it the step takes every picture but that one and says so. When it ends,
the first Galley is on Quiet and light again and Workroom is deleted from it; the second never
saves it.

## Media in a bucket (the `media-bucket` step)

The step connects a bucket, uploads a picture to it, shows where the picture is used and a delete
that is refused, and moves the repository's files to the bucket. It runs against a stand-in bucket:
the engine's own test fake, which checks every request's signature as R2 and S3 do. Start it
**before** `galley`:

```sh
sh apps/site/scripts/capture/start.sh media
```

It prints the key it accepts (fixed test values, not a credential); give them to the capture as
`MEDIA_KEY_ID` and `MEDIA_SECRET`. Without them the step takes nothing and says so.

The pictures show the bucket as a person would have it: Cloudflare R2, the account
`0123456789abcdef0123456789abcdef`, the public address `https://media.example.com`. Neither name
leads anywhere real. `start.sh media` writes `$CAPTURE_DIR/media.env`, and `start.sh galley` reads
it, so that one Galley process is started with `media-names.mjs`: a request it makes to either name
goes to the stand-in on this computer instead. Galley itself is unchanged, and nothing leaves this
computer. The capture's browser is given the same rule for `https://media.example.com`.

Run it last: it leaves Caddow with a bucket connected and its files moved there, which every
picture of the Media screen after it would show.

## 4. Stop

```sh
sh apps/site/scripts/capture/start.sh stop
```

It stops what it started by PID. The throwaway sites stay in `$CAPTURE_DIR/home/sites/` for a
re-capture.

Then check every picture for anything private before keeping it, and run
`node scripts/check-docs.mjs` (the docs pictures must keep the sizes their pages declare).
