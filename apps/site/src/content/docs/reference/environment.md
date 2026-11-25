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
| `GALLEY_HOME` | `~/.galley` (`/data` in the image) | The Galley home: the sites list, settings, keys, conversations, the inbox, per-site state. The CLI and the desktop app share it when they share this value. On a hosted install it is the data folder: the one site and everything the install keeps ([Run a hosted install](/docs/running/hosted/#what-is-kept-where)). [Settings and secrets](/docs/running/settings/). |
| `GALLEY_SITES_DIR` | `<GALLEY_HOME>/sites` | Where cloned and new sites go. Ignored on a hosted install, which keeps its one site in its data folder (it says so at start-up). |
| `GALLEY_STARTERS_DIR` | the repository's `starters/` | The starters, one folder each. |
| `GALLEY_STARTER_DOWNLOADS` | this version's starters release on GitHub | Where a starter that is downloaded the first time it is used comes from: a folder address its `starters-<id>.tgz` is fetched from, for a mirror. Whatever comes is checked against the size and SHA-256 the package records. |
| `GALLEY_WEB_DIR` | `packages/web/dist` | The built app screens. Without an `index.html` there, the server shows a page saying how to build them. |

## The server

| Variable | Default | Meaning |
| --- | --- | --- |
| `GALLEY_HOST` | `127.0.0.1` | The interface to listen on. Anything but a loopback address means a hosted install. `galley serve` defaults to `0.0.0.0`. |
| `GALLEY_PORT` | `4400` | The port. On your own computer a busy port moves to the next free one (and says so); on a hosted install and for the desktop app it is an error. |
| `GALLEY_PUBLIC_URL` | — | Hosted: the address people use, e.g. `https://cms.example.com`. Used for the Host and Origin checks, the preview's and live comparison's addresses, the forms' capture address and the MCP endpoint, and every invitation and new-password link is built from it. Without it the server answers any hostname, there is no preview, no link is e-mailed, and a link can be made only from a loopback address. Set it before inviting anyone. |
| `GALLEY_TRUST_PROXY` | off | `1`: honour `X-Forwarded-Proto` and `X-Forwarded-For` from a reverse proxy you control. Every limit counts a client by the address this gives: an IPv4 address, or a whole IPv6 `/64`. Without it, behind a proxy, everyone is one client; with it and no proxy in front, a request can claim any address, so set it only behind a proxy of your own. It believes them from every connection that reaches the port — the proxy's, or a program's on the same machine. For a proxy on the same machine, `GALLEY_SOCKET` is narrower. |
| `GALLEY_SOCKET` | unset | A Unix socket to listen on as well as the port, for a reverse proxy on the same machine to connect to (`--socket` too). `X-Forwarded-For` and `X-Forwarded-Proto` are believed for requests that come in on the socket — and, once it is set, never for those on the port, `GALLEY_TRUST_PROXY` or not. The socket is made readable and writable by the server's user alone (`0600`), unless `GALLEY_SOCKET_MODE=0660` lets its group in as well — how a proxy that runs as another user gets in, by joining that group. The image sets `0660`: there the group is `node`, gid 1000, with no other account in it. Every folder and link on the way to the socket must be the server's user's (or root's), and no folder on the way writable by other users unless it has the sticky bit, as `/tmp` does. The image has a folder for it, `/run/galley` (user `node`, `0750`). The proxy must set or append `X-Forwarded-For`, or everyone coming through the socket is one client (the server says so once). The socket keeps out other users (with `0660`, all but its group's members), other containers and the network; it doesn't keep out code that runs as the server's own user, which until the editor runs the site's code as a user of its own includes the site's preview and build. The port stays open on `GALLEY_HOST`: with the proxy on the socket, set that to `127.0.0.1`. The same app answers on both, `/healthz`, `/readyz` and WebSocket upgrades included. A socket file a server that stopped without cleaning up left behind is replaced; the server's own goes when it stops. A hosted editor's only (`galley serve`): a local one ignores it, and it isn't available on Windows. |
| `GALLEY_SOCKET_MODE` | `0600` (`0660` in the image) | Who may connect to `GALLEY_SOCKET`. `0600`: the server's user alone (a proxy that runs as root can still connect). `0660`: the server's group as well — how a proxy that runs as another user gets in, by joining the group; every account in that group can then connect, so choose it where the group is the server's own. The server can't tell that for itself (groups may come from a directory service, not only `/etc/group`), so it is never guessed. The image sets `0660`, its group `node` having no other account in it. |
| `GALLEY_TOKEN` | random | On your own computer: the session token in the printed link (32 random bytes when unset). Hosted: optional; set it to allow `Authorization: Bearer` for scripts, which then reach every route except a person's own account, People, backups, restore and opening the preview, and on `/mcp`; what it does is the operator's, so it may publish and change the site's settings. 16 characters or more. On a hosted install the site's own commands never see it. |
| `GALLEY_PREVIEW_PORTS` | any free port | On your own computer: a port range for the previews and their proxies, e.g. `4410-4429`. Ignored on a hosted install, which serves the preview through its one port by hostname (it says so at start-up). |
| `GALLEY_DESKTOP` | off | `1`: the desktop app is the host (`/api/meta` says `desktop: true`). Set by the app. |
| `GALLEY_SITE` | the current folder | `pnpm dev` inside the repository: the site to open. |

## A hosted install

Read by `galley serve`. The ones marked *starting value* are used once, only while the install doesn't have that thing yet, so what someone later changes in the app sticks across restarts ([Run a hosted install](/docs/running/hosted/#start-it-unattended)). Secrets among them are never passed to the site's own commands.

| Variable | Default | Meaning |
| --- | --- | --- |
| `GALLEY_PREVIEW_URL` | worked out from `GALLEY_PUBLIC_URL` | Where the preview is served, on the same port, by hostname: `cms.example.com` gives `https://cms-preview.example.com`; a two-part name or `*.localhost` gives `preview.<name>`. |
| `GALLEY_LIVE_VIEW_URL` | worked out the same way | Where the live site is shown beside the preview: `https://cms-live.example.com`. |
| `GALLEY_PASSWORD` | — | *Starting value.* The first owner's password, 12 characters or more, used only while there is no owner. Without it the server prints a one-time setup link. Never put back by `--reset-password`, and ignored with a notice once the owner has changed their password. |
| `GALLEY_OWNER_NAME` | — | *Starting value.* The first owner's name, with `GALLEY_PASSWORD` (without it, ignored with a notice). Also fills in the name of an owner carried over from before accounts, once. |
| `GALLEY_OWNER_EMAIL` | — | *Starting value.* The e-mail the first owner signs in with, with `GALLEY_PASSWORD`. Without these two the owner has no name or e-mail yet, and the app asks for them after sign-in. |
| `GALLEY_SETUP_TOKEN` | a code is made and printed | The one-time setup code to use instead, 24 characters or more. Not printed again at start-up. Once used, it stays dead: whenever a setup link is needed again, a fresh one is made instead. |
| `GALLEY_SETUP_TOKEN_SHA256` | — | Only the setup code's SHA-256 (64 hexadecimal characters), so the code itself never reaches the server. |
| `GALLEY_INSTALL_CONFIG` | — | One JSON file with any of the starting values ([its shape](/docs/running/hosted/#start-it-unattended)). The environment wins over it. Make it readable by the server's user only. |
| `GALLEY_SITE_REPOSITORY` | — | *Starting value.* The site's repository: `git@github.com:example/site.git` or `https://…`. |
| `GALLEY_SITE_ACCESS` | `deploy-key` (`token` when `GALLEY_SITE_TOKEN` is set) | How the repository is reached: the install's own deploy key, or an access token over HTTPS. |
| `GALLEY_SITE_TOKEN` | — | *Starting value.* The access token, with `GALLEY_SITE_ACCESS=token`. Kept in the data folder's key store, never in the checkout or the address. |
| `GALLEY_SITE_BRANCH` | the repository's default branch | *Starting value.* The branch to work on. |
| `GALLEY_SITE_FOLDER` | the top of the repository | *Starting value.* The folder inside the repository that holds the site, e.g. `apps/site`. |
| `GALLEY_SITE_STARTER` | — | *Starting value.* Send this starter to an empty repository as its first version, instead of copying what it holds. |
| `GALLEY_SITE_LIVE_URL` | — | *Starting value.* The site's live address, which Proof compares against. Kept in the install's own state, never written into the site; the site's own `urls.production` wins when it has one. |
| `GALLEY_AUTHOR_NAME` | — | *Starting value.* The install's publishing name: what a publish nobody signed in started (a script, an AI tool over MCP) is recorded with. A signed-in person publishes under their own name. Needs `GALLEY_AUTHOR_EMAIL`. |
| `GALLEY_AUTHOR_EMAIL` | — | *Starting value.* The install's publishing e-mail, with `GALLEY_AUTHOR_NAME`. |
| `GALLEY_SITE_DIR` | — | Upgrading a data folder from before single-site installs that holds several sites: which site's folder to keep. Without it such a folder is refused at start-up, in one sentence. |
| `GALLEY_ALLOW_LOCAL_REPOSITORIES` | off | `1`: the repository may be a folder on the server itself (trials). Off because it would let the editor read any repository on the server's disk. |
| `GALLEY_PREVIEW_MEMORY_MB` | no limit | Node's memory ceiling (its max-old-space-size option) for the site's own preview, build and install commands, added after any `NODE_OPTIONS` of yours. Never applied to the server's own process. The generated files set `1024`. |
| `GALLEY_LOG_REQUESTS` | on | `0` leaves out the one log line per request (method, path without the query, status, time). |
| `GALLEY_SHUTDOWN_GRACE_MS` | `20000` | How long stopping waits for a publish or a connect in progress. |
| `GALLEY_SYNC_MINUTES` | `5` | How often the editor looks for newer versions in the site's repository and, when nothing here is in the way, brings them in (forward only, as **Get latest** does). `0` turns the rounds off; Version history still looks when it opens. Whole minutes, up to 1440. Ignored on your own computer, which never looks by itself ([Keeping up with the repository](/docs/running/hosted/#keeping-up-with-the-repository)). |
| `GALLEY_RESTORE_MAX_MB` | `2048` | The largest backup the Install page's restore takes. Restore larger ones with `galley backup restore`. |
| `GALLEY_BACKUP_PASSPHRASE` | asked on a terminal | The passphrase for `galley backup create` and `galley backup restore`, 12 characters or more. Pass it into a one-off container with `-e GALLEY_BACKUP_PASSPHRASE` ([Back it up](/docs/running/hosted/#back-it-up)). |

## Hosting the editor online

Read by the app on your own computer for **Host the editor online** and `galley host` ([Host the editor online](/docs/editing/editor-online/)).

| Variable | Default | Meaning |
| --- | --- | --- |
| `FLY_API_TOKEN` | — | The Fly.io organization token. Beats the one saved in the app. |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | — | The whole text of a key file from Google Cloud (a service account's JSON key), for the Google Cloud host — not its path. Beats the one saved in the app. |
| `GALLEY_HOSTING_IMAGE` | `ghcr.io/fictiontribe/galley:<version>` | The image a new or upgraded install runs. That default isn't published yet, so set this to an image you built and pushed. |
| `GALLEY_HOSTING_<NAME>_API` | the host's own API | Testing only: send a host's API calls (`FLY`, `CLOUDFLARE`, and Google Cloud's `GCP_COMPUTE`, `GCP_OAUTH`, `GCP_RESOURCE_MANAGER`) to a fake host. |
| `GALLEY_HOSTING_INSTALL_API` | `https://<editor address>` | Testing only: where a new install is reached, for a rehearsal against fake hosts. |

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
| `GALLEY_DEPLOY_PROBE` | the domain itself, over HTTPS | Testing only: where Galley looks to see whether a site's own domain answers yet. A URL with `{host}` in it. |
| `GALLEY_REDIRECTS_CLOUDFLARE_API` | `https://api.cloudflare.com/client/v4` | Testing only: the API address for setting redirects on Cloudflare. |

## Media in a bucket

| Variable | Default | Meaning |
| --- | --- | --- |
| `GALLEY_MEDIA_ACCESS_KEY_ID` | — | The bucket key's Access Key ID, for every site that has none of its own. A site's own key beats it. [Media in a bucket](/docs/configuration/media-storage/). |
| `GALLEY_MEDIA_SECRET_ACCESS_KEY` | — | The same key's Secret Access Key. |
| `GALLEY_MEDIA_IMAGES_TOKEN` | — | The Cloudflare API token for Cloudflare Images (Account › Cloudflare Images › Edit), for every site that has none of its own. |
| `GALLEY_MEDIA_IMAGES_API` | `https://api.cloudflare.com/client/v4` | Testing only: send Cloudflare Images API calls to another address (a stand-in). |

## Forms and e-mail

| Variable | Default | Meaning |
| --- | --- | --- |
| `GALLEY_SMTP_URL` | — | The mail server for the inbox's e-mail alerts and, on a hosted install, for invitations, new-password links and **Forgot your password?** ([Outgoing e-mail](/docs/running/hosted/#outgoing-e-mail)): `smtp://user:pass@host:587`, or `smtps://` for TLS from the start. Needs `GALLEY_MAIL_FROM`; links are e-mailed only when `GALLEY_PUBLIC_URL` is set too. |
| `GALLEY_MAIL_FROM` | — | The sender address for those e-mails. Needs `GALLEY_SMTP_URL`. |
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
| `GALLEY_BRAND_ACCENT` | — | The accent colour (hex). Beats the brand file. In the editing app it is the built-in themes' pencil, checked for legibility like any pencil; one too close to grey is not used there, and the server says so when it starts ([themes](/docs/plugins/themes/)). |

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
