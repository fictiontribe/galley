// Vendored from @galley/astro 0.4.3 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// The AI crawlers a site can allow or block one by one, from each provider's
// own documentation (read 23 November 2026 — the links are in `docs`). The
// shape matches the app's catalogue (packages/core/src/seo/robots.ts,
// CrawlerInfo) so the app can show the same words: what it is, what it is
// for, and what the provider says blocking it does.
//
// `purpose`:
//   "training"  collects pages that may be used to train AI models
//   "dataset"   builds an open archive others train on
//   "search"    finds pages to show and cite in an AI assistant's answers
//   "user"      fetches a page because a person asked an assistant to
// `crawls: false` marks a control token: the provider reads its rules but
// fetches nothing under that name.

/**
 * @typedef {object} AiCrawler
 * @property {string} token  The robots.txt user-agent token.
 * @property {string} vendor
 * @property {string} label
 * @property {"training" | "dataset" | "search" | "user"} purpose
 * @property {boolean} crawls
 * @property {string} what
 * @property {string} ifBlocked
 * @property {string} [caveat]
 * @property {string} docs
 */

const OPENAI = "https://developers.openai.com/api/docs/bots";
const ANTHROPIC = "https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler";
const PERPLEXITY = "https://docs.perplexity.ai/guides/bots";

/** @type {readonly AiCrawler[]} */
export const AI_CRAWLERS = Object.freeze([
  {
    token: "GPTBot",
    vendor: "OpenAI",
    label: "OpenAI's training crawler",
    purpose: "training",
    crawls: true,
    what: "Collects pages that may be used to train OpenAI's models.",
    ifBlocked: "OpenAI says the site's content shouldn't be used to train its models.",
    docs: OPENAI,
  },
  {
    token: "OAI-SearchBot",
    vendor: "OpenAI",
    label: "ChatGPT's search crawler",
    purpose: "search",
    crawls: true,
    what: "Finds pages to show and link in ChatGPT's search answers.",
    ifBlocked: "OpenAI says the site isn't shown in ChatGPT search answers (it may still appear as a plain link).",
    docs: OPENAI,
  },
  {
    token: "ChatGPT-User",
    vendor: "OpenAI",
    label: "ChatGPT fetching a page for someone",
    purpose: "user",
    crawls: true,
    what: "Visits a page when a person asks ChatGPT something that needs it.",
    ifBlocked: "ChatGPT may not open the page for the person who asked.",
    caveat: "OpenAI says robots rules may not apply, because a person started the visit.",
    docs: OPENAI,
  },
  {
    token: "ClaudeBot",
    vendor: "Anthropic",
    label: "Anthropic's training crawler",
    purpose: "training",
    crawls: true,
    what: "Collects pages that may be used to train Anthropic's models.",
    ifBlocked: "Anthropic says the site's future pages are left out of its training data.",
    docs: ANTHROPIC,
  },
  {
    token: "Claude-SearchBot",
    vendor: "Anthropic",
    label: "Claude's search crawler",
    purpose: "search",
    crawls: true,
    what: "Reads pages to improve the search results Claude gives.",
    ifBlocked: "Anthropic says the site isn't indexed for Claude's search, which may reduce its visibility there.",
    docs: ANTHROPIC,
  },
  {
    token: "Claude-User",
    vendor: "Anthropic",
    label: "Claude fetching a page for someone",
    purpose: "user",
    crawls: true,
    what: "Visits a page when a person asks Claude something that needs it.",
    ifBlocked: "Claude can't open the page for the person who asked.",
    docs: ANTHROPIC,
  },
  {
    token: "PerplexityBot",
    vendor: "Perplexity",
    label: "Perplexity's search crawler",
    purpose: "search",
    crawls: true,
    what: "Finds pages to show and link in Perplexity's answers. Perplexity says it isn't used to train models.",
    ifBlocked: "The site isn't surfaced in Perplexity's search results.",
    docs: PERPLEXITY,
  },
  {
    token: "Perplexity-User",
    vendor: "Perplexity",
    label: "Perplexity fetching a page for someone",
    purpose: "user",
    crawls: true,
    what: "Visits a page when a person asks Perplexity something that needs it.",
    ifBlocked: "Usually nothing: Perplexity says this fetcher generally ignores robots.txt.",
    caveat: "Perplexity says it generally ignores robots.txt, because a person started the visit.",
    docs: PERPLEXITY,
  },
  {
    token: "Google-Extended",
    vendor: "Google",
    label: "Google's Gemini training control",
    purpose: "training",
    crawls: false,
    what: "Not a crawler: a setting Google reads to decide whether pages it crawls may train Gemini models and ground Gemini answers.",
    ifBlocked: "Google says it doesn't affect inclusion or ranking in Google Search. AI Overviews and AI Mode are part of Search and follow Googlebot.",
    docs: "https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers",
  },
  {
    token: "Applebot-Extended",
    vendor: "Apple",
    label: "Apple's AI training control",
    purpose: "training",
    crawls: false,
    what: "Not a crawler: a setting Apple reads to decide whether pages Applebot crawled may train its foundation models.",
    ifBlocked: "Apple says the pages can still appear in Spotlight, Siri and Safari search, and ranking isn't affected.",
    docs: "https://support.apple.com/en-us/119829",
  },
  {
    token: "CCBot",
    vendor: "Common Crawl",
    label: "Common Crawl's crawler",
    purpose: "dataset",
    crawls: true,
    what: "Builds an open archive of the web that anyone can download — widely used as AI training data by others.",
    ifBlocked: "New crawls leave the site out of the archive; copies already published stay.",
    docs: "https://commoncrawl.org/ccbot",
  },
]);

/** The words robots.txt comments use for each purpose. */
export const PURPOSE_NOTES = Object.freeze({
  training: "AI training: collects pages that may be used to train AI models",
  dataset: "Open web archive, widely reused as AI training data",
  search: "AI search: finds pages to show and cite in an assistant's answers",
  user: "Fetches a page when a person asks an assistant to",
  control: "AI training: decides whether pages already crawled may train AI models",
});

/** @param {string} token */
export function aiCrawler(token) {
  const wanted = token.toLowerCase();

  return AI_CRAWLERS.find((crawler) => crawler.token.toLowerCase() === wanted);
}

/**
 * One plain sentence about a policy: "Blocks AI training (GPTBot, CCBot); allows AI search (OAI-SearchBot)."
 *
 * @param {Record<string, "allow" | "block">} choices
 */
export function describePolicy(choices) {
  /** @type {Record<string, string[]>} */
  const groups = {};

  for (const [token, choice] of Object.entries(choices)) {
    const purpose = aiCrawler(token)?.purpose ?? "other";
    const kind = purpose === "dataset" ? "training" : purpose;
    const key = `${choice} ${kind}`;

    (groups[key] ??= []).push(aiCrawler(token)?.token ?? token);
  }
  const words = /** @type {Record<string, string>} */ ({ training: "AI training", search: "AI search", user: "fetches for a person", other: "other crawlers" });
  const parts = Object.entries(groups)
    .sort(([a], [b]) => (a.startsWith("block") === b.startsWith("block") ? a.localeCompare(b) : a.startsWith("block") ? -1 : 1))
    .map(([key, tokens]) => {
      const [choice = "", kind = ""] = key.split(" ");

      return `${choice === "block" ? "blocks" : "allows"} ${words[kind] ?? kind} (${tokens.join(", ")})`;
    });

  if (parts.length === 0) return "No AI crawler is named, so every crawler follows the site-wide rules.";
  const sentence = parts.join("; ");

  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}
