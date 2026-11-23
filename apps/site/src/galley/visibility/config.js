// Vendored from @galley/astro 0.1.1 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// The visibility data file — src/data/visibility.json unless the
// integration names another — read, checked and given its defaults. Every
// part can be switched off; with no file at all a site gets the safe
// defaults: markdown twins, llms.txt, llms-full.txt and the agent page on,
// structured data where the page's own facts allow it, robots.txt and
// sitemap.xml only when the site has none of its own, and no crawler
// blocked.
//
//   {
//     "site": { "name": "Ferrow", "summary": "One sentence about the site." },
//     "crawlers": { "GPTBot": "block", "OAI-SearchBot": "allow" },
//     "robots": { "disallow": ["/drafts/"] },
//     "sitemap": { "exclude": ["/thanks/"], "lastmod": "content" },
//     "structuredData": { "website": true, "organization": { "logo": "/images/logo.svg", "sameAs": [] },
//                         "articles": ["blog"], "breadcrumbs": true },
//     "agentReadable": { "llmsTxt": true, "llmsFullTxt": true, "markdownTwins": true, "agentPage": true,
//                        "optional": ["/privacy/"], "exclude": [], "contact": "hello@example.com" }
//   }

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_FILE = "src/data/visibility.json";
/** llms-full.txt stops before this many bytes. */
export const FULL_MAX_BYTES = 1_000_000;

/**
 * @typedef {object} VisibilitySettings
 * @property {{ name: string; summary: string }} site
 * @property {Record<string, "allow" | "block">} crawlers
 * @property {{ enabled: boolean; disallow: string[]; allow: string[] }} robots
 * @property {{ enabled: boolean; exclude: string[]; lastmod: "content" | "none" }} sitemap
 * @property {{ website: boolean; organization: false | { name: string; logo: string; sameAs: string[]; email: string; telephone: string }; articles: "auto" | false | string[]; breadcrumbs: boolean }} structuredData
 * @property {{ llmsTxt: boolean; llmsFullTxt: boolean; markdownTwins: boolean; agentPage: boolean; optional: string[]; exclude: string[]; contact: string; fullMaxBytes: number }} agentReadable
 */

export class VisibilityFileError extends Error {}

/** @returns {VisibilitySettings} */
export function defaultSettings() {
  return {
    site: { name: "", summary: "" },
    crawlers: {},
    robots: { enabled: true, disallow: [], allow: [] },
    sitemap: { enabled: true, exclude: [], lastmod: "content" },
    structuredData: { website: true, organization: { name: "", logo: "", sameAs: [], email: "", telephone: "" }, articles: "auto", breadcrumbs: true },
    agentReadable: { llmsTxt: true, llmsFullTxt: true, markdownTwins: true, agentPage: true, optional: [], exclude: [], contact: "", fullMaxBytes: FULL_MAX_BYTES },
  };
}

/** A robots.txt product token (RFC 9309: letters, "_" and "-"); digits are accepted as crawlers use them. */
const TOKEN = /^[A-Za-z0-9_-]+$/;

/**
 * The file's contents with defaults applied. Throws a VisibilityFileError
 * listing every problem, in plain words, when something can't be used.
 *
 * @param {unknown} raw
 * @param {string} [file]  For the messages.
 * @returns {VisibilitySettings}
 */
export function normalizeSettings(raw, file = DEFAULT_FILE) {
  const out = defaultSettings();
  /** @type {string[]} */
  const problems = [];

  if (raw === undefined || raw === null) return out;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new VisibilityFileError(`${file} must hold an object, like { "crawlers": { "GPTBot": "block" } }.`);
  const data = /** @type {Record<string, unknown>} */ (raw);
  const known = new Set(["$schema", "site", "crawlers", "robots", "sitemap", "structuredData", "agentReadable"]);

  for (const key of Object.keys(data)) if (!known.has(key)) problems.push(`“${key}” isn't a setting this kit knows (it reads site, crawlers, robots, sitemap, structuredData and agentReadable).`);
  /** @param {unknown} value @param {string} at */
  const section = (value, at) => {
    if (value === undefined) return null;
    if (value === false) return false;
    if (value === true) return {};
    if (typeof value === "object" && value !== null && !Array.isArray(value)) return /** @type {Record<string, unknown>} */ (value);
    problems.push(`${at} should be an object of settings, or false to turn it off.`);
    return null;
  };
  /** @param {Record<string, unknown>} from @param {string} key @param {string} at @param {boolean} fallback */
  const bool = (from, key, at, fallback) => {
    const value = from[key];

    if (value === undefined) return fallback;
    if (typeof value === "boolean") return value;
    problems.push(`${at}.${key} should be true or false.`);
    return fallback;
  };
  /** @param {Record<string, unknown>} from @param {string} key @param {string} at */
  const text = (from, key, at) => {
    const value = from[key];

    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value.trim();
    problems.push(`${at}.${key} should be text.`);
    return "";
  };
  /** @param {Record<string, unknown>} from @param {string} key @param {string} at @param {boolean} [paths] */
  const list = (from, key, at, paths = false) => {
    const value = from[key];

    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      problems.push(`${at}.${key} should be a list of ${paths ? "addresses on the site, like \"/thanks/\"" : "texts"}.`);
      return [];
    }
    const items = /** @type {string[]} */ (value).map((item) => item.trim()).filter(Boolean);

    if (paths) for (const item of items) if (!item.startsWith("/")) problems.push(`${at}.${key}: “${item}” should start with “/” (an address on the site, without the domain).`);
    return items;
  };

  const site = section(data.site, "site");

  if (site) out.site = { name: text(site, "name", "site"), summary: text(site, "summary", "site") };

  if (data.crawlers !== undefined) {
    if (typeof data.crawlers !== "object" || data.crawlers === null || Array.isArray(data.crawlers)) problems.push('crawlers should map a crawler\'s name to "allow" or "block", like { "GPTBot": "block" }.');
    else {
      for (const [token, choice] of Object.entries(data.crawlers)) {
        if (!TOKEN.test(token)) problems.push(`crawlers: “${token}” isn't a crawler name robots.txt can use (letters, digits, “-” and “_” only).`);
        else if (choice !== "allow" && choice !== "block") problems.push(`crawlers.${token} should be "allow" or "block".`);
        else out.crawlers[token] = choice;
      }
    }
  }

  const robots = section(data.robots, "robots");

  if (robots === false) out.robots.enabled = false;
  else if (robots) out.robots = { enabled: bool(robots, "enabled", "robots", true), disallow: list(robots, "disallow", "robots", true), allow: list(robots, "allow", "robots", true) };

  const sitemap = section(data.sitemap, "sitemap");

  if (sitemap === false) out.sitemap.enabled = false;
  else if (sitemap) {
    const lastmod = sitemap.lastmod ?? "content";

    if (lastmod !== "content" && lastmod !== "none") problems.push('sitemap.lastmod should be "content" (dates the pages state) or "none".');
    out.sitemap = { enabled: bool(sitemap, "enabled", "sitemap", true), exclude: list(sitemap, "exclude", "sitemap", true), lastmod: lastmod === "none" ? "none" : "content" };
  }

  const structured = section(data.structuredData, "structuredData");

  if (structured === false) out.structuredData = { website: false, organization: false, articles: false, breadcrumbs: false };
  else if (structured) {
    const organization = section(structured.organization, "structuredData.organization");
    const articles = structured.articles;

    out.structuredData = {
      website: bool(structured, "website", "structuredData", true),
      organization:
        organization === false
          ? false
          : {
              name: organization ? text(organization, "name", "structuredData.organization") : "",
              logo: organization ? text(organization, "logo", "structuredData.organization") : "",
              sameAs: organization ? list(organization, "sameAs", "structuredData.organization") : [],
              email: organization ? text(organization, "email", "structuredData.organization") : "",
              telephone: organization ? text(organization, "telephone", "structuredData.organization") : "",
            },
      articles: articles === undefined || articles === true || articles === "auto" ? "auto" : articles === false ? false : Array.isArray(articles) && articles.every((item) => typeof item === "string") ? articles.map((item) => item.trim()).filter(Boolean) : "auto",
      breadcrumbs: bool(structured, "breadcrumbs", "structuredData", true),
    };
    if (!(articles === undefined || typeof articles === "boolean" || articles === "auto" || (Array.isArray(articles) && articles.every((item) => typeof item === "string")))) {
      problems.push('structuredData.articles should list collections (like ["blog"]) or addresses (like ["/news/*"]), or be "auto" or false.');
    }
    if (out.structuredData.organization) {
      for (const link of out.structuredData.organization.sameAs) if (!/^https?:\/\/\S+$/i.test(link)) problems.push(`structuredData.organization.sameAs: “${link}” should be a full address starting with https://.`);
      const logo = out.structuredData.organization.logo;

      if (logo && !logo.startsWith("/") && !/^https?:\/\//i.test(logo)) problems.push(`structuredData.organization.logo: “${logo}” should be an address on the site (like "/images/logo.png") or a full address.`);
    }
  }

  const agent = section(data.agentReadable, "agentReadable");

  if (agent === false) out.agentReadable = { ...out.agentReadable, llmsTxt: false, llmsFullTxt: false, markdownTwins: false, agentPage: false };
  else if (agent) {
    const max = agent.fullMaxBytes;

    if (max !== undefined && (typeof max !== "number" || !Number.isInteger(max) || max < 10_000)) problems.push("agentReadable.fullMaxBytes should be a whole number of bytes, at least 10000.");
    out.agentReadable = {
      llmsTxt: bool(agent, "llmsTxt", "agentReadable", true),
      llmsFullTxt: bool(agent, "llmsFullTxt", "agentReadable", true),
      markdownTwins: bool(agent, "markdownTwins", "agentReadable", true),
      agentPage: bool(agent, "agentPage", "agentReadable", true),
      optional: list(agent, "optional", "agentReadable", true),
      exclude: list(agent, "exclude", "agentReadable", true),
      contact: text(agent, "contact", "agentReadable"),
      fullMaxBytes: typeof max === "number" && Number.isInteger(max) && max >= 10_000 ? max : FULL_MAX_BYTES,
    };
  }
  if (problems.length) {
    throw new VisibilityFileError(`${file} has ${problems.length === 1 ? "a problem" : `${problems.length} problems`}:\n${problems.map((line) => `  - ${line}`).join("\n")}`);
  }
  return out;
}

/**
 * The site's visibility file, read and checked (defaults when there is none).
 *
 * @param {string} root  The site's folder.
 * @param {string} [file]
 * @returns {{ settings: VisibilitySettings; exists: boolean }}
 */
export function readSettings(root, file = DEFAULT_FILE) {
  const path = join(root, file);

  if (!existsSync(path)) return { settings: defaultSettings(), exists: false };
  let raw;

  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new VisibilityFileError(`${file} can't be read as JSON (${error instanceof Error ? error.message : String(error)}). Fix the file, or remove it to use the defaults.`);
  }
  return { settings: normalizeSettings(raw, file), exists: true };
}
