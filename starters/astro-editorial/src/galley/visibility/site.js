// Vendored from @galley/astro 0.2.0 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// The whole agent-readable output of a site, from its rendered pages: which
// pages count, each page's markdown twin and the tags its <head> gains, and
// the site-wide files — llms.txt, llms-full.txt, agent.md, robots.txt and
// sitemap.xml. Pure: the same pages and settings always give the same bytes,
// whether they come from a build's output folder or a running dev server.
//
// Addresses (every one under the site's base path):
//   a page            /about/            its twin   /about.md
//   the home page     /                  its twin   /index.md
//   a file-style page /about.html        its twin   /about.md
// — the llms.txt proposal's "the page's address with .md" for pages without
// a trailing slash, and its "index.md" form for the home page. A twin is a
// plain file next to the page's folder, so it works on any static host,
// under any sub-path, with no rewrite rules.

import { matchGlob } from "../shared/glob.js";
import { AI_CRAWLERS, aiCrawler, PURPOSE_NOTES } from "./crawlers.js";
import { patternGlob } from "./content.js";
import { articleLd, breadcrumbLd, jsonLdTag, organizationLd, websiteLd } from "./structured.js";

/** @typedef {import("./page.js").PageFacts} PageFacts */
/** @typedef {import("./config.js").VisibilitySettings} VisibilitySettings */

/** llms.txt lists at most this many pages; the rest are in the sitemap. */
export const MAX_LLMS_LINKS = 2000;
/** The sitemaps protocol's limit per file. */
export const MAX_SITEMAP_URLS = 50_000;

/**
 * @typedef {object} SiteInput
 * @property {PageFacts[]} pages  Every rendered page.
 * @property {VisibilitySettings} settings
 * @property {string} origin  "https://www.example.com", or "" when the site has no `site` address.
 * @property {string} base  The base path without a trailing slash ("" or "/demo").
 * @property {{ robots: string | null; sitemap: string | null; llmsTxt: boolean; llmsFullTxt: boolean; agentPage: boolean }} own
 *   What the site already publishes itself (the kit then leaves it alone). `robots` / `sitemap`: the file's name, or null.
 * @property {string[]} [drafts]  Addresses (without the base) of draft entries.
 * @property {Record<string, string>} [dates]  Address (without the base) → its content entry's date, for pages whose HTML states none.
 * @property {Record<string, string>} [patterns]  Collection id → address pattern ("/blog/{slug}/").
 * @property {string} [fallbackName]  The site's name when no page states one (galley.config.json).
 * @property {(path: string) => boolean} [fileExists]  Whether the site serves a file (for the logo).
 */

/**
 * @typedef {object} SitePlan
 * @property {Map<string, string>} head  page path → HTML to add before </head>.
 * @property {Record<string, string>} files  File path under the output folder → text.
 * @property {Record<string, string>} types  File path → content type, for a server.
 * @property {string[]} notes  What the build log says.
 * @property {{ pages: number; listed: number; twins: number; structured: number; sitemap: number; llmsLinks: number; fullBytes: number; fullTruncated: boolean }} counts
 */

/**
 * "/demo/about/" → "/demo/about.md"; the home page "/demo/" → "/demo/index.md".
 *
 * @param {string} path  The page's address, with the base.
 * @param {string} [base]  The base path ("" or "/demo"), to know the home page.
 */
export function twinPath(path, base = "") {
  const clean = path.split(/[?#]/)[0] ?? "/";

  if (clean === "/" || clean === `${base}/`) return `${clean}index.md`;
  if (clean.endsWith("/")) return `${clean.slice(0, -1)}.md`;
  if (/\/index\.html?$/.test(clean)) return clean.replace(/\/index\.html?$/, "/index.md");
  return `${clean.replace(/\.html?$/, "")}.md`;
}

/** The page addresses a twin address can belong to, most likely first. */
export function pagesForTwin(/** @type {string} */ path, /** @type {string} */ base) {
  if (!path.endsWith(".md")) return [];
  const bare = path.slice(0, -3);

  if (bare === `${base}/index`) return [`${base}/`];
  if (bare.endsWith("/index")) return [`${bare.slice(0, -"index".length)}`, `${bare}/`];
  return [`${bare}/`, bare, `${bare}.html`];
}

/** "/about" and "/about/" as one key. */
export function pathKey(/** @type {string} */ path) {
  const bare = (path.split(/[?#]/)[0] ?? "").replace(/\/index\.html?$/, "/").replace(/\.html?$/, "");

  return bare === "/" || bare === "" ? "/" : bare.replace(/\/+$/, "");
}

/** The page's address on the site without the base: "/demo/about/" → "/about/". */
export function sitePath(/** @type {string} */ path, /** @type {string} */ base) {
  if (!base) return path;
  if (path === base) return "/";
  return path.startsWith(`${base}/`) ? path.slice(base.length) : path;
}

const SPECIAL = /^\/(404|500)(\/|\.html)?$/;

/** @param {string} value */
const yaml = (value) => JSON.stringify(value);
/** @param {string} value */
const xml = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
/** One line of text for a list: no line breaks. */
const oneLine = (/** @type {string} */ value) => value.replace(/\s+/g, " ").trim();
/** Link text for llms.txt: brackets would end the link early. */
const linkText = (/** @type {string} */ value) => oneLine(value).replace(/([[\]\\])/g, "\\$1");

/** @param {string} value */
function dateOnly(value) {
  const time = Date.parse(value);

  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : "";
}

/** "release-notes" → "Release notes". */
function humanize(/** @type {string} */ segment) {
  const words = decodeURIComponent(segment).replace(/[-_]+/g, " ").trim();

  return words ? words.charAt(0).toUpperCase() + words.slice(1) : segment;
}

/**
 * Whether a robots rule path (with `*` and `$`) matches an address.
 *
 * @param {string} rule
 * @param {string} path
 */
function robotsMatch(rule, path) {
  const anchored = rule.endsWith("$");
  const body = anchored ? rule.slice(0, -1) : rule;
  const source = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");

  return new RegExp(`^${source}${anchored ? "$" : ""}`).test(path);
}

/**
 * Whether the site-wide rules let crawlers fetch an address: the longest
 * matching rule wins, and Allow wins a tie (RFC 9309, section 2.2.2).
 *
 * @param {{ disallow: string[]; allow: string[] }} rules
 * @param {string} path
 */
export function robotsAllows(rules, path) {
  let best = { allow: true, length: -1 };

  for (const [allow, list] of /** @type {[boolean, string[]][]} */ ([[false, rules.disallow], [true, rules.allow]])) {
    for (const rule of list) {
      if (!robotsMatch(rule, path)) continue;
      if (rule.length > best.length || (rule.length === best.length && allow)) best = { allow, length: rule.length };
    }
  }
  return best.allow;
}

/**
 * @param {SiteInput} input
 * @returns {SitePlan}
 */
export function planSite(input) {
  const { settings, origin, base, own } = input;
  const agent = settings.agentReadable;
  const notes = /** @type {string[]} */ ([]);
  const abs = (/** @type {string} */ path) => (origin ? `${origin}${path}` : path);
  const home = input.pages.find((page) => pathKey(sitePath(page.path, base)) === "/");
  const drafts = new Set((input.drafts ?? []).map(pathKey));
  const siteName = settings.site.name || home?.siteName || input.fallbackName || home?.name || (origin ? new URL(origin).hostname : "This site");
  const summary = oneLine(settings.site.summary || home?.description || "");
  const rootUrl = abs(`${base}/`);
  // A page the kit's own robots.txt asks every crawler to stay away from isn't listed for them either.
  const disallowed = (/** @type {string} */ path) => settings.robots.enabled && !own.robots && !robotsAllows(settings.robots, sitePath(path, base));

  // ── Which pages count ────────────────────────────────────────────────
  /** @param {PageFacts} page */
  const listed = (page) => {
    const local = sitePath(page.path, base);

    if (page.noindex || page.redirect || SPECIAL.test(local) || drafts.has(pathKey(local)) || disallowed(page.path)) return false;
    // A page whose canonical address is another page is a copy of that page.
    if (page.canonical) {
      try {
        if (pathKey(new URL(page.canonical).pathname) !== pathKey(page.path)) return false;
      } catch {
        return false;
      }
    }
    return true;
  };
  // A page that states no date of its own takes its content entry's, when it has one.
  const dated = new Map(Object.entries(input.dates ?? {}).map(([path, date]) => [pathKey(path), date]));
  const pages = [...input.pages]
    .map((page) => {
      const date = page.published ? "" : dated.get(pathKey(sitePath(page.path, base)));

      return date ? { ...page, published: date } : page;
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const counted = pages.filter(listed);
  const byKey = new Map(counted.map((page) => [pathKey(page.path), page]));
  const twinned = agent.markdownTwins ? counted.filter((page) => page.markdown && !agent.exclude.some((glob) => matchGlob(sitePath(page.path, base), glob))) : [];
  /** @type {Record<string, string>} */
  const files = {};
  /** @type {Record<string, string>} */
  const types = {};
  const twinOf = new Map(/** @type {[string, string][]} */ ([]));
  const fileFor = (/** @type {string} */ path) => sitePath(path, base).replace(/^\/+/, "");

  // ── Twins ────────────────────────────────────────────────────────────
  for (const page of twinned) {
    const path = twinPath(page.path, base);
    const file = fileFor(path);

    if (files[file] !== undefined) {
      notes.push(`${path} would be the markdown version of two pages; only ${twinOf.get(file) ?? "the first"} got it.`);
      continue;
    }
    files[file] = twinText(page, page.canonical ?? page.url);
    types[file] = "text/markdown; charset=utf-8";
    twinOf.set(file, page.path);
  }
  const hasTwin = (/** @type {PageFacts} */ page) => twinOf.get(fileFor(twinPath(page.path, base))) === page.path;

  // ── Structured data and the <head> link ─────────────────────────────
  const sd = settings.structuredData;
  const subPath = Boolean(base);
  const scopes = articleScopes(sd.articles, input.patterns ?? {});
  /** @type {Map<string, string>} */
  const head = new Map();
  let structured = 0;
  const logo = sd.organization && sd.organization.logo ? resolveLogo(sd.organization.logo, base, origin, input.fileExists, notes) : "";

  if (!origin && (sd.website || sd.organization || sd.articles || sd.breadcrumbs)) notes.push("Structured data needs full addresses: set `site` in astro.config (e.g. site: \"https://www.example.com\") to add it.");
  for (const page of counted) {
    const local = sitePath(page.path, base);
    const tags = [];
    const has = (/** @type {RegExp} */ type) => page.jsonldTypes.some((name) => type.test(name));

    if (hasTwin(page)) tags.push(`<link rel="alternate" type="text/markdown" href="${xml(twinPath(page.path, base))}">`);
    if (origin) {
      if (pathKey(local) === "/") {
        const website = sd.website && !has(/^WebSite$/) ? websiteLd({ name: siteName, url: rootUrl, subPath }) : null;
        const org = sd.organization && !has(/Organization$|^Corporation$|LocalBusiness|^Store$|^Restaurant$/)
          ? organizationLd({ name: sd.organization.name || siteName, url: rootUrl, logo, sameAs: sd.organization.sameAs, email: sd.organization.email, telephone: sd.organization.telephone })
          : null;

        if (website) tags.push(jsonLdTag(website));
        if (org) tags.push(jsonLdTag(org));
      }
      const scope = scopes(local, page);

      if (scope && !has(/^(Article|BlogPosting|NewsArticle|TechArticle|Report|ScholarlyArticle)$/)) {
        const article = articleLd(page, { type: scope, siteImage: home && home !== page ? home.image : "" });

        if (article) tags.push(jsonLdTag(article));
      }
      const segments = local.split("/").filter(Boolean);

      if (sd.breadcrumbs && segments.length >= 2 && !has(/^BreadcrumbList$/)) {
        // From the home page (named for the site) down to the page itself, through every level that is a page.
        const homePage = byKey.get(pathKey(`${base}/`));
        /** @type {{ name: string; url: string }[]} */
        const trail = homePage ? [{ name: oneLine(siteName), url: homePage.canonical ?? homePage.url }] : [];

        for (let depth = 1; depth < segments.length; depth += 1) {
          const parent = byKey.get(pathKey(`${base}/${segments.slice(0, depth).join("/")}/`));

          if (parent) trail.push({ name: oneLine(parent.name), url: parent.canonical ?? parent.url });
        }
        trail.push({ name: oneLine(page.name), url: page.canonical ?? page.url });
        const crumbs = breadcrumbLd(trail);

        if (crumbs) tags.push(jsonLdTag(crumbs));
      }
    }
    if (tags.length) {
      head.set(page.path, tags.join(""));
      if (tags.length > (hasTwin(page) ? 1 : 0)) structured += 1;
    }
  }

  // ── llms.txt and llms-full.txt ──────────────────────────────────────
  const entries = (agent.markdownTwins ? twinned.filter(hasTwin) : counted).filter((page) => !agent.exclude.some((glob) => matchGlob(sitePath(page.path, base), glob)));
  const linkFor = (/** @type {PageFacts} */ page) => (hasTwin(page) ? abs(twinPath(page.path, base)) : page.canonical ?? page.url);
  const sections = groupPages(entries, base, byKey, (page) => agent.optional.some((glob) => matchGlob(sitePath(page.path, base), glob)));
  let llmsLinks = 0;
  let fullBytes = 0;
  let fullTruncated = false;
  const writeLlms = agent.llmsTxt && !own.llmsTxt;
  const writeFull = agent.llmsFullTxt && !own.llmsFullTxt;
  const writeAgent = agent.agentPage && !own.agentPage && !files["agent.md"];

  if (own.llmsTxt && agent.llmsTxt) notes.push("llms.txt: the site publishes its own; left as it is.");
  if (writeLlms) {
    const lines = [`# ${oneLine(siteName)}`, ""];

    if (summary) lines.push(`> ${summary}`, "");
    const intro = [
      agent.markdownTwins ? `Each page below is linked to its markdown version: the page's own text, with no scripts or layout.` : "",
      writeFull ? `Everything in one file: ${abs(`${base}/llms-full.txt`)}.` : "",
      writeAgent ? `How to use and cite this site: ${abs(`${base}/agent.md`)}.` : "",
    ].filter(Boolean);

    if (intro.length) lines.push(intro.join(" "), "");
    let remaining = MAX_LLMS_LINKS;
    let left = 0;

    for (const section of sections) {
      const shown = section.pages.slice(0, Math.max(0, remaining));

      left += section.pages.length - shown.length;
      remaining -= shown.length;
      if (!shown.length) continue;
      lines.push(`## ${section.title}`, "");
      for (const page of shown) lines.push(`- [${linkText(page.name || page.path)}](${linkFor(page)})${page.description ? `: ${oneLine(page.description)}` : ""}`);
      lines.push("");
      llmsLinks += shown.length;
    }
    if (left > 0) lines.push(`${left} more pages are listed in the sitemap: ${abs(`${base}/sitemap.xml`)}.`, "");
    files["llms.txt"] = `${lines.join("\n").replace(/\n+$/, "")}\n`;
    types["llms.txt"] = "text/plain; charset=utf-8";
  }
  if (own.llmsFullTxt && agent.llmsFullTxt) notes.push("llms-full.txt: the site publishes its own; left as it is.");
  if (writeFull) {
    const encoder = new TextEncoder();
    const headText = `# ${oneLine(siteName)}\n\n${summary ? `> ${summary}\n\n` : ""}Every page of ${rootUrl}${agent.markdownTwins ? " as markdown" : ""}, one after another. The list of pages is ${abs(`${base}/llms.txt`)}.\n`;
    const parts = [headText];
    let size = encoder.encode(headText).length;
    const ordered = sections.flatMap((section) => section.pages);
    let index = 0;

    for (; index < ordered.length; index += 1) {
      const page = /** @type {PageFacts} */ (ordered[index]);
      const body = `\n---\n\nSource: ${page.canonical ?? page.url}\n\n${pageBody(page)}\n`;
      const bytes = encoder.encode(body).length;

      if (size + bytes > agent.fullMaxBytes - 400) break;
      parts.push(body);
      size += bytes;
    }
    if (index < ordered.length) {
      fullTruncated = true;
      const left = ordered.length - index;

      parts.push(`\n---\n\nThis file stops here: it reached its size limit of ${agent.fullMaxBytes.toLocaleString("en-US")} bytes. ${left} more ${left === 1 ? "page is" : "pages are"} listed in ${abs(`${base}/llms.txt`)}, each with its own markdown version.\n`);
    }
    files["llms-full.txt"] = parts.join("");
    types["llms-full.txt"] = "text/plain; charset=utf-8";
    fullBytes = encoder.encode(files["llms-full.txt"]).length;
  }

  // ── sitemap.xml ─────────────────────────────────────────────────────
  const sitemapPages = settings.sitemap.enabled ? counted.filter((page) => !settings.sitemap.exclude.some((glob) => matchGlob(sitePath(page.path, base), glob))) : [];
  const writeSitemap = settings.sitemap.enabled && !own.sitemap && Boolean(origin);

  if (settings.sitemap.enabled && own.sitemap) notes.push(`${own.sitemap}: the site writes its own sitemap; left as it is.`);
  if (settings.sitemap.enabled && !own.sitemap && !origin) notes.push("sitemap.xml needs full addresses: set `site` in astro.config to have one written.");
  if (writeSitemap) {
    const url = (/** @type {PageFacts} */ page) => {
      const lastmod = settings.sitemap.lastmod === "content" ? dateOnly(page.modified || page.published) : "";

      return `  <url><loc>${xml(page.canonical ?? page.url)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;
    };
    const urlset = (/** @type {PageFacts[]} */ list) => ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...list.map(url), "</urlset>", ""].join("\n");

    if (sitemapPages.length <= MAX_SITEMAP_URLS) files["sitemap.xml"] = urlset(sitemapPages);
    else {
      const names = [];

      for (let start = 0, part = 1; start < sitemapPages.length; start += MAX_SITEMAP_URLS, part += 1) {
        const name = `sitemap-${part}.xml`;

        files[name] = urlset(sitemapPages.slice(start, start + MAX_SITEMAP_URLS));
        types[name] = "application/xml; charset=utf-8";
        names.push(name);
      }
      files["sitemap.xml"] = ['<?xml version="1.0" encoding="UTF-8"?>', '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...names.map((name) => `  <sitemap><loc>${xml(abs(`${base}/${name}`))}</loc></sitemap>`), "</sitemapindex>", ""].join("\n");
    }
    types["sitemap.xml"] = "application/xml; charset=utf-8";
  }
  const sitemapUrl = own.sitemap ? abs(`${base}/${own.sitemap}`) : writeSitemap ? abs(`${base}/sitemap.xml`) : "";

  // ── robots.txt ──────────────────────────────────────────────────────
  if (settings.robots.enabled && own.robots) {
    notes.push(`robots.txt: the site writes its own (${own.robots}); left as it is.${Object.keys(settings.crawlers).length ? " The crawler choices in the visibility file are not applied: remove the site's own robots.txt to let the kit write them." : ""}`);
  }
  if (settings.robots.enabled && !own.robots) {
    files["robots.txt"] = robotsText({ settings, base, sitemap: origin ? sitemapUrl : "" });
    types["robots.txt"] = "text/plain; charset=utf-8";
    if (base) notes.push(`robots.txt is written for ${base}/, but crawlers only read the one at the root of the host; copy its rules there if this site is served under a sub-path.`);
  }

  // ── agent.md ────────────────────────────────────────────────────────
  if (agent.agentPage && (own.agentPage || files["agent.md"] !== undefined)) notes.push("agent.md: the site has a page of its own at that address; left as it is.");
  if (writeAgent) {
    files["agent.md"] = agentText({ siteName, summary, rootUrl, base, abs, home, settings, has: { llms: writeLlms || own.llmsTxt, full: writeFull || own.llmsFullTxt, twins: twinOf.size > 0, robots: Boolean(files["robots.txt"] || own.robots), sitemap: sitemapUrl }, contactPage: byKey.get(pathKey(`${base}/contact/`)), example: twinned.find((page) => hasTwin(page) && pathKey(sitePath(page.path, base)) !== "/" && page.path.endsWith("/")) });
    types["agent.md"] = "text/markdown; charset=utf-8";
  }

  return {
    head,
    files,
    types,
    notes,
    counts: { pages: input.pages.length, listed: counted.length, twins: twinOf.size, structured, sitemap: writeSitemap ? sitemapPages.length : 0, llmsLinks, fullBytes, fullTruncated },
  };
}

/** The twin's body without its front matter: the page's heading first. */
function pageBody(/** @type {PageFacts} */ page) {
  return page.hasH1 || !page.name ? page.markdown : `# ${page.name}\n\n${page.markdown}`;
}

/** A page's markdown twin: front matter, then its content. */
export function twinText(/** @type {PageFacts} */ page, /** @type {string} */ canonical) {
  const front = [`title: ${yaml(page.name || page.title)}`];

  if (page.description) front.push(`description: ${yaml(page.description)}`);
  front.push(`canonical: ${yaml(canonical)}`);
  if (page.lang) front.push(`language: ${yaml(page.lang)}`);
  if (page.published && Number.isFinite(Date.parse(page.published))) front.push(`published: ${yaml(page.published)}`);
  if (page.modified && Number.isFinite(Date.parse(page.modified))) front.push(`last_modified: ${yaml(page.modified)}`);
  return `---\n${front.join("\n")}\n---\n\n${pageBody(page)}\n`;
}

/**
 * Pages in llms.txt sections: "Pages" (the home page and pages one level
 * deep that have nothing under them), one section per first segment with
 * more than one page (its index page first, then newest first), and
 * "Optional" for what the settings mark secondary.
 *
 * @param {PageFacts[]} pages
 * @param {string} base
 * @param {Map<string, PageFacts>} byKey
 * @param {(page: PageFacts) => boolean} optional
 * @returns {{ title: string; pages: PageFacts[] }[]}
 */
function groupPages(pages, base, byKey, optional) {
  /** @type {Map<string, PageFacts[]>} */
  const groups = new Map();
  const secondary = [];

  for (const page of pages) {
    if (optional(page)) {
      secondary.push(page);
      continue;
    }
    const segment = sitePath(page.path, base).split("/").filter(Boolean)[0] ?? "";

    (groups.get(segment) ?? groups.set(segment, []).get(segment) ?? []).push(page);
  }
  const main = /** @type {PageFacts[]} */ ([]);
  /** @type {{ title: string; pages: PageFacts[] }[]} */
  const sections = [];
  const newest = (/** @type {PageFacts} */ a, /** @type {PageFacts} */ b) => {
    const da = Date.parse(a.published) || 0;
    const db = Date.parse(b.published) || 0;

    return db - da || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  };

  for (const [segment, list] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (segment === "" || list.length === 1) {
      main.push(...list);
      continue;
    }
    const indexKey = pathKey(`${base}/${segment}/`);
    const index = list.filter((page) => pathKey(page.path) === indexKey);
    const rest = list.filter((page) => pathKey(page.path) !== indexKey).sort(newest);

    sections.push({ title: oneLine(byKey.get(indexKey)?.name || humanize(segment)), pages: [...index, ...rest] });
  }
  main.sort((a, b) => (pathKey(sitePath(a.path, base)) === "/" ? -1 : pathKey(sitePath(b.path, base)) === "/" ? 1 : a.path < b.path ? -1 : 1));
  return [...(main.length ? [{ title: "Pages", pages: main }] : []), ...sections, ...(secondary.length ? [{ title: "Optional", pages: secondary }] : [])];
}

/**
 * Which pages are articles, and of what type: the named collections (by
 * their address pattern) or address globs; "auto" means pages that say they
 * are articles (og:type "article").
 *
 * @param {"auto" | false | string[]} articles
 * @param {Record<string, string>} patterns
 * @returns {(path: string, page: PageFacts) => "Article" | "BlogPosting" | null}
 */
function articleScopes(articles, patterns) {
  /** @type {(name: string) => "Article" | "BlogPosting"} */
  const typeFor = (name) => (/(^|\/)(blog|posts?|journal)(\/|$|\*)/i.test(name) ? "BlogPosting" : "Article");

  if (articles === false) return () => null;
  if (articles === "auto") return (path, page) => (page.type === "article" ? typeFor(path.split("/").filter(Boolean)[0] ?? "") : null);
  const globs = articles.map((item) => (item.startsWith("/") ? { glob: item, type: typeFor(item) } : { glob: patternGlob(patterns[item] ?? `/${item}/{slug}/`), type: typeFor(item) }));

  return (path) => globs.find((entry) => matchGlob(path, entry.glob))?.type ?? null;
}

/** The logo's full address, when its file is really there. */
function resolveLogo(/** @type {string} */ logo, /** @type {string} */ base, /** @type {string} */ origin, /** @type {((path: string) => boolean) | undefined} */ exists, /** @type {string[]} */ notes) {
  if (/^https?:\/\//i.test(logo)) return logo;
  if (!origin) return "";
  if (exists && !exists(logo)) {
    notes.push(`structuredData.organization.logo: ${logo} isn't among the site's files, so the logo was left out.`);
    return "";
  }
  return `${origin}${base}${logo}`;
}

/**
 * robots.txt from the settings: the site-wide rules for every crawler, then
 * one group per AI crawler the settings name. A crawler with a group of its
 * own ignores the `*` group (RFC 9309), so an allowed crawler's group
 * repeats the site-wide rules rather than lifting them.
 *
 * @param {{ settings: VisibilitySettings; base: string; sitemap: string }} input
 */
export function robotsText({ settings, base, sitemap }) {
  const rules = [...settings.robots.disallow.map((path) => `Disallow: ${base}${path}`), ...settings.robots.allow.map((path) => `Allow: ${base}${path}`)];
  const siteWide = rules.length ? rules : ["Allow: /"];
  const lines = ["User-agent: *", ...siteWide, ""];
  const known = AI_CRAWLERS.map((crawler) => crawler.token).filter((token) => Object.keys(settings.crawlers).some((key) => key.toLowerCase() === token.toLowerCase()));
  const others = Object.keys(settings.crawlers)
    .filter((key) => !aiCrawler(key))
    .sort((a, b) => a.localeCompare(b));
  const choiceOf = (/** @type {string} */ token) => settings.crawlers[Object.keys(settings.crawlers).find((key) => key.toLowerCase() === token.toLowerCase()) ?? token];

  for (const token of [...known, ...others]) {
    const crawler = aiCrawler(token);
    const choice = choiceOf(token);

    const note = crawler ? PURPOSE_NOTES[crawler.crawls ? crawler.purpose : "control"] : "";

    lines.push(`# ${crawler ? `${crawler.label} (${note})` : "Another crawler named in the visibility settings"}: ${choice === "block" ? "blocked" : "allowed"}`);
    lines.push(`User-agent: ${token}`, ...(choice === "block" ? ["Disallow: /"] : siteWide), "");
  }
  if (sitemap) lines.push(`Sitemap: ${sitemap}`, "");
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

/**
 * The agent entry page: what the site is, where everything is, how to cite
 * it and how to reach its owner. Plain markdown, no scripts.
 *
 * @param {object} input
 * @param {string} input.siteName
 * @param {string} input.summary
 * @param {string} input.rootUrl
 * @param {string} input.base
 * @param {(path: string) => string} input.abs
 * @param {PageFacts | undefined} input.home
 * @param {VisibilitySettings} input.settings
 * @param {{ llms: boolean; full: boolean; twins: boolean; robots: boolean; sitemap: string }} input.has
 * @param {PageFacts | undefined} input.contactPage
 * @param {PageFacts | undefined} input.example  A page to show the twin address with.
 */
function agentText({ siteName, summary, rootUrl, base, abs, home, settings, has, contactPage, example }) {
  const lines = [`# ${oneLine(siteName)}: a guide for AI agents`, ""];

  if (summary) lines.push(`> ${summary}`, "");
  lines.push(`This page is for AI agents and assistants reading ${rootUrl}. It says where the site's content is in plain text and how to cite it.`, "", "## Where things are", "");
  if (has.llms) lines.push(`- Every page, with a one-line description: ${abs(`${base}/llms.txt`)}`);
  if (has.full) lines.push(`- The whole site in one file: ${abs(`${base}/llms-full.txt`)}`);
  if (has.twins) {
    const shown = example ? `: ${abs(example.path)} has ${abs(twinPath(example.path, base))}, and the home page has ${abs(`${base}/index.md`)}` : `; the home page's is ${abs(`${base}/index.md`)}`;

    lines.push(`- The markdown version of a page is at its address with \`.md\` in place of the last slash${shown}. Each page also names its own in \`<link rel="alternate" type="text/markdown">\`.`);
  }
  if (has.sitemap) lines.push(`- Every address, for crawlers: ${has.sitemap}`);
  for (const feed of home?.feeds ?? []) lines.push(`- ${feed.title ? `${oneLine(feed.title)} (feed)` : "Feed"}: ${feed.href}`);
  if (has.robots) lines.push(`- What crawlers may visit: ${abs(`${base}/robots.txt`)}`);
  lines.push(
    "",
    "## How to cite this site",
    "",
    `Name the page and ${oneLine(siteName)}, and link to the page's own address (the \`canonical\` line at the top of each markdown version), not to the markdown copy. Quote the words as they are; dates and figures are as stated on the page.`,
    "",
  );
  const contact = settings.agentReadable.contact || home?.emails[0] || "";
  const contactLines = [];

  if (contact) contactLines.push(/^https?:\/\//i.test(contact) ? `- ${contact}` : contact.includes("@") ? `- Email: ${contact}` : `- ${contact}`);
  if (contactPage && contactPage.url !== contact) contactLines.push(`- Contact page: ${contactPage.canonical ?? contactPage.url}`);
  if (contactLines.length) lines.push("## Contact", "", ...contactLines, "");
  lines.push("## About this file", "", "It is written from the site's published pages each time the site is built. It holds no scripts and changes only when the site does.", "");
  return lines.join("\n").replace(/\n+$/, "\n");
}
