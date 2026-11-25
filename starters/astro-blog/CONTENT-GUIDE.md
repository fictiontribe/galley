# Sarking — content guide

Read this before changing anything. It is the house style and the map of the
content. The sample blog, Sarking, is invented: its people, house and numbers
are made up to show what the template does.

## Voice

- One person writing about one house: first person, plain words, short
  sentences. "I" for the author, never "we".
- Evidence over opinion. Every number has a source, in the post's `sources`
  or under the chart. Say when something is an estimate.
- No selling and no hype. Nothing is "game-changing". Brands are not named;
  describe the thing ("a 7 kW air-source heat pump").
- Headlines say what the post found or does, in sentence case, without a
  full stop: "Heat pump or a new boiler? What the numbers said".
- British spelling and units: °C, kWh, £, metres.

## Where things live

| What | Where |
| --- | --- |
| Posts | `src/content/blog/<slug>.md` → `/blog/<slug>/` |
| Authors | `src/content/authors/<slug>.md` → `/authors/<slug>/` |
| Series | `src/content/series/<slug>.md` → `/series/<slug>/` |
| Pages built from sections | `src/content/pages/<slug>.md` → `/<slug>/`; `index.md` is the home page |
| Forms | `src/content/forms/newsletter.json`, `contact.json` |
| Name, tagline, social links, every interface word | `src/data/site.json` (`labels`) |
| Header, footer and legal links | `src/data/navigation.json` |
| AI crawlers, llms.txt, structured data | `src/data/visibility.json` |
| Photographs | `public/images/blog/`, `public/images/people/` — written in content as `/images/…` |

**Microcopy rule:** components contain no words. A label a visitor sees —
"Read next", "min read", "The numbers" — is in `site.json` → `labels`. Change
it there.

## Posts

Front matter:

| Field | |
| --- | --- |
| **`title`** | The headline. |
| **`description`** | The standfirst under the headline: one or two sentences, about 30 words. Also the search and feed summary. |
| **`date`** | Publication date, `YYYY-MM-DD`. A date in the future keeps the post out of the build until that day. |
| `updated` | When it last changed in substance. Add a `revisions` entry saying what changed. |
| **`author`** | An author's file name: `ines-calloway`, `dougal-reay`. |
| `tags` | Two or three, from the topics already in use (Data, Heating, Costs, Insulation, Draughts, Windows, Solar, Tools, How-to). A new tag makes a new topic page. |
| `series`, `seriesPart` | A series' file name and the post's place in it. |
| **`image`**, **`imageAlt`** | The cover, 3:2, also the share image. Alt text describes the photograph for someone who can't see it. |
| `imageCaption` | A line under the cover that adds something the picture doesn't say. |
| `takeaways` | Two to four sentences shown as "In short" above the post. Each is a finding, not a teaser. |
| `sources` | `{ title, href?, note? }` for everything a number rests on. |
| `ai` | `none`, `research`, `editing` or `drafting` — how AI was used. Shown at the end in the words from `site.json`. Be honest. |
| `revisions` | `{ date, note }` for each change after publication. |
| `toc` | `false` to hide the contents list (shown when a post has three or more `##` headings). |
| `featured` | `true` to lead the home page with it. |
| `canonical` | The first home of a post published elsewhere first. |
| `draft` | `true` keeps it out of the build (it shows in `npm run dev`). |

The body is Markdown — never MDX. Use `##` for sections and `###` under them;
the headline is the only `#`. Link to other posts from the site root:
`[the loft](/blog/insulating-the-loft-with-wool/)`.

### Built into Markdown

- **Callouts:** a quote that starts `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`,
  `[!WARNING]` or `[!CAUTION]`. One per section at most.
- **Figures:** `![alt text](/images/blog/loft.webp "Caption")` — the title in
  quotes becomes the caption.
- **Code:** fenced with its language; `title="meter.py"` after the language
  adds a file name. Every block gets a copy button.
- **Footnotes:** `[^1]` in the text and `[^1]: …` at the end.
- **Tables:** GFM tables, for small ones. Use `compare` for anything you'd
  call a comparison.

### Embeds

An embed is a fenced block whose language names it; its YAML is the fields.
On GitHub, or in any editor, it reads as YAML. A block that doesn't fit its
schema fails the build and names the post and the field; in `npm run dev` it
shows the problem in place. The same fields make a page section of the same
name (see below).

| Block | For | Fields (**required**) | Variants and defaults |
| --- | --- | --- | --- |
| ```` ```chart ```` | Numbers that change or compare | **`labels`**, **`series`** (`name`, `values` lined up with `labels`), `title`, `text`, `unit`, `prefix`, `highlight` (a series name), `min`, `max`, `notes` (`{ at, label }`), `source` | `chart`: `line` (default; change over time), `area` (a total over time), `column` (few categories), `bar` (ranked, long labels), `stacked` (parts of a whole). `width`: `wide` (default) or `text` |
| ```` ```compare ```` | Options side by side | **`columns`**, **`rows`** (`label`, `values`, `group` starts a block of rows, `note`), `title`, `text`, `highlight` (column number from 1), `badge`, `source` | "yes", "no", "partly" become marks. `width`: `wide` |
| ```` ```stats ```` | Two to four headline figures | **`items`** (`value`, `label`, `change`, `trend`: `good`/`bad`/`neutral`), `title`, `source` | `width`: `text` |
| ```` ```verdict ```` | The end of a review | **`title`**, **`summary`**, `score`, `outOf` (5), `pros`, `cons`, `bestFor` | — |
| ```` ```proscons ```` | For and against | **`pros`**, **`cons`**, `title`, `prosLabel`, `consLabel` | — |
| ```` ```timeline ```` | Dated events | **`items`** (`date`, `title`, `text`), `title` | — |
| ```` ```steps ```` | How to do something | **`items`** (`title`, `text`, `meta` — a time or cost), `title` | — |
| ```` ```faq ```` | Questions readers ask | **`items`** (`question`, `answer` in Markdown), `title` | — |
| ```` ```gallery ```` | Several photographs | **`items`** (`image`, `imageAlt`, `caption`), `title`, `columns` (2–4, default 2) | `width`: `wide` |
| ```` ```pullquote ```` | A line worth slowing down for | **`quote`**, `name`, `role` | — |
| ```` ```video ```` | A film hosted elsewhere | **`title`**, **`href`**, **`image`**, **`imageAlt`**, `duration`, `caption` | Nothing is embedded; it links out |
| ```` ```takeaways ```` | Points to take away, mid-post | **`items`**, `title` (default "In short") | — |

Chart rules: one idea per chart; say what to see in `text`; start columns and
bars at zero (only line charts may use `min`); use `highlight` when one series
is the story; always give a `source`. Quote YAML values that look like
numbers but aren't (`"2025"` as a series name, `"−66%"`).

Example:

````md
```chart
chart: line
title: Monthly energy use, 2023 and 2025
labels: [Jan, Feb, Mar, Apr, May, Jun]
series:
  - name: "2023"
    values: [2900, 2600, 2200, 1500, 900, 600]
  - name: "2025"
    values: [980, 860, 700, 450, 300, 240]
highlight: "2025"
unit: kWh
source: Monthly meter readings.
```
````

A post usually reads: standfirst → "In short" → a paragraph that sets up the
question → `##` sections, each with at most one embed → a closing section on
what comes next → sources.

## Pages and sections

Pages in `src/content/pages/` are a list of `sections` in front matter, then
an optional Markdown body shown below them. Every section takes `id` (an
anchor) and `tone` (`default`, `muted`, `inverse`, `accent`). In a heading,
`*word*` is set in the accent colour — once per heading at most.

| Section | Use it for | Fields (**required**) | Variants |
| --- | --- | --- | --- |
| `intro` | The top of a page | **`heading`**, `eyebrow`, `text`, `cta`, `secondaryCta`, `image`, `imageAlt` | `layout`: `statement` (default), `portrait` (round portrait beside) |
| `featured` | The lead post and a few more | `heading`, `post` (a file name), `more` (0–6, default 3) | `layout`: `lead` (default), `split` |
| `posts` | A list of posts | `eyebrow`, `heading`, `text`, `tag`, `offset`, `limit` (6), `cta` | `layout`: `list` (default), `cards`, `index` |
| `topics` | Every topic | `eyebrow`, `heading`, `text`, `counts` (true) | — |
| `series` | The series | `eyebrow`, `heading`, `text`, `items` (file names) | — |
| `author` | One author, large | **`author`**, `heading`, `text`, `cta` | — |
| `newsletter` | The sign-up | **`heading`**, `eyebrow`, `text`, `form` (newsletter), `note` | `layout`: `inline` (default), `stacked` |
| `rich-text` | Writing | **`text`** (Markdown), `eyebrow`, `heading` | `layout`: `column` (default), `margin` |
| `image` | One photograph | **`image`**, **`imageAlt`**, `caption` | `size`: `text`, `wide` (default), `full`; `ratio`: `landscape`, `wide` (default), `panorama` |
| `cta` | Closing a page | **`heading`**, **`cta`**, `eyebrow`, `text`, `secondaryCta` | tone defaults to `muted` |
| `contact` | Contact details and form | **`heading`**, `eyebrow`, `text`, `form` (contact), `items` (`label`, `value`, `href`) | — |
| `chart`, `compare`, `stats`, `timeline`, `faq`, `pullquote`, `gallery` | As the embeds above | as above | as above |

Page recipes:

- **Home:** intro (portrait) → featured → chart (`tone: muted`) → posts
  (`offset` past the featured ones) → series → topics.
- **About:** intro → image (panorama) → rich-text (margin) → stats → timeline
  → author → faq.
- **Topic landing:** intro → featured → posts (`tag`, cards) → newsletter.

## Authors and series

An author's front matter: **`name`**, **`role`**, **`photo`** (4:5),
`photoAlt`, **`bio`** (one or two sentences, shown under posts), `links`. The
body is the longer bio on their page.

A series: **`title`**, **`description`**, `image`, `imageAlt`, `ongoing`.
Posts join it with `series` and `seriesPart`.

## Photographs

- Covers 3:2, at least 1600 px wide; portraits 4:5; banners 21:9.
- `npm run photos -- <folder>` places the sample's photographs by name, in two
  sizes, and records their sizes in `src/lib/images.json`. Pictures added any
  other way work as they are.
- Documentary photographs of real things. No text in pictures, no stock
  "concept" images.

## Before you finish

- Every number has a source; estimates say so.
- `description` reads well on its own, under 200 characters.
- Alt text on every image that carries meaning; empty only for decoration.
- Tags come from the existing list unless a new topic is really new.
- Embeds validate: `npm run build` passes.
- Links between posts start from the site root (`/blog/…`).
- If the post changed after publishing: `updated` and a `revisions` entry.
