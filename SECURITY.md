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
- writing outside the site folder or the mode's write surface, or reading or
  serving `.git/` or `.env*` files;
- a secret (an API key, the password, the session key) reaching the browser, a
  log line or an error message;
- running code from a site in a way the trust model below doesn't already
  allow, or the assistant reaching a shell or the network;
- script running on the app's own origin through content, uploads or the
  preview.

Out of scope: a site's own code doing what its code does (see below); attacks
that need someone who can already sign in to a hosted Galley (they are trusted
— see below); denial of service by a signed-in user; the deployed sites
themselves; third-party services (Anthropic, OpenAI, Google, your git host).

## The security model, in brief

The full description is in the documentation under *Running Galley › Security
model* (`apps/site/src/content/docs/running/security.md`).

1. **Who can reach it.** Locally the server listens on `127.0.0.1` only and
   needs the random session token from the printed link. Hosted mode refuses
   to start without a password of 12 or more characters; sign-in is rate
   limited; the session cookie is signed, `HttpOnly`, `SameSite=Strict`, and
   `Secure` over HTTPS. There are no per-user roles: everyone who can sign in
   can do everything.
2. **Every request** must name the server in `Host` (against DNS rebinding);
   every state-changing request needs a same-origin `Origin` or a Bearer
   token (against cross-site requests).
3. **The write surface is closed.** Every path is contained to the site folder
   (no `..`, no symlink escape) and checked against the mode's writable globs;
   `.git/`, `node_modules/`, `.env*`, lockfiles and hidden folders are never
   written. The assistant has no shell and no network tool; the mode is
   enforced by the engine, not by the prompt.
4. **Site code is trusted like `npm run dev`.** Detection never runs a site's
   code, but the preview runs the site's own dev command (and installs its
   dependencies), build mode runs its build, and adapters a site names in its
   config are loaded. Opening a repository in Galley trusts it the way running
   it locally would. On a hosted server, the password therefore grants the
   ability to run code there: run it unprivileged and isolated.
5. **Secrets stay on the server.** Keys come from the environment or a 0600
   file in the Galley home, never cross the HTTP boundary, and are scrubbed
   from errors and logs.
6. **Nothing phones home.** Galley talks to your git host, your package
   registry, your deployed site, and — only when someone uses them and a key
   is set — Anthropic, OpenAI or Google. There is no telemetry.

## Known limitations

Stated so they aren't reported as discoveries: the desktop app's installers
are unsigned; it does not use the OS keychain yet; hosted previews are served
over plain HTTP on random ports; Windows and Linux have not been verified; the
`Dockerfile` has not been built.

## Cryptography

Galley uses Node's `crypto` for random tokens, constant-time comparison and
HMAC-SHA256 session signatures, and TLS through Node and git. It contains no
encryption of its own.
