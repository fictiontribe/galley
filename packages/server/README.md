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
| `GALLEY_PUBLIC_URL` | — | Hosted: the external address, e.g. `https://cms.example.com`. Used for the Host and Origin checks, the preview's and live comparison's default hostnames, and the CSP `frame-src`. Without it the server answers to any hostname and has no preview (with a warning). |
| `GALLEY_PREVIEW_URL`, `GALLEY_LIVE_VIEW_URL` | worked out from `GALLEY_PUBLIC_URL` | Hosted: where the preview and the live comparison are served, by hostname, on the same port (`cms-preview.example.com`, `cms-live.example.com`). See [Previews](#previews). |
| `GALLEY_PASSWORD` | — | Hosted: a starting value — the first sign-in password (12+ characters), used only while none exists. Without it the server prints a one-time setup link. Read from the environment only. The other starting values (`GALLEY_SITE_*`, `GALLEY_AUTHOR_*`, `GALLEY_SETUP_TOKEN*`, `GALLEY_INSTALL_CONFIG`) and the operations variables are listed by `galley serve --help`. |
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
editor online" routes with 404). With no password yet, the server prints a
one-time setup link; the code is kept as its SHA-256 and the first-run routes
(`/api/setup…`) take it as a Bearer value until a password exists. The
password is stored as an scrypt hash in the install's state.
`POST /api/auth/login` compares in constant time; wrong passwords and wrong
setup codes share one limit, 5 a minute per client address, then a 429 until
the minute is up. The session cookie is signed with a key kept in the home,
valid for 30 days, `HttpOnly; SameSite=Strict`; on an `https://` public
address it is `__Host-` and always `Secure`. Logout, "sign out everywhere"
(`POST /api/auth/logout-all`) and a password change are recorded in the
install's state, so they survive a restart. `GET /healthz` and `GET /readyz`
answer anyone, with nothing that identifies the install.

**Every request**: the `Host` header must name the server (loopback names, the
listening address, the public URL's host) — the DNS-rebinding guard. **Every
state-changing request** (not GET/HEAD/OPTIONS) needs an `Origin` equal to the
server's own origin (or `Sec-Fetch-Site: same-origin`), or a valid Bearer
token; otherwise 403 — the CSRF guard. Only `GET /api/meta`,
`POST /api/auth/login` and `POST /api/auth/logout` work without a session;
unauthenticated, meta reveals the brand, the mode and `authenticated: false`
and nothing else.

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
path outside what the mode may write). A broken operator setting (brand
file, accent, port range) stops start-up with one plain sentence. Secrets are never read by the
server; secret routes return `SecretStatus` only (hint cut to 4 characters),
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
