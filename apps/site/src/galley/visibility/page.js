// Vendored from @galley/astro 0.4.2 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// What a rendered page says about itself, read from its HTML: the facts the
// twin, llms.txt, the sitemap and the structured data are built from. Only
// what the page states is used — its title, description, canonical address,
// robots directives, Open Graph and article tags, its own structured data,
// feeds and email links — so nothing here is ever invented.

import { find, findAll, parseHtml, textOf } from "./html.js";
import { pageMarkdown } from "./markdown.js";

/** @typedef {import("./html.js").Element} Element */

/**
 * @typedef {object} PageFacts
 * @property {string} path  The page's address on the site, with the base, e.g. "/demo/about/".
 * @property {string} url  Its absolute address.
 * @property {string} title  The <title>.
 * @property {string} name  What to call it: og:title, else the first <h1>, else the title.
 * @property {string} description
 * @property {string | null} canonical  As the page states it (absolute).
 * @property {boolean} noindex
 * @property {boolean} redirect  A meta-refresh page (Astro writes these for redirects).
 * @property {string} lang
 * @property {string} siteName  og:site_name or application-name, when given.
 * @property {string} type  og:type.
 * @property {string} image  og:image, absolute.
 * @property {string} published  article:published_time.
 * @property {string} modified  article:modified_time.
 * @property {string} author  article:author or meta author, when it is a name.
 * @property {string[]} jsonldTypes  The types named in the page's own JSON-LD.
 * @property {{ title: string; href: string; type: string }[]} feeds
 * @property {string[]} emails  mailto: addresses in the page's main content and footer.
 * @property {string} markdown  The twin's body ("" when not made).
 * @property {boolean} hasH1
 */

/** @param {Element} head @param {string} key */
function meta(head, key) {
  const wanted = key.toLowerCase();
  const el = find(head, (node) => node.name === "meta" && ((node.attrs.name ?? "").toLowerCase() === wanted || (node.attrs.property ?? "").toLowerCase() === wanted));

  return (el?.attrs.content ?? "").trim();
}

/** @param {string} value @param {string} base */
function resolve(value, base) {
  if (!value) return "";
  try {
    return new URL(value, base).href;
  } catch {
    return "";
  }
}

/** Every type a JSON-LD value names (graphs and nested nodes included). */
function typesIn(/** @type {unknown} */ value, /** @type {Set<string>} */ out) {
  if (Array.isArray(value)) {
    for (const item of value) typesIn(item, out);
    return;
  }
  if (!value || typeof value !== "object") return;
  const node = /** @type {Record<string, unknown>} */ (value);
  const type = node["@type"];

  for (const item of Array.isArray(type) ? type : [type]) if (typeof item === "string") out.add(item.replace(/^https?:\/\/schema\.org\//, ""));
  for (const [key, child] of Object.entries(node)) if (key !== "@context") typesIn(child, out);
}

/**
 * @param {string} html
 * @param {{ path: string; url: string; twin?: boolean }} where
 * @returns {PageFacts}
 */
export function readPage(html, where) {
  const doc = parseHtml(html);
  const root = find(doc, (el) => el.name === "html");
  const head = find(doc, (el) => el.name === "head") ?? doc;
  const body = find(doc, (el) => el.name === "body") ?? doc;
  const robots = [meta(head, "robots"), meta(head, "googlebot")].join(",").toLowerCase();
  const canonicalLink = find(head, (el) => el.name === "link" && (el.attrs.rel ?? "").toLowerCase().split(/\s+/).includes("canonical"));
  const title = textOf(find(head, (el) => el.name === "title") ?? { type: "text", value: "", parent: null });
  const h1 = find(body, (el) => el.name === "h1");
  const ogTitle = meta(head, "og:title");
  const author = meta(head, "article:author") || meta(head, "author");
  const types = new Set(/** @type {string[]} */ ([]));

  for (const script of findAll(doc, (el) => el.name === "script" && (el.attrs.type ?? "").toLowerCase() === "application/ld+json")) {
    try {
      typesIn(JSON.parse(textOf(script) || (script.children[0]?.type === "text" ? script.children[0].value : "")), types);
    } catch {
      // A block that doesn't parse names nothing; the audit reports it.
    }
  }
  const feeds = findAll(head, (el) => el.name === "link" && (el.attrs.rel ?? "").toLowerCase() === "alternate" && /^application\/(rss|atom|feed)\+(xml|json)$/i.test(el.attrs.type ?? ""))
    .map((el) => ({ title: (el.attrs.title ?? "").trim(), href: resolve(el.attrs.href ?? "", where.url), type: (el.attrs.type ?? "").toLowerCase() }))
    .filter((feed) => feed.href);
  const emails = [
    ...new Set(
      findAll(body, (el) => el.name === "a" && /^mailto:/i.test(el.attrs.href ?? ""))
        .map((el) => decodeURIComponent((el.attrs.href ?? "").replace(/^mailto:/i, "").split("?")[0] ?? "").trim())
        .filter((address) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)),
    ),
  ];
  const twin = where.twin === false ? { markdown: "", hasH1: false } : pageMarkdown(doc, { url: where.url });

  return {
    path: where.path,
    url: where.url,
    title,
    name: ogTitle || (h1 ? textOf(h1) : "") || title,
    description: (meta(head, "description") || meta(head, "og:description")).replace(/\s+/g, " "),
    canonical: canonicalLink?.attrs.href ? resolve(canonicalLink.attrs.href, where.url) : null,
    noindex: /(^|[\s,])(noindex|none)([\s,]|$)/.test(robots),
    redirect: Boolean(find(head, (el) => el.name === "meta" && (el.attrs["http-equiv"] ?? "").toLowerCase() === "refresh")),
    lang: root?.attrs.lang ?? "",
    siteName: meta(head, "og:site_name") || meta(head, "application-name"),
    type: meta(head, "og:type").toLowerCase(),
    image: resolve(meta(head, "og:image"), where.url),
    published: meta(head, "article:published_time"),
    modified: meta(head, "article:modified_time"),
    author: /^https?:\/\//i.test(author) ? "" : author,
    jsonldTypes: [...types].sort(),
    feeds,
    emails,
    markdown: twin.markdown,
    hasH1: twin.hasH1,
  };
}

/**
 * Adds HTML right before </head> (or at the start of <body>, or the end).
 *
 * @param {string} html
 * @param {string} addition
 */
export function addToHead(html, addition) {
  if (!addition) return html;
  const close = /<\/head\s*>/i.exec(html);

  if (close) return html.slice(0, close.index) + addition + html.slice(close.index);
  const body = /<body\b[^>]*>/i.exec(html);

  if (body) return html.slice(0, body.index) + addition + html.slice(body.index);
  return html + addition;
}
