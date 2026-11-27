---
title: Check how search and AI see the site
navTitle: Search and AI checks
description: Search & AI checks titles, headings, images, links, indexing and structured data, fixes what it safely can as changes in Proof, and lets you choose which AI crawlers may visit.
group: site
order: 6
---

For people who look after a site. **Search & AI** lists what search engines and AI assistants need from the site and what is wrong or missing, in plain words. It makes no promise of rankings, traffic or citations.

## Run the checks

1. Open **Search & AI** in the sidebar. The checks run straight away on the site's content.
2. With the preview running, they also check the pages as visitors and crawlers get them; without it, **Start the preview** to include those. **Check again** runs them after you change something.

<figure class="frame" style="padding: clamp(12px, 3vw, 28px); margin-block: 0 1.15em"><img src="/docs/search-and-ai@1x.webp" srcset="/docs/search-and-ai@1x.webp 1x, /docs/search-and-ai.webp 2x" alt="Search & AI for Caddow: counts of Must fix, Should fix and Ideas, a note that rendered checks used the running preview, the groups Titles & descriptions (In good shape) and Headings & content with one should-fix finding about example addresses, and the AI crawlers panel on the right." width="1118" height="615" loading="lazy" decoding="async"></figure>

Findings come in groups — **Titles & descriptions**, **Headings & content**, **Images**, **Links**, **Indexing**, **Structured data**, **AI visibility** — each marked **Must fix**, **Should fix** or an idea. Each one says whether it is **Measured** on your site, **documented** by the search engine or AI provider (with a link to their page), or a judgement.

## Fix what it finds

- Where the right fix is certain — a repeated site name in a title, a link to a page's old address — the finding offers to fix it. Fixes are ordinary changes in Proof, and can be put back.
- Where words need writing — a missing description, alt text, a clearer title — the assistant can write them, one request per page; the number of requests is shown before anything starts. Everything written waits in Proof. This needs the assistant's key, and the docs haven't run it.

## Choose which AI crawlers may visit

**AI crawlers** has an **Allow** / **Block** choice for each crawler — OpenAI, Anthropic, Perplexity, Google, Apple, Common Crawl. Search crawlers decide whether AI assistants can find and link to the site; training crawlers decide whether its pages may train models. Blocking one isn't blocking the other, and the rules are a request: reputable crawlers say they follow them.

**What an AI agent reads** shows a page as an AI agent gets it.

## Live search intelligence

When live search data is connected, **Search & AI** also shows how the published domain performs in search and AI answers — mapped straight to the site's content files and redirects:

- **Overview & quick wins** — live organic ranking counts, estimated monthly visits, striking-distance opportunities (`#4–#20`), keyword cannibalization alerts, and broken backlink callouts. Click **Tune in Proof** on any matched page to compare against the top live results and stage title, description, or opening improvements in Proof.
- **Rankings & explorer** — filter every ranking query by position or route, and explore new seed topics for search volume, keyword difficulty, CPC, search intent, and whether the site already covers the topic.
- **Competitor gaps** — add up to three competitor domains to surface topics where rivals rank in the Top 10 and your site has no ranking page yet, paired with a suggested collection and section list from your schema and a 1-click **Draft page → Proof** action.
- **Backlinks & 404s** — view referring domains and spot missing URLs that still hold live external links, with 1-click **Add 301 → Proof** recovery into your redirects list.
- **AI answer citations** — see prompts in ChatGPT and Google AI Overviews where your domain or brand appears alongside your built-in site checks and AI crawler switches.

Live search intelligence is included automatically on Galley Cloud plans. On self-hosted and local installs, connect your own credentials under **App settings › Search intelligence** (or set `GALLEY_SEARCH_DATA_KEY` in the environment); without a key, all built-in site checks and AI crawler controls continue to work normally.

## If something's different

- **"Only the content files were checked."** Start the preview to check the pages as served too.
- **A finding you disagree with.** Findings marked as a judgement are advice, not rules; leave them.
