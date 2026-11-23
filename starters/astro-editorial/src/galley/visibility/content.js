// Vendored from @galley/astro 0.1.2 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// What the site's content files say that a rendered page can't: which
// collection a page belongs to (for "articles": ["blog"]), which entries
// are drafts (so a dev server that shows drafts still never lists them), and
// each entry's date, for a page whose HTML doesn't state it.
//
// Addresses come from galley.config.json's collection `url` patterns when
// the site has one ("/blog/{slug}/"), else the folder name ("/blog/{slug}/";
// "pages" is "/{slug}/"). Drafts are entries whose front matter (or JSON /
// YAML) sets the collection's draft field — "draft" unless galley.config.json
// names another — to true. Dates come from the collection's dateField in
// galley.config.json, else `date`, `pubDate`, `publishDate` or `published`,
// written as an ISO date ("2026-08-20", "2026-08-20T09:00:00Z"). Read with
// plain text matching, so the kit needs no YAML parser; a field written some
// other way is simply not seen.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * @typedef {object} SiteContent
 * @property {string} name  galley.config.json's `name`, when there is one.
 * @property {Record<string, string>} patterns  collection id → address pattern, e.g. "/blog/{slug}/".
 * @property {string[]} drafts  Addresses (without the base) of draft entries.
 * @property {Record<string, string>} dates  Address (without the base) → the entry's date, as written.
 */

const ENTRY = /\.(md|mdx|markdown|mdoc|json|ya?ml)$/i;

/** @param {string} dir @returns {string[]} */
function files(dir) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} at */
  const walk = (at) => {
    for (const name of readdirSync(at).sort()) {
      if (name.startsWith(".") || name.startsWith("_")) continue;
      const path = join(at, name);
      const info = statSync(path);

      if (info.isDirectory()) walk(path);
      else if (ENTRY.test(name)) out.push(path);
    }
  };

  walk(dir);
  return out;
}

/** Whether a content file sets `field` to true. */
export function isDraft(/** @type {string} */ text, /** @type {string} */ file, field = "draft") {
  const key = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  if (/\.json$/i.test(file)) {
    try {
      const data = JSON.parse(text);

      return Boolean(data && typeof data === "object" && data[field] === true);
    } catch {
      return false;
    }
  }
  const yaml = /\.ya?ml$/i.test(file) ? text : /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";

  return new RegExp(`^${key}\\s*:\\s*(true|yes|on)\\s*(#.*)?$`, "mi").test(yaml);
}

const DATE_KEYS = ["date", "pubDate", "publishDate", "published"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** The entry's date, as written, when it is an ISO date. */
export function entryDate(/** @type {string} */ text, /** @type {string} */ file, /** @type {string[]} */ keys) {
  if (/\.json$/i.test(file)) {
    try {
      const data = JSON.parse(text);

      for (const key of keys) if (typeof data?.[key] === "string" && ISO_DATE.test(data[key].trim())) return data[key].trim();
    } catch {
      return "";
    }
    return "";
  }
  const yaml = /\.ya?ml$/i.test(file) ? text : /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";

  for (const key of keys) {
    const match = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*["']?([^"'#\\r\\n]+?)["']?\\s*(#.*)?$`, "m").exec(yaml);
    const value = match?.[1]?.trim() ?? "";

    if (ISO_DATE.test(value)) return value;
  }
  return "";
}

/** An entry's slug from its file: "blog/first-post.md" → "first-post"; "guides/setup/index.md" → "guides/setup". */
function slugOf(/** @type {string} */ path) {
  const bare = path.replace(/\\/g, "/").replace(ENTRY, "");

  return bare.endsWith("/index") ? bare.slice(0, -"/index".length) : bare === "index" ? "" : bare;
}

/** An address pattern as a path: "/blog/{slug}/" with slug "x" → "/blog/x/". */
export function fillPattern(/** @type {string} */ pattern, /** @type {string} */ slug) {
  const filled = pattern.replace(/\{[^}]+\}/g, slug.toLowerCase());

  return filled.replace(/\/{2,}/g, "/") || "/";
}

/** An address pattern as a glob for one level of entries: "/blog/{slug}/" → "/blog/*". */
export function patternGlob(/** @type {string} */ pattern) {
  return pattern.replace(/\{[^}]+\}/g, "*").replace(/\/+$/, "") || "/";
}

/**
 * @param {string} root  The site's folder.
 * @returns {SiteContent}
 */
export function readSiteContent(root) {
  /** @type {SiteContent} */
  const out = { name: "", patterns: {}, drafts: [], dates: {} };
  /** @type {Record<string, string>} */
  const draftFields = {};
  /** @type {Record<string, string>} */
  const dateFields = {};
  const configPath = join(root, "galley.config.json");
  /** @type {Set<string>} */
  const pageless = new Set();

  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf8"));

      if (typeof config?.name === "string") out.name = config.name.trim();
      for (const collection of Array.isArray(config?.collections) ? config.collections : []) {
        if (typeof collection?.id !== "string") continue;
        if (typeof collection.url === "string" && collection.url.startsWith("/")) out.patterns[collection.id] = collection.url;
        else if (collection.url === null) pageless.add(collection.id);
        if (typeof collection.draftField === "string") draftFields[collection.id] = collection.draftField;
        if (typeof collection.dateField === "string") dateFields[collection.id] = collection.dateField;
      }
    } catch {
      // The app reports a broken galley.config.json; here it only means no patterns.
    }
  }
  const contentDir = join(root, "src", "content");

  if (!existsSync(contentDir)) return out;
  for (const id of readdirSync(contentDir).sort()) {
    const dir = join(contentDir, id);

    if (!statSync(dir).isDirectory() || pageless.has(id)) continue;
    const pattern = out.patterns[id] ?? (id === "pages" ? "/{slug}/" : `/${id}/{slug}/`);

    for (const file of files(dir)) {
      let text = "";

      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const slug = slugOf(relative(dir, file));
      const address = id === "pages" && (slug === "index" || slug === "") ? "/" : fillPattern(pattern, slug);

      if (isDraft(text, file, draftFields[id] ?? "draft")) {
        out.drafts.push(address);
        continue;
      }
      const date = entryDate(text, file, dateFields[id] ? [dateFields[id]] : DATE_KEYS);

      if (date) out.dates[address] = date;
    }
  }
  out.drafts.sort();
  return out;
}
