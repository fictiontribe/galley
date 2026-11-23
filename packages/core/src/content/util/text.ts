/**
 * Small text helpers shared across the content layer: human labels from keys,
 * slugs, and the "visible text" normalisation click-to-edit compares on.
 */
import { GalleyError } from "../../errors";

/** Words that read better in capitals inside a label. */
const ACRONYMS = new Set([
  "api",
  "cta",
  "css",
  "faq",
  "html",
  "id",
  "ids",
  "og",
  "pdf",
  "rss",
  "seo",
  "svg",
  "ui",
  "url",
  "urls",
  "ux",
]);

/** Splits camelCase, snake_case, kebab-case and dotted keys into lowercase words. */
function words(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_\-./]+/)
    .filter((word) => word !== "")
    .map((word) => word.toLowerCase());
}

/** "metaTitle" → "Meta title", "hero_image" → "Hero image", "ogImage" → "OG image". */
export function labelForKey(key: string): string {
  const parts = words(key);

  if (parts.length === 0) return key;
  const rendered = parts.map((word) => (ACRONYMS.has(word) ? word.toUpperCase() : word));
  const first = rendered[0] ?? "";

  rendered[0] = first.charAt(0).toUpperCase() + first.slice(1);
  return rendered.join(" ");
}

/**
 * A block type's display name. Discriminators are often paths
 * ("sections/feature-grid") — the last segment is the name a person knows.
 */
export function labelForBlockType(type: string): string {
  const last = type.split("/").filter(Boolean).pop() ?? type;

  return labelForKey(last);
}

/** Irregular or awkward collection names → [plural label, singular]. */
const COLLECTION_NAMES: Record<string, [string, string]> = {
  blog: ["Blog posts", "blog post"],
  news: ["News", "news item"],
  press: ["Press releases", "press release"],
  team: ["Team", "team member"],
  people: ["People", "person"],
  staff: ["Staff", "staff member"],
  docs: ["Docs", "doc"],
  documentation: ["Documentation", "doc"],
  data: ["Data", "data file"],
  content: ["Content", "item"],
  faq: ["FAQ", "question"],
  faqs: ["FAQs", "question"],
  media: ["Media", "media item"],
  settings: ["Settings", "settings"],
  navigation: ["Navigation", "navigation"],
  nav: ["Navigation", "navigation"],
  menu: ["Menu", "menu"],
  site: ["Site", "site settings"],
};

function singularize(word: string): string {
  if (/ies$/.test(word)) return word.replace(/ies$/, "y");
  if (/(ss|us|is)$/.test(word)) return word;
  if (/(ch|sh|x|z)es$/.test(word)) return word.replace(/es$/, "");
  if (/s$/.test(word)) return word.replace(/s$/, "");
  return word;
}

/** Plural label and lowercase singular for a collection id. */
export function collectionNames(id: string): { label: string; singular: string } {
  const known = COLLECTION_NAMES[id.toLowerCase()];

  if (known) return { label: known[0], singular: known[1] };
  const label = labelForKey(id);
  const parts = words(id);
  const last = parts.pop() ?? id;
  const singularLast = singularize(last);
  const singular = [...parts, singularLast].join(" ");

  // A name that doesn't look plural ("pricing") still needs a noun for "New …".
  return { label, singular: singularLast === last && !/s$/.test(last) ? `${singular} item` : singular };
}

/**
 * Lowercase words joined by hyphens; "/" separates nesting levels. Accents are
 * folded to plain letters so "Café menu" becomes "cafe-menu".
 */
export function normalizeSlug(input: string): string {
  const segments = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) =>
      segment
        .replace(/&/g, " and ")
        .replace(/['’]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    )
    .filter((segment) => segment !== "");

  if (segments.length === 0) {
    throw new GalleyError(
      "invalid",
      "That name has no letters or numbers to build an address from. Try a few plain words."
    );
  }
  return segments.join("/");
}

/** Collapses every run of whitespace (including non-breaking spaces) into one space. */
export function collapseWhitespace(value: string): string {
  return value.replace(/[\s  -​  　]+/g, " ").trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  copy: "©",
  reg: "®",
  trade: "™",
  middot: "·",
  bull: "•",
  times: "×",
  rarr: "→",
  larr: "←",
};

/** Decodes the HTML entities a content file is likely to hold. */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    }
    if (name.startsWith("#")) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** Removes HTML tags, keeping their text content. */
export function stripTags(value: string): string {
  return value.replace(/<!--[\s\S]*?-->/g, "").replace(/<\/?[a-zA-Z][^<>]*>/g, "");
}

/**
 * Strips inline markdown so stored text can be compared with what a page
 * shows. Conservative on purpose: only constructs whose visible text is
 * unambiguous are removed.
 */
export function stripInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*\*([^*]+)\*\*\*/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1$2")
    .replace(/___([^_]+)___/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[^\w_])_([^_\n]+)_(?!\w)/g, "$1$2")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1");
}

/** Visible text: tags and inline markdown stripped, entities decoded, whitespace collapsed. */
export function visibleText(value: string): string {
  return collapseWhitespace(decodeEntities(stripTags(stripInlineMarkdown(value))));
}

/**
 * The form two strings are compared in when matching a click to its source.
 * Renderers commonly "smarten" punctuation (straight quotes to curly, `--` to
 * a dash, `...` to an ellipsis), so both sides are folded to one spelling.
 */
export function matchKey(value: string): string {
  return visibleText(value)
    .replace(/[‘’‚‛′`]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/…/g, "...")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/-{2,3}/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether `value` carries inline markdown or HTML a reader would not see verbatim. */
export function hasMarkup(value: string): boolean {
  return visibleText(value) !== collapseWhitespace(value);
}

/** The first `max` characters of `value`, cut at a word boundary. */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const space = cut.lastIndexOf(" ");

  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** "about-us" → "About us" — a title approximated from a file name. */
export function titleFromFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, "");

  return labelForKey(base.replace(/^\d{4}-\d{2}-\d{2}-/, ""));
}
