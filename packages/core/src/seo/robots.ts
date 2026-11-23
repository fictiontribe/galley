/**
 * robots.txt: parsing and matching per RFC 9309 (groups by user agent, the
 * longest matching rule wins, Allow wins a tie, `*` and `$` in paths), the
 * documented AI crawlers and what each provider says its crawler is for, and
 * a surgical edit that changes only a marked block of the file.
 *
 * Honouring robots.txt is voluntary on the crawler's side; the reports say
 * so, and quote each provider's own caveats.
 */
import { SOURCES } from "./sources";
import type { CrawlerChoice, CrawlerInfo, CrawlerStatus } from "./types";

export interface RobotsGroup {
  agents: string[];
  rules: Array<{ allow: boolean; path: string }>;
  /** Line numbers (0-based) the group spans, for refusing edits that would collide. */
  lines: [number, number];
}

export interface RobotsFile {
  groups: RobotsGroup[];
  sitemaps: string[];
}

export function parseRobots(text: string): RobotsFile {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;

  text.split(/\r?\n/).forEach((line, index) => {
    const clean = line.replace(/#.*$/, "").trim();
    const colon = clean.indexOf(":");

    if (colon === -1) return;
    const key = clean.slice(0, colon).trim().toLowerCase();
    const value = clean.slice(colon + 1).trim();

    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], lines: [index, index] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      current.lines[1] = index;
      lastWasAgent = true;
      return;
    }
    if (key === "sitemap") {
      if (value) sitemaps.push(value);
      return;
    }
    lastWasAgent = false;
    if ((key === "allow" || key === "disallow") && current) {
      // An empty Disallow allows everything; it adds no rule.
      if (value !== "") current.rules.push({ allow: key === "allow", path: value });
      current.lines[1] = index;
    }
  });
  return { groups, sitemaps };
}

function ruleMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");

  return new RegExp(`^${source}${anchored ? "$" : ""}`).test(path);
}

/** The groups that apply to a token: those naming it, else the `*` group(s). */
export function groupsFor(file: RobotsFile, token: string): { groups: RobotsGroup[]; by: "rule" | "wildcard" | "default" } {
  const wanted = token.toLowerCase();
  const named = file.groups.filter((group) => group.agents.includes(wanted));

  if (named.length) return { groups: named, by: "rule" };
  const wildcard = file.groups.filter((group) => group.agents.includes("*"));

  return wildcard.length ? { groups: wildcard, by: "wildcard" } : { groups: [], by: "default" };
}

export function isAllowed(file: RobotsFile, token: string, path: string): { allowed: boolean; by: "rule" | "wildcard" | "default" } {
  const { groups, by } = groupsFor(file, token);
  let best: { allow: boolean; length: number } | null = null;

  for (const group of groups) {
    for (const rule of group.rules) {
      if (!ruleMatches(rule.path, path)) continue;
      const length = rule.path.length;

      if (!best || length > best.length || (length === best.length && rule.allow)) best = { allow: rule.allow, length };
    }
  }
  return { allowed: best ? best.allow : true, by };
}

// ─────────────────────────────────────────────── the crawlers

/**
 * What each provider documents, in its own terms. Tokens are matched
 * case-insensitively. The site kit carries the same catalogue
 * (packages/astro/src/visibility/crawlers.js, exported as `aiCrawlers`) for
 * the robots.txt it writes; the app can't import the kit at runtime, so the
 * words are mirrored here and test/seo/kit.test.ts fails when they drift.
 */
export const CRAWLERS: CrawlerInfo[] = [
  {
    token: "OAI-SearchBot",
    vendor: "OpenAI",
    label: "ChatGPT's search crawler",
    purpose: "search",
    crawls: true,
    what: "Finds pages to show and link in ChatGPT's search answers.",
    ifBlocked: "OpenAI says the site isn't shown in ChatGPT search answers (it may still appear as a plain link).",
    source: SOURCES.openaiBots,
  },
  {
    token: "GPTBot",
    vendor: "OpenAI",
    label: "OpenAI's training crawler",
    purpose: "training",
    crawls: true,
    what: "Collects pages that may be used to train OpenAI's models.",
    ifBlocked: "OpenAI says the site's content shouldn't be used to train its models.",
    source: SOURCES.openaiBots,
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
    source: SOURCES.openaiBots,
  },
  {
    token: "Claude-SearchBot",
    vendor: "Anthropic",
    label: "Claude's search crawler",
    purpose: "search",
    crawls: true,
    what: "Reads pages to improve the search results Claude gives.",
    ifBlocked: "Anthropic says the site isn't indexed for Claude's search, which may reduce its visibility there.",
    source: SOURCES.anthropicBots,
  },
  {
    token: "ClaudeBot",
    vendor: "Anthropic",
    label: "Anthropic's training crawler",
    purpose: "training",
    crawls: true,
    what: "Collects pages that may be used to train Anthropic's models.",
    ifBlocked: "Anthropic says the site's future pages are left out of its training data.",
    source: SOURCES.anthropicBots,
  },
  {
    token: "Claude-User",
    vendor: "Anthropic",
    label: "Claude fetching a page for someone",
    purpose: "user",
    crawls: true,
    what: "Visits a page when a person asks Claude something that needs it.",
    ifBlocked: "Claude can't open the page for the person who asked.",
    source: SOURCES.anthropicBots,
  },
  {
    token: "PerplexityBot",
    vendor: "Perplexity",
    label: "Perplexity's search crawler",
    purpose: "search",
    crawls: true,
    what: "Finds pages to show and link in Perplexity's answers. Perplexity says it isn't used to train models.",
    ifBlocked: "The site isn't surfaced in Perplexity's search results.",
    source: SOURCES.perplexityBots,
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
    source: SOURCES.perplexityBots,
  },
  {
    token: "Google-Extended",
    vendor: "Google",
    label: "Google's Gemini training control",
    purpose: "training",
    crawls: false,
    what: "Not a crawler: a setting Google reads to decide whether pages it crawls may train Gemini models and ground Gemini answers.",
    ifBlocked: "Google says it doesn't affect inclusion or ranking in Google Search. AI Overviews and AI Mode are part of Search and follow Googlebot.",
    source: SOURCES.googleCrawlers,
  },
  {
    token: "Applebot-Extended",
    vendor: "Apple",
    label: "Apple's AI training control",
    purpose: "training",
    crawls: false,
    what: "Not a crawler: a setting Apple reads to decide whether pages Applebot crawled may train its foundation models.",
    ifBlocked: "Apple says the pages can still appear in Spotlight, Siri and Safari search, and ranking isn't affected.",
    source: SOURCES.appleBots,
  },
  {
    token: "CCBot",
    vendor: "Common Crawl",
    label: "Common Crawl's crawler",
    purpose: "dataset",
    crawls: true,
    what: "Builds an open archive of the web that anyone can download — widely used as AI training data by others.",
    ifBlocked: "New crawls leave the site out of the archive; copies already published stay.",
    source: SOURCES.ccbot,
  },
];

/** Search engines, for context in the same report (not AI-specific, not part of the policy controls). */
export const SEARCH_ENGINES = ["Googlebot", "Bingbot", "Applebot"];

/**
 * One plain sentence about a policy in the kit's own words ("Blocks AI
 * training (GPTBot, CCBot); allows AI search (OAI-SearchBot)."). Mirrors the
 * kit's describePolicy(); the drift test compares the two.
 */
export function describePolicy(choices: Record<string, CrawlerChoice>): string {
  const groups = new Map<string, string[]>();

  for (const [token, choice] of Object.entries(choices)) {
    const crawler = CRAWLERS.find((c) => c.token.toLowerCase() === token.toLowerCase());
    const purpose = crawler?.purpose ?? "other";
    const key = `${choice} ${purpose === "dataset" ? "training" : purpose}`;

    groups.set(key, [...(groups.get(key) ?? []), crawler?.token ?? token]);
  }
  const words: Record<string, string> = { training: "AI training", search: "AI search", user: "fetches for a person", other: "other crawlers" };
  const parts = [...groups.entries()]
    .sort(([a], [b]) => (a.startsWith("block") === b.startsWith("block") ? a.localeCompare(b) : a.startsWith("block") ? -1 : 1))
    .map(([key, tokens]) => {
      const [choice = "", kind = ""] = key.split(" ");

      return `${choice === "block" ? "blocks" : "allows"} ${words[kind] ?? kind} (${tokens.join(", ")})`;
    });

  if (parts.length === 0) return "No AI crawler is named, so every crawler follows the site-wide rules.";
  const sentence = parts.join("; ");

  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

/** Statuses straight from the kit's data file: what it will write into robots.txt. */
export function kitCrawlerStatus(choices: Record<string, CrawlerChoice>, siteBlocked: boolean): CrawlerStatus[] {
  return CRAWLERS.map((crawler) => {
    const choice = Object.entries(choices).find(([token]) => token.toLowerCase() === crawler.token.toLowerCase())?.[1];

    return { ...crawler, allowed: choice ? choice === "allow" && !siteBlocked : !siteBlocked, decidedBy: choice ? "rule" : "wildcard" };
  });
}

export function crawlerStatus(file: RobotsFile | null): CrawlerStatus[] {
  return CRAWLERS.map((crawler) => {
    if (!file) return { ...crawler, allowed: true, decidedBy: "default" as const };
    const result = isAllowed(file, crawler.token, "/");

    return { ...crawler, allowed: result.allowed, decidedBy: result.by };
  });
}

function vendorLine(vendor: string, statuses: CrawlerStatus[]): string {
  const parts = statuses.map((status) => `${status.label} is ${status.allowed ? "allowed" : "blocked"}`);
  const joined = parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join("; ")}; ${parts[parts.length - 1]}`;

  return `${vendor}: ${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
}

/** One plain line per vendor: "OpenAI: ChatGPT's search crawler is allowed; OpenAI's training crawler is blocked; …". */
export function summarizeCrawlers(statuses: CrawlerStatus[]): string[] {
  const vendors = [...new Set(statuses.map((status) => status.vendor))];

  return vendors.map((vendor) => vendorLine(vendor, statuses.filter((status) => status.vendor === vendor)));
}

// ─────────────────────────────────────────────── changing the policy

export const POLICY_START = "# --- AI crawlers: start (edited from the site's Search & AI settings) ---";
export const POLICY_END = "# --- AI crawlers: end ---";

export type PolicyPlan = { ok: true; text: string; changed: boolean } | { ok: false; reason: string };

/**
 * The robots.txt text with the AI-crawler choices applied. Only the marked
 * block is written (added at the end the first time); every other byte of
 * the file stays as it was. A token that already has its own group outside
 * the block is refused rather than overridden: someone wrote that rule on
 * purpose, and the two would disagree.
 */
export function planRobotsPolicy(text: string, choices: Record<string, CrawlerChoice>): PolicyPlan {
  const known = new Map(CRAWLERS.map((crawler) => [crawler.token.toLowerCase(), crawler.token]));
  const start = text.indexOf(POLICY_START);
  const endMarker = start === -1 ? -1 : text.indexOf(POLICY_END, start);

  if (start !== -1 && endMarker === -1) return { ok: false, reason: "robots.txt has the start of the AI crawler section but not its end, so it can't be changed safely. Fix the file by hand." };
  const blockEnd = endMarker === -1 ? -1 : endMarker + POLICY_END.length;
  const outside = start === -1 ? text : `${text.slice(0, start)}${text.slice(blockEnd)}`;
  const outsideFile = parseRobots(outside);
  const previous = start === -1 ? new Map<string, CrawlerChoice>() : currentChoices(text.slice(start, blockEnd));
  const lines: string[] = [];

  for (const crawler of CRAWLERS) {
    const choice = choices[crawler.token] ?? previous.get(crawler.token.toLowerCase());

    if (!choice) continue;
    const own = outsideFile.groups.some((group) => group.agents.includes(crawler.token.toLowerCase()));
    const fallsTo = isAllowed(outsideFile, crawler.token, "/").allowed;

    if (own) {
      if (choices[crawler.token] && fallsTo !== (choice === "allow")) {
        return { ok: false, reason: `robots.txt already has its own rules for ${crawler.token}. Change them there, so the file doesn't say two different things.` };
      }
      continue;
    }
    // Only write a group when it changes the outcome: "allow" under a
    // permissive * group needs no line at all.
    if (choice === "allow" && fallsTo) continue;
    lines.push(`User-agent: ${crawler.token}`, choice === "allow" ? "Allow: /" : "Disallow: /", "");
  }
  for (const token of Object.keys(choices)) if (!known.has(token.toLowerCase())) return { ok: false, reason: `${token} isn't one of the crawlers this setting covers.` };
  const block = lines.length ? `${POLICY_START}\n${lines.join("\n")}${POLICY_END}` : "";
  let next: string;

  if (start === -1) {
    if (!block) return { ok: true, text, changed: false };
    next = `${text}${text === "" || text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n"}${block}\n`;
  } else {
    next = block ? `${text.slice(0, start)}${block}${text.slice(blockEnd)}` : `${text.slice(0, start).replace(/\n+$/, "\n")}${text.slice(blockEnd).replace(/^\n+/, "")}`;
  }
  return { ok: true, text: next, changed: next !== text };
}

function currentChoices(block: string): Map<string, CrawlerChoice> {
  const out = new Map<string, CrawlerChoice>();

  for (const group of parseRobots(block).groups) {
    const blocked = group.rules.some((rule) => !rule.allow && rule.path === "/");

    for (const agent of group.agents) out.set(agent, blocked ? "block" : "allow");
  }
  return out;
}
