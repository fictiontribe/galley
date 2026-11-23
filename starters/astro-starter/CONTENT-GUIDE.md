# Content guide

Read this before changing anything on this site. It describes the voice, the
building blocks and the house rules. When the site is rewritten for a new
business, rewrite this guide with it — especially the **Voice** section.

## Voice

The site belongs to **Lowfield Studio**, a fictional four-person architecture
studio in a fictional town, Wrenhallow. It designs extensions, loft conversions,
garden rooms and renovations for ordinary houses.

- Warm, plain-spoken and specific. Write like a good neighbour who happens to
  be an architect: "We measure the whole house", not "We deliver holistic
  spatial solutions".
- Short sentences. British spelling. No exclamation marks, no superlatives
  ("best", "leading", "world-class").
- Concrete over abstract: name the room, the street, the number of weeks.
- Honest about cost and time. Never promise outcomes the studio cannot control
  (planning decisions, builders' prices).
- Headings are statements, not labels: "Fixed fees, agreed before we start",
  not "Our pricing".

## Where things live

| What | Where |
| --- | --- |
| Pages (one file each; `index.md` is the home page) | `src/content/pages/*.md` |
| Blog posts | `src/content/blog/*.md` |
| Blog authors (the team, and guests) | `src/content/authors/*.md` |
| Team members | `src/content/team/*.md` |
| Forms — fields, wording, where they send, the thank-you | `src/content/forms/*.json` |
| Third-party tags and the consent banner | `src/data/scripts.json` |
| Site name, tagline, contact details, social links, footer line, share image | `src/data/site.json` |
| **Every small piece of interface text** (menu, "min read", pagination…) | `src/data/site.json` → `labels` |
| The template's demo notice (the bar above the header), when present | `src/data/site.json` → `starterNotice` |
| Header links, header button, footer columns | `src/data/navigation.json` |
| Images | `public/images/…`, referenced as `/images/…` |
| Colours, fonts, spacing | `src/styles/tokens.css` (design, not content); other looks in `src/styles/themes/` |

**Microcopy rule:** components contain no words. If you need to change a
label that is not part of a page's sections — "Menu", "Back to the
journal" — change it in `site.json` under `labels`. A form's words (labels,
button, errors, thank-you) are in its own file in `src/content/forms/`.

## Pages are made of sections

Each page's front matter has `title`, `description` (used for search results
and link previews, 120–160 characters), an optional `image` (social share,
1200×630), optional `noindex: true`, and `sections` — an ordered list. Each
section has a `type` and the fields below. Markdown below the front matter,
if any, is shown after the sections as plain prose (good for policies).

A good page shape:

1. **One `hero` first** — it holds the page's main heading.
2. **3–7 sections** in the middle that each make one point. Alternate
   text-heavy and visual sections; vary `tone` so neighbouring sections do not
   all sit on the same background.
3. **One `cta` last.**

Five to nine sections is right for most pages. Do not repeat a section type
twice in a row.

### Options every section accepts

| Field | Values | Notes |
| --- | --- | --- |
| `id` | short-slug | Anchor for links such as `/about/#team`. |
| `tone` | `default`, `muted`, `inverse`, `accent` | Background. `inverse` is dark; `accent` is the brand colour — use it at most once or twice per page. |

### Shared field names

`eyebrow` (a few words above the heading), `heading`, `text` (plain text;
blank lines make paragraphs), `items` (a list), `image` + `imageAlt`,
`cta` and `secondaryCta` (each `{ label, href }`), `align` (`left`/`center`),
`columns` (2–4).

In headings, wrap words in `*asterisks*` to set them in the accent italic:
`heading: Make more of the *home you already have*.` Use it once per heading,
on the words that matter.

### Section reference

| type | Use it for | Fields (required in **bold**) |
| --- | --- | --- |
| `hero` | The opening of a page. Always first. | eyebrow, **heading**, text, cta, secondaryCta, image, imageAlt, align |
| `logos` | A quiet row of clients or partners. 4–6 logos. | heading, **items[]**: **name**, **image**, href |
| `features` | Services, benefits, principles. 3–8 items. | eyebrow, **heading**, text, columns, **items[]**: icon, **heading**, **text**, cta |
| `split` | One idea with a picture. | eyebrow, **heading**, text, items (list of short strings), **image**, **imageAlt**, imageSide (`left`/`right`), cta, secondaryCta |
| `stats` | 2–4 numbers that prove a claim. | eyebrow, heading, text, columns, **items[]**: **value**, **label**, text |
| `steps` | A process, in order. 3–6 steps. | eyebrow, **heading**, text, **items[]**: **heading**, **text**, cta |
| `testimonial` | One strong quote, set large. Once per page. | **quote**, **name**, role, image, imageAlt |
| `testimonials` | Several shorter quotes. 3–6. | eyebrow, heading, columns (2–3), **items[]**: **quote**, **name**, role |
| `pricing` | Plans or packages. 2–4. | eyebrow, **heading**, text, **items[]**: **name**, **price**, period, text, features[], cta, featured, badge; note |
| `faq` | Questions people actually ask. 3–8. | eyebrow, **heading**, text, **items[]**: **question**, **answer** (markdown) |
| `gallery` | Pictures of work. 3, 6 or 9 images. | eyebrow, heading, text, columns, **items[]**: **image**, **imageAlt**, caption |
| `team` | People from `src/content/team/`. | eyebrow, **heading**, text, members (file names, in order; omit for everyone), columns |
| `posts` | The latest blog posts. | eyebrow, **heading**, text, limit (default 3), tag, cta |
| `rich-text` | A passage of prose: story, directions, small print. | eyebrow, heading, **text** (markdown), align |
| `cta` | The closing invitation. Last on the page. | eyebrow, **heading**, text, **cta**, secondaryCta, align. Defaults to `tone: accent`. |
| `contact` | Contact details beside a form. The contact page's main section. | eyebrow, **heading**, text, form (a file name in `src/content/forms/`, default `contact`), items[]: **label**, **value**, href |
| `form` | Any form on any page — a quote request, a waiting list. | eyebrow, heading, text, **form** (a file name in `src/content/forms/`), note, layout (`stacked`/`split`) |

Icons available to `features` items: `compass`, `ruler`, `pencil`, `home`,
`layers`, `leaf`, `sun`, `key`, `hammer`, `chat`, `calendar`, `clipboard`,
`mail`, `pin`, `clock`, `check`. Leave `icon` out and the item is numbered
instead.

### Page recipes

- **Home:** `hero` → `logos` → `features` → `split` → `stats` → `steps` →
  `testimonial` → `posts` → `cta`.
- **A service:** `hero` → `features` → `steps` → `faq` → `cta`.
- **A project story:** `hero` → `split` → `gallery` → `testimonial` → `cta`.
- **Pricing:** `hero` → `pricing` → `faq` → `form` (a quote request) → `cta`.
- **Contact:** `contact` → `rich-text` (how to find you).

`galley/templates/` has these as ready pages to start from.

## Forms

One JSON file per form in `src/content/forms/`; the file name is the id a
section names (`form: contact`). The format is the site kit's (checked by
`src/galley/schema.js`): `name`, `submitLabel`, `fields` (`id`, `type`,
`label`, `required`, `width: "half"`, `help`, `options`, `showWhen`,
`validation`), `destinations`, `afterSubmit` and `errorMessage`.
`contact.json` asks for name, email, phone, what they're planning, a
message and whether they'd like a first visit, and thanks them by name.

Every form sends to the inbox (`"provider": "galley"`). Labels are short
and plain ("Your name"); the button says what happens ("Send message"); the
thank-you says who replies and when. Links inside form texts are written
from the site root. Don't add a field you don't need.

`src/data/scripts.json` lists third-party tags (none yet) behind the
built-in consent banner. Only add a tag the site owner asked for, with
their real id.

## Blog posts

Front matter: `title`, `description` (one or two sentences), `date`
(YYYY-MM-DD), `author` (a file name in `src/content/authors/`, such as
`nell-okafor` — add a file there for a new or guest writer), `image`, `imageAlt`, `tags` (list), `draft` (`true` keeps
it off the live site). Body: an opening paragraph, then `##` headings, short
paragraphs, at most one list and one quote per section. 500–1,000 words.

Every tag gets its own page at `/blog/tags/<tag>/`, made automatically. Reuse
the tags already in use — Extensions, Living with building work, Older homes,
Planning, Planning ahead, Process — before adding a new one, and never add
two spellings of the same idea.

## Team members

`name`, `role`, `photo`, `bio` (two sentences), `order` (lower comes first),
`links` (list of `{ label, href }`, optional). The file name is the id used by
`team` sections.

## Authors

`name`, `role` (a job title, or "Guest writer"), `photo` (optional, 4:5),
`bio` (two sentences about what they write). The file name is what a post's
`author` names. Team members who write have a file here too.

## Images

- Put files in `public/images/` (sub-folders: `projects`, `gallery`, `blog`,
  `team`, `people`, `logos`) and reference them as `/images/folder/file.svg`.
- Every image that carries meaning needs alt text describing what it shows.
- Images are cropped to fit, so keep the subject centred. Expected shapes:

| Where | Aspect ratio |
| --- | --- |
| `hero` with `align: left` | 4:5 (portrait) on wide screens, 4:3 on phones |
| `hero` with `align: center` | 21:9 (panorama) |
| `split` | 5:4 |
| `gallery` | 4:3 |
| `team` photos | 4:5 |
| Blog `image` | 16:9 on the post, 3:2 in lists — compose for both |
| `testimonial` image | 1:1, shown as a small circle |
| `logos` | about 3:1, on a transparent background; SVGs drawn in `currentColor` follow the look |
| Share image (`image` on a page, `shareImage` in site.json) | 1200×630 PNG or JPG |

## Before you finish

- Each page has exactly one `hero` (or another section with a heading) first
  and usually one `cta` last.
- No placeholder text, no invented facts, prices, quotes or statistics — if a
  number is not known, leave the item out or ask.
- Links point at pages that exist (`/about/`, `/services/`, `/pricing/`,
  `/contact/`, `/blog/`, `/privacy/`).
- If a page is renamed, update `navigation.json` and any `href` that pointed
  at it.
- When the site is rewritten for a real business, remove `starterNotice` from
  `site.json` if it is there.
