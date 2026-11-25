# Claims on the site, and what supports them

For the reviewer. Every statement on the site must be supportable from
`docs/ARCHITECTURE.md`, the code, or a check someone ran. All copy lives in
`src/content/pages/*.md` and `src/data/*.json`; fix it there.

**Statuses come from one file.** `src/data/status.json` is the only place the
site states whether something is built, in preview, new (in final checks), in
progress or later. The "What's in 0.1.0" grid on the home page, the status
badges on `/wordpress/` steps, `/starters/` and `/ai-first/`, and the agent
files all render from it. Flip a status there and every page follows; keep
the table below in step.

Updated 2026-11-25 (themes for the editing app: `themes` added, with four statements under “Other statements”). Before that, 2026-11-24 (accounts and roles on a hosted editor: `hosted-accounts` and `hosted-sso` added, `hosted-install`'s line and the ROADMAP “Later” row changed; the README, ROADMAP and npm READMEs rewritten; Galley on npm; “for static sites” instead of “for Astro”). Before that, 2026-11-23 (rebuild of the site).

## The status table (src/data/status.json)

| Feature | Status on the site | Support |
| --- | --- | --- |
| Edit three ways (form, on the page, ask the assistant) | Built | Captures `form`, `click`, `assistant` (real reply, one assistant request), `screens.json` |
| Proof (marked up beside the live site; Put back) | Built | Captures `proof-changes`, `proof-source`; the quickstart walk-through 2026-11-23 |
| Publish = a commit or pull request; undo is a new commit | Built | Real publish on a throwaway Caddow copy: `git log` / `git show --stat` output on the home page is that commit's |
| Page builder (the site's own sections) | Preview | Recording `arrange-drag.webm`, capture `arrange` |
| Forms + form builder (HubSpot, Marketo, Salesforce, Pardot, webhooks, Galley's inbox) | Built | maintainers' check; `docs/forms.md` |
| Third-party scripts with consent | Built | maintainers' check; `docs/scripts.md` |
| Plugins, incl. image and video generation | Built | maintainers' check; `docs/plugins.md` |
| One-click deploy to Cloudflare | Built ("verified on the real service, redirects file included") | maintainers' check |
| One-click deploy to Vercel | In progress ("built; not yet verified on the real service") | maintainers' check |
| Media in a bucket (Cloudflare R2, Amazon S3), and pictures in Cloudflare Images | In progress ("built; not yet verified on the real services") | `packages/core/test/media-storage/` against strict stand-ins (S3 signatures verified for real, the services' error codes; the Images stand-in marks which answer shapes are from Cloudflare's docs and which are assumed); Images prices quoted from Cloudflare's pricing page on 2026-11-24; the SigV4 signer against AWS's published vectors (botocore's copy of the suite and the S3 examples page, 2026-11-24); `docs/media-storage.md`. Not run against R2 or S3: `scripts/rehearse-media-storage.mjs` is for that |
| Many sites in one app (agencies) | Built | maintainers' check; `docs/multi-site.md` |
| Desktop app (macOS) and web app | Built | maintainers' check |
| MCP | Built | `docs/mcp.md`, `galley mcp` |
| Three starters, three looks each | Built | `starters/*/starter.json`, previews; the site reads them at build time |
| Redirects | Built | Run by hand in a browser on 2026-11-24 on a fresh Caddow site: a pasted list with a planted loop, duplicate, missing page and unreadable line was reviewed correctly, the list and `public/_redirects` were written, “Try an address” answered correctly, and the changes waited in Proof. Also used by this site (below). Setting them on Cloudflare itself (Bulk Redirects) has not been run on the real service. |
| Per-site brand setup | Built | Run by hand in a browser on 2026-11-24 on a fresh Caddow site, with the assistant: read from the site (colours, type, contrast, a voice guide quoting the site) and saved as `galley/brand/`; and set up from a guidelines PDF, a screenshot and a note (proposal citing the PDF's pages). `docs/brand.md` |
| Search and AI checks | Built | Run by hand in a browser on 2026-11-24 on a fresh Caddow site: findings by category, a fix that corrected a page's broken link, and an AI-crawler block written to `src/data/visibility.json` as a pending change. `docs/seo-and-ai-visibility.md` |
| Guided move from WordPress in the app | New, in final checks | Captured 2026-11-23 (`wordpress-plan`, `wordpress-report`) importing the importer's invented WordPress site into a throwaway Lowfield copy; changed from "in progress" on the maintainers's word |
| Agent-readable pages for customer sites | Built (Astro sites with the site kit) | A Caddow starter site built on 2026-11-24 (`astro build`): 19 markdown copies for 20 pages, each page linking to its copy (`<link rel="alternate" type="text/markdown">`), plus `llms.txt`, `llms-full.txt` and `agent.md`. Sites without the kit get none of this. |
| Shopify storefront starter (`storefront`, “Caddow Shop” on /starters/) | In progress (badge on its card) | `starters/astro-storefront` with its own previews and 24 sections; listed as the fourth card. Flip `shopify` in status.json to `new` when it reaches final checks |
| A switch per AI crawler | Built (Astro sites with the site kit) | In the app on 2026-11-24: choosing Block for a crawler and confirming wrote `crawlers` into `src/data/visibility.json` as a pending change. A Caddow starter site built with GPTBot and ClaudeBot blocked wrote `robots.txt` with `Disallow: /` for each, by name. Whether a crawler obeys is up to the crawler; the page says so. |
| A hosted editor, one per site (`hosted-install`) | New, in final checks | Line: “One site, its own state, its own people”. Not in a release yet (the `cloud-install` work; `docs/cloud-install.md` § “What has been run”). Run for real on 2026-11-24, before accounts, with one shared password: on the real image on a Mac with Docker (two installs side by side refusing each other's cookie, password and capture key; first run, preview, click-to-edit, Arrange, Proof, Publish, restart, sealed backup → wipe → restore, a starter's form into the inbox), and on a small Google Cloud VM (the image built from source, this project's own website's editor behind Caddy with three certificates, a site in a folder of its repository, an upgrade in place twice, the operator's backup, restore and reset commands). Not verified: a deploy key accepted by GitHub, GitLab or Bitbucket end to end; `scripts/create-install.sh` beyond its dry run; the image is not on a registry. Flip to Built when it is released and the image is published |
| Accounts and roles on a hosted editor (`hosted-accounts`, not on the home page) | New, in final checks | Built and tested: `packages/core/src/install/people.ts`, `route-access.ts` (every route has one level; `server/test/accounts-access.test.ts` asks every route as every role), the web app's People, Your account and link pages. `scripts/rehearse-accounts.mjs` runs the real server and walks first run, invitations, roles, links, the site's settings file by every route, an editor without its public address, and the upgrade from one password over HTTP, 17 steps (`docs/cloud-install.md` § “What has been run”). Build mode and the settings file by role are held in the engine (`core/src/install/caller.ts`; `core/test/install/caller-access.test.ts`, `core/test/ai/tools-access.test.ts`). Driven in a real browser on 2026-11-24 (two browsers against the real server: first run, signing in, People, an invitation, joining from its link, a contributor's screens and switching someone off). Not tried: a real mail server, the new-password and forgotten-password pages in a browser, Change e-mail… and a contributor's build-mode lines in a browser, a link running out of time over HTTP, the rate limits end to end. The line says “Tested, and tried in a real browser; not yet with real e-mail”. Flip to Built with `hosted-install` |
| Themes for the editing app (`themes`, not on the home page) | New, in final checks | Line: “Quiet, Plate and Desk, and themes you make, checked for readability and shared as a file. Tried in a real browser against the app’s stand-in server.” Built and tested on branch `themes`: `packages/core/src/themes/` (the contract, `checkTheme`, the store; `core/test/themes/`), the routes (`server/test/themes.test.ts`), `galley theme` (`cli/test/theme.test.ts`), the plugin contribution (`core/test/themes/plugin.test.ts`). The engine's derivations were compared with what Chromium paints from `brand/tokens.css` for Quiet, Plate, Desk, Fog, Lemon, Harbour and a theme that tunes people colours, light and dark (`web/test/themes/parity.browser.test.ts`, run 2026-11-25 with playwright-core 1.62: 14 of 14). Driven in a real browser on 2026-11-25 against the mock server (local and hosted): each built-in chosen in light and dark, a theme made from Plate with the paper and pencil changed (the app re-themed live), an adjustment reported for a deliberately poor paper, saved, shown before the app's own script ran after a reload, exported, deleted, imported back; the sign-in screen of a fresh browser carrying the default theme; a contributor saving one for themselves. Not run against the real server in a browser, nor in the desktop app. Flip to Built when it is released |
| Single sign-on for a hosted editor (`hosted-sso`, not on the home page) | Later | ROADMAP “Later”. Nothing built; today sign-in is an e-mail and a password |
| Host the editor online (`editor-online`) | In progress | Not in a release yet. Run on 2026-11-24 from the real app in a real browser against strict stand-ins for Fly.io and Cloudflare, with the stand-in's machine started as a real install (plan and cost before anything, no creating call before the yes, 8 + 3 creating calls after it, removal exactly what was created). Never run on Fly.io or with a real Cloudflare tunnel; prices are estimates read 2026-11-23 (the Fly.io 2 GB figure is derived). Flip to New when a real run on Fly.io or Cloudflare has been done |
| Galley Cloud | Later (`/cloud/`, "Coming soon", no date or price) | The Cloud plan is kept outside this repository |

## Other statements

| Statement | Where | Support |
| --- | --- | --- |
| Version 0.2.0, Apache-2.0, on npm as `galley-cms` (and `create-galley`); the site no longer calls it “pre-release” | everywhere (`site.json` → `statusNote`, docs index, FAQ, agent.md, `visibility.json` summary → llms.txt) | `packages/core/src/brand.ts` (the version is read from it), `LICENSE`; `npm view galley-cms` and `npm view create-galley`: 0.1.0 published 2026-11-23, 0.1.1, 0.1.2, 0.1.3 and 0.2.0 on 2026-11-24 |
| The install commands: `npm create galley@latest`, `npm create galley@latest my-site -- --starter caddow`, `npx galley-cms` | home hero (the command `npm create galley@latest`, and the note “Already have a site? Run npx galley-cms in its folder.”) and close (`npx galley-cms`), quickstart, new site, docs index, agent.md, README, `packages/cli/README.md`, the starters' READMEs | Run from the registry in a clean folder on 2026-11-24: `npm create galley@latest my-site -- --starter caddow --no-install --no-start` (site made, first version recorded), then `npx galley-cms --no-open` in it (the app opened in a browser with no errors). The interactive form, `npm create galley@latest` with no arguments, was not test-run from the registry; it is the same program asking for the name and starter. The docs re-ran them on 2026-11-24 with a throwaway `HOME` and `GALLEY_HOME`: `npm create galley@latest my-site -- --starter caddow --no-install --no-start` and `… t2 -- --starter lowfield --look sage --no-install --no-start` (copied, first version recorded, the “To start Galley on it” hint), then `npx galley-cms --no-open` in that site (printed `Galley is running at http://127.0.0.1:4400` and an `Open:` link), `npx galley-cms doctor`, `starters`, `init`. Not run by the docs: an install (`--no-install` every time, disk), and the `pnpm create` / `yarn create` / `bun create` forms (new-site says so) |
| Running Galley from a clone is for changing Galley itself | quickstart (last line), README, CONTRIBUTING.md | `CONTRIBUTING.md` “Dev setup”; the from-a-clone steps stay in `site.json` → `install.fromClone` but no page shows them while `install.published` is true |
| “The open-source AI CMS for static sites” (not “for Astro”) | home title and description, `site.json` → `descriptor`/`description`, `visibility.json` summary (llms.txt), docs index, README, `packages/cli` and `packages/create-galley` descriptions and READMEs | Galley reads and edits any site whose content is files in git: `packages/core/src/adapters/` (astro, conventions, generic) |
| “Astro fits deepest; it also recognises Docusaurus, Nuxt, Next.js, SvelteKit, Eleventy, Hugo and Jekyll — or teach it yours” | home “It’s just your repo” (first point, links to /docs/adapters/), docs index, quickstart, FAQ, README | `packages/core/src/adapters/astro/` reads Astro's own config; `packages/core/src/adapters/conventions/` holds the seven convention adapters (where content usually lives, how the site is usually run); `generic/` is the markdown fallback; /docs/adapters/ has the table. The site kit and all four starters are Astro; nothing claims the kit, starters or config-reading for the others |
| MCP works from the npm package: `npx galley-cms mcp config …`, then the `npx -y galley-cms mcp …` form it prints | /docs/integrations/mcp/ (`docs/mcp.md`), agent.md, README status | Ran 2026-11-24 from the published 0.1.0 on a throwaway Caddow copy: `npx -y galley-cms mcp ./my-site` answered `initialize`, listed 28 tools (the five `shopify_*` among them) and returned the site card for `get_site`; `mcp config --client claude-code` printed both forms (see “Known problems”) |
| The plugins are built into `galley-cms`, not separate packages | README status | `npx galley-cms plugin list` from the published 0.1.0 (2026-11-24): `@galley/builtin`, `@galley/plugin-openrouter`, `@galley/plugin-shopify`, `@galley/import-wordpress`, each “on, built in”. The tarball's file list (1,050 files: `bin/galley.js`, `dist/galley.mjs`, `dist/web/`, `dist/starters/`, `dist/overlay.js`, README, LICENSE, NOTICE) has no separate plugin files; `packages/server/src/plugins.ts` imports them statically |
| Not on npm: `@galley/astro` (vendored), `@galley/adapter-kit`, `@galley/plugin-kit`, the plugins as packages | site kit, adapters, plugins pages, README | Their `package.json` files are `"private": true`; RELEASING.md |
| `galley domain` (and `galley deploy --domain`) is new in 0.1.1; taking over an address that already pointed at the site is the only part run on a real service | /docs/running/deploy/ “Your own domain”, /docs/reference/cli/ notes | `galley domain apps/site galley.fictiontribe.com --yes --json` against Cloudflare on 2026-11-24 answered “galley.fictiontribe.com answers” and recorded `deploy.domain` with `attached: false` in `apps/site/galley.config.json`. Attaching a fresh address and the Vercel path: `packages/core/test/deploy/domains.test.ts` against stand-ins only. 0.1.0 has no `domain` command. |
| “The app sends nothing itself” when sharing a theme with the community; there is no Galley account | /docs/editing/themes/, `docs/themes.md`, the Share dialog | The dialog opens `https://github.com/fictiontribe/galley/new/main/themes?filename=…&value=…` in a new tab with a link (`communityShareUrl`, `core/test/themes/store.test.ts`). In the browser run of 2026-11-25 the page made no request outside its own origin from opening the dialog to the new tab opening |
| “Browse community themes” works with no network | /docs/editing/themes/, `themes/README.md` | `packages/web/src/lib/themes/catalog.ts` reads `themes/*.json` with `import.meta.glob` when the app is built; nothing is fetched at run time |
| A theme that would be refused or adjusted can't be merged into `themes/` or `brand/themes/` | `themes/README.md`, `docs/themes.md` | `packages/core/test/themes/check.test.ts` (“every theme file in the repository passes the check”) |
| Themes change the app only, never a site | /docs/editing/themes/, `docs/themes.md` | Saved themes are written to `<home>/themes/` (`core/src/themes/store.ts`); a theme is applied by `<html>` attributes and custom properties in the app (`core/src/themes/apply.ts`); no route or tool writes a theme into a site |
| "Galley adds nothing to your build" / no dependency or integration needed | home, /astro/ | ARCHITECTURE; the starters run without the kit's integration. (This site *chooses* to use the kit, for its agent files.) |
| In `astro dev`, the site kit's toolbar app opens the page in Galley | /astro/ | `packages/astro` README ("Dev Toolbar app"); the kit is not on npm (vendored) |
| This site's agent files (twins of every page incl. docs, llms.txt, llms-full.txt, robots.txt, sitemap.xml) | /ai-first/ | Written by the vendored site kit at build time (`src/galley/`, `src/data/visibility.json`); `/agent.md` is this site's own (`src/content/pages/agent.md`) |
| No cookies, no analytics, nothing from another origin | footer, /privacy/ | Checked in the technical pass: every request goes to the site's own origin |
| Starter photographs are AI-generated; Caddow, Ferrow and Lowfield are made up | footer, /starters/, /privacy/ | `starters/astro-editorial` shoot brief |
| /team/: James Rice (CEO, Co-founder), Misha Petrov, Sean Burles, Connor Burgess (each "Engineer"), their photographs and one line each | /team/, footer, /open-source/ "Who makes it" | From Fiction Tribe's public team page (photographs and lines verbatim, files in `public/team/` at their natural 999 × 740 with a 500 px copy), titles as the owner specified ("Engineer" for the three developers). Alt text is the name only. No bios, social links, e-mail addresses or Person structured data |
| Fiction Tribe is "a creative agency in Portland, Oregon" | /team/, /open-source/ | Fiction Tribe's own site says Portland (coordinator, 2026-11-23). No founding year is stated |
| "Built for Astro" — never official, partner or endorsed | /astro/, /privacy/ | Trademark notes on /privacy/ and /astro/; WordPress/Elementor note under the comparison table |

## The tour (/tour/), the how-to guides (/how-to/) and the home filmstrip

Added 2026-11-24. Words in `src/content/pages/tour.md`, `src/content/pages/how-to.md`
and the `filmstrip` section of `src/content/pages/index.md`; the how-to steps
are `src/data/howto.json` (written with the captures, checked by the capture
engineer). Every status badge on the tour comes from `status.json`. Each
caption was written against the matching guide in `docs/editing/`.

| Statement | Where | Support |
| --- | --- | --- |
| “Every picture here is a capture of Galley, most of them on Caddow — a fashion label we made up.” | /tour/ hero | `screens.json` (captures of a throwaway Caddow copy; the WordPress move on a throwaway Lowfield copy); footer note on the starters |
| “Three ways in. Each ends the same way, as a change waiting in Proof.” | /tour/ part 1 | `docs/editing/form.md`, `on-the-page.md`, `assistant.md` |
| Form: every field in the site’s own words, beside the page; saved as you type and marked Edited | /tour/ “In the form” | `docs/editing/form.md` “Change a field”; capture `form` (its Campaign hero section shown again as a detail) |
| On the page: click and type over the words; when the same words come from two places it asks which one you meant | /tour/ “On the page” | `docs/editing/on-the-page.md` (“Which one did you mean?”) |
| The assistant says exactly what it changed, and Undo puts it back | /tour/ “By asking” | `docs/editing/assistant.md` (reply quotes the new words; **Undo this change**); capture `assistant` |
| “Nothing is live until someone presses Publish, and a publish can be undone.” | /tour/ part 2 | `docs/editing/proof-and-publish.md`, `history.md` (not “every publish”: the guide lists versions that can’t be undone automatically) |
| Proof: every change waiting in the site’s own words, old struck out, new written in; Put back any one | /tour/ “Proof” | `docs/editing/proof-and-publish.md`; capture `proof-changes` |
| Publish: a one-line note for version history, a list of what goes, untick to keep back | /tour/ “Publish” | `docs/editing/proof-and-publish.md` “Publish”; capture `publish` |
| Version history: newest first, who and when; undoing adds a new version, nothing erased | /tour/ “Version history” | `docs/editing/history.md`; capture `history` |
| Arrange: drag a section from the panel, move it, switch options; every move offers Undo and waits in Proof (badge: Preview) | /tour/ “Arrange” | `docs/editing/page-builder.md`; recording `arrange-drag` |
| Forms send to HubSpot, Marketo, Salesforce, Pardot, a webhook or the app’s own inbox | /tour/ “Forms and the inbox” | `docs/editing/forms.md` “Choose where submissions go” (the guide notes the docs haven’t sent to a real CRM; the status table’s “maintainers’ check” covers it); captures `forms`, `inbox` (a test submission) |
| Scripts: Google Analytics, Tag Manager and others from a list; with the built-in banner each loads only after the visitor agrees | /tour/ “Scripts, with consent” | `docs/editing/scripts.md` “Ask visitors first”; capture `scripts` (Built-in banner chosen) |
| Media: upload pictures, video and documents, or make an image from a description and save it to media | /tour/ “Images and video” | `docs/editing/media.md` (without an image service the pictures are built-in placeholders; the tour doesn’t claim a real image service); capture `media` |
| Redirects: paste a list; loops, chains and doubles caught before anything is added; the host’s file stays in step | /tour/ “Redirects” | `docs/editing/redirects.md`; the hand run of 2026-11-24 in the status table; captures `redirects-review`, `redirects-try` |
| Brand: read from the site or from guidelines, logos and screenshots; colours, type, logo and voice, each saying where it came from | /tour/ “The brand” | `docs/editing/brand.md` (the voice needs the assistant’s key); captures `brand-proposal`, `brand-voice` (a voice guide written by the assistant, “Reading it cost about $0.27”), `brand-type` on the home filmstrip |
| Search & AI: titles, headings, images, links, indexing and structured data checked; certain fixes land in Proof | /tour/ “Search and AI checks” | `docs/editing/search-and-ai.md`; the per-crawler switch (built, see its own row) is not mentioned on the tour, and `search-ai-crawlers` is not used; capture `search-ai` |
| Put it online: a real address on Cloudflare in four steps, even for a site only on your computer; then your own domain, which Cloudflare answers with the site | /tour/ “Put it online”, /how-to/put-online/ | `docs/editing/online.md`; status `deploy-cloudflare` (built); captures `online-domain` (Use your own domain: “Cloudflare will answer www.caddow.example with this site and set up its certificate”) and `online-live`. **Pictured against a stand-in for Cloudflare with made-up addresses** (`caddow.example-studio.workers.dev`, `www.caddow.example`); the tour item and the how-to say so in one line. Attaching a fresh domain has been run against stand-ins only (see `galley domain` below). Changed 2026-11-24 from “your own domain is added at the host”, which the app’s own Use your own domain step replaced. Vercel (in progress) is not mentioned on the tour |
| Many sites: one list, filed by client, each card saying what it waits on — changes, unread submissions, versions not yet live | /tour/ “Many sites, one app” | `docs/editing/many-sites.md` “See what each is waiting on”; captures `sites` (two groups: Caddow Ltd and Fernhill Garden Studio), `site-home` (Waiting to publish) |
| The editor, online: edit from any browser; the app puts an editor on your own Fly.io account, Cloudflare in front of a computer of yours, or a server with Docker, and shows what it will create and its monthly cost before anything exists (badge: In progress) | /tour/ “The editor, online” (added 2026-11-24, 0.2.0) | `status.json` → `editor-online` (progress); `docs/editing/editor-online.md` (the three hosts, the plan and cost before the yes, nothing created without it); `docs/cloud-install.md` “Host the editor online”. Captures `editor-online-plan`, `editor-online`. **Pictured against a stand-in for Fly.io with made-up addresses; nothing was created** — the item says so in one line. Not yet run against Fly.io or Cloudflare themselves |
| One editor per site, on your own server: the same app on a server, for one site, with an account for each person who edits it, everything in one folder; runs with Docker; Fiction Tribe hosts nothing (badge: New, in final checks) | /tour/ “One editor per site, on your own server” (changed 2026-11-24: “behind its own password” became “with an account for each person”; the old sign-in picture, which showed the shared password, is no longer used) | `status.json` → `hosted-install` (new), `hosted-accounts` (new); `CHANGELOG.md` › Unreleased; `docs/running/hosted.md` “People and roles”; captures `hosted-first-run` |
| People and roles: owners invite with a one-time link, as owner, editor or contributor; contributors change content and see Proof; editors and owners publish; each publish carries its author’s name (badge from `hosted-accounts`) | /tour/ “People and roles” — **renders only once `public/screens/people.webp` exists and its alt is written in tour.md** (inset `invite.webp` likewise) | `CHANGELOG.md` › Unreleased › Added; `docs/running/hosted.md` “People and roles”, “Invitations and one-time links” |
| Host the editor online includes Google Cloud | /tour/ “The editor, online” caption (status stays `editor-online`, In progress) | `CHANGELOG.md` › Unreleased (“Run only against a stand-in for Google’s APIs so far”); `docs/editing/editor-online.md` |
| “The whole app comes in light and dark. One click at the foot of the sidebar switches it.” | /tour/ “Light or dark” — **renders only once `public/screens/dark-editor.webp` exists and its alt is written** | `CHANGELOG.md` › Unreleased (“A light and dark switch on every screen. One click at the foot of the sidebar … goes light ↔ dark”); commit b305592 |
| “Until Cloud opens, you can run the editor online yourself … one install per site, with an account for each person who edits it.” | /cloud/ close | as the hosted rows above; Galley Cloud stays `later` |
| WordPress: posts, pages, images and search details in four steps, as changes checked before anything goes live (badge: New, in final checks) | /tour/ “Move from WordPress” | `docs/editing/wordpress.md`; captures `wordpress-where`, `wordpress-report` (tour), `wordpress-plan` (/wordpress/). **Pictured with a stand-in WordPress site on the same computer** (`http://127.0.0.1:4792`); the tour item and /how-to/move-from-wordpress/ say so in one line |
| “Run this in your site’s folder and Galley opens in your browser.” | /tour/ close | docs index “The quickest way in”; the install row above |
| “Forms and their inbox, scripts with consent, redirects, the brand, search checks and every site you look after — all in the same app.” | home, “The rest of the app.” | the rows above |
| How-to steps (`do`, `see`) | /how-to/<slug>/ (14 guides) | Each guide’s own run in `src/data/howto.json` (“captured”: 2026-11-24, Galley 0.1.2), and its `guide` in the docs. /how-to/search-and-ai/ steps 4–5 show the per-crawler Allow/Block switch (`crawlers` in `status.json`, built); the how-to pages carry no badges |

**Known differences, not changed here.** `docs/editing/brand.md`,
`redirects.md` and `search-and-ai.md` still say “Status: new, in final
checks”, while `status.json` (and so the tour) says Built for `brand`,
`redirects` and `checks`. One of the two should move.

## The repository's front pages (README.md, ROADMAP.md, the npm READMEs)

Added 2026-11-24, when the README was rewritten and ROADMAP.md replaced the
pre-release list. These files are not on the site, but they say the same
things, so they answer to the same rules: statuses from `status.json`, no
version number in prose (the npm badge carries it), no client names.
`check-docs` reads `README.md`, `ROADMAP.md` and `packages/cli/README.md`;
`packages/create-galley/README.md` is checked by hand.

| Statement | Where | Support |
| --- | --- | --- |
| Badges: npm versions of `galley-cms` and `create-galley`, CI on `main`, the release workflow, licence, Node.js version, last commit, “PRs welcome” | README top (two rows); `packages/cli/README.md` (npm, CI, licence, Node); `packages/create-galley/README.md` (npm, CI, licence) | Every badge is read live from img.shields.io, nothing typed in: `npm/v/<package>`, `github/actions/workflow/status/fictiontribe/galley/{ci,release}.yml`, `github/license/…`, `node/v/galley-cms`, `github/last-commit/…`; each returned a real value on 2026-11-24. No downloads badge yet: npm's download counts answer “package not found or too new” for a package this young. |
| Pictures: `form` (top of the README and the cli README), `assistant`, `proof-changes`, `arrange`, `site-home` (README gallery; `site-home` also in the create-galley README) | README, npm READMEs | The captures in `public/screens/` (see the tour rows above); the npm READMEs load them from `raw.githubusercontent.com/fictiontribe/galley/main/…`, so they show what `main` holds |
| “No database, no account, no telemetry.” | README intro | /docs/running/security/ (“no telemetry and no account”), /privacy/, `docs/ARCHITECTURE.md` (the working tree is the draft; no database) |
| “One field changed, one value changed. Comments, quoting, key order and the markdown body stay exactly as they were.” | README “What it does” | /docs/concepts/surgical-edits/ (a scalar is spliced at its byte range; the worked example keeps quotes, comment, key order and body byte-identical); the home page's “One field changed, one value changed” |
| The `diff` of one heading on the Lowfield Studio starter | README “How it works” | The heading is `starters/astro-starter/src/content/pages/index.md` line 7, “Make more of the *home you already have*.”; a one-word edit through the form gives that one-line diff (surgical edits, above) |
| Status markers in “What it does”: page builder *Preview*; Vercel and the Shopify storefront *in progress*; the move from WordPress *New, in final checks*; everything else built | README | `status.json` (`builder`, `deploy-vercel`, `shopify`, `wordpress-guided`; every other item `built`). Flip a status there and change the README with it |
| Many sites: filed by client, your brand on the app, client changes as pull requests | README | `status.json` `agencies`; /docs/editing/many-sites/ (groups); /docs/configuration/white-label/ (name, colour and logo from `/api/meta`) |
| “a plugin can be one file” | README | /docs/plugins/ (“how to write one in a single file”); `examples/plugin-example` |
| “The documentation checks itself against the code on every build” | README “Documentation” | `apps/site/package.json` `build` runs `scripts/check-docs.mjs` first; CI runs the site build |
| Works with: Astro fits deepest; seven frameworks by convention; anything else through an adapter; never “official”, “partner” or “endorsed” | README | The row “Astro fits deepest…” under Other statements; the credits line says Galley is not affiliated with or endorsed by Astro, WordPress or the other names' owners |
| ROADMAP “Shipped so far”: 0.1.0 (2026-11-23, first on npm); 0.1.1 own domain and npm-first docs; 0.1.2 redirects not read as links, brand and WordPress fixes; the tour and twelve how-to guides | ROADMAP.md | CHANGELOG.md; `npm view galley-cms time` (0.1.0 published 2026-11-23); `src/data/howto.json` (12 guides). 0.1.1 and 0.1.2 are listed without dates: the changelog says 2026-11-24, npm's UTC times say 2026-11-23 |
| ROADMAP “Now”: the guided move from WordPress in final checks | ROADMAP.md, README | `status.json` `wordpress-guided` (`new`). The interface fixes shipped as 0.1.3 (`CHANGELOG.md`) and are listed under “Shipped so far”. |
| ROADMAP “Next”: Vercel, Bulk Redirects and a fresh own domain run on the real services; the Shopify storefront starter; the editor hosted on your own server, one site per install; a signed desktop app and Windows and Linux; the kits on npm; the starters in Astro's catalogue; full adapters beyond Astro | ROADMAP.md (all), README (all but the catalogue) | `status.json` `deploy-vercel`, `shopify` (`progress`); the rows on redirects and `galley domain` above (Bulk Redirects and attaching a fresh domain run against stand-ins only); the `cloud-install` branch on GitHub (commit “Hosted editor: one site per install…”), not in a release; SUPPORT.md (Windows and Linux not verified, no signed builds); the kits' `"private": true`; `docs/astro-catalog/` (the submission kit; the listing needs the owner's sign-in); `packages/core/src/adapters/conventions/` (the convention adapters). Nothing in “Next” has a date |
| ROADMAP “Later”: single sign-on for hosted installs; Galley Cloud, no date or price | ROADMAP.md, README | /docs/running/hosted/ (each person signs in with their own e-mail and password; nothing about single sign-on is built); `status.json` `hosted-sso` and `cloud` (`later`) |
| “It runs on your computer.” | `packages/cli/README.md` | `npx galley-cms` listens on `127.0.0.1` (the install row above). The assistant and image services are called only with the person's own keys (/docs/running/security/) |
| `pnpm create galley`, `yarn create galley` and `bun create galley` work the same way | `packages/create-galley/README.md` | Carried over from the previous README; not run by the docs (see the install row above) |

## Apps (/apps/, formerly /download/) and the home desktop section

Updated 2026-11-24. Words in `src/content/pages/apps.md` and the `desktop`
section of `src/content/pages/index.md`; everything about the installers comes
from `src/data/downloads.json`, which is **off** (`available: false`): /apps/
is in the header and footer and indexed, its desktop part says the installers
are being published and lists the four systems as coming, and the browser and
server ways to run Galley work as shown. No download button appears anywhere
until the file is switched on. `/download/` redirects (301) to `/apps/`
through `src/data/redirects.json`. `status.json` → `apps` is unchanged.

| Statement | Where | Support |
| --- | --- | --- |
| “The same app, in its own window, for every site you look after.” | /apps/, home desktop section | `docs/running/desktop.md` (a native shell around the same server and web UI); `docs/multi-site.md` “Sites in their own windows (desktop app)” |
| The same editor: the form, the page, the assistant, Proof and Publish — the app runs exactly what runs in the browser, and stops it when you quit | /apps/ | `docs/running/desktop.md` (same server and web UI; quitting stops the server and its previews) |
| Every site in a window of its own; the app reopens them where you left them | /apps/ | `docs/multi-site.md`: “Open in a new window”, “Windows are remembered: the site windows open when you quit reopen next time, at their size and position” |
| Your sites stay folders on your computer, with their own files and version history, as without the app | /apps/ | `docs/multi-site.md` (each site in its own folder, with its own version history); the app shares the Galley home with the CLI (`docs/running/desktop.md`) |
| Size, oldest system, file names, version, which platforms are available | /apps/ (when on), home (when on) | `downloads.json`, filled in from the builder’s report. `requires` for both Macs is “macOS 11 or later” from `apps/desktop/src-tauri/tauri.conf.json` (`minimumSystemVersion: 11.0`); Windows and Linux are left empty until the builder says |
| The app icon | /apps/, home | `brand/logo/app-icon.svg`, the source of `apps/desktop/src-tauri/icons/` |
| “The installers are being published. They’ll be here for:” and the four systems marked Coming | /apps/ while off | `docs/running/desktop.md` Status (“There are no published downloads yet: the installers are attached to a release from the next version on”); `.github/workflows/desktop.yml` builds macOS (Apple silicon, Intel), Windows and Linux |
| “{signature}, so it opens like any other app.” — for the Macs “Signed and notarised by Apple” | /apps/ “How to open it” (when on and `signed: true`) | `CHANGELOG.md` › Unreleased › Changed (“The macOS desktop app is signed and notarised by Apple. It opens like any other downloaded app, on Apple silicon and Intel”); `docs/running/desktop.md` Status; verified on the real build by the coordinator |
| “Not signed yet, so Windows warns you the first time. These steps open it anyway.” and “not signed yet” beside Windows | /apps/ (when on and `signed: false`) | `CHANGELOG.md` › Unreleased (Windows and Linux installers “unsigned”); `docs/running/desktop.md` Status. No warning line for Linux (`system` empty): an AppImage has nothing to get past |
| The desktop app is for Mac, Windows and Linux | home desktop section, tour “On your desktop” | `.github/workflows/desktop.yml` (all four built on every release); `CHANGELOG.md` › Unreleased. Windows and Linux: built and walked through a site in CI; “No person has used it on Windows or Linux yet” — the site says nothing about how well they run |
| “The Mac app is signed and notarised by Apple, so it opens like any other app.” | tour “On your desktop” | as above |
| In your browser: run `npx galley-cms` in your site’s folder; it starts on your computer, opens in your browser, quitting stops it | /apps/ “Other ways to run it” | the install row above; `docs/getting-started/quickstart.md` |
| On your own server: one editor per site, an account for each person — owners, editors and contributors — each publish under its author’s name; runs with Docker; Fiction Tribe hosts nothing (badge from `hosted-install`) | /apps/ “Other ways to run it”, tour “One editor per site” | `CHANGELOG.md` › Unreleased › Added (accounts and roles; “Each publish carries its author”); `status.json` → `hosted-install`, `hosted-accounts`; `docs/running/hosted.md` “People and roles”; `docs/cloud-install.md` |
| Try it first: the real app on a sample site, in your browser, nothing installed or saved, needs a computer-sized screen | /apps/, home hero (“Try the demo”), tour hero, /how-to/ — **only while `site.json` → `demo.available` is true** (false today) | the demo being built for `/demo/` (another engineer); check these words against it before switching it on |

## The home page, made shorter (proposal, 2026-11-24)

Twelve sections became seven; nothing new is claimed. Wording that changed:

| Statement | Where | Support |
| --- | --- | --- |
| “Ask for a change in plain words, check it beside your live site, then publish it to your own repository.” | home hero | `docs/editing/assistant.md`, `proof-and-publish.md`; the publish row in the status table |
| Film chapters: Ask — “In plain words — or type in a form, or on the page itself.” Check — “Each change marked up beside the live site. Put back any one.” Publish — “To your own repository, or for review first. Undo adds a new version.” | home film | `docs/editing/form.md`, `on-the-page.md`, `assistant.md`; `proof-and-publish.md` (Send for review); `history.md` (undo is a new version) |
| “Nothing is live until you press Publish.” | home film | `docs/editing/proof-and-publish.md` |
| “Three starters, three looks each.” | home starters | the starters row in the status table (`starters/*/starter.json`) |
| “Apache-2.0, free to use. Astro fits deepest; it also recognises Docusaurus, Nuxt, Next.js, SvelteKit, Eleventy, Hugo and Jekyll. The assistant runs on your own AI key.” | home close | the “Astro fits deepest” row above (moved here from the cut “It’s just your repo” section); the docs index “What it costs” |

## Install commands

Every command a page shows comes from `src/data/site.json → install`.
`install.published` is true since 2026-11-24 (0.1.0 is on npm): the hero and
the close show `npx galley-cms`, the starter cards
`npm create galley@latest my-site -- --starter <caddow|ferrow|lowfield|storefront>`
with “Creates the site and opens Galley”, and the docs `{install.create}`,
`{install.createStarter …}` and `{install.run}`. While the flag was false the
site showed the from-a-clone steps and, on each card,
`npm create astro@latest my-site -- --template fictiontribe/galley/starters/<folder>`;
`src/lib/install.ts` still refuses the npm commands if the flag is turned off.

## Files generated from the code

`public/schema/galley.config.json` and `public/schema/brand.json` (served at
`/schema/…`, the addresses the app's files name) are written by
`galley schema --out` through `pnpm --filter @galley/site sync-docs`;
`check-docs` fails when they differ from what the CLI writes.

## Placeholders still on the site

| Item | Where | State |
| --- | --- | --- |
| **Galley Cloud sign-up address** `cloud@galley.example` | `src/data/site.json → cloud.email` — not used by any page for now | **PLACEHOLDER** — the owner has not supplied the address yet. Until then /cloud/ says "Tell us you’re interested" and links to Fiction Tribe’s contact page (`maker.contact`). When an address exists, switch the hero action back to the email link. |
| Repository `https://github.com/fictiontribe/galley`, site `https://galley.fictiontribe.com`, the discussion link `{repository}/discussions` | `src/data/site.json` (every link is built from it) | **Planned**, not public yet |
| Security and conduct contacts | `site.json` (`securityContact`, `conductContact`) | **PLACEHOLDER**; /open-source/ says reports go through the repository's security advisories (enable private reporting) |
| The film | home, section `film` (wide, its chapters as the three steps) | `public/video/galley-explainer.*` is the Caddow cut (its poster shows Caddow’s proof). **Its transcript (`galley-explainer.txt`) still says “for Astro” and “Built for Astro”**, which the site no longer says — the transcript is in `public/` (not this pass’s to edit) |

## Removed in this rebuild

Stale statements the content plan listed are gone: forms, plugins, scripts and
redirects described as "in progress"; "one-click deploy in progress"; AI-first
"in preview"; every `npx galley-cms` command a reader could copy (the docs
index, agent.md and starters page now show the clone commands; reference pages
that mention the future npm package say it isn't published — reversed on 2026-11-24, when Galley went on npm); the quickstart's
"screens are still being finished" and its API walk-through; the Cloud page's
fake email field; "no paid tier" (now "the open-source product has no paid
tier"); Fiction Tribe's Portland/2011 facts (the /fiction-tribe/ page is cut).
`/features/`, `/adapters/` and `/fiction-tribe/` redirect (301) to `/`,
`/docs/adapters/` and `/team/` through Galley's own redirects list.

## Known problems found while checking

- **The starters' vendored kit** (`starters/*/src/galley/visibility/integration.js`)
  still has the dev-server bug fixed in `packages/astro` today: under
  `astro dev` and in Galley's preview, every page comes back as comma-separated
  numbers. Following the quickstart today, `galley new … --starter astro-editorial`
  opens an editor whose preview shows those numbers (form, Proof and Publish
  still work). Re-vendor the kit into the starters.
- The reference pages have since been regenerated; `check-docs` passes and
  `pnpm --filter @galley/site build` builds.
- **Fixed in 0.1.2.** `galley mcp config` from the npm package (0.1.0 and
  0.1.1)
  prints first a `node …/_npx/<hash>/node_modules/galley-cms/bin/galley.js`
  command — a path into npx's cache, which npx may clear — and then the
  lasting `npx -y galley-cms mcp …` form under “Once galley-cms is published
  to npm, the same works without this checkout” (`packages/cli/src/commands/mcp.ts`).
  `docs/mcp.md` tells readers to use the second form.
- **Fixed in 0.1.2.** `galley starters | head` crashed with an unhandled
  `EPIPE` in 0.1.0 and 0.1.1 (nothing handles a closed standard output).
