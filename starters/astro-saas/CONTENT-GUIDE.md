# Content guide

Read this before changing anything on this site. It describes the voice, the
section library, how pages are put together and the house rules. When the
site is rewritten for a real company, rewrite this guide with it — the
**Voice** section first.

## Voice

The site belongs to **Ferrow**, a fictional software company. Ferrow makes
planned-maintenance, inspection and compliance software for organizations
that run many buildings: logistics depots, schools, senior living, hotels,
clinics. Its buyers are heads of facilities and operations — practical
people who are audited.

- Calm, specific and benefit-led. Say what changes for the reader: "Know
  every site is compliant before anyone asks", not "Next-generation
  compliance orchestration".
- Concrete over abstract: name the asset (fire doors, boilers), the number
  (14 depots, 4 weeks), the person (the depot manager).
- Short sentences, US English, sentence case in headings and buttons. No
  exclamation marks, no superlatives ("best", "leading", "revolutionary"),
  no AI hype.
- Headings are statements: "Priced per site. Everyone included." — not
  "Pricing".
- Never invent facts, figures, customers, quotes, ratings or certifications.
  If a number is not known, leave the item out or ask. Security copy states
  practices, never a certification the company does not hold.
- In headings, wrap the one phrase that matters in `*asterisks*` to set it
  in the accent colour: `heading: Every inspection planned, done and *proven*.`
  Once per heading at most.

## Where things live

| What | Where |
| --- | --- |
| Pages (one file each; `index.md` is the home page, `solutions/x.md` is `/solutions/x/`) | `src/content/pages/` |
| Customer stories | `src/content/customers/` |
| Blog posts | `src/content/blog/` |
| Changelog entries | `src/content/changelog/` |
| Team members | `src/content/team/` |
| Forms — fields, wording, where they send, the thank-you | `src/content/forms/` (one JSON file each) |
| Third-party tags and the consent banner | `src/data/scripts.json` |
| Name, tagline, contact details, social links, footer line, share image | `src/data/site.json` |
| **Every small piece of interface text** (menu, "min read", table marks, the closing invitation on customer stories) | `src/data/site.json` → `labels` |
| Header drop-downs, header buttons, footer columns, legal links | `src/data/navigation.json` |
| Images | `public/images/…`, referenced as `/images/…` |
| Colours, fonts, spacing (design, not content) | `src/styles/tokens.css`; other looks in `src/styles/themes/` |

**Microcopy rule:** components contain no words. To change a label that is
not part of a page's sections — "Menu", "Read the story", "Recommended" —
change it in `site.json` under `labels`. A form's words (labels, button,
errors, thank-you) are in its own file in `src/content/forms/`.

## Pages are made of sections

A page's front matter has `title`, `description` (120–160 characters, used
in search results and link previews), an optional `image` (social share,
1200×630 PNG or JPG), optional `noindex: true`, and `sections` — an ordered
list. Each section has a `type` and the fields below. Markdown under the
front matter is shown after the sections as prose (policies, legal pages).

### Options every section accepts

| Field | Values | Notes |
| --- | --- | --- |
| `id` | short-slug | Anchor for links such as `/product/#inspections`. |
| `tone` | `default`, `muted`, `inverse`, `accent` | Background. `inverse` is the dark band; `accent` is the brand colour — at most once per page. Two neighbours with the same tone merge into one band, so alternate. |

### Shared field names

`eyebrow` (a few words above the heading), `heading`, `text` (plain text;
blank lines make paragraphs), `items` (a list), `image` + `imageAlt`, `cta`
and `secondaryCta` (each `{ label, href }`). Variants are always one of a
few named values: `align` (`left`/`center`), `imageSide` (`left`/`right`),
`frame` (`window`/`bare`), `layout`, `style`, `columns` (a number).

### Section reference

Required fields in **bold**. Defaults in brackets.

**Heroes** — exactly one, first on the page; it holds the page's `<h1>`.

| type | Use it for | Fields | Variants | Pairs with |
| --- | --- | --- | --- | --- |
| `hero` | A statement on its own: product overview, pricing, about, a listing page | announcement `{label, href}`, eyebrow, **heading**, text, cta, secondaryCta, items (short proof points) | align [`center`], grid [`true`] | `screenshot` or `pricing` next |
| `hero-split` | The home page and solution pages: statement beside a product screenshot | announcement, eyebrow, **heading**, text, cta, secondaryCta, items, **image**, **imageAlt** | imageSide [`right`], frame [`window`], grid | `logos` next |
| `hero-form` | Pages whose only job is a conversation (demo, walkthrough) | eyebrow, **heading**, text, items (what they get), **formHeading**, formText, form [`demo`], note | grid [`true`] | `features`, `comparison` |

**Proof**

| type | Use it for | Fields | Variants | Pairs with |
| --- | --- | --- | --- | --- |
| `logos` | Customer logos under a hero (4–6), or a wall of them (6–12) | heading, **items[]**: **name**, **image**, href | layout [`row`] / `grid` | after a hero |
| `metrics` | 2–4 figures that prove a claim | eyebrow, heading, text, **items[]**: **value**, **label**, text; note (the source) | columns [4], style [`plain`] / `cards` | `tone: inverse` mid-page |
| `testimonial` | One strong quote, set large. Once per page | **quote**, **name**, role, company, image (portrait), imageAlt, logo, cta (to the story) | align [`left`] / `center` | after a feature |
| `testimonials` | 2–6 shorter quotes | eyebrow, heading, text, **items[]**: **quote**, **name**, role, company, image | columns [3] (2–3), style [`cards`] / `plain` | `tone: muted` |
| `case-studies` | Cards from `src/content/customers/` | eyebrow, **heading**, text, items (story file names; omit for newest), industry (filter), limit [3], cta | layout [`grid`] / `featured` (first set large) | near the end, before `cta` |
| `awards` | Ratings or badges — only true, checkable ones | heading, text, **items[]**: **label**, detail, image, imageAlt | style [`badges`] / `ratings` | after `pricing` |

**Product**

| type | Use it for | Fields | Variants | Pairs with |
| --- | --- | --- | --- | --- |
| `features` | 3–8 benefits or capabilities with icons | eyebrow, **heading**, text, **items[]**: icon, **heading**, **text**, cta | columns [3] (2–4), style [`plain`] / `cards`, align | `feature-split` |
| `feature-split` | One capability beside its screenshot. Run 2–3 in a row, alternating `imageSide` and `tone` | eyebrow, **heading**, text, items (3 short points), **image**, **imageAlt**, cta, secondaryCta | imageSide [`right`], frame [`window`] / `bare` | itself, `steps` |
| `feature-tabs` | 3–5 product areas, one shown at a time | eyebrow, **heading**, text, **items[]**: **label** (the tab), **heading**, **text**, items, **image**, **imageAlt**, cta | layout [`horizontal`] / `vertical`, frame | after `logos` |
| `steps` | How it works or how onboarding goes, 3–5 steps | eyebrow, **heading**, text, **items[]**: **heading**, **text**, label (e.g. "Week 1"); cta | layout [`row`] / `timeline` | `integrations` |
| `integrations` | What it connects to, grouped by category | eyebrow, **heading**, text, **items[]**: **name**, **category**, icon, image, text; cta | layout [`grouped`] / `grid` | `security` |
| `comparison` | You against the alternatives | eyebrow, **heading**, text, **columns** (headings), **items[]**: **label**, **values** (one per column: `yes`, `no`, `partial` or a few words); note | highlight [1] (the column, counting from 1) | `testimonial` |
| `use-cases` | Send each kind of visitor to their page | eyebrow, **heading**, text, **items[]**: icon, label, **heading**, **text**, **href**, image, imageAlt | columns [3], style [`cards`] / `list` | the home page, the 404 page |
| `screenshot` | One large framed picture with numbered notes | eyebrow, heading, text, **image**, **imageAlt**, caption, items[]: **heading**, **text** | frame [`window`], width [`wide`] / `normal` | right after a `hero` |

**Pricing**

| type | Use it for | Fields | Variants | Pairs with |
| --- | --- | --- | --- | --- |
| `pricing` | 2–4 plans; set `featured: true` on one | eyebrow, **heading**, text, **items[]**: **name**, **price**, period, text, features[], cta, featured, badge; note | align [`center`] | `pricing-table` |
| `pricing-table` | Every feature by plan | eyebrow, **heading**, text, **plans** (names), **items[]** (groups): **heading**, **rows[]**: **label**, **values** (one per plan) | highlight [2] | `faq` |
| `faq` | 3–8 questions people really ask; answers take markdown | eyebrow, **heading**, text, **items[]**: **question**, **answer**; cta | layout [`split`] / `stacked` | before the closing `cta` |

**Content**

| type | Use it for | Fields | Variants | Pairs with |
| --- | --- | --- | --- | --- |
| `rich-text` | A passage of prose: story, commitments, small print (markdown) | eyebrow, heading, **text** | align [`left`] / `center` | `metrics`, `team` |
| `posts` | The newest blog posts | eyebrow, **heading**, text, limit [3], tag, cta | layout [`grid`] / `list` | before `cta` |
| `changelog` | The newest product updates | eyebrow, **heading**, text, limit [4], cta | layout [`list`] / `cards` | the product page |
| `team` | People from `src/content/team/` | eyebrow, **heading**, text, members (file names in order; omit for everyone), columns [3] | style [`portrait`] / `compact` | `rich-text` before it |

**Trust and conversion**

| type | Use it for | Fields | Variants | Pairs with |
| --- | --- | --- | --- | --- |
| `security` | How data is protected — practices, not claims | eyebrow, **heading**, text, **items[]**: icon, **heading**, **text**; badges (short chips), cta | layout [`grid`] / `split` | `faq` |
| `cta` | The closing invitation. Last on most pages | eyebrow, **heading**, text, **cta**, secondaryCta | tone [`inverse`], align [`left`], style [`band`] / `panel` | anything; always last |
| `contact` | Contact details beside a form | eyebrow, **heading**, text, form [`contact`], items[]: **label**, **value**, href | — | `newsletter` |
| `newsletter` | An email sign-up in one line | eyebrow, **heading**, text, form [`newsletter`], note | layout [`inline`] / `stacked` | after `contact`, before the footer |
| `form` | Any form on any page: a demo request at the end of a solution page, a survey, a waiting list | eyebrow, heading, text, **form** (a file name in `src/content/forms/`), note | layout [`stacked`] / `split` | last on a page, instead of `cta` |

Icons for `features`, `use-cases`, `integrations` and `security`:
`calendar`, `checklist`, `wrench`, `shield`, `certificate`, `chart`, `pin`,
`building`, `users`, `bell`, `clock`, `phone`, `offline`, `plug`, `key`,
`lock`, `server`, `globe`, `layers`, `sync`, `inbox`, `webhook`, `code`,
`table`, `truck`, `gauge`, `receipt`, `directory`, `database`, `eye`,
`camera`, `route`, `flag`, `document`. Leave `icon` out of a `features`
item and it is numbered instead.

### Page recipes

Five to nine sections is right for most pages. Do not put the same type
twice in a row, except `feature-split`.

- **Home:** `hero-split` → `logos` → `feature-tabs` → `metrics` (inverse) →
  `use-cases` → `testimonials` (muted) → `case-studies` → `posts` → `cta`.
- **Product page:** `hero` → `screenshot` → `feature-split` ×3 (alternate
  side and tone) → `steps` → `integrations` → `changelog` → `cta`.
- **Solution page (one audience):** `hero-split` → `logos` → `features`
  (cards) → `feature-split` → `metrics` → `testimonial` (inverse) → `faq` →
  `cta`. With a form instead: `hero-form` → `features` → `comparison` →
  `steps` → `testimonial` → `cta` (panel).
- **Pricing:** `hero` → `pricing` → `pricing-table` → `awards` (ratings) →
  `faq` (stacked) → `cta` (centre).
- **Customers:** `hero` → `case-studies` (featured, limit 12) → `metrics` →
  `logos` (grid) → `testimonials` → `cta`.
- **About:** `hero` (left) → `rich-text` → `metrics` → `team` →
  `features` (inverse) → `awards` → `cta` (panel).
- **Security:** `hero` → `security` (split) → `rich-text` → `faq` → `cta`.
- **Contact:** `contact` → `newsletter`.

Ready-made versions of these live in `galley/templates/` (landing, product,
solution, pricing, customer story, about, contact): start a new page from
one rather than from nothing.

## Forms

One JSON file per form in `src/content/forms/`; the file name is the id a
section names (`form: demo`). The format is the site kit's (validated by
`src/galley/schema.js`): `name`, `submitLabel`, optional `steps`,
`fields` (`id`, `type`, `label`, `required`, `width: "half"`, `help`,
`options`, `showWhen`, `validation`, `autofill`), `destinations`,
`afterSubmit` and `errorMessage`. The forms here:

- `contact` — name, work email, company, topic, message.
- `demo` — two steps ("About you", "Your estate"); work email only
  (`businessEmailOnly`); hidden `utm_source`, `utm_medium`, `utm_campaign`
  filled from the campaign tags on the page's address (to remember a
  campaign across pages, switch each field's `autofill.from` to `"utm"` —
  that stores it on the visitor's device, so the site then shows its
  consent banner); a `generate_lead` event
  and a thank-you by first name.
- `newsletter` — one email field, inline, hidden label.

Every form sends to the inbox (`"provider": "galley"`). Keep wording in the
voice above: labels are short nouns ("Work email"), the button says what
happens ("Request a walkthrough"), the thank-you says who replies and
when. Links inside form texts are written from the site root
(`[privacy policy](/privacy/)`). Don't add a field you don't need; every
field costs answers.

`src/data/scripts.json` lists third-party tags (none yet) behind the
built-in consent banner. Only add a tag the site owner asked for, with
their real id.

## Customer stories

Front matter: `company`, `industry` (one of Logistics, Senior living,
Education, Hospitality, Food manufacturing, Healthcare, Retail), `logo`,
`headline` (the result, in one sentence, with a number), `summary` (two
sentences), `date`, `image` + `imageAlt` (a screenshot of what they use),
`facts` (`{ label, value }`: sites, team size, customer since, plan),
`results` (`{ value, label, text }`, 2–3), `quote` (`{ text, name, role,
image }`), `featured`, `draft`. Body: an opening paragraph, then
`## The problem`, `## What they did`, `## What changed` (a short list of
results), `## What's next`. 300–600 words. Every figure must come from the
customer.

## Blog posts

Front matter: `title`, `description` (one or two sentences), `date`,
`author` (a team member's file name such as `hana-lindqvist`, or a guest's
full name), `image`, `imageAlt`, `tags`, `draft`. Body: an opening
paragraph, then `##` headings, short paragraphs, at most one list and one
quote per section. 500–1,000 words. Reuse the tags in use — Compliance,
Guides, Inspections, Operations, Product, Reporting, Work orders — before
adding one; each gets its own page at `/blog/tags/<tag>/`.

## Changelog

One file per release: `title` (what changed, for the reader), `date`,
`version`, `tags` (any of `New`, `Improved`, `Fixed`), optional `image` +
`imageAlt`, `draft`. Body: one paragraph on what it means for the
customer, then a short list of details. The entry's anchor is its file
name: `/changelog/#offline-inspections`.

## Team members

`name`, `role`, `photo`, `bio` (two sentences), `order` (lower comes
first), `links` (`{ label, href }`, optional). The file name is the id used
by `team` sections and blog `author`.

## Images

- Put files in `public/images/` (`product`, `logos`, `people`, `blog`,
  `awards`) and reference them as `/images/folder/file.svg`.
- Every image that carries meaning needs alt text saying what it shows.
- SVG files are drawn into the page, so they take the look's colours: the
  product screenshots, logos and portraits use the `.s-*` classes from
  `src/styles/global.css` (logos use `currentColor`). Raster images (PNG,
  JPG, WebP) are shown as they are.

| Where | Shape |
| --- | --- |
| Product screenshots (`hero-split`, `feature-split`, `feature-tabs`, `screenshot`, story and changelog images) | 16:10 — the files are 1600×1000 |
| Blog `image`, `use-cases` image | 16:10 |
| Logos | 3:1 (180×60), transparent, one colour |
| Portraits (`team`, quotes) | 4:5 (400×500); quotes crop to a circle, keep the face centred |
| Award badges | 1:1 |
| Share image (`image` on a page, `shareImage` in site.json) | 1200×630 PNG or JPG |

## Before you finish

- One hero (or another section with a heading) first; usually one `cta`
  last; tones alternate.
- No placeholder text and no invented facts, numbers, quotes, logos or
  ratings.
- Links point at pages that exist: `/product/`, `/solutions/facilities-teams/`,
  `/solutions/service-contractors/`, `/pricing/`, `/customers/`, `/about/`,
  `/security/`, `/contact/`, `/blog/`, `/changelog/`, `/privacy/`, `/terms/`.
- If a page is renamed, update `navigation.json` and every `href` that
  pointed at it.
- When the site is rewritten for a real company, remove `starterNotice`
  from `site.json` if it is there.
