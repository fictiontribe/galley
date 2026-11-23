---
title: Hosting Galley for a team
navTitle: Hosting for a team
description: Run Galley on a server behind a password with galley serve or the container, put HTTPS in front, and know the one thing that doesn't work behind a proxy yet — the preview.
group: running
order: 2
---

This page is for whoever runs Galley on a server so several people can use it from their browsers. Hosted mode is the same server and UI as on a laptop, with a password instead of a one-time link and every site kept in one folder.

> **Status.** `galley serve` and its security checks are built and tested. The `Dockerfile` and `docker-compose.yml` are written but have **never been built**. Previews need their own ports reachable (and HTTPS on them behind an HTTPS address) — see [Previews: a known gap](#previews-a-known-gap) before you plan a deployment. Only macOS has been used to run it so far.

## Start it

Behind a reverse proxy that terminates HTTPS, listening on this computer only, with a fixed range of preview ports:

```sh
GALLEY_PASSWORD='correct-horse-battery' GALLEY_PUBLIC_URL=https://cms.example.com GALLEY_TRUST_PROXY=1 GALLEY_PREVIEW_PORTS=4410-4429 galley serve --host 127.0.0.1
```

```output
Galley is serving on 127.0.0.1 (this computer only; put a reverse proxy in front), port 4400.
Address:   https://cms.example.com
…
Previews:  each site's preview listens on 127.0.0.1 at a port in 4410-4429 (GALLEY_PREVIEW_PORTS), reached at cms.example.com
…
Press Ctrl+C to stop.
```

It then lists how sign-in, sessions, requests, the MCP endpoint and the sites folder are set up. The docs ran it on a spare port with a throwaway home.

Without a password, or with one shorter than 12 characters, it refuses to start and says why.

The password is read from the environment only, so it never appears in a process list.

| Option | Default | |
| --- | --- | --- |
| `--host <address>` | `GALLEY_HOST`, then `0.0.0.0` | The interface to listen on. `127.0.0.1` when a reverse proxy on the same machine is the only way in. |
| `-p`, `--port <port>` | `GALLEY_PORT`, then `4400` | A busy port is an error in hosted mode (no moving to the next one). |
| `--sites-dir <folder>` | `GALLEY_SITES_DIR`, then `<GALLEY_HOME>/sites` | The only folder sites can be opened from, cloned into or created in. |

Every environment variable is in [Settings, secrets and the Galley home](/docs/running/settings/#environment-variables).

## Signing in

People open the address and see a sign-in page. `POST /api/auth/login` checks the password in constant time and sets a session cookie: `HttpOnly`, `SameSite=Strict`, signed with HMAC-SHA256 using a key kept in the Galley home (`session.key`, mode 0600, so sessions survive a restart), valid for 30 days, and `Secure` when the request came over HTTPS. Five wrong passwords from one address within a minute, and that address gets `429` — *Too many sign-in attempts. Wait a minute, then try again.* — until the minute is up. Signing out revokes the session for the life of the process.

There is one shared password and no user accounts. Settings live in the server's Galley home and are shared by everyone who signs in — including App settings › You, the name and email every publish is committed as. Until there are accounts, publishes from a hosted Galley all carry the same author.

For scripts, set `GALLEY_TOKEN` (16 characters or more) and send `Authorization: Bearer <token>`.

## Behind HTTPS

Put a reverse proxy that terminates TLS in front, then tell Galley about it:

- `GALLEY_PUBLIC_URL=https://cms.example.com` — the address people use. Requests for any other `Host` are refused (*This address isn't one this app answers to.*), and state-changing requests must come from that origin. Without it, the server answers to any hostname and warns at start-up.
- `GALLEY_TRUST_PROXY=1` — honour `X-Forwarded-Proto` (so cookies are `Secure`) and `X-Forwarded-For` (so the sign-in rate limit is per client, not per proxy). Only behind a proxy you control.

A minimal [Caddy](https://caddyserver.com) site block — untested with Galley, shown for its shape:

```text
cms.example.com {
	reverse_proxy 127.0.0.1:4400
}
```

`GET /api/events` is a Server-Sent Events stream with a heartbeat every 20 seconds; a proxy that buffers responses must not buffer that path.

A `GALLEY_PUBLIC_URL` that starts with `http://` on a non-loopback host gets a warning: the password and cookie would cross the network unencrypted.

## Run it in a container

The repository's [`Dockerfile`]({repository}/blob/main/Dockerfile) builds the web UI and the single-file CLI bundle on `node:22-bookworm-slim`, and the runtime image adds `git`, `openssh-client` and `tini`, runs as the `node` user, keeps all state in `/data` (`GALLEY_HOME`), listens on `0.0.0.0:4400`, and runs `galley serve`. Its health check calls `/api/meta`. **It has not been built yet**; the commands are what it is written for:

```sh
docker build -t galley .
docker run -p 4400:4400 -e GALLEY_PASSWORD='correct-horse-battery' \
    -e GALLEY_PUBLIC_URL=https://cms.example.com -v galley-data:/data galley
```

[`docker-compose.yml`]({repository}/blob/main/docker-compose.yml) does the same with the variables read from a `.env` beside it, and passes `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `GEMINI_API_KEY` through from the shell when they are set.

Sites cloned in the container live in `/data/sites` and are pushed with the container's git credentials: mount an SSH key or a credential helper configuration for the `node` user, or the first publish to a private repository fails with *The code host didn't accept your sign-in.*

## Previews: a known gap

Each site's preview runs behind its own small proxy on a port of its own, and the editor frames it as `<scheme>://<public host>:<that port>`. Two consequences:

- **The browser must reach those ports.** Set `GALLEY_PREVIEW_PORTS` (e.g. `4410-4429`) so they are a fixed range, and publish or forward that range in your container, firewall or proxy. Without it, the ports are random and a fixed port mapping can't reach them: the preview pane stays empty.
- **On an HTTPS address, the preview ports need HTTPS too.** When `GALLEY_PUBLIC_URL` starts with `https://`, the editor frames the previews over `https://` on those ports, so your reverse proxy must terminate TLS for each of them as well (the proxies themselves speak plain HTTP).

The docs haven't run this setup behind a real reverse proxy. Until it's in place, hosted mode still works for editing in the form, the assistant, Proof's list of changes and publishing; the live preview, click to edit and Arrange need the preview ports. Serving previews through the main address is on the [roadmap]({repository}/blob/main/ROADMAP.md).

## Forms on a hosted Galley

A hosted Galley at a public `https://` address is what lets the live site's forms send to the inbox: the capture address is `https://cms.example.com/f/<siteId>` ([Forms](/docs/forms/#where-visitors-can-reach-it)). For e-mail alerts set `GALLEY_SMTP_URL` and `GALLEY_MAIL_FROM`.

## What it can reach

The server needs outbound access to your git host (clone, pull, push), the package registry (installing a site's dependencies before its first preview), the deployed site (the side-by-side view) and, when keys are set, the AI providers. Nothing else, and nothing to Fiction Tribe. Details in the [security model](/docs/running/security/#what-leaves-the-machine).

## Next

- [Security model](/docs/running/security/).
- [White-label](/docs/configuration/white-label/) — rename and recolour it for your team.
