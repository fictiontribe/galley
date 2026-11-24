---
title: Run a hosted install
navTitle: Hosted install
description: Run Galley on a server for one site — start it with Docker and Caddy, point three names at it, finish first run, back it up, upgrade it, and know what it can reach.
group: running
order: 2
---

This page is for whoever runs Galley on a server so a site can be edited from any browser. A **hosted install** is the same server and app as on a laptop, for **one site**, behind a password, with everything it keeps in one data folder. Ten sites are ten installs that share nothing. The desktop app keeps its list of many sites; a hosted install has no Sites screen.

> **Status.** Not in a release yet: it is in the repository, and **the image isn't published to a registry**, so you build it yourself (below). Run for real on 2026-11-24, as this page describes it: built from source on a small Google Cloud VM and running this project's own website's editor behind Caddy on a real domain; a whole first run, preview, Proof, Publish, restart, upgrade, backup and restore on the real image. Not yet run: on Fly.io or with a Cloudflare tunnel, behind Cloudflare Access, with a deploy key accepted by GitHub, GitLab or Bitbucket end to end, or `scripts/create-install.sh` beyond its dry run. The full account: [`docs/cloud-install.md`]({repository}/blob/main/docs/cloud-install.md#what-has-been-run).

## Start one

You need a server with Docker and its compose plugin, ports 80 and 443 open, about 2 GB of memory for the editor, and a domain you can add three DNS names to.

**Build the image** on the server, in a clone of the repository. It needs Docker's BuildKit — the default builder of Docker Engine with its buildx plugin; with Debian's and Ubuntu's own `docker.io` package, install `docker-buildx` beside it. The old builder stops at the Dockerfile's `--platform=$BUILDPLATFORM`.

```sh
docker build -t galley .
```

**Write the files for one install.** The repository's own [`docker-compose.yml`]({repository}/blob/main/docker-compose.yml), [`Caddyfile`]({repository}/blob/main/Caddyfile) and [`.env.example`]({repository}/blob/main/.env.example) are exactly these files for `cms.example.com`. Copy them — `.env.example` as `.env`, the `image:` line naming the image you built — and change the names, or write them for your own names with the command line, from a clone on your own computer with its dependencies installed ([`CONTRIBUTING.md`]({repository}/blob/main/CONTRIBUTING.md); `galley host` isn't in a release on npm yet):

```sh
node packages/cli/bin/galley.js host recipe --name acme --address cms.example.com --repository git@github.com:example/acme-site.git --image galley --out acme
```

```output
✓ Wrote compose.yaml, Caddyfile, .env to …/acme
```

`acme/` now holds `compose.yaml` (the editor and [Caddy](https://caddyserver.com), which gets the HTTPS certificates; project `galley-acme`), `Caddyfile` (the three names, one block) and `.env` (the editor's settings; nothing secret). `--out -` prints them instead. The editor runs as the user `node` with a read-only root filesystem, every capability dropped, a 2 GB memory limit, one volume and 30 seconds to stop, and publishes no port: only Caddy reaches it. `--image` names the image you built; the default is where the image will be published.

Copy the folder to the server. Then, in that folder there:

1. **Point three names at the server**: an A record (and AAAA, with IPv6) for each of `cms.example.com`, `cms-preview.example.com` and `cms-live.example.com`. On Cloudflare, set them to "DNS only". Caddy gets the three certificates by itself once they point there.
2. **Start it**:

   ```sh
   docker compose up -d
   ```

3. **Open the setup link** straight away — whoever opens it first chooses the password. Nothing is needed before the first start: the editor makes a one-time link and prints it in its log.

   ```sh
   docker compose logs editor
   ```

### Several sites on one server

`scripts/create-install.sh` makes one install per run — its own project, its own volume, its own folder — behind one Caddy all of them share, and prints the setup link once at the end. `--dry-run` says what it would do:

```sh
sh scripts/create-install.sh acme git@github.com:example/acme-site.git cms.example.com --image ghcr.io/fictiontribe/galley:0.1.3 --dry-run
```

```output
Dry run: nothing is written, started or changed.
…
  folder        ./galley-installs/acme/  (compose.yaml, .env)
  shared proxy  ./galley-installs/proxy/  (compose.yaml, Caddyfile — first install on this server)
  proxy entry   ./galley-installs/proxy/sites/acme.caddy
  volume        galley-acme_data  (the install's whole state)
…
```

It takes `--preview-address` and `--live-address` too, as `galley host recipe` does. Only its dry run has been run so far.

### Without Docker

`galley serve` is the same server; the image runs it. From a clone, behind a reverse proxy on the same machine:

```sh
GALLEY_PUBLIC_URL=https://cms.example.com GALLEY_TRUST_PROXY=1 node packages/cli/bin/galley.js serve --host 127.0.0.1
```

```output
Galley is serving on 127.0.0.1 (this computer only; put a reverse proxy in front), port 4400.
Address:   https://cms.example.com
Setup:     https://cms.example.com/setup?token=<one-time code>
           Open it now: it works once, and whoever opens it first chooses the password.
…
Previews:  https://cms-preview.example.com (the live site beside it at https://cms-live.example.com), through this port; only a signed-in browser is let in
Data:      /data (the site, its settings and stored keys, sessions — everything this install keeps)
```

The docs ran it on a spare port with a throwaway data folder; the output shows the image's folder, `/data`. Outside the image the data folder is `GALLEY_HOME`, default `~/.galley`. A setup code you supplied yourself isn't printed again: the line shows a placeholder. `galley serve --help` lists every variable it reads; they are all in [Environment variables](/docs/reference/environment/#a-hosted-install).

## The three names

The editor, its preview and the live comparison are three names on **one port**:

| Name | What answers | Set with |
| --- | --- | --- |
| `cms.example.com` | the editor | `GALLEY_PUBLIC_URL` |
| `cms-preview.example.com` | the site's preview, with click-to-edit | `GALLEY_PREVIEW_URL` |
| `cms-live.example.com` | the live site, beside the preview in Proof | `GALLEY_LIVE_VIEW_URL` |

The last two are worked out from the first unless you set them. Names, not paths, because sites and their dev servers expect to be at the root; and the preview must be another origin than the editor, so the site's own scripts can never act as the person signed in. Sibling names (`cms-preview.`, not `preview.cms.`) because free certificates, Cloudflare's included, cover one level below the domain only. An editor at the top of a two-part suffix (`example.co.uk`) would get someone else's names (`example-preview.co.uk`): use `cms.example.co.uk`, or give both names with `--preview-address` and `--live-address`.

Only a browser the editor let in sees the preview: the editor gets a one-use ticket (60 seconds), the frame trades it for a cookie tied to that sign-in, and signing out ends it. Anyone else gets a 401 page.

The proxy in front must keep the `Host` header (Caddy does), terminate HTTPS for all three names, and pass WebSockets and the event stream `GET /api/events` unbuffered. With it, set `GALLEY_TRUST_PROXY=1`.

## First run

1. **Choose the password**, 12 characters or more.
2. **Connect the site**: an existing repository, or a starter sent to an empty one. The install reaches it with **its own deploy key** — it shows the public half; add it to the repository **with write access** and choose **Check again** — or with an access token over HTTPS. A site in a folder of a larger repository: give the folder (`apps/site`). The whole repository is copied; only that folder is the site, and changes outside it are neither shown nor published.
3. **A few details**: the name and e-mail every publish is recorded with, the live address, the assistant's key.

Or, on the first screen, **Restore from a backup**. First run leaves nothing to publish: the live address is kept in the install's own state, not in the site's `galley.config.json` (when the site's settings name a live address of their own, that one wins and is shown as set). A first run left half-way carries on after the ordinary sign-in.

### Start it unattended

Everything first run asks can be given up front as **starting values**: `GALLEY_PASSWORD`, `GALLEY_SITE_REPOSITORY`, `GALLEY_SITE_BRANCH`, `GALLEY_SITE_FOLDER`, `GALLEY_SITE_ACCESS`, `GALLEY_SITE_TOKEN`, `GALLEY_SITE_STARTER`, `GALLEY_AUTHOR_NAME`, `GALLEY_AUTHOR_EMAIL`, `GALLEY_SITE_LIVE_URL`, `ANTHROPIC_API_KEY` — or one JSON file named by `GALLEY_INSTALL_CONFIG` (readable by the server's user only):

```json
{
  "address": "https://cms.example.com",
  "password": "…",
  "site": { "repository": "git@github.com:example/acme-site.git", "branch": "main", "access": "deploy-key" },
  "author": { "name": "Sam", "email": "sam@example.com" },
  "liveUrl": "https://www.example.com",
  "keys": { "anthropic": "sk-ant-…" }
}
```

Each starting value is used once, only while the install lacks that thing, so restarting with the same values changes nothing, and what someone changes in the app afterwards stays changed. With a password, a repository and the publishing name, first run finishes by itself. To keep the setup code out of the log, give your own with `GALLEY_SETUP_TOKEN` (24+ characters), or only its SHA-256 with `GALLEY_SETUP_TOKEN_SHA256`.

### A forgotten password

Stop the editor first — nothing stops a second server starting on the same data folder — then start it once with `--reset-password`, in the install's folder:

```sh
docker compose stop editor
docker compose run --rm --use-aliases editor serve --reset-password
```

```output
…
Setup:     https://cms.example.com/setup?token=<one-time code>
           Open it now: it works once, and whoever opens it first chooses the password.
…
```

It forgets the password, signs everyone out, prints a new one-time link and keeps serving. Open the link, choose the new password, then stop it with Ctrl+C and start the editor again:

```sh
docker compose start editor
```

The site and everything else stay. A setup code that has been used stays dead: an old code or hash still in the environment is ignored, and a fresh link is made instead (a notice says so).

## The Install page

`/install`, for whoever is signed in: the three addresses and the version; the repository, how it is reached and the install's public key (**Make a new key** replaces it); the publishing name; **Change the password** (every other browser is signed out); **Sign out everywhere**; backups; and what is stored where, with sizes (measured in the background, never counting installed packages, so a size can be empty for a while). What the operator set with a starting value is marked "Set by whoever runs the server".

### What is kept where

All of it is in the data folder (`/data` in the image, one volume): `install.json` (the install's state: the password's hash, the site's repository and live address), `session.key`, `settings.json` and `secrets.json`, `keys/` (the deploy key, an access token, `known_hosts`), `site/` (the repository's copy, with unpublished changes), `state/<siteId>/` (the inbox, conversations, brand material), `plugins/`, `home/` (package caches, rebuilt when needed), and `backups/` (backups you keep on the volume; never part of a backup).

## Back it up

**Download a backup** on the Install page asks for a passphrase (12+ characters) and gives you one sealed file: the site with its history and **unpublished changes**, the settings, the stored keys and the sign-in. Not in it: installed packages and caches, which are rebuilt — add plugins again after a restore. **The passphrase can't be recovered.**

**Restore** on the Install page, or on a fresh install's first screen, checks the whole file before changing anything, then signs everyone out; sign in with the password of the editor the backup came from. The upload takes up to 2048 MB (`GALLEY_RESTORE_MAX_MB`).

From a terminal, with the editor stopped, in the install's folder, and `GALLEY_BACKUP_PASSPHRASE` set in your shell:

```sh
docker compose stop editor
docker compose run --rm -e GALLEY_BACKUP_PASSPHRASE editor backup create --out /data/backups/site.bak
docker compose start editor
```

```output
…
Backup written to /data/backups/site.bak (…).
Keep the passphrase somewhere safe: without it the backup can't be opened.
…
```

The file stays on the install's volume, in `backups/`, which no backup includes and no restore replaces; copy it off the server to keep it safe. A restore is the same three steps with `backup restore /data/backups/site.bak` in the middle:

```sh
docker compose stop editor
docker compose run --rm -e GALLEY_BACKUP_PASSPHRASE editor backup restore /data/backups/site.bak
docker compose start editor
```

```output
…
Restored the backup made … (by version …) into /data.
Everyone is signed out: sign in with the password the backup was made with.
…
```

Both refuse while they can tell a server holds the folder, but stop the editor first: nothing stops a second server starting on the same folder. Use this for a backup too large to upload — Cloudflare's free plan stops request bodies at 100 MB. Without Docker, run `galley backup` on the data folder (`GALLEY_HOME`) the same way.

## Upgrade it

A new version is a new image on the **same volume**: build or pull it, change the `image:` line in `compose.yaml` if its name changed, and run `docker compose up -d` again. At start-up it upgrades the data folder by itself; in the real runs the editor was healthy again within about ten seconds, with everything as it was. Never start an older image on a folder a newer one has used — it refuses to — so download a backup before each upgrade; going back means restoring it into a fresh volume.

## Health, logs and stopping

- `GET /healthz` answers 200 while the server runs; `GET /readyz` says `starting`, `setup`, `ready` or `restoring`. Neither needs a sign-in or says anything about the install. The image's health check uses `/healthz`.
- The log has one line per request (`GALLEY_LOG_REQUESTS=0` leaves them out) and one for each sign-in, password change, backup and restore. No secret is ever written to it; the setup link is the one exception, on purpose.
- Stopping lets a publish in progress finish (20 seconds, `GALLEY_SHUTDOWN_GRACE_MS`), stops the preview and exits by itself. The compose files give it 30 seconds.
- `GALLEY_PREVIEW_MEMORY_MB` caps the memory of the site's own preview and build; the generated files set 1024.
- The first preview installs the site's packages inside the container — in the real run about 80 seconds with the install. In a site without a lockfile, that install never leaves one behind.

## Forms on a hosted install

A hosted install at a public `https://` address is what lets the live site's forms send to the inbox: the capture address is `https://cms.example.com/f/<siteId>` ([Forms](/docs/forms/#where-visitors-can-reach-it)). The inbox says whether visitors can reach it, and why not when they can't. Keep `/f/` reachable by everyone if you put another sign-in, such as Cloudflare Access, in front. For e-mail alerts set `GALLEY_SMTP_URL` and `GALLEY_MAIL_FROM`.

## What it can reach

The install reaches the site's git host (SSH on port 22 with the deploy key, or HTTPS with a token), the package registry when it installs the site's dependencies, the live site (the comparison) and, when keys are set, the AI providers. Nothing else, and nothing to Fiction Tribe. The site's own preview and build are code from the repository running in the container, by design: the container is the boundary ([Security model](/docs/running/security/#a-hosted-install)).

## Next

- [Host the editor online](/docs/editing/editor-online/) — let the desktop app create an install on Fly.io, behind Cloudflare, or on a server of yours.
- [Security model](/docs/running/security/).
- [White-label](/docs/configuration/white-label/) — rename and recolour it.
