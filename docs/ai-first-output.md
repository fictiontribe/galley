# The agent-readable version of your site

Every site built with Galley's site kit also publishes a version of itself
for AI agents and search systems: the same words as the pages, in plain
markdown, with no scripts, layout, cookie banner or tracking — plus the
files those systems look for (`llms.txt`, `robots.txt`, `sitemap.xml`) and
structured data where the site's own facts allow it. It is made from the
pages as they are built, so it always says what the pages say.

This page is in two parts: [for site owners](#for-site-owners) (what your
site now publishes, the crawler choices, and what this does and does not do
for visibility) and [for developers](#for-developers) (addresses, formats,
the data file, how the markdown is made, vendoring). The
[sources](#sources) are at the end; every one was read on 23 November 2026.

---

## For site owners

### What your site publishes

| Address | What it is |
| --- | --- |
| `/about.md` (for `/about/`), `/index.md` (for the home page) | A **markdown version of each page**: its title, description, address and dates at the top, then the page's main content — headings, paragraphs, lists, tables, links, pictures with their descriptions. No menus, footers, forms, scripts or banners. |
| `/llms.txt` | A **contents page for AI systems**: the site's name, a one-line summary, then every page, grouped, each with its description, linking to its markdown version. Pages you mark as secondary (a privacy policy) are listed last under "Optional". |
| `/llms-full.txt` | **The whole site in one file**: every markdown version, one after another, up to 1 MB. If the site is bigger, the file says where it stops and points to `llms.txt`. |
| `/agent.md` | **A short guide for an AI agent**: what the site is, where everything above is, how to cite the site (the page's own address, not the markdown copy) and how to reach you. |
| `/robots.txt` | **The crawling rules**: site-wide rules, then your choice for each AI crawler. Written only if your site doesn't already have one. |
| `/sitemap.xml` | **Every page address** for search engines, with the date a page was last changed when the page or its content states one. Written only if your site doesn't already have one. |
| In each page | A hidden line in the page's head pointing to its markdown version, and **structured data** (described below). Nothing that runs, and nothing a visitor sees. |

Pages kept out of search (`noindex`), drafts, the "page not found" page,
redirects and pages that say another page is the real one are left out of
everything.

Structured data is added only where it is complete and true:

- on the **home page**, the site's name and address (Google uses it for the
  name shown with your results) and your organisation's name, address and —
  if you give them — logo and profile links;
- on **posts and articles**, the headline, the publication date, the date it
  was last changed, the author and the picture, each only when the page
  states it — the site's general sharing picture is never passed off as a
  post's picture;
- on **pages two or more levels deep**, the trail to them (Home › Blog › This
  post), which Google can show in place of the address on desktop.

### Choosing which AI crawlers may visit

robots.txt rules are a **request**: reputable crawlers say they follow them;
nothing forces them to. The choice is between **being found and cited** by AI
assistants and **being used to train AI models** — and they are separate:
blocking one doesn't block the other.

| Crawler | Whose | What it is for | What the provider says blocking does |
| --- | --- | --- | --- |
| `GPTBot` | OpenAI | Training | Content shouldn't be used to train its models. |
| `OAI-SearchBot` | OpenAI | AI search (ChatGPT search) | The site isn't shown in ChatGPT search answers (it may still appear as a plain link). |
| `ChatGPT-User` | OpenAI | Fetching a page a person asked for | OpenAI says robots rules may not apply, as a person started the visit. |
| `ClaudeBot` | Anthropic | Training | Future pages are left out of training data. |
| `Claude-SearchBot` | Anthropic | AI search | Not indexed for Claude's search; may reduce visibility there. |
| `Claude-User` | Anthropic | Fetching a page a person asked for | Claude can't fetch the page for the person who asked. |
| `PerplexityBot` | Perplexity | AI search (not training, it says) | Not surfaced in Perplexity's results. |
| `Perplexity-User` | Perplexity | Fetching a page a person asked for | Perplexity says it generally ignores robots.txt. |
| `Google-Extended` | Google | Gemini training and grounding — a setting, not a crawler | No effect on Google Search or its ranking. AI Overviews and AI Mode are part of Search. |
| `Applebot-Extended` | Apple | Apple's model training — a setting, not a crawler | Pages can still appear in Spotlight, Siri and Safari search. |
| `CCBot` | Common Crawl | An open web archive, widely reused as training data | New crawls leave the site out; copies already published stay. |

Nothing is blocked unless you choose it. A common choice is "block
training, allow AI search": `GPTBot`, `ClaudeBot`, `Google-Extended`,
`Applebot-Extended` and `CCBot` blocked, the search crawlers allowed.

### What this does — and doesn't — do for visibility

Honestly:

- **It doesn't change your Google ranking.** Google says its search doesn't
  use llms.txt or markdown copies, and that creating them "will neither harm
  nor help your site's visibility or rankings in Google Search". It also says
  there is no special markup for its AI features; structured data helps with
  rich results, not with AI.
- **Few AI systems read llms.txt today.** A study of 137,210 sites (Ahrefs,
  June 2026) found 28 % publish one and 97 % of those files received no
  requests at all in May 2026. No major AI provider has committed to reading
  it.
- **What it does do:** an agent that is sent to your site — by a person
  asking an assistant, or by a tool that reads `llms.txt` — gets your words
  cleanly, without having to run scripts or dig through menus and cookie
  banners. That is a reading convenience, not a promise of being cited.
- **The crawler choices do what each provider says they do**, within the
  limit that robots.txt is a request.

Galley makes no promise of rankings, traffic or citations.

---

## For developers

### Turning it on

With the package: `galley()` in `astro.config` — it is on by default
(`galley({ visibility: false })` turns it off, `galley({ visibility: { file } })`
reads another data file). With a vendored kit (`scripts/vendor.mjs`, how the
starters ship it):

```ts
// astro.config.ts
import galley from "./src/galley/integration.js";

export default defineConfig({
  site: "https://www.example.com",
  integrations: [galley()],
});
```

The vendored `integration.js` runs only this part; forms, scripts and email
links stay file-driven through the components. `site` must be set for
anything that needs full addresses (structured data, the sitemap, the
sitemap line in robots.txt); without it, twins and llms.txt use addresses
from the site root and the build says what was left out.

### Addresses and formats

| | Address | Content type | Format |
| --- | --- | --- | --- |
| Twin | `<page without its trailing slash>.md`; the home page `index.md` — `/about/` → `/about.md`, `/blog/post/` → `/blog/post.md`, `/about.html` → `/about.md`. Under a base path: `/docs/about.md`, `/docs/index.md`. | `text/markdown` | YAML front matter (`title`, `description`, `canonical`, `language`, `published`, `last_modified` — the last two only when known; values JSON-quoted), a blank line, the markdown. |
| Index | `/llms.txt` | `text/plain` | [llmstxt.org v2](https://llmstxt.org/): `# Site name`, `> summary`, one plain paragraph, then `## Section` lists of `- [Page name](twin address): description`, `## Optional` last. At most 2,000 links (the rest are named in the sitemap). |
| Everything | `/llms-full.txt` | `text/plain` | The index's heading and summary, then each twin's body after `---` and a `Source: <canonical>` line, in the index's order; stops before `agentReadable.fullMaxBytes` (1,000,000) with a sentence saying how many pages are left. |
| Agent guide | `/agent.md` | `text/markdown` | Headings: where things are, how to cite, contact, about this file. |
| Robots | `/robots.txt` | `text/plain` | `User-agent: *` with the site-wide rules (`Allow: /` when there are none), one commented group per named crawler, `Sitemap:` last. |
| Sitemap | `/sitemap.xml` | `application/xml` | `<urlset>` of canonical addresses, `<lastmod>` (a date) only from dates the page or its content entry states; split into `sitemap-N.xml` with an index above 50,000 addresses. |
| In `<head>` | before `</head>` | — | `<link rel="alternate" type="text/markdown" href="/about.md">`, then `<script type="application/ld+json" data-galley-jsonld>` blocks. |

Why `/about.md` and not `/about/index.html.md`: the llms.txt proposal allows
both ("with `.md` appended … or with the extension replaced by `.md`"; for
addresses without a file name, `index.html.md` or `index.md`). `/about.md` is
a plain file beside the page's folder: it works on every static host and
under any sub-path with no rewrite rules, and it is the form this project's
own website already uses. A page at `/agent/` would claim `/agent.md`; its
twin wins and the build says the agent guide was left out.

The output is deterministic: pages are read in path order, nothing carries a
time stamp, and the same build gives the same bytes (tested).

### The data file

`src/data/visibility.json` (optional; every key optional, every part can be
`false`):

```json
{
  "site": { "name": "Ferrow", "summary": "One sentence about the site." },
  "crawlers": { "GPTBot": "block", "CCBot": "block", "OAI-SearchBot": "allow" },
  "robots": { "disallow": ["/drafts/"], "allow": [] },
  "sitemap": { "exclude": ["/thanks/"], "lastmod": "content" },
  "structuredData": {
    "website": true,
    "organization": { "logo": "/images/logo.png", "sameAs": ["https://www.linkedin.com/company/…"], "email": "", "telephone": "" },
    "articles": ["blog"],
    "breadcrumbs": true
  },
  "agentReadable": {
    "llmsTxt": true, "llmsFullTxt": true, "markdownTwins": true, "agentPage": true,
    "optional": ["/privacy/"], "exclude": [], "contact": "hello@example.com", "fullMaxBytes": 1000000
  }
}
```

| Key | Default | |
| --- | --- | --- |
| `site.name`, `site.summary` | the home page's `og:site_name` (else `application-name`, `galley.config.json`'s `name`, the home page's title) and meta description | The H1 and blockquote of llms.txt, the agent guide, WebSite and Organization. |
| `crawlers` | `{}` | Token → `"allow"` or `"block"`. Known tokens are in the catalogue (`aiCrawlers`); any other token robots.txt can use is accepted. An allowed crawler's group repeats the site-wide rules: under RFC 9309 a crawler with its own group ignores the `*` group, so `Allow: /` alone would lift your `disallow`s for it. |
| `robots.disallow` / `allow` | `[]` | Site-wide rules (robots path syntax, `*` and `$`), written under the base path. Pages they cover are left out of llms.txt and the sitemap. `robots: false` stops the kit writing robots.txt. |
| `sitemap.exclude` | `[]` | Page globs (`/thanks/`, `/blog/**`) kept out of the sitemap. `lastmod`: `"content"` or `"none"`. |
| `structuredData.website` / `organization` / `breadcrumbs` | on | `organization` takes `name`, `logo` (a site path — left out, with a note, if the file isn't in the build — or a full address), `sameAs`, `email`, `telephone`. |
| `structuredData.articles` | `"auto"` | Collections (`["blog"]`, matched by their address pattern from `galley.config.json`, else `/<id>/*`) or page globs (`["/news/*"]`); `"auto"` means pages that say `og:type` `article`. `BlogPosting` for blog/posts/journal, `Article` otherwise. A page gets it only with a headline and a publication date. |
| `agentReadable.optional` / `exclude` | `[]` | Page globs: listed under "Optional" in llms.txt / given no twin and left out of llms.txt. |
| `agentReadable.contact` | the first email link on the home page, plus `/contact/` if it exists | For the agent guide. |

Mistakes stop the build with every problem listed in plain words
("`robots.disallow`: “drafts/” should start with “/” …").

### How a twin is made

From the **rendered HTML**, not the content files, so it is true to the page
whatever made it (content collections, section blocks, hand-written Astro):

1. The page is read with a small built-in HTML reader (the kit depends on
   nothing but Astro).
2. The main content is the element marked `data-galley-agent="main"`, else
   `<main>` (or `role="main"`), else the page's only `<article>`, else
   `<body>` without its `header`, `footer` and `aside`.
3. Left out: `nav`, `form` and form controls, `script`, `style`,
   `noscript`, `template`, `svg`, `dialog`, the kit's consent banner, forms
   and email dialog, anything `hidden`, `inert` or `aria-hidden="true"`, and
   anything marked `data-galley-agent="skip"`.
4. Added at the end: elements outside the main content marked
   `data-galley-agent="include"` (an address in the footer, say).
5. Written as markdown: headings, paragraphs, lists (nested), tables (GFM),
   block quotes, code blocks with their language, inline code, bold and
   italic; links and images with **absolute** addresses; images with an
   empty `alt` (decorative) are left out; videos and frames become a link
   named by their `title`; a card that wraps a heading in a link becomes a
   linked heading. Links to a part of the same page keep only their text.
6. Front matter from the page's `<head>`: `og:title` (else the `h1`, else
   `<title>`), the meta description, the canonical address, `<html lang>`,
   `article:published_time` and `article:modified_time` — or, for a page
   that states no date, its content entry's date.

**Limits.** Drawings inlined as SVG have no address, so they appear only if
they are also an `<img>`. Words the page adds with JavaScript after load
aren't there (that's the point: an agent reading the twin sees what the HTML
says). Text that CSS alone separates (two inline elements with no space
between them) gets a space; text that CSS alone hides is kept unless marked.
Pages a dev server can't reach by links from the home page are missing from
`llms.txt` in `astro dev` (a build lists every page).

**Marking content:**

```html
<article data-galley-agent="main">…</article>        <!-- this is the content -->
<aside data-galley-agent="skip">Related posts…</aside> <!-- leave this out -->
<footer><p data-galley-agent="include">Registered office: …</p></footer>
```

### Drafts and dates from the content files

A rendered page doesn't say whether it is a draft. The kit reads
`src/content/<collection>/` for entries whose front matter (or JSON/YAML)
sets the collection's `draftField` from `galley.config.json` (else `draft`)
to true, works out their addresses from the collection's `url` pattern (else
`/<collection>/<slug>/`; `pages` is `/<slug>/`), and leaves those pages out —
so `astro dev`, which shows drafts, never lists them. Each entry's `dateField`
(else `date`, `pubDate`, `publishDate`, `published`) gives the page a date
when its HTML states none.

### When the site has its own

Anything the site already publishes at one of these addresses — a file in
`public/`, a page route such as `src/pages/robots.txt.ts`, an integration
like `@astrojs/sitemap` — is left exactly as it is, and the build says so
("robots.txt: the site writes its own …; left as it is. The crawler choices
in the visibility file are not applied …"). Pages that already carry a
markdown link or a JSON-LD type keep theirs; the kit adds no second one.

### In `astro dev` and Galley's preview

The dev server answers every address above, made on request from the pages
it renders (it asks itself for the page, its parent pages and the home page),
and adds the same `<head>` tags to each page it sends — so the app's audit
and its "What an AI agent reads" panel see what a build will publish. The
data file is re-read on each request. The preview's `data-galley-preview` /
`data-galley-endpoint` attributes and its overlay script are outside the main
content, so twins are identical in and out of the preview.

### What the build says

```
[galley-kit] visibility: 30 of 31 pages listed · 30 markdown versions · structured data on 20 pages · llms.txt, llms-full.txt, agent.md, robots.txt, sitemap.xml · 99 ms
```

On the three starters (17–30 pages) the step takes 32–99 ms, writes 41–78 KB
of markdown versions and 38–72 KB of `llms-full.txt`, and adds about 450
bytes to each page's `<head>`; no page gains any JavaScript.

### Vendoring

`node packages/astro/scripts/vendor.mjs <site>` copies `visibility/*.js` and
`integration.js` into `src/galley/` with the rest of the kit (and
`kitBundle()` includes them). The site adds the two lines in `astro.config`
above, and may add `src/data/visibility.json`.

### For the app

The catalogue (`@galley/astro/catalog` → `aiCrawlers`, `describePolicy`) has
each crawler's `token`, `vendor`, `label`, `purpose` (`training`, `dataset`,
`search`, `user`), `crawls` (false for control tokens), `what`, `ifBlocked`,
`caveat` and `docs`, in the same shape as the app's `CrawlerInfo`.
A site whose robots.txt the kit writes keeps its crawler policy in
`src/data/visibility.json` → `crawlers`; the app should write there rather
than create `public/robots.txt` (which the kit would then step aside for).

---

## Sources

All read on 23 November 2026.

- **llms.txt** — [llmstxt.org](https://llmstxt.org/), "The /llms.txt file,
  v2", published 3 September 2024, modified 10 August 2026: an optional BOM,
  an H1 with the site's name ("the only required section"), a blockquote
  summary, other markdown without headings, then H2 "file lists" of
  `[name](url)` with optional `: notes`; "Optional" is for "links an agent can
  skip when a shorter context is needed"; markdown versions of pages "either
  with `.md` appended … or with the extension replaced by `.md`", and for
  addresses without a file name `index.html.md` or `index.md`. Followed as
  written. (The proposal says nothing about `llms-full.txt`; the kit's is a
  convenience, named as other sites name theirs.)
- **Google, AI features** — [Optimizing for generative AI features](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide):
  "You don't need to create new machine readable files, AI text files,
  markup, or Markdown" for Google Search, which "itself doesn't use them";
  creating them for other services "will neither harm nor help your site's
  visibility or rankings in Google Search"; "Structured data isn't required
  for generative AI search, and there's no special schema.org markup you need
  to add". Hence the honesty section above.
- **Google, structured data** — [site names](https://developers.google.com/search/docs/appearance/site-names):
  WebSite needs `name` and `url`, on the home page, and the url must be the
  root of the domain or subdomain (sub-directories can't have a site name) —
  so the kit writes no WebSite under a base path.
  [Organization](https://developers.google.com/search/docs/appearance/structured-data/organization):
  "There are no required properties"; recommended name, url, logo (at least
  112 × 112 px, crawlable), sameAs, email, telephone; on the home page.
  [Article](https://developers.google.com/search/docs/appearance/structured-data/article):
  no required properties; recommended author (Person or Organization, with
  name), dateModified, datePublished, headline, image ("relevant to the
  article, rather than logos"); ISO 8601 dates, timezone recommended. The kit
  still writes nothing without a headline and a date, and never the site's
  generic picture.
  [Breadcrumb](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb):
  `itemListElement`; each ListItem `position`, `name`, `item` (optional on
  the last); at least two. The kit writes absolute `item` on every step,
  which is what the app's audit checks.
- **robots.txt** — [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309):
  case-insensitive user-agent matching, the `*` group only when no group
  names the crawler (matching groups are merged), the longest rule wins and
  Allow wins a tie, the file lives at `/robots.txt` at the top of the host,
  the rules "are not a form of access authorization", Sitemap lines are an
  extension crawlers may read, at least 500 KiB must be parsed. The kit's
  groups and its sub-path note follow from these.
- **Sitemaps** — [sitemaps.org protocol](https://www.sitemaps.org/protocol.html):
  `urlset` / `url` / `loc` required; `loc` a full address with the protocol;
  `lastmod` in W3C Datetime (a date alone is fine) and the date the page
  changed, not the date of the sitemap; at most 50,000 addresses and 50 MB
  per file; entity-escaped UTF-8; a sitemap lists only addresses under its own
  folder; `Sitemap:` in robots.txt with the full address.
- **AI crawlers** — [OpenAI](https://developers.openai.com/api/docs/bots)
  (OAI-SearchBot: "used to surface websites in search results in ChatGPT's
  search features", ~24 h to take effect; GPTBot: content that "may be used
  in training"; ChatGPT-User: "robots.txt rules may not apply"; OAI-AdsBot
  only checks pages submitted as ads, so the kit doesn't list it).
  [Anthropic](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler)
  (ClaudeBot: training; Claude-User: fetching for a person's question;
  Claude-SearchBot: search quality; honours `Crawl-delay`).
  [Perplexity](https://docs.perplexity.ai/guides/bots) (PerplexityBot: search,
  "not used to crawl content for AI foundation models"; Perplexity-User
  "generally ignores robots.txt rules").
  [Google common crawlers](https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers)
  (Google-Extended: training and grounding for Gemini; "doesn't have a
  separate HTTP request user agent string"; "does not impact a site's
  inclusion in Google Search nor is it used as a ranking signal").
  [Apple](https://support.apple.com/en-us/119829), dated 4 September 2026
  (Applebot-Extended "does not crawl webpages"; pages that disallow it "can
  still be included in search results").
  [Common Crawl](https://commoncrawl.org/ccbot) (`CCBot`, blocked with
  `Disallow: /`).
- **Evidence on llms.txt** — [Ahrefs](https://ahrefs.com/blog/llmstxt-study/),
  15 June 2026: 137,210 domains in Ahrefs Web Analytics with traffic in May
  2026; 28 % publish an llms.txt; 97 % of those files received no requests in
  May 2026; named AI tools made 19.5 % of the requests the other 3 % got. An
  SEO-aware sample, so if anything an over-estimate of adoption.
- **Astro 7** — [Integration API](https://docs.astro.build/en/reference/integrations-reference/):
  `astro:build:done` gets `dir`, "the client build output directory", the
  documented place to work on generated files; `astro:server:setup` gets the
  dev server, to which integrations add middleware with
  `server.middlewares.use(…)`; `astro:routes:resolved` lists the site's
  routes (and runs again in dev when a page file changes); `injectRoute` was
  not used, so a site's own route at the same address never collides with
  the kit's.
