// The agent-readable output (docs/ai-first-output.md): the HTML reader, the
// markdown twin of a page, llms.txt, llms-full.txt, agent.md, robots.txt with
// a crawler policy, the sitemap and the JSON-LD — against golden files, so a
// change in any byte is a deliberate one — plus the build step on a real
// output folder and the dev server's answers.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { AI_CRAWLERS, describePolicy } from "../src/visibility/crawlers.js";
import { defaultSettings, normalizeSettings, readSettings } from "../src/visibility/config.js";
import { isDraft, readSiteContent } from "../src/visibility/content.js";
import { decodeEntities, parseHtml, textOf } from "../src/visibility/html.js";
import { createDevMiddleware, pagePath, RAW_HEADER, siteServes, writeVisibility } from "../src/visibility/integration.js";
import { readPage } from "../src/visibility/page.js";
import { pagesForTwin, planSite, robotsAllows, twinPath, type SiteInput } from "../src/visibility/site.js";
import { missingRequired } from "../src/visibility/structured.js";
import { aiCrawlers } from "../src/catalog.js";
import { PAGES } from "./fixtures/visibility/site";

const GOLDEN = fileURLToPath(new URL("./fixtures/visibility/golden/", import.meta.url));
const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** Compares with a golden file; `UPDATE_GOLDEN=1` rewrites them. */
function golden(name: string, text: string) {
  const path = join(GOLDEN, name);

  if (process.env.UPDATE_GOLDEN === "1" || !existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  expect(text, name).toBe(readFileSync(path, "utf8"));
}

const ORIGIN = "https://www.example.com";

/** The fixture pages as a build under `base` would write them (canonicals and links carry the base). */
function facts(base = "") {
  return Object.entries(PAGES).map(([file, html]) =>
    readPage(base ? html.replaceAll(`${ORIGIN}/`, `${ORIGIN}${base}/`).replace(/href="\/(?!\/)/g, `href="${base}/`) : html, { path: pagePath(file, base), url: `${ORIGIN}${pagePath(file, base)}` }),
  );
}

const SETTINGS = normalizeSettings({
  crawlers: { GPTBot: "block", CCBot: "block", "Google-Extended": "block", "OAI-SearchBot": "allow", Bytespider: "block" },
  robots: { disallow: ["/drafts/"] },
  sitemap: { exclude: ["/thanks/"], lastmod: "content" },
  structuredData: { website: true, organization: { logo: "/images/logo.png", sameAs: ["https://www.linkedin.com/company/ferrow"] }, articles: ["blog"], breadcrumbs: true },
  agentReadable: { optional: ["/privacy/"] },
});

function plan(overrides: Partial<SiteInput> = {}) {
  return planSite({
    pages: facts(overrides.base ?? ""),
    settings: SETTINGS,
    origin: ORIGIN,
    base: "",
    own: { robots: null, sitemap: null, llmsTxt: false, llmsFullTxt: false, agentPage: false },
    patterns: { blog: "/blog/{slug}/" },
    fileExists: (path) => path === "/images/logo.png",
    ...overrides,
  });
}

describe("the HTML reader", () => {
  it("builds a tree from built pages: void and raw-text elements, comments, entities, implied end tags", () => {
    const doc = parseHtml('<!doctype html><p>One<p>Two &amp; <b>three</b><!-- note --><br><img src="a.png" alt="A &quot;b&quot;"><ul><li>x<li>y</ul><script>if (a < b) {}</script>');
    const body = doc.children;

    expect(body.filter((node) => node.type === "element").map((node) => (node as any).name)).toEqual(["p", "p", "ul", "script"]);
    expect(textOf(body[1]!)).toBe("Two & three");
    expect((body[1] as any).children.map((node: any) => node.name ?? "text")).toEqual(["text", "b", "br", "img"]);
    expect((body[1] as any).children[3].attrs).toEqual({ src: "a.png", alt: 'A "b"' });
    expect(textOf(body[3]!)).toBe("");
    expect(decodeEntities("&#x2014; &mdash; &#8212; &unknown;")).toBe("— — — &unknown;");
  });
});

describe("a page's markdown twin", () => {
  it("is the main content only, with absolute links and images, and front matter (golden)", () => {
    const result = plan();

    golden("index.md", result.files["index.md"]!);
    golden("about.md", result.files["about.md"]!);
    golden("blog/certificate-register.md", result.files["blog/certificate-register.md"]!);
    golden("blog.md", result.files["blog.md"]!);
  });

  it("leaves out navigation, scripts, styles, forms, the consent banner and anything marked skip, hidden or aria-hidden", () => {
    const all = Object.entries(plan().files)
      .filter(([name]) => name.endsWith(".md") && name !== "agent.md")
      .map(([, text]) => text)
      .join("\n");

    for (const word of ["Skip to content", "Ferrow home", "Cookies and tracking", "Accept all", "Internal note", "Send", "body{", "function", "Older", "Tell us about"]) expect(all, word).not.toContain(word);
    expect(all).toContain("Registered office: 1 Example Street.");
  });

  it("is the same bytes every time, and the same in and out of Galley's preview", () => {
    const first = plan();
    const second = plan();

    expect(JSON.stringify(second.files)).toBe(JSON.stringify(first.files));
    // The preview proxy marks <html> and adds its overlay script; neither changes the twin.
    const marked = Object.fromEntries(
      Object.entries(PAGES).map(([file, html]) => [file, html.replace("<html lang=\"en\">", '<html lang="en" data-galley-preview data-galley-endpoint="http://127.0.0.1:4400/f/site_1">').replace("</head>", '<script src="/__galley/overlay.js"></script></head>')]),
    );
    const previewed = planSite({
      pages: Object.entries(marked).map(([file, html]) => readPage(html, { path: pagePath(file, ""), url: `${ORIGIN}${pagePath(file, "")}` })),
      settings: SETTINGS,
      origin: ORIGIN,
      base: "",
      own: { robots: null, sitemap: null, llmsTxt: false, llmsFullTxt: false, agentPage: false },
      patterns: { blog: "/blog/{slug}/" },
      fileExists: (path) => path === "/images/logo.png",
    });

    expect(previewed.files).toEqual(first.files);
  });

  it("lives at the page's address with .md: /about/ → /about.md, / → /index.md, also under a base path", () => {
    expect(twinPath("/about/")).toBe("/about.md");
    expect(twinPath("/")).toBe("/index.md");
    expect(twinPath("/demo/", "/demo")).toBe("/demo/index.md");
    expect(twinPath("/demo/", "")).toBe("/demo.md");
    expect(twinPath("/demo/blog/post/", "/demo")).toBe("/demo/blog/post.md");
    expect(twinPath("/about.html")).toBe("/about.md");
    expect(twinPath("/about")).toBe("/about.md");
    expect(pagesForTwin("/demo/index.md", "/demo")).toEqual(["/demo/"]);
    expect(pagesForTwin("/demo/about.md", "/demo")).toEqual(["/demo/about/", "/demo/about", "/demo/about.html"]);
  });

  it("is made for listed pages only: not for noindex, redirect, 404, draft, canonical-elsewhere or robots-disallowed pages", () => {
    const names = Object.keys(plan({ drafts: ["/thanks/"] }).files).filter((name) => name.endsWith(".md") && name !== "agent.md").sort();

    expect(names).toEqual(["about.md", "blog.md", "blog/certificate-register.md", "blog/tags/guides.md", "contact.md", "index.md", "privacy.md"]);
  });

  it("each listed page links its twin from <head>, with nothing else that runs", () => {
    const head = plan().head;

    expect(head.get("/about/")).toBe('<link rel="alternate" type="text/markdown" href="/about.md">');
    expect(head.get("/secret/")).toBeUndefined();
    for (const html of head.values()) expect(html).not.toMatch(/<script(?![^>]*application\/ld\+json)/);
  });
});

describe("llms.txt, llms-full.txt and agent.md", () => {
  it("llms.txt follows llmstxt.org: H1 name, blockquote summary, H2 file lists of [name](url): notes, an Optional section (golden)", () => {
    const text = plan().files["llms.txt"]!;

    golden("llms.txt", text);
    expect(text.split("\n")[0]).toBe("# Ferrow");
    expect(text).toMatch(/^> /m);
    expect(text).toContain("## Optional\n\n- [Privacy policy](https://www.example.com/privacy.md): What personal information Ferrow collects.");
  });

  it("llms-full.txt holds every twin, and says where it stops when it reaches its size limit", () => {
    const full = plan().files["llms-full.txt"]!;

    golden("llms-full.txt", full);
    const settings = { ...SETTINGS, agentReadable: { ...SETTINGS.agentReadable, fullMaxBytes: 10_000 } };
    const many = Array.from({ length: 40 }, (_, index) => readPage(PAGES["about/index.html"]!.replaceAll("/about/", `/p${index}/`), { path: `/p${index}/`, url: `${ORIGIN}/p${index}/` }));
    const cut = planSite({ pages: many, settings, origin: ORIGIN, base: "", own: { robots: null, sitemap: null, llmsTxt: false, llmsFullTxt: false, agentPage: false } });

    expect(Buffer.byteLength(cut.files["llms-full.txt"]!)).toBeLessThanOrEqual(10_000);
    expect(cut.files["llms-full.txt"]).toMatch(/This file stops here: it reached its size limit of 10,000 bytes\. \d+ more pages are listed in https:\/\/www\.example\.com\/llms\.txt/);
    expect(cut.counts.fullTruncated).toBe(true);
  });

  it("agent.md says what the site is, where everything is, how to cite it and how to reach the owner (golden)", () => {
    golden("agent.md", plan().files["agent.md"]!);
  });
});

describe("structured data", () => {
  it("WebSite and Organization on the home page, BlogPosting on posts, BreadcrumbList on nested pages — all parsing, none incomplete (golden)", () => {
    const head = plan().head;
    const blocks = (path: string) => [...(head.get(path) ?? "").matchAll(/<script type="application\/ld\+json" data-galley-jsonld>(.*?)<\/script>/g)].map((match) => JSON.parse(match[1]!));
    const all = { "/": blocks("/"), "/blog/certificate-register/": blocks("/blog/certificate-register/"), "/blog/tags/guides/": blocks("/blog/tags/guides/"), "/about/": blocks("/about/") };

    golden("jsonld.json", `${JSON.stringify(all, null, 2)}\n`);
    expect(all["/"].map((node) => node["@type"])).toEqual(["WebSite", "Organization"]);
    expect(all["/blog/certificate-register/"].map((node) => node["@type"])).toEqual(["BlogPosting", "BreadcrumbList"]);
    expect(all["/about/"]).toEqual([]);
    for (const node of Object.values(all).flat()) expect(missingRequired(node), node["@type"]).toEqual([]);
    // The post's og:image is the site's share picture: not an image of the article.
    expect(all["/blog/certificate-register/"][0].image).toBeUndefined();
  });

  it("writes nothing it can't complete: no site address, a sub-path (WebSite), a post without a date, a missing logo", () => {
    expect([...plan({ origin: "" }).head.values()].join("")).not.toContain("ld+json");
    const sub = planSite({ ...inputFor("/demo"), settings: SETTINGS });

    expect(sub.head.get("/demo/") ?? "").not.toContain('"WebSite"');
    expect(sub.head.get("/demo/") ?? "").toContain('"Organization"');
    const noLogo = plan({ fileExists: () => false });

    expect(noLogo.head.get("/")).not.toContain("logo");
    expect(noLogo.notes.join("\n")).toContain("isn't among the site's files");
    const undated = readPage(PAGES["blog/certificate-register/index.html"]!.replace(/<meta property="article:published_time"[^>]*>/, ""), { path: "/blog/certificate-register/", url: `${ORIGIN}/blog/certificate-register/` });

    expect(planSite({ ...inputFor(""), pages: [undated] }).head.get("/blog/certificate-register/") ?? "").not.toContain("BlogPosting");
  });

  it("a page that states no date takes its content entry's date (articles, sitemap lastmod), never one it hasn't got", () => {
    const settings = normalizeSettings({ structuredData: { articles: ["blog"] } });
    const undated = readPage(PAGES["blog/certificate-register/index.html"]!.replace(/<meta property="article:(published|modified)_time"[^>]*>/g, ""), { path: "/blog/certificate-register/", url: `${ORIGIN}/blog/certificate-register/` });
    const withDate = planSite({ ...inputFor(""), settings, pages: [undated], dates: { "/blog/certificate-register/": "2026-08-20" } });

    expect(withDate.head.get("/blog/certificate-register/")).toContain('"datePublished":"2026-08-20"');
    expect(withDate.files["sitemap.xml"]).toContain("<lastmod>2026-08-20</lastmod>");
    expect(withDate.files["blog/certificate-register.md"]).toContain('published: "2026-08-20"');
    const without = planSite({ ...inputFor(""), settings, pages: [undated] });

    expect(without.files["sitemap.xml"]).not.toContain("<lastmod>");
  });

  it("a page's own structured data of a type is kept, and not doubled", () => {
    const own = PAGES["index.html"]!.replace("</head>", '<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"Ferrow","url":"https://www.example.com/"}</script></head>');
    const result = planSite({ ...inputFor(""), pages: [readPage(own, { path: "/", url: `${ORIGIN}/` })] });

    expect(result.head.get("/")).not.toContain('"WebSite"');
    expect(result.head.get("/")).toContain('"Organization"');
  });
});

function inputFor(base: string): SiteInput {
  return {
    pages: facts(base),
    settings: SETTINGS,
    origin: ORIGIN,
    base,
    own: { robots: null, sitemap: null, llmsTxt: false, llmsFullTxt: false, agentPage: false },
    patterns: { blog: "/blog/{slug}/" },
    fileExists: (path) => path === "/images/logo.png",
  };
}

describe("robots.txt and sitemap.xml", () => {
  it("robots.txt: site-wide rules, then one group per named crawler, training and search told apart; an allowed crawler keeps the site-wide rules (golden)", () => {
    const text = plan().files["robots.txt"]!;

    golden("robots.txt", text);
    expect(text).toContain("User-agent: OAI-SearchBot\nDisallow: /drafts/");
    expect(text).toContain("User-agent: GPTBot\nDisallow: /");
    expect(text).toMatch(/# OpenAI's training crawler \(AI training: .*\): blocked/);
    expect(text).toMatch(/# ChatGPT's search crawler \(AI search: .*\): allowed/);
    expect(text.trimEnd().endsWith("Sitemap: https://www.example.com/sitemap.xml")).toBe(true);
  });

  it("with no settings at all: every crawler allowed, the sitemap named — the same as the starters wrote by hand", () => {
    const result = planSite({ ...inputFor(""), settings: defaultSettings() });

    expect(result.files["robots.txt"]).toBe("User-agent: *\nAllow: /\n\nSitemap: https://www.example.com/sitemap.xml\n");
  });

  it("follows RFC 9309 matching for the site-wide rules: longest match wins, Allow wins a tie", () => {
    expect(robotsAllows({ disallow: ["/drafts/"], allow: [] }, "/drafts/x/")).toBe(false);
    expect(robotsAllows({ disallow: ["/drafts/"], allow: ["/drafts/public/"] }, "/drafts/public/x/")).toBe(true);
    expect(robotsAllows({ disallow: ["/a"], allow: ["/a"] }, "/a")).toBe(true);
    expect(robotsAllows({ disallow: ["/*.pdf$"], allow: [] }, "/files/x.pdf")).toBe(false);
  });

  it("sitemap.xml lists canonical addresses of listed pages, minus exclusions, with lastmod only from dates the pages state (golden)", () => {
    const text = plan().files["sitemap.xml"]!;

    golden("sitemap.xml", text);
    expect(text).not.toContain("/thanks/");
    expect(text).not.toContain("/secret/");
    expect(text).not.toContain("/old-pricing/");
    expect(text).toContain("<loc>https://www.example.com/blog/certificate-register/</loc><lastmod>2026-09-01</lastmod>");
    expect((text.match(/<lastmod>/g) ?? []).length).toBe(1);
  });

  it("a site's own robots.txt, sitemap or llms.txt is left alone, with a note", () => {
    const result = plan({ own: { robots: "robots.txt", sitemap: "sitemap-index.xml", llmsTxt: true, llmsFullTxt: false, agentPage: false } });

    expect(result.files["robots.txt"]).toBeUndefined();
    expect(result.files["sitemap.xml"]).toBeUndefined();
    expect(result.files["llms.txt"]).toBeUndefined();
    expect(result.notes.join("\n")).toMatch(/robots\.txt: the site writes its own .*The crawler choices in the visibility file are not applied/);
    expect(result.files["agent.md"]).toContain("https://www.example.com/sitemap-index.xml");
  });

  it("under a sub-path: every address carries the base, and the note says robots.txt belongs at the host's root", () => {
    const result = planSite(inputFor("/demo"));

    expect(result.files["robots.txt"]).toContain("Disallow: /demo/drafts/");
    expect(result.files["llms.txt"]).toContain("(https://www.example.com/demo/about.md)");
    expect(result.files["sitemap.xml"]).toContain("<loc>https://www.example.com/demo/about/</loc>");
    expect(result.head.get("/demo/about/")).toContain('href="/demo/about.md"');
    expect(result.notes.join("\n")).toContain("crawlers only read the one at the root of the host");
    expect(result.files["index.md"]).toBeDefined();
  });
});

describe("the data file", () => {
  it("every part can be switched off", () => {
    const off = normalizeSettings({ robots: false, sitemap: false, structuredData: false, agentReadable: false });
    const result = planSite({ ...inputFor(""), settings: off });

    expect(Object.keys(result.files)).toEqual([]);
    expect(result.head.size).toBe(0);
  });

  it("says plainly what is wrong, all at once", () => {
    expect(() => normalizeSettings({ crawlers: { GPTBot: "no", "bad token": "block" }, robots: { disallow: ["drafts/"] }, sitemap: { lastmod: "git" }, extra: 1 })).toThrow(
      [
        "src/data/visibility.json has 5 problems:",
        "  - “extra” isn't a setting this kit knows (it reads site, crawlers, robots, sitemap, structuredData and agentReadable).",
        '  - crawlers.GPTBot should be "allow" or "block".',
        "  - crawlers: “bad token” isn't a crawler name robots.txt can use (letters, digits, “-” and “_” only).",
        "  - robots.disallow: “drafts/” should start with “/” (an address on the site, without the domain).",
        '  - sitemap.lastmod should be "content" (dates the pages state) or "none".',
      ].join("\n"),
    );
  });

  it("is read from the site, with defaults when there is none", () => {
    const root = mkdtempSync(join(tmpdir(), "galley-vis-"));

    dirs.push(root);
    expect(readSettings(root).exists).toBe(false);
    mkdirSync(join(root, "src/data"), { recursive: true });
    writeFileSync(join(root, "src/data/visibility.json"), '{ "crawlers": { "GPTBot": "block" } }');
    expect(readSettings(root).settings.crawlers).toEqual({ GPTBot: "block" });
    writeFileSync(join(root, "src/data/visibility.json"), "{ nope");
    expect(() => readSettings(root)).toThrow(/can't be read as JSON/);
  });
});

describe("drafts and collections from the content files", () => {
  it("finds draft entries by their front matter, at their collection's address", () => {
    const root = mkdtempSync(join(tmpdir(), "galley-vis-"));

    dirs.push(root);
    const files: Record<string, string> = {
      "galley.config.json": JSON.stringify({ name: "Ferrow", collections: [{ id: "blog", url: "/journal/{slug}/" }, { id: "team", url: null }, { id: "stories", url: "/customers/{slug}/", draftField: "unpublished" }] }),
      "src/content/blog/first.md": "---\ntitle: First\ndraft: true\n---\nBody",
      "src/content/blog/second.md": "---\ntitle: Second\ndraft: false\ndate: 2026-03-04\n---\nBody",
      "src/content/stories/acme.json": '{ "title": "Acme", "unpublished": true }',
      "src/content/team/jo.md": "---\ndraft: true\n---",
      "src/content/pages/later.md": "---\ndraft: yes\n---",
    };

    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    expect(readSiteContent(root)).toEqual({
      name: "Ferrow",
      patterns: { blog: "/journal/{slug}/", stories: "/customers/{slug}/" },
      drafts: ["/customers/acme/", "/journal/first/", "/later/"],
      dates: { "/journal/second/": "2026-03-04" },
    });
    expect(isDraft("---\ndraft: true # for now\n---", "x.md")).toBe(true);
    expect(isDraft("---\ntitle: x\n---\ndraft: true", "x.md")).toBe(false);
  });
});

describe("the crawler catalogue", () => {
  it("names each documented AI crawler with what it is for, telling training from search", () => {
    expect(aiCrawlers).toBe(AI_CRAWLERS);
    expect(AI_CRAWLERS.map((crawler) => `${crawler.token}:${crawler.purpose}`)).toEqual([
      "GPTBot:training",
      "OAI-SearchBot:search",
      "ChatGPT-User:user",
      "ClaudeBot:training",
      "Claude-SearchBot:search",
      "Claude-User:user",
      "PerplexityBot:search",
      "Perplexity-User:user",
      "Google-Extended:training",
      "Applebot-Extended:training",
      "CCBot:dataset",
    ]);
    for (const crawler of AI_CRAWLERS) expect(crawler.docs).toMatch(/^https:\/\//);
    expect(describePolicy({ GPTBot: "block", CCBot: "block", "OAI-SearchBot": "allow" })).toBe("Blocks AI training (GPTBot, CCBot); allows AI search (OAI-SearchBot).");
  });
});

describe("after astro build", () => {
  it("writes the files and the <head> tags into the output folder, and leaves the site's own files alone", () => {
    const root = mkdtempSync(join(tmpdir(), "galley-vis-"));
    const dist = join(root, "dist");

    dirs.push(root);
    for (const [file, html] of Object.entries(PAGES)) {
      mkdirSync(dirname(join(dist, file)), { recursive: true });
      writeFileSync(join(dist, file), html);
    }
    writeFileSync(join(dist, "robots.txt"), "User-agent: *\nDisallow:\n");
    mkdirSync(join(root, "src/data"), { recursive: true });
    writeFileSync(join(root, "src/data/visibility.json"), JSON.stringify({ crawlers: { GPTBot: "block" } }));
    const result = writeVisibility({ dir: dist, root, file: "src/data/visibility.json", origin: ORIGIN, base: "" });

    expect(readFileSync(join(dist, "robots.txt"), "utf8")).toBe("User-agent: *\nDisallow:\n");
    expect(result.written).toContain("llms.txt");
    expect(result.written).toContain("about.md");
    expect(result.written).not.toContain("robots.txt");
    expect(readFileSync(join(dist, "about/index.html"), "utf8")).toContain('<link rel="alternate" type="text/markdown" href="/about.md"></head>');
    expect(readFileSync(join(dist, "secret/index.html"), "utf8")).toBe(PAGES["secret/index.html"]);
    expect(result.summary).toMatch(/^visibility: 9 of 13 pages listed · 9 markdown versions · structured data on \d+ pages · llms\.txt, llms-full\.txt, agent\.md, sitemap\.xml · \d+ ms$/);
    expect(result.notes.join("\n")).toContain("The crawler choices in the visibility file are not applied");

    // Running it twice changes nothing more: tags already there aren't doubled.
    const before = readFileSync(join(dist, "index.html"), "utf8");

    writeVisibility({ dir: dist, root, file: "src/data/visibility.json", origin: ORIGIN, base: "" });
    expect(readFileSync(join(dist, "index.html"), "utf8").split('type="text/markdown"').length).toBe(before.split('type="text/markdown"').length);
  });
});

describe("in astro dev", () => {
  let server: Server | null = null;

  it("asks the dev server about an address only when the site may serve it: a public file, an exact route, or a dynamic route with that extension", () => {
    const root = mkdtempSync(join(tmpdir(), "galley-vis-"));

    dirs.push(root);
    mkdirSync(join(root, "public"), { recursive: true });
    writeFileSync(join(root, "public/robots.txt"), "User-agent: *\n");
    const routes = [
      { pattern: "/[...slug]", regex: /^\/(.*?)\/?$/, dynamic: true },
      { pattern: "/sitemap.xml", regex: /^\/sitemap\.xml$/, dynamic: false },
      { pattern: "/[twin].md", regex: /^\/([^/]+?)\.md$/, dynamic: true },
    ];

    expect(siteServes(root, routes, "/robots.txt")).toBe("file");
    expect(siteServes(root, routes, "/sitemap.xml")).toBe("route");
    expect(siteServes(root, routes, "/about.md")).toBe("maybe");
    expect(siteServes(root, routes.slice(0, 2), "/about.md")).toBeNull();
    expect(siteServes(root, routes, "/llms.txt")).toBeNull();
  });

  afterAll(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

  it("answers the same addresses from the pages the dev server renders, and adds the same <head> tags", async () => {
    const root = mkdtempSync(join(tmpdir(), "galley-vis-"));

    dirs.push(root);
    let origin = "";
    const middleware = createDevMiddleware({ root, file: "src/data/visibility.json", origin: ORIGIN, base: "", self: () => origin });
    // A stand-in for Astro's dev server: the fixture pages, behind the kit's middleware.
    server = createServer((req, res) => {
      middleware(req, res, () => {
        const path = (req.url ?? "/").split("?")[0]!;
        const file = path === "/" ? "index.html" : path.endsWith("/") ? `${path.slice(1)}index.html` : "";
        const html = file ? PAGES[file] : undefined;

        res.writeHead(html ? 200 : 404, { "content-type": html ? "text/html; charset=utf-8" : "text/plain" });
        res.end(html ?? "Not found");
      });
    });
    await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;

    const twin = await fetch(`${origin}/about.md`);

    expect(twin.status).toBe(200);
    expect(twin.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await twin.text()).toBe(plan({ settings: defaultSettings() }).files["about.md"]);
    const page = await (await fetch(`${origin}/about/`)).text();

    expect(page).toContain('<link rel="alternate" type="text/markdown" href="/about.md"></head>');
    const raw = await (await fetch(`${origin}/about/`, { headers: { [RAW_HEADER]: "raw" } })).text();

    expect(raw).toBe(PAGES["about/index.html"]);
    const llms = await fetch(`${origin}/llms.txt`);

    expect(llms.status).toBe(200);
    expect(llms.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    // Only pages reachable by links are found in dev: the home page links About and the blog.
    const text = await llms.text();

    expect(text.startsWith("# Ferrow\n")).toBe(true);
    expect(text).toContain("(https://www.example.com/about.md)");
    expect(text).toContain("(https://www.example.com/blog/certificate-register.md)");
    expect((await fetch(`${origin}/robots.txt`)).status).toBe(200);
    expect((await fetch(`${origin}/secret.md`)).status).toBe(404);
    expect((await fetch(`${origin}/nowhere.md`)).status).toBe(404);
  });
});
