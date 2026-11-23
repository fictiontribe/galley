# Search & AI visibility

Galley checks a site for what search engines and AI systems need — and for
what is wrong or missing — explains each finding in plain words, and fixes
what it safely can as ordinary edits that wait in Proof. This page says what
it checks, why, how sure each statement is, and what it deliberately does not
do.

Every finding carries one of three labels, and the product never blurs them:

| Label | Meaning | Example |
| --- | --- | --- |
| **Measured** | A fact about the site anyone can check. | A link points at no page. A title is empty. |
| **Documented** | The search engine or AI provider says so in its own documentation. The finding links that page. | Google asks for a distinct title on each page. |
| **Judgement** | Plausible advice no platform documents. Shown as "a judgement, not proven". | A page with almost no text gives AI assistants little to quote. |

Galley makes no promise of rankings, traffic, or citations by AI assistants,
anywhere. Most "GEO" advice is in the third column at best.

All sources below were read on **23 November 2026**.

---

## Where the checks run

- **Content checks** read the content files and always run. They are
  deterministic, re-read only entries whose content changed since the last
  run (files are cached by modification time and content hash), and finish in
  a few seconds on large sites (about 8 s for a first pass over 1,900 entries,
  about 2–3 s after that, on a loaded laptop).
- **Rendered checks** read the pages as they are sent: through the running
  preview (your unpublished changes included) or, failing that, the last
  build's output folder. Galley never starts a preview or runs a build to get
  them. They are sampled — the home page, the pages the menu links to, then the
  rest spread evenly, 60 pages by default — and the report says how many of
  how many were checked. When nothing is rendered, every rendered check is
  listed as skipped with the reason.
- **Links to other sites** are checked only when asked (`POST
  …/visibility/external-links`): a few at a time, at most 50 addresses by
  default, `HEAD` first, identifying itself as a site owner checking their own
  links.

---

## What Galley checks

`Must` / `Should` / `Idea` is the severity. "R" marks checks that need a
rendered page.

### Titles and descriptions

| Check | Severity | Label | Why — and the source |
| --- | --- | --- | --- |
| `title-missing` | Must | Measured | Results and assistants name a page by its title. |
| `title-duplicate` | Should | Documented | Google asks for a distinct title on each page ([title links](https://developers.google.com/search/docs/appearance/title-link)). |
| `title-long` | Idea | Documented | Google sets **no length limit** but cuts titles to fit the device ([title links](https://developers.google.com/search/docs/appearance/title-link)). Galley measures the title in pixels, not characters — Arial/Helvetica advance widths at 20 px against a 600 px line, a common *observation* of desktop results, not a Google number — and shows the reasoning with the measurement. It is only ever an idea. |
| `title-short` | Idea | Documented | Google lists half-empty titles as a reason it rewrites title links. |
| `title-brand-repeated` | Should (Idea when the name is used naturally, e.g. "About Ferrow · Ferrow") | Documented | Google lists repeated site names as a reason it rewrites title links. |
| `description-missing` | Should | Documented | Google uses the description for the snippet when it describes the page better than the page's text, and asks for one per page ([snippets](https://developers.google.com/search/docs/appearance/snippet)). |
| `description-duplicate` | Should | Documented | "Identical or similar descriptions … aren't helpful" (same page). |
| `description-short` | Idea | Documented | Google: descriptions shouldn't be too short. Galley flags under 50 characters, and says that threshold is its own. |
| `description-long` | Idea | Documented | No limit; snippets are cut to the device. Flagged only past 1.5× an estimated two desktop lines. |

### Headings and content

| Check | Severity | Label | Why |
| --- | --- | --- | --- |
| `h1-missing` (R) | Should | Documented | Google uses the main visible heading as one source for title links and recommends the main title be the first `h1`. |
| `h1-multiple` (R) | Idea | Judgement | Google says heading count doesn't matter for search ([starter guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)); one main heading helps readers. |
| `heading-skip` (R) | Idea | Documented | W3C: avoid skipping heading ranks ([WAI headings](https://www.w3.org/WAI/tutorials/page-structure/headings/)). Google says order doesn't matter for search — the finding says so: it's about readers. |
| `heading-decoration` | Idea | Judgement | Empty or paragraph-length headings mislead outlines. |
| `long-no-subheads` | Idea | Documented | Google's guide to its AI features recommends clear organisation with headings ([AI features guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)). Flagged above 700 words with no subheading. |
| `thin-page` | Idea | Judgement | Google has **no word-count target** ([helpful content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)). Under 60 words there is little to read or quote; pages that list other entries (a blog index, a changelog) are left out. |
| `near-duplicate` | Idea | Judgement | Duplicate content isn't against Google's rules; Google picks one copy to show ([duplicate URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)). Jaccard similarity of five-word shingles ≥ 80 %, pages of 150+ words, found with MinHash and confirmed exactly. |
| `placeholder-text` | Must | Measured | "lorem ipsum", "[Add opening hours]", TODO — outside code samples and link text. |
| `placeholder-address` | Should | Measured | `example.com` addresses (one site-wide finding). |
| `date-past-upcoming` | Should | Judgement | An entry in an events-like collection whose date has passed. |

### Images

| Check | Severity | Label | Why |
| --- | --- | --- | --- |
| `image-broken` | Must | Measured | The engine's own broken-image check. |
| `image-alt-missing` | Should | Documented | Alt text is the most important image metadata for Google Images ([image SEO](https://developers.google.com/search/docs/appearance/google-images)). An empty alt is correct for decorative images and for an image right beside text that already says what it shows (W3C [alt decision tree](https://www.w3.org/WAI/tutorials/images/decision-tree/)); content findings say so, and a rendered `alt=""` is never flagged — only a missing attribute. |
| `image-alt-filename` | Should | Documented | A file name or "image" isn't a text alternative ([WCAG F30](https://www.w3.org/WAI/WCAG22/Techniques/failures/F30)). |
| `image-alt-redundant` | Idea | Documented | "Image of …" — screen readers already say it's an image. |
| `image-oversized` (R) | Idea | Measured | File width over 2.5× the displayed width (no `srcset`), or over 1 MB ([web.dev](https://web.dev/articles/serve-responsive-images)). |
| `image-dimensions-missing` (R) | Idea | Documented | Images without width/height or reserved space cause layout shift ([web.dev CLS](https://web.dev/articles/optimize-cls)). |
| `share-image-missing` (R) / `share-image-broken` (R) | Should / Must | Documented / Measured | `og:image` is how Google and social apps pick a page's picture; Google advises against a generic image like a logo. |

### Links

| Check | Severity | Label | Why |
| --- | --- | --- | --- |
| `link-broken` | Must | Measured | The engine's own check. With a preview or build, a target the rendered site serves is not reported; without one, a target a dynamic code route might make is reported as "should", with that caveat. |
| `link-anchor-missing` (R) | Should | Measured | `/page/#part` where the page has no element with that id. |
| `link-text-vague` | Idea | Documented | Google uses link text to understand the linked page ([starter guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)); WCAG link purpose. Only exact phrases ("click here", "read more", "here"…). |
| `link-text-empty` (R) | Should | Measured | A link with no text, label or image description. |
| `page-orphan` | Should | Documented | Crawlers find pages by following links. Without a full rendered crawl only top-level pages are checked, because code-written listing pages aren't visible in content. |
| `link-slash-mixed` | Idea | Documented | `/about` and `/about/` are duplicate addresses Google has to consolidate. |
| `link-external-dead` | Should | Measured | Off by default (network). |

### Indexing

| Check | Severity | Label | Why |
| --- | --- | --- | --- |
| `noindex-important` | Must (home) / Should (menu pages) | Measured | `noindex` keeps a page out of results and Google's AI features ([robots meta](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag)). |
| `canonical-missing`, `-elsewhere`, `-relative`, `-multiple` (R) | Idea / Should | Documented | Self-referential, absolute, single canonical ([duplicate URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)). |
| `site-url-placeholder` (R) | Must | Measured | Canonicals and the sitemap on `example.com` / `localhost`. |
| `sitemap-missing`, `sitemap-missing-page`, `sitemap-bad-entry` (R) | Should | Documented | Sitemaps should list the canonical pages you want shown and nothing missing, redirected or noindex ([build a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)); Bing uses `lastmod` to decide what to recrawl ([Bing, 31 Jul 2025](https://blogs.bing.com/webmaster/July-2025/Keeping-Content-Discoverable-with-Sitemaps-in-AI-Powered-Search)). |
| `robots-blocks-all` | Must | Measured | robots.txt disallows `/` for every crawler. |
| `robots-blocks-assets` | Should | Documented | Don't block files Google needs to understand the page ([robots.txt](https://developers.google.com/search/docs/crawling-indexing/robots/intro)). |

### Structured data (all R)

| Check | Severity | Label | Why |
| --- | --- | --- | --- |
| `jsonld-invalid` | Must | Measured | JSON-LD that isn't valid JSON is ignored. |
| `jsonld-required-missing` | Should | Documented | Only for types whose **required** properties Galley verified in Google's current docs: BreadcrumbList (`itemListElement` ≥ 2; `position`, `name`, `item`), WebSite (`name`, `url`), Event (`name`, `startDate`, `location`), LocalBusiness and subtypes (`name`, `address`), Product (`name` + one of `offers`/`review`/`aggregateRating`). Article and Organization have **no** required properties. |
| `jsonld-faq-retired` | Idea | Documented | Google stopped showing FAQ rich results on **7 May 2026** and removed the docs on 15 June 2026 ([updates](https://developers.google.com/search/updates)). The markup does no harm. |
| `jsonld-suggest-article` | Idea | Documented | Dated entries (posts) with no structured data of their own: the content already has headline, author and date ([Article](https://developers.google.com/search/docs/appearance/structured-data/article)). |
| `jsonld-suggest-site` | Idea | Documented | WebSite on the home page for the site name ([site names](https://developers.google.com/search/docs/appearance/site-names)); Organization for logo and details ([Organization](https://developers.google.com/search/docs/appearance/structured-data/organization)). |
| `jsonld-suggest-breadcrumbs` | Idea | Documented | Breadcrumbs show on **desktop only** ([Breadcrumb](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb)). |

Google says there is **no special schema.org markup for AI** and structured
data is not required for its AI features ([AI features
guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)).
The suggestions are about rich results and understanding, not AI.

### AI visibility

| Check | Severity | Label | Why |
| --- | --- | --- | --- |
| `ai-search-blocked` | Idea | Documented | An AI assistant's *search* crawler is blocked; its provider says the site then isn't shown in that assistant's search answers. The owner's choice — listed so it is a deliberate one. |
| `agent-readable-missing` (R) | Idea | Judgement | No `/llms.txt` and no markdown copies. See below for the state of evidence. |
| `agent-readable-broken` (R) | Should | Measured | `llms.txt` without its required H1, links in it that lead nowhere, or advertised markdown copies that aren't served. |
| `ai-intro-unclear` | Idea | Judgement | The site's name isn't in the first 150 words of the home page's own text. |
| `facts-in-images` | Idea | Judgement | An image named or described like a menu, price list or timetable, on a page whose text has no prices or times. |
| `byline-missing` | Idea | Documented | Google encourages accurate bylines where readers expect them ([helpful content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)). |
| `js-only-content` (R) | Should | Measured | The HTML as sent has under 20 % of the content's words (and under 40): the rest arrives by script, which many crawlers don't run. Google can run JavaScript, but says JS sites need care. |

### What Galley deliberately doesn't check

- **Title identical to the H1** — dropped. Google uses the main heading as a
  source for title links and recommends a prominent main title; a matching
  title and H1 is consistent with the guidance, not a problem.
- **Keyword density, keyword in the URL, meta keywords** — Google: keyword
  stuffing doesn't help, it "doesn't use the keywords meta tag", and URL
  keywords and content length are on its list of things not to focus on.
- **Word count targets** — Google: "there's no magical word count".
- **E-E-A-T scores** — Google: E-E-A-T isn't a ranking factor.
- **"Chunk your content for AI", "rewrite for AI", special AI markup** —
  Google's AI features guide lists these as myths.
- **Adding statistics or quotations to be cited** — the GEO paper (Aggarwal
  et al., KDD 2024, [arXiv 2311.09735](https://arxiv.org/abs/2311.09735))
  measured gains from adding statistics, quotations and citations, on a
  GPT-3.5 simulated engine and a 200-query Perplexity sample; it also found
  keyword stuffing didn't help. Galley won't add facts a page doesn't have,
  so it doesn't act on this, and it doesn't present the result as a rule.
- **Priority / changefreq in sitemaps** — Google and Bing ignore them.
- **Core Web Vitals measurement** — needs field data Galley doesn't have;
  only layout-shift causes visible in HTML (missing image dimensions) are
  checked.

---

## What Galley fixes by itself

Deterministic fixes are ordinary edits through the engine: one-line diffs,
in Proof, undoable as a batch (`POST …/visibility/undo`) or per file in Proof.
A fix is refused if the page changed since it was checked, and offered only
when the right edit is certain:

| Fix | When it is offered |
| --- | --- |
| Remove the repeated site name | The title field ends or starts with the site name after a separator (`|`, `·`, `—`, `-`, `:`). |
| Point a link at the page's new address | The site's own redirect file (`_redirects`, `netlify.toml`, `vercel.json`) maps the old address one-to-one, or the pending changes show the page renamed (one removed, one added in the same collection, ≥ 50 % the same text). |
| Use one form of an address everywhere | The page's own address is known from its collection. |
| Let search engines show a page | A `noindex` on/off field on the home page or a page in the menu. |
| Use the page's own picture when shared | The page sends no share picture, has an empty share-picture field, and has a lead image. |
| Add missing image dimensions | Only where the content model has width and height fields next to the image (rare: most sites set them in code). |

Trimming a long title by cutting words is **not** deterministic — it can
change the meaning — so long titles get "Suggest a title" (the assistant)
instead.

## What the assistant writes

Only when an assistant key is set: missing descriptions, alt text (written by
**looking at the image**; SVG drawings are read as source), clearer titles,
a plain opening (who / what / for whom, from facts on the site), and draft
questions and answers into the site's own Q&A section type. Each is **one
request per page** with a purpose-written instruction and a structured
answer, so the number of requests is shown before a batch starts and can be
capped. Answers that state a figure, price, percentage, address or link the
page doesn't contain are dropped with the reason; descriptions outside 50–320
characters and over-long titles are dropped too. Everything written waits in
Proof. Nothing is published.

From any MCP harness, `audit_site` and `audit_entry` return the same findings;
`fix` edits apply as given with `update_entry`, and `write` findings must be
written from the page's own content.

---

## AI crawlers: the policy, neutrally

robots.txt rules are a request. Reputable crawlers say they honour them;
nothing enforces it, and some fetchers acting for a person say they may not
([Google on robots.txt](https://developers.google.com/search/docs/crawling-indexing/robots/intro)).
The trade-off is between **being found and cited** by AI assistants (search
crawlers) and **being used for training** (training crawlers). Blocking one
doesn't block the other.

| Token | Who | For | What the provider says blocking does |
| --- | --- | --- | --- |
| `OAI-SearchBot` | OpenAI | ChatGPT search | Not shown in ChatGPT search answers (may still appear as a navigational link). [OpenAI](https://developers.openai.com/api/docs/bots) |
| `GPTBot` | OpenAI | Training | Content shouldn't be used to train foundation models. |
| `ChatGPT-User` | OpenAI | Fetching for a person | "robots.txt rules may not apply". |
| `Claude-SearchBot` | Anthropic | Claude search | Not indexed for search; may reduce visibility. [Anthropic](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler) |
| `ClaudeBot` | Anthropic | Training | Future pages excluded from training. Honours `Crawl-delay`. |
| `Claude-User` | Anthropic | Fetching for a person | Claude can't fetch the page for the person who asked. |
| `PerplexityBot` | Perplexity | Perplexity search | Not surfaced in results; "not used to crawl content for AI foundation models". [Perplexity](https://docs.perplexity.ai/guides/bots) |
| `Perplexity-User` | Perplexity | Fetching for a person | "generally ignores robots.txt rules". |
| `Google-Extended` | Google | Gemini training and grounding (a control token, not a crawler) | "does not impact a site's inclusion in Google Search nor is it used as a ranking signal". AI Overviews and AI Mode are part of Search; Google's site-wide control for them is in Search Console, and `nosnippet` stops a page's text being used as direct input for them. [Google](https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers) |
| `Applebot-Extended` | Apple | Training (control token; doesn't crawl) | Pages can still appear in Spotlight, Siri and Safari search; not a ranking factor. [Apple](https://support.apple.com/en-us/119829) |
| `CCBot` | Common Crawl | Open web archive, widely reused as training data | Left out of new crawls. [Common Crawl](https://commoncrawl.org/ccbot) |

Galley reports the current policy in plain words ("ChatGPT's search crawler
is allowed; OpenAI's training crawler is blocked") and lets the owner choose
per crawler. It chooses nothing by default.

**Where the rules live.** In this order — the first that applies decides,
as it does when the site is built:

1. **The site writes robots.txt in code** (Astro's `src/pages/robots.txt.ts`,
   Next's `app/robots.ts`): Galley reads what it serves through the preview
   or build and says the change belongs in that code.
2. **The site has a plain `robots.txt`** (`public/robots.txt`,
   `static/robots.txt`…): it wins over everything else, and Galley edits it
   as below.
3. **The site uses Galley's site kit** (`galley()` in its Astro config, or the
   kit vendored in `src/galley/` beside its data file): the kit writes
   robots.txt on every build from `crawlers` in its data file —
   `src/data/visibility.json`, or the file named in
   `galley({ visibility: { file } })`. Galley reads and writes the choices
   there: "block" sets `"crawlers": { "GPTBot": "block" }`, "allow" removes the
   crawler's entry (the kit's default). It is an ordinary one-line edit of a
   content file, waiting in Proof, no build mode needed. Galley never creates
   `public/robots.txt` on a kit site: the kit would step aside for it and stop
   writing everything else it puts in robots.txt. The policy is shown in the
   kit's own words ("Blocks AI training (GPTBot, CCBot).") — Galley's crawler
   catalogue mirrors the kit's (`aiCrawlers`, `describePolicy()`), and a test
   fails if the two drift apart. `galley({ visibility: false })` or
   `"robots": false` in the data file means the kit writes none.
4. **Nothing at all**: every crawler is allowed by default; choosing one
   creates `public/robots.txt` (build mode).

For a plain robots.txt, Galley writes only a marked block at its end:

```
# --- AI crawlers: start (edited from the site's Search & AI settings) ---
User-agent: GPTBot
Disallow: /
# --- AI crawlers: end ---
```

Every other byte stays as it was. A crawler that already has its own rules
elsewhere in the file is refused rather than overridden. Writing robots.txt
needs build mode to be allowed for the site.

---

## The agent-readable version, honestly

An agent-readable version is an `/llms.txt` file — the
[proposal](https://llmstxt.org/) by Jeremy Howard (September 2024, v2
updated 10 August 2026): an H1 with the site's name (the only required
part), a blockquote summary, then H2 sections listing `[name](url)` links,
with an "Optional" section — plus a clean markdown copy of each page at the
page's address with `.md` (or `index.html.md` / `index.md`), advertised with
`<link rel="alternate" type="text/markdown">`.

The state of evidence:

- **Google Search doesn't use it.** On 15 June 2026 Google added that its
  search doesn't need llms.txt and it "won't help or hurt" visibility
  ([AI features guide, mythbusting](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)).
- **Few AI crawlers read it.** Ahrefs (June 2026, 137,210 domains of its
  analytics customers, an SEO-aware sample) found about 28 % publish one and
  **97 % of those files received no requests at all in May 2026**; named AI
  bots made up about a fifth of the requests that did arrive
  ([Ahrefs](https://ahrefs.com/blog/llmstxt-study/)). Other reports
  (single-site logs, vendor studies) point the same way. No major AI provider
  has committed to reading it.

So Galley treats it as an option: it reports whether one is served and checks
that it follows the format, and never claims it improves anything.

**On a site that uses the site kit** the agent-readable version is published
on every build ([what it publishes](ai-first-output.md)): a markdown version
of each page (`/about.md` for `/about/`, `/index.md` for the home page),
`/llms.txt` (llmstxt.org v2, with secondary pages under `## Optional`),
`/llms-full.txt` (the whole site in one file) and `/agent.md` (a short guide
for agents), as set in the kit's data file. The Search & AI screen says what
the site publishes, links to `/llms.txt` and the chosen page's markdown version
in the running preview (the kit answers the same addresses in `astro dev`),
and "What an AI agent reads" shows that page's real markdown version. The
audit checks what is served: the llms.txt format and its links, that
`agent.md` and `llms-full.txt` are there, and that every page the kit doesn't
leave out on purpose has a working markdown version. Pages it leaves out —
kept out of search, redirects, pages that name another page as the real one,
the "page not found" page, and the data file's `agentReadable.exclude` — are
never reported as missing one. When the posts of a dated collection carry no
article details, the fix is one click: the collection is added to
`structuredData.articles` in the data file.

**Sub-path builds** (`astro build --base /repo`): the build's folder holds the
site without its base path while every address in the pages carries it. The
audit takes the base from the site's config, or from the built home page
itself (its markdown link `/repo/index.md`, its bundled files `/repo/_astro/…`,
or its preferred address), and compares everything without it. Under a base
path it doesn't suggest WebSite structured data: Google gives site names to a
domain or subdomain only.

**Pages that aren't HTML.** A page the preview or build labels as HTML but that
isn't (a dev server that sends its bytes as a list of numbers, an error dump)
is skipped and named in the report, never checked into findings.

**What Galley's checks expect** (for the site kit that emits it):

- `GET /llms.txt` answers 200 with `text/plain` or `text/markdown` (not an
  HTML error page), starts with `# <site name>`, and every link in it to the
  site's own address answers 200.
- Each page has `<link rel="alternate" type="text/markdown" href="…">` in its
  `<head>` (the kit: `/about.md`, `/index.md`, under the base path when there
  is one), and that address answers 200 with markdown (not HTML).
- `/agent.md` and `/llms-full.txt` answer 200 with text, when the kit is set
  to publish them.
- Structured data is in `<script type="application/ld+json">` in the page,
  valid JSON; posts carry `Article`/`BlogPosting` (`headline`, `author` as
  `Person` with `name`, `datePublished`, `dateModified`, `image`); the home
  page carries `WebSite` (`name`, `url`) and `Organization`; nested pages may
  carry `BreadcrumbList` with absolute `item` URLs.

---

## Sources (read 23 November 2026)

- Google Search Central: [title links](https://developers.google.com/search/docs/appearance/title-link) ·
  [snippets](https://developers.google.com/search/docs/appearance/snippet) ·
  [image SEO](https://developers.google.com/search/docs/appearance/google-images) ·
  [duplicate URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls) ·
  [build a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap) ·
  [robots.txt](https://developers.google.com/search/docs/crawling-indexing/robots/intro) ·
  [robots meta tag](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag) ·
  [control what you share](https://developers.google.com/search/docs/crawling-indexing/control-what-you-share) ·
  [common crawlers / Google-Extended](https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers) ·
  [SEO starter guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide) ·
  [helpful content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content) ·
  [optimizing for generative AI features](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) (added 15 May 2026) ·
  [structured data gallery](https://developers.google.com/search/docs/appearance/structured-data/search-gallery) ·
  [Article](https://developers.google.com/search/docs/appearance/structured-data/article) ·
  [Breadcrumb](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb) ·
  [Organization](https://developers.google.com/search/docs/appearance/structured-data/organization) ·
  [site names](https://developers.google.com/search/docs/appearance/site-names) ·
  [Event](https://developers.google.com/search/docs/appearance/structured-data/event) ·
  [LocalBusiness](https://developers.google.com/search/docs/appearance/structured-data/local-business) ·
  [Product snippets](https://developers.google.com/search/docs/appearance/structured-data/product-snippet) ·
  [documentation updates](https://developers.google.com/search/updates) (FAQ rich results retired 7 May 2026; structured-data retirements of 12 June 2025 and later)
- Bing: [sitemaps in AI-powered search, 31 July 2025](https://blogs.bing.com/webmaster/July-2025/Keeping-Content-Discoverable-with-Sitemaps-in-AI-Powered-Search).
  The [Bing Webmaster Guidelines](https://www.bing.com/webmasters/help/webmaster-guidelines-30fba23a)
  (revised February 2026 to cover Copilot and grounding) render in the browser
  and could not be read programmatically; nothing in Galley rests on them alone.
- AI crawlers: [OpenAI](https://developers.openai.com/api/docs/bots) ·
  [Anthropic](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler) ·
  [Perplexity](https://docs.perplexity.ai/guides/bots) ·
  [Apple](https://support.apple.com/en-us/119829) ·
  [Common Crawl](https://commoncrawl.org/ccbot) ·
  [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309)
- [llms.txt proposal](https://llmstxt.org/) · [Ahrefs llms.txt study](https://ahrefs.com/blog/llmstxt-study/) ·
  [GEO: Generative Engine Optimization](https://arxiv.org/abs/2311.09735)
- W3C: [WCAG F30](https://www.w3.org/WAI/WCAG22/Techniques/failures/F30) ·
  [alt decision tree](https://www.w3.org/WAI/tutorials/images/decision-tree/) ·
  [headings](https://www.w3.org/WAI/tutorials/page-structure/headings/) ·
  [link purpose](https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context)
- web.dev: [optimize CLS](https://web.dev/articles/optimize-cls) · [responsive images](https://web.dev/articles/serve-responsive-images)
