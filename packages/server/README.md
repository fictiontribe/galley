# @galley/server

The engine behind an HTTP API, a live event stream and the web UI. It
implements every route in `ApiRoutes` (`packages/core/src/api.ts`) and nothing
else; the web UI, the CLI (`galley`), the desktop shell and hosted deployments
all run this same server. A hosted server looks after exactly one site
(`docs/cloud-install.md`).

```ts
import { createApp, startServer } from "@galley/server";

createApp(services, options); // a Hono app — no listening; test it with app.request()
await startServer(options);   // { url, port, token, services, openUrl(path), close() }
```

`startServer` resolves options (explicit values, then the environment, then
defaults), refuses unsafe configurations with a plain `StartupError`, binds,
composes the real engine in `src/compose.ts` (unless `services` is passed),
and serves. Signal handling belongs to the caller (the CLI).

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `GALLEY_PORT` | `4400` | Port. In local mode a busy port moves to the next free one (and says so); in hosted mode it is an error. |
| `GALLEY_HOST` | `127.0.0.1` | Interface to listen on. Anything other than a loopback address means **hosted mode**: one site. |
| `GALLEY_PUBLIC_URL` | — | Hosted: the external address, e.g. `https://cms.example.com`. Used for the Host and Origin checks, the preview's and live comparison's default hostnames, and the CSP `frame-src`; every one-time link is built from it. Without it the server answers to any hostname and has no preview (with a warning), e-mails no link, and makes a link only for a request to a loopback name (`NEEDS_PUBLIC_ADDRESS`, 400, anywhere else). |
| `GALLEY_PREVIEW_URL`, `GALLEY_LIVE_VIEW_URL` | worked out from `GALLEY_PUBLIC_URL` | Hosted: where the preview and the live comparison are served, by hostname, on the same port (`cms-preview.example.com`, `cms-live.example.com`). See [Previews](#previews). |
| `GALLEY_PASSWORD` | — | Hosted: a starting value — the first owner's password (12+ characters), used once, only while there is no owner; with `GALLEY_OWNER_NAME` and `GALLEY_OWNER_EMAIL` it makes a complete owner. Without it the server prints a one-time setup link. Read from the environment only. The other starting values (`GALLEY_OWNER_*`, `GALLEY_SITE_*`, `GALLEY_AUTHOR_*`, `GALLEY_SETUP_TOKEN*`, `GALLEY_INSTALL_CONFIG`) and the operations variables are listed by `galley serve --help`. |
| `GALLEY_SMTP_URL`, `GALLEY_MAIL_FROM` | — | Hosted: outgoing e-mail (`smtp://` or `smtps://`). With both and `GALLEY_PUBLIC_URL`, invitations are also e-mailed, an owner's new-password link goes to the person only (`url: null` in the answer), and "Forgot your password?" works; otherwise an owner copies each link and sends it. |
| `GALLEY_TOKEN` | random | Local: the session token (32 random bytes when unset). Hosted: optional, enables `Authorization: Bearer` for scripts. At least 16 characters. |
| `GALLEY_HOME` | `~/.galley` | State: settings, stored keys (0600), usage, the list of known sites, each site's conversations (`state/<site id>/threads`), the cookie-signing key (`session.key`, 0600). Hosted: the install's data folder — its state (`install.json`), its keys (`keys/`) and its one site (`site/`). |
| `GALLEY_SITES_DIR` | `<home>/sites` | Local: where cloned and new sites go. Ignored in hosted mode (said once at start-up). |
| `GALLEY_STARTERS_DIR` | repo `starters/` (bundle: `dist/starters`) | Starter templates for new sites, one folder each. |
| `GALLEY_WEB_DIR` | `packages/web/dist` (bundle: `dist/web`) | The built web UI. When it has no `index.html`, a page explains how to build it. |
| `GALLEY_PREVIEW_PORTS` | any free port | Local: a range like `4410-4429` that every preview proxy and live-site (baseline) proxy is given a port from, lowest free first. An open preview holds one port, two when its site has a live address. When all are taken, starting another preview says how many are open. Also the `previewPorts` option. Ignored in hosted mode, which opens no preview port. |
| `GALLEY_BRAND_FILE` | — | JSON brand override (`productName`, `byline`, `logoUrl`, `accent`, `supportUrl`, `docsUrl`), validated at start-up. |
| `GALLEY_BRAND_NAME` | — | Shortcut: product name shown in the UI. Beats the brand file. |
| `GALLEY_BRAND_ACCENT` | — | Shortcut: accent color (hex). Beats the brand file. |
| `GALLEY_TRUST_PROXY` | off | `1`: honour `X-Forwarded-Proto` (Secure cookies behind an HTTPS proxy) and `X-Forwarded-For` (sign-in rate limit per client). Only set it behind a proxy you control. |
| `GALLEY_DESKTOP` | off | `1`: the desktop shell is the host (`/api/meta` reports `desktop: true`). |
| `GALLEY_MCP` | on | `off` removes the MCP endpoint (`POST/GET/DELETE /mcp`, the engine's tools for AI tools; see `docs/mcp.md`). |
| `GALLEY_MCP_BUILD` | off | `1`: MCP connections run in build mode (source files and the site's build), where a site's own settings allow it. |
| `GALLEY_MCP_PUBLISH` | on | `0`: MCP connections can't publish or undo a publish. |
| `ANTHROPIC_API_KEY` | — | Assistant key, read by the engine. Beats a key stored from Settings. |
| `OPENAI_API_KEY` | — | Image generation (OpenAI), read by the engine. |
| `GEMINI_API_KEY` | — | Image generation (Google), read by the engine. |

Development: `pnpm dev` (repo root) runs `src/dev.ts`, which opens the site in
`GALLEY_SITE` (or the current directory), keeps state in `./.galley-home`
unless `GALLEY_HOME` is set, and prints the signed-in URL.

Developing the UI with Vite (`pnpm dev:web`): open the printed URL once (it
sets the session cookie on `127.0.0.1`; cookies ignore ports), then use the
Vite server at `http://127.0.0.1:<vite port>` and proxy `/api` to the server
with the server's own origin, or every POST/PUT/PATCH/DELETE is refused by
the Origin check:

```ts
proxy: {
  "/api": {
    target: "http://127.0.0.1:4400",
    changeOrigin: true,
    configure: (proxy) => proxy.on("proxyReq", (req) => req.setHeader("origin", "http://127.0.0.1:4400")),
  },
}
```

## Security model

**Local mode** (default). Listens on 127.0.0.1 only. A random token is minted
at start-up; the CLI opens `http://127.0.0.1:4400/<path>?token=…`, the server
checks it in constant time, sets an `HttpOnly; SameSite=Strict` session cookie
(name includes the port, because ports share cookies), and redirects to the
same path without the token. API calls need that cookie or
`Authorization: Bearer <token>`.

**Hosted mode** (`GALLEY_HOST` not loopback, or `galley serve`). One site
(`hosted-refusals.ts` answers the multi-site routes with 403 and the "Host the
editor online" routes with 404), for people with accounts: each signs in with
their own e-mail and password and is an owner, an editor or a contributor
(`packages/core/src/install/accounts.ts`, `people.ts`). With no owner yet, the
server prints a one-time setup link; the code is kept as its SHA-256, the
first-run routes (`/api/setup…`) take it as a Bearer value until an owner
exists, and whoever opens it creates the first owner. Owners invite everyone
else with one-time links (`accounts-routes.ts`). Passwords are stored as
scrypt hashes in the install's state. `POST /api/auth/login` takes an e-mail
and password and compares in constant time; an unknown e-mail, a wrong
password and a switched-off account get the same answer, the same number
of password checks and the same place in line. The limits
(`sign-in-gate.ts`, kept in memory, its clock injectable for tests) apply
to every password check — sign-in, a password change, the current password
for an e-mail change — and count a **client** as `clientKey` in `auth.ts`
does for every limit in the server: an IPv4 address, or a whole IPv6 `/64`
(IPv4-mapped IPv6 is the IPv4 address). Per client, checked and reserved in
one synchronous step before any `await`: 2 checks in flight, 20 attempts a
minute (successes count), and 5 failures a minute shared with wrong setup
codes and bad link codes (`ctx.limiter`), an attempt in flight counting as
one until it ends; one e-mail from one client gets 10 failed sign-ins in 15
minutes, then a 429 for that pair. Per e-mail from every client together,
known or not: strictly one check at a time, 3 more waiting, then a 429
without a check; past 10 failures (forgotten after 15 quiet minutes) each
turn begins with a delay of 1 s doubling to 30 s, so at most about 2,900
guesses a day reach one e-mail (the arithmetic is beside the constants).
A successful sign-in also sets a known-browser cookie (`<session
cookie>_known`, a year, `HttpOnly`, its own MAC label, five parts so it is
never read as a session): a sign-in to that account from it skips the
e-mail's line and delay (still one check at a time for the e-mail), until 3
wrong passwords in 15 minutes or until that person is switched off, removed
or signed out everywhere. The checks themselves run 2 at a time, at most one
per client, waiting ones served round-robin across clients, known browsers
first with 64 places of their own and 256 for the rest; past those, a 429.
The stated cost: while an e-mail is being guessed at, its right password
from an unknown browser may wait or be told to wait; a known browser and a
one-time link go round it. Each session cookie belongs to one person; it is signed
with a key kept in the home, valid for 30 days, `HttpOnly; SameSite=Strict`;
on an `https://` public address it is `__Host-` and always `Secure`. Signing
out, "sign out everywhere" (`POST /api/auth/logout-all`, the caller only),
an owner signing someone out, and a password change are recorded in the
install's state, so they survive a restart. A single sign-out is written
only for a session that still counts, until it would have expired; the list
is capped (`REVOKED_SESSIONS_KEPT`, 10,000), past which a sign-out ends that
person's sessions by time, and a longer list is trimmed at start-up by
signing everyone out once, with one log line. One-time links are built only
from `GALLEY_PUBLIC_URL` (without it, only for a request to a loopback name)
and e-mailed only when it and outgoing mail are both set. `GET /healthz` and
`GET /readyz` answer anyone, with nothing that identifies the install.

**Who may call what** on a hosted install is one table, `ROUTE_ACCESS` in
`packages/core/src/install/route-access.ts`: every route has a level (edit,
publish or manage), and `app.ts` checks the caller's role against it on
every request. Someone signed in below the level gets `403`: "Your account
can't do that. Ask an owner of this editor." The operator's `GALLEY_TOKEN`
reaches every route except those that need a person (your own account,
people, backups, restores, opening the preview). Local mode has no accounts
and ignores the table. `app.ts` also runs each person's request inside
`withCaller` (`packages/core/src/install/caller.ts`), so the engine holds
two rules no route level can express, wherever the write happens: build
mode needs `BUILD_MODE_LEVEL` (an editor or owner) and the site's settings
file needs `SITE_SETTINGS_LEVEL` (an owner) — a route, an assistant tool, an
MCP tool or a plugin's tool alike. A hosted server also sets
`requireCallerForGuardedWork(true)` at start: from then on publishing and
the site's other guarded methods, the settings file and build mode are
refused to work done for nobody (what runs outside any request, a plugin's
hooks included). The exceptions are the two marks in `caller.ts`:
`asOperator`, which `app.ts` puts around a request with the operator's
token (and every request in local mode) and `mcp.ts` around `/mcp`, and
`asEngine`, for the engine's own unattended work. An e-mail address is changed by an owner
(`PATCH /api/people/:accountId`, or their own on `PATCH /api/account`);
an editor or contributor changing their own is refused with 403, and an
account with no e-mail yet adds one.

**Every request**: the `Host` header must name the server (loopback names, the
listening address, the public URL's host) — the DNS-rebinding guard. **Every
state-changing request** (not GET/HEAD/OPTIONS) needs an `Origin` equal to the
server's own origin (or `Sec-Fetch-Site: same-origin`), or a valid Bearer
token; otherwise 403 — the CSRF guard. Only `GET /api/meta`,
`POST /api/auth/login` and `POST /api/auth/logout` work without a session
(and, hosted, the three one-time-link routes `POST /api/auth/link/check`,
`POST /api/auth/link` and `POST /api/auth/forgot`, where the link's code is
the proof); unauthenticated, meta reveals the brand, the mode and
`authenticated: false` and nothing else.

**Files on the app's origin.** `GET …/raw` and image candidates are sent with
`X-Content-Type-Options: nosniff` and
`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`,
so an uploaded SVG cannot run script with the app's cookies; HTML, JavaScript
and XML from a site are served as `text/plain`. `.git/` and `.env*` are never
served. Uploads are `data:` URLs limited to 25 MB of images, MP4 or PDF; JSON
bodies are limited to 40 MB.

**The UI** is served with
`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src <previews>; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'`,
where `<previews>` is `http://127.0.0.1:* http://localhost:*` locally (not
`[::1]`: browsers reject an IPv6 literal with a port wildcard as a source, and
the preview proxies bind 127.0.0.1 anyway) and the preview's and live
comparison's two origins when hosted. Hashed assets
(`/assets/*`) are cached for a year; everything else, including `index.html`,
is `no-cache`. Unknown non-API paths fall back to `index.html`.

**Errors.** A thrown `GalleyError` becomes `{ error: { code, message, detail? } }`
with its status (details that look like stack traces are dropped). Anything
else is logged to stderr with its stack and answered with
`{ error: { code: "internal", message: "That couldn't be done because of an unexpected problem. Try again." } }`.
Bad input is `400 invalid` naming the field. No session, an ended session, a
wrong token or a wrong password is `401 unauthorized`; `403 forbidden` is for
requests that are understood but not allowed (a foreign Host or Origin, a
path outside what the mode may write, a role below the route's level). A broken operator setting (brand
file, accent, port range) stops start-up with one plain sentence. Secrets are never read by the
server; secret routes return `SecretStatus` only (hint cut to 4 characters,
and on a hosted install no hint at all for anyone who isn't an owner,
`key-hints.ts`),
and an engine error that quotes a secret is scrubbed before it is answered or
logged.

## Previews

Each open site's preview is the site's own dev server behind a **preview
proxy**, and — when the site has a live address — the live site behind a
**baseline proxy**; the UI frames both. Locally they listen on 127.0.0.1 at
free ports. A dev server already answering on the site's configured port is
used only when it runs from that site's folder; otherwise the site gets its
own, on a free port.

**Hosted**, no preview port is opened. Three hostnames reach the server's
one port: the editor (`GALLEY_PUBLIC_URL`), the preview (`GALLEY_PREVIEW_URL`,
default `cms-preview.example.com`) and the live comparison
(`GALLEY_LIVE_VIEW_URL`, default `cms-live.example.com`). Requests for the
last two never reach the app: the preview gateway (`src/gateway.ts`) hands
them to the proxy mounted for that hostname. Hostnames, not paths, because
sites and dev servers use root-absolute URLs and hot reload assumes the root;
and another origin than the editor, so the site's scripts can never act as
the signed-in person. Only a browser the editor let in sees them: the editor
gets a one-use, 60-second ticket from `POST /api/sites/:siteId/preview/entry`,
each frame loads `/__galley/enter?ticket=…` on its hostname, and the gateway
trades the ticket for a viewer cookie derived from that sign-in, which ends
with it (`src/gateway-auth.ts`). Strangers get a 401 page; neither cookie is
forwarded to the site. A reverse proxy in front must keep the `Host` header
and terminate TLS for all three names — one Caddy site block does:

```caddyfile
cms.example.com, cms-preview.example.com, cms-live.example.com {
	reverse_proxy editor:4400
}
```

## Deep links from a site's dev toolbar

`GET /open?root=<site folder>&url=<page>` is a page of the web app (served by
the SPA fallback like any other): it never opens, adds or changes anything —
any web page can send a browser to a URL. The page asks the authenticated
`GET /api/open?root=&url=`, which answers `{ state: "ready", siteId, entry }`
for a known site (`entry` is the entry behind `url`, or null) and
`{ state: "unregistered", name, root }` for a site folder that isn't in the
list yet — adding it is then the person's choice, through the Origin-checked
`POST /api/sites/open`. `root` must be a site folder the app may open, and
`url` a path on the site (2,048 characters at most; the query and fragment
are dropped); anything else is `400 invalid`. Without a session it is `401
unauthorized`, and nothing about `root` is looked at.

## MCP

`/mcp` serves the engine's tools over the Model Context Protocol (Streamable
HTTP), mounted by `startServer` unless `GALLEY_MCP=off`. It takes only
`Authorization: Bearer` — the session token above, or the stable token from
`galley mcp token` (kept hashed in the home) — never the cookie; an `Origin`
that is present and not this server's own is refused with 403 even with a
valid token. Edits made over it are emitted with origin `agent`. See
`docs/mcp.md`.

## Events

`GET /api/events` is Server-Sent Events: a `hello` event first, then every
`EventBus` event as `data: <json>`, a `: heartbeat` comment every 20 s, and the
subscription is dropped when the client disconnects or the server closes.
