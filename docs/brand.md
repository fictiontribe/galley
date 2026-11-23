# The site's brand

Every site edited here can have its **brand** written down: its colours,
fonts and sizes, its logo, the sections it is built from, what its pictures
look like, and how it speaks. Once it is set up, the assistant works inside
it — it writes in the site's voice, uses its colours and fonts by name, and
briefs image generation with its imagery — and Proof can point out changes
that drift from it.

(This is the brand of *your site*. The app's own name and colours — the
white-label settings — are something else: see `packages/core/src/brand.ts`.)

---

## For site owners

### Setting it up

Open **Brand** in the site's sidebar. There are two ways in; both end in the
same proposal.

**Read it from this site** — for a site that already exists. The app starts
the preview, measures a handful of pages in your own browser (home, one page
of each collection, and the pages the home page links to most), reads the
site's styles and sections, and the assistant writes a voice guide from the
site's own words, quoting them. Nothing about the site changes.

**Set it up from your material** — for a new site, or one without a
system. Drop in as many files as you like:

| Kind | Accepted | What happens to it |
| --- | --- | --- |
| PDF | brand guidelines, decks | Its fonts and painted colours are read straight from the file; the assistant then reads it page by page. Up to 100 pages and 22 MB are read in full; a longer file gives only its colours and fonts — export the pages that matter as a smaller PDF. |
| Pictures | PNG, JPG, WebP, GIF | Colours measured from the pixels; the assistant reads a reduced copy for the logo, type and mood. |
| SVG | logos, icons | Read as a drawing (its colours and shape). Never run. |
| Notes | `.md`, `.txt` | Read as notes. |
| A website | its address (https only) | Its words and stylesheets are read as material. |

Add a note to any file — “old logo, do not use” is understood. Limits: 100 MB
a file, 40 files, 300 MB waiting to be saved at once.

### Reviewing the proposal

The proposal is a specimen sheet: big swatches with their role, name and
value; how each text colour reads on each ground (“Easy to read”, “Large text
only”, “Hard to read”, with the ratio); the type scale set in the real fonts;
the logo on light and dark; the sections; the voice with its quotes and
before/after examples. Every item:

- can be changed in place (click the name, the value or the colour);
- says where it came from — “page 14 of Guidelines.pdf”, “measured on /
  and /pricing/”, “tokens.css:12”;
- says how sure the app is: **Measured** (seen in use), **Declared**
  (written down in the styles or the material), **Inferred** (worked out —
  check it).

When two sources disagree about the background, surface, text or accent
colour, the proposal asks — “The PDF says #1A1A1A for text; the site uses
#111827 — which is right?” — and can't be saved until you answer. Other
disagreements are listed under **Worth a look**, with anything else the
reading noticed (near-duplicate greys, text that is hard to read, fonts that
didn't load).

**Ask** changes the proposal in words (“make the accent warmer and check the
contrast still passes”); contrast is measured again by the app, not claimed.

Nothing is written until **Save the brand**. Saving writes the brand into the
site as ordinary changes you see in Proof and publish like anything else.

### Applying it to the site's styles

The brand describes the site; it changes none of its styles unless you ask.
When the site keeps its colours and fonts in one file (the starters do:
`src/styles/tokens.css`), **Apply to the site** writes the brand's values
into that file — one value per line, in the notation the file already uses —
and the change waits in Proof with the site before and after. A font the site
doesn't have installed is named in the file and the page shows the next font
in its list until the font is added; the dialog says so.

### Keeping it true

**Check against the site** measures the pages again and lists colours and
fonts the pages use that the brand doesn't know, and brand values nothing
uses. Proof can show the pending changes against the brand (colours or fonts
that aren't the brand's, text that has become hard to read, words the guide
avoids) — as suggestions, never a block.

### Material you add later

Add more files at any time. The proposal shows “3 new files to read”; reading
them adds what they say as new findings or questions, without overwriting what
you already reviewed.

### Export and import

**Export** gives the brand as one file (for another site — **Import a
brand…** there makes a proposal to review), or as design tokens in the W3C
Design Tokens Community Group format.

### Privacy: what is sent where

Reading the brand from the site measures pages **in your own browser**; the
measurements, the site's styles, a sample of its copy and the list of its
sections are then sent to the AI model provider (Anthropic) to name the
colours and write the guide. When you set it up from material, **each file
you add is sent to the provider** to be read (pictures as a reduced copy,
PDFs as they are), plus your notes. A website's address is fetched by this
app (public https addresses only), not by the provider. Nothing is sent
until you press a button that reads; the cost is recorded in the site's
assistant usage like any conversation. Without an assistant key, colours,
fonts and sizes are still read — only the voice guide needs the assistant.

Files up to 10 MB are saved in the site with the brand; larger ones stay in
this app's own folder for the site (`<home>/state/<siteId>/brand/`), so a
60 MB PDF doesn't land in the repository by accident.

---

## For developers

### Files

```
galley/brand/brand.json              the design system as data
galley/brand/guide.md                the human guide (written from brand.json)
galley/brand/sources/manifest.json   the material and what was learned from each
galley/brand/sources/<file>          material under the size threshold
```

`galley.config.json` (all optional):

```json
{ "siteBrand": { "dir": "galley/brand", "largeFileMB": 10, "tokensFile": "src/styles/tokens.css" } }
```

The brand files are written through `SiteService.writeFile` — in content
mode when the site's content globs cover the folder, else in build mode
when the site allows it; otherwise saving is refused in plain words.

`brand.json` (schema in `packages/core/src/sitebrand/schema.ts`, types in
`sitebrand/types.ts`): `colors` (id, role, name, value `#RRGGBB`, `token`,
`usage`), `contrast` (pairs with `ratio` and `result` aaa/aa/large/fail,
`measuredOn`), `typography.fonts` (family, fallbacks, `source`
package/file/embedded/system, weights, `token`) and `typography.scale`
(role h1…link, size, px, weight, lineHeight, letterSpacing), `spacing`,
`radius`, `shadows`, `logos` (file, variant, background, colours, viewBox,
clearSpace, minSize, doNotUse), `imagery`, `components` (type, whenToUse,
usedOn, thumbnail `galley/sections/<type>.webp`), `voice` (summary, tone,
rules with real quotes and before/after, vocabulary say/instead-of,
formatting), `layout` do/don't, and `tokensFile`.

Every value carries `confidence` and `evidence`:

| Confidence | Means |
| --- | --- |
| `measured` | seen in use: the overlay measured it on rendered pages, or it was measured from a file's pixels / a PDF's fills |
| `declared` | written down: a custom property, `@theme`, Tailwind config, Sass variable, `@font-face`, a font package — or a value the material states on a page |
| `inferred` | worked out: a value read off a picture, a role the model gave, an edit by hand |

`evidence` items are `{ kind: "file", file, line }`, `{ kind: "page", page,
element }`, `{ kind: "source", source, sourceName, sourcePage }` or `{ kind:
"website", url }`.

### How a brand is read

1. **Declared** (`sitebrand/declared.ts`) — custom properties with file,
   line and byte range, `var()` chains resolved; the tokens file (the one
   `siteBrand.tokensFile` or a starter's `starter.json` `tokens` names, else
   the stylesheet with the most `:root` colours; alternative looks with the
   same property names are set aside); `@font-face`; `@fontsource*` imports
   resolved in the site's own `node_modules`; Tailwind v4 `@theme`, plain v3
   config colours; Sass/Less variables.
2. **Measured** — the overlay's `measure` request on a few pages (below),
   merged (`sitebrand/measured.ts`).
3. **Inventory** — section types from the content model with their
   descriptions and thumbnails, component files, which pages use each, and
   the site's own copy.
4. **Candidates** (`sitebrand/proposal.ts`) — every colour and font found,
   merged by value with all their evidence. The model gives roles to
   candidate ids; it can't add a colour that wasn't found.
5. **The proposal** — deterministic: contrast measured, conflicts turned into
   questions, quotes checked against the real copy (a quote that isn't on
   the site is dropped), near-duplicate greys flagged.

### The overlay `measure` request

Host → overlay: `{ galley: 1, type: "measure", id }` (edit role only; `id`
is `[A-Za-z0-9_-]{1,64}`). Overlay → host: `{ galley: 1, type:
"measure-result", id, summary }`, where `summary` is a `MeasureSummary`:
text/background pairs with their area and ratio (a background that is a
picture or gradient is never guessed — those pairs are left out), grounds by
area, type by role, radii, shadows, section spacing, buttons, links, header
logo candidates, which web fonts loaded, `:root` custom properties, internal
links by count, and samples of the page's copy. Read-only; capped at 60 KB of
JSON (`truncated` says when it was cut). See
`packages/overlay/src/measure.ts`.

### The analysis calls

`sitebrand/model.ts`. Every call: the engine's `createApiClient` (the key
from Settings; never `ANTHROPIC_BASE_URL`), the model and effort from
Settings, adaptive thinking, streaming, structured outputs
(`output_config.format`, checked again with a strict zod schema — an extra
key fails the whole answer), the server-side refusal fallback where the
model has one (retried without it if the beta is refused), **no tools**.
Documents and pictures travel as `document` / `image` blocks; text inside
them is data, and the system prompt says so. Per file: one reading
(`readingSchema`), cached by the file's hash. Then two requests put it
together — the look, then the words — because one schema with both compiles
to a grammar larger than the API accepts. (The structured-output format is
part of the cached prefix, so the two halves can't share a cache; only the
small system prompt carries a breakpoint.) Cost is recorded in the site's
usage as one assistant turn.

### Routes

| Route | |
| --- | --- |
| `GET /api/sites/:siteId/brand` | `SiteBrandState`: saved brand, guide, material, proposal, analysis, web fonts, the assistant digest |
| `POST …/brand/analyse` | `{ from: "site" \| "material", measurements?, sources? }` → `Job` (kind `brand`) |
| `POST …/brand/cancel` | stop the analysis |
| `POST …/brand/sources` | add material in base64 chunks (≤ 8 MB each); `preview` carries a browser-made PNG of a JPG/WebP/GIF |
| `POST …/brand/website` | `{ url }` — fetched with the same guarded fetcher as forms |
| `PATCH` / `DELETE …/brand/sources/:sourceId` | note / leave out / remove |
| `GET …/brand/sources/:sourceId/file?kind=original\|picture` | the file, under a no-script policy |
| `PUT` / `DELETE …/brand/proposal` | edit (`brand`, `answers`) / discard |
| `POST …/brand/ask` | `{ text }` → `{ proposal, reply }` |
| `POST …/brand/save` | write the files → `{ paths }` |
| `GET` / `POST …/brand/apply` | the plan / write it |
| `POST …/brand/check` | `{ paths? }` → `{ items }` |
| `POST …/brand/drift` | `{ measurements }` → `DriftReport` |
| `GET …/brand/export?format=brand\|tokens` | download |
| `POST …/brand/import` | `{ bundle }` → a proposal |
| `GET …/brand/fonts/:fontId` | one of the site's own web fonts |

### Tools

`get_brand` and `check_brand` are in the shared registry, so the built-in
assistant and every harness over MCP get the same thing. There is no
`update_brand`: in build mode `write_file` / `edit_file` can change
`galley/brand/*`, and every other change goes through the Brand screen's
review. The assistant's instructions carry the brand digest as one entry of
the site card (`sitebrand/tools.ts` → `siteBrandInstructions`), so a brand
edit reaches a running conversation as a note and the cached prefix is never
rewritten. `generate_image` adds the brand's imagery direction and palette to
its request (`ImageGenRequest.brandDirection`).

### Design tokens export

`format=tokens` writes the W3C Design Tokens Community Group format, version
2025.10 — the first stable release
([format](https://www.designtokens.org/TR/2025.10/format/),
[colour](https://www.designtokens.org/TR/2025.10/color/)): colours as
`{ colorSpace: "srgb", components, alpha?, hex }`, `dimension` values as
`{ value, unit }` in `px` or `rem`, `fontFamily`, `typography` and `shadow`
composites. Values the format can't express (a fluid `clamp()`) are kept
under `$extensions["com.fictiontribe.galley.brand"]`. Media type
`application/design-tokens+json`, file `<site>.tokens.json`.
