# Galley + Astro on Astro's catalogs — submission kit

Everything needed to list Galley where Astro developers look: the starter on
[astro.build/themes](https://astro.build/themes/), the `@galleycms/astro` Dev
Toolbar integration on [astro.build/integrations](https://astro.build/integrations/),
and a Galley page among the [CMS guides](https://docs.astro.build/en/guides/cms/)
in Astro's docs. Work through the six steps in order; each says what to do,
what only you can do, and what has already been checked.

| File | What it is |
| --- | --- |
| `README.md` | This plan, the review checklist and what is blocked on you |
| `theme-listing.md` | Title, summary, description, categories and links to paste into the portal (`astro-starter` / Lowfield) |
| `theme-listing-ferrow.md` | Title, summary, description, categories and links to paste into the portal (`astro-saas` / Ferrow) |
| `integration-listing.md` | What the integrations catalog will show, and the avatar request |
| `cms-guide-galley.mdx`, `cms-guide-pr.md`, `galley-logo.svg` | The docs page, its pull-request text and its logo |
| `capture-screens.mjs` | Captures the listing images from the deployed demo |
| `screenshots/local-build/` | A first set, from a **local** production build — for reference only |
| `template/` | Files only a public template repository has (Pages workflow, issue templates, editor settings); `__REPOSITORY__` is filled in by the export |
| `../../scripts/export-starter.mjs` | Writes any starter's template repository tree |

Galley is independent of Astro. Everywhere in this kit it is "built for
Astro" — never "official", "partner" or "endorsed" — and Houston appears
nowhere.

---

## 1. Publish the starter repository

```sh
node scripts/export-starter.mjs --list                        # the starters and their repositories
node scripts/export-starter.mjs                               # astro-starter → /tmp/galley-astro-starter
node scripts/export-starter.mjs astro-saas                    # → /tmp/galley-astro-saas
node scripts/export-starter.mjs astro-starter ~/src/galley-astro-starter --repo fictiontribe/galley-astro-starter
```

The script exports **any** starter under `starters/` (the first argument;
default `astro-starter`) as the exact tree of its public template
repository: the starter without anything installed or built, plus
`template/` (`.github/workflows/deploy.yml`, `.github/ISSUE_TEMPLATE/`,
`.vscode/extensions.json`), plus the starter's own `starter-notice.json`
merged into `src/data/site.json` as `starterNotice` (the file itself is
left out). The vendored site kit (`src/galley/`) ships with it and is
checked against `packages/astro` first: a stale copy stops the export and
says to run `node packages/astro/scripts/vendor.mjs starters/<starter>`,
so what is published is what was built and tested. It refuses anything that
only resolves inside this monorepo (`workspace:` ranges, `packageManager`,
`pnpm` fields, install scripts), requires a `LICENSE`, `README.md` and
`.gitignore`, writes no lockfile, and prints every file, whether the README
carries the hosts' deploy buttons (`docs/deploy.md`), and the next steps.
Running it twice gives byte-identical trees (it prints a tree hash to
compare). Pointed at a previous export or a clone of the repository, it
replaces everything except `.git` and `node_modules`, so an update is a
plain commit.

A starter's repository is `fictiontribe/<package name>` —
`galley-astro-starter`, `galley-astro-saas`, … — unless `--repo` or
`STARTER_REPOSITORY` says otherwise. It is substituted in the README's
`create astro` commands, demo address and deploy buttons (the Vercel one
URL-encoded), the notice's README link and the workflow.

**Only you:** create the empty public repository, push the export, tick
*Template repository* in Settings › General, add the description and topics
(`astro`, `astro-template`, `galley`, `cms`).

**Verified (2026-11-27):** `astro-starter` exports 194 files (2.0 MB) and
`astro-saas` 264 files (1.7 MB), each byte-identical on a second run.
Copied outside the monorepo and built with plain npm in a clean environment
(`env -i PATH HOME`): `npm install` added 203 and 204 packages with no
warnings; `npm run build` built 18 and 31 pages with no warnings other than
the site kit's one line per form saying no capture address is set yet
(`src/galley/settings.json` → `forms.endpoint`). pnpm, Yarn and Bun: the
trees have no lockfile, no `workspace:` or `catalog:` ranges, no
`packageManager` field and no install scripts, and depend only on registry
packages, so each resolves them from `package.json` alone (not run here).

## 2. Deploy the demo

Recommended host: **GitHub Pages** — free, no extra account, and the
template's own workflow builds it, which is exactly what the guidelines ask
for (a deployment of the repository as a new user gets it).

**Only you:** in the template repository, Settings › Pages › Build and
deployment › Source: **GitHub Actions**. Then Actions › *Deploy to GitHub
Pages* › Run workflow (the first push ran before Pages was on). The demo
appears at https://fictiontribe.github.io/galley-astro-starter/.

The workflow runs automatically only in `fictiontribe/galley-astro-starter`;
in a copy made from the template it waits until its owner sets the
repository variable `DEPLOY_TO_GITHUB_PAGES` to `true`, so nobody gets a
failed run they didn't ask for. It takes `--site` and `--base` from
`actions/configure-pages`, so the demo's canonical links and sitemap use the
github.io address and every link carries the `/galley-astro-starter` prefix.

**Verified:** a build with `--site https://fictiontribe.github.io --base
/galley-astro-starter`, served under that sub-path, and a root build: 639
internal links, images and sitemap entries checked in each, none broken.
Every page and the journal flow clicked through in Chromium at 390 and 1440
px — no console errors, no failed or third-party requests, no horizontal
overflow. Not verified: the workflow on GitHub's runners (it needs the
repository).

## 3. Capture the screenshots

```sh
npm install --no-save playwright-core && npx playwright install chromium   # once, anywhere
node docs/astro-catalog/capture-screens.mjs https://fictiontribe.github.io/galley-astro-starter/ docs/astro-catalog/screenshots/demo
```

Six images: the home page at 1920×1080 and 1280×720, the pricing section and
a journal post at 1600×900, a phone capture (390×844 at 2×), and three
phone captures composed on a 1600×900 canvas. Add `--with-notice` to keep
the demo notice in the frame (by default the shots show the site as it looks
after a visitor hides it), and `--format jpeg` if the portal rejects large
PNGs.

What could be confirmed: listings on astro.build show gallery images at
1600×900 (16:9) and cards at 600×338; animated images are refused; uploads
fail with "Internal Error ID" when there are too many or they are too big.
What could not: the portal's exact limits on count, dimensions and size
(the form needs a GitHub sign-in). Listings seen use three to five images;
upload four (see `theme-listing.md`).

`screenshots/local-build/` holds the same set taken from a local production
build (2.6 MB). They show what to expect; the guidelines require images
from the deployed demo, so do not upload them.

## 4. Submit the theme

**Only you:** sign in at https://portal.astro.build/themes/submit with
GitHub. Submissions were paused around the Astro 6 release — check the
portal says they are open. Then paste from `theme-listing.md`: title,
summary, description (plain text), categories *Landing Page* and *Blog*,
technology *TypeScript*, price *Free*, the repository and demo links, and
the four images.

### Review checklist

| Guideline | Status |
| --- | --- |
| Runs the current major version of Astro (`package.json`) | **Pass** — `astro ^7.4.13` |
| Live public demo of the repository exactly as a new user gets it | **Owner action** — deploy (step 2); built by the repository's own workflow |
| Demo is not a production site, a marketing site or an advertisement | **Pass** — fictional studio; a template notice links to the README; no sales copy |
| No sign-up or friction; nothing broken | **Pass** locally — re-check on the deployed demo |
| Reviewer flow: pages, article → list → tags, navigation | **Pass** — every tag links to its own page; flow tested at 390 and 1440 px |
| Light/dark mode works | **Not applicable** — no toggle; a dark look (Evening) ships as an alternative tokens file |
| Promoted UI works | **Pass** — demo notice hides and stays hidden; mobile menu; tags |
| "Get started" points at the open-source repository | **Owner action** — repository must be public |
| README is the project's own and helps set it up | **Pass** — rewritten for catalog visitors |
| Description is short, plain text, English, no install steps | **Pass** — `theme-listing.md` |
| Static screenshots from the deployed demo, sensible size and number | **Owner action** — run step 3 against the demo |
| No Houston in repository, pages or images | **Pass** — `grep -ri houston` finds nothing |
| Placeholder content: `example.com` URLs and e-mails, root-domain social links, nothing real | **Pass** — e-mails `@example.com`, site `https://www.example.com`, social links without usernames, a phone number from Ofcom's range for fiction (01632 960xxx), an invented town (Wrenhallow), people, clients and suppliers |
| Not a duplicate listing | **Pass** — no Galley listing exists |

## 5. Publish `@galleycms/astro`

The integrations catalog has no form: it syncs from npm weekly. See
`integration-listing.md` for what it will show and the optional avatar.

**Only you:** own the `@galleycms` scope on npm, set the version in
`packages/astro/package.json`, run `node packages/astro/build.mjs`, then
`cd packages/astro/dist && npm publish --access public` (or let
`.github/workflows/release.yml` publish it on a version tag). Publish the Galley
repository and site first, so the homepage and repository links answer.

**Verified:** `npm pack --dry-run` ships 9 files (`src/`, README, LICENSE,
NOTICE; 12 kB). Unit tests cover the hooks, the status route and the toolbar
app; a real `astro dev` on a copy of the starter registers the app and
answers `/__galley/status` with and without a Galley server listening; and
`astro build` output is byte-identical with and without the integration.

### What the server must add: `/open`

The toolbar's **Edit this page in Galley** opens
`<galleyUrl>/open?root=<absolute project folder>&url=<pathname>` in a new
tab. Galley does not serve that yet. The integration is useful without it
(status and start command), but the button needs it.

- **`GET /open`** is a web-app route (the server's SPA fallback already
  serves `index.html` for it). It reads `root` and `url` from the query and
  calls a new endpoint:
- **`GET /api/open?root=…&url=…`** — session required, like every API route.
  - Validate: `root` is an absolute path, resolved with `realpath`, inside
    the same allowed area as `POST /api/sites/open` (the home folder locally;
    `confineSitesTo` when hosted), and looks like a site. `url` is a path
    only — starts with `/`, no scheme or host, at most 2,048 characters;
    query and fragment dropped. Invalid input → 400 with a plain message.
  - **Registered site** (a site in the registry has this real path) →
    `200 { state: "ready", siteId, entry: { path, title } | null }`, where
    `entry` is `site.entryForUrl(url)`. The page then replaces itself with
    `/sites/<siteId>/edit?path=<entry.path>` — or, with no entry for that
    URL, `/sites/<siteId>` and the note "No page here is served at /x/, so
    the site's home is open instead."
  - **Not registered** → `200 { state: "unregistered", name, root }` (name
    from detection) and **no side effect**. The page asks: "Open
    “Lowfield Studio” in Galley? Folder: /Users/…/lowfield" with **Open this
    site** (which calls the existing `POST /api/sites/open`, Origin-checked,
    then continues as above) and **Not now**. A GET must never add a site:
    any web page can send a browser to a URL.
  - **No session** → 401 as today, and the page says what to do instead of
    failing. Local mode: "This browser isn't signed in to Galley yet. Open
    the link Galley printed when it started, then press Try again." (keep
    `root` and `url` in the page's URL so Try again resumes). Hosted mode:
    go to `/login?next=<this /open URL>` and return after signing in.
    Before authentication the server says nothing about `root` — not
    whether it exists, not whether it is registered.
- The URL carries no token, deliberately: a session token must never appear
  in a link built by a page on another origin.

## 6. Open the docs pull request

`cms-guide-galley.mdx` follows the existing community stubs (Pages CMS,
Vault CMS and Sitepins), and `cms-guide-pr.md` has the pull-request title,
text and the three files it changes.

**Only you:** open it from your GitHub account once the `npx galley-cms`
command and the three linked pages work — reviewers click them.

---

## Blocked on the owner

1. **Create the public repositories** — `fictiontribe/galley-astro-starter`
   (from the export, marked as a template) and `fictiontribe/galley` (the
   integration's repository, the CMS guide's source link and the README's
   "run it from its repository" steps point there).
2. **Deploy the demo** — enable GitHub Pages (Source: GitHub Actions) on the
   template repository and run the workflow once. Config included:
   `template/.github/workflows/deploy.yml`.
3. **Publish to npm** — own the `@galley` scope (none of its packages exist
   today; whether the scope name is free could not be checked from here),
   publish `galley-cms` (the README's and CMS guide's `npx galley-cms`) and
   `@galleycms/astro`. Deploy galley.fictiontribe.com (the docs links).
4. **Sign in to the theme portal** with GitHub and **confirm theme
   submissions are open** — they were paused around the Astro 6 release.
5. **Open the docs pull request** to `withastro/docs`, after 1–3.
6. **Confirm the starter's licence** — MIT was chosen for the template
   (people copy starters into client work, where Apache-2.0's NOTICE duties
   are awkward); Galley and `@galleycms/astro` stay Apache-2.0.
