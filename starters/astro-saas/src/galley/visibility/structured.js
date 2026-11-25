// Vendored from @galley/astro 0.4.2 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// JSON-LD for the facts a site actually has, checked against Google's
// current documentation (read 23 November 2026). Each builder returns null
// rather than something incomplete:
//
//   WebSite         home page only; `name` and `url` are required, and the
//                   url must be the root of the host — so nothing is written
//                   for a site built under a sub-path.
//                   developers.google.com/search/docs/appearance/site-names
//   Organization    home page; no required properties — written with the
//                   name and url, plus logo/sameAs/email/telephone when the
//                   data file gives them (a logo only when its file exists).
//                   …/appearance/structured-data/organization
//   Article /       no required properties; written only when the page
//   BlogPosting     states a headline and a publication date
//                   (article:published_time), with dateModified, author
//                   (as a Person, by name) and image when the page states
//                   them. The site's generic share picture is never used as
//                   a post's image: Google asks for images of the article.
//                   …/appearance/structured-data/article
//   BreadcrumbList  pages two or more levels deep; at least two ListItems,
//                   each with position, name and an absolute item address.
//                   …/appearance/structured-data/breadcrumb
//
// A page that already carries a type of its own keeps it, and gets no second
// one from the kit.

/** @typedef {import("./page.js").PageFacts} PageFacts */
/** @typedef {Record<string, unknown>} JsonLd */

const CONTEXT = "https://schema.org";

/** @param {string} value */
function isoDate(value) {
  if (!value) return "";
  const time = Date.parse(value);

  return Number.isFinite(time) ? value.trim() : "";
}

/**
 * @param {{ name: string; url: string; subPath: boolean }} site
 * @returns {JsonLd | null}
 */
export function websiteLd(site) {
  if (!site.name || !/^https?:\/\//.test(site.url) || site.subPath) return null;
  return { "@context": CONTEXT, "@type": "WebSite", name: site.name, url: site.url };
}

/**
 * @param {{ name: string; url: string; logo?: string; sameAs?: string[]; email?: string; telephone?: string }} org
 * @returns {JsonLd | null}
 */
export function organizationLd(org) {
  if (!org.name || !/^https?:\/\//.test(org.url)) return null;
  /** @type {JsonLd} */
  const out = { "@context": CONTEXT, "@type": "Organization", name: org.name, url: org.url };

  if (org.logo) out.logo = org.logo;
  if (org.sameAs && org.sameAs.length) out.sameAs = [...org.sameAs];
  if (org.email) out.email = org.email;
  if (org.telephone) out.telephone = org.telephone;
  return out;
}

/**
 * @param {PageFacts} page
 * @param {{ type: "Article" | "BlogPosting"; siteImage: string }} options
 * @returns {JsonLd | null}
 */
export function articleLd(page, options) {
  const headline = page.name.trim();
  const published = isoDate(page.published);

  if (!headline || !published) return null;
  /** @type {JsonLd} */
  const out = { "@context": CONTEXT, "@type": options.type, headline, datePublished: published };
  const modified = isoDate(page.modified);

  if (modified) out.dateModified = modified;
  if (page.author) out.author = [{ "@type": "Person", name: page.author }];
  if (page.image && page.image !== options.siteImage) out.image = [page.image];
  out.url = page.canonical ?? page.url;
  return out;
}

/**
 * @param {{ name: string; url: string }[]} trail  From the top section down to the page itself.
 * @returns {JsonLd | null}
 */
export function breadcrumbLd(trail) {
  const items = trail.filter((step) => step.name && /^https?:\/\//.test(step.url));

  if (items.length < 2 || items.length !== trail.length) return null;
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: items.map((step, index) => ({ "@type": "ListItem", position: index + 1, name: step.name, item: step.url })),
  };
}

/**
 * Required properties, per Google's docs, of what this module writes — the
 * same rules the app's audit applies (packages/core/src/seo/rendered-checks.ts).
 *
 * @param {JsonLd} node
 * @returns {string[]}  What is missing; empty when complete.
 */
export function missingRequired(node) {
  const type = node["@type"];

  if (type === "WebSite") return ["name", "url"].filter((key) => !node[key]);
  if (type === "BreadcrumbList") {
    const items = Array.isArray(node.itemListElement) ? /** @type {Record<string, unknown>[]} */ (node.itemListElement) : [];
    const missing = items.length < 2 ? ["at least two itemListElement entries"] : [];

    items.forEach((item, index) => {
      if (typeof item.position !== "number") missing.push(`position on item ${index + 1}`);
      if (!item.name) missing.push(`name on item ${index + 1}`);
      if (typeof item.item !== "string" || !/^https?:\/\//.test(item.item)) missing.push(`an absolute item on item ${index + 1}`);
    });
    return missing;
  }
  return [];
}

/** A JSON-LD block, safe inside HTML. */
export function jsonLdTag(/** @type {JsonLd} */ node) {
  return `<script type="application/ld+json" data-galley-jsonld>${JSON.stringify(node).replace(/</g, "\\u003c")}</script>`;
}
