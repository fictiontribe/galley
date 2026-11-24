// Vendored from @galley/astro 0.2.0 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// The agent-readable output as an Astro integration part: after `astro
// build` it reads every page the build wrote and adds the markdown twins,
// llms.txt, llms-full.txt, agent.md, robots.txt, sitemap.xml and the tags
// each page's <head> gains; in `astro dev` the same addresses answer, made
// on request from the pages the dev server renders, so a preview shows what
// a build will publish. No page gains any JavaScript.
//
// Used by the package's integration (galley({ visibility })) and, vendored,
// as src/galley/integration.js (scripts/vendor.mjs).

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_FILE, readSettings } from "./config.js";
import { readSiteContent } from "./content.js";
import { addToHead, readPage } from "./page.js";
import { pagesForTwin, planSite, sitePath, twinPath } from "./site.js";

/** @typedef {import("./page.js").PageFacts} PageFacts */
/** @typedef {import("./site.js").SiteInput} SiteInput */

/** The header the dev server's own requests carry, so they get the page as rendered. */
export const RAW_HEADER = "x-galley-visibility";
/** Pages a dev server answer crawls at most (llms.txt, the sitemap). */
export const DEV_CRAWL_LIMIT = 500;
/** Placeholder host for a site with no `site` address; removed from what is written. */
const NO_ORIGIN = "https://site.invalid";

/**
 * @typedef {object} VisibilityOptions
 * @property {string} [file]  The data file. Default "src/data/visibility.json".
 */

/** @param {string} dir @returns {string[]} HTML files under dir, relative, "/"-separated, sorted. */
function htmlFiles(dir) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} at */
  const walk = (at) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      const info = statSync(path);

      if (info.isDirectory()) walk(path);
      else if (name.endsWith(".html")) out.push(relative(dir, path).split(sep).join("/"));
    }
  };

  walk(dir);
  return out.sort();
}

/** "about/index.html" → "/demo/about/"; "about.html" → "/demo/about"; "index.html" → "/demo/". */
export function pagePath(/** @type {string} */ file, /** @type {string} */ base) {
  if (file === "index.html") return `${base}/`;
  if (file.endsWith("/index.html")) return `${base}/${file.slice(0, -"index.html".length)}`;
  return `${base}/${file.replace(/\.html$/, "")}`;
}

/** The site's origin and base path from Astro's config. */
export function siteAddress(/** @type {{ site?: string | URL | undefined; base?: string }} */ config) {
  let origin = "";

  try {
    origin = config.site ? new URL(String(config.site)).origin : "";
  } catch {
    origin = "";
  }
  return { origin, base: (config.base ?? "/").replace(/\/+$/, "") };
}

/** Facts read with a placeholder origin, with the placeholder taken out again. */
function withoutPlaceholder(/** @type {PageFacts} */ facts) {
  const strip = (/** @type {string} */ value) => value.split(NO_ORIGIN).join("");

  return {
    ...facts,
    url: strip(facts.url),
    canonical: facts.canonical ? strip(facts.canonical) : null,
    image: strip(facts.image),
    markdown: strip(facts.markdown),
    feeds: facts.feeds.map((feed) => ({ ...feed, href: strip(feed.href) })),
  };
}

/** @param {string} html @param {string} path @param {string} origin */
function factsOf(html, path, origin) {
  const facts = readPage(html, { path, url: `${origin || NO_ORIGIN}${path}` });

  return origin ? facts : withoutPlaceholder(facts);
}

/**
 * Writes the agent-readable output into a finished build.
 *
 * @param {object} input
 * @param {string} input.dir  The build's output folder.
 * @param {string} input.root  The site's folder.
 * @param {string} input.file  The data file, relative to the site.
 * @param {string} input.origin
 * @param {string} input.base
 * @param {boolean} [input.siteSitemap]  An integration (such as @astrojs/sitemap) writes the sitemap.
 * @returns {{ notes: string[]; summary: string; written: string[]; changedPages: number; ms: number }}
 */
export function writeVisibility({ dir, root, file, origin, base, siteSitemap = false }) {
  const started = performance.now();
  const { settings } = readSettings(root, file);
  const content = readSiteContent(root);
  const files = htmlFiles(dir);
  const pages = files.map((name) => factsOf(readFileSync(join(dir, name), "utf8"), pagePath(name, base), origin));
  const has = (/** @type {string} */ name) => existsSync(join(dir, name));
  const plan = planSite({
    pages,
    settings,
    origin,
    base,
    own: {
      robots: has("robots.txt") ? "robots.txt" : null,
      sitemap: has("sitemap-index.xml") || siteSitemap ? "sitemap-index.xml" : has("sitemap.xml") ? "sitemap.xml" : null,
      llmsTxt: has("llms.txt"),
      llmsFullTxt: has("llms-full.txt"),
      agentPage: has("agent.md"),
    },
    drafts: content.drafts,
    dates: content.dates,
    patterns: content.patterns,
    fallbackName: content.name,
    fileExists: (path) => has(path.replace(/^\/+/, "")) || existsSync(join(root, "public", path.replace(/^\/+/, ""))),
  });
  const notes = [...plan.notes];
  /** @type {string[]} */
  const written = [];
  let changedPages = 0;

  for (const name of files) {
    const addition = plan.head.get(pagePath(name, base));

    if (!addition) continue;
    const path = join(dir, name);
    const html = readFileSync(path, "utf8");
    // A page that already links its markdown version keeps its own link.
    const kept = /type=["']?text\/markdown/i.test(html) ? addition.replace(/<link rel="alternate" type="text\/markdown"[^>]*>/, "") : addition;
    const next = addToHead(html, kept);

    if (next !== html) {
      writeFileSync(path, next);
      changedPages += 1;
    }
  }
  for (const [name, text] of Object.entries(plan.files)) {
    const path = join(dir, ...name.split("/"));

    if (existsSync(path)) {
      if (name.endsWith(".md")) notes.push(`${base}/${name} is already one of the site's files; the kit's markdown version of that page was not written.`);
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    written.push(name);
  }
  const c = plan.counts;
  const extras = ["llms.txt", "llms-full.txt", "agent.md", "robots.txt", "sitemap.xml"].filter((name) => written.includes(name));
  const summary =
    `visibility: ${c.listed} of ${c.pages} pages listed · ${c.twins} markdown versions · structured data on ${c.structured} pages` +
    (extras.length ? ` · ${extras.join(", ")}` : "") +
    (c.fullTruncated ? " (llms-full.txt cut at its size limit)" : "") +
    ` · ${Math.round(performance.now() - started)} ms`;

  return { notes, summary, written, changedPages, ms: performance.now() - started };
}

// ─────────────────────────────────────────────────────────────── astro dev

/**
 * @typedef {object} Fetched
 * @property {number} status
 * @property {string} type
 * @property {string} body
 */

/** Addresses the kit answers in dev (without the base). */
export function isVisibilityAddress(/** @type {string} */ local) {
  return /^\/(llms\.txt|llms-full\.txt|agent\.md|robots\.txt|sitemap\.xml|sitemap-\d+\.xml)$/.test(local) || (/\.md$/.test(local) && !local.startsWith("/_") && !local.startsWith("/@"));
}

/**
 * A written chunk as bytes. Astro's dev server writes pages as `Uint8Array`s
 * (not Buffers): turning one into a string gives "60,33,68,…", which is what
 * every page became. Strings honour the encoding passed alongside them.
 * @param {unknown} chunk
 * @param {unknown} [encoding]
 * @returns {Buffer}
 */
export function toBuffer(chunk, encoding) {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  if (ArrayBuffer.isView(chunk)) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  if (chunk instanceof ArrayBuffer) return Buffer.from(chunk);
  return Buffer.from(String(chunk), typeof encoding === "string" && Buffer.isEncoding(encoding) ? encoding : "utf8");
}

/**
 * Buffers a dev server's HTML answer so it can be changed before it is sent.
 * Anything else passes through untouched.
 *
 * @param {import("node:http").ServerResponse} res
 * @param {(html: string) => Promise<string>} transform
 */
export function interceptHtml(res, transform) {
  const original = { writeHead: res.writeHead.bind(res), write: res.write.bind(res), end: res.end.bind(res) };
  /** @type {Buffer[]} */
  const chunks = [];
  /** @type {boolean | null} */
  let buffering = null;
  const restore = () => {
    res.writeHead = original.writeHead;
    res.write = original.write;
    res.end = original.end;
  };
  const decide = () => {
    if (buffering !== null) return buffering;
    const type = String(res.getHeader("content-type") ?? "");

    buffering = res.statusCode === 200 && /text\/html/i.test(type) && !res.getHeader("content-encoding");
    if (!buffering) restore();
    return buffering;
  };
  const anyRes = /** @type {any} */ (res);

  anyRes.writeHead = (/** @type {number} */ status, /** @type {any[]} */ ...rest) => {
    const headers = rest.find((item) => item && typeof item === "object");

    if (typeof rest[0] === "string") res.statusMessage = rest[0];
    res.statusCode = status;
    if (Array.isArray(headers)) for (let index = 0; index + 1 < headers.length; index += 2) res.setHeader(String(headers[index]), headers[index + 1]);
    else if (headers) for (const [name, value] of Object.entries(headers)) if (value !== undefined) res.setHeader(name, /** @type {any} */ (value));
    if (!decide()) return original.writeHead(res.statusCode);
    return res;
  };
  anyRes.write = (/** @type {any} */ chunk, /** @type {any[]} */ ...rest) => {
    if (!decide()) return original.write(chunk, ...rest);
    if (chunk !== undefined && chunk !== null && typeof chunk !== "function") chunks.push(toBuffer(chunk, rest[0]));
    return true;
  };
  anyRes.end = (/** @type {any} */ chunk, /** @type {any[]} */ ...rest) => {
    if (!decide()) return original.end(chunk, ...rest);
    if (chunk !== undefined && chunk !== null && typeof chunk !== "function") chunks.push(toBuffer(chunk, rest[0]));
    const html = Buffer.concat(chunks).toString("utf8");

    restore();
    transform(html)
      .catch(() => html)
      .then((out) => {
        if (!res.headersSent) {
          res.setHeader("content-length", Buffer.byteLength(out));
          original.writeHead(res.statusCode);
        }
        original.end(out);
      });
    return res;
  };
}

/** @typedef {{ pattern: string; regex: RegExp | null; dynamic: boolean }} RouteInfo */

/**
 * Whether the site itself may serve `local` (an address without the base):
 * a file in public/, a route for exactly that address, or a dynamic route
 * ending in the same extension ("/[twin].md"). Only then is the dev server
 * asked — so a catch-all page route ("/[...slug]") isn't asked for every
 * generated address, and doesn't log a note for each.
 *
 * @param {string} root
 * @param {RouteInfo[]} routes
 * @param {string} local
 * @returns {"file" | "route" | "maybe" | null}
 */
export function siteServes(root, routes, local) {
  if (existsSync(join(root, "public", ...local.split("/").filter(Boolean)))) return "file";
  if (routes.some((route) => !route.dynamic && route.pattern === local)) return "route";
  const extension = /\.[a-z0-9]+$/i.exec(local)?.[0];

  if (extension && routes.some((route) => route.dynamic && route.pattern.endsWith(extension) && (!route.regex || route.regex.test(local)))) return "maybe";
  return null;
}

/**
 * The dev server's answers: the generated addresses, and the extra <head>
 * tags on every page. Reads the data file on every request, so edits show
 * at once.
 *
 * @param {object} input
 * @param {string} input.root
 * @param {string} input.file
 * @param {string} input.origin  The site's own origin ("" when unknown).
 * @param {string} input.base
 * @param {() => string} input.self  The dev server's own origin, for its requests to itself.
 * @param {() => RouteInfo[]} [input.routes]  The site's routes (astro:routes:resolved), to know which addresses it serves itself.
 * @returns {(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, next: () => void) => void}
 */
export function createDevMiddleware({ root, file, origin, base, self, routes = () => [] }) {
  /** @type {Map<string, { at: number; value: Promise<Fetched | null> }>} */
  const cache = new Map();
  /** @param {string} path @returns {Promise<Fetched | null>} */
  const get = (path) => {
    const hit = cache.get(path);

    if (hit && Date.now() - hit.at < 2000) return hit.value;
    const value = fetch(`${self()}${path}`, { headers: { [RAW_HEADER]: "raw", accept: "text/html,*/*" }, redirect: "follow" })
      .then(async (response) => ({ status: response.status, type: response.headers.get("content-type") ?? "", body: await response.text() }))
      .catch(() => null);

    cache.set(path, { at: Date.now(), value });
    return value;
  };
  /** @param {string} path @param {string} siteOrigin */
  const facts = async (path, siteOrigin) => {
    const got = await get(path);

    return got && got.status === 200 && /html/.test(got.type) ? factsOf(got.body, path, siteOrigin) : null;
  };
  /** Pages reachable from the home page by links, at most DEV_CRAWL_LIMIT. */
  const crawl = async (/** @type {string} */ siteOrigin) => {
    const seen = new Set([`${base}/`]);
    const queue = [`${base}/`];
    /** @type {PageFacts[]} */
    const pages = [];

    while (queue.length && pages.length < DEV_CRAWL_LIMIT) {
      const batch = queue.splice(0, 6);
      const results = await Promise.all(batch.map(async (path) => ({ path, got: await get(path) })));

      for (const { path, got } of results) {
        if (!got || got.status !== 200 || !/html/.test(got.type)) continue;
        pages.push(factsOf(got.body, path, siteOrigin));
        for (const match of got.body.matchAll(/<a\b[^>]*?\shref\s*=\s*["']([^"'#?]+)/gi)) {
          let target;

          try {
            const url = new URL(match[1] ?? "", `http://dev.invalid${path}`);

            if (url.origin !== "http://dev.invalid" && (!siteOrigin || url.origin !== siteOrigin)) continue;
            target = url.pathname;
          } catch {
            continue;
          }
          if (!(target === `${base}/` || target.startsWith(`${base}/`)) || /\.(?!html?$)[a-z0-9]+$/i.test(target) || /\/(_astro|@|__)/.test(target)) continue;
          if (seen.has(target)) continue;
          seen.add(target);
          queue.push(target);
        }
      }
    }
    return pages.sort((a, b) => (a.path < b.path ? -1 : 1));
  };
  /** What the site serves itself, at the addresses the kit would write. */
  /** Whether the site serves this address itself (asking the dev server only when a route might). */
  const served = async (/** @type {string} */ local) => {
    const kind = siteServes(root, routes(), local);

    if (kind === "file" || kind === "route") return true;
    if (kind === null) return false;
    const got = await get(`${base}${local}`);

    return Boolean(got && got.status === 200 && !/html/.test(got.type));
  };
  const own = async () => {
    const [robots, index, sitemap, llms, full, agent] = await Promise.all(["robots.txt", "sitemap-index.xml", "sitemap.xml", "llms.txt", "llms-full.txt", "agent.md"].map((name) => served(`/${name}`)));

    return { robots: robots ? "robots.txt" : null, sitemap: index ? "sitemap-index.xml" : sitemap ? "sitemap.xml" : null, llmsTxt: Boolean(llms), llmsFullTxt: Boolean(full), agentPage: Boolean(agent) };
  };
  /** @param {PageFacts[]} pages @param {string} siteOrigin @param {Awaited<ReturnType<typeof own>>} owned */
  const plan = (pages, siteOrigin, owned) => {
    const { settings } = readSettings(root, file);
    const content = readSiteContent(root);

    return planSite({
      pages,
      settings,
      origin: siteOrigin,
      base,
      own: owned,
      drafts: content.drafts,
      dates: content.dates,
      patterns: content.patterns,
      fallbackName: content.name,
      fileExists: (path) => existsSync(join(root, "public", path.replace(/^\/+/, ""))),
    });
  };
  const none = { robots: null, sitemap: null, llmsTxt: false, llmsFullTxt: false, agentPage: false };
  /**
   * The page, its ancestors and the home page: all a page's own output
   * needs. `html`: the page as it is being sent, so it isn't rendered twice.
   *
   * @param {string} path
   * @param {string} siteOrigin
   * @param {string} [html]
   */
  const around = async (path, siteOrigin, html) => {
    const segments = sitePath(path, base).split("/").filter(Boolean);
    const wanted = [`${base}/`, ...segments.slice(0, -1).map((_, index) => `${base}/${segments.slice(0, index + 1).join("/")}/`), path].filter((item) => html === undefined || item !== path);
    const found = await Promise.all([...new Set(wanted)].map((item) => facts(item, siteOrigin)));
    const pages = found.filter((item) => item !== null);

    return html === undefined ? pages : [...pages, factsOf(html, path, siteOrigin)];
  };

  return (req, res, next) => {
    if (req.headers[RAW_HEADER] || (req.method !== "GET" && req.method !== "HEAD")) return next();
    // The address as asked: under a base path Vite has already taken the base
    // off req.url by the time this runs; connect keeps the original.
    const [path = "/"] = (/** @type {{ originalUrl?: string }} */ (req).originalUrl ?? req.url ?? "/").split("?");

    if (path !== base && !path.startsWith(`${base}/`)) return next();
    const local = sitePath(path, base);
    const siteOrigin = origin || `http://${req.headers.host ?? "localhost"}`;
    /** @param {number} status @param {string} type @param {string} body */
    const send = (status, type, body) => {
      res.statusCode = status;
      res.setHeader("content-type", type);
      res.setHeader("cache-control", "no-store");
      res.end(req.method === "HEAD" ? "" : body);
    };

    if (isVisibilityAddress(local)) {
      void (async () => {
        // The site's own file or route at this address wins, as in a build.
        if (await served(local)) return next();
        const fileName = local.replace(/^\//, "");

        if (local.endsWith(".md") && local !== "/agent.md") {
          for (const candidate of pagesForTwin(path, base)) {
            const pages = await around(candidate, siteOrigin);
            const page = pages.find((item) => item.path === candidate);

            if (!page) continue;
            const result = plan(pages, siteOrigin, none);
            const text = result.files[fileName];

            if (text !== undefined && twinPath(page.path, base) === path) return send(200, "text/markdown; charset=utf-8", text);
          }
          return next();
        }
        const owned = await own();
        const pages = local === "/robots.txt" ? [] : await crawl(siteOrigin);
        const result = plan(pages, siteOrigin, owned);
        const text = result.files[fileName];

        if (text === undefined) return next();
        return send(200, result.types[fileName] ?? "text/plain; charset=utf-8", text);
      })().catch(() => next());
      return;
    }
    const accept = String(req.headers.accept ?? "");

    if (/\.[a-z0-9]+$/i.test(local) && !/\.html?$/i.test(local)) return next();
    if (accept && !/text\/html|\*\/\*/.test(accept)) return next();
    interceptHtml(res, async (html) => {
      const pages = await around(path, siteOrigin, html);
      const addition = plan(pages, siteOrigin, none).head.get(path);

      if (!addition) return html;
      const kept = /type=["']?text\/markdown/i.test(html) ? addition.replace(/<link rel="alternate" type="text\/markdown"[^>]*>/, "") : addition;

      return addToHead(html, kept);
    });
    next();
  };
}

/**
 * The integration's hooks for this part.
 *
 * @param {VisibilityOptions | false | undefined} options
 * @returns {Partial<import("astro").AstroIntegration["hooks"]>}
 */
export function visibilityHooks(options) {
  if (options === false) return {};
  const file = (options && options.file) || DEFAULT_FILE;
  let root = "";
  let origin = "";
  let base = "";
  let siteSitemap = false;
  /** @type {RouteInfo[]} */
  let routes = [];

  return {
    "astro:config:setup": ({ config, addWatchFile }) => {
      if (!config) return;
      const siteRoot = fileURLToPath(config.root).replace(/[\\/]+$/, "");

      // Read once here so a broken file stops the build with its message.
      readSettings(siteRoot, file);
      addWatchFile(join(siteRoot, file));
    },
    "astro:config:done": ({ config }) => {
      root = fileURLToPath(config.root).replace(/[\\/]+$/, "");
      ({ origin, base } = siteAddress(config));
      siteSitemap = (config.integrations ?? []).some((integration) => integration.name === "@astrojs/sitemap");
    },
    // In dev this runs again whenever a page file is added or removed.
    "astro:routes:resolved": ({ routes: resolved }) => {
      routes = resolved
        .filter((route) => route.origin !== "internal")
        .map((route) => ({ pattern: route.pattern, regex: route.patternRegex instanceof RegExp ? route.patternRegex : null, dynamic: route.params.length > 0 }));
    },
    "astro:server:setup": ({ server }) => {
      const self = () => {
        const address = server.httpServer?.address();

        if (!address || typeof address === "string") return "http://127.0.0.1:4321";
        const host = address.address === "::" || address.address === "0.0.0.0" ? "127.0.0.1" : address.family === "IPv6" || address.address.includes(":") ? `[${address.address}]` : address.address;

        return `http://${host}:${address.port}`;
      };

      server.middlewares.use(createDevMiddleware({ root, file, origin, base, self, routes: () => routes }));
    },
    "astro:build:done": ({ dir, logger }) => {
      const result = writeVisibility({ dir: fileURLToPath(dir), root, file, origin, base, siteSitemap });

      logger.info(result.summary);
      for (const note of result.notes) logger.info(`  ${note}`);
    },
  };
}
