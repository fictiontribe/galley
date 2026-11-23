---
title: Environment variables
description: Every environment variable Galley reads — the server, the CLI, the engine, the plugins, the site kit and the desktop app — with its default. Checked against the source on every build of this site.
group: reference
order: 4
---

This page is for developers and whoever runs Galley. Command-line options beat variables; variables beat defaults. This site's build fails if the source reads a `GALLEY_*` variable that has no row here, or a row names one the source no longer reads.

## Where Galley keeps things

| Variable | Default | Meaning |
| --- | --- | --- |
| `GALLEY_HOME` | `~/.galley` | The Galley home: the sites list, settings, keys, conversations, the inbox, per-site state. The CLI, the desktop app and a hosted server share it when they share this value. [Settings and secrets](/docs/running/settings/). |
| `GALLEY_SITES_DIR` | `<GALLEY_HOME>/sites` | Where cloned and new sites go. Hosted: the only folder sites can be opened from, cloned into or created in. |
| `GALLEY_STARTERS_DIR` | the repository's `starters/` | The starters, one folder each. |
| `GALLEY_WEB_DIR` | `packages/web/dist` | The built app screens. Without an `index.html` there, the server shows a page saying how to build them. |

## The server

| Variable | Default | Meaning |
| --- | --- | --- |
| `GALLEY_HOST` | `127.0.0.1` | The interface to listen on. Anything but a loopback address means hosted mode, which needs `GALLEY_PASSWORD`. `galley serve` defaults to `0.0.0.0`. |
| `GALLEY_PORT` | `4400` | The port. On your own computer a busy port moves to the next free one (and says so); in hosted mode and for the desktop app it is an error. |
| `GALLEY_PASSWORD` | — | Hosted mode's one shared sign-in password, 12 characters or more. Required there. Read from the environment only. |
| `GALLEY_PUBLIC_URL` | — | Hosted: the address people use, e.g. `https://cms.example.com`. Used for the Host and Origin checks, the previews' addresses, the forms' capture address and the MCP endpoint. |
| `GALLEY_TRUST_PROXY` | off | `1`: honour `X-Forwarded-Proto` and `X-Forwarded-For` from a reverse proxy you control. |
| `GALLEY_TOKEN` | random | On your own computer: the session token in the printed link (32 random bytes when unset). Hosted: optional; set it to allow `Authorization: Bearer` for scripts. 16 characters or more. |
| `GALLEY_PREVIEW_PORTS` | any free port | A port range for the previews and their proxies, e.g. `4410-4429` — for a firewall or a container that publishes fixed ports. |
| `GALLEY_DESKTOP` | off | `1`: the desktop app is the host (`/api/meta` says `desktop: true`). Set by the app. |
| `GALLEY_SITE` | the current folder | `pnpm dev` inside the repository: the site to open. |

## The assistant, pictures and keys

Keys are looked for in this order: the site's own key (Site settings › Connections), then the environment, then the key saved in App settings.

| Variable | Default | Meaning |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | The assistant's key. |
| `GALLEY_ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | Send assistant requests to this address instead, e.g. a gateway. `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` are ignored on purpose. |
| `GALLEY_AI_PROFILE` | — | `full` or `plain`: pin the assistant's request shape instead of starting full and falling back ([Connect the assistant](/docs/getting-started/assistant/)). |
| `OPENAI_API_KEY` | — | OpenAI image generation. |
| `GEMINI_API_KEY` | — | Google image generation. |
| `GOOGLE_API_KEY` | — | Google image generation, when `GEMINI_API_KEY` isn't set. |
| `OPENROUTER_API_KEY` | — | The OpenRouter plugin's key (images and videos), when it isn't saved in Plugins. |

## Putting sites online

| Variable | Default | Meaning |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | — | The Cloudflare access key. Beats the one saved in the app; a site's own key beats it. |
| `CLOUDFLARE_ACCOUNT_ID` | — | Which Cloudflare account, when the key reaches several. |
| `VERCEL_TOKEN` | — | The Vercel access key. |
| `VERCEL_TEAM_ID` | — | Which Vercel team. |
| `GALLEY_DEPLOY_<HOST>_API` | the host's own API | Testing only: send a host's API calls to another address (a fake host). `<HOST>` is the host's id in capitals. |
| `GALLEY_REDIRECTS_CLOUDFLARE_API` | `https://api.cloudflare.com/client/v4` | Testing only: the API address for setting redirects on Cloudflare. |

## Forms and e-mail

| Variable | Default | Meaning |
| --- | --- | --- |
| `GALLEY_SMTP_URL` | — | The mail server for the inbox's e-mail alerts: `smtp://user:pass@host:587`, or `smtps://` for TLS from the start. Needs `GALLEY_MAIL_FROM`. |
| `GALLEY_MAIL_FROM` | — | The sender address for those alerts. Needs `GALLEY_SMTP_URL`. |
| `WORDPRESS_APP_PASSWORD` | — | `galley import wordpress --user`: the WordPress application password, to read drafts and private pages (another variable with `--app-password-env`). |

## Plugins and adapters

| Variable | Default | Meaning |
| --- | --- | --- |
| `GALLEY_ALLOW_SITE_PLUGINS` | off | Hosted: `1` lets plugins and adapters a site's `galley.config.json` names run. Off on a shared server by default, because they are the site's own code. |
| `GALLEY_DISABLE_SITE_PLUGINS` | off | `1`: never load plugins (or adapters) a site names. |
| `GALLEY_DISABLE_SITE_ADAPTERS` | off | `1`: never load adapters a site names; use only the built-in ones. |
| `GALLEY_DISABLE_USER_PLUGINS` | off | `1`: don't load the plugins added on this computer (`<GALLEY_HOME>/plugins`). |

## MCP

| Variable | Default | Meaning |
| --- | --- | --- |
| `GALLEY_MCP` | on | `off` (or `0`) removes the `/mcp` endpoint from a running server. |
| `GALLEY_MCP_BUILD` | off | `1`: the `/mcp` endpoint works in build mode. |
| `GALLEY_MCP_PUBLISH` | on | `0`: the `/mcp` endpoint doesn't offer publishing. |
| `GALLEY_MCP_TOKEN` | — | Read by the configuration `galley mcp config --http` prints: the token from `galley mcp token`, kept in your tool's environment rather than its settings file. |

## White-label

| Variable | Default | Meaning |
| --- | --- | --- |
| `GALLEY_BRAND_FILE` | — | A JSON brand override — [White-label](/docs/configuration/white-label/). |
| `GALLEY_BRAND_NAME` | — | The product name shown in the app. Beats the brand file. |
| `GALLEY_BRAND_ACCENT` | — | The accent colour (hex). Beats the brand file. |

## The site kit

Read by the site kit in the site's own `astro dev`, not by Galley.

| Variable | Default | Meaning |
| --- | --- | --- |
| `GALLEY_URL` | `http://127.0.0.1:4400` | Where the kit's dev toolbar app finds Galley, to open the page you're on in it ([The site kit](/docs/astro/site-kit/)). |

## The desktop app's self-test

For the desktop app's own test run, not for everyday use.

| Variable | Default | Meaning |
| --- | --- | --- |
| `GALLEY_DESKTOP_SELFTEST` | — | A page on another loopback port the app loads in its self-test. |
| `GALLEY_DESKTOP_SELFTEST_OUT` | — | Where the self-test writes its result. |
