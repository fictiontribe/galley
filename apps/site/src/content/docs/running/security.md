---
title: Security model
description: Who can reach Galley and how they sign in, the Host and Origin checks, what the app can write and serve, whose code it runs, and exactly what it sends to which third party and when.
group: running
order: 4
---

This page is for developers, operators, and whoever approves running Galley. It describes what the code does today; [SECURITY.md]({repository}/blob/main/SECURITY.md) says how to report a problem. The server's own account of each rule is in [`packages/server/README.md`]({repository}/blob/main/packages/server/README.md).

## Who can reach it

**Locally** (the CLI, the desktop app) the server listens on `127.0.0.1` only. Starting it on any other address in local mode is refused. At start-up it mints a random session token (or takes `GALLEY_TOKEN`, 16+ characters) and prints a link carrying it; the first visit exchanges the token, compared in constant time, for an `HttpOnly; SameSite=Strict` cookie whose name includes the port, and redirects to the same address without the token. Other users of the same computer can connect to the port, but without the token they get `401`.

**Hosted** (`galley serve`, or `GALLEY_HOST` not a loopback address) it refuses to start without `GALLEY_PASSWORD` of 12 or more characters. Sign-in compares in constant time; five failures per minute from one address earn a `429` for the rest of the minute. The session cookie is `issuedAt.nonce.HMAC-SHA256`, signed with a key in the Galley home, valid 30 days, `HttpOnly; SameSite=Strict`, and `Secure` over HTTPS. There is one password and no per-user accounts or roles: everyone who signs in can do everything. Sites are confined to `GALLEY_SITES_DIR`.

Only `GET /api/meta`, `POST /api/auth/login` and `POST /api/auth/logout` answer without a session, and unauthenticated `meta` reveals the brand, the mode and `authenticated: false` — nothing else.

## Every request

- **Host check** (against DNS rebinding): the `Host` header must name the server — loopback names, the listening address, or the host of `GALLEY_PUBLIC_URL`. Otherwise `403`: *This address isn't one this app answers to.*
- **Origin check** (against cross-site requests): every state-changing request (anything but `GET`, `HEAD`, `OPTIONS`) must carry an `Origin` equal to the server's own, or `Sec-Fetch-Site: same-origin`, or a valid `Authorization: Bearer` token. Otherwise `403`: *This request came from outside the app, so it was blocked.*
- **Limits**: JSON bodies up to 40 MB; uploads are `data:` URLs of images, MP4 or PDF up to 25 MB.

Two addresses outside `/api` have their own rules. **`/mcp`** (the [MCP endpoint](/docs/integrations/mcp/)) takes only a Bearer token from `galley mcp token` — never a cookie — and refuses a foreign `Origin`. **`/f/:siteId`** (form submissions) takes no cookie and reaches nothing but the submission store: only the site's own addresses may post there, or a server with the site's capture key, with rate limits, a 64 KB limit and spam checks ([Forms](/docs/forms/#the-capture-endpoint)).

## What it serves

- **The UI** with a strict Content Security Policy: scripts, styles, fonts and connections from its own origin only; frames only from the preview proxies; no plugins; `frame-ancestors 'self'`.
- **Files from a site** (`GET …/raw`, image candidates) with `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`, so an uploaded SVG can't run script with the app's cookies. HTML, JavaScript and XML from a site are sent as `text/plain`. `.git/` and `.env*` are never served.
- **Previews** on separate loopback ports (separate origins), with the overlay script added. The site's pages there run with the site's own origin, not the app's.

## What it can write

Every write is contained to the site folder (no `..`, no absolute paths, no symlink escapes, checked against the real path on disk) and checked against the mode's writable globs. No mode can write `.git/`, `node_modules/`, `.env*`, lockfiles or hidden settings folders. Content mode — every assistant conversation, unless switched — can write content and media only. Details: [Modes and the write surface](/docs/concepts/modes/).

The assistant has no shell. Its built-in tools call the same guarded engine functions as the form, and the mode is enforced by the engine on every write, not by the prompt. Plugins can add tools — the Shopify plugin's reach the store — and a plugin tool's writes go through the same guards.

## Whose code it runs

Galley never executes a site's config files to *read* them — detection is static. But three things do run code from the site, as the user the server runs as, by design:

- **The preview** runs the site's own dev command, and installs its dependencies first when they are missing (which runs their install scripts).
- **Build mode's `run_build`** runs the site's build command.
- **Adapters and plugins a site names** in its `galley.config.json` are loaded from inside the site folder or its `node_modules`. On a hosted Galley they are off unless the operator sets `GALLEY_ALLOW_SITE_PLUGINS=1`; `GALLEY_DISABLE_SITE_PLUGINS=1` and `GALLEY_DISABLE_SITE_ADAPTERS=1` turn them off anywhere.
- **Plugins installed** with `galley plugin add` run inside the server for every site. A plugin is not a sandbox: it has the server's permissions, your files and the network. Its rules stop accidents — it can't read the app's own keys or another plugin's settings, or write from a hook — but don't contain a plugin written to do harm. Install only plugins you trust ([Plugins](/docs/plugins/)). Installing runs npm with `--ignore-scripts`.

So opening a repository in Galley and starting its preview trusts that repository the way `npm install && npm run dev` would. On a hosted server, anyone with the password can clone a repository and start its preview — treat the password as giving the ability to run code on that server, and run it as an unprivileged user, in a container or a VM of its own.

git always runs with argument arrays, never a shell string; clones refuse addresses starting with `-` and `ext::` transports. Galley never force-pushes, never rewrites history and never changes git configuration outside the repository.

## Secrets

API keys come from a site's own `state/<siteId>/secrets.json`, the environment, or the shared `secrets.json` in the Galley home — files readable by their owner only (0600, in 0700 folders), not yet the operating system's keychain. They never cross the HTTP boundary — the UI sees only whether a key is set and its last four characters — and any value the process has handled, or anything shaped like a key, is scrubbed from error messages and logs. See [Settings, secrets and the Galley home](/docs/running/settings/#secrets).

## What leaves the machine

Galley has no telemetry and no account. It connects to:

| Destination | When | What is sent |
| --- | --- | --- |
| Your git host | clone, pull, publish, undo a publish | git's own traffic, with your machine's git credentials |
| The package registry your site uses | the first preview of a site without `node_modules`, and `galley new` | the package manager's own traffic |
| The deployed site (`urls.staging` or `urls.production`) | when the side-by-side view shows it | ordinary page requests through the baseline proxy |
| `api.anthropic.com` (or `GALLEY_ANTHROPIC_BASE_URL`) | only when someone sends the assistant a message, or the Publish dialog suggests a message, and a key is set | the instructions, a description of the site's collections and fields, the conversation, attached images, and whatever the tools read |
| `api.anthropic.com`, for features that use the assistant | **Read it from this site** or from material on the Brand screen (the voice guide); the Search and AI writer; **Rebuild** after a WordPress import | the site's styles, a sample of its copy and its sections, and every file added as brand material; one request per page for the Search and AI writer; the page's outline and words for a rebuild |
| OpenAI, Google or OpenRouter | only when someone generates an image (or a video, OpenRouter) with that service chosen | the description, the shape, and any reference images chosen |
| Cloudflare or Vercel | putting a site online, a preview link, setting redirects on Cloudflare | the built site's files, the project name, the redirect list |
| Shopify | when the Shopify plugin has a store address | product and collection queries; product copy only when its switch is on |
| A WordPress site, a brand's website | an import, or a website added as brand material | ordinary page and REST requests (public `https` addresses only for a brand's website; hosted mode refuses private addresses for imports) |
| Your mail server, webhooks | an inbox e-mail alert (`GALLEY_SMTP_URL`), a server-side form destination | the submission |
| Other sites | only when someone asks Search and AI to check external links | `HEAD` requests, a few at a time |

The placeholder image provider is offline. The web UI loads nothing from anyone else: fonts and scripts are served by Galley itself. The GitHub CLI (`gh`), when installed, is used in pull-request mode to open the pull request.

## Not covered yet

- No per-user accounts, roles or audit log in hosted mode; every publish in a hosted Galley carries the author set in its shared Settings.
- The desktop app's installers are unsigned, and keys are kept in owner-only files, not the OS keychain.
- Hosted mode has one shared password for everyone.
- Windows and Linux have not been verified.

## Next

- [Hosting for a team](/docs/running/hosted/).
- [SECURITY.md]({repository}/blob/main/SECURITY.md) — reporting a vulnerability.
