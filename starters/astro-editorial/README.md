# Galley + Astro editorial starter

A photography-led site for a small fashion label, built with
[Astro](https://astro.build): a full-screen campaign, lookbooks, a journal
with tags, stockists and an atelier page, assembled from twenty image-first
section types. Big type over big pictures, generous white space, three
complete looks in one tokens file each, no client-side framework, no CSS
framework, no tracking and no third-party requests.

The sample content is a made-up coat and knitwear label, **Caddow** — every
person, shop and town in it is invented. Replace it with your own.

It ships with **thirty real photographs** — a campaign, two lookbooks, still
lifes of the pieces, the workroom, a portrait, journal covers — made for this
template from its own **shoot brief**: an art direction, a shot list with a
complete prompt for each picture, and a script that drops new photographs
into place. Re-shoot it for your own label with the same three files.

Every word lives in plain Markdown and JSON, so you can edit it in any text
editor, or with [Galley](https://github.com/fictiontribe/galley), the
open-source AI CMS for static sites this starter is written for. Nothing here
depends on Galley: it is an ordinary Astro project.

## What you get

- **Eleven kinds of page** — home (a campaign), collections, a lookbook per
  season, atelier, journal, journal story, a page per tag, stockists,
  contact, privacy and a not-found page — each one a Markdown file whose
  front matter lists its sections.
- **Twenty section types**, each with its own schema, so a typo fails the
  build with a clear message, and real variants (enums and switches) that an
  editor can toggle:

  | Section | Use it for |
  | --- | --- |
  | `campaign-hero` | A full-screen photograph with the headline set on it — on a built-in shade or plate, so it reads over any picture |
  | `split-editorial` | Words beside a photograph, on the page's split line |
  | `lookbook-grid` | Looks from a lookbook in 2–4 columns, linking into it |
  | `look` | One look, large, with its pieces and prices |
  | `gallery` | A mosaic, a row or a grid of photographs |
  | `image-band` | One photograph across the page |
  | `quote` | A quotation set large in italic, beside a portrait |
  | `statement` | A sentence set large; with `highlight`, its words turn to ink as it is read |
  | `pieces` | Garments as cards with a price shown as text |
  | `story` | Writing in markdown, with an optional drop cap |
  | `journal-list` | The latest journal stories |
  | `stockists` | Shops grouped by town |
  | `chapters` | Steps, each with its photograph; the words hold their place while the picture passes |
  | `marquee` | A drifting line of words (CSS only, pausable, still with reduced motion) |
  | `newsletter` | The sign-up form |
  | `form` | Any other form (a stockist enquiry) |
  | `cta` | The closing invitation, optionally beside a photograph |
  | `contact` | Details beside the contact form |
  | `film` | A poster with a play mark that links out — nothing embedded |
  | `credits` | Roles and names, like a shoot's credits |

  [`CONTENT-GUIDE.md`](./CONTENT-GUIDE.md) lists every field and variant.
- **Lookbooks** — a collection of seasons, each with a cover, looks with
  their pieces, and sections of its own (credits, an invitation).
- **A journal** with reading time, newer/older links, paginated listings and
  a page for every tag.
- **Settings files** — `src/data/site.json` (name, contact details, social
  links, share image and every interface label), `navigation.json`,
  `stockists.json`. Components contain no copy at all.
- **Three looks** — Chalk (the default: lime-wash white, ink, one ultramarine
  accent), Paper (unbleached paper, espresso, olive) and Night (dark: ink,
  bone, sodium amber), each a complete tokens file, every pair of colours at
  least WCAG AA.
- **Forms that work** — newsletter, contact and stockist-enquiry forms, each
  one JSON file in `src/content/forms/`, rendered by Galley's site kit
  (vendored in `src/galley/`): accessible, progressively enhanced, sent to
  the Galley inbox. Email links offer Gmail, Outlook, the mail app or copy.
  `src/data/scripts.json` is ready for analytics with a consent banner (none
  switched on).
- **Sections sized to what they hold** — one step of air above and below
  every section (`--space-section`, the top of the spacing scale in
  `src/styles/tokens.css`), shared between two sections on the same ground;
  only the campaign hero fills the screen. Crops are anchored on each
  photograph's focus point from `galley/photography/shots.json`. The hero
  enters once; a highlighted statement inks itself word by word as it is
  read (a few lines in `Statement.astro`); everything holds still under
  reduced motion and reads complete without JavaScript.
- **The basics done** — self-hosted fonts, `sitemap.xml`, `robots.txt`, Open
  Graph tags, a skip link, visible focus, a mobile menu that works without
  JavaScript, reduced motion respected, image boxes that never shift. It works
  at the root of a domain or under a sub-path such as a GitHub Pages project
  site.

## Start a project

Requires Node 22.23.4 or newer (Astro 7's minimum).

```sh
npm create astro@latest -- --template fictiontribe/galley-astro-editorial
```

With pnpm: `pnpm create astro@latest --template fictiontribe/galley-astro-editorial`.
With Yarn: `yarn create astro --template fictiontribe/galley-astro-editorial`.

```sh
npm install
npm run dev       # http://localhost:4321
npm run build     # writes the static site to dist/
npm run preview   # serves dist/ locally
```

## Where the content lives

```
src/
├── content/
│   ├── pages/        one Markdown file per page; index.md is the home page
│   ├── lookbooks/    one per season → /collections/<file>/
│   └── journal/      journal stories → /journal/<file>/
├── data/
│   ├── site.json        name, contact, social links, share image, every label
│   ├── navigation.json  header links and button, footer columns
│   └── stockists.json   shops, grouped by town
├── styles/tokens.css    the look: colours, fonts, sizes, spacing
└── content.config.ts    the schema for all of the above
public/images/           photographs, referenced in content as /images/…
src/content/forms/       one JSON file per form
galley/photography/      the shoot brief, the shot list and the generation log
```

Pages are a list of **sections** in front matter:

```yaml
---
title: The atelier
description: Where the coats are made.
sections:
  - type: split-editorial
    heading: A workroom over the ropewalk, *three streets from the sea*.
    image: /images/people/hesper-lowe.webp
    imageAlt: Hesper Lowe by the workroom window.
    imageSide: right
  - type: statement
    tone: accent
    heading: Nothing leaves the room until it has been *worn for a week*.
  - type: cta
    heading: Come and try one on.
    cta: { label: Plan a visit, href: /contact/ }
---
```

Write links and images from the site root (`/contact/`, `/images/…`). In front
matter and in `src/data/`, they are adjusted for you when the site is served
under a sub-path. Markdown in the *body* of a story or page is rendered as
written, so under a sub-path, link from bodies with full addresses.

## The photographs

Every photograph is original: generated for this template from its brief,
checked frame by frame (skin, hands, garments, no lettering or logos), and
licensed with it under MIT. `galley/photography/LOG.md` lists every
generation, the model chosen and why, and what it cost.

To make your own:

1. **Write the brief** — [`galley/photography/ART-DIRECTION.md`](./galley/photography/ART-DIRECTION.md)
   is Caddow's: one world of hard late-afternoon sun on lime-washed walls; a
   palette tied to the tokens; wardrobe; sets; an invented cast; lenses and
   film character; where the empty space must fall for the type on each
   picture; retouching limits; and the tells of generated pictures to reject.
2. **Make the pictures** — [`galley/photography/shots.json`](./galley/photography/shots.json)
   lists all thirty: file, size and ratio, where each is used, its alt text, a
   complete self-contained prompt, a negative prompt, a `seedGroup` (shots
   that share a person, outfit or set — generate them with the same reference
   image), the crop `focus`, and a priority (1 = the pictures the first
   screens show). Use any image generator or a photographer. Name each file
   by its shot id: `campaign-aw26.png`, `aw26-look-01.jpg`, …
3. **Drop them in**:

   ```sh
   node scripts/ingest-photos.mjs ~/path/to/photographs
   ```

   Any common format and size. Each is cropped to its slot around `focus`,
   encoded as WebP (≤ 220 kB for campaign images, ≤ 120 kB for the rest;
   JPEG for the share image, which is cropped from the campaign picture if
   you don't supply one), and written over the old file. It lists the slots
   it didn't fill, and refreshes Galley's pictures (below). Running it again
   changes nothing. `--dry-run` shows what it would do.

Starting from nothing? `node scripts/make-placeholders.mjs --force` paints a
designed placeholder in every slot — a tonal field in the active look's
palette with a hard edge of sun and the shot's title — at the exact final
size, so the layout is right before the shoot. It never overwrites a real
photograph it didn't paint; `--check` confirms that the shot list and the
content agree.

## Edit with Galley

[Galley](https://github.com/fictiontribe/galley) is an open-source
(Apache-2.0) AI CMS for static sites, built for Astro. It reads this project
as it is — collections, section types and their variants come from
`src/content.config.ts` — and everything you change is a plain edit to these
files, published as a git commit. Nothing is installed into the site.

**Once Galley is published to npm**, one command in the project folder starts
it and opens your browser:

```sh
npx galley-cms        # or: npm run galley
```

**Until then**, run it from its repository (Node 20.11+, git, pnpm 10):

```sh
git clone https://github.com/fictiontribe/galley.git
cd galley && corepack enable && pnpm install && pnpm --filter @galley/web build
node packages/cli/bin/galley.js /path/to/your-site
```

On this starter, Galley gives you a form for every page, lookbook, story and
setting; a section palette with a picture of each of the twenty types;
click-to-edit on the preview (retype a headline over the campaign photograph
and see it proofed in place); an assistant that follows
[`CONTENT-GUIDE.md`](./CONTENT-GUIDE.md) (it needs an Anthropic API key;
everything else works without one); and proof-then-publish, where every
change waits beside the published page until you press Publish.

`galley.config.json` holds what Galley can't read from the code: the
lookbooks' URL pattern, the media folder, the content guide, a label,
description and picture for each of the twenty section types, and six **templates** —
ready-made pages to start from (campaign, lookbook, feature story, about,
stockists, contact) — kept as ordinary content files in `galley/templates/`.
Other tools ignore all of it. `starter.json` describes the starter and its
looks to Galley's new-site wizard and is not copied into new sites.

Galley's pictures — `galley/sections/*.webp`, `galley/templates/*.webp` and
`galley/previews/*.webp` — are photographs of a real build, made by
`scripts/make-thumbnails.mjs`. It builds the site with a hidden section
gallery (`/__gallery/`, only when `SECTION_GALLERY` is set — never in a
normal build, the sitemap or the menus), once per look, and screenshots it in
headless Chromium. It installs nothing: point it at any `node_modules` that
has `playwright-core` and a Chromium Playwright has already downloaded:

```sh
PLAYWRIGHT_MODULES=/path/to/node_modules/ node scripts/make-thumbnails.mjs
```

(`PLAYWRIGHT_CHROMIUM=/path/to/chrome` uses another browser binary.)

`scripts/check-type.mjs` (`npm run check:type`, same `PLAYWRIGHT_MODULES`)
checks that the build and `astro dev` set identical type — Galley's Proof
shows the live site (a build) beside the proposed page (the dev server), so
any difference would read as two fonts. It builds and serves the site, starts
`astro dev` beside it, and compares every piece of text on every page at 1440
and 390 wide: font properties, rendered width and the first screen's pixels.
`--looks` runs all three looks; `--linked` runs from a copy whose
`node_modules` is a link (pnpm, shared installs), the layout in which dev used
to refuse the font files.

## Make it yours

- **Remove the demo notice** — delete `starterNotice` from
  `src/data/site.json`, if it is there. The bar, and its few lines of script,
  go with it. (The copy in the Galley repository has none; the public
  template's export adds it from `scripts/starter-notice.json`.)
- **Set your address** — change `url` in `src/data/site.json` before you
  deploy; it is used for canonical links, share images, `robots.txt` and
  `sitemap.xml`.
- **Rewrite the content guide** — its Voice section describes Caddow.
  Galley's assistant reads it before every change.
- **Re-shoot** — rewrite `ART-DIRECTION.md` and the prompts for your own
  label, or hand the brief to a photographer as it is.

### Change the look

Everything visual is a custom property in
[`src/styles/tokens.css`](./src/styles/tokens.css); no colour or font name
appears anywhere else. To switch to another look:

```sh
cp src/styles/themes/night.css src/styles/tokens.css    # or paper.css, chalk.css
node scripts/make-placeholders.mjs --force                # placeholders in the new palette
```

Fonts are [Bodoni Moda](https://fontsource.org/fonts/bodoni-moda) (display,
with optical sizes), [Albert Sans](https://fontsource.org/fonts/albert-sans)
(text) and [Spline Sans Mono](https://fontsource.org/fonts/spline-sans-mono)
(labels), self-hosted from `@fontsource-variable` packages under open
licences. To change them, install other packages, swap the `@import` lines
at the top of `tokens.css` and update `--font-display`, `--font-body` and
`--font-mono`. Keep every text colour at least 4.5:1 against its ground; the
comment at the top of `tokens.css` explains the pairs, and the two shade
strengths that keep type on photographs legible.

### Add a section type

1. **Component** — create `src/components/sections/Lookalike.astro`. Copy a
   similar section: wrap the markup in `<Section type="lookalike" id={id}
   tone={tone} block={block}>`, use `SectionHeader` for eyebrow/heading/text,
   type the props with an `interface Props`, pass every link and image through
   `withBase()` (or `Media`) from `src/lib/site.ts`, put any words that are
   not content in `site.json` → `labels`, and style with tokens only.
2. **Schema** — in `src/content.config.ts`, add a `z.object({ type:
   z.literal("lookalike"), id, tone, … })` beside the others and add it to
   the `section` union. Use enums and booleans for variants, so they show as
   choices in an editor.
3. **Renderer** — in `src/components/Sections.astro`, import the component
   and add it to `components`. That file also hands each section its
   `data-galley-block` marker.
4. **Document and picture it** — add a row to `CONTENT-GUIDE.md`, an example
   to `scripts/gallery/sections.md`, an entry to the `sections` blocks in
   `galley.config.json`, and run `make-thumbnails.mjs`.

A section whose `type` has no component shows a dashed notice in development
and renders nothing in a production build, so a half-finished section never
breaks the site.

### Commerce

There is no shop, basket or checkout, on purpose: prices are text and pieces
link to "Enquire" (the contact page) or "Find a stockist". When a label wants
to sell online, the usual routes are a hosted checkout link per piece (Stripe
Payment Links, Shopify's Buy Button or Lemon Squeezy — put the URL in the
piece's `link`), a headless commerce API with its client script on the piece
pages, or a separate shop on a subdomain linked from the navigation.

### Forms, scripts and email links

The site kit (`src/galley/`, Apache-2.0, vendored from Galley; update it by
running Galley's `packages/astro/scripts/vendor.mjs` again) does three things:

- **Forms** — `src/content/forms/newsletter.json`, `contact.json` and
  `stockist.json`, shown by the `newsletter`, `contact` and `form` sections.
  Each sends to the Galley inbox at the capture address in
  `src/galley/settings.json` (`forms.endpoint`, which Galley fills in when
  you connect the site); until then a form says it isn't connected. A form
  can send to HubSpot, Marketo, Salesforce, a webhook or the visitor's mail
  program instead — see Galley's `docs/forms.md`.
- **Scripts** — `src/data/scripts.json` lists analytics and other tags, and
  the consent banner's wording. One example (Plausible) is in it, switched
  off; switch it on with your own domain and the banner asks first.
- **Email links** — every `mailto:` link opens a chooser: Gmail, Outlook,
  the mail app, or copy the address. `"mailto": false` in
  `src/galley/settings.json` turns it off.

The kit's styles are mapped onto the tokens in `src/styles/galley-kit.css`,
so forms, the banner and the chooser follow every look.

## Deploy

`npm run build` writes a plain static site to `dist/` that any static host
can serve; `dist/404.html` is the not-found page. `--site` (the origin) and
`--base` (a sub-path) let a host supply the address without editing
`site.json`, for example `npm run build -- --site https://you.github.io --base /my-site`.

- **Netlify** — `netlify.toml` is included. Import the repository.
- **Vercel** — import the repository; the Astro preset fills in the settings.
  Set `url` in `site.json`.
- **Cloudflare Pages** — build `npm run build`, output `dist`.
- **GitHub Pages** — build with `--site` and `--base` from
  `actions/configure-pages` and upload `dist/`.
- **Anything else** — upload `dist/` with `index.html` as the index document
  and `404.html` as the error page.

## Notes

- Pages with `noindex: true`, drafts and the 404 page are left out of
  `sitemap.xml`. Drafts (`draft: true`) show in `npm run dev` only.
- There is no lockfile here, so npm, pnpm, Yarn and Bun each write their own.
- `sharp` (a dev dependency) is only for the photography and thumbnail
  scripts; the site itself does not need it.

## Licence

MIT — see [LICENSE](./LICENSE). Made by Fiction Tribe, the makers of Galley. Astro is a
trademark of its respective owner; this template is an independent project
and is not affiliated with or endorsed by the Astro project. Bodoni Moda,
Albert Sans and Spline Sans Mono are distributed under the SIL Open Font
Licence.
