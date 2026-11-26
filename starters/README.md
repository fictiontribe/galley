# Starters — the contract

A starter is a complete Astro site that Galley's new-site wizard copies,
that the Galley website features, and that can be published as an Astro
catalog theme. This page is what every starter must do, written from
building `astro-saas` (the B2B / SaaS starter). `astro-starter` (the small
business site) predates the Galley-specific parts — the block markers,
`galley/`, `starter.json` — and will be retrofitted to them.

| Starter | Name (`starter.json`) | For | Sections | Templates | Looks |
| --- | --- | --- | --- | --- | --- |
| `astro-starter` (`lowfield`) | Lowfield — small business | A small studio or local business | 17 | 5 | 3 |
| `astro-saas` (`ferrow`) | Ferrow — B2B software | A B2B software company | 29 | 7 | 3 |
| `astro-editorial` | Caddow — fashion editorial | A small fashion label's photography-led site | 20 | 6 | 3 |
| `astro-storefront` | Caddow — storefront | A small fashion label's shop, with products from Shopify | 24 | 8 | 3 |
| `astro-blog` (`sarking`) | Sarking — blog | A long-form blog with charts, tables and evidence; posts in Markdown with fenced-block embeds | 18 | 4 | 3 (each light and dark) |

## 1. Files

```
<starter>/
├── package.json          name galley-astro-<kind>, private, MIT, type module,
│                         engines.node ">=22.23.4", scripts dev/build/preview/galley
├── LICENSE               MIT
├── README.md             for someone arriving from Astro's catalog (§8)
├── CONTENT-GUIDE.md      the brief Galley's assistant reads (§7)
├── galley.config.json    what detection can't guess (§6)
├── starter.json          wizard metadata — not copied into new sites (§6)
├── starter-notice.json   the demo notice — merged into site.json only by
│                         the template export, not copied into new sites
├── astro.config.ts       site from site.json; static; format "directory"
├── netlify.toml, tsconfig.json, .gitignore
├── galley/
│   ├── sections/<type>.webp      one per section type
│   ├── templates/<id>.md + .webp page templates and their pictures
│   └── previews/<look>.webp, home.webp
├── scripts/
│   ├── make-thumbnails.mjs       makes everything in galley/*.webp
│   └── gallery/                  integration.mjs, gallery.astro, sections.md
├── public/images/…
└── src/
    ├── content.config.ts         plain, conventional zod (§3)
    ├── content/<collection>/…    one folder per collection
    ├── data/site.json            identity, contact, social, SEO, labels
    ├── data/navigation.json      header, buttons, footer, legal
    ├── lib/site.ts               withBase(), labels, markdown helpers
    ├── components/Sections.astro, Section.astro, sections/*.astro, sections/Unknown.astro
    ├── layouts/Base.astro, pages/…
    └── styles/tokens.css, themes/<look>.css, global.css
```

Scripts: `"dev": "astro dev"`, `"build": "astro build"`,
`"preview": "astro preview"`, `"galley": "npx --yes galley-cms"`, and
`"thumbnails": "node scripts/make-thumbnails.mjs"`. Dependencies are
registry packages only — `astro`, `marked`, `@fontsource-variable/*`, and
`@astrojs/markdown-satteri` if you add Markdown plugins (Astro 7's default
processor; rehype/remark plugins no longer run without the old one). No
`workspace:` ranges, no `packageManager`, no install scripts, no lockfile.
`sharp` as a devDependency for the thumbnail script.

## 2. Copy lives in files, never in components

Every word a visitor can see comes from content (`src/content/**`) or data
(`src/data/site.json` → `labels`, `navigation.json`). Components contain
none — not a button label, not an `aria-label`, not "min read". Templates
for strings with values use `{placeholders}` and `fill()`.

**Prove it** with a scan of every `.astro` file: strip the front matter,
`<style>`, `<script>`, comments and every `{…}` expression, then report
any text between tags with two or more letters and any literal `alt`,
`title`, `aria-label`, `placeholder`, `label` or `value`. It must report
zero. Check the scanner catches a planted `<p>Hello world</p>` first.

The word "Galley" appears only in `galley.config.json`, `starter.json`,
README, CONTENT-GUIDE, the `galley/` folder name, the `data-galley-*`
attributes and the `galley` script — not in the site.

## 3. The content model

`src/content.config.ts` must stay statically readable — Galley's Astro
adapter parses it without running it:

- `defineCollection({ loader: glob({ pattern, base }), schema: … })`;
  `export const collections = { … }`.
- Helpers as top-level `const`s (`tone`, `link`, `icon`), shared section
  options as a spread object (`const common = { id, tone }` and
  `...common`). Both are read.
- Sections: one `z.object({ type: z.literal("x"), … })` per type, gathered
  in `z.discriminatedUnion("type", [...])`, and the page field
  `sections: z.array(z.union([section, unknownSection])).default([])` with
  the reference starter's `unknownSection` catch-all.
- **Variants are `z.enum([...])`** with a `.default()` — they become
  selects. Numbers (`columns`) and numeric literal unions are read as plain
  numbers. `z.array(z.enum([...]))` becomes a list of selects.
- Numbers people type bare in YAML (`value: 380`) need `z.coerce.string()`.
- References: `reference("collection")`; components must accept both a
  reference and a bare file name (the section gallery passes raw YAML).
- Export the page schema (`export const pageSchema`) so the section gallery
  validates its fixtures and the templates against it.

Prop vocabulary, shared by every starter: `eyebrow`, `heading`, `text`,
`items`, `image`, `imageAlt`, `cta`, `secondaryCta`, and the variant names
`align` (`left`/`center`), `imageSide` (`left`/`right`), `frame`,
`columns`, `layout`, `style`, plus `id` and `tone` on every section.
`*word*` in a heading is the accent.

## 4. Tokens, looks and imagery

- Every colour, font, size, radius, shadow and motion value is a custom
  property in `src/styles/tokens.css`. Nothing else contains a colour
  literal or a font name — scan `src/` and `scripts/` for `#hex`, `rgb(`,
  `hsl(`, `oklch(` (excluding `color-mix(in oklch, …)`) and family names.
- Components use the contextual `--tone-*` roles set by the four tones
  (`default`, `muted`, `inverse`, `accent`) in `global.css`.
- **Looks** are complete alternative tokens files in
  `src/styles/themes/<id>.css`, with exactly the same set of properties
  (diff the property names). The default look's file is byte-identical to
  `tokens.css`. Switching = `cp src/styles/themes/<id>.css src/styles/tokens.css`.
  Fonts for every look are dependencies.
- **Imagery** that should follow the look is SVG drawn with the `.s-*`
  classes (fills from `--shot-*` tokens, defined in every look) or
  `currentColor`. `Media.astro` inlines SVGs from `public/` (without their
  own `<style>`, which only holds stand-alone fallback colours), so they
  take the page's colours. No `id`s inside those SVGs (they'd collide).
- **Contrast:** every text element against its effective background, on
  every page, in every look, with every `<details>` open: AA (4.5:1, 3:1
  for large text). Zero failures.

## 5. `withBase()` and the block markers

- Content writes links and images from the site root. Every component
  passes them through `withBase()`; Markdown fields go through `markdown()`
  / `inline()`; Markdown **bodies** through a base-links Markdown plugin in
  `astro.config.ts`. Verify with a sub-path build (below).
- **Block markers.** The root element of every rendered section carries
  `data-galley-block="<field>.<index>"` (e.g. `sections.3`, zero-based) and
  `data-galley-block-type="<type>"`. `Sections.astro` builds
  `block = { key: \`${field}.${index}\`, type }` for each section and passes
  it as a prop; each section component passes it unchanged to
  `Section.astro`, the one place the attributes are written (and
  `Unknown.astro`, in development). They stay in production output.

## 6. `galley/`, `galley.config.json`, `starter.json`

**Thumbnails** — `galley/sections/<type>.webp`: the section rendered alone
with its example on the default look, 1280-px viewport scaled to 640 px
wide, at most 720 px tall, WebP ≈ q72 (aim ≤ 25 kB). **Templates** —
`galley/templates/<id>.md` (an ordinary entry for its collection; drafts
for collections that have `draft`) and `<id>.webp`, the full page scaled to
400 px wide. **Previews** — `galley/previews/<look>.webp`, the home page at
1280 × 800 in each look, and `home.webp` (the default look). Keep `galley/`
under ~1.5 MB.

All of it comes from `npm run thumbnails` with
`PLAYWRIGHT_MODULES=<a node_modules with playwright-core>`: it builds the
site with `SECTION_GALLERY=1` (an integration that injects
`/__gallery/[...path]` — never in a normal build, the sitemap or the
navigation — and, with `SECTION_GALLERY_LOOK=<id>`, serves that look's file
in place of `tokens.css` without touching the tree), serves each build on
`127.0.0.1`, photographs `[data-galley-block]` for sections and full pages
for templates, and converts with `sharp`. The fixture,
`scripts/gallery/sections.md`, has one short example per type.

**`galley.config.json`** — minimal: `name`, `ai.instructions:
["CONTENT-GUIDE.md"]`, `media`, collection `url` patterns detection can't
guess (and `null` for collections with no pages), list fields (`titleField`,
`imageField`…) where the names are unusual, the `sections` field's
`blocks: [{ type, label, description, thumbnail }]` (one per type, the
description one line on when to use it), and
`templates: [{ id, label, description, collection, file, thumbnail }]`.
Validate with the engine — save as `check.mts` (an `.mts` file, so
top-level `await` works) and run `npx tsx check.mts` from `packages/core`:

```ts
import { readFileSync } from "node:fs";
import { loadSiteModel, validateConfig } from "./src/content/index.ts";
const root = "../../starters/astro-saas";
console.log(validateConfig(JSON.parse(readFileSync(`${root}/galley.config.json`, "utf8"))));
const model = await loadSiteModel(root);
const blocks = model.collections.find((c) => c.id === "pages")!.fields.find((f) => f.type === "blocks")!.blocks!;
console.log(blocks.length, blocks.filter((b) => !b.thumbnail || !b.description || !b.example || !b.count).map((b) => b.type), model.templates?.length, model.notes);
```

It must be accepted, every block must come back with a thumbnail,
description and example, and no block type may have a count of 0.

**`starter.json`** (starter root, not copied into new sites):

```json
{ "name": "…", "description": "…", "framework": "astro",
  "tags": ["saas", "b2b", "corporate"],
  "tokens": "src/styles/tokens.css",
  "preview": "galley/previews/home.webp",
  "looks": [{ "id": "signal", "label": "Signal",
              "file": "src/styles/themes/signal.css",
              "swatches": ["#…background", "#…text", "#…accent", "#…inverse"],
              "preview": "galley/previews/signal.webp" }] }
```

The first look is the default. Swatches are computed from the look file.

`"download": true` keeps the starter out of the `galley-cms` package:
it travels as `starters-<id>.tgz` on the release of its version's starters
and is downloaded each time a site is made from it (nothing is kept
between uses), checked against the
SHA-256 the package records. The package keeps only what shows it in the
wizard and in `galley starters`: `package.json`, `starter.json`,
`galley.config.json` and the pictures `preview` and the looks name. Use
it for a starter that would push the package past its size limit
(RELEASING.md, "How the starters travel"); offline, it can't be used.

## 7. `CONTENT-GUIDE.md`

The voice in a few lines; where things live, with the microcopy rule;
the options every section takes; one table per section family (purpose,
fields with required ones in bold, variants with defaults, what it pairs
with); page recipes ("a product page is: hero → screenshot →
feature-split ×3 → steps → integrations → changelog → cta"); each
collection's fields and body shape; image folders, how SVGs take the look,
and aspect ratios; a "before you finish" list. The assistant reads it
before every change — keep it true.

## 8. README and the catalog rules

The README is the project's own, for a visitor from Astro's catalog: what
you get (sections as a table), `npm create astro@latest -- --template …`,
where content lives, "edit with Galley" (the one command, marked *once
published*, and what the builder does), adding a section type, looks and
re-theming, templates, thumbnails, removing the notice, deploying, MIT,
and the Astro trademark line. Catalog rules (see
`docs/astro-catalog/README.md`):

- Current Astro major; the demo is the repository as-is, not an advert.
- Every placeholder e-mail and URL is `example.com`; social links are bare
  domains (`https://www.linkedin.com/`).
- No real people, companies, towns or trademarks: invent them and search
  for each name (people, companies, products, awards) before using it.
  Integrations: name open standards (SAML, SCIM, webhooks), not products.
- No Houston, anywhere (`grep -ri houston`).
- The removable notice: `starterNotice` in `site.json`, present only in the
  exported template repository; `StarterNotice.astro` renders nothing
  without it; "Hide" persists in `localStorage`, applied before paint.

## 9. Verification checklist

Run Astro in a clean environment (`env -i PATH="$PATH" HOME="$HOME" …`)
and give servers explicit ports.

1. `pnpm install`; `pnpm --filter <name> build` — zero errors, zero warnings.
2. Sub-path build `--site https://example.com --base /demo`; a link check
   of every `href`, `src`, `srcset`, CSS `url()` and sitemap `<loc>` in both
   builds — zero broken, and nothing outside `/demo` in the second.
3. Headless Chromium at 1440 and 390 px through every page, a post → list
   → tag, a customer story, the changelog, the drop-downs by keyboard
   (Tab, Enter, Escape, Tab out), the mobile menu, tabs with and without
   JavaScript, the notice (merge `starter-notice.json` into a scratch build),
   each look: no console errors, no failed or external requests, no
   horizontal overflow. Look at the screenshots.
4. Contrast audit, every page, every look: zero failures.
5. Detection via `loadSiteModel`: collections, block count, enum options,
   notes. Fix the starter, not the engine; report engine limits.
6. Scans: copy in components, raw colours and fonts, `example.com`, Houston,
   real names, "Galley" outside its places.
7. Once, if disk allows: copy the tree (no `node_modules`, `dist`,
   `.astro`) to `/tmp`, `npm install && npm run build` with plain npm, then
   delete it.
8. Remove `dist/`, `.astro/`, temporary builds and screenshots; keep
   `galley/`.
