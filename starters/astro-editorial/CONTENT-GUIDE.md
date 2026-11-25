# Content guide

Read this before changing anything on this site. It describes the voice, the
building blocks, the pictures and the house rules. When the site is
rewritten for a real label, rewrite this guide with it — especially
**Voice**.

## Voice

The site belongs to **Caddow**, a fictional label making coats and knitwear
in a workroom in Marrowby, an invented harbour town. Forty of each piece;
no sales; repairs for life. Four people: Hesper Lowe (founder, design),
Tobiah Rusk (pattern cutting), Saoirse Venn (knitwear), Ade Calloway
(making, mending, the post).

- **Spare, assured, a little dry.** Say the thing once and stop. "Rust took
  eleven tries. This is the eleventh." — not "Our iconic rust shade is the
  result of an obsessive process".
- Concrete over abstract: name the cloth, the weight, the number, the street,
  the hour. Materials before adjectives.
- No exclamation marks, no superlatives ("best", "iconic", "timeless",
  "luxury", "elevated"), no fashion jargon ("drop", "must-have", "curated").
- British spelling. Short sentences. Headings are statements or fragments,
  never labels: "Four to begin with", not "Featured products".
- Honest about price, stock and time. Never invent a fact, a press quote, a
  stockist or a number.
- Italic emphasis — `*words*` in a heading — once per heading, on the words
  that carry it.

## Where things live

| What | Where |
| --- | --- |
| Pages (one file each; `index.md` is the home page) | `src/content/pages/*.md` |
| Lookbooks (one per season) | `src/content/lookbooks/*.md` |
| Journal stories | `src/content/journal/*.md` |
| Name, tagline, contact details, social links, footer line, share image | `src/data/site.json` |
| **Every small piece of interface text** ("Menu", "Look {number}", "Play the film", form labels, "min read"…) | `src/data/site.json` → `labels` |
| The template's demo notice, when present | `src/data/site.json` → `starterNotice` |
| Header links, header button, footer columns | `src/data/navigation.json` |
| Stockists, grouped by town | `src/data/stockists.json` |
| Forms — their fields, every word on them, where they send | `src/content/forms/*.json` (`newsletter`, `contact`, `stockist`) |
| Third-party scripts and the consent banner's wording | `src/data/scripts.json` (none switched on) |
| The forms' capture address, the email-link chooser's options | `src/galley/settings.json` |
| Photographs | `public/images/…`, referenced as `/images/…` |
| The shoot brief and the shot list | `galley/photography/ART-DIRECTION.md`, `shots.json` |
| Colours, fonts, spacing | `src/styles/tokens.css` (design, not content) |

**Microcopy rule:** components contain no words. To change a button or label
that is not part of a page's sections, change it in `site.json` → `labels`.

## Pages are made of sections

Each page's front matter has `title`, `description` (for search and link
previews, 120–160 characters), an optional `image` (share image), optional
`noindex: true`, and `sections` — an ordered list. Each section has a `type`
and the fields below. Markdown below the front matter, if any, follows the
sections as plain prose (good for the small print).

A good page:

1. **Opens with a `campaign-hero`, a `split-editorial` or a `statement`** —
   its heading becomes the page's `<h1>`. A `campaign-hero` first also sets
   the site header over the photograph, and it enters once on load.
2. **Sections are as tall as what they hold.** The same step of air
   (`--space-section` in `src/styles/tokens.css`) sits above and below every
   section, and two sections on the same ground share one step, so a short
   statement is a short band and a long story is a long one. Only the
   `campaign-hero` is sized to the screen. Never two `campaign-hero`s, never
   the same type twice in a row, and no layout three times running (three
   splits with the picture on the same side read as one long repeat).
3. **Pictures lead.** Words left, picture right on every split; no captions
   or descriptions under photographs (the alt text describes them).
4. **Movement stays quiet.** A `statement` with `highlight: true` (its
   words turn to ink as it is read) once a page at most; the hero enters
   once on load. Under reduced motion, or with script off, everything simply
   shows.
5. **Ends with an invitation** — a `cta`, a `newsletter`, a `form` or
   `stockists`.

Five to twelve sections. `accent` tone at most once per page; one dark band
(`inverse`) is plenty.

### Options every section accepts

| Field | Values | Notes |
| --- | --- | --- |
| `id` | short-slug | Anchor for links such as `/atelier/#people`. |
| `tone` | `default`, `muted`, `inverse`, `accent` | The ground. `inverse` is dark in light looks (light in Night); `accent` is the brand colour. |

### Shared field names

`eyebrow` (a few words above the heading, set in small capitals), `heading`,
`text` (plain text; blank lines make paragraphs), `items` (a list), `image`
+ `imageAlt`, `cta` (the main button) and `secondaryCta` (a quieter
underlined link), each `{ label, href }`; `align` (`left`/`center`),
`columns` (2–4), `ratio`, `imageSide` (`left`/`right`).

### Section reference

| type | Use it for | Fields (required in **bold**) and variants |
| --- | --- | --- |
| `campaign-hero` | The full-screen campaign photograph with the headline set on it. First on a page; once. | eyebrow, **heading**, text, cta, secondaryCta, **image**, **imageAlt**; `position` bottom-left · bottom-right · center · top-left; `scrim` shade (a dark band under the words) · plate (the words on a solid block); `size` full · tall; `imageFocus` left · center · right (the side kept on phones). Default tone inverse. |
| `split-editorial` | Words beside a photograph. | eyebrow, **heading**, text, **image**, **imageAlt**, cta, secondaryCta; `imageSide` (right, the house order, or left); `ratio` portrait · square · landscape (the crop at every width; never taller than the screen). |
| `lookbook-grid` | Looks from a lookbook, linking into it. Four in a row on a desktop. | eyebrow, heading, text, lookbook (file name; leave out for the newest), limit, `columns` 2–4, `crop` tall (2:3) · portrait (4:5) · square, `offset`, `captions`, cta. |
| `look` | One look, large, with its pieces. | eyebrow, **heading**, text, **image**, **imageAlt** (2:3), pieces[]: **name**, detail, price; `imageSide`; cta. |
| `gallery` | Several photographs. 5 for `mosaic`, 3 or 6 for `grid`, 3–4 for `row`. | eyebrow, heading, text, **items[]**: **image**, **imageAlt**; `layout` mosaic · row · grid. |
| `image-band` | One photograph across the page, between sections. | **image**, **imageAlt**; `ratio` panorama (21:9) · wide (16:9). |
| `quote` | One quotation, set large in italic. Once per page. | **quote**, **name**, role, image, imageAlt (a portrait, beside it); `size` large · medium; `align`. |
| `statement` | A sentence set large, no picture: a belief, or a quiet page opening. | eyebrow, **heading** (the statement, 12–40 words for `highlight`), text, cta; `size` large · medium; `align`; `highlight` (the words turn from grey to ink one by one as the sentence crosses the screen; once a page). |
| `pieces` | Single garments as cards with a price shown as text. Four in a row on a desktop. | eyebrow, **heading**, text, **items[]**: **image**, **imageAlt**, **name**, note, price, link; `columns` 2–4; `ratio` portrait · square; cta. |
| `story` | Writing in markdown: the label's story, directions, small print. | eyebrow, heading, **text** (markdown); `layout` single · two-column; `dropCap`. |
| `journal-list` | The latest journal stories. | eyebrow, **heading**, text, limit (default 3), tag, `layout` grid · list, cta. |
| `stockists` | The shops, grouped by town, from `stockists.json`. | eyebrow, heading, text, groups (town ids, in order; leave out for all); `layout` columns · list. |
| `marquee` | A line of words drifting across. Rarely: never on the home page. | **items** (2+ short phrases); `speed` slow · normal; `size` medium · large. Stops on hover, has a pause control, holds still with reduced motion. |
| `newsletter` | The sign-up. | eyebrow, **heading**, text, form (default `newsletter`), image, imageAlt; `layout` inline · stacked. |
| `form` | Any other form: the stockist enquiry, a fitting request. | eyebrow, **heading**, text, **form** (a file name in `src/content/forms/`), image, imageAlt. |
| `cta` | The closing invitation. | eyebrow, **heading**, text, **cta**, secondaryCta, image, imageAlt (beside the words); `align`. Default tone accent. |
| `contact` | Contact details beside a form. | eyebrow, **heading**, text, form (default `contact`), items[]: **label**, **value**, href; image, imageAlt. |
| `film` | A film's poster with a play mark, linking to where it is hosted. Nothing is embedded. | eyebrow, **heading**, text, **image**, **imageAlt**, **href**, duration ("2:48"); `ratio` wide · panorama. Default tone inverse. |
| `chapters` | Two to four steps, each with its own photograph — how a coat is made. On a desktop each step's words stay in view while its photograph scrolls past; on a phone each step stands above its picture. | eyebrow, **heading**, text, **items[]** (2–4): **heading**, **text**, **image**, **imageAlt** (shown at 4:3). |
| `credits` | Who made it: roles and names. | eyebrow, heading, **items[]**: **role**, **name**; `columns` 2–4. |

**Headings name things.** Every section heading names the product (coats,
knits), a place (Marrowby) or a part of the site, or carries a number:
"Four coats for the hour before dark", "How a coat is made, in 3 days" — not
"Four to begin with".

## Forms

Each form is one file in `src/content/forms/` — its fields, every word on it,
its thank-you and where it sends — in the site kit's format (`src/galley/`;
the full guide is Galley's `docs/forms.md`). The three here send to the
**Galley inbox**; until the site is connected (its capture address in
`src/galley/settings.json`) a form says it isn't connected yet. Change a
label, a thank-you or the error wording in the form's file; never invent a
field the label wouldn't ask for. Email addresses in content (`mailto:`
links) open a small chooser: Gmail, Outlook, the visitor's mail app, or copy.

## Lookbooks

`src/content/lookbooks/<file>.md` is the page `/collections/<file>/`.
Front matter: `title`, `season` ("Autumn–Winter 2026"), `summary` (one or
two sentences; also the page description), `date` (orders them, newest
first), `cover` + `coverAlt` (4:5), `looks` (in order: `image` 2:3, `alt`,
`caption` — one dry line — and `pieces`: `name`, `detail` (the cloth),
`price` as text), `sections` (shown after the looks — usually `credits` and
a `cta`), `draft`. Each look is linked as `#look-01`, `#look-02`…

There is no shop: prices are text, and links go to `/contact/` ("Enquire")
or `/stockists/` ("Find a stockist").

## Journal stories

`title`, `description` (one or two sentences, shown as the standfirst),
`date` (YYYY-MM-DD), `author` (the name as printed), `image` + `imageAlt`
(3:2), `tags`, `draft`. Body: an opening paragraph (set larger), then `##`
headings and short paragraphs; 350–900 words. Every tag gets a page at
`/journal/tags/<tag>/`. Reuse the tags in use — Care, Cloth, Colour, Making,
Pattern cutting, The label — before adding one. Links inside a story's body
are printed as written; if the site is served under a sub-path, link with
full addresses there.

## Images

Every photograph is listed in `galley/photography/shots.json` with its file,
size, where it is used and its alt text; the shoot brief is
`galley/photography/ART-DIRECTION.md`; how each was made is in
`galley/photography/LOG.md`. A new photograph goes in through
`scripts/ingest-photos.mjs` (README, "The photographs").

- **Shapes.** Slots crop to fit, so make the picture in the slot's shape:

| Where | Ratio | File size |
| --- | --- | --- |
| `campaign-hero` | 3:2, cropped to the screen (very tall on phones), around the shot's focus point | 2400 × 1600 |
| Lookbook looks, `look` | 2:3 | 1600 × 2400 |
| Lookbook cover, portraits, `contact` image, `quote` image | 4:5 | 1600 × 2000 |
| `pieces` | 4:5 (or 1:1 with `ratio: square`) | 1200 × 1500 |
| `split-editorial` | 4:5, 1:1 or 3:2 by `ratio` | 1600–2400 wide |
| `image-band` | 21:9 or 16:9 (4:3 on a phone) | 2400 × 1029 |
| `cta`, `newsletter`, `form` image | 4:5 | 1600 × 2000 |
| `chapters` steps | 4:3 | 1600 or wider |
| `film` poster | 16:9 | 1920 × 1080 |
| Journal covers | 3:2 | 1800 × 1200 |
| Share image (`image` on a page, `shareImage` in site.json) | 1.91:1, JPEG | 1200 × 630 |

- **Crops keep the subject.** Every photograph in
  `galley/photography/shots.json` has a `focus` point (x and y, 0–1); wherever
  a slot crops a picture, the crop is anchored on it, so heads and garments
  stay in frame at every ratio. `imageFocus: left` or `right` on a
  `campaign-hero` overrides it. Give a new photograph its own entry and focus,
  then run `npm run focus`: it copies the focus points to `src/lib/focus.json`,
  which is what the site reads.

- **No captions** under, over or beside a photograph: say it in the alt
  text, or in the section's own words.
- **Where type sits.** Only `campaign-hero` and the `film` poster set words
  on a photograph; the shade under them keeps them legible
  over anything, but choose pictures with quiet space there: bottom-left for
  a bottom-left headline, the right half for a plate on the right, the bottom
  edge of a film poster. Keep the subject on the side named by `imageFocus`.
- **Alt text** says what is in the picture in one plain sentence — who,
  wearing what, where, and the light if it matters: "A woman in a buttoned
  rust car coat looks over her shoulder at the low sun." Not "image of",
  not the caption again, not marketing. Change the alt in `shots.json` when
  you change it in content.

## Before you finish

- Every page opens with a heading-bearing section and every image has alt
  text.
- No invented facts, prices, stockists or quotes — if it isn't known, leave
  it out or ask.
- Links point at pages that exist: `/`, `/collections/`, a lookbook,
  `/atelier/`, `/journal/`, `/stockists/`, `/contact/`, `/privacy/`.
- If a page is renamed, update `navigation.json` and every `href` that
  pointed at it.
- When the site becomes a real label's, remove `starterNotice` from
  `site.json` if it is there.
