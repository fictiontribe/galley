/**
 * The primary sources behind every "documented" finding, with the date each
 * page was read. docs/seo-and-ai-visibility.md lists the same pages; keep
 * the two together when a platform changes its guidance.
 */
import type { SourceRef } from "./types";

const CHECKED = "2026-11-23";

function source(label: string, url: string): SourceRef {
  return { label, url, checked: CHECKED };
}

export const SOURCES = {
  googleTitles: source("Google Search Central — title links", "https://developers.google.com/search/docs/appearance/title-link"),
  googleSnippets: source("Google Search Central — snippets and meta descriptions", "https://developers.google.com/search/docs/appearance/snippet"),
  googleImages: source("Google Search Central — image SEO", "https://developers.google.com/search/docs/appearance/google-images"),
  googleCanonical: source("Google Search Central — consolidating duplicate URLs", "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls"),
  googleSitemaps: source("Google Search Central — build a sitemap", "https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap"),
  googleRobots: source("Google Search Central — robots.txt introduction", "https://developers.google.com/search/docs/crawling-indexing/robots/intro"),
  googleRobotsMeta: source("Google Search Central — robots meta tag", "https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag"),
  googleStarter: source("Google Search Central — SEO starter guide", "https://developers.google.com/search/docs/fundamentals/seo-starter-guide"),
  googleHelpful: source("Google Search Central — creating helpful content", "https://developers.google.com/search/docs/fundamentals/creating-helpful-content"),
  googleAi: source("Google Search Central — optimizing for generative AI features", "https://developers.google.com/search/docs/fundamentals/ai-optimization-guide"),
  googleGallery: source("Google Search Central — structured data search gallery", "https://developers.google.com/search/docs/appearance/structured-data/search-gallery"),
  googleUpdates: source("Google Search Central — documentation updates (FAQ rich results retired 7 May 2026)", "https://developers.google.com/search/updates"),
  googleArticle: source("Google Search Central — Article structured data", "https://developers.google.com/search/docs/appearance/structured-data/article"),
  googleBreadcrumb: source("Google Search Central — Breadcrumb structured data", "https://developers.google.com/search/docs/appearance/structured-data/breadcrumb"),
  googleOrganization: source("Google Search Central — Organization structured data", "https://developers.google.com/search/docs/appearance/structured-data/organization"),
  googleSiteNames: source("Google Search Central — site names (WebSite structured data)", "https://developers.google.com/search/docs/appearance/site-names"),
  googleEvent: source("Google Search Central — Event structured data", "https://developers.google.com/search/docs/appearance/structured-data/event"),
  googleLocalBusiness: source("Google Search Central — LocalBusiness structured data", "https://developers.google.com/search/docs/appearance/structured-data/local-business"),
  googleProduct: source("Google Search Central — Product snippets", "https://developers.google.com/search/docs/appearance/structured-data/product-snippet"),
  googleCrawlers: source("Google — common crawlers (Google-Extended)", "https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers"),
  openaiBots: source("OpenAI — overview of OpenAI crawlers", "https://developers.openai.com/api/docs/bots"),
  anthropicBots: source("Anthropic — how site owners can block Anthropic's crawlers", "https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler"),
  perplexityBots: source("Perplexity — Perplexity crawlers", "https://docs.perplexity.ai/guides/bots"),
  appleBots: source("Apple — about Applebot", "https://support.apple.com/en-us/119829"),
  ccbot: source("Common Crawl — CCBot", "https://commoncrawl.org/ccbot"),
  llmsTxt: source("llms.txt proposal (Jeremy Howard, v2)", "https://llmstxt.org/"),
  ahrefsLlms: source("Ahrefs — llms.txt study, 137,210 domains (June 2026)", "https://ahrefs.com/blog/llmstxt-study/"),
  geoPaper: source("Aggarwal et al., GEO: Generative Engine Optimization (KDD 2024)", "https://arxiv.org/abs/2311.09735"),
  webdevCls: source("web.dev — optimize Cumulative Layout Shift", "https://web.dev/articles/optimize-cls"),
  webdevImages: source("web.dev — serve responsive images", "https://web.dev/articles/serve-responsive-images"),
  wcagF30: source("W3C WCAG 2.2 — failure F30 (text alternatives that aren't alternatives)", "https://www.w3.org/WAI/WCAG22/Techniques/failures/F30"),
  waiAlt: source("W3C WAI — alt decision tree", "https://www.w3.org/WAI/tutorials/images/decision-tree/"),
  waiHeadings: source("W3C WAI — headings", "https://www.w3.org/WAI/tutorials/page-structure/headings/"),
  wcagLinkPurpose: source("W3C WCAG 2.2 — link purpose (in context)", "https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context"),
  bingSitemaps: source("Bing Webmaster Blog — sitemaps in AI-powered search (31 July 2025)", "https://blogs.bing.com/webmaster/July-2025/Keeping-Content-Discoverable-with-Sitemaps-in-AI-Powered-Search"),
  rfc9309: source("RFC 9309 — Robots Exclusion Protocol", "https://www.rfc-editor.org/rfc/rfc9309"),
} as const satisfies Record<string, SourceRef>;

export type SourceId = keyof typeof SOURCES;
