---
title: Security model
description: Who can reach Galley and how they sign in, the Host and Origin checks, what the app can write and serve, whose code it runs, and exactly what it sends to which third party and when.
group: running
order: 4
---

This page is for developers, operators, and whoever approves running Galley. It describes what the code does today; [SECURITY.md]({repository}/blob/main/SECURITY.md) says how to report a problem. The server's own account of each rule is in [`packages/server/README.md`]({repository}/blob/main/packages/server/README.md).

## Who can reach it

**Locally** (the CLI, the desktop app) the server listens on `127.0.0.1` only. Starting it on any other address in local mode is refused. At start-up it mints a random session token (or takes `GALLEY_TOKEN`, 16+ characters) and prints a link carrying it; the first visit exchanges the token, compared in constant time, for an `HttpOnly; SameSite=Strict` cookie whose name includes the port, and redirects to the same address without the token. Other users of the same computer can connect to the port, but without the token they get `401`.

**A hosted install** (`galley serve`, the image, or `GALLEY_HOST` not a loopback address) looks after **one site**, with everything it keeps in its data folder, for the people its owner lets in: each signs in with their own e-mail and password and has a role — owner, editor or contributor. [Below](#a-hosted-install) is what that adds.

Only `GET /api/meta`, `POST /api/auth/login` and `POST /api/auth/logout` answer without a session, and unauthenticated `meta` reveals the brand, the mode and `authenticated: false` — nothing else. On a hosted install, `GET /healthz` and `GET /readyz` also answer anyone and say nothing about the install; the three one-time-link routes (`POST /api/auth/link/check`, `POST /api/auth/link`, `POST /api/auth/forgot`) answer without a session too, the link's code being the proof; `meta` also says whether sign-in asks for an e-mail and whether a forgotten password can be e-mailed; and the first-run routes take the one-time setup code until an owner exists.

## Every request

- **Host check** (against DNS rebinding): the `Host` header must name the server — loopback names, the listening address, or the host of `GALLEY_PUBLIC_URL`. Otherwise `403`: *This address isn't one this app answers to.* On a hosted install, requests for the preview's and live comparison's names go to the preview gateway and never reach the app.
- **Origin check** (against cross-site requests): every state-changing request (anything but `GET`, `HEAD`, `OPTIONS`) must carry an `Origin` equal to the server's own, or `Sec-Fetch-Site: same-origin`, or a valid `Authorization: Bearer` token. Otherwise `403`: *This request came from outside the app, so it was blocked.*
- **Limits**: JSON bodies up to 40 MB; uploads are `data:` URLs of images, MP4 or PDF up to 25 MB.

Two addresses outside `/api` have their own rules. **`/mcp`** (the [MCP endpoint](/docs/integrations/mcp/)) takes only a Bearer token from `galley mcp token` — never a cookie — and refuses a foreign `Origin`. **`/f/:siteId`** (form submissions) takes no cookie and reaches nothing but the submission store: only the site's own addresses may post there, or a server with the site's capture key, with rate limits, a 64 KB limit and spam checks ([Forms](/docs/forms/#the-capture-endpoint)).

## What it serves

- **The UI** with a strict Content Security Policy: scripts, styles, fonts and connections from its own origin only; frames only from the preview proxies (on a hosted install, the preview's and live comparison's two origins); no plugins; `frame-ancestors 'self'`.
- **Files from a site** (`GET …/raw`, image candidates) with `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`, so an uploaded SVG can't run script with the app's cookies. HTML, JavaScript and XML from a site are sent as `text/plain`. `.git/` and `.env*` are never served.
- **Previews** on separate loopback ports locally, and on a name of their own on a hosted install (`cms-preview.example.com`) — separate origins either way — with the overlay script added. The site's pages there run with the site's own origin, not the app's.

## What it can write

Every write is contained to the site folder (no `..`, no absolute paths, no symlink escapes, checked against the real path on disk) and checked against the mode's writable globs. No mode can write `.git/`, `node_modules/`, `.env*`, lockfiles or hidden settings folders. Content mode — every assistant conversation, unless switched — can write content and media only. Details: [Modes and the write surface](/docs/concepts/modes/).

The assistant has no shell. Its built-in tools call the same guarded engine functions as the form, and the mode is enforced by the engine on every write, not by the prompt. Plugins can add tools — the Shopify plugin's reach the store — and a plugin tool's writes go through the same guards.

## Whose code it runs

Galley never executes a site's config files to *read* them — detection is static. But three things do run code from the site, as the user the server runs as, by design:

- **The preview** runs the site's own dev command, and installs its dependencies first when they are missing (which runs their install scripts).
- **Build mode's `run_build`** runs the site's build command.
- **Adapters and plugins a site names** in its `galley.config.json` are loaded from inside the site folder or its `node_modules`. On a hosted Galley they are off unless the operator sets `GALLEY_ALLOW_SITE_PLUGINS=1`; `GALLEY_DISABLE_SITE_PLUGINS=1` and `GALLEY_DISABLE_SITE_ADAPTERS=1` turn them off anywhere.
- **Plugins installed** with `galley plugin add` run inside the server for every site. A plugin is not a sandbox: it has the server's permissions, your files and the network. Its rules stop accidents — it can't read the app's own keys or another plugin's settings, or write from a hook — but don't contain a plugin written to do harm. Install only plugins you trust ([Plugins](/docs/plugins/)). Installing runs npm with `--ignore-scripts`.

So opening a repository in Galley and starting its preview trusts that repository the way `npm install && npm run dev` would. On a hosted install, anyone who can sign in — whatever their role — can change the site's code and run it in its preview: treat every account as giving the ability to run code where the install runs. The container is the boundary ([below](#a-hosted-install)).

git always runs with argument arrays, never a shell string; clones refuse addresses starting with `-` and `ext::` transports. Galley never force-pushes, never rewrites history and never changes git configuration outside the repository.

## A hosted install

What a hosted install adds, each held by a test (the list, with the test files: [`docs/cloud-install.md`]({repository}/blob/main/docs/cloud-install.md#the-security-model)):

- **One site.** Every route that would add, remove, scan for or file sites answers `403` — *This editor looks after one site. Each site gets an editor of its own.* — and the engine refuses the same. Ten sites are ten installs that share no folder, account, key or session.
- **The setup link.** With no owner yet, the server prints `<address>/setup?token=…`; whoever opens it creates the first owner. The code is kept as its SHA-256, works until the owner exists, then never again — even after `--reset-password`; the operator can give only its hash (`GALLEY_SETUP_TOKEN_SHA256`) so it never reaches the server. Wrong codes count against the sign-in limit.
- **Accounts and roles.** Every route has one level — *edit* (anything that only changes the draft), *publish* (what changes the live site or the repository, and the inbox) or *manage* (the install: people, keys, settings, backups, hosting) — in one table, `packages/core/src/install/route-access.ts`, which the server enforces on every request. An owner has all three, an editor edit and publish, a contributor edit. Someone below a route's level gets `403`. A role change, a switch-off or a removal applies to that person's next request. A test asks every route as every role. **Roles are not a security boundary:** they keep people out of each other's way, but anyone who can change the draft can change the code the preview runs ([Whose code it runs](#whose-code-it-runs)). The draft is one shared working copy, and a contributor can discard everyone's pending changes.
- **Passwords** are stored as scrypt hashes and checked in constant time; 12 to 1,024 characters. An unknown e-mail, a wrong password and a switched-off account get the same answer in about the same time. Limits: five failures a minute per client address (sign-in, setup codes, link codes and a wrong current password together), then `429` for the rest of the minute; ten failed sign-ins per e-mail in 15 minutes from anywhere; "forgot my password" five times per address in 15 minutes and three e-mails an hour per address. The limits are kept in memory.
- **One-time links.** Invitations (7 days) and new-password links (60 minutes) work once. The code — 32 random bytes — rides after the `#` of the address (`/join#…`, `/new-password#…`), which never leaves the browser, and is sent in a request body; the server keeps only its SHA-256. A bad code gets one refusal for every case. A link is shown once, to the owner who made it, and e-mailed when `GALLEY_SMTP_URL` and `GALLEY_MAIL_FROM` are set; `galley serve --reset-password` prints one for a locked-out owner. The setup link and these are the only secrets ever printed or shown, on purpose.
- **Sessions.** Each cookie belongs to one person. On an `https://` address it is `__Host-galley_session`: `HttpOnly`, always `Secure`, `SameSite=Strict`, `Path=/`, no `Domain`, signed with `session.key`, 30 days. Changing your password signs your other browsers out; **Sign out everywhere** ends all of your own sessions; an owner can sign one person, or everyone, out; switching someone off or removing them ends theirs. All of it survives a restart. A cookie one install issued is refused by another: two installs run side by side from one image, on 2026-11-24, each refused the other's cookie, password and form-capture key (before accounts).
- **The operator's token** (`GALLEY_TOKEN`) reaches every route except your own account, People, downloading a backup, restoring one and opening the preview; those need a person in a browser.
- **The preview's own origin, behind a gate.** The preview and the live comparison are served on names of their own, so the site's scripts can never act as the person signed in. Only a browser the editor let in sees them: a one-use, 60-second ticket from `POST /api/sites/:siteId/preview/entry` is traded for a viewer cookie tied to that sign-in, which ends with it. Anyone else gets a 401 page. Neither cookie is ever passed to the site's dev server, and a write from the preview's origin is refused even with the editor's cookie attached.
- **The container is the boundary.** The site's preview, its dependency installs and its build run code from the repository, by design. The image runs the server as the unprivileged user `node` and drops root and every capability before it starts; the generated compose files add a read-only root filesystem, `cap_drop: ALL`, `no-new-privileges`, memory and process limits, one volume and no published port for the editor. The site's own commands don't receive the app's starting password, setup code, access token or provider keys. What the site's code can reach is the container: the data folder, with its stored keys, and the network.
- **The site's repository** is reached with the install's own deploy key (ed25519, private half 0600, never read back) or an access token handed to git through an askpass helper only — never in an argument, the address or `.git/config`.
- **Backups are sealed.** A backup is one file encrypted with a passphrase (scrypt, then AES-256-GCM in authenticated frames): a changed, cut or foreign file never opens. A restore checks the whole file before changing anything and can't write outside the data folder. The passphrase can't be recovered.
- **Logs** pass one scrubber; no secret is written to them. What people do to accounts is logged by name and role, never by e-mail address, link or code.

## Secrets

API keys come from a site's own `state/<siteId>/secrets.json`, the environment, or the shared `secrets.json` in the Galley home — files readable by their owner only (0600, in 0700 folders), not yet the operating system's keychain. They never cross the HTTP boundary — the UI sees only whether a key is set and its last four characters (on a hosted install, the last characters only for owners) — and any value the process has handled, or anything shaped like a key, is scrubbed from error messages and logs. See [Settings, secrets and the Galley home](/docs/running/settings/#secrets).

## What leaves the machine

Galley has no telemetry and no account. It connects to:

| Destination | When | What is sent |
| --- | --- | --- |
| Your git host | clone, pull, publish, undo a publish | git's own traffic, with your machine's git credentials — on a hosted install, its own deploy key (SSH, port 22) or access token (HTTPS) |
| The package registry your site uses | the first preview of a site without `node_modules`, and `galley new` | the package manager's own traffic |
| The deployed site (`urls.staging` or `urls.production`) | when the side-by-side view shows it | ordinary page requests through the baseline proxy |
| `api.anthropic.com` (or `GALLEY_ANTHROPIC_BASE_URL`) | only when someone sends the assistant a message, or the Publish dialog suggests a message, and a key is set | the instructions, a description of the site's collections and fields, the conversation, attached images, and whatever the tools read |
| `api.anthropic.com`, for features that use the assistant | **Read it from this site** or from material on the Brand screen (the voice guide); the Search and AI writer; **Rebuild** after a WordPress import | the site's styles, a sample of its copy and its sections, and every file added as brand material; one request per page for the Search and AI writer; the page's outline and words for a rebuild |
| OpenAI, Google or OpenRouter | only when someone generates an image (or a video, OpenRouter) with that service chosen | the description, the shape, and any reference images chosen |
| Cloudflare or Vercel | putting a site online, a preview link, setting redirects on Cloudflare | the built site's files, the project name, the redirect list |
| Shopify | when the Shopify plugin has a store address | product and collection queries; product copy only when its switch is on |
| A WordPress site, a brand's website | an import, or a website added as brand material | ordinary page and REST requests (public `https` addresses only for a brand's website; hosted mode refuses private addresses for imports) |
| Your mail server, webhooks | an inbox e-mail alert (`GALLEY_SMTP_URL`), a server-side form destination | the submission |
| Your mail server | on a hosted install with `GALLEY_SMTP_URL`: an invitation, a new-password link an owner made, **Forgot your password?** | the person's e-mail address, who invited them and as what, and the one-time link |
| Other sites | only when someone asks Search and AI to check external links | `HEAD` requests, a few at a time |

The placeholder image provider is offline. The web UI loads nothing from anyone else: fonts and scripts are served by Galley itself. The GitHub CLI (`gh`), when installed, is used in pull-request mode to open the pull request.

## Not covered yet

- No single sign-on on a hosted install: an e-mail and a password only. No audit log beyond the server's own log lines. One shared draft for everyone. Roles are not a security boundary (above). Accounts have been run by automated tests, a rehearsal over HTTP against the real server and a pass in a real browser — not yet on the real image or with a real mail server ([`docs/cloud-install.md`]({repository}/blob/main/docs/cloud-install.md#not-verified-yet)).
- The site's own code runs inside the hosted install's container and can read what the container holds.
- The desktop app's installers are unsigned, and keys are kept in owner-only files, not the OS keychain.
- Windows and Linux have not been verified.

## Next

- [Run a hosted install](/docs/running/hosted/).
- [SECURITY.md]({repository}/blob/main/SECURITY.md) — reporting a vulnerability.
