# Security policy

## Reporting a vulnerability

Please report privately, never in a public issue:

- **GitHub private vulnerability reporting**: the repository's **Security**
  tab → **Report a vulnerability** (this opens a draft advisory only the
  maintainers can see).
- or **email** the security address listed as `securityContact` in
  [`apps/site/src/data/site.json`](apps/site/src/data/site.json). That address
  is not set up yet; until it is, use the GitHub form.

Include what you did, what happened, the version (`galley version --json`) and,
if you can, the smallest site or request that shows it. Please don't include
real API keys.

We acknowledge within **5 working days**, keep you informed, and coordinate
disclosure within **90 days** of the report (sooner when a fix is ready; longer
only by agreement with you). Credit is given in the advisory unless you prefer
otherwise.

## Supported versions

Galley has not been released yet. Once it is:

| Version | Supported |
| --- | --- |
| latest minor (0.x while pre-1.0) | yes |
| older | no; upgrade |

## In scope

The code in this repository: the engine (`packages/core`), the server
(`packages/server`), the CLI (`packages/cli`), the web UI (`packages/web`), the
preview overlay (`packages/overlay`), the adapter kit, the desktop shell
(`apps/desktop`), the `Dockerfile`, and the Astro starter. Especially:

- getting past sign-in, the session token, or the `Host` and `Origin` checks;
- a route added by a program that embeds the server (`/api/x/…`) being reached
  without its level or from another origin's page, or its handler being handed
  more than the embedding documentation says;
- writing outside the site folder or the mode's write surface, or reading or
  serving `.git/` or `.env*` files;
- a secret (an API key, a password, a one-time link's code, the session key)
  reaching the browser, a log line or an error message, other than the one
  person a link is shown to;
- a signed-in person doing what their role doesn't include, by any way in —
  a route, a file write, the assistant, an AI tool: on a hosted install,
  build mode is an editor's or owner's and the site's settings file an
  owner's;
- on a hosted install, work done for nobody — a plugin's hooks, or anything
  left running after a request — publishing, changing the site's settings
  file or writing outside the content;
- more guesses at one account's password than the sign-in limits allow
  (about 2,900 a day, from any number of addresses), or making sign-in fail
  for everyone from one address or one IPv6 `/64`;
- a one-time link built from anything but the editor's public address (or,
  without one, the loopback address of a trial on one computer), or a
  new-password link the server e-mailed reaching anyone but the person it
  is for;
- running code from a site in a way the trust model below doesn't already
  allow, or the assistant reaching a shell or the network;
- script running on the app's own origin through content, uploads or the
  preview.

Out of scope: a site's own code doing what its code does (see below); what an
embedding program's own extension code does (it is its operator's code, and
runs with the server's permissions); attacks
that need someone who can already sign in to a hosted Galley, other than
doing what their role doesn't include (the preview runs the site's code for
anyone signed in, and editors and owners can change it — see below); denial
of service by a signed-in user; the deployed sites
themselves; third-party services (Anthropic, OpenAI, Google, your git host).

## The security model, in brief

The full description is in the documentation under *Running Galley › Security
model* (`apps/site/src/content/docs/running/security.md`).

1. **Who can reach it.** Locally the server listens on `127.0.0.1` only and
   needs the random session token from the printed link. A hosted install
   looks after one site, for people with accounts: each signs in with their
   own e-mail and password (12 or more characters, stored as an scrypt hash)
   and is an owner, an editor or a contributor. Whoever opens a one-time setup
   link creates the first owner; owners invite everyone else with one-time
   links. Sign-in is limited per client (an IPv4 address or an IPv6 `/64`)
   and per e-mail from everywhere, one check at a time, with a growing
   delay; a browser that has signed in before isn't held up. Each session
   cookie belongs to one person
   and is signed, `HttpOnly`, `SameSite=Strict`, and `Secure` (`__Host-`) over
   HTTPS. One table (`packages/core/src/install/route-access.ts`) gives every
   route of the editor the level it needs, and the server checks it on every
   request. A route added by a program that embeds the server declares its
   own level, and the server doesn't start with one that has none. The
   engine also checks build mode (an editor or owner) and the site's settings
   file (an owner) where the write happens, whichever way it comes, and
   refuses both, and publishing, to work done for nobody. Links
   are only ever built from the editor's public address. The preview is
   served on a hostname of its own, only to a browser the editor let in.
2. **Every request** must name the server in `Host` (against DNS rebinding);
   every state-changing request needs a same-origin `Origin` or a Bearer
   token (against cross-site requests). A route added by an embedding
   program needs the browser's word that the request is the editor's own
   page's on every method, GET included.
3. **The write surface is closed.** Every path is contained to the site folder
   (no `..`, no symlink escape) and checked against the mode's writable globs;
   `.git/`, `node_modules/`, `.env*`, lockfiles and hidden folders are never
   written. The assistant has no shell and no network tool; the mode is
   enforced by the engine, not by the prompt.
4. **Site code is trusted like `npm run dev`.** Detection never runs a site's
   code, but the preview runs the site's own dev command (and installs its
   dependencies), build mode runs its build, and adapters a site names in its
   config are loaded. Opening a repository in Galley trusts it the way running
   it locally would. On a hosted install the preview runs that code for any
   account, whatever its role, and editors and owners can change it, so an
   account is for someone the owner would trust with the repository (roles
   keep people out of each other's way; they are not a security boundary):
   the container is the boundary (the image runs
   the server as an unprivileged user with no capabilities; see
   `docs/cloud-install.md`).
5. **Secrets stay on the server.** Keys come from the environment or a 0600
   file in the Galley home, never cross the HTTP boundary, and are scrubbed
   from errors and logs.
6. **Nothing phones home.** Galley talks to your git host, your package
   registry, your deployed site, the identity provider a hosted install's
   operator sets up (`GALLEY_OIDC_ISSUER`), and — only when someone uses them
   and a key is set — Anthropic, OpenAI or Google. There is no telemetry.

## Known limitations

Stated so they aren't reported as discoveries: the desktop app's installers
are unsigned; it does not use the OS keychain yet; on a hosted install,
the preview runs the site's code for every role, editors and owners can change
that code, and the site's own code can read what its container holds;
sign-in limits are kept in memory, so a restart resets them; while an
account is being guessed at, its right password from a browser that hasn't
signed in before may have to wait or be told to wait (a browser used before
and a one-time link go round it); the assistant reads what contributors
wrote, and in a conversation someone switched to build mode it changes code
without asking before each change (it never publishes); the hosted install has not been run on Fly.io or Cloudflare; Windows and
Linux have not been verified.

## Cryptography

Galley uses Node's `crypto` for random tokens, constant-time comparison,
HMAC-SHA256 session signatures, scrypt password hashes and — for a hosted
install's backups — scrypt key derivation and AES-256-GCM in authenticated
frames (the format is described in `packages/core/src/install/backup.ts`),
and TLS through Node and git. It implements no cipher of its own.
