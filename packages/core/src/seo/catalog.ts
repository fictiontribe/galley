/**
 * Every check the audit runs, in one table: its group, how serious it is,
 * what kind of statement it makes, whether it needs the rendered pages, and
 * the plain sentence that says why it matters. Findings take their `why` and
 * `source` from here, so the wording and the evidence class can't drift
 * between the screen, the assistant and the docs.
 *
 * Checks that were considered and left out because the sources don't
 * support them are listed in docs/seo-and-ai-visibility.md ("What Galley
 * deliberately doesn't check").
 */
import { SOURCES, type SourceId } from "./sources";
import type { CheckInfo, FindingGroup, FindingKind, FindingSeverity } from "./types";

export interface Spec {
  group: FindingGroup;
  severity: FindingSeverity;
  kind: FindingKind;
  needsRender: boolean;
  network?: boolean;
  title: string;
  why: string;
  source?: SourceId;
}

const SPECS = {
  // ── titles & descriptions
  "title-missing": { group: "titles", severity: "must", kind: "measurable", needsRender: false, title: "No page title", why: "Search results and AI assistants name a page by its title; without one they make one up from whatever text they find.", source: "googleTitles" },
  "title-duplicate": { group: "titles", severity: "should", kind: "documented", needsRender: false, title: "Same title as other pages", why: "Google asks for a distinct title on each page: identical titles make pages hard to tell apart in results.", source: "googleTitles" },
  "title-long": { group: "titles", severity: "idea", kind: "documented", needsRender: false, title: "Title likely cut short in results", why: "Google sets no length limit but cuts titles to fit the screen, so the end of a long title may not be seen.", source: "googleTitles" },
  "title-short": { group: "titles", severity: "idea", kind: "documented", needsRender: false, title: "Title says almost nothing", why: "Google lists half-empty titles as a reason it rewrites the title shown in results.", source: "googleTitles" },
  "title-brand-repeated": { group: "titles", severity: "should", kind: "documented", needsRender: false, title: "Site name appears twice in the title", why: "Google lists repeated site names as a reason it rewrites the title shown in results.", source: "googleTitles" },
  "description-missing": { group: "titles", severity: "should", kind: "documented", needsRender: false, title: "No description shown in results", why: "Google uses a page's description for the snippet when it describes the page better than the page's own text; each page should have its own.", source: "googleSnippets" },
  "description-duplicate": { group: "titles", severity: "should", kind: "documented", needsRender: false, title: "Same description as other pages", why: "Google says identical or similar descriptions across a site aren't helpful.", source: "googleSnippets" },
  "description-short": { group: "titles", severity: "idea", kind: "documented", needsRender: false, title: "Description is very short", why: "Google suggests descriptions that aren't too short: specific, detailed ones work better.", source: "googleSnippets" },
  "description-long": { group: "titles", severity: "idea", kind: "documented", needsRender: false, title: "Description far longer than results show", why: "Google sets no limit but cuts snippets to fit the screen, so most of a very long description isn't seen.", source: "googleSnippets" },

  // ── headings & content
  "h1-missing": { group: "content", severity: "should", kind: "documented", needsRender: true, title: "No main heading", why: "Google uses the page's main visible heading as one source for the title it shows, and recommends making the main title the first h1.", source: "googleTitles" },
  "h1-multiple": { group: "content", severity: "idea", kind: "judgement", needsRender: true, title: "More than one main heading", why: "Google says the number of headings doesn't matter for search; a single main heading still makes the page's subject plain to readers and screen readers.", source: "waiHeadings" },
  "heading-skip": { group: "content", severity: "idea", kind: "documented", needsRender: true, title: "Heading levels skip a step", why: "Skipped heading levels confuse screen-reader users (W3C). Google says heading order doesn't matter for search, so this is about readers, not rankings.", source: "waiHeadings" },
  "heading-decoration": { group: "content", severity: "idea", kind: "judgement", needsRender: false, title: "A heading that isn't a heading", why: "Headings that are empty, a symbol, or a whole paragraph give readers and tools a misleading outline of the page.", source: "waiHeadings" },
  "long-no-subheads": { group: "content", severity: "idea", kind: "documented", needsRender: false, title: "Long page with no subheadings", why: "Google's guide to its AI features recommends clear organisation with headings and sections; long unbroken text is hard to scan.", source: "googleAi" },
  "thin-page": { group: "content", severity: "idea", kind: "judgement", needsRender: false, title: "Very little text", why: "Google has no word count target. A page with almost no text gives readers and AI assistants little to understand or quote.", source: "googleStarter" },
  "near-duplicate": { group: "content", severity: "idea", kind: "judgement", needsRender: false, title: "Nearly the same as another page", why: "Duplicate content isn't against Google's rules, but Google picks one of the copies to show; near-copies compete with each other.", source: "googleCanonical" },
  "placeholder-text": { group: "content", severity: "must", kind: "measurable", needsRender: false, title: "Placeholder text left in", why: "Visitors, search engines and AI assistants will read and repeat it as if it were true." },
  "placeholder-address": { group: "content", severity: "should", kind: "measurable", needsRender: false, title: "Example address left in", why: "example.com addresses are reserved for examples: nobody receives mail or visits there." },
  "date-past-upcoming": { group: "content", severity: "should", kind: "judgement", needsRender: false, title: "Presented as upcoming, but the date has passed", why: "People, and assistants answering “what's on”, may act on an event that's over." },

  // ── images
  "image-broken": { group: "images", severity: "must", kind: "measurable", needsRender: false, title: "Image file not found", why: "The picture doesn't show, for visitors or for search engines." },
  "image-alt-missing": { group: "images", severity: "should", kind: "documented", needsRender: false, title: "Image has no alt text", why: "Alt text is how screen readers, Google Images and AI systems learn what an image shows. Leave it empty only for purely decorative images.", source: "googleImages" },
  "image-alt-filename": { group: "images", severity: "should", kind: "documented", needsRender: false, title: "Alt text is a file name", why: "A file name isn't a text alternative (WCAG failure F30): it tells nobody what the picture shows.", source: "wcagF30" },
  "image-alt-redundant": { group: "images", severity: "idea", kind: "documented", needsRender: false, title: "Alt text says “image of”", why: "Screen readers already announce an image; the words should describe what it shows.", source: "waiAlt" },
  "image-oversized": { group: "images", severity: "idea", kind: "measurable", needsRender: true, title: "Image far larger than it is shown", why: "Sending an image several times larger than its display size wastes data and slows the page.", source: "webdevImages" },
  "image-dimensions-missing": { group: "images", severity: "idea", kind: "documented", needsRender: true, title: "Image has no width and height", why: "Without them the page jumps as images load (layout shift); web.dev says always include width and height.", source: "webdevCls" },
  "share-image-missing": { group: "images", severity: "should", kind: "documented", needsRender: true, title: "No picture for shares and previews", why: "The share picture is the one Google and social apps use to represent the page.", source: "googleImages" },
  "share-image-broken": { group: "images", severity: "must", kind: "measurable", needsRender: true, title: "Share picture not found", why: "Links to this page are shared without their picture." },

  // ── links
  "link-broken": { group: "links", severity: "must", kind: "measurable", needsRender: false, title: "Link to a page that doesn't exist", why: "Visitors and crawlers who follow it reach an error page." },
  "link-anchor-missing": { group: "links", severity: "should", kind: "measurable", needsRender: true, title: "Link to a part of a page that isn't there", why: "The link opens the page but doesn't scroll to what it promised." },
  "link-text-vague": { group: "links", severity: "idea", kind: "documented", needsRender: false, title: "Link text doesn't say where it goes", why: "Google uses link text to understand the page linked to, and screen-reader users often browse a page by its links alone.", source: "googleStarter" },
  "link-text-empty": { group: "links", severity: "should", kind: "measurable", needsRender: true, title: "Link with no text", why: "A link with no text or image description has no name for screen readers or crawlers.", source: "wcagLinkPurpose" },
  "link-external-dead": { group: "links", severity: "should", kind: "measurable", needsRender: false, network: true, title: "Link to another site that no longer answers", why: "Visitors who follow it hit an error on the other site." },
  "page-orphan": { group: "links", severity: "should", kind: "documented", needsRender: false, title: "Nothing links to this page", why: "Search engines find pages mostly by following links; a page nothing links to is easy to miss, for crawlers and for people.", source: "googleStarter" },
  "link-slash-mixed": { group: "indexing", severity: "idea", kind: "documented", needsRender: false, title: "Same page linked with and without a trailing slash", why: "Two addresses for one page are duplicates that Google has to consolidate; one consistent address is clearer.", source: "googleCanonical" },

  // ── indexing
  "noindex-important": { group: "indexing", severity: "must", kind: "measurable", needsRender: false, title: "Kept out of search", why: "This page asks search engines not to show it, so it can't appear in results or in Google's AI answers.", source: "googleRobotsMeta" },
  "canonical-missing": { group: "indexing", severity: "idea", kind: "documented", needsRender: true, title: "No preferred address declared", why: "Google recommends each page name its own preferred address, so copies of the page add up to one address.", source: "googleCanonical" },
  "canonical-elsewhere": { group: "indexing", severity: "should", kind: "documented", needsRender: true, title: "Says another address is the real one", why: "Naming a different page as the preferred address tells Google to show that page instead of this one.", source: "googleCanonical" },
  "canonical-relative": { group: "indexing", severity: "should", kind: "documented", needsRender: true, title: "Preferred address isn't a full address", why: "Google asks for full addresses, starting with https://, here.", source: "googleCanonical" },
  "canonical-multiple": { group: "indexing", severity: "should", kind: "documented", needsRender: true, title: "More than one preferred address", why: "Conflicting preferred addresses are error-prone; Google asks for one.", source: "googleCanonical" },
  "site-url-placeholder": { group: "indexing", severity: "must", kind: "measurable", needsRender: true, title: "The site's own address is still an example", why: "Preferred addresses, the sitemap and share links point at a placeholder domain, so search engines are sent somewhere else." },
  "sitemap-missing": { group: "indexing", severity: "should", kind: "documented", needsRender: true, title: "No sitemap", why: "A sitemap lists the pages you want found; Google and Bing both read them, and Bing uses its dates to decide what to recrawl.", source: "googleSitemaps" },
  "sitemap-missing-page": { group: "indexing", severity: "should", kind: "documented", needsRender: true, title: "Missing from the sitemap", why: "The sitemap should list every page you want found.", source: "googleSitemaps" },
  "sitemap-bad-entry": { group: "indexing", severity: "should", kind: "documented", needsRender: true, title: "Sitemap lists an address that shouldn't be there", why: "Google asks for only the addresses you want shown — not ones that are missing, redirected or kept out of search.", source: "googleSitemaps" },
  "robots-blocks-all": { group: "indexing", severity: "must", kind: "measurable", needsRender: false, title: "robots.txt blocks the whole site", why: "Every well-behaved crawler, search engines included, is told to stay away.", source: "googleRobots" },
  "robots-blocks-assets": { group: "indexing", severity: "should", kind: "documented", needsRender: false, title: "robots.txt blocks the site's styles, scripts or images", why: "Google asks not to block files it needs to understand the page.", source: "googleRobots" },

  // ── structured data
  "jsonld-invalid": { group: "structured", severity: "must", kind: "measurable", needsRender: true, title: "Structured data can't be read", why: "A block of structured data that can't be read is ignored entirely." },
  "jsonld-required-missing": { group: "structured", severity: "should", kind: "documented", needsRender: true, title: "Structured data is missing required details", why: "Google shows a rich result only when the properties it lists as required are present.", source: "googleGallery" },
  "jsonld-faq-retired": { group: "structured", severity: "idea", kind: "documented", needsRender: true, title: "Question-and-answer data no longer shows in Google", why: "Google stopped showing questions and answers in results on 7 May 2026. Keeping the data does no harm, and the questions on the page still help readers.", source: "googleUpdates" },
  "jsonld-suggest-article": { group: "structured", severity: "idea", kind: "documented", needsRender: true, title: "Posts could describe their author and date", why: "Google reads article details (headline, author, dates) to understand a post; none of it is required, all of it is recommended.", source: "googleArticle" },
  "jsonld-suggest-site": { group: "structured", severity: "idea", kind: "documented", needsRender: true, title: "Home page doesn't name the site and organisation", why: "Google reads the site's name from structured data on the home page, and the organisation's logo and details from it too.", source: "googleSiteNames" },
  "jsonld-suggest-breadcrumbs": { group: "structured", severity: "idea", kind: "documented", needsRender: true, title: "Nested pages have no breadcrumb trail", why: "Google can show a breadcrumb trail instead of the address on desktop results when the page describes it.", source: "googleBreadcrumb" },

  // ── AI visibility
  "ai-search-blocked": { group: "ai", severity: "idea", kind: "documented", needsRender: false, title: "An AI assistant's search crawler is blocked", why: "Its provider says blocked sites aren't shown in that assistant's search answers. This is the owner's choice; it's listed so the choice is a deliberate one." },
  "agent-readable-missing": { group: "ai", severity: "idea", kind: "judgement", needsRender: true, title: "No agent-readable version", why: "An llms.txt file and markdown copies of pages make the site easy for AI agents to read. Google says its search doesn't use them; evidence that other AI systems read them is thin.", source: "llmsTxt" },
  "agent-readable-broken": { group: "ai", severity: "should", kind: "measurable", needsRender: true, title: "Agent-readable version has problems", why: "Agents that do read it find missing pages or a file that doesn't follow the format.", source: "llmsTxt" },
  "ai-intro-unclear": { group: "ai", severity: "idea", kind: "judgement", needsRender: false, title: "The first screen doesn't say who this is", why: "People and AI assistants that read only the opening may not learn whose site this is. Plausible, not proven." },
  "facts-in-images": { group: "ai", severity: "idea", kind: "judgement", needsRender: false, title: "Facts may be only in a picture", why: "Prices, hours and addresses shown only in an image can't be found, copied or quoted by search engines or assistants." },
  "byline-missing": { group: "ai", severity: "idea", kind: "documented", needsRender: false, title: "Missing a date or author", why: "Google encourages accurate bylines where readers expect them; a date tells readers and assistants how current a page is.", source: "googleHelpful" },
  "js-only-content": { group: "ai", severity: "should", kind: "measurable", needsRender: true, title: "Text appears only after scripts run", why: "Crawlers that don't run scripts — many AI crawlers among them — see an almost empty page.", source: "googleAi" },
} as const satisfies Record<string, Spec>;

export type CheckCode = keyof typeof SPECS;

export function spec(code: CheckCode): Spec {
  return SPECS[code];
}

/** The whole catalogue, as the screen and the docs show it. */
export function checkCatalogue(): CheckInfo[] {
  return (Object.keys(SPECS) as CheckCode[]).map((code) => {
    const entry: Spec = SPECS[code];

    return {
      code,
      group: entry.group,
      severity: entry.severity,
      kind: entry.kind,
      needsRender: entry.needsRender,
      ...(entry.network ? { network: true } : {}),
      title: entry.title,
      why: entry.why,
      ...(entry.source ? { source: SOURCES[entry.source] } : {}),
    };
  });
}

export const GROUP_LABELS: Record<FindingGroup, string> = {
  titles: "Titles & descriptions",
  content: "Headings & content",
  images: "Images",
  links: "Links",
  indexing: "Indexing",
  structured: "Structured data",
  ai: "AI visibility",
};

export const GROUP_ORDER: FindingGroup[] = ["titles", "content", "images", "links", "indexing", "structured", "ai"];
