---
title: Run a hosted install
navTitle: Hosted install
description: Run Galley on a server for one site — start it with Docker and Caddy, point three names at it, finish first run, let people in with their own accounts, back it up, upgrade it, and know what it can reach.
group: running
order: 2
---

This page is for whoever runs Galley on a server so a site can be edited from any browser. A **hosted install** is the same server and app as on a laptop, for **one site**, for the people its owner lets in — each with their own e-mail and password, or through your own identity provider — with everything it keeps in one data folder. Ten sites are ten installs that share nothing. The desktop app keeps its list of many sites; a hosted install has no Sites screen.

> **Status.** New in 0.2.0. **The image isn't published to a registry yet**, so you build it yourself (below). Run for real on 2026-11-24, as this page describes it: built from source on a small Google Cloud VM and running this project's own website's editor behind Caddy on a real domain; a whole first run, preview, Proof, Publish, restart, upgrade, backup and restore on the real image. Not yet run: on Fly.io or with a Cloudflare tunnel, behind Cloudflare Access, with a deploy key accepted by GitHub, GitLab or Bitbucket end to end, or `scripts/create-install.sh` beyond its dry run. **Accounts and roles came in 0.3.0, after that run**: covered by automated tests, by a rehearsal over HTTP against the real server on one computer (`scripts/rehearse-accounts.mjs`) and by a pass in a real browser (first run, signing in, People, an invitation, joining from its link, a contributor's screens and switching someone off), not yet tried on the real image or with a real mail server. The full account: [`docs/cloud-install.md`]({repository}/blob/main/docs/cloud-install.md#what-has-been-run).

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

3. **Open the setup link** straight away — whoever opens it first becomes the owner. Nothing is needed before the first start: the editor makes a one-time link and prints it in its log.

   ```sh
   docker compose logs editor
   ```

### Several sites on one server

`scripts/create-install.sh` makes one install per run — its own project, its own volume, its own folder — behind one Caddy all of them share, and prints the setup link once at the end. `--dry-run` says what it would do:

```sh
sh scripts/create-install.sh acme git@github.com:example/acme-site.git cms.example.com --image ghcr.io/fictiontribe/galley:0.4.7 --dry-run
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
           Open it now: it works once, and whoever opens it first creates the owner's account.
…
Previews:  https://cms-preview.example.com (the live site beside it at https://cms-live.example.com), through this port; only a signed-in browser is let in
Data:      /data (the site, its settings and stored keys, sessions — everything this install keeps)
```

The docs ran it on a spare port with a throwaway data folder; the output shows the image's folder, `/data`. Outside the image the data folder is `GALLEY_HOME`, default `~/.galley`. A setup code you supplied yourself isn't printed again: the line shows a placeholder. Among the lines the "…" leaves out, `E-mail:` says whether invitations and new-password links are e-mailed ([below](#outgoing-e-mail)). Set `GALLEY_PUBLIC_URL` before you invite anyone: every link is built from it ([Invitations and one-time links](#invitations-and-one-time-links)). The files `galley host recipe` writes set it for you. `galley serve --help` lists every variable it reads; they are all in [Environment variables](/docs/reference/environment/#a-hosted-install).

## The three names

The editor, its preview and the live comparison are three names on **one port**:

| Name | What answers | Set with |
| --- | --- | --- |
| `cms.example.com` | the editor | `GALLEY_PUBLIC_URL` |
| `cms-preview.example.com` | the site's preview, with click-to-edit | `GALLEY_PREVIEW_URL` |
| `cms-live.example.com` | the live site, beside the preview in Proof | `GALLEY_LIVE_VIEW_URL` |

The last two are worked out from the first unless you set them. Names, not paths, because sites and their dev servers expect to be at the root; and the preview must be another origin than the editor, so the site's own scripts can never act as the person signed in. Sibling names (`cms-preview.`, not `preview.cms.`) because free certificates, Cloudflare's included, cover one level below the domain only. An editor at the top of a two-part suffix (`example.co.uk`) would get someone else's names (`example-preview.co.uk`): use `cms.example.co.uk`, or give both names with `--preview-address` and `--live-address`.

Only a browser the editor let in sees the preview: the editor gets a one-use ticket (60 seconds), the frame trades it for a cookie tied to that sign-in, and signing out ends it. Anyone else gets a 401 page.

The proxy in front must keep the `Host` header (Caddy does), terminate HTTPS for all three names, and pass WebSockets and the event stream `GET /api/events` unbuffered. With it, set `GALLEY_TRUST_PROXY=1` — which believes forwarded headers from every connection that reaches the port — or, with the proxy on the same machine, set `GALLEY_SOCKET` and have the proxy connect to that Unix socket instead: forwarded headers are then believed for requests on the socket alone.

**Behind Cloudflare** (proxied names, or a Cloudflare Tunnel), Cloudflare's Web Analytics can add its beacon, `https://static.cloudflareinsights.com/beacon.min.js/…`, to every page; for proxied sites its automatic setup is on by default. The editor's Content Security Policy runs only the editor's own scripts, so the browser blocks the beacon and logs *Loading the script 'https://static.cloudflareinsights.com/beacon.min.js/…' violates the following Content Security Policy directive: "script-src 'self'"* on each page. It is harmless: nothing breaks and the beacon never runs. To stop it, open **Web Analytics** in Cloudflare's dashboard, then **Manage site** for that site, and set the automatic setup to **Disable**, or add a rule that leaves out the editor's names ([Cloudflare](https://developers.cloudflare.com/web-analytics/configuration-options/rules/), read 2026-11-24). Don't loosen the policy instead. The preview's pages keep the site's own headers, so on the preview's names the beacon runs unless the site's own policy blocks it.

## First run

1. **Create your account**: your name, your e-mail and a password of 12 characters or more. You are the install's first **owner**.
2. **Connect the site**: an existing repository, or a starter sent to an empty one. The install reaches it with **its own deploy key** — it shows the public half; add it to the repository **with write access** and choose **Check again** — or with an access token over HTTPS. A site in a folder of a larger repository: give the folder (`apps/site`). The whole repository is copied; only that folder is the site, and changes outside it are neither shown nor published.
3. **A few details**: the install's publishing name and e-mail (filled in from your account), the live address, the assistant's key. The screen says *What people publish here carries their own name. This one is for versions published with nobody signed in, by a script or an AI tool using this server’s access key.* A starter sent at first run is the owner's first version, under the owner's own name.

With your own identity provider, `GALLEY_OIDC_OWNER` names the first owner by their subject there instead: their account is made at start, with no password, and they sign in through the provider ([below](#your-own-identity-provider)).

Or, on the first screen, **Restore from a backup**. First run leaves nothing to publish: the live address is kept in the install's own state, not in the site's `galley.config.json` (when the site's settings name a live address of their own, that one wins and is shown as set). A first run left half-way carries on after the owner signs in.

### Start it unattended

Everything first run asks can be given up front as **starting values**: `GALLEY_PASSWORD` with `GALLEY_OWNER_NAME` and `GALLEY_OWNER_EMAIL` (the first owner), `GALLEY_SITE_REPOSITORY`, `GALLEY_SITE_BRANCH`, `GALLEY_SITE_FOLDER`, `GALLEY_SITE_ACCESS`, `GALLEY_SITE_TOKEN`, `GALLEY_SITE_STARTER`, `GALLEY_AUTHOR_NAME`, `GALLEY_AUTHOR_EMAIL`, `GALLEY_SITE_LIVE_URL`, `ANTHROPIC_API_KEY` — or one JSON file named by `GALLEY_INSTALL_CONFIG` (readable by the server's user only):

```json
{
  "address": "https://cms.example.com",
  "password": "…",
  "owner": { "name": "Sam", "email": "sam@example.com" },
  "site": { "repository": "git@github.com:example/acme-site.git", "branch": "main", "access": "deploy-key" },
  "author": { "name": "Sam", "email": "sam@example.com" },
  "liveUrl": "https://www.example.com",
  "keys": { "anthropic": "sk-ant-…" }
}
```

Each starting value is used once, only while the install lacks that thing, so restarting with the same values changes nothing, and what someone changes in the app afterwards stays changed. With a password, a repository and the publishing name, first run finishes by itself. Without the owner's name and e-mail, the owner signs in with the password alone and the app asks them for the rest once; without `GALLEY_PASSWORD`, the owner's name and e-mail are ignored (a notice says so) and first run asks. To keep the setup code out of the log, give your own with `GALLEY_SETUP_TOKEN` (24+ characters), or only its SHA-256 with `GALLEY_SETUP_TOKEN_SHA256`.

## People and roles

A hosted install has accounts, not one shared password. The owner invites everyone else from **People** on the Install page, each with one of three roles — or, with your own identity provider set up (OpenID Connect, [Signing in through an identity provider](/docs/reference/environment/#signing-in-through-an-identity-provider)), people sign in through it and it gives each their role. People shows the subject each such account signs in as, and the accounts that were removed. Each person connects their own account to the provider on **Your account** while passwords are on, or whoever runs the server links accounts with `galley accounts link`. Deleting someone who signs in through the provider puts their identity on a list of removed accounts until an owner lets them back (People › **Removed**), so switch them off instead if they may come back. The roles:

| Role | What they can do |
| --- | --- |
| **Owner** | Everything: the site, Publish, the inbox, and the install itself — people and their e-mail addresses, keys, backups, the site's settings, plugins, where the site is hosted. |
| **Editor** | Change the site, its code and templates included (build mode), and publish it; undo a publish, get the latest, put the site live; read the inbox. No Install page, keys, site settings or plugins. |
| **Contributor** | Change the site's content and see Proof. An editor or owner publishes, and changes the site's code. |

The rule behind it: changing the draft's content is for everyone; what changes the live site or the repository, reading what visitors sent, and changing the site's code and templates need an editor; the install itself, and the site's settings file, need an owner. One table in the code decides it for every request (`packages/core/src/install/route-access.ts`), and a role change applies to that person's next request. What each person sees is in [Sign in to a hosted editor](/docs/editing/signing-in/).

**Build mode and the site's settings, by every way in.** The engine holds two rules itself, whichever way a request comes — a screen, a file write, the assistant, an AI tool:

- **Build mode** — the site's code and templates, custom code in a form, saving the brand outside the content files — needs an editor or owner. A contributor works in content mode, and a request for build mode is refused in plain words rather than quietly narrowed: *Your account can change the site's content, but not its code and templates (build mode). Ask an owner or an editor of this editor.*
- **The site's settings file** (`galley.config.json`) is an owner's: the Settings screen, a file write, the assistant's `save_site_config`, and discarding or undoing a change to it, or undoing a publish that changed it. Anyone else reads *Your account can't change the site's settings. Ask an owner of this editor.* The few values the editor records for itself as part of an action someone else may take — the live address after an editor puts the site online, where the redirects list lives (where the redirects take effect is an owner's to choose) — are written on their own, without opening the rest of the file to that person.
- **The assistant** offers each person only the tools their role includes, and checks again on every call.
- **Work that isn't done for someone** can't publish, change the site's settings or write outside the content. These happen only for a signed-in person (as their role allows), for the operator's token (on the API and on `/mcp`), or as the engine's own unattended steps. That is what a plugin reacting to events runs as — a publish, a deploy, a form a visitor sent — and so is anything it leaves running: *Only someone signed in to this editor, or whoever runs it, can do that. …*

The full rules: [`docs/cloud-install.md`]({repository}/blob/main/docs/cloud-install.md#build-mode-and-the-sites-settings).

**What roles are not.** They keep people out of each other's way and out of trouble, and the server enforces them at every way in; they are not a wall against someone who means harm. The preview runs the site's own code on the server for every role: editors and owners can change that code, and a contributor's content is what it reads and renders. Where a site's content format is one the framework runs — MDX, or a template language — code already in the content runs too, for every role, when the preview or build runs. Changing such content now needs the build-mode level. What is already there still runs, a contributor's content can still make the site run code that is already in it, and HTML written into Markdown runs in the browser of whoever views the page. Give an account only to someone you would trust with the site's repository.

Because the previewed page shares the origin of the editor's own overlay, a script in the content can ask the app to save through click to edit or Arrange while someone is editing on the preview; the app marks every such save, and the server holds it to the lowest level whoever is signed in — the same changes a contributor could make directly — and it still waits in Proof.

By default a contributor can change Markdown only where the engine knows it is static (Astro, and a plain Markdown site that runs no build). On any other framework, and on one that runs a build over its content, a collection's Markdown is guarded until the owner marks the collection `plain` in `galley.config.json` — a statement that the site shows that Markdown as written and runs no code in it. That is the owner's responsibility: if the site does run code in a `plain` collection's content, anyone who can edit it can run code.

The assistant reads the site's content, and that includes what a contributor wrote, so words placed in content can try to steer an owner's or editor's assistant. The assistant can't publish: every change it makes waits in Proof until a person publishes it. It changes the site's code and templates, and content a framework runs as code, and runs the site's build, only in a conversation someone has switched to build mode — and there it doesn't ask before each change. Outside build mode — in a content conversation, in a writing batch, and for an AI client over MCP in content mode, the operator's own token included — it may change only what an account below build-mode level could, whoever it works for. Choosing build mode, reading Proof and pressing Publish are the controls.

And the draft is one shared working copy: anyone, a contributor included, can **Discard** the pending changes, everyone's (a change to the site's settings file only an owner discards).

### Your own identity provider

Set `GALLEY_OIDC_ISSUER` and `GALLEY_OIDC_CLIENT_ID` in the server's environment, with `GALLEY_PUBLIC_URL` on `https://`, register `https://<your editor>/api/auth/oidc/callback` at the provider, and the sign-in page gets a **Sign in with …** button (OpenID Connect: the authorization code flow with PKCE). The provider sets each person's role at every sign-in, from a claim **only its administrators may be able to set**, and someone who signs in through it has no password here. Register `https://<your editor>/api/auth/oidc/backchannel-logout` as well, so that a logout there ends their sessions here at once; if your provider sends one only when a session there ends, also switch someone off here when you remove them there. `GALLEY_OIDC_ONLY=1` turns passwords off. People who already have an account connect it on **Your account** while passwords are on, or `galley accounts link` binds it on the server. After putting a backup back, send your removals again. Every variable: [Signing in through an identity provider](/docs/reference/environment/#signing-in-through-an-identity-provider); the whole of it, step by step: [`docs/cloud-install.md`]({repository}/blob/main/docs/cloud-install.md#signing-in-through-your-own-identity-provider).

### Invitations and one-time links

**Set the editor's public address first.** A link is only ever built from `GALLEY_PUBLIC_URL`. Without it, a link is shown only on a trial on one computer (the editor opened at `localhost`, `127.0.0.1` or `::1`); anywhere else making one is refused until the address is set: *Links can't be made yet: this editor doesn't know its public address. Set the editor's public address (GALLEY_PUBLIC_URL), start it again, then make the link.*

**Invite someone** takes an e-mail and a role, and shows the invitation link **once**, to copy and send. The person opens it, types their name and a password, and is in. A name is kept without characters a reader can't see, and nobody can take a name that reads as someone else's here (another case or width counts as the same name); look-alike letters from different alphabets are not caught. Someone who accepts an invitation with a name already taken is let in without it and asked to choose one; until they have, they can't publish, and nothing they record carries anyone else's name. An owner can also make a **new-password link** for anyone who forgot theirs (People › **…** › New-password link). When the server e-mails it to them, the owner is told so and the link isn't shown; when it can't be e-mailed, it is shown once, to copy and send.

| Link | Lasts | Looks like |
| --- | --- | --- |
| Invitation | 7 days | `https://cms.example.com/join#…` |
| New-password link | 60 minutes | `https://cms.example.com/new-password#…` |

Each works once. Taking an invitation back, or making a newer new-password link, ends the old one. The code is after the `#` because that part of an address never leaves the browser, so it reaches no server log or proxy; the server keeps only its SHA-256. A person's old password works until they use a new-password link, and using it signs their other browsers out.

### Outgoing e-mail

Set `GALLEY_SMTP_URL` (`smtp://user:pass@host:587`, or `smtps://`) and `GALLEY_MAIL_FROM` — the same two the inbox's e-mail alerts use — **and** `GALLEY_PUBLIC_URL`, and links are e-mailed: invitations as well as shown to the owner, new-password links an owner makes to the person only, and **Forgot your password?** on the sign-in page e-mails a link by itself. Without any one of the three, nothing is e-mailed and everything else works: the owner sends each link themselves, People says so, and **Forgot your password?** tells people to ask an owner. A mail server that fails or takes longer than 15 seconds never stops the request — the owner is shown the link instead — and the log says so. **Not yet tried against a real mail server.**

`galley serve` prints which case it is, in one of three forms:

```text
E-mail:    not set up (GALLEY_SMTP_URL, GALLEY_MAIL_FROM): owners send invitation and new-password links themselves
E-mail:    invitations and new-password links are e-mailed too
E-mail:    set up, but no link is e-mailed until the editor's public address is set (GALLEY_PUBLIC_URL): a link is only ever built from it
```

### Sign-in limits

The same answer, the same work and the same wait for an unknown e-mail, a wrong password and a switched-off account. A **client** is one IPv4 address, or a whole IPv6 `/64`. The limits:

- **Per client:** 2 sign-ins checked at once, 20 attempts a minute (successful ones too), and 5 failures a minute (wrong setup codes, bad link codes and a wrong current password count too). Checked before the password is.
- **Per e-mail, from one client:** 10 failed sign-ins in 15 minutes, then that e-mail waits 15 minutes there.
- **Per e-mail, from everywhere:** its sign-ins are checked one at a time, with 3 more waiting; past that, *wait a minute*. After 10 failures each turn starts with a delay — 1 second, doubling to 30 — so one e-mail gets at most about 2,900 guesses a day, from any number of addresses. The count is forgotten after 15 quiet minutes.
- **A browser someone has signed in on before** keeps a cookie of its own (a year; never a session) and skips that line and the delay, until 3 wrong passwords in 15 minutes, or that person is switched off, removed or signed out everywhere.
- **At once:** 2 password checks run at a time, at most one per client; whoever waits is served client by client, known browsers first. Only past 256 waiting (64 for known browsers) is a sign-in told to wait.
- **Forgot your password?** 5 times per client in 15 minutes, and at most 3 e-mails an hour to one address.

**While an account is being guessed at**, a right password typed in a browser that hasn't signed in before may wait its turn, up to a couple of minutes, or be told to wait — for as long as the guessing goes on. A browser that has signed in before isn't held up, a one-time link (*Forgot your password?*, or a new-password link from an owner) doesn't wait at all, and whoever runs the server can always let an owner in with `galley serve --reset-password`.

The limits are kept in memory, so a restart resets them. Behind one reverse proxy that you run, set `GALLEY_TRUST_PROXY=1`, or everyone shares the proxy's address and one person's wrong guesses hold everyone up; with nothing in front of the server, leave it unset, or a request can claim any address. With a CDN in front of your proxy, everyone coming through one of its edges counts as one client: that set-up isn't supported well yet. The details and the table: [`docs/cloud-install.md`]({repository}/blob/main/docs/cloud-install.md#signing-in).

### A forgotten password

- **When the server e-mails links**, people use **Forgot your password?** under Sign in.
- **When it doesn't**, an owner makes a new-password link for them in People and sends it.
- **An owner who can't get in** — the only owner, or every owner — is let back in by whoever runs the server. Stop the editor first (nothing stops a second server starting on the same data folder), then start it once with `--reset-password`, in the install's folder:

```sh
docker compose stop editor
docker compose run --rm --use-aliases editor serve --reset-password
```

```output
…
Password:  https://cms.example.com/new-password#<one-time code>
           Open it now: it lets Sam choose a new password, once, until 14:05 UTC. Nobody else's account changed.
…
```

It prints a one-time new-password link for the owner (60 minutes, once) and keeps serving. Nobody else's account changes, nobody is signed out, and the owner's old password works until the link is used; an owner who was switched off is switched back on, by design: it is the operator's way back in. With several owners, say whose with `--email`: `serve --reset-password --email sam@example.com`, or with `--account <id>` or `--subject <subject>` for an owner who has no e-mail; with several and none named, it lists them on the console. **For an owner who signs in through the identity provider, or with passwords off (`GALLEY_OIDC_ONLY`), the link signs them in instead, once, without a password** (`Sign in:` in place of `Password:`), for as long as a session through the provider lasts, and sets no password: it is the way back in when the provider is down. Open the link, choose the new password, then stop it with Ctrl+C and start the editor again:

```sh
docker compose start editor
```

With no owner yet, it prints a fresh setup link instead. A setup code that has been used stays dead: an old code or hash still in the environment is ignored, and a fresh link is made (a notice says so). `GALLEY_PASSWORD` is never put back by it.

## The Install page

`/install`, for owners only: the three addresses and the version; the repository, how it is reached and the install's public key (**Make a new key** replaces it); **People** — everyone, their roles and when they last signed in, the open invitations, **Invite someone**, and for each other person a role, **Change e-mail…**, a new-password link, Sign out, Switch off and Remove (what they published keeps their name); backups; and what is stored where, with sizes (measured in the background, never counting installed packages, so a size can be empty for a while). What the operator set with a starting value is marked "Set by whoever runs the server".

Two rules hold in People: the last owner who can still sign in stays an owner and stays switched on, and nobody changes their own account there — each person's own name, password and **Sign out everywhere** (theirs only) are on **Your account**. E-mail addresses are an owner's to change: their own on Your account, with their password, and everyone else's with **Change e-mail…**. Editors and contributors don't change their own; an account with no e-mail yet adds one. When the server e-mails links, the address an account had is told that it was changed (the message holds no link and doesn't name the new address). **Sign everyone out** in People signs out everyone, you included.

**Signing out** survives a restart. The list of signed-out browsers is capped (10,000); past the cap, a sign-out signs that person out of every browser. A longer list in an older state file is trimmed at start-up by signing everyone out once, with one line in the log.

### What is kept where

All of it is in the data folder (`/data` in the image, one volume): `install.json` (the install's state: the accounts with their password hashes, open invitations and links as hashes of their codes, the site's repository and live address), `install.json.schema-<n>.bak` (after an upgrade of its layout: the state file as it was before, until the next upgrade), `session.key`, `settings.json` and `secrets.json`, `keys/` (the deploy key, an access token, `known_hosts`), `site/` (the repository's copy, with unpublished changes), `state/<siteId>/` (the inbox, conversations, brand material), `plugins/`, `home/` (package caches, rebuilt when needed), and `backups/` (backups you keep on the volume; never part of a backup).

## Back it up

**Download a backup** on the Install page asks for a passphrase (12+ characters) and gives you one sealed file: the site with its history and **unpublished changes**, the settings, the stored keys and the accounts. Not in it: installed packages and caches, which are rebuilt — add plugins again after a restore. **The passphrase can't be recovered.**

**Restore** on the Install page, or on a fresh install's first screen, checks the whole file before changing anything, then signs everyone out; from then on the backup's own people and passwords apply, so anyone added since it was made is gone. Only an owner can restore. The upload takes up to 2048 MB (`GALLEY_RESTORE_MAX_MB`).

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
Everyone is signed out: sign in with the accounts and passwords the backup was made with.
…
```

Both refuse while they can tell a server holds the folder, but stop the editor first: nothing stops a second server starting on the same folder. Use this for a backup too large to upload — Cloudflare's free plan stops request bodies at 100 MB. Without Docker, run `galley backup` on the data folder (`GALLEY_HOME`) the same way.

## Upgrade it

A new version is a new image on the **same volume**: build or pull it, change the `image:` line in `compose.yaml` if its name changed, and run `docker compose up -d` again. At start-up it upgrades the data folder by itself; in the real runs the editor was healthy again within about ten seconds, with everything as it was. Never start an older image on a folder a newer one has used — it refuses to — so download a backup before each upgrade; going back means restoring it into a fresh volume.

### From one password to accounts

An install from before accounts is upgraded at its first start on the new image. The shared password becomes **one owner** with the same password and no name or e-mail yet: that owner signs in with the password alone, as before, and the app asks them once for their name and e-mail (until then they can't invite anyone). **Everyone is signed out once.** The old state file is kept beside the new one as `install.json.schema-1.bak`. Then the owner invites everyone else. `--reset-password` now makes a new-password link instead of a setup link, and no longer signs everyone out. Details: [`docs/cloud-install.md`]({repository}/blob/main/docs/cloud-install.md#upgrading-to-accounts).

## Health, logs and stopping

- `GET /healthz` answers 200 while the server runs; `GET /readyz` says `starting`, `setup`, `ready` or `restoring`. Neither needs a sign-in or says anything about the install. The image's health check uses `/healthz`.
- The log has one line per request (`GALLEY_LOG_REQUESTS=0` leaves them out), one for each backup and restore, and one for each thing people do to accounts — signed in or failed to, invited, accepted, taken back, role changed, e-mail changed (and by whom), switched off or on, removed, password changed, a new-password link made (and whether it was e-mailed or shown), asked for or used, signed out everywhere, an e-mail that couldn't be sent. People are named by name and role only, never by e-mail address. No secret is ever written to it; the setup link is the one exception, on purpose, and a one-time link or its code never is.
- **One server to a data folder.** A server takes the folder before it reads anything in it and refuses to start while another server is running on it: *Another editor is running on this data folder … Stop it first, or give this one a data folder of its own (GALLEY_HOME).* After a server that didn't stop cleanly, the next start may watch the old server's hold for about 20 seconds before it takes the folder over, and says so in the log. A running server that finds another server's hold on its folder stops by itself, says why, and exits 1. Under a restart policy it is then started and refused again and again (*Another editor is running on this data folder…*) until the second server is stopped or given a data folder of its own; the server that holds the folder is not disturbed.
- An account may have 16 windows of the editor open at once. One more is told so (*Too many windows of the editor are open on this account…*) and connects when another closes; windows that went without a word (a closed laptop) are cleared away when the limit is reached, at most once in 10 minutes. Where several people share one account, that moment makes every other window on the account read everything again; other accounts are never touched.
- Stopping lets a publish in progress finish (20 seconds, `GALLEY_SHUTDOWN_GRACE_MS`), stops the preview and exits by itself. The compose files give it 30 seconds.
- `GALLEY_PREVIEW_MEMORY_MB` caps the memory of the site's own preview and build; the generated files set 1024.
- The first preview installs the site's packages inside the container — in the real run about 80 seconds with the install. In a site without a lockfile, that install never leaves one behind.

## Keeping up with the repository

The install keeps its own copy of the site's repository. When someone pushes to that repository from elsewhere, the editor finds out by itself:

- Every 5 minutes (`GALLEY_SYNC_MINUTES`; `0` turns it off) it asks the code host what is new and, when the copy has nothing in the way, brings the newer versions in — forward only, the way **Get latest** does, so nothing here is overwritten. It skips a round while a save, a publish, an undo, a restore or a connect is under way, while the assistant is working on the site, and while the preview is installing the site's packages. While it is the assistant or an install that is in the way, the skipped round still looks, so what the app says is waiting stays true; if rounds are skipped for half an hour running, the log says so once, with the reason. Looking never holds up a save, however slow the code host is to answer (publishing does, for as long as sending the version takes). The start-up lines say how often it looks.
- **Version history** looks whenever it opens, says "Checking the repository…" until it knows, and then says when it last checked. If it couldn't reach the code host, it says why and when it last knew, never "in step".
- **In the way** means one of two things: a file with unpublished changes that the newer versions change too (discard that change, which Proof shows so that what was written can be copied first; the next round brings them in), or versions published here that the repository doesn't have while it has newer ones — the two have gone separate ways, and someone who knows the repository has to bring them together. The status bar then says "Newer versions are waiting".
- When versions come in, open browsers say so once and refresh. None of the repository's own hooks run for it. A running preview stops first, forgets what the site's dev server saved between runs, and starts again on the new files; when `package.json` or a lockfile changed, it installs the site's packages first. If you press **Start** while the files are changing, the preview waits until they are in. While the preview is installing the site's packages, **Get latest** asks you to try again once it has finished.
- The log gets one line when versions come in, and one when a look fails in a new way (and when it works again) — not one every five minutes.

## Forms on a hosted install

A hosted install at a public `https://` address is what lets the live site's forms send to the inbox: the capture address is `https://cms.example.com/f/<siteId>` ([Forms](/docs/forms/#where-visitors-can-reach-it)). The inbox says whether visitors can reach it, and why not when they can't. Keep `/f/` reachable by everyone if you put another sign-in, such as Cloudflare Access, in front. For e-mail alerts set `GALLEY_SMTP_URL` and `GALLEY_MAIL_FROM` (the same two, with `GALLEY_PUBLIC_URL`, send invitations and new-password links). Only editors and owners can read the inbox.

## What it can reach

The install reaches the site's git host (SSH on port 22 with the deploy key, or HTTPS with a token), the package registry when it installs the site's dependencies, the live site (the comparison) and, when keys are set, the AI providers, and the mail server when one is set. Nothing else, and nothing to Fiction Tribe. The site's own preview and build are code from the repository running in the container, by design: the container is the boundary ([Security model](/docs/running/security/#a-hosted-install)).

## Next

- [Sign in to a hosted editor](/docs/editing/signing-in/) — the same install from the side of the people who use it.
- [Host the editor online](/docs/editing/editor-online/) — let the desktop app create an install on Fly.io, behind Cloudflare, or on a server of yours.
- [Security model](/docs/running/security/).
- [White-label](/docs/configuration/white-label/) — rename and recolour it.
