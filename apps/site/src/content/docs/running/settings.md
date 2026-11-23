---
title: Settings, secrets and the Galley home
navTitle: Settings and environment
description: What Galley keeps in its home folder, how API keys are stored and which one wins, and where the environment variables are listed.
group: running
order: 3
---

This page is for developers and operators. Galley keeps no database. Per-computer state lives in one folder, the **Galley home**; per-site configuration lives in the site, in `galley.config.json`.

## The Galley home

`GALLEY_HOME`, default `~/.galley`. The CLI, the desktop app and a hosted server all use it the same way, so they see the same sites and settings when they share a home.

| Path | What | Written |
| --- | --- | --- |
| `settings.json` | model, effort, image and video choices, your name and email for publishes, theme, preview limits | from App settings |
| `secrets.json` | shared keys saved from App settings — readable by you only (0600) | from App settings |
| `usage.jsonl` | one line per assistant or image request: model, token counts, estimated cost | after each request |
| `sites.json` | the sites list: id, name, folder, group, pin, note, last opened | when a site is added, filed or opened |
| `state/<site id>/` | per site: assistant conversations (`threads/`), form submissions (`submissions/`), deployments, the redirects record, large brand material (`brand/`), the last import, and the site's own keys and author (`secrets.json`, 0600) | as you work |
| `sites/<repository name>/` | sites cloned or created here, unless `GALLEY_SITES_DIR` points elsewhere | clone, create |
| `plugins/` | plugins added with `galley plugin add` | `galley plugin` |
| `tmp/candidates/` | generated images not saved to a site yet | image generation |
| `session.key` | the key session cookies are signed with — 0600 | first start |

Removing a site from the list (`DELETE /api/sites/<id>`) forgets its entry, its own keys and author; its folder stays on disk.

## Secrets

The keys Galley uses: Anthropic for the assistant; OpenAI or Google for images; Cloudflare or Vercel for putting sites online; OpenRouter (through its plugin) for images and videos. For every key the order is:

1. **the site's own key** (Site settings › Connections), so a client's site bills the client;
2. **the environment** the app was started from;
3. **the shared key** saved in App settings.

| Secret | Environment | Shape checked when saved |
| --- | --- | --- |
| Assistant | `ANTHROPIC_API_KEY` | starts with `sk-ant-` |
| OpenAI images | `OPENAI_API_KEY` | starts with `sk-` (and isn't an Anthropic key) |
| Google images | `GEMINI_API_KEY`, then `GOOGLE_API_KEY` | one word, 20 characters or more |
| Cloudflare | `CLOUDFLARE_API_TOKEN` | checked with Cloudflare before it is saved |
| Vercel | `VERCEL_TOKEN` | checked with Vercel before it is saved |

Secrets never cross the HTTP boundary: Settings receives whether each key is configured, where it came from, and its last four characters. Every value the process has handled is scrubbed from error messages and logs, along with anything shaped like a key. Keys are kept in owner-only files, **not yet in the operating system's keychain** — the desktop app included ([Desktop app](/docs/running/desktop/)).

## Environment variables

Every variable the server, the engine, the CLI, the plugins and the site kit read is in [Environment variables](/docs/reference/environment/), checked against the source on every build of this site. Command-line options beat variables; variables beat defaults.

For development inside the repository, `pnpm dev` runs the server from source and opens the site in `GALLEY_SITE` (or the current folder), with state in `./.galley-home` unless `GALLEY_HOME` is set.

## Next

- [Security model](/docs/running/security/).
- [Hosting for a team](/docs/running/hosted/).
