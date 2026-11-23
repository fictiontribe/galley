# Support

Galley is new and maintained by a small team, in the open.

- **Questions and ideas**: open an issue (use the feature request form for
  ideas). Discussions may be enabled when the repository is public.
- **Bugs**: a [bug report](.github/ISSUE_TEMPLATE/bug.yml) with the output of
  `galley doctor --json` from the site's folder (it contains no keys; check it
  anyway), what you did, what you expected, and what happened.
- **A framework Galley doesn't support yet**: an
  [adapter request](.github/ISSUE_TEMPLATE/adapter.yml). Every framework beyond
  Astro arrives as an adapter; [`docs/adapters.md`](docs/adapters.md) explains
  how to write one.
- **Security**: see [SECURITY.md](SECURITY.md) — never a public issue.

Before you ask, the documentation may already answer it: the *Troubleshooting
for developers* page lists every error message a developer can hit and what it
means (`apps/site/src/content/docs/reference/troubleshooting.md`).

## What is not supported yet

- Windows and Linux: written for, not verified. Reports from either are very
  welcome.
- Node.js older than 20.11 for Galley itself (and 22.23.4 for Astro 7 sites
  and this repository's site and starter).
- Previews in hosted mode behind a reverse proxy or a fixed port mapping.
- Signed desktop builds, and automatic updates.

## Fiction Tribe

Fiction Tribe, which maintains Galley, can be reached at
https://www.fictiontribe.com/talk/ for anything that isn't an issue. There is
one edition of Galley: no feature is held back for a paid plan.
