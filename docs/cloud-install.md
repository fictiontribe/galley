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
> tunnel; "Host the editor online" has never created anything on Google
> Cloud itself (only against a stand-in); and the image is not published to
> a registry. **Accounts** (people, roles, invitations, one-time links) are
> newer than that run: they are covered by automated tests, a rehearsal
> over HTTP against the real server and a pass in a real browser, and have
> not yet been tried on the real image or against a real mail server.
> Exactly what has been
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
`galley serve` on a server, for **one site**, for the people its owner lets
in — each with their own e-mail and password — with its whole state in one
folder.

The owner's decision, in the owner's words:

> each cloud galley install will come with its own state, not shared with the
> other sites. Desktop app can have multiple websites but with hosted version
> it only supports 1 website.

> also our "one click installer" should automatically create and deploy the
> cloud version on user's cloudflare (if available) or just be able to create
> an online/hosted version without hosting it (e.g. hosting on vercel, etc)

So: one hosted install is one website and one private state. Ten sites are
ten installs that share nothing — no folder, no account, no key, no
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
| `install.json` | The install's state, versioned (mode 0600): the accounts (each person's name, e-mail, role, password hash, when they last signed in, whether they are switched off, when they were last signed out), the open invitations and new-password links (only the SHA-256 of each link's code), the setup code's hash while there is one (and that a used one is dead), the site's repository, folder and how it is reached, the site's live address, which starting values were used, sign-outs. |
| `install.json.schema-<n>.bak` | The state file as it was before the last upgrade of its layout, kept in case the new version has to be rolled back (0600). After the upgrade to accounts it is `install.json.schema-1.bak`, and it holds the old shared password's hash. |
| `session.key` | The key session cookies are signed with (0600). |
| `settings.json`, `secrets.json` | Settings, and the stored service keys (the assistant's key and others), owner-only. |
| `keys/` | The install's own deploy key pair, an access token when one is used, and `known_hosts`. |
| `site/` | The repository's checkout. The site may be a folder inside it (`GALLEY_SITE_FOLDER`). |
| `state/<siteId>/` | The inbox, the history of going online, brand material, assistant conversations, plugin state. |
| `plugins/` | Plugins added to this install. |
| `home/` | `HOME` in the image: package caches. Rebuilt when needed; not in a backup. |
| `backups/` | Where the operator keeps backups on the volume (`galley backup create --out /data/backups/…`). Never part of a backup, never replaced by a restore. |
| `server.lock` | The server's hold on the folder: taken before it reads or changes anything here, rewritten every 10 seconds while it runs, removed when it stops. One folder, one server: a second server started on the folder is refused ([One server to a data folder](#one-server-to-a-data-folder)), and `galley backup` refuses to copy or replace the folder underneath a running server. |

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

Layout 1 had one shared password; layout 2 has accounts. What the upgrade
from 1 to 2 does is in [Upgrading to accounts](#upgrading-to-accounts).

---

## Run one

### The reference recipe: a server with Docker and Caddy

One server with Docker and its compose plugin, ports 80 and 443 open, about
2 GB of memory for the editor, and a domain you can add DNS records to. The
editor itself publishes **no** port; Caddy is the only way in and gets the
certificates by itself. This is how this project's own website's editor runs,
on a small Google Cloud VM.

**The image isn't published yet.** The files below name
`ghcr.io/fictiontribe/galley:0.4.2`, which is where it will be. Until then,
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
       image: "ghcr.io/fictiontribe/galley:0.4.2"
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
   # (the SHA-256 of a code of your own) to use your code instead, or GALLEY_PASSWORD to set the first owner's password up front.
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
   first becomes the owner. To keep the code out of the log, put
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
sh scripts/create-install.sh acme git@github.com:example/acme-site.git cms.example.com --image ghcr.io/fictiontribe/galley:0.4.2 --dry-run
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
  docker run --rm ghcr.io/fictiontribe/galley:0.4.2 host recipe --name acme --address cms.example.com --repository git@github.com:example/acme-site.git --proxy shared-proxy …
  docker network create galley-proxy            (if missing)
  docker compose -f ./galley-installs/proxy/compose.yaml up -d
  docker compose -f ./galley-installs/acme/compose.yaml up -d
  docker compose -f ./galley-installs/proxy/compose.yaml exec caddy caddy reload --config /etc/caddy/Caddyfile

(The image ghcr.io/fictiontribe/galley:0.4.2 isn't on this server yet, so the files can't be shown; the real run pulls it.)

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
2. **Create your account** — the owner's: a name, an e-mail and a password
   (12 to 1,024 characters), typed twice. Whoever does this is the install's
   first owner. It uses up the link and signs this browser in.
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
4. **A few details**: the install's publishing name and e-mail (filled in
   from your account), the live address (Proof compares against it; kept in
   the install's state, so nothing is left to publish), and the assistant's
   key. Only the name and e-mail are needed now. The screen says: "What
   people publish here carries their own name. This one is for versions
   published with nobody signed in, by a script or an AI tool using this
   server's access key." A person who is signed in publishes under their
   own name (see [Who published](#who-published)) — a starter sent at first
   run included: its first version carries the owner who sent it, even
   though the install's name may not be saved yet. The install's name is
   for what nobody signed in starts — a script with the operator's token,
   an AI tool over MCP, a starter sent from the starting values.
5. **Done.** The setup link is dead from here on — for good: a used code is
   never accepted again, even after `--reset-password`. The last screen
   says to sign in with your e-mail and password from now on, and to invite
   the people who work on the site from the Install page.

A first run left half-way (the owner made, the site not connected yet)
carries on after the owner signs in.

Or, on the first screen, **Restore from a backup**: the site, its
unpublished changes, its settings, its stored keys and that editor's people
and passwords all come back.

### The unattended start

Everything first run asks can be given up front, so an install comes up
ready. From the environment, or from one JSON file named by
`GALLEY_INSTALL_CONFIG` (the environment wins over the file):

| Variable | File key | |
| --- | --- | --- |
| `GALLEY_PUBLIC_URL` | `address` | The address people use. Every invitation and new-password link is built from it ([One-time links](#one-time-links)). |
| `GALLEY_PASSWORD` | `password` | The first owner's password, 12+ characters. |
| `GALLEY_OWNER_NAME`, `GALLEY_OWNER_EMAIL` | `owner.name`, `owner.email` | The first owner's name and the e-mail they sign in with. |
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
  "owner": { "name": "Sam", "email": "sam@example.com" },
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

**The owner, unattended.** `GALLEY_PASSWORD` makes the first owner at
start-up, with `GALLEY_OWNER_NAME` and `GALLEY_OWNER_EMAIL` (or the file's
`owner`) as their name and e-mail. Without those two the owner has no name
or e-mail yet: they sign in with the password alone, and the app asks them
once for the rest ("Add your name and e-mail"). On an install with no owner
yet, the two are used only together with `GALLEY_PASSWORD`; without it they
are ignored, with a notice, and the owner types them in first run. On an
install whose owner has no name or e-mail yet (one upgraded from before
accounts), they fill in what is missing, once — an e-mail another account
already uses is left out.

With the owner's password, a site and the publishing name given, first run finishes by
itself. With the deploy key, the install starts and waits — without crashing —
until the key is added: the start-up line says "waiting", and first run and
the Install page show the public key to add. Each start tries again.

### Restarts change nothing

These are **starting values**, not settings. Each is applied once, and only
while the install lacks that thing. A restart with the same environment
changes nothing; a password, name or live address someone changes in the app
stays changed. A repository different from the one the install already has is
ignored, with a notice naming the one it keeps. Once the owner has changed
their password in the app, a `GALLEY_PASSWORD` still in the environment is
ignored, with a notice saying so.

### A forgotten password

Three ways back in, from the gentlest:

- **The server e-mails links** (outgoing e-mail and the editor's public
  address are both set; [Outgoing e-mail](#outgoing-e-mail)): the person
  chooses **Forgot your password?** under Sign in, types their e-mail, and
  gets a new-password link by e-mail. The page always ends on the same
  sentence, whether or not the address has an account here.
- **An owner makes one:** in People on the Install page, in that person's
  **…** menu, **New-password link**. When the server e-mails it to the
  person, the owner is told so and the link isn't shown: a link that signs
  in as someone stays with them. When it can't be e-mailed, it is shown
  once, for the owner to copy and send however they like. If an e-mailed
  link doesn't arrive, check the person's e-mail (an owner can change it:
  **Change e-mail…** in the same menu) and make a new one. When the server
  doesn't e-mail links, **Forgot your password?** tells the person to ask
  an owner for one.
- **An owner who can't get in** — the only owner, or every owner — is let
  back in by whoever runs the server, with
  `galley serve --reset-password`. See below.

Each of these links works once, for 60 minutes
([One-time links](#one-time-links)). The person's old password keeps
working until they use it; using it signs their other browsers out.

#### The way back in for a locked-out owner

`galley serve --reset-password` makes a one-time new-password link for the
owner, prints it, and keeps serving as usual until it is stopped:

```
Password:  https://cms.example.com/new-password#<one-time code>
           Open it now: it lets Sam choose a new password, once, until 14:05 UTC. Nobody else's account changed.
```

- It works once, for 60 minutes. Nobody else's account changes, nobody is
  signed out, and the owner's old password works until the link is used.
- With several owners, say whose with `--email <their e-mail>` (`--email`
  is accepted only with `--reset-password`). Without it, the server refuses
  to start and says how many owners there are.
- An owner who was switched off is switched back on by it.
- With no owner yet, it prints a fresh one-time **setup** link instead, as
  first run does. A setup code that was used stays dead: an old code or hash
  still in the environment is ignored, a new link is made, and a notice says
  so.
- `GALLEY_PASSWORD` is never put back by it.
- It writes one line to the log ("A new-password link was made for … by
  whoever runs the server"). The link itself is printed once, in the
  start-up lines on the terminal that ran the command; the server's log
  lines never contain it.

Everything else — the site, its unpublished changes, settings, keys, the
other people — stays as it was.

With compose, in the install's folder. Stop the editor first: nothing stops a
second server starting on the same data folder.

```sh
docker compose stop editor
docker compose run --rm --use-aliases editor serve --reset-password
```

For an install with several owners:

```sh
docker compose run --rm --use-aliases editor serve --reset-password --email sam@example.com
```

Open the link it prints (`--use-aliases` lets Caddy reach this one-off
container by the editor's name), choose the new password, stop it with
Ctrl+C, then:

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
Without `GALLEY_PUBLIC_URL` the server answers any hostname, there is no
preview, and no invitation or new-password link is e-mailed
([One-time links](#one-time-links)). A hosted install never opens preview
ports.

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
3. The viewer cookie is derived from that sign-in (its id, its time and the
   person's account, an HMAC under a label of its own), so it can never be
   read as a session cookie, and it stops working when the sign-in does:
   signing out, **Sign out everywhere**, a changed password, the session's
   age, a restore, or the person being switched off or removed (checked the
   next time the cookie is used). Viewer cookies issued before the upgrade to
   accounts are refused.

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
  for the per-address sign-in limit). Only behind a proxy you control: it
  believes them from every connection that reaches the port, the proxy's or a
  program's on the same machine. With the proxy on the same machine,
  `GALLEY_SOCKET` is narrower: the server also listens on that Unix socket,
  the proxy connects to it instead of the port, and forwarded headers are
  believed for requests on the socket alone — never for those on the port
  (see [Putting the proxy on the socket](#putting-the-proxy-on-the-socket)).
- **Pass WebSockets** (hot reload) and **stream** `GET /api/events`
  (Server-Sent Events, a heartbeat every 20 seconds). Caddy does both by
  default; `stream_close_delay 5m` in the generated Caddyfile keeps them open
  through a reload.

### Putting the proxy on the socket

With `GALLEY_SOCKET` set (`galley serve` only; not on Windows), the server
listens on that Unix socket as well as its port, and believes
`X-Forwarded-For` and `X-Forwarded-Proto` only for requests that come in on
the socket.

- **The socket** is made readable and writable by the server's user and its
  group only (`0660`). In the image that is user and group `node`, gid 1000:
  a proxy that runs as another user joins that group. Its folder must belong
  to the server's user (or root) and must not be writable by other users
  unless it has the sticky bit, or the server refuses to start.
- **Caddy:** `reverse_proxy unix//run/galley/galley.sock` in place of the
  `host:port`. Caddy appends `X-Forwarded-For` and sets `X-Forwarded-Proto`
  by default. Whatever the proxy, it must set or append `X-Forwarded-For`:
  without it everyone coming through the socket is one client to the sign-in
  limits, the log says `unknown`, and the server says so once.
- **The compose recipe**, where Caddy is another container: give the socket's
  folder a volume of its own, mounted in both containers (for instance at
  `/run/galley`), and run Caddy with the socket's group
  (`group_add: ["1000"]`).
- **The port stays open** on `GALLEY_HOST`. With the proxy on the socket,
  bind it to `127.0.0.1` (and don't publish it), so nothing else reaches it.
- **What it keeps out:** other users on the machine, other containers and the
  network. Not code that runs as the server's own user — and until the editor
  runs the site's code as a user of its own, the site's preview and build run
  as that user. `GALLEY_SOCKET` is kept from the site's commands, but that is
  no wall.

---

## Access

A hosted install has **people**, not one shared password. Each person signs
in with their own e-mail and password, has one of three roles, and their
publishes carry their own name. An owner decides who is let in, and as
what. The desktop app and local mode have no accounts and are unchanged:
one person, one computer, everything allowed.

### People and roles

Every route the server answers needs one of three levels, and the levels
nest: whoever may publish may edit, whoever may manage may publish.

- **Edit** — reading the site, and anything that only changes the draft
  (the working copy on the server) in content mode: pages, media, the
  site's content files, forms in the site, the redirects list, the brand
  where it is kept with the content, the assistant in content mode, the
  preview and Proof. Nothing at this level reaches the live site by itself.
- **Publish** — what changes the live site or the repository — Publish,
  undo a publish, send, get the latest, put the site live, set redirects on
  Cloudflare — reading what visitors sent through the site's forms (the
  inbox), and **build mode**: changing the site's code and templates
  ([Build mode and the site's settings](#build-mode-and-the-sites-settings)).
- **Manage** — the install itself: people, stored keys, the repository's
  access, backups and restore, **the site's settings file**, plugins, where
  the site is hosted and its domain, app-wide settings, the Install page.

| Role | Edit | Publish | Manage |
| --- | --- | --- | --- |
| **Owner** | yes | yes | yes |
| **Editor** | yes | yes | — |
| **Contributor** | yes | — | — |

So an **editor** changes the site, its code and templates included, and
publishes it, and reads the inbox, but has no Install page, App settings,
Plugins or site Settings, can't change the site's settings file, and can't
set up where the site is hosted. A **contributor** changes the site's
content and sees Proof, and an editor or owner publishes: no Publish, no
undo of a publish, no Get latest or Send now, no putting the site live or
sharing a preview link, no inbox, no redirects on Cloudflare, and no build
mode — no assistant in build mode, no set-up helpers that change the site's
code, no custom code in forms or scripts.

The one table that decides is `ROUTE_ACCESS` in
`packages/core/src/install/route-access.ts`, one level for every route (a
route without one doesn't compile). The server enforces it; the web app
reads the same table only to hide what a person can't use. Someone signed in
who calls a route above their level gets 403: *Your account can't do that.
Ask an owner of this editor.* A role is read on every request, so a change
applies to that person's very next request.

### Build mode and the site's settings

Two rules depend on what a request asks for, not on which route it is, so
the engine holds them itself, at the write, whichever way in a request
comes: a route, the assistant, an AI tool over MCP, a plugin's tool
(`packages/core/src/install/caller.ts`). Both levels are in
`route-access.ts` (`BUILD_MODE_LEVEL`, `SITE_SETTINGS_LEVEL`), and the app
reads them to decide what to offer.

- **Build mode needs an editor or owner** (the publish level): writing
  outside the site's content — its code, templates and the files it is
  built from — and the assistant's build-mode tools. That includes adding
  or changing custom code in a form (it runs in every visitor's browser),
  and saving the brand when its folder isn't part of the site's content. A
  contributor
  works in content mode. A request for build mode from a contributor is
  refused in plain words — never quietly carried out in content mode
  instead: *Your account can change the site's content, but not its code
  and templates (build mode). Ask an owner or an editor of this editor.* In
  a conversation that is already in build mode, the assistant adds: *This
  conversation is in build mode: switch it to content mode to carry on.*
  A site's own `"ai": { "allowBuild": false }` still turns the assistant's
  build mode off for everyone, owners included.
- **The site's settings file (`galley.config.json`) is an owner's**, by
  every way in: the site's Settings screen, a file write in any mode (by its
  own name in any letter case, or through a link to it), the assistant's
  `save_site_config`, an AI tool. So are discarding a pending change to it,
  undoing an assistant reply that changed it, and undoing a publish that
  changed it. Anyone else is told: *Your account can't change the site's
  settings. Ask an owner of this editor.* The Settings screen's own route
  answers with the table's sentence above.
- **What the editor records for itself.** A few values go into the
  settings file as part of an action someone below the owner may take, and
  the engine writes just those values, without opening the rest of the
  file to that person: the site's addresses after an editor puts it live
  (`deploy.defaultUrl`, `deploy.productionUrl`), and where the redirects
  list lives the first time anyone saves it (`redirects.file`). Each changes
  only its own keys; every other line of the file stays as it was
  (`packages/core/src/site/settings-records.ts`). Where the redirects take
  effect — the host that applies them, and the Cloudflare account and
  domains (`redirects.host`, `redirects.cloudflare`) — is part of the
  site's settings and an owner's to choose.
- **The assistant offers each person only the tools their role includes**,
  and checks again on every call: a contributor's assistant has no
  build-mode tools, and `save_site_config` is an owner's. The MCP endpoint
  is reached with a token, not a person's account, so it keeps that token's
  reach ([The operator's token](#the-operators-token)).
- **The role is read again whenever it is checked**, so work a request
  started — an assistant reply that is still running — can do only what the
  person's role allows at that moment.
- **Work that isn't done for someone does none of it.** On a hosted install,
  publishing and the site's other guarded actions (undoing a publish,
  getting the latest, sending), changing the site's settings file and
  writing outside the content are done only for a signed-in person (as
  their role allows), for the operator (the operator's token on the API
  and on `/mcp`) or by the engine itself as part of its own unattended
  steps. Anything else is refused: *Only someone signed in to this editor,
  or whoever runs it, can do that. Work that runs on its own, such as a
  plugin reacting to an event, can't publish, change the site's settings
  or change anything outside the content.* That is what a plugin's hooks
  run as — reacting to a publish, a deploy or a form a visitor sent — and
  so does what they leave running, and what runs in the open site after
  the request that opened it: its watcher and the preview. In code, the
  two exceptions are two named functions, `asOperator` and `asEngine`
  (`packages/core/src/install/caller.ts`), set by the server at the few
  places that are the operator's or the engine's. Local mode and the
  desktop app, with no accounts, are as before.

### What roles are, and what they aren't

Roles keep people out of each other's way and out of trouble: a contributor
can't publish by accident or change the site's code, an editor can't take a
key or a backup away or change the site's settings. The server enforces
them at every way in. **They are not a wall against someone who means
harm.** The preview runs the site's own code on the server ([The container
is the boundary](#the-container-is-the-boundary)), for every role: editors
and owners can change that code in build mode, and the content a
contributor changes is what that code reads and renders, and in some sites
runs. That code can reach what the container holds. An account is for a
person the owner would trust with the site's repository.

Three more things to know:

- **The assistant reads what contributors wrote.** It works from the site's
  content, and that includes what any contributor put there, so words
  placed in a page can try to steer the assistant of an owner or an editor
  who later asks it something. The assistant has no way to publish: every
  change it makes waits in Proof until a person publishes it. It changes
  the site's code and templates, and runs the site's build, only in a
  conversation a person has switched to build mode, and there it does not
  ask before each change. So the controls are a person's: choosing build
  mode, reading Proof, and pressing Publish.
- **The draft is one shared working copy.** Everyone edits the same draft,
  and **Discard** is at the edit level: a contributor can throw away pending
  changes — everyone's, not only their own (except a change to the site's
  settings file, which only an owner discards). Publish often, and say who
  is working on what.
- **Everyone signed in can see which keys are set**, and where each comes
  from, because the app uses that to say what is available (the assistant,
  image services, hosts, plugins). The last characters of a key, which help
  tell one key from another, are left out of those answers for anyone who
  isn't an owner (`packages/server/src/key-hints.ts`). Nobody ever sees a
  key itself.

Single sign-on isn't there yet ([Not there yet](#not-there-yet)).

### First run makes the owner

Whoever opens the setup link first creates the first account, as **Owner**
([First run](#first-run)). From then on the setup link is dead and
everyone else comes in by invitation. An unattended install makes its owner
from `GALLEY_PASSWORD` with `GALLEY_OWNER_NAME` and `GALLEY_OWNER_EMAIL`
([The unattended start](#the-unattended-start)). First run is an owner's: an
editor or contributor who opens `/setup` (an old link, say) goes straight
into the app once first run is over, and while it isn't, sees "This isn't
part of your account." rather than anything about setup links.

### Inviting someone

**Before inviting anyone, set the editor's public address**
(`GALLEY_PUBLIC_URL`, then start the server again): every link is built
from it, and without it a link can be made only on a trial on one computer
([One-time links](#one-time-links)).

An owner opens **People** on the Install page and chooses **Invite
someone**: an e-mail and a role. The invitation link is shown **once**, in a
dialog with **Copy link**; when the server e-mails links it is also
e-mailed, and the dialog says so. The person opens it, sees who invited them
and as what, types their name and a password, and is signed in.

A name is kept without characters a reader can't see (the controls that
reorder text, characters with no width, blank fillers), and nobody can take
a name that reads as someone else's here: the same letters in another case
or width, or with unseen characters between them, are the same name. Someone
signed in who chooses such a name, for themselves or as an owner for someone
else, is told *Someone here is already called “…”. Add something that tells
the two apart, such as a middle initial.* Someone accepting an invitation is
not told at the door, where it would say who is here to anyone holding a
link: they are let in without a name, and the app asks them to choose one.
Until they have, nothing of theirs carries anyone else's name: publishing,
undoing a publish, sending and getting the latest answer *Choose your name
first: your account has none yet, and each version carries the name of
whoever published it.* (and the app asks for the name again there and then),
and anything they would record carries their e-mail address in the name's
place, never the install's publishing name.
Names saved before this rule are cleaned when the install's state is read.
A publishing name (the install's, App settings › You, a site's own author)
is kept without unseen characters in the same way. Look-alike letters from
different alphabets are not caught. Accounts whose names were alike before this rule
stay as they are until one of them changes.

- An invitation lasts **7 days** and works once.
- An e-mail that already has an account, or an open invitation, can't be
  invited again. To send a new link, take the open invitation back
  (**Take back**) and invite again.
- An owner with no name or e-mail yet (one carried over from before
  accounts) can't invite until they add them: an invitation says who sent
  it.

### One-time links

Invitations and new-password links are both one-time links:

| | Lasts | Address |
| --- | --- | --- |
| Invitation | 7 days | `<address>/join#<code>` |
| New-password link | 60 minutes | `<address>/new-password#<code>` |

- **`<address>` is the editor's public address, `GALLEY_PUBLIC_URL`**,
  whatever address, `Host` or `Origin` a request came with.
- **Without `GALLEY_PUBLIC_URL`**, no link is e-mailed, and a link is shown
  to the owner only on a trial on one computer: the editor opened at a
  loopback address (`localhost`, `127.0.0.1`, `::1`), with the request's
  `Host` naming that same address; the link is built from it. Anywhere else
  making a link is refused, before any invitation or link is made: *Links
  can't be made yet: this editor doesn't know its public address. Set the
  editor's public address (GALLEY_PUBLIC_URL), start it again, then make
  the link.*
- Each works **once**. Taking an invitation back, or making a newer
  new-password link for the same person, kills the older link. Switching a
  person off or removing them ends their open new-password link, and so do
  changing their password and an owner changing their e-mail.
- **Why the code is after a `#`:** the part of an address after `#` never
  leaves the browser, so the code reaches no server log and no proxy on the
  way. The page takes it out of the address bar at once and sends it in a
  request body.
- The code is 32 random bytes; the server keeps only its SHA-256, so the
  state file — or a backup of it — can't be used to sign anyone in. An
  invitation is shown once, to the owner who made it, and e-mailed to the
  person when the server e-mails links. A new-password link an owner makes
  for someone goes to that person only, by e-mail, when the server e-mails
  it; only when it can't be e-mailed is it shown, once, to the owner to
  pass on. Neither is ever shown again.
- A used, taken-back, expired or unknown link gets one and the same refusal,
  and counts against the per-address limit below.
- Using a new-password link sets the password and signs that person's other
  browsers out. Until it is used, their old password keeps working.

### Outgoing e-mail

Accounts use the same two settings as the inbox's e-mail alerts:

| Variable | |
| --- | --- |
| `GALLEY_SMTP_URL` | The mail server: `smtp://user:pass@host:587`, or `smtps://` for TLS from the start. |
| `GALLEY_MAIL_FROM` | The sender address. |

**Links are e-mailed only when both outgoing e-mail and the editor's
public address (`GALLEY_PUBLIC_URL`) are set**, because a link is only ever
built from that address. Then invitations are also e-mailed (the owner
still sees the invitation link once); a new-password link an owner makes is
e-mailed to the person and not shown to the owner; and **Forgot your
password?** on the sign-in page e-mails a new-password link. The server
waits at most 15 seconds for the mail server, then answers without it. A
send that fails, or doesn't finish in time, never fails the request: the
owner is shown the link to pass on, and the log gets one line with the
mail server's error code — never the address, the link or the mail
server's own words.

**When the server doesn't e-mail links** — no outgoing e-mail, or no public
address — everything else still works: each link is shown to the owner who
made it, to send however they like (without the public address, only on a
trial on one computer; [One-time links](#one-time-links)); People says the
server doesn't e-mail links and that whoever runs it can have it do so;
**Forgot your password?** tells the person to ask an owner for a
new-password link. With only one of the two mail settings set, nothing is
e-mailed and a notice at start-up says which one is missing.

`galley serve` says which case it is in its `E-mail:` start-up line:

```
E-mail:    not set up (GALLEY_SMTP_URL, GALLEY_MAIL_FROM): owners send invitation and new-password links themselves
E-mail:    invitations and new-password links are e-mailed too
E-mail:    set up, but no link is e-mailed until the editor's public address is set (GALLEY_PUBLIC_URL): a link is only ever built from it
```

Sending has been tried only against a stand-in mail transport in the tests,
**not yet against a real mail server**.

### Signing in

The sign-in page asks for an e-mail and a password. An unknown e-mail, a
wrong password and a switched-off account all get the same sentence, and
take about as long (the server checks a stand-in password hash when there is
no such account), so the page can't be used to find out who has an account.
The password alone is asked for only while every account that can sign in
has no e-mail yet — an install upgraded from one shared password, until its
owner adds theirs (`install.signInWith` in `GET /api/meta`).

**The limits** (`packages/server/src/sign-in-gate.ts`; kept in memory: a
restart resets them, and two server processes don't share them). Every
password check goes through them — signing in, and the current password
typed to change your password or your e-mail, which takes its turn in the
account's own line exactly as a sign-in for that e-mail does. A **client** is an IPv4
address, or a whole IPv6 `/64` (the addresses one subscriber is normally
given); an IPv4 address written as IPv6 (`::ffff:203.0.113.7`) is the IPv4
address.

**Which address counts as the client depends on what is in front of the
server, and the setting has to match it:**

| In front of the server | `GALLEY_TRUST_PROXY` | The client is |
| --- | --- | --- |
| One reverse proxy you run, receiving visitors directly (the compose recipe's Caddy) | `1` | the address that proxy saw: each visitor their own |
| A reverse proxy on the same machine, connecting to the server's Unix socket (`GALLEY_SOCKET`) | either | the address that proxy saw, for requests on the socket; on the port, the connecting address, whatever a request claims |
| Nothing: the server's port is reached directly | unset | the connecting address |
| A reverse proxy, with the setting left unset | — | **the proxy, for everyone**: all people share one client's limits, so one person's wrong guesses hold everyone up. Set it. |
| The setting on, with no proxy in front | — | **whatever the request claims**: the limits per client mean nothing. Unset it. |
| A CDN or a second proxy in front of your proxy | `1` | the hop nearest the server — the CDN's edge, shared by everyone coming through it (20 attempts a minute between them). Not supported well yet. |

The server believes the last address in `X-Forwarded-For`, the one its own
proxy appended. There is no setting yet for more than one trusted hop or
for a list of proxy addresses, and no warning at start when forwarded
headers arrive without the setting.

- **Per client.** Its limits are checked, and its attempt counted, in one
  step before its password is checked, so attempts sent together are held
  to them too:
  - **2 password checks at once**;
  - **20 attempts a minute**, successful or not;
  - **5 failures a minute** — wrong passwords, wrong setup codes, bad link
    codes, a wrong current password; an attempt still being checked counts
    as one until it ends.

  Past any of them: 429, *Too many sign-in attempts. Wait a minute, then
  try again.* (for a password change or an e-mail change, *Too many
  attempts. Wait a minute, then try again.*).
- **Per e-mail, from one client: 10 failed sign-ins in 15 minutes**, then
  that e-mail waits 15 minutes from that client (429, *Too many sign-in
  attempts for that e-mail. Wait 15 minutes, then try again.*).
- **Per e-mail, from every client together**, whether or not the e-mail has
  an account — the same line, the same delays and the same answers, so
  nothing says whether it does:
  - sign-ins for one e-mail are checked **strictly one at a time**. Up to
    **3 more wait their turn**; past that, the answer is at once and without
    checking the password: 429, *That e-mail has more sign-in attempts
    waiting than can be checked right now. Wait a minute, then try again. A
    browser you have signed in on before isn't held up, and a one-time link
    always works.*
  - after **10 failures** for the e-mail, each turn begins with a delay:
    1 second, then 2, 4, 8, 16, then **30 seconds** for every one after
    that. The count is forgotten after 15 minutes without a failure.
  - so one e-mail can receive **at most about 2,900 guesses a day**, from
    any number of addresses: 10 at full speed, 5 more over 31 seconds, then
    one every 30 seconds for the rest of the day.
- **A browser someone has signed in on before.** Every successful sign-in
  (and a one-time link, the first-run account, a password change) also sets
  a **known-browser cookie** for that account: `__Host-galley_session_known`
  on an `https://` address (`galley_session_<port>_known` otherwise),
  `HttpOnly`, `Secure` there, `SameSite=Strict`, one year, signed with
  `session.key` under a label of its own. It is never accepted as a
  session. A sign-in to that same account from that browser skips the
  e-mail's line and its delay — though its password is still never checked
  beside another attempt for the same e-mail — and is served first when
  password checks are waiting. It counts only while the account is there,
  switched on and not signed out everywhere since it was set; after **3
  wrong passwords in 15 minutes** that browser is treated like any other.
  The per-client limits still apply to it.
- **The password checks themselves: 2 at a time**, at most one of them for
  any one client. Whoever waits is served in turn, client by client, not
  first come first served; known browsers first, with **64 places** of
  their own; everyone else has **256**. Only past those is the answer 429,
  *This editor is checking a lot of sign-ins right now. Wait a moment, then
  try again.* The places are shared fairly between clients, so one client
  can't take more than its turn; someone with a large block of addresses
  to send from can still keep them full.
- **Forgot your password?**: 5 requests per client in 15 minutes (then
  429), and at most 3 e-mails an hour to any one address (more requests are
  quietly skipped).

**The trade-off.** While an e-mail is being guessed at, someone typing the
right password for it in a browser they have **not** signed in on before
waits their turn and its delay — up to a couple of minutes — or, when the
line is full, is told to wait. That can last for as long as the guessing
does: the line can be kept full. Three things get the real person in
regardless: a **browser they have signed in on before**, which isn't held
up; a **one-time link** from an owner (or *Forgot your password?* where
links are e-mailed), which doesn't go through the e-mail's line at all;
and, for an owner with nobody to ask, the **reset by whoever runs the
server** (`galley serve --reset-password`). "Sign out everywhere" also
ends that person's known browsers, so the next sign-in from each is an
unknown browser's.

The owner carried over from before accounts, who signs in with the
password alone, is held to the same limits and has a known browser too.

**The rules for an account:** the e-mail is kept lower-case, is unique
whatever the letter case, and is at most 254 characters; a name is 1 to 100
characters, without `<` or `>`; a password is 12 to 1,024 characters, kept
as an **scrypt hash** with its parameters and checked in constant time.
Signing in records when that person last signed in.

### Sessions

- An account may have **16 windows of the editor** open at once (each holds
  one event stream; the operator's token counts as one identity). Some of
  those may be windows that went without a word, a laptop closed or a
  connection dropped behind the proxy, which the server can't tell from
  ones still reading. So when one more arrives, at most once in 10 minutes,
  all of that account's streams are ended: the windows still there connect
  again by themselves, and the new one takes a place. Otherwise the new
  window is told, in an event on its stream, *Too many windows of the
  editor are open on this account: 16 is the limit. Close one of the
  others, and this one connects again.* It shows that, and asks again every
  30 seconds and whenever it is brought to the front. **Where several people
  share one account**, that means one more window than the limit makes
  every other window on that account lose its live updates for a moment and
  read everything again, at most once in 10 minutes; nothing typed is lost,
  and other accounts are never touched. Give people accounts of their own
  to avoid it. A window that stops
  reading its stream is let go once 1 MB is waiting for it (not counting
  one event larger than that by itself), and reads everything again when it
  comes back.
- A session cookie belongs to one person. On an `https://` address it is
  `__Host-galley_session`: `HttpOnly`, always `Secure`, `SameSite=Strict`,
  `Path=/`, no `Domain`, signed with `session.key`, 30 days. A cookie one
  install issued is refused by another.
- Every request checks that the person still exists, isn't switched off and
  hasn't been signed out since the cookie was issued.
- **Changing your password** (Your account) signs your other browsers out;
  this one stays signed in.
- **Sign out everywhere** (Your account) signs only you out of every
  browser; other people stay signed in.
- **Sign everyone out** (People) signs out everyone, the owner's own browser
  included.
- Sign-outs survive a restart. Signing one browser out is written down in
  the install's state only for a session that still counts, and only until
  that cookie would have run out anyway.
- **The list of signed-out browsers is capped at 10,000.** Past the cap, a
  sign-out signs that person out of every browser instead of adding to the
  list. A longer list in a state file from an older version is shortened
  at start-up by signing everyone out once, with one line in the log (*The
  list of signed-out browsers was longer than 10000, so everyone was signed
  out once to shorten it. People sign in again as usual.*); the install
  starts as usual.
- An open live-update stream ends when its person is signed out, switched
  off or removed. For anyone who can't read the inbox, a new form
  submission arrives only as "the inbox changed", never its content.

### Looking after people

People, on the Install page, is for owners. It lists everyone — name and
e-mail, role, when they last signed in — and the open invitations (role, who
invited, when, whether it was e-mailed, when it stops working). For each
other person:

- **Role**: Owner, Editor or Contributor.
- **Change e-mail…**: the e-mail they sign in with, and where their
  new-password links go. It must not be another account's; their open
  new-password link stops working.
- **New-password link**: when the server e-mails links, it is e-mailed to
  the person and the owner reads "The link was e-mailed to …, and isn't
  shown here."; otherwise it is shown once, with Copy link, to send
  yourself. Not for a switched-off account: switch it on first.
- **Sign out**: that person, out of every browser.
- **Switch off** / **Switch on**: a switched-off person can't sign in;
  their sessions, open new-password link and preview access end at once.
- **Remove…**: the account goes, with the same immediate effect. What they
  published keeps their name.

Two rules hold whatever the order of the clicks (every change is checked
against the state as it is at that moment):

- **The last owner who can still sign in** can't be made an editor or
  contributor, switched off or removed. Make someone else an owner first.
- **Nobody changes their own account through People** — not their role,
  not switching themselves off, not removing themselves: *Ask another owner
  to change your own account.* Your own name and password are on **Your
  account** (`/account`).

**E-mail addresses are an owner's to change.** An owner changes their own
on Your account, with their current password (the e-mail is where a
new-password link goes), and everyone else's with **Change e-mail…** in
People. Editors and contributors see their e-mail on Your account but don't
change it; asked anyway, the server answers *Only an owner can change the
e-mail you sign in with. Ask an owner of this editor to change it for
you.* An account with no e-mail yet (an owner carried over from before
accounts) adds its own, with the current password.

### The operator's token

`GALLEY_TOKEN`, when it is set, lets a script call the API with
`Authorization: Bearer <token>`. It keeps the reach it always had, with
these exceptions, which need a person signed in in a browser (403 *That
needs someone signed in to this editor in a browser; a script's access
token can't do it.*, or the existing refusals): your own account
(`/api/account*`, `POST /api/install/password`), People (`/api/people*`),
downloading a backup, restoring one, and opening the preview. With the
token, `POST /api/auth/logout-all` signs **everyone** out.

### Who published

A signed-in person's Publish, undo of a publish, and the work they start are
recorded as that person — their name and e-mail — and the Publish dialog
says so ("Recorded as …, from your account"). This is the first link of the
author chain (`from: "account"` in `packages/core/src/workspace/author.ts`).
A person with no name or e-mail yet, a script with the operator's token, and
an AI tool over MCP fall through to the rest of the chain, as before: the
site's own author, the repository's own, the install's publishing name, the
server's own git identity, then the default. The install's publishing name
is the one first run asks for (or `GALLEY_AUTHOR_NAME` and
`GALLEY_AUTHOR_EMAIL`); once there are accounts, the Install page and App
settings › You show each person their own name instead, so the app no longer
offers a way to change the install's.

### Not there yet

- **Single sign-on.** Signing in is an e-mail and a password only. The seam
  for it is `POST /api/auth/login`; the simplest form would trust an
  identity header from a proxy the operator controls, such as Cloudflare
  Access.
- **A draft per person.** Everyone shares one working copy (above).
- **An audit log as such.** The server's log records who did what to the
  people ([Logs](#logs)); there is no separate record, screen or export of
  it.
- **A place kept for someone who hasn't been failing.** When an e-mail's
  line is full, whoever comes next is told to wait, whether or not they
  have failed for that e-mail before. So while an account is being guessed
  at, its owner in a browser they haven't used before can be kept waiting
  ([the trade-off](#signing-in) says what gets them in).
- **Limits by network.** A client is one address, or one IPv6 `/64`.
  Larger blocks of addresses aren't counted together, so someone with one
  can keep the waiting places for password checks full.
- **More than one proxy in front.** Only the hop nearest the server is
  believed (the table under [Signing in](#signing-in)).
- **Limits that outlast a restart.** They are kept in memory.
- **Telling the old address** when an owner changes someone's e-mail.
  Owners are trusted with that; it is logged.

---

## Operations

### Health and readiness

- `GET /healthz` — 200 while the process serves.
- `GET /readyz` — `{ "ready": …, "state": "starting" | "setup" | "ready" | "restoring" }`.

Both answer without a sign-in and without the Host check, and say nothing
that identifies the install. `GET /api/meta` tells a stranger only that this is
a single-site install, whether first run is finished, whether an owner
exists (`install.passwordSet`), whether sign-in asks for an e-mail
(`install.signInWith`) and whether a forgotten password can be e-mailed
(`install.passwordEmail`) — so the sign-in page knows what to offer. Signed
in, it also says who you are and what your role may do (`account`). The
image's `HEALTHCHECK` and the compose files call `/healthz`.

### Logs

Every line passes one scrubber: known secrets, and token, ticket, key,
passphrase and password values in addresses, are cut out. On a hosted install
there is one line per request — method, path without the query, status,
time — which `GALLEY_LOG_REQUESTS=0` turns off — and one line each for first
run finished, the site connected, a backup and a restore. With compose:
`docker compose logs editor`.

What people do is logged by **name and role only** ("Robin (Editor)"),
with the client address for a sign-in — never an e-mail address, a link or
a code:

- signed in; a sign-in that failed (wrong password, no account with that
  e-mail); one refused (the account is switched off, too many attempts
  from that client or for that e-mail from there, too many attempts
  waiting for that e-mail, too many sign-ins being checked at once);
- the owner made through the setup link;
- someone invited (as which role, and whether it was e-mailed); an
  invitation accepted; one taken back;
- a role changed; someone switched off or back on; someone removed;
- a password changed, or a password or e-mail change refused because the
  current password was wrong; a name changed; an e-mail changed, by the
  person or by an owner for someone else (who changed it, never the
  address);
- a new-password link made by an owner — who made it for whom, and whether
  it was e-mailed and not shown, or shown to pass on — asked for with
  **Forgot your password?**, or used; one made by whoever runs the server
  (`--reset-password`);
- signed out everywhere — one person, themselves, or everyone;
- a one-time link refused;
- an e-mail that couldn't be sent, or wasn't sent in time;
- at start-up, the list of signed-out browsers shortened by signing
  everyone out once ([Sessions](#sessions)).

### One server to a data folder

A hosted server takes the data folder before it reads or changes anything in
it, and keeps its hold (`server.lock`) fresh while it runs. Two servers on
one folder would each keep the install's state and the site's working copy
in memory and write over each other, so a start that finds the folder held
by a server that is still running stops with: *Another editor is running on
this data folder (process 1 on …, port 4400). Stop it first, or give this
one a data folder of its own (GALLEY_HOME).*

- **After a clean stop** the hold is gone and the next start takes the
  folder at once.
- **After a server that didn't stop cleanly** (the machine lost power, the
  container was killed) its hold is still there. A hold whose process is
  gone on this machine is taken over at once. Any other is watched for about
  20 seconds: a hold that keeps changing belongs to a running server and the
  start is refused; one that doesn't is taken over, and the log says so.
  Clocks are never compared, so two machines sharing a volume needn't agree
  on the time.
- **A folder the server can't write its hold to** stops the start with the
  reason.
- **The hold is written whole or not at all** (beside it first, then into
  place), so a full disk or a volume that goes away for a moment leaves the
  hold that was there. A running server that can't refresh its hold says so
  once (*This server couldn't refresh its hold on the data folder: …*) and
  keeps trying; a hold file it finds damaged it writes again. Neither is
  taken for another server.
- **If another server takes the folder while this one runs** (this one
  couldn't refresh its hold for a while and a start elsewhere took it for
  gone, or the hold was replaced by hand), this one stops: it notices at
  its next refresh, within 10 seconds, stops answering, lets nothing in
  progress finish, writes nothing more to the folder, and logs *Another
  server has taken this data folder … while this one was running.* and
  *This server has stopped: … Stop the other one, or give this one a data
  folder of its own (GALLEY_HOME), then start it again.* `galley serve`
  exits 1.

**What an operator sees when two servers are on one folder.** The one that
lost the folder exits 1 with the two lines above. Under a restart policy
(`restart: unless-stopped`, a platform that restarts failed machines) it is
started again, and each start logs *Another server's hold is on this data
folder (…). Checking whether it is still running: about 21 seconds.* and
then stops with *Another editor is running on this data folder (…). Stop it
first, or give this one a data folder of its own (GALLEY_HOME).* That
repeats, with the platform's own pause between tries, for as long as both
are there; the server that holds the folder is not disturbed by it. To end
it, find the second server (the lines name its process, machine and port: a
second compose project or service pointed at the same volume, a machine
that was scaled to two, a container left running by hand) and stop it, or
give it a data folder of its own. The one that is left starts, or carries
on, by itself.

Local mode and the desktop app take no hold.

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

### Keeping up with the repository

A hosted install holds its own clone of the site's repository. Someone who
pushes to that repository from elsewhere — a developer, a CI job — changes
the code host, not the clone, so the editor looks for itself:

- **Every few minutes** (`GALLEY_SYNC_MINUTES`, default 5; `0` turns it off)
  it fetches the site's branch and, when the code host has commits the clone
  lacks, fast-forwards to them (`git merge --ff-only`) — exactly what
  **Get latest** on Version history does. Nothing here is ever overwritten,
  merged or rewritten. The rounds start once the site is connected; a site
  waiting for its deploy key is left to first run's own retry. A round is
  skipped, not queued, while a save, a publish, an undo of a publish, Get
  latest, a connect or a restore is in progress, while the assistant is
  working on the site, and while the preview is installing the site's
  packages; it never overlaps itself. When a person's look is already going
  the round uses that one rather than fetching again. A round skipped for
  the assistant or for the preview's install still fetches, so "newer
  versions are waiting" stays true while they can't come in; a round skipped
  for install-level work (a connect, a restore, a publish job) does not.
  Rounds skipped for 30 minutes running are said in the log once, with the
  reason, and once more when they run again. A restore waits for a round in
  progress before it closes the site. The start-up lines say which: `Repository: checked every
  5 minutes; newer versions are brought in when nothing here is in the way`,
  or `Repository: not checked by itself (GALLEY_SYNC_MINUTES=0)`.
- **Version history looks when it opens** (`POST /api/sites/:siteId/git/check`,
  open to every role: it changes no file) and says "Checking the repository…"
  until the code host answers. It then says when it last heard from it
  ("checked 4 min ago"), and never says the copy is in step on the strength
  of a look more than ten minutes old that a newer one couldn't repeat.
  The look runs even with `GALLEY_SYNC_MINUTES=0`. People who open Version
  history at the same moment share one look: the code host is asked once.
- **"In the way"** means git would refuse the fast-forward, so the round
  doesn't try: a file with unpublished changes here that the new commits
  change too (publish or discard that change, and the next round brings them
  in), or commits published here that the code host doesn't have while it
  has newer ones — the two have diverged, and someone who knows the
  repository has to merge or rebase them by hand. Version history and the
  status bar ("Newer versions are waiting") say so; unpublished changes to
  other files never stop it.
- **When commits come in**, the open browsers refresh what they show and say
  once "3 newer versions from the repository were brought in." A running
  preview is stopped before the files change, the dev server's saved content
  store is removed (for Astro, exactly `.astro/data-store.json` and
  `node_modules/.astro/data-store.json`; see the adapter's
  `forgetPreviewSaves`), and the preview is started again — the same for
  **Get latest**. A stopped preview stays stopped, and a **Start** pressed
  while the files are changing waits until they are in (the preview says
  "Newer versions are coming in. The preview starts as soon as they are
  in."). A preview that is installing the site's packages is left to
  finish: the round waits for it, and **Get latest** says to try again
  once it has finished. When the new commits
  change `package.json` or a lockfile at the site's top, the next start
  installs the site's packages first, as a first start does; so does the
  start after an install that failed or during which the preview was
  stopped. The app's own
  **Restart preview** also removes that store when the copy is on another
  commit than the one the preview last started on; on a large site that
  restart then costs the framework's first-start content sync again.
- **The log** gets one line per round that changed something or failed in a
  new way, never one per quiet round, and the same failure once (and once
  more when it clears): `Repository: brought in 2 newer versions (3 files
  changed).`, `Repository: couldn't check for newer versions: …`,
  `Repository: the code host answers again.`, `Repository: 1 newer version
  waiting, not brought in: …`, `Repository: nothing is in the way of newer
  versions any more.`, `Repository: the editor's rounds have been skipped
  for 31 minutes, because the assistant is working on the site. Newer
  versions, if there are any, come in once that is over.`, `Repository: the
  editor's rounds run again.`

A look holds no save back: it fetches outside the lock that saves take, so
a code host that hangs (the network timeout is 120 seconds) delays only other
looks, publishes and Get latest, which take their turn one at a time. The
save lock is taken only for the moment the fetched commits are brought into
the files. Publishing, undoing a publish and sending are different: they
hold the save lock from start to finish, the push included, so a push to a
code host that hangs holds saves back for up to those 120 seconds.

Bringing commits in (`git merge --ff-only`) runs with
`core.hooksPath=/dev/null`: none of the repository's own hooks run for it
(a `post-merge` hook that installs packages would hold the save lock for as
long as it took; the preview installs what changed dependencies need).
This holds for a person's **Get latest** as well as the round, in local
mode and the desktop app too. Hooks still run for a publish, whose
pre-commit checks are the site's own.
Fetches and that merge also run with `maintenance.auto=false` and
`gc.auto=0`, so git starts no background tidying that could outlast them.
A Get latest whose fetch can't reach the code host answers 502 with the
plain reason; one refused for what is in the way answers 409.

An edit to an entry is written only over the text it was worked
out from: when a discard, incoming commits or an undone publish rewrote the
file first, the edit is worked out again from what is there, or, when the
editor said which version it had open, refused so that the person reopens
it. The assistant's changes are never worked out again: it changes an entry
or replaces a file only if it has read it in the conversation and the file
is still that version, and is otherwise told to read it again. What a
conversation has read is remembered from one reply to the next, for the
conversations used most recently, until the server restarts. The round runs
as the engine (core `install/caller.ts` `asEngine`), around the one call that
brings commits in; the events it causes go out as nobody, so a plugin
reacting to one can't bring commits in or publish.

### The Install page

`/install`, for owners: the address, the preview's and live
comparison's addresses, the version, when it was set up; the repository and
how it is reached (the public key, **Make a new key** — the old one stops
working at once); **People** ([Looking after people](#looking-after-people));
the publishing name, which now says each person publishes under their own
name and points to Your account; **Download a backup** and **Restore**; and
what is stored where, with sizes and whether a backup carries it. Editors and
contributors don't have the Install page: a link to it shows "This isn't
part of your account." Everyone's own password and **Sign out everywhere**
are on **Your account** (`/account`). The sizes are measured in the
background within a time budget and never walk installed packages, so a size
can be empty for a while; measuring stops when the server stops. Anything the
operator fixed with a starting value is marked "Set by whoever runs the
server". The screens a person sees on a hosted install speak of "this
editor" and "the server", never "this computer".

---

## Back it up and restore it

**What a backup holds**: everything a fresh install couldn't rebuild — the
state (with the accounts: everyone's name, e-mail, role and password hash,
and the open invitations and links as hashes), settings, stored keys,
`keys/`, the session key, the per-site state
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
  signs everyone out. From then on the backup's own people and passwords
  apply: everyone signs in again with the account they had when the backup
  was made, and anyone added since is gone. A backup made before accounts
  is read through the same upgrade as a data folder
  ([Upgrading to accounts](#upgrading-to-accounts)); that path hasn't been
  tried with a real backup yet. Only an owner can restore.
- **At first run**, on a fresh install: **Restore from a backup** instead of
  creating the owner (the setup code is the proof there).
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

### Upgrading to accounts

An install from before accounts (data layout 1, one shared password) is
upgraded to layout 2 at its first start on the new image:

- **The shared password becomes one owner** with the same password, and no
  name or e-mail yet. Whoever knew the password signs in with it alone, as
  before; the sign-in page asks for the password only.
- **Everyone is signed out once**: cookies from before the upgrade, and the
  preview's viewer cookies, are refused.
- Right after signing in, the owner is asked once for their **name and
  e-mail** ("Add your name and e-mail", with their current password). **Not
  now** closes it until the app is next opened. Until they add them they
  can't invite anyone, and their publishes carry the install's publishing
  name. Once they have an e-mail, sign-in asks for it. An operator can fill
  both in instead with `GALLEY_OWNER_NAME` and `GALLEY_OWNER_EMAIL`, once.
- **The old state file is kept** beside the new one, as
  `install.json.schema-1.bak` (0600), until the next upgrade of the layout.
  It holds the old password's hash.
- An install that had no password yet gets no account: first run makes the
  owner, as on a fresh install.

The site, its unpublished changes, settings, keys and history are not
touched. The behaviours that changed for an operator:
`--reset-password` now makes a new-password link and no longer signs
everyone out or forgets the password; `POST /api/install/password` with the
operator's token is refused (403); a publish over MCP or with the token
carries the install's publishing name, not a person's.

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
| Sessions end on sign-out everywhere, across a restart; a changed password signs that person's other browsers out. | `server/test/hosted-security.test.ts`, `server/test/install.test.ts`, `core/test/install/state.test.ts` |
| Passwords are scrypt hashes; the setup code and every one-time link's code are kept as a SHA-256 only; wrong codes count against the sign-in limit. | `core/test/install/state.test.ts`, `core/test/install/people.test.ts`, `server/test/install.test.ts` |
| Every route answers each role exactly as the one table says: the right level gets through, anyone below it gets 403, nobody signed in gets 401. | `server/test/accounts-access.test.ts` |
| An unknown e-mail, a wrong password and a switched-off account get the same answer, the same number of password checks and the same line; a client (an IPv4 address or an IPv6 `/64`) is held to its limits before its password is checked, successes included; one e-mail's sign-ins are checked one at a time from any number of clients, a few wait, the rest are told to wait without a check, and past 10 failures each waits a delay that grows to 30 s, so a day holds at most about 2,900 guesses for it; a browser that signed in before skips the line and is never a session; password checks are shared out client by client, and one client can't fill them. | `server/test/sign-in-gate.test.ts`, `server/test/accounts.test.ts`, `server/test/accounts-hardening.test.ts`, `core/test/install/people.test.ts` |
| On a hosted install, publishing, the site's settings file and writes outside the content are refused for work done for nobody — a plugin's hooks included — and work for the operator's token, the engine's own steps or a person goes ahead as before; local mode is unchanged. | `core/test/install/caller-required.test.ts` |
| Every link is built from the editor's public address; without it nothing is e-mailed and a link is shown only on a loopback address; a new-password link the server e-mailed isn't shown to the owner. | `server/test/accounts-links.test.ts` |
| The site's settings file — saved, written as a file in any mode or letter case, discarded, or put back by undoing a reply or a publish — is an owner's by every route; build mode, custom code in a form and the brand outside the content files are an editor's or owner's, and a request for build mode below that is refused, not narrowed; the values the editor records for itself change nothing else in the file. | `core/test/install/caller-access.test.ts`, `server/test/accounts-hardening.test.ts`, `core/test/install/settings-records.test.ts` |
| The assistant offers each role only its tools and checks again on every call; every MCP tool, run as each role, does only what that role allows. | `core/test/ai/tools-access.test.ts`, `server/test/mcp-access.test.ts` |
| Only an owner changes an e-mail address: their own, with their password, or anyone else's in People; it ends that person's open link. | `server/test/accounts-hardening.test.ts` |
| The list of signed-out browsers stays within its cap; past it, a sign-out signs that person out everywhere; a longer list never stops the install from starting. | `server/test/accounts-hardening.test.ts` |
| Switching someone off or removing them ends their access on their next request, their open event streams and their preview access; a role change applies to the next request. | `server/test/accounts.test.ts`, `server/test/gateway-auth.test.ts`, `core/test/install/people.test.ts` |
| A one-time link works once and only while it lasts; every bad code gets the same refusal; a newer new-password link cancels the older. | `server/test/accounts.test.ts`, `core/test/install/people.test.ts` |
| "Forgot my password" answers the same whether or not the address has an account, and can't flood a mailbox. | `server/test/accounts.test.ts` |
| The last owner who can sign in stays an owner and stays switched on; nobody changes their own account through People. | `core/test/install/people.test.ts` |
| A contributor never receives what a visitor sent through a form. | `server/test/accounts.test.ts` |
| The upgrade turns one shared password into one owner with the same hash, and old cookies stop counting. | `core/test/install/people.test.ts` |
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
from the repository, running on the server, by design.** It runs for anyone
who can sign in, whatever their role: editors and owners can change that
code in build mode, and a contributor's content is what it reads and
renders, and in some sites runs. The protection is around the process, not
inside it:

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
one site. Give an account, whatever its role, only to someone you would
trust with the repository and with what runs in that container ([What
roles are, and what they aren't](#what-roles-are-and-what-they-arent)).

### What leaves the machine

No telemetry, and nothing to Fiction Tribe. An install connects to:

- **the site's git host** — copy, pull, publish; SSH (port 22) with the deploy
  key, or HTTPS with a token;
- **the package registry** the site uses, when its dependencies are installed;
- **the live site**, when Proof shows it beside the preview;
- **the AI providers**, only when a key is set and someone uses the assistant
  or image generation;
- **Cloudflare or Vercel**, if someone puts the site online from the install;
- **a mail server or webhook**, if the inbox's alerts or forwarding are set;
  and the mail server for invitations and new-password links, when
  `GALLEY_SMTP_URL` is set.

The full list, with what is sent, is the documentation site's
[Security model](../apps/site/src/content/docs/running/security.md).

---

## Where an install runs

Four shapes. Prices are rough, monthly, for one install, from each
provider's own page as read on the date given — an estimate, not a quote.

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

### Google Cloud (a virtual machine per install)

A Compute Engine virtual machine is a plain server: it runs the reference
recipe above unchanged, and this project's own website's editor runs that
way, set up by hand. **Host the editor online** or `galley host --host gcp`
now makes the same shape through Google's API, in the person's own project,
with a key file from Google Cloud (a service account's JSON key):

- a network of its own (custom subnets) with one subnet, `10.20.0.0/24`;
- one firewall rule: tcp 80 and 443 and udp 443 from anywhere, to the
  machine's network tag only — no SSH rule, because nothing needs one;
- a fixed address (a reserved regional external IPv4 address);
- the virtual machine: `e2-small` (2 GB, the default) or `e2-medium` (4 GB,
  for a site whose repository holds much more than the site), Ubuntu 24.04
  LTS (`ubuntu-os-cloud`, family `ubuntu-2404-lts-amd64`), a 20 GB balanced
  boot disk, the fixed address, Shielded VM (secure boot, vTPM, integrity
  monitoring), **no service account**, and a `startup-script` that installs
  Docker and the compose plugin, writes the recipe's `caddy` files
  (`compose.yaml`, `Caddyfile`, `.env` — byte for byte what `recipe.ts`
  writes) to `/opt/galley` and runs `docker compose up -d`. It runs on every
  boot and is safe to: Docker only when missing, the files rewritten whole.
  It holds nothing secret — the setup code only as its SHA-256;
- the three DNS names as DNS-only A records to the fixed address, with a
  comment naming the install, when a stored Cloudflare key may edit the
  domain; otherwise the exact three records to add by hand, with the address
  once it exists.

Everything that can carry a label (the machine, its disk, the address, a
snapshot) carries `galley-install=<name>`; networks, subnets and firewall
rules can't, so their name and a description naming the install tag them.
The key needs three roles: **Compute Instance Admin (v1)**, **Compute
Network Admin** and **Compute Security Admin** (Compute Admin would do, but
is far broader). The app checks them before anything is made with Cloud
Resource Manager's `projects.testIamPermissions`, and says which role is
missing and where to add it; a Compute Engine API that is off is said with
the page that turns it on. **Upgrade** puts the new image into the startup
script (`setMetadata`, with its fingerprint), then stops and starts the
machine — a clean shutdown, not Google's `reset`, which is a hard reset that
would cut off a publish in progress; the same disk keeps everything.
**Back up** makes a labelled snapshot of the disk, which stays in the
project until deleted; removing the editor leaves snapshots. **Remove**
deletes, after checking each still carries its label or description: the DNS
records, the machine (its disk goes with it), the address, the firewall
rule, the subnet, the network — and leaves alone anything changed, anything
the kept machine still uses, and a network someone added to.

What one install costs, on demand in Iowa (`us-central1`), worked out at 730
hours a month from Google's hourly prices (no monthly figure is printed):

| Size | Machine | 20 GB balanced disk | Fixed address | A month |
| --- | --- | --- | --- | --- |
| 2 GB (`e2-small`, $0.016752855 an hour) | $12.23 | $2.00 | $3.65 | about $17.88 |
| 4 GB (`e2-medium`, $0.03350571 an hour) | $24.46 | $2.00 | $3.65 | about $30.11 |

Sources, read 2026-11-24: [machines](https://cloud.google.com/products/compute/pricing/general-purpose)
(the "Default", on-demand column), [disks](https://cloud.google.com/compute/disks-image-pricing)
("Balanced provisioned space $0.000136986 / 1 gibibyte hour"),
[addresses](https://cloud.google.com/vpc/network-pricing) ("Static and
ephemeral IP addresses in use on standard VM instances $0.005 / 1 hour").
Outgoing data, snapshots and taxes aren't included.

**What was run:** "Host the editor online" for Google Cloud has run only
against a strict local stand-in for Google's token endpoint,
testIamPermissions and Compute Engine (`core/test/hosting/gcp.test.ts`,
`core/test/hosting/fakes/gcp.ts`): never against Google, and never with a
real key or project. The shape it makes is the one the hand-made VM above
runs.

- **Cloud Run can't hold an install.** Its volumes are in memory, a Cloud
  Storage bucket, or an NFS share — there is no persistent disk for the
  site's checkout and its unpublished changes
  ([Cloud Storage volumes](https://docs.cloud.google.com/run/docs/configuring/services/cloud-storage-volume-mounts),
  [NFS volumes](https://docs.cloud.google.com/run/docs/configuring/services/nfs-volume-mounts),
  [in-memory volumes](https://docs.cloud.google.com/run/docs/configuring/jobs/in-memory-volume-mounts),
  read 2026-11-24).

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

1. **Where.** Fly.io; Google Cloud; Cloudflare, in front of a computer of
   yours; or any server with Docker. "Why not Vercel, Netlify or Cloudflare Containers?"
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
   this computer. Whoever opens the editor's setup link creates its owner's
   account, and the editor gets its own key for the repository — this
   computer's aren't copied."
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
   first run, where the person creates the install's owner account and adds
   its own key to the repository. For the self-run hosts, the person starts the files and
   chooses **Check**.
7. **Later**: **Upgrade to …** (a new image, the disk kept), **Back up**
   (on Fly.io, a snapshot of the disk that Fly.io keeps for 7 days; on
   Google Cloud, a labelled snapshot that stays until deleted; otherwise
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
  Runs:            ghcr.io/fictiontribe/galley:0.4.2

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

`galley host` is in 0.2.0 and newer (`npx galley-cms host`), and Google Cloud
as a host in 0.3.0 and newer. Then `galley host status|link|check|upgrade|backup|remove`. Keys come from
`FLY_API_TOKEN`, `GOOGLE_APPLICATION_CREDENTIALS_JSON` (the key file's whole
text, not its path) or `CLOUDFLARE_API_TOKEN`, else the stored one, else a
prompt (and stored; for Google Cloud, the key file pasted or its path).
Until the image is published, set `GALLEY_HOSTING_IMAGE` to an
image you pushed. A hosted install never offers any of this (its routes
answer 404).

**Hosts are pluggable.** A plugin can add one through `editorHosts` in the
plugin API ([docs/plugins.md](plugins.md#editor-hosts)): the same
`EditorHost` interface (`packages/core/src/hosting/types.ts`) the four
built-ins implement — inspect, plan (creating nothing), create exactly the
plan, remove only what was created. A plugin can't replace a built-in.

**The rehearsal.** `scripts/rehearse-hosting.mjs` starts the strict fake
Fly.io, Google Cloud and Cloudflare APIs the tests use on local ports and
prints the variables to start the app with (`GALLEY_HOSTING_FLY_API`,
`GALLEY_HOSTING_GCP_COMPUTE_API`, `GALLEY_HOSTING_GCP_OAUTH_API`,
`GALLEY_HOSTING_GCP_RESOURCE_MANAGER_API`, `GALLEY_HOSTING_CLOUDFLARE_API`,
`GALLEY_HOSTING_INSTALL_API` and the fakes' made-up keys — for Google Cloud
a made-up key file written beside the evidence), so the whole flow can be
walked with no real host. A small fake install answers by default; with
`GALLEY_FAKE_LAUNCH` every machine the fake Fly.io or Google Cloud creates
becomes a real `galley serve` process. Every call the fakes answered is
written to an evidence file, with no keys in it.

---

## What has been run

> This section holds only what has been run, as of 2026-11-24.

**By automated tests in this repository**, against real folders, real local
git repositories and started servers:

- the single-site refusals, in the engine and over HTTP
  (`server/test/hosted-refusals.test.ts`, `core/test/install/install.test.ts`);
- keeping up with the repository: a look that finds new commits without
  touching a file and one that fails without throwing, fast-forwards that
  keep unrelated unpublished changes, the refusals for a changed file and for
  diverged histories, no round during a publish
  (`core/test/workspace/keep-up.test.ts`); the preview stopped, its saved
  store removed and started once around commits that change a page and its
  schema together, a stopped preview left stopped, a refused one left running
  (`core/test/site/keep-up-preview.test.ts`); the rounds with a timer the test
  turns — brought in, skipped when busy, a failure said once, the engine's
  mark, stopped at shutdown, off at 0 and in local mode
  (`server/test/keep-up.test.ts`);
- first run through HTTP against real local repositories, including a
  starter sent to an empty repository and a site in a folder of its
  repository (`server/test/install.test.ts`, `core/test/install/install.test.ts`);
- the access-token path against a real `git http-backend`
  (`core/test/install/access.test.ts`);
- sessions and sign-out everywhere across a restart
  (`server/test/install.test.ts`, `core/test/install/state.test.ts`);
- accounts, on a started hosted server: every route asked as an owner, an
  editor, a contributor, nobody and the operator's token, against the one
  table (`server/test/accounts-access.test.ts`); sign-in, the limits,
  invitations, new-password links, "forgot my password", signing out,
  switching off and removing, and the event stream
  (`server/test/accounts.test.ts`, with a stand-in mail transport); the
  preview's viewer cookie ending with the account
  (`server/test/gateway-auth.test.ts`); the rules, the links running out
  and the upgrade from one password (`core/test/install/people.test.ts`);
  links built only from the public address, with and without it and with
  and without a mail transport, and the e-mailed new-password link kept
  from the owner (`server/test/accounts-links.test.ts`); the sign-in
  limits with a clock that never really waits and a password check the
  test holds: one e-mail from many clients, a simulated day of guesses
  against the bound, an IPv6 `/64` as one client, the known browser, one
  client firing many at once, floods within and past the waiting rooms
  (`server/test/sign-in-gate.test.ts`); the known browser on a started
  server, changing e-mails, the cap on signed-out browsers, and the
  settings file and build mode by every route
  (`server/test/accounts-hardening.test.ts`); the settings file and build
  mode by every way into the engine, a role changed part-way, and work that
  outlives its request (`core/test/install/caller-access.test.ts`,
  `core/test/install/settings-records.test.ts`); guarded work for nobody
  refused on a hosted install, a plugin's hooks included, and allowed for
  the operator, the engine and a person (`core/test/install/caller-required.test.ts`); every assistant tool and
  every MCP tool as an owner, an editor, a contributor and nobody
  (`core/test/ai/tools-access.test.ts`, `server/test/mcp-access.test.ts`);
  the screens for each role against the app's local stand-in server
  (`web/test/install/accounts-*.test.ts`, with every screen walked as each
  role in `accounts-build.test.ts`), which refuses the way the real server
  does — the same 403 for a role, the same error bodies, and its sign-in
  limits answering 429;
- the preview through the one address on a started hosted server, including
  a WebSocket and cookie isolation (`server/test/hosted-gateway.test.ts`,
  `server/test/gateway.test.ts`);
- back up → wipe the data folder → restore (`server/test/install-ops.test.ts`,
  `core/test/install/backup.test.ts`);
- the security pass (`server/test/hosted-security.test.ts`);
- every host's whole life — inspect, plan, create, hand over, upgrade, back
  up, remove — against strict local fakes of Fly.io and Cloudflare
  (`core/test/hosting/service.test.ts`) and of Google Cloud's sign-in,
  permission check and Compute Engine (`core/test/hosting/gcp.test.ts`);
- no lockfile left behind by the preview's package install
  (`core/test/workspace/install-lockfile.test.ts`); the Install page's
  storage sizes (`core/test/install/storage.test.ts`); the repository's
  compose example matching the recipe
  (`core/test/hosting/compose-example.test.ts`); the hosted screens' words
  (`web/test/install/hosted-words.test.ts`).

**In a real browser**, on 2026-11-24 on a Mac: two separate headless Chrome
browsers against the real `galley serve` from the repository (hosted mode,
a loopback port, a local bare repository as the site, no outgoing e-mail).
The first opened the setup link, created the owner, was signed out and in
again by e-mail and password, finished first run, and on the Install page
invited a contributor: the link was shown once, with when it stops working.
The second opened that link — the code left the address bar at once —
chose a name and a password and landed in the site as a contributor: no
Publish (the line about who publishes instead), no Inbox, Settings, Install
or App settings; opening the Install page or the inbox by address showed
"This isn't part of your account."; Your account showed its sections. None
of those screens made a call the server refused. The owner then switched
the contributor off: their browser was sent to sign-in on its next step and
signing in again was refused. Not driven in a browser: the editor's role,
the new-password page, "Forgot your password?", and the question an owner
from before accounts is asked.

**By `scripts/rehearse-accounts.mjs`** (`npx tsx scripts/rehearse-accounts.mjs`),
on 2026-11-24 on a Mac: the real `galley serve`, from the repository, in
hosted mode on a loopback port, with temporary data folders, a local bare
repository as the site, a small SMTP sink as the mail server, and each
"browser" its own cookies and client address. The main server has the
editor's public address set (its own loopback port), and an operator's
access token. All 19 steps passed:

1. first run with the setup code: the owner's account, the site connected,
   finished; the setup code refused a second time;
2. `GET /api/meta` as the owner: the account, what it may do, sign-in by
   e-mail;
3. an editor and a contributor invited, each link used once from a fresh
   browser; used and unknown codes refused with one sentence;
4. the contributor edits an entry; Publish, the inbox, People, the Install
   page and saving a key refused with 403; no key's last characters anywhere
   they read;
5. the site's settings file by every route: the contributor's five ways in
   (the settings screen, a file write in build mode by its own name and in
   other letter case, a file write in content mode, a delete as media) and
   the editor's file write in build mode refused — the build-mode writes
   with the build-mode sentence, the editor's with the settings sentence —
   and the file unchanged; the owner's save works, the contributor's discard of the
   owner's change is refused, and the owner's own discard puts the file
   back;
6. the editor and the owner each publish: two authors in the repository;
7. the editor made a contributor: their very next Publish refused, without
   signing in again;
8. the contributor switched off: their next request 401, and their sign-in
   gets the wrong-password sentence;
9. outgoing e-mail: an invitation and "forgot my password" each send one
   message whose link works; an unknown address gets the same answer and no
   message;
10. "Sign everyone out", then the owner back in with e-mail and password;
11. the rest of People and Your account, with the bodies the web app sends;
    a new-password link the owner makes arrives only in the person's inbox,
    built from the public address, and isn't handed to the owner;
12. the operator's access token publishes: work done for the operator,
    not for nobody;
13. the sign-in limits: after 10 guesses at the owner's e-mail from 10
    addresses, the browser the owner signed in on before gets in at once,
    and a browser never used here waits its turn and its delay, then gets
    in;
14. the log: no password, key, link code or e-mail address in it;
15. the built web app: `/join`, `/new-password` and `/account` are the app's
    own page, signed out and signed in;
16. without the editor's public address, outgoing e-mail set up: the
    `E-mail:` start-up line says no link is e-mailed until it is set;
    "forgot my password" answers that nothing can be e-mailed; an invitation
    asked for through another hostname is refused with the sentence that
    names `GALLEY_PUBLIC_URL`; one made on the loopback address is shown,
    built from it; no message reaches the mail server;
17. an install from before accounts (data layout 1): the password alone,
    the account completed, then sign-in by e-mail;
18. `serve --reset-password` for a locked-out owner, twice: the first link
    dies when the second is made; the second works once;
19. a starter sent from first run: its first version carries the owner's
    name, with no publishing name saved yet.

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

- **Keeping up with the repository on a real code host or a real install.**
  Only local bare repositories have played the code host, and only a
  stand-in dev server the preview (`core/test/workspace/keep-up.test.ts`,
  `core/test/site/keep-up-preview.test.ts`, `server/test/keep-up.test.ts`):
  not GitHub over SSH, not a real Astro dev server, not the image, not a
  reinstall after newer commits changed the site's packages.

- **Accounts beyond the rehearsal and the browser pass above.** Not yet on
  the real image. In a real browser, not yet: the editor's role, the
  new-password page, "Forgot your password?", the question an owner from
  before accounts is asked, **Change e-mail…**, a new-password link that is
  e-mailed rather than shown, and what a contributor is offered where build
  mode, custom code or the site's settings would be (the app's stand-in
  server and the rehearsal cover these). Sending e-mail has not been tried against a
  real mail server (only the rehearsal's local sink and a stand-in
  transport). A link running out was tested with a moved clock in the
  engine, not over HTTP. The sign-in limits have not been run end to end
  against a real server (the tests and the app's stand-in server check
  them); they live in memory, so a restart resets them.
- **Any real run of "Host the editor online" on Google Cloud.** In
  particular: whether an address takes its labels on insert (the code sets
  them with setLabels when it didn't), the status code of a stale metadata
  fingerprint (the code reads again and retries once on 409 or 412), whether
  Cloud Resource Manager must be on for the permission check (the code then
  says it couldn't check, without blocking), how long the first boot takes to
  install Docker and pull the image, and whether 1536 MB for the editor on a
  2 GB `e2-small` (with 2 GB of swap) is enough for a real site's preview.
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
  date given; the Fly.io 2 GB figure is derived from its rates, not printed;
  the Google Cloud monthly figures are worked out from hourly prices at 730
  hours, for Iowa only.
