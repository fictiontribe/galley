---
title: Troubleshooting for developers
navTitle: Troubleshooting
description: Every error a developer can hit starting, configuring and running Galley — the exact message, what it means and what to do.
group: reference
order: 4
---

This page is for developers. Galley's messages are written to say what happened and what to do, so most need no explanation; this page collects them by where they appear, with the cause behind each. Errors an editor sees while editing are covered in the editing docs. Start with `galley doctor` in the site's folder: it checks Node, git, the site, its dependencies and the keys, and prints detection's notes.

## Starting the CLI

| Message | Cause and fix |
| --- | --- |
| This copy of the CLI hasn't been built, and tsx isn't available to run it from source. … | Running `packages/cli/bin/galley.js` without `pnpm install` in the repository. Install, or build the bundle with `pnpm --filter galley-cms build`. |
| *--x isn't an option here. Run* `galley --help` *to see the options.* (exit 2) | A typo, or an option of another command. Each command's `--help` lists its own. |
| `--port must be a number between 1 and 65535, not “x”.` (exit 2) | |
| `There's no folder at /path.` | The path doesn't exist. |
| `/path is a file, not a folder. Point galley at the folder your site lives in.` | |
| `/path doesn't look like a site.` | None of `package.json`, `.git`, `galley.config.json`, `hugo.toml`/`config.toml`, `_config.yml`, `content/` or `src/content/` is there. Wrong folder, or run `galley new`. |
| A page saying *The interface hasn't been built yet.* | The server runs but `packages/web/dist` (or `GALLEY_WEB_DIR`) has no `index.html`. Run `pnpm --filter @galley/web build`. |

## Server start-up

| Message | Cause and fix |
| --- | --- |
| `Port 4400 is in use, so Galley is using 4401 instead.` | Not an error: local mode moved to the next free port. |
| `Ports 4400–4419 are all in use. Choose another with --port or GALLEY_PORT.` | Twenty ports in a row are taken — usually old Galley processes. |
| `Port 4400 is already in use on 0.0.0.0. Stop whatever is using it, or choose another with --port or GALLEY_PORT.` | Hosted mode and the desktop command don't move to another port. |
| `This user isn't allowed to listen on port 80. Choose a port above 1024.` | Privileged port. Put a reverse proxy in front instead. |
| `This computer has no network address 10.0.0.9 to listen on.` | `--host` / `GALLEY_HOST` isn't an address of this machine. |
| `The folder for GALLEY_SOCKET (…) doesn't exist. …` | The socket's folder must exist before the server starts; create it (the proxy and the server need to reach it), or choose another path. |
| `GALLEY_SOCKET names …, which is something other than a socket. …` | A file or folder is at the socket's path. Move it, or choose another path. |
| `Another server is already listening on … (GALLEY_SOCKET). …` | A running server answers on that socket — another editor, or this one not yet stopped. Stop it, or give each its own path. |
| `This user can't make a socket at … (GALLEY_SOCKET). …` | The server's user can't write to the socket's folder. Give it a folder it can write to. |
| `The way to the folder for GALLEY_SOCKET (…) goes through …, which belongs to another user. …` / `…, which other users can write to …` | Whoever can change a folder or link on the way could put a socket of their own in this one's place. Every folder and link on the way must be the server's user's (or root's), and no folder on the way open to other users' writing unless it has the sticky bit, like `/tmp`. |
| `GALLEY_SOCKET is made for this server's user alone (0600). …` | Said at start when `GALLEY_SOCKET_MODE` isn't set. A proxy that runs as another user can't connect: run it as root or as the server's user, or give the server a group of its own, put the proxy in it and set `GALLEY_SOCKET_MODE=0660` (every account in that group can then connect). |
| `GALLEY_SOCKET_MODE must be 0660 … or 0600 …` | Set it to one of those, or leave it unset. |
| `GALLEY_SOCKET's path is N bytes long, and this system takes at most … for a socket. …` | Systems limit a socket's path (about 100 bytes). Choose a shorter one, such as `/run/galley/galley.sock`. |
| `A socket is at … (GALLEY_SOCKET) that may still be in use by another program. …` | Something is at the path that couldn't be told apart from a running server (another user's, say), so it was left alone. Remove it if nothing uses it. |
| `GALLEY_SOCKET isn't available on Windows. …` | Use the port, with `GALLEY_TRUST_PROXY=1` behind your proxy. |
| *Local mode only listens on this computer (127.0.0.1), not on 0.0.0.0. To serve other computers, use* `galley serve`. | `GALLEY_HOST` set to a non-loopback address for `galley [path]`. |
| `GALLEY_PASSWORD is too short. It needs at least 12 characters, …` | |
| `GALLEY_TOKEN must be at least 16 characters long.` | |
| `GALLEY_PUBLIC_URL must be a full address like https://cms.example.com, not “…”.` / `… must start with https:// (or http://) …` | |
| `This editor looks after one site. Each site gets an editor of its own.` | A hosted install refused to add, open or remove another site. Run another install for the other site. |
| `This data folder holds … sites (…), and a hosted Galley now looks after one site. Set GALLEY_SITE_DIR …` | An older hosted data folder holds several sites; a hosted install keeps one. Name it, and the others stay on disk untouched. |
| `! GALLEY_PUBLIC_URL isn't set, so the server answers to any hostname and the preview has no address to be shown on. …` | A warning on a hosted install. Set it to the address people use. |
| `! GALLEY_PUBLIC_URL uses http://, so the password and sign-in cookie cross the network unencrypted. …` | A warning. Put HTTPS in front. |
| `Error: GALLEY_BRAND_ACCENT must be a hex color like #1a2b3c, not “blue”.` (with a stack trace) | A bad white-label setting; the first line is the message. Same for `The brand file … can't be used …`. See [White-label](/docs/configuration/white-label/#validation). |

## Requests

| Response | Cause and fix |
| --- | --- |
| `401` *Open the link printed when the app started to continue.* | No session: open the printed link (it carries the token), or send `Authorization: Bearer <token>`. |
| `403` *This address isn't one this app answers to.* | The `Host` header isn't a loopback name, the listening address or `GALLEY_PUBLIC_URL`'s host. Behind a proxy, set `GALLEY_PUBLIC_URL`, or make the proxy pass the original `Host`. |
| `403` *This request came from outside the app, so it was blocked.* | A state-changing request without a matching `Origin`. Scripts: use the Bearer token. A dev proxy (Vite): rewrite `Origin` to the server's — see [`packages/server/README.md`]({repository}/blob/main/packages/server/README.md). |
| `429` *Too many sign-in attempts. Wait a minute, then try again.* | One client — an IPv4 address, or a whole IPv6 `/64` — passed one of its limits: 2 sign-ins checked at once, 20 attempts a minute (successful ones too), or five failures a minute (sign-in, setup codes, one-time link codes, a wrong current password). Behind a proxy without `GALLEY_TRUST_PROXY=1`, every user shares the proxy's address. A password or e-mail change says *Too many attempts. Wait a minute, then try again.* for the same limits. |
| `429` *Too many sign-in attempts for that e-mail. Wait 15 minutes, then try again.* | Ten failed sign-ins for one e-mail from one client in 15 minutes. Only that client waits for that e-mail. A restart of the server clears it. |
| `429` *That e-mail has more sign-in attempts waiting than can be checked right now. …* | One e-mail's sign-ins are checked one at a time from everywhere, with three more waiting; this one came while the line was full, and its password wasn't checked. Someone may be guessing at that account. A browser that has signed in to it before skips the line; a one-time link doesn't go through it. The same for an e-mail with no account. |
| `429` *This editor is checking a lot of sign-ins right now. Wait a moment, then try again.* | More than 256 sign-ins were waiting for their password check (64 for browsers that signed in before), across many clients. |
| `403` *Your account can't do that. Ask an owner of this editor.* | A hosted install: the signed-in person's role doesn't reach this route ([People and roles](/docs/running/hosted/#people-and-roles)). |
| `403` *Your account can change the site's content, but not its code and templates (build mode). …* | A hosted install: a contributor asked for build mode — `"mode": "build"` on a file write, an entry edit or a conversation, custom code in a form, or the brand saved outside the content files. Nothing was written. |
| `403` *Your account can't change the site's settings. Ask an owner of this editor.* | A hosted install: someone who isn't an owner wrote, discarded or undid a change to `galley.config.json`, by any way in. |
| `403` *Only someone signed in to this editor, or whoever runs it, can do that. …* | A hosted install: work done for nobody — a plugin reacting to a publish, a deploy or a visitor's form, or something it left running — tried to publish, change the site's settings or write outside the content. Those need a signed-in person, the operator's token or the engine itself. |
| `403` *Only an owner can change the e-mail you sign in with. …* | A hosted install: `PATCH /api/account` with a new `email` from an editor or contributor who has one. An owner changes it with `PATCH /api/people/:accountId`. |
| `400` *Links can't be made yet: this editor doesn't know its public address. …* | A hosted install without `GALLEY_PUBLIC_URL`, asked for an invitation or a new-password link from anywhere but a loopback address. Set it and start the server again. |
| `403` *That needs someone signed in to this editor in a browser; a script's access token can't do it.* | A hosted install: `GALLEY_TOKEN` was used on your own account, People or `POST /api/install/password`. |
| In the browser's console, on every page of a hosted install behind Cloudflare: *Loading the script 'https://static.cloudflareinsights.com/beacon.min.js/…' violates the following Content Security Policy directive: "script-src 'self'"* | Cloudflare's Web Analytics added its beacon to the page, and the editor's policy blocked it. Harmless. Turn off Web Analytics' automatic setup for that site in Cloudflare, or leave the editor's names out with a rule; keep the policy as it is ([Behind Cloudflare](/docs/running/hosted/#the-three-names)). |

## Detection and configuration

These appear as notes in `galley doctor` (and in the site's model).

| Note | Cause and fix |
| --- | --- |
| `galley.config.json is not valid JSON. Check for a missing comma or quote. The file was ignored until it is fixed.` | |
| `galley.config.json has 2 problems: … The file was ignored until it is fixed.` | Each problem names the key: `publish.mode: must be one of "commit", "pull-request".`, `The config: “colour” is not a setting Galley knows.` See [Mistakes](/docs/configuration/#mistakes). |
| `The “events” collection in galley.config.json needs a path; it was skipped.` | A new collection id needs `path`. |
| `galley.config.json sets the framework to “zola”, but no adapter with that id is available, …` | Name the adapter in `adapters`, or remove `framework`. |
| `The site address in astro.config.ts (https://www.example.com) is a placeholder, so no live site was set. …` | Set `site` to the real domain, or `urls.production`. |
| `No page in src/pages shows an entry of “Team”, so it has no pages of its own.` | Expected for collections shown inside other pages. Otherwise set `url` in config. |
| `src/content.config.ts: The “x” collection uses a custom loader, so it is not editable here.` | Content isn't files Galley can edit. Point a config collection at the files if there are any. |
| `src/content.config.ts: The “x” collection is built with code, so its folder could not be read.` / `Some collections are spread in from elsewhere and were not read.` | The schema isn't statically readable. Add the collection in config with its `path`. |
| `src/content.config.ts could not be read (…); folders were scanned instead.` | A syntax the reader doesn't handle. Collections came from `src/content/` folders. |
| `No content collections were found. Add a galley.config.json to point at your content.` | |
| `! No dev command found — the preview needs one: …` | No `dev`, `start` or `serve` script. Add one, or `dev.command` in config. |
| `! Dependencies aren't installed — run npm install (the preview also installs them on first start)` | |
| `! … this folder isn't a git repository — editing works, publishing needs it: run git init` | |
| `! Node 18.19.0 is too old — Galley needs 20.11 or newer (nodejs.org)` | Blocking: `doctor` exits 1. |
| `! git isn't installed — install it from git-scm.com; …` | Blocking. |

## The preview

| Message | Cause and fix |
| --- | --- |
| `This site has no preview command yet. Add one in the site settings (for example “npm run dev”).` | As above: no dev command. |
| `Installing the site's dependencies didn't work. The details below say why; …` | The install failed; its output is in the detail. Run the install yourself in the site folder to see it in full. |
| `The preview didn't start in time. The log below may say why.` | The dev server didn't answer within two minutes. Read the log tail; run the dev command yourself. |
| `The preview stopped before it was ready. The log below says why.` | The dev command exited — a build error, a missing dependency, a wrong Node version (Astro 7 needs 22.23.4+). |
| `The preview stopped unexpectedly. Restart it to try again.` | The dev server crashed after starting. |
| `Port N was taken by another program before the preview could use it, so the preview is starting again on another port.` (in the log; on a hosted install, without the number) | Between Galley choosing a free port and the site's dev server asking for it, another program got it. Galley checks that what answers on the port is the dev server it started, and starts it again elsewhere when it isn't. Nothing to do. |
| `Port N keeps being taken by another program …` or (hosted) `The preview couldn't get a port of its own …` | It happened for the whole start, or three times running. Something is taking the ports around the site's own: stop it, or set another `dev.port`. If the dev command runs its server in a container or elsewhere the computer can't see it as the dev server's own, set `dev.trustPort` in the site settings (an owner only). On a hosted install, whoever runs the server checks what else is listening. |
| `Port N is answering, and it couldn't be checked here that it is this site's own preview answering …` (in the log) | On Windows, and on a Mac without `lsof` or `ps`, Galley can't ask which program has a port, so it takes the answer for the dev server's as it always did. If the preview shows another program's pages, stop that program and restart the preview. Linux needs neither tool. |
| The preview starts, but the page is blank or the dev server exits at once when Galley runs inside an AI coding tool's terminal | Galley removes the agent variables (`CLAUDECODE`, `CLAUDE_*`, `CURSOR_AGENT`, `CODEX_*`, …) from the dev server's environment because Astro 7 backgrounds itself when it sees them. If a site's own scripts re-add them, they come back. |
| The preview pane is empty on a hosted install | No address for the preview: set `GALLEY_PUBLIC_URL` (or `GALLEY_PREVIEW_URL` and `GALLEY_LIVE_VIEW_URL`), point the preview's and live comparison's names at the server, and keep the `Host` header in the proxy ([The three names](/docs/running/hosted/#the-three-names)). |

## Editing, publishing, cloning

| Message | Cause and fix |
| --- | --- |
| `Only content and media can be changed in content mode. Switch to build mode to change the site's code.` | The path isn't in `writable.content`. [Modes](/docs/concepts/modes/). |
| `This file isn't one the app is allowed to change. …` | Build mode, but not in `writable.build`. |
| `Version-history files…`, `Installed packages…`, `Environment files…`, `Lockfiles…`, `Files inside hidden settings folders can't be changed from here.` | The [deny-list](/docs/concepts/modes/#the-deny-list); no setting changes it. |
| `That file is outside the site folder, so it can't be opened or changed here.` | `..`, an absolute path, a backslash, or a symlink leading out. |
| `This file changed since you opened it, so your edit wasn't saved. …` | `409`: the `baseHash` no longer matches. Read again and retry. |
| `The fields in this file are written in a format the form can't change yet, so nothing was changed. …` | TOML is read-only. |
| Publish failures | Every message and its cause: [Publishing](/docs/configuration/publishing/#when-it-doesnt-work). |
| `That repository wasn't found. Check the address — and that you have access to it.` | Clone: a typo, or a private repository your credentials can't see (GitHub answers both the same way). git runs with `GIT_TERMINAL_PROMPT=0`, so a missing sign-in fails instead of hanging. The copy is removed. |
| `The code host didn't accept your sign-in for that repository. …` | Clone: no credentials for that host on this computer (or, hosted, for the server's user), or rejected ones. |
| `That branch doesn't exist in the repository.` | Clone: the version field names no branch. |
| `Couldn't reach the code host. …` | Clone: DNS, a proxy, or the host is down. |
| `Downloading the site took too long and was stopped. …` | Clone: it ran for 30 minutes. |
| `That folder already has files in it. …` | Clone: a `directory` was given (API) and isn't empty. |
| `“url” isn't right: it must be an https or ssh address.` | Clone: local paths, `file://` and `ext::` addresses are refused. |

## The assistant and images

| Message | Cause and fix |
| --- | --- |
| `Connect the assistant first: add an Anthropic API key in Settings.` | No key in the environment or Settings. |
| `The assistant can't connect: the API key in Settings was rejected. …` | `401` from the API. A key in `ANTHROPIC_API_KEY` beats the stored one — check which is in use with `galley doctor`. |
| `The assistant's API account is out of credit. …` | Billing. |
| `This API key isn't allowed to use the chosen model. …` / `The chosen model isn't available to this API key. …` | Pick another model in Settings. |
| `The assistant has had too many requests in a short time. …` / `The assistant is overloaded right now. …` | Rate limit or overload; wait. |
| `The assistant couldn't accept that request. Try again; if it keeps happening, start a new conversation.` | A `400`. The assistant first retries with its plain request shape on its own; if it persists, `GALLEY_AI_PROFILE=plain` pins that shape. Please report it. |
| `Couldn't reach the assistant. Check this computer's internet connection, then try again.` | Network, or a `GALLEY_ANTHROPIC_BASE_URL` that doesn't answer. Note `ANTHROPIC_BASE_URL` is ignored. |
| `Build mode is turned off for this site, so the assistant can change content only.` | `"ai": { "allowBuild": false }`. |
| `I'm still working on the last message. Wait for it to finish, or stop it first.` | One reply at a time per conversation. |
| `Image generation isn't set up yet. Choose an image provider in Settings.` | No provider saved — even the offline placeholder one must be chosen once. |
| `Add an OpenAI API key in Settings to generate images with OpenAI.` | |
| `That doesn't look like an Anthropic API key. They start with “sk-ant-”.` | When saving a key. |
| `This key is set by the environment the app was started from (ANTHROPIC_API_KEY), so it can't be changed here. …` | Change the variable and restart. |

## Still stuck

Open an issue with the output of `galley doctor --json` (it holds no keys; check it anyway) and what you did — [SUPPORT.md]({repository}/blob/main/SUPPORT.md).
