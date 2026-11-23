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

Updated 2026-11-23 (rebuild of the site).

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
| Many sites in one app (agencies) | Built | maintainers' check; `docs/multi-site.md` |
| Desktop app (macOS) and web app | Built | maintainers' check |
| MCP | Built | `docs/mcp.md`, `galley mcp` |
| Three starters, three looks each | Built | `starters/*/starter.json`, previews; the site reads them at build time |
| Redirects | New, in final checks | Used by this site: `src/data/redirects.json` and `public/_redirects` were written by Galley's redirects API (below) |
| Per-site brand setup | New, in final checks | maintainers' check; `docs/brand.md` |
| Search and AI checks | New, in final checks | maintainers' check; `docs/seo-and-ai-visibility.md` |
| Guided move from WordPress in the app | New, in final checks | Captured 2026-11-23 (`wordpress-plan`, `wordpress-report`) importing the importer's invented WordPress site into a throwaway Lowfield copy; changed from "in progress" on the maintainers's word |
| Agent-readable pages for customer sites | In progress | The site kit's generic version now runs on this site (below). Flip to "new" when the maintainers confirm the app side ships. |
| Shopify storefront starter (`storefront`, “Caddow Shop” on /starters/) | In progress (badge on its card) | `starters/astro-storefront` with its own previews and 24 sections; listed as the fourth card. Flip `shopify` in status.json to `new` when it reaches final checks |
| A switch per AI-crawler family | In progress (shown on `/ai-first/` only) | The kit reads `crawlers` from `src/data/visibility.json`; the app's switch is not claimed as built |
| Galley Cloud | Later (`/cloud/`, "Coming soon", no date or price) | The Cloud plan is kept outside this repository |

## Other statements

| Statement | Where | Support |
| --- | --- | --- |
| Pre-release 0.1.0, Apache-2.0, not on npm, runs from a clone | everywhere | `packages/core/src/brand.ts` (the version is read from it), `LICENSE` |
| The clone commands (clone, `corepack enable`, `pnpm install`, `pnpm --filter @galley/web build`, `node packages/cli/bin/galley.js <site>`) | home close, quickstart, docs index, agent.md | Followed on this machine 2026-11-23 (repo used in place; the web build was made into a temp folder with the same vite build). `galley new my-site --starter astro-editorial` → editor → form edit → Proof → Publish produced a real commit. See "Known problems". |
| "Galley adds nothing to your build" / no dependency or integration needed | home, /astro/ | ARCHITECTURE; the starters run without the kit's integration. (This site *chooses* to use the kit, for its agent files.) |
| In `astro dev`, the site kit's toolbar app opens the page in Galley | /astro/ | `packages/astro` README ("Dev Toolbar app"); the kit is not on npm (vendored) |
| This site's agent files (twins of every page incl. docs, llms.txt, llms-full.txt, robots.txt, sitemap.xml) | /ai-first/ | Written by the vendored site kit at build time (`src/galley/`, `src/data/visibility.json`); `/agent.md` is this site's own (`src/content/pages/agent.md`) |
| No cookies, no analytics, nothing from another origin | footer, /privacy/ | Checked in the technical pass: every request goes to the site's own origin |
| Starter photographs are AI-generated; Caddow, Ferrow and Lowfield are made up | footer, /starters/, /privacy/ | `starters/astro-editorial` shoot brief |
| /team/: James Rice (CEO, Co-founder), Misha Petrov, Sean Burles, Connor Burgess (each "Engineer"), their photographs and one line each | /team/, footer, /open-source/ "Who makes it" | From Fiction Tribe's public team page (photographs and lines verbatim, files in `public/team/` at their natural 999 × 740 with a 500 px copy), titles as the owner specified ("Engineer" for the three developers). Alt text is the name only. No bios, social links, e-mail addresses or Person structured data |
| Fiction Tribe is "a creative agency in Portland, Oregon" | /team/, /open-source/ | Fiction Tribe's own site says Portland (coordinator, 2026-11-23). No founding year is stated |
| "Built for Astro" — never official, partner or endorsed | /astro/, /privacy/ | Trademark notes on /privacy/ and /astro/; WordPress/Elementor note under the comparison table |

## Install commands

Every command a page shows comes from `src/data/site.json → install`. While
`install.published` is false the site shows only what works today: the
from-a-clone steps (home hero and close) and, on each starter card,
`npm create astro@latest my-site -- --template fictiontribe/galley/starters/<folder>`
("Works today with Astro’s installer" — checked 2026-11-24: it copies the
starter from the public repository). With the flag true the cards show
`npm create galley@latest my-site -- --starter <caddow|ferrow|lowfield|storefront>`
and the hero `npx galley-cms`. `src/lib/install.ts` stops the build if a page
would show `npm create galley` or `npx galley-cms` while the flag is false.

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
| The film | home, section `film` with `hidden: true` | Switched off until it is re-cut on the Caddow example; the files in `public/video/` are the old cut |

## Removed in this rebuild

Stale statements the content plan listed are gone: forms, plugins, scripts and
redirects described as "in progress"; "one-click deploy in progress"; AI-first
"in preview"; every `npx galley-cms` command a reader could copy (the docs
index, agent.md and starters page now show the clone commands; reference pages
that mention the future npm package say it isn't published); the quickstart's
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
