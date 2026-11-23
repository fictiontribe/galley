---
title: The preview and astro dev
navTitle: The preview
description: How Galley runs your site's own dev server, fronts it with a proxy that keeps hot reload and adds the click-to-edit overlay, and sets the deployed site beside it.
group: astro
order: 2
---

This page is for developers. Galley has no renderer of its own: the preview is your site running on its own dev server — `astro dev` for an Astro site — with a small proxy in front. Everything here is in [`workspace/preview/`]({repository}/tree/main/packages/core/src/workspace/preview).

## Starting

When someone opens the preview (`POST /api/sites/<id>/preview/start`), Galley:

1. **Installs dependencies** if `node_modules` is missing, with the package manager the lockfile names. The first time can take a few minutes; the state is `installing`.
2. **Reuses a dev server that is already running** on the expected port (`dev.port`: 4321 for Astro unless the `dev` script or `galley.config.json` says otherwise). If you already have `astro dev` open in a terminal, Galley fronts that one instead of starting a second.
3. **Otherwise runs the dev command** — `npm run dev` for the starter — as an argument array, never through a shell, with the site's `node_modules/.bin` first on `PATH`.
4. **Reads the port it actually bound** from its output (Astro may move to 4322 when 4321 is taken) and waits for it to answer. Two minutes without an answer ends in *The preview didn't start in time. The log below may say why.*, with the last lines of the dev server's output.

The dev command runs with the same environment an ordinary terminal would give it, minus two kinds of variable: those that say an AI coding agent is driving the terminal (`CLAUDECODE`, `CLAUDE_*`, `CURSOR_AGENT`, `CODEX_*`, `GEMINI_CLI`, …) — Astro 7 moves its dev server into the background and exits when it sees them — and those that say a test runner started the process (`VITEST`, `JEST_WORKER_ID`), which make Astro serve nothing. ([`workspace/command.ts`]({repository}/blob/main/packages/core/src/workspace/command.ts))

```sh
curl -s -X POST -H "Authorization: Bearer $GALLEY_TOKEN" http://127.0.0.1:4400/api/sites/$SITE/preview/start
```

```output
{"state":"ready","url":"http://127.0.0.1:62851",…,"detail":"The preview is ready.",…}
```

The `url` is the proxy, not `astro dev` itself.

## The proxy

The preview proxy listens on a free port of its own and forwards everything to the dev server:

- **HTTP and WebSocket upgrades**, so Vite's hot module reload works through it: save a file, the preview updates.
- **Frame-blocking headers removed**: `X-Frame-Options`, and `frame-ancestors` from a `Content-Security-Policy` (every other directive kept), so the page can sit in the editor's iframe.
- **The overlay script added** to HTML responses, just before `</head>`:

```sh
curl -s http://127.0.0.1:62851/ | grep -o '<script[^>]*__galley[^>]*>'
```

```output
<script src="/__galley/overlay.js" defer>
```

```sh
curl -s http://127.0.0.1:62851/__galley/health
```

```output
{"ok":true,"kind":"preview"}
```

`/__galley/overlay.js` and `/__galley/health` are the only paths the proxy reserves on your site's origin. Everything else — assets, API routes, redirects — passes through.

## The overlay

[`@galley/overlay`]({repository}/tree/main/packages/overlay) is a small dependency-free script served on the previewed site's origin. In edit mode it outlines text and images on hover, reports a click to the editor window with the element's text and its occurrence on the page — which the engine [resolves to one value in one file](/docs/concepts/never-guess/) — and, once the editor says the match is unique and plain, lets the element be retyped in place. It also reports navigation and scrolling, so the side-by-side view can follow. It does nothing at all unless the page is inside a frame, so opening the proxy's address directly shows your site untouched. Your production build never contains it: it exists only in responses from the proxy.

## Beside the deployed site

When the site has a live address — `urls.staging` if set, otherwise `urls.production` (on Astro, `site` from the config) — a second **baseline proxy** fronts the deployed site the same way, with the overlay in a read-only *follow* role, so the proof can show the proposed page and the live one side by side and scroll them together. If the deployed site asks for a password, or doesn't answer, the preview still starts and says so.

This is the one connection to the outside the preview makes: Galley's server fetches pages of your deployed site when the side-by-side view shows them.

## Where it listens

Locally, the proxies bind `127.0.0.1` on free ports. In hosted mode they bind the server's listening address, still on free ports chosen at start-up — so a reverse proxy or a container with a fixed port mapping can't reach them yet. That is a known gap, described in [Hosting for a team](/docs/running/hosted/#previews-a-known-gap).

## Stopping

`preview/stop` and `preview/restart` do what they say. When Galley stops — `Ctrl+C`, or the desktop app quitting — it stops the dev servers it started. A dev server that was already running when the preview started is adopted, never killed.

## Next

- [Making an Astro site easy to edit](/docs/astro/editable-sites/).
- [Security model](/docs/running/security/) — what the preview's origin can and can't do.
