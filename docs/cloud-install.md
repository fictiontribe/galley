# The hosted install: one editor for one site

For whoever runs Galley on a server so a site can be edited from any browser,
and for whoever decides where it runs. This document says what a hosted
install is, how to run one, how to set it up, look after it, back it up,
upgrade and remove it, what it protects and what it doesn't, where it can run
and what that costs, and how the desktop app puts one online by itself. The
short, task-first version for the documentation site is
[Run a hosted install](../apps/site/src/content/docs/running/hosted.md).

> **Status.** New in 0.2.0. Covered by automated
> tests, and run for real on 2026-11-24: on the real image with a real
> browser, and as this project's own website's editor on a small Google Cloud
> VM behind Caddy on a real domain. Never run on Fly.io or with a Cloudflare
> tunnel, and the image is not published to a registry. Exactly what has been
> run is in [What has been run](#what-has-been-run); what hasn't is in
> [Not verified yet](#not-verified-yet).

- [What a hosted install is](#what-a-hosted-install-is)
- [The data folder](#the-data-folder)
- [Run one](#run-one)
- [Set it up](#set-it-up)
- [One address](#one-address)
- [Access](#access)
- [Operations](#operations)
- [Back it up and restore it](#back-it-up-and-restore-it)
- [Upgrade it](#upgrade-it)
- [Remove it](#remove-it)
- [The security model](#the-security-model)
- [Where an install runs](#where-an-install-runs)
- [Host the editor online](#host-the-editor-online)
- [What has been run](#what-has-been-run)

---

## What a hosted install is

The same server and web app the desktop app runs, started with
`galley serve` on a server, for **one site**, behind a password, with its whole
state in one folder.

The owner's decision, in the owner's words:

> each cloud galley install will come with its own state, not shared with the
> other sites. Desktop app can have multiple websites but with hosted version
> it only supports 1 website.

> also our "one click installer" should automatically create and deploy the
> cloud version on user's cloudflare (if available) or just be able to create
> an online/hosted version without hosting it (e.g. hosting on vercel, etc)

So: one hosted install is one website and one private state. Ten sites are
ten installs that share nothing — no folder, no password, no key, no
session. The desktop app and the local command line stay multi-site, exactly
as before. "Galley Cloud", a managed service run by Fiction Tribe, is a
different thing: it doesn't exist and stays "coming soon" on the marketing
site.

### How one site is enforced

In three places, so no single mistake opens a second site:

- **The engine.** On a hosted install the site registry is wrapped
  (`packages/core/src/install/single-site.ts`): listing and opening see only
  the one site; open, clone, create, remove, scan, add and groups all refuse.
  The install's own connect step (first run, or the starting values below) is
  the only way a site gets in.
- **HTTP.** `packages/server/src/hosted-refusals.ts` answers every multi-site
  route with 403 and one sentence — *This editor looks after one site. Each
  site gets an editor of its own.* — and the "Host the editor online" routes
  with 404: a hosted install never creates other installs.
- **The web app.** No Sites screen, switcher, groups, New site, Clone, Open a
  folder or Add from a folder. `/` opens the site. An **Install** page is
  added.

`GALLEY_SITES_DIR`, `--sites-dir` and `GALLEY_PREVIEW_PORTS` are ignored on a
hosted install, and it says so once at start-up.

## The data folder

Everything an install keeps is in one folder: `GALLEY_HOME`, which is `/data`
in the image and the one volume a compose file mounts.

| Path | What |
| --- | --- |
| `install.json` | The install's state, versioned (mode 0600): the password's hash, the setup code's hash while there is one (and that a used one is dead), the site's repository, folder and how it is reached, the site's live address, which starting values were used, sign-outs. |
| `session.key` | The key session cookies are signed with (0600). |
| `settings.json`, `secrets.json` | Settings, and the stored service keys (the assistant's key and others), owner-only. |
| `keys/` | The install's own deploy key pair, an access token when one is used, and `known_hosts`. |
| `site/` | The repository's checkout. The site may be a folder inside it (`GALLEY_SITE_FOLDER`). |
| `state/<siteId>/` | The inbox, the history of going online, brand material, assistant conversations, plugin state. |
| `plugins/` | Plugins added to this install. |
| `home/` | `HOME` in the image: package caches. Rebuilt when needed; not in a backup. |
| `backups/` | Where the operator keeps backups on the volume (`galley backup create --out /data/backups/…`). Never part of a backup, never replaced by a restore. |
| `server.lock` | Written while a server holds the folder, so `galley backup` refuses to copy or replace it underneath a running server. It does not stop a second server starting on the folder: stop the editor first. |

The site's live address lives in `install.json`, not in the site's
`galley.config.json`: first run, a handover and `GALLEY_SITE_LIVE_URL` never
leave an unpublished change in the site. When the site's own settings name a
live address (`urls.production`), that one wins and first run shows it as set.

The folder is migrated at start-up, before anything reads it
(`packages/core/src/install/migrate.ts`). Layout 0 is a data folder from
before single-site installs — a hosted server that kept any number of sites:

- with no site, it starts empty;
- with one site, that site is adopted in place, its repository address
  cleaned of credentials;
- with several, it refuses to start and says which variable chooses the one
  to keep: `GALLEY_SITE_DIR` (the others stay on disk, untouched);
- a folder written by a newer version is refused rather than misread.

---

## Run one

### The reference recipe: a server with Docker and Caddy

One server with Docker and its compose plugin, ports 80 and 443 open, about
2 GB of memory for the editor, and a domain you can add DNS records to. The
editor itself publishes **no** port; Caddy is the only way in and gets the
certificates by itself. This is how this project's own website's editor runs,
on a small Google Cloud VM.

**The image isn't published yet.** The files below name
`ghcr.io/fictiontribe/galley:0.2.0`, which is where it will be. Until then,
build it from this repository and put your image's name on the `image:`
line, or pass it with `--image`:

```sh
docker build -t galley .
```

The build needs Docker's **BuildKit** — the default builder of Docker Engine
with its buildx plugin; with Debian's and Ubuntu's own `docker.io` package,
install `docker-buildx` beside it. The legacy builder stops at the
Dockerfile's `--platform=$BUILDPLATFORM`. The full build from source took
about two minutes on a 4 GB VM. The `Dockerfile` header also has the
multi-architecture build, and a build from a bundle made outside Docker for a
machine too small to build inside it.

The repository's own `docker-compose.yml`, `Caddyfile` and `.env.example`
are exactly the files below for the `caddy` variant at `cms.example.com`
(project `galley-editor`); a test keeps them in step with the recipe
(`packages/core/test/hosting/compose-example.test.ts`).

1. **Write the files.** With `npx galley-cms host recipe …` (0.2.0 or newer),
   from a clone of this repository with its dependencies installed, or
   with the image itself (`docker run --rm <image> host recipe …`, as
   `scripts/create-install.sh` does):

   ```sh
   node packages/cli/bin/galley.js host recipe --name acme --address cms.example.com --repository git@github.com:example/acme-site.git --out acme
   ```

   ```
   ✓ Wrote compose.yaml, Caddyfile, .env to …/acme
   ```

   These are the files, exactly as written (`--out -` prints them instead):

   ```yaml
   # ── compose.yaml
   # Galley: the editor “acme” at https://cms.example.com, with Caddy in front for HTTPS.
   # Written by `galley host recipe`. Start it in this folder with: docker compose up -d (project “galley-acme”)
   name: galley-acme
   services:
     editor:
       image: "ghcr.io/fictiontribe/galley:0.2.0"
       restart: unless-stopped
       env_file: .env
       # Hardened: an ordinary user, nothing written outside /data and /tmp, no extra powers.
       user: node
       read_only: true
       tmpfs:
         - /tmp
       cap_drop:
         - ALL
       security_opt:
         - no-new-privileges
       mem_limit: 2g
       pids_limit: 512
       # Time to finish a publish in progress and stop the preview (up to 20 s) before Docker kills it.
       stop_grace_period: 30s
       # Everything the editor keeps: the site, its settings and keys, its history.
       volumes:
         - data:/data
       healthcheck:
         test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:4400/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
         interval: 30s
         timeout: 5s
         start_period: 30s
         retries: 3
       # No ports: only what is in front of it reaches it, by name.
     caddy:
       image: caddy:2.11
       restart: unless-stopped
       ports:
         - "80:80"
         - "443:443"
         - "443:443/udp"
       volumes:
         - ./Caddyfile:/etc/caddy/Caddyfile:ro
         - caddy-data:/data
         - caddy-config:/config
       depends_on:
         - editor
   volumes:
     data:
     caddy-data:
     caddy-config:
   ```

   ```caddyfile
   # ── Caddyfile
   # HTTPS for the editor, its preview and its live comparison: Caddy gets and renews the certificates by itself.
   cms.example.com, cms-preview.example.com, cms-live.example.com {
   	reverse_proxy editor:4400 {
   		# Keep open connections (the editor's live updates) through a reload of this file.
   		stream_close_delay 5m
   	}
   }
   ```

   ```sh
   # ── .env
   # The editor's settings. Nothing here is secret: the setup code is only its SHA-256.
   GALLEY_PUBLIC_URL=https://cms.example.com
   GALLEY_PREVIEW_URL=https://cms-preview.example.com
   GALLEY_LIVE_VIEW_URL=https://cms-live.example.com
   GALLEY_TRUST_PROXY=1
   GALLEY_SITE_REPOSITORY=git@github.com:example/acme-site.git
   # The site's own preview and build stop at this, so a runaway build ends itself instead of the whole editor.
   GALLEY_PREVIEW_MEMORY_MB=1024
   # No setup code was given, and none is needed: on its first start the editor makes a one-time setup link by itself
   # and prints it in its log (docker compose logs editor). Optional, before the first start: GALLEY_SETUP_TOKEN_SHA256
   # (the SHA-256 of a code of your own) to use your code instead, or GALLEY_PASSWORD to set the password up front.
   ```

2. **Point the three names at the server.** At whoever holds the domain, an
   A record (and AAAA, if the server has IPv6) for each of
   `cms.example.com`, `cms-preview.example.com` and `cms-live.example.com`,
   with the server's address. On Cloudflare, set them to "DNS only": Caddy
   makes the certificates itself (in the real run, all three within seconds
   of the names pointing at the server).
3. **Copy the folder to the server and start it** there, in that folder:
   `docker compose up -d`. The first start downloads the images.
4. **Open the setup link.** Nothing is needed before the first start: the
   editor makes a one-time code and prints the link in its log
   (`docker compose logs editor`). Open it straight away: whoever opens it
   first chooses the password. To keep the code out of the log, put
   `GALLEY_SETUP_TOKEN_SHA256` in `.env` before the first start (the SHA-256
   of a code of 24+ characters you keep; `--setup-token-sha256` writes it
   for you) and open `https://cms.example.com/setup?token=<your code>`. A code
   you supplied is never printed: the log line shows a placeholder.

The other two front ends:

- `--proxy shared-proxy` writes the editor alone on the network
  `galley-proxy`, a `<name>.caddy` block for a Caddy shared by every install
  on the server, and once per server that Caddy (`proxy/compose.yaml`,
  `proxy/Caddyfile` with `import sites/*.caddy`). The script below uses it.
- `--proxy tunnel` writes the editor with Cloudflare's connector
  (`cloudflare/cloudflared:latest`, `tunnel --no-autoupdate run`) and a
  `tunnel.env` for its key (`TUNNEL_TOKEN=…`). Nothing is opened to the
  internet; the connector dials out. See [Cloudflare](#cloudflare).

In every variant the editor runs as the user `node`, with a read-only root
filesystem, a tmpfs at `/tmp`, every capability dropped, no privilege
escalation, a 2 GB memory and 512-process limit, 30 seconds to stop
(`stop_grace_period`), one volume and no published port. The compose project
is `galley-<name>`; the shared proxy's is `galley-proxy`.

**An address at the top of a two-part suffix** (`example.co.uk`) gets
`example-preview.co.uk` and `example-live.co.uk` by default, which are
someone else's names. Choose an address one level down (`cms.example.co.uk`),
or give the other two names with `--preview-address` and `--live-address`
(`galley host`, `galley host recipe` and `scripts/create-install.sh` all take
them).

### Several installs on one server

`scripts/create-install.sh` creates one install per run: its own compose
project, its own volume, its own folder, behind the one Caddy every install
on the server shares. Ten sites are ten runs. It needs only Docker with the
compose plugin on the server — the image writes its own files
(`host recipe --proxy shared-proxy`), so they always match the version that
runs. It makes a fresh setup code, gives the install only its SHA-256, and
prints the link once at the end.

```sh
sh scripts/create-install.sh acme git@github.com:example/acme-site.git cms.example.com --image ghcr.io/fictiontribe/galley:0.2.0 --dry-run
```

```
Dry run: nothing is written, started or changed.

Would create the install “acme” for git@github.com:example/acme-site.git at https://cms.example.com
  folder        ./galley-installs/acme/  (compose.yaml, .env)
  shared proxy  ./galley-installs/proxy/  (compose.yaml, Caddyfile — first install on this server)
  proxy entry   ./galley-installs/proxy/sites/acme.caddy
  volume        galley-acme_data  (the install's whole state)
  network       galley-proxy  (created if it isn't there)

Would run:
  docker run --rm ghcr.io/fictiontribe/galley:0.2.0 host recipe --name acme --address cms.example.com --repository git@github.com:example/acme-site.git --proxy shared-proxy …
  docker network create galley-proxy            (if missing)
  docker compose -f ./galley-installs/proxy/compose.yaml up -d
  docker compose -f ./galley-installs/acme/compose.yaml up -d
  docker compose -f ./galley-installs/proxy/compose.yaml exec caddy caddy reload --config /etc/caddy/Caddyfile

(The image ghcr.io/fictiontribe/galley:0.2.0 isn't on this server yet, so the files can't be shown; the real run pulls it.)

Then: point cms.example.com and its preview and live names at this server, and open the one-time setup link the real run prints.
```

With the image present, the dry run also prints the files it would write.
A real run refuses a name that already has a folder, waits up to three
minutes for the install to report healthy, and ends with the three names to
point at the server, the setup link, and the two commands that take this
install away and nothing else. `--help` lists `--dir`, `--folder`,
`--preview-address` and `--live-address` too; the folder and the two names
are passed through to `host recipe`. Only the dry run has been run so far.

---

## Set it up

### First run

1. **Open the setup link** (`<address>/setup?token=…`). Without it, `/setup`
   says where to find it. A used or foreign link says so, and whoever runs
   the server can make a new one.
2. **Choose the password**: 12 characters or more. This uses up the link and
   signs this browser in.
3. **Connect the site.** Either an existing repository, or a starter sent to
   an **empty** repository as its first version. Two ways to reach it:
   - **The install's own deploy key** (the default): an ed25519 pair made by
     the install, private half 0600 in `keys/`. The page shows the public half
     and, for GitHub, GitLab and Bitbucket, where to add it — **with write
     access**. Until the repository accepts it, the page waits ("Waiting for
     the key.") and **Check again** retries; nothing else needs doing.
   - **An access token over HTTPS.** Stored in the data folder's key store,
     handed to git through an askpass helper only — never in an argument, the
     address or `.git/config`.
   A site in a folder of a larger repository: give the folder (`apps/site`).
   The whole repository is copied; only the folder is the site — changes
   outside it are neither shown in Proof nor published.
4. **A few details**: the publishing name and e-mail (every version published
   from this editor carries them), the live address (Proof compares
   against it; kept in the install's state, so nothing is left to publish),
   and the assistant's key. Only the name and e-mail are needed now.
5. **Done.** The setup link is dead from here on — for good: a used code is
   never accepted again, even after `--reset-password`.

A first run left half-way (the password chosen, the site not connected yet)
carries on after the ordinary sign-in.

Or, on the first screen, **Restore from a backup**: the site, its
unpublished changes, its settings, its stored keys and that editor's password
all come back.

### The unattended start

Everything first run asks can be given up front, so an install comes up
ready. From the environment, or from one JSON file named by
`GALLEY_INSTALL_CONFIG` (the environment wins over the file):

| Variable | File key | |
| --- | --- | --- |
| `GALLEY_PUBLIC_URL` | `address` | The address people use. |
| `GALLEY_PASSWORD` | `password` | The first password, 12+ characters. |
| `GALLEY_SETUP_TOKEN` | `setupToken` | A setup code of yours, 24+ characters. |
| `GALLEY_SETUP_TOKEN_SHA256` | `setupTokenSha256` | Or only its SHA-256, so the code never reaches the server. |
| `GALLEY_SITE_REPOSITORY` | `site.repository` | `git@host:owner/name.git` or `https://…`. |
| `GALLEY_SITE_BRANCH` | `site.branch` | Default: the repository's own default branch. |
| `GALLEY_SITE_FOLDER` | `site.folder` | The site's folder inside the repository. |
| `GALLEY_SITE_ACCESS` | `site.access` | `deploy-key` (default) or `token`. |
| `GALLEY_SITE_TOKEN` | `site.token` | The access token, with `token`. |
| `GALLEY_SITE_STARTER` | `site.starter` | Send this starter to an empty repository instead (the file also takes `{ "id", "look", "name" }`). |
| `GALLEY_AUTHOR_NAME`, `GALLEY_AUTHOR_EMAIL` | `author.name`, `author.email` | Both or neither. |
| `GALLEY_SITE_LIVE_URL` | `liveUrl` | The site's live address. |
| `ANTHROPIC_API_KEY` (and the other provider keys) | `keys.anthropic`, … | From the environment they are used from there; from the file they are stored. |

The file's shape (`packages/core/src/install/starting.ts`; unknown keys are
refused by name, without quoting a value):

```json
{
  "address": "https://cms.example.com",
  "password": "…",
  "setupToken": "…",
  "site": {
    "repository": "git@github.com:example/acme-site.git",
    "branch": "main",
    "folder": "apps/site",
    "access": "deploy-key",
    "token": "…",
    "starter": "astro-starter"
  },
  "author": { "name": "Sam", "email": "sam@example.com" },
  "liveUrl": "https://www.example.com",
  "keys": { "anthropic": "sk-ant-…" }
}
```

A file other users on the server can read gets a warning at start-up: it may
hold the password and keys (`chmod 600`). Secrets are read from the
environment or the file only, so they never show in a process list, and the
site's own commands never receive them.

With a password, a site and the publishing name given, first run finishes by
itself. With the deploy key, the install starts and waits — without crashing —
until the key is added: the start-up line says "waiting", and first run and
the Install page show the public key to add. Each start tries again.

### Restarts change nothing

These are **starting values**, not settings. Each is applied once, and only
while the install lacks that thing. A restart with the same environment
changes nothing; a password, name or live address someone changes in the app
stays changed. A repository different from the one the install already has is
ignored, with a notice naming the one it keeps.

### A forgotten password

`galley serve --reset-password` forgets the password, signs everyone out,
prints a fresh one-time setup link and keeps serving until it is stopped.
Whoever opens the link first chooses the new password; stopped before that,
the next start prints a fresh link. `GALLEY_PASSWORD` is not put back by
this, and a setup code that was used stays dead: an old code or hash still in
the environment is ignored, a new link is made, and a notice says so.
Everything else — the site, its unpublished changes, settings, keys — stays.

With compose, in the install's folder. Stop the editor first: nothing stops a
second server starting on the same data folder.

```sh
docker compose stop editor
docker compose run --rm --use-aliases editor serve --reset-password
```

Open the link it prints (`--use-aliases` lets Caddy reach this one-off
container by the editor's name), choose the password, stop it with Ctrl+C,
then:

```sh
docker compose start editor
```

---

## One address

### Three hostnames, one port

The server listens on one port and answers three names:

| Name | What answers |
| --- | --- |
| `cms.example.com` (`GALLEY_PUBLIC_URL`) | The editor. |
| `cms-preview.example.com` (`GALLEY_PREVIEW_URL`) | The site's preview, with the overlay that makes click-to-edit work. |
| `cms-live.example.com` (`GALLEY_LIVE_VIEW_URL`) | The live site, shown beside the preview in Proof. |

The last two are worked out from the first unless set: `cms.example.com`
gives `cms-preview.example.com` and `cms-live.example.com`; a two-part name
(`example.com`) or `*.localhost` gives `preview.<name>` and `live.<name>`.
Requests for those two names never reach the app: they go to the preview
gateway (`packages/server/src/gateway.ts`), which hands them to whichever
preview proxy is mounted (`packages/core/src/workspace/preview/proxy.ts`).
Without `GALLEY_PUBLIC_URL` the server answers any hostname and there is no
preview. A hosted install never opens preview ports.

### Why hostnames

- **Not paths.** Sites and their dev servers use root-absolute addresses
  (`/_astro/…`), and hot reload assumes the root. A preview under `/preview/`
  breaks.
- **Not the editor's own origin.** The previewed site runs its own scripts.
  On another origin they can never act as the signed-in person.
- **Not ports.** Each port needs its own certificate and its own firewall rule.
- **Siblings, by default.** `cms-preview.example.com` rather than
  `preview.cms.example.com`, because a provider's free certificate covers
  first-level names only — Cloudflare's Universal SSL covers "the root domain
  (for example, `example.com`) and first-level subdomains"
  ([source](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/),
  read 2026-11-23).

### Who may see the preview

The preview's name is guessable, and what answers there is a dev server
running the site's code. So nothing is served there to a browser the editor
didn't let in:

1. The editor asks for a ticket: `POST /api/sites/:siteId/preview/entry`
   (signed in). A ticket is 32 random bytes, good once, for 60 seconds.
2. The frame loads `/__galley/enter?ticket=…&to=<path>` on the preview's
   name; the gateway trades the ticket for a **viewer cookie** and goes to the
   page.
3. The viewer cookie is derived from that sign-in (its id and time, an HMAC
   under a label of its own), so it can never be read as a session cookie, and
   it stops working when the sign-in does: signing out, **Sign out
   everywhere**, a changed password, the session's age, a restore.

A stranger gets a plain 401 page; a WebSocket upgrade without the cookie is
closed. Neither the session cookie nor the viewer cookie is ever forwarded to
the site's dev server.

### What the proxy in front must do

- **Keep the `Host` header.** The three names are told apart by it. Caddy
  passes it through unchanged by default
  ([source](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy),
  read 2026-11-23).
- **Terminate HTTPS for all three names**, and set `X-Forwarded-Proto`; then
  `GALLEY_TRUST_PROXY=1` lets the server believe it (and `X-Forwarded-For`,
  for the per-address sign-in limit). Only behind a proxy you control.
- **Pass WebSockets** (hot reload) and **stream** `GET /api/events`
  (Server-Sent Events, a heartbeat every 20 seconds). Caddy does both by
  default; `stream_close_delay 5m` in the generated Caddyfile keeps them open
  through a reload.

---

## Access

### One password

There are no accounts; the owner parked them. What was done to make one
password solid:

- Stored as an **scrypt hash** with its parameters, checked in constant time,
  never kept in plain.
- **Changeable in the app** (Install page): every other browser is signed out;
  the one that changed it stays signed in.
- **Sign out everywhere**: every cookie issued until then stops working, this
  browser's included.
- **Sign-outs survive a restart**; so do the two above.
- Wrong passwords and wrong setup codes share **one limit: 5 a minute per
  address**, then a minute's wait.
- The session cookie on an `https://` address is
  `__Host-galley_session`: `HttpOnly`, always `Secure`, `SameSite=Strict`,
  `Path=/`, no `Domain`, signed with `session.key`, 30 days. A cookie one
  install issued is refused by another.
- The setup code is kept as its SHA-256 only and works until a password
  exists, then never again.
- Nothing secret is printed, logged or returned by a route. The setup link is
  the one deliberate exception, and it works once.

Every publish from the install carries the one publishing name and e-mail
set at first run (Install page to change it).

### A design note: accounts, roles and single sign-on

**This is a note, not a feature. None of it is built.** It records where
accounts would attach to the code as it is, so whoever builds them starts
from the seams that exist:

- **Accounts.** A session already carries an id and an issue time, and
  whether it is still good is asked of one place (`install.store.sessionValid`).
  A session could carry an account id the same way.
- **Passwords per person.** The password check is one hook (`verifyPassword`);
  a per-account check replaces it there.
- **Who published.** The publishing author is read per request, so it could
  come from the signed-in account instead of the install's one name.
- **Roles.** Would gate groups of routes, where `hosted-refusals.ts` already
  sits in front of every route.
- **Single sign-on.** Would replace the password exchange in
  `POST /api/auth/login`. The simplest form trusts an identity header from a
  proxy the operator controls — Cloudflare Access, for example, which the
  owner already has in front of their sites.

---

## Operations

### Health and readiness

- `GET /healthz` — 200 while the process serves.
- `GET /readyz` — `{ "ready": …, "state": "starting" | "setup" | "ready" | "restoring" }`.

Both answer without a sign-in and without the Host check, and say nothing
that identifies the install. `GET /api/meta` tells a stranger only that this is
a single-site install, whether first run is finished and whether a password
exists (`install.passwordSet`) — so the sign-in page knows whether to send
someone to the setup link or to the ordinary password form. The image's `HEALTHCHECK` and the compose files
call `/healthz`.

### Logs

Every line passes one scrubber: known secrets, and token, ticket, key,
passphrase and password values in addresses, are cut out. On a hosted install
there is one line per request — method, path without the query, status,
time — which `GALLEY_LOG_REQUESTS=0` turns off; and one line each for a
sign-in, a password change, sign-out everywhere, first run finished, the site
connected, a backup and a restore. With compose: `docker compose logs editor`.

### Stopping

On SIGTERM or SIGINT the server stops taking requests, lets a publish or a
connect in progress finish (20 seconds, `GALLEY_SHUTDOWN_GRACE_MS`), stops
the preview and its child processes, stops measuring storage, writes its
state and exits 0 by itself. The compose files give it
`stop_grace_period: 30s`. A second Ctrl+C stops at once.

### The site's own packages

The first preview installs the site's packages inside the container (in the
real run, the first start took 82 seconds, that install included; a site in a
folder of its repository was ready in 43 seconds). In a site that has no
lockfile, that install never leaves one behind — npm runs with
`--no-package-lock`, pnpm with `--no-lockfile`, bun with `--no-save`, and
yarn's is removed afterwards — so a hosted install doesn't add a file nobody
asked for to the site's changes. A site with a lockfile installs from it as
before. Local mode is unchanged.

### Memory

`GALLEY_PREVIEW_MEMORY_MB` sets Node's heap limit (`--max-old-space-size`,
after any `NODE_OPTIONS` of the operator's) for the site's own dev, build and
install commands — never the server's own process. The generated files set
1024 inside the container's 2 GB, so a runaway build ends itself instead of
the editor.

### The Install page

`/install`, for whoever is signed in: the address, the preview's and live
comparison's addresses, the version, when it was set up; the repository and
how it is reached (the public key, **Make a new key** — the old one stops
working at once); the publishing name; **Change the password**; **Sign out
everywhere**; **Download a backup** and **Restore**; and what is stored where,
with sizes and whether a backup carries it. The sizes are measured in the
background within a time budget and never walk installed packages, so a size
can be empty for a while; measuring stops when the server stops. Anything the
operator fixed with a starting value is marked "Set by whoever runs the
server". The screens a person sees on a hosted install speak of "this
editor" and "the server", never "this computer".

---

## Back it up and restore it

**What a backup holds**: everything a fresh install couldn't rebuild — the
state, settings, stored keys, `keys/`, the session key, the per-site state
(inbox, history of going online, brand material, conversations, plugin
state), and the site's checkout **with its unpublished changes and its
history**. **Not**: installed packages (`node_modules` anywhere — so plugins
added to the install must be added again after a restore), package caches,
`home/`, the site's build output (`dist`, `.astro`, unless the repository
tracks them), temporary folders, and `backups/` — the operator's own backups
on the volume, which a restore also leaves alone.

**One file, sealed.** scrypt (N=65536, r=8, p=1) turns the passphrase into
an AES-256-GCM key; the archive is sealed in 1 MB frames, each bound to its
place and to the header, so a frame that is changed, moved, taken from
another file or cut off never opens. A wrong passphrase is told apart from a
damaged file without decrypting anything. The format is in the header of
`packages/core/src/install/backup.ts`. **The passphrase can't be recovered**:
without it the backup can't be opened.

Three ways:

- **In the app** (Install page): **Download a backup** asks for a passphrase
  (12+ characters) and downloads `<site>-backup-<date>.bak`. **Restore**
  uploads a file (up to `GALLEY_RESTORE_MAX_MB`, default 2048), checks all of
  it into a staging folder before changing anything, stops the preview,
  swaps the state in, keeps the old one aside until the swap is done, and
  signs everyone out. Sign in with the password of the editor the backup came
  from.
- **At first run**, on a fresh install: **Restore from a backup** instead of
  choosing a password.
- **From the command line**, on the data folder, **with the server stopped**
  (it refuses while a `server.lock` says a server holds the folder;
  `--force` only when you know that server is stopped). With compose, in the
  install's folder, with `GALLEY_BACKUP_PASSPHRASE` set in the shell:

  ```sh
  docker compose stop editor
  docker compose run --rm -e GALLEY_BACKUP_PASSPHRASE editor backup create --out /data/backups/site.bak
  docker compose start editor
  ```

  and to restore, the same with
  `backup restore /data/backups/site.bak` in the middle. `/data/backups/` is
  on the install's volume and is never part of a backup or replaced by a
  restore; `backup create` makes the folder when it's missing. Copy the file
  off the server to keep it. Without Docker: `galley backup create --out …`
  and `galley backup restore …` with `GALLEY_HOME` naming the data folder.
  The passphrase comes from `GALLEY_BACKUP_PASSPHRASE` or is asked on the
  terminal without echo. A backup larger than 100 MB can't be uploaded
  through Cloudflare's free plan
  ([source](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/4xx-client-error/error-413/),
  read 2026-11-23); restore it this way.

A volume snapshot at the host (Fly.io's daily snapshots, a server's disk
backup) is a second line, not a replacement: only the sealed file can move an
install to another host.

---

## Upgrade it

An upgrade is a **new image on the same volume**. Build or pull the new
image, change the `image:` line in `compose.yaml` if its name changed, and
run `docker compose up -d` in that folder; an install created by the desktop
app is upgraded from there (**Upgrade to …**, or `galley host upgrade`). At
start-up the new version migrates the data folder to the layout it knows
before anything reads it. Done twice on the real server: healthy again in
8–11 seconds, the state unchanged.

**Never start an older image on a newer data folder.** It refuses a folder a
newer version wrote rather than misread it; to go back, restore the backup
made before the upgrade into a fresh volume. So: download a backup before
every upgrade.

## Remove it

Stopping the project and deleting its volume removes the install and
everything in it — including changes nobody published. Download a backup
first if any might matter. For an install made by `scripts/create-install.sh`,
the script prints the exact commands (this install's project, volume, folder
and proxy entry, and nothing else):

```
docker compose -f ./galley-installs/acme/compose.yaml down -v && rm -r ./galley-installs/acme ./galley-installs/proxy/sites/acme.caddy
docker compose -f ./galley-installs/proxy/compose.yaml exec caddy caddy reload --config /etc/caddy/Caddyfile
```

An install the desktop app created is removed from there: it lists exactly
what it will delete, leaves alone anything changed since, and deletes the
rest (see [Host the editor online](#host-the-editor-online)). The site, its
repository and its live address stay.

---

## The security model

### The claims, and the tests that hold them

Each claim is a test that runs against a started hosted server, real folders
and a real repository. `packages/server/test/hosted-security.test.ts` holds
the main ones; its test titles are the claims.

| Claim | Test |
| --- | --- |
| The setup link works once. | `server/test/hosted-security.test.ts` |
| A request for any other hostname is refused. | `server/test/hosted-security.test.ts` |
| A write from another origin is refused — from the preview's origin too, even with the editor's cookie attached. | `server/test/hosted-security.test.ts` |
| No route returns a secret (every GET in the contract, the setup and install routes, every header); the sealed backup is the one carrier. | `server/test/hosted-security.test.ts` |
| The preview's origin can't read or use the editor's cookie: `__Host-`, `HttpOnly`, never forwarded; the gateway never serves the app. | `server/test/hosted-security.test.ts`, `server/test/hosted-gateway.test.ts` |
| A stranger gets nothing from the preview's names; the viewer cookie ends with the sign-in. | `server/test/gateway.test.ts`, `server/test/hosted-gateway.test.ts` |
| Nothing outside the data folder is readable or writable through the app. | `server/test/hosted-security.test.ts` |
| A restore can't write outside the data folder; a hostile backup changes nothing. | `server/test/hosted-security.test.ts`, `core/test/install/backup.test.ts` |
| A site's folder can't point outside the repository's copy. | `server/test/hosted-security.test.ts`, `core/test/install/install.test.ts` |
| A cookie one install issued is refused by another. | `server/test/hosted-security.test.ts`, `server/test/install.test.ts` |
| Sessions end on sign-out everywhere, across a restart; a changed password signs everyone else out. | `server/test/hosted-security.test.ts`, `server/test/install.test.ts`, `core/test/install/state.test.ts` |
| The password is an scrypt hash; the setup code a SHA-256; wrong codes count against the sign-in limit. | `core/test/install/state.test.ts`, `server/test/install.test.ts` |
| The site's own commands don't inherit the password, setup code, access token or provider keys. | `server/test/install.test.ts`, `core/test/install/access.test.ts` |
| No secret in any answer or log line, through the whole first run. | `server/test/install.test.ts`, `server/test/install-ops.test.ts` |
| One site: every multi-site route and engine call is refused. | `server/test/hosted-refusals.test.ts`, `core/test/install/install.test.ts` |
| The deploy key's private half is 0600 and never read back; an access token never reaches an argument, the address or `.git/config`. | `core/test/install/access.test.ts` |
| Installing the site's packages leaves no lockfile in a site that had none. | `core/test/workspace/install-lockfile.test.ts` |
| Storage sizes never walk installed packages, keep to a time budget and stop with the server. | `core/test/install/storage.test.ts` |
| The repository's `docker-compose.yml`, `Caddyfile` and `.env.example` are exactly what the recipe writes. | `core/test/hosting/compose-example.test.ts` |
| The screens a hosted person sees don't say "this computer". | `web/test/install/hosted-words.test.ts` |

By hand, on 2026-11-24: two installs side by side from one image each refused
the other's cookie (401), password and form-capture key (403).

### The container is the boundary

The preview runs the site's own dev server, installs its dependencies (their
install scripts included), and build mode runs its build. **That is code
from the repository, running on the server, by design.** Anyone with the
password can change that code and run it. The protection is around the
process, not inside it:

- the server runs as the unprivileged user `node`. With `user: node` in
  compose, root is never involved. Started as root (some hosts mount a
  root-owned volume and offer no way to pick the user), `docker/entrypoint.sh`
  hands `/data` to `node` once, then drops root and every capability for
  good, before the server starts;
- a read-only root filesystem, a tmpfs for `/tmp`, `cap_drop: ALL`,
  `no-new-privileges`, memory and process limits, one volume;
- no published port for the editor: only Caddy or the tunnel reaches it;
- the site's commands don't receive this app's secret environment variables.

What the site's code *can* reach is what the `node` user can inside that
container: the data folder — so the stored keys, the deploy key and the
session key — and the network. One install per site keeps that reach to the
one site. Treat the password as the ability to run code in that container.

### What leaves the machine

No telemetry, and nothing to Fiction Tribe. An install connects to:

- **the site's git host** — copy, pull, publish; SSH (port 22) with the deploy
  key, or HTTPS with a token;
- **the package registry** the site uses, when its dependencies are installed;
- **the live site**, when Proof shows it beside the preview;
- **the AI providers**, only when a key is set and someone uses the assistant
  or image generation;
- **Cloudflare or Vercel**, if someone puts the site online from the install;
- **a mail server or webhook**, if the inbox's alerts or forwarding are set.

The full list, with what is sent, is the documentation site's
[Security model](../apps/site/src/content/docs/running/security.md).

---

## Where an install runs

Three shapes, and a word on Google Cloud. Prices are rough, monthly, for one
install, from each provider's own page as read on the date given — an
estimate, not a quote.

### A plain server with Docker and Caddy (the reference)

The files from `galley host recipe` or `scripts/create-install.sh`, on any
server. Any number of names, because Caddy makes the certificates. You look
after the operating system, Docker and the disk's backups.

- Hetzner CPX12 (1 vCPU, 2 GB, 40 GB): from €9.99 a month before VAT
  (€11.99 in Falkenstein and Nuremberg); the page showed some plans as
  currently unavailable.
  [Source](https://www.hetzner.com/cloud/regular-performance/), read
  2026-11-23.
- DigitalOcean Basic Droplet (1 vCPU, 2 GiB, 50 GiB): $12.00 a month, IPv4
  included. [Source](https://www.digitalocean.com/pricing/droplets), read
  2026-11-23.
- Several installs share one server; 2 GB per install is the compose limit.

**What was run:** this shape, for real — the image built from source on a
small Google Cloud VM (Ubuntu 24.04, 4 GB), the `caddy` files written by the
image itself, three DNS names, Caddy's certificates, an upgrade in place and
the operator's backup, restore and reset commands; and on a Mac with Docker,
a whole first run to Publish. See [What has been run](#what-has-been-run).

### Google Cloud

- **A Compute Engine VM is a plain server.** It runs the reference recipe
  above unchanged; this project's own website's editor runs that way. No
  Google price is given here: none was checked.
- **Cloud Run can't hold an install.** Its volumes are in memory, a Cloud
  Storage bucket, or an NFS share — there is no persistent disk for the
  site's checkout and its unpublished changes
  ([Cloud Storage volumes](https://docs.cloud.google.com/run/docs/configuring/services/cloud-storage-volume-mounts),
  [NFS volumes](https://docs.cloud.google.com/run/docs/configuring/services/nfs-volume-mounts),
  [in-memory volumes](https://docs.cloud.google.com/run/docs/configuring/jobs/in-memory-volume-mounts),
  read 2026-11-24).
- Google Cloud is **not** a host in "Host the editor online": that isn't
  built. Run the recipe on the VM yourself.

### Fly.io (a managed volume per install)

Created through Fly.io's Machines API by **Host the editor online** or
`galley host --host fly`: an app, a shared IPv4 and an IPv6 address, a 3 GB
volume that grows by itself up to 10 GB, one machine (2 GB by default, or
1 GB; asleep while nobody uses it by default), and three certificates. Fly.io
gives one hostname per app, so the three names need your own domain: they are
created for you when the stored Cloudflare key may edit that domain's DNS
(DNS-only CNAMEs to `<app>.fly.dev`), otherwise listed to add by hand.

What the app shows, worked out from Fly.io's rates in its cheapest regions
(shared-cpu-1x 1 GB $6.70 per 30 days; $6.00 for each further GB of memory,
so 2 GB is $12.69 — worked out, not printed; a volume $0.15 per GB; outgoing
data $0.02 per GB, about 5 GB assumed; shared IPv4, IPv6 and the first 10
certificates free):

| Memory | Awake all day | Awake about 3 hours a day |
| --- | --- | --- |
| 2 GB | about $13.24 | about $2.27 |
| 1 GB | about $7.25 | about $1.52 |

[Source](https://docs.fly.io/about/pricing/), read 2026-11-23. A card is
needed on the account; with one, Fly.io's free plan covers $5 of use a month
([source](https://docs.fly.io/about/free-plan/), read 2026-11-23).

**What was run:** from the real app in a real browser against a strict
local stand-in for the Machines API, with its machine started as a real
install (see [What has been run](#what-has-been-run)). Never on Fly.io
itself. The prices are estimates; the 2 GB figure is derived from Fly.io's
rates, not printed by Fly.io.

### Cloudflare

**Cloudflare's containers can't hold an install today.** Their disk doesn't
keep files. In Cloudflare's own words: "All disk is ephemeral by default."
and "When a Container instance goes to sleep, the next time it starts, it
uses a fresh disk from the container image."
([source](https://developers.cloudflare.com/containers/platform-details/),
read 2026-11-23). There is no persistent volume, announced or otherwise.
Snapshots exist but "Container snapshots are in public beta.", are taken by
hand, are tied to one image ("A snapshot is tied to the Container image
version it was created from and is not portable to a different image.") and
expire after 30 days
([source](https://developers.cloudflare.com/containers/guides/snapshots/),
read 2026-11-23). An install's unpublished changes would be lost at the next
sleep, restart or update.

**What is built instead:** the `cloudflare` host — "Cloudflare, in front of a
computer of yours". The install runs on any computer with Docker; a
Cloudflare Tunnel connects it to Cloudflare and three proxied DNS names point
at the tunnel. No inbound port is opened: the connector dials out. With a
Cloudflare key (Account › Cloudflare Tunnel › Edit, Zone › DNS › Edit, Zone ›
Zone › Read) the app creates the tunnel, its routes for the three names and
the three DNS records, each named after the install, and writes the files to
start (the `tunnel` recipe), the connector's key fetched fresh, never stored.
Removing deletes the DNS records (deleting a tunnel leaves them behind), the
tunnel's connections, then the tunnel. An address deeper than one level below
the domain is refused, because the free certificate wouldn't cover it.

Cost: Cloudflare charges nothing for this — "Every account includes 1,000
tunnels at no cost."
([source](https://developers.cloudflare.com/tunnel/features/tunnels-for-platforms/),
read 2026-11-23) — plus whatever the computer costs. A request body over
100 MB doesn't pass the free plan (restore a larger backup from the command
line).

**What was run:** from the real app in a real browser against a strict
local stand-in for Cloudflare's API. Never with a real Cloudflare tunnel.

**Cloudflare Access as an extra gate** — optional, done by hand, **not
automated and not tested here.** Access can put a sign-in in front of the
three names, free for up to 50 users
([source](https://www.cloudflare.com/plans/sase-zero-trust/), read
2026-11-23). Two things to know first: the form-capture path `/f/*` on the
editor's name must stay public, with a second application on that path whose
policy is Bypass; and Access across three hostnames framed inside each other
(the preview inside the editor) has not been tried.

### Vercel, Netlify and Cloudflare Workers

None of them can run an install: each runs short-lived functions on a disk
that doesn't keep files.

- **Vercel**: a function stops after at most 300 seconds on Hobby and 800 on
  Pro, and its filesystem is read-only apart from a `/tmp` that doesn't
  outlive the instance
  ([source](https://vercel.com/docs/functions/limitations),
  [source](https://vercel.com/docs/functions/runtimes), read 2026-11-23).
  Put the site on Vercel and the editor on Fly.io or a server.
- **Netlify**: functions stop after 60 seconds (15 minutes in the
  background), and its newer server product empties its disk whenever the
  instance stops
  ([source](https://docs.netlify.com/build/server/limits/), read 2026-11-23).
- **Cloudflare Workers**: 128 MB of memory, a per-request `/tmp`, and
  `node:child_process` is "a non-functional stub", so neither git nor a dev
  server can run
  ([source](https://developers.cloudflare.com/workers/runtime-apis/nodejs/),
  read 2026-11-23).

The app says the same, in one sentence each, under "Why not …?"
(`EDITOR_HOSTS_ABSENT` in `packages/core/src/hosting/registry.ts`).

---

## Host the editor online

The desktop app (and the local command line) can put a hosted install
online for the site it has open, on the person's own account. It sits beside
**Put this site online** on the Online screen, as **Editor online**, and is
built the same way (`packages/core/src/hosting/`).

1. **Where.** Fly.io; Cloudflare, in front of a computer of yours; or any
   server with Docker. "Why not Vercel, Netlify or Cloudflare Containers?"
   gives each one's reason.
2. **The key, found out, not guessed.** The key the host needs (with the
   permissions to tick, in order) is checked with the host before it is
   stored, then asked what it can do: which accounts, regions and domains it
   reaches, and exactly what's missing ("This has to be fixed before the
   editor can be created", or a step that will be done by hand instead).
   Keys stay on this computer.
3. **The plan, and the cost, before anything exists.** The three names (all
   on a domain that's yours; **Change these names**, or `--preview-address`
   and `--live-address`, for an address like `example.co.uk`), the name
   everything created carries, the
   account and region, the host's own choices (memory, sleep). Then the plan:
   every resource that will be created, in order; the image and version; what
   it costs a month with its lines, the source and the day the prices were
   read; what the new editor will be handed; the steps only the person can
   do; the files to run. A plan is good for fifteen minutes and one use.
4. **What is handed over**, each part a choice: the repository's address
   (never a credential for it — the install makes its own deploy key), the
   publishing name and e-mail, the live address. Keys are **copied only on
   purpose**, ticked one by one; the default is none. "Nothing else leaves
   this computer. The editor gets its own password and its own key for the
   repository — this computer's aren't copied."
5. **The yes.** Nothing is created without it (`confirm: true` on the route,
   `--yes` or the prompt on the command line). Each thing is named, tagged and
   recorded the moment it exists (`<home>/state/<siteId>/editor.json`), so a
   failure half-way leaves a record that removing cleans up. The host gets
   the setup code only as its SHA-256: its dashboard never shows anything that
   opens the install.
6. **Handed over.** When the install answers at its address, the app sends
   the handover with the setup code, writes `editor` (`{ "url", "host" }`) into
   the site's `galley.config.json` — a pending change, shown in Proof, to
   publish like any other — and offers **Finish setting it up**: the install's
   first run, to choose its own password and add its own key to the
   repository. For the self-run hosts, the person starts the files and
   chooses **Check**.
7. **Later**: **Upgrade to …** (a new image, the disk kept), **Back up**
   (on Fly.io, a snapshot of the disk that Fly.io keeps for 7 days; otherwise
   where the install's Install page downloads one), **Remove the hosted editor** (it lists what it will delete,
   leaves alone anything whose name or tag changed, keeps the site, its
   repository and live address, says plainly that unpublished changes on the
   install go with it, and asks for the address to be typed).

From a terminal, the same:

```sh
galley host --host own-server --address cms.example.com --name acme --dry-run
```

```
Any server with Docker: the editor “acme”
  Editor:          https://cms.example.com
  Preview:         https://cms-preview.example.com
  Live comparison: https://cms-live.example.com
  Runs:            ghcr.io/fictiontribe/galley:0.2.0

Creates nothing on an account.

Costs about $12.00 a month:
    $12.00  A server with 2 GB of memory (for example DigitalOcean's Basic Droplet: 1 CPU, 50 GB disk, address included)
     $0.00  HTTPS certificates (Caddy gets them from Let's Encrypt)
  …
  Prices from https://www.digitalocean.com/pricing/droplets, read 2026-11-23.

Hands the new editor:
  - Repository: git@github.com:example/acme-site.git
  - Branch it publishes to: main
  - Publishing name and e-mail: Sam <sam@example.com>
…
Nothing was created (--dry-run).
```

`galley host` is in 0.2.0 and newer (`npx galley-cms host`). Then
`galley host status|link|check|upgrade|backup|remove`. Keys come from
`FLY_API_TOKEN` or `CLOUDFLARE_API_TOKEN`, else the stored one, else a prompt
(and stored). Until the image is published, set `GALLEY_HOSTING_IMAGE` to an
image you pushed. A hosted install never offers any of this (its routes
answer 404).

**Hosts are pluggable.** A plugin can add one through `editorHosts` in the
plugin API ([docs/plugins.md](plugins.md#editor-hosts)): the same
`EditorHost` interface (`packages/core/src/hosting/types.ts`) the three
built-ins implement — inspect, plan (creating nothing), create exactly the
plan, remove only what was created. A plugin can't replace a built-in.

**The rehearsal.** `scripts/rehearse-hosting.mjs` starts the strict fake
Fly.io and Cloudflare APIs the tests use on local ports and prints the
variables to start the app with (`GALLEY_HOSTING_FLY_API`,
`GALLEY_HOSTING_CLOUDFLARE_API`, `GALLEY_HOSTING_INSTALL_API` and the fakes'
made-up keys), so the whole flow can be walked with no real host. A small
fake install answers by default; with `GALLEY_FAKE_LAUNCH` every machine the
fake Fly.io creates becomes a real `galley serve` process. Every call the
fakes answered is written to an evidence file, with no keys in it.

---

## What has been run

> This section holds only what has been run, as of 2026-11-24.

**By automated tests in this repository**, against real folders, real local
git repositories and started servers:

- the single-site refusals, in the engine and over HTTP
  (`server/test/hosted-refusals.test.ts`, `core/test/install/install.test.ts`);
- first run through HTTP against real local repositories, including a
  starter sent to an empty repository and a site in a folder of its
  repository (`server/test/install.test.ts`, `core/test/install/install.test.ts`);
- the access-token path against a real `git http-backend`
  (`core/test/install/access.test.ts`);
- sessions and sign-out everywhere across a restart
  (`server/test/install.test.ts`, `core/test/install/state.test.ts`);
- the preview through the one address on a started hosted server, including
  a WebSocket and cookie isolation (`server/test/hosted-gateway.test.ts`,
  `server/test/gateway.test.ts`);
- back up → wipe the data folder → restore (`server/test/install-ops.test.ts`,
  `core/test/install/backup.test.ts`);
- the security pass (`server/test/hosted-security.test.ts`);
- every host's whole life — inspect, plan, create, hand over, upgrade, back
  up, remove — against strict local fakes of Fly.io and Cloudflare
  (`core/test/hosting/service.test.ts`);
- no lockfile left behind by the preview's package install
  (`core/test/workspace/install-lockfile.test.ts`); the Install page's
  storage sizes (`core/test/install/storage.test.ts`); the repository's
  compose example matching the recipe
  (`core/test/hosting/compose-example.test.ts`); the hosted screens' words
  (`web/test/install/hosted-words.test.ts`).

**On the real image, on a Mac with Docker (linux/arm64), by hand and with a
real browser:**

- two installs side by side from the same image, with different volumes and
  sites: different sites, settings, stored keys, inbox and sessions; each
  refused the other's cookie (401) and password, and one's form-capture key
  was refused by the other (403);
- one install end to end in the hardened container (user `node`, read-only
  root filesystem, every capability dropped), behind Caddy on standard HTTPS,
  one address: first run in a real browser; a form edit; the preview loading
  from the preview's hostname through the same port (the first start took
  82 seconds, the site's package install inside the container included);
  click-to-edit; Arrange; Proof side by side (the live frame and the proposed
  one); Publish — the version arrived in the remote repository with the
  configured author and the `Galley-Publish: 1` trailer;
- a restart of the container: the site, its versions, the settings, an
  unpublished change, the inbox and the deploy key identical, and the
  earlier session still signed in;
- a sealed backup (nothing readable in it) → the volume wiped → a fresh
  install → restore through first run with the setup code → identical again;
  the original password signed in and the setup code was dead afterwards; a
  wrong passphrase changed nothing;
- a built copy of the starter posting its contact form from its own origin to
  the editor's capture address, and the submission arriving in the inbox;
- "Host the editor online" from the real app in a real browser against the
  strict stand-ins for Fly.io and Cloudflare, with the stand-in's machine
  started as a real install: the hosts, their costs and the "why not" list
  shown; the plan and its cost before anything; no creating call before the
  yes (the calls were recorded); 8 creating calls to Fly.io and 3 to
  Cloudflare after it; the editor healthy; the site's settings gained
  `editor`; removal deleted exactly those things and left a hand-made foreign
  app and DNS record untouched; the settings back to clean. Also
  `galley host --dry-run`;
- both image architectures (arm64, and amd64 under emulation) from a bundle
  built outside Docker.

**On a small Google Cloud VM** (linux/amd64, Ubuntu 24.04, Docker 29 with
BuildKit, 4 GB):

- the full build of the image from source inside Docker, the `Dockerfile`'s
  own path, in about two minutes;
- a real install for this project's own website: the files written by the
  image itself (`host recipe --proxy caddy`), three DNS names pointed at the
  server, Caddy's three certificates obtained by itself within seconds, the
  editor healthy; the preview's and live comparison's names answering 401 to
  a stranger; plain http redirected to https; a wrong setup code refused; the
  server reaching the code host over SSH (refused there only because the
  deploy key hadn't been added);
- a site that is a folder inside its repository (this project's own site):
  connected, and its preview ready in 43 seconds, in a throwaway install on
  that server;
- an upgrade in place, a new image on the same volume: healthy in 8–11
  seconds, the state unchanged (twice);
- the operator's backup, restore and reset-password commands through
  `docker compose run`, as written above;
- the whole repository's checks in a clean Node 22 container: a frozen
  install, the type-check of all 15 packages, the documentation check, and
  every package's tests (two preview tests need `lsof` present, as on
  GitHub's runners).

### Not verified yet

- **Any real run on Fly.io or with a Cloudflare tunnel.** On Fly.io in
  particular: whether outbound SSH (port 22) works, whether it honours the
  image's user, how its proxy treats the editor's live updates, and its region
  list (a fixed list in the code, not read from Fly.io).
- **Cloudflare Access** in front of an install.
- **A deploy key accepted by GitHub, GitLab or Bitbucket, end to end.** The
  server reached the code host over SSH; the token path ran end to end only
  against a local git server.
- **`scripts/create-install.sh` beyond its dry run.**
- **The image on a registry.** Nothing is published; the default image name is
  where it will be.
- **Prices.** Every price here is an estimate from the provider's page on the
  date given; the Fly.io 2 GB figure is derived from its rates, not printed.
  No Google Cloud price is given.
