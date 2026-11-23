/**
 * Sites that use Galley's site kit: the crawler choices live in its data
 * file and are edited there; its markdown versions, llms.txt, llms-full.txt
 * and agent.md are understood as it lays them out; sub-path builds resolve;
 * article details can be switched on from a finding. Plus the drift test
 * between the app's crawler catalogue and the kit's.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { auditSite } from "../../src/seo/audit";
import { applyFixes } from "../../src/seo/fixes";
import { applyCrawlerPolicy, crawlerReport, readRobots } from "../../src/seo/policy";
import { baseFromHome } from "../../src/seo/render";
import { CRAWLERS, describePolicy } from "../../src/seo/robots";
import type { CrawlerChoice } from "../../src/seo/types";
import { agentView } from "../../src/seo/external";
import { disposeAll, openSite, sh } from "../site/helpers";
import { cleanFiles, cleanRendered, distFiles, makeFixture, SITE_URL } from "./fixture";

afterAll(() => disposeAll());

const NOW = new Date("2026-11-23T12:00:00Z");
const KIT_CRAWLERS = fileURLToPath(new URL("../../../astro/src/visibility/crawlers.js", import.meta.url));

/** The clean site, set up the way the starters vendor the kit. */
function kitFiles(visibility: unknown = { crawlers: { CCBot: "block" }, structuredData: { articles: ["blog"] }, agentReadable: { optional: ["/contact/"] } }): Record<string, string | Uint8Array> {
  const files = cleanFiles();

  delete files["public/robots.txt"];
  files["astro.config.mjs"] = `import { defineConfig } from "astro/config";\nimport galley from "./src/galley/integration.js";\n\nexport default defineConfig({ site: "${SITE_URL}", trailingSlash: "always", integrations: [galley()] });\n`;
  files["src/galley/integration.js"] = "// Vendored from @galley/astro by scripts/vendor.mjs.\nexport default function galley() {\n  return { name: \"galley-kit\", hooks: {} };\n}\n";
  if (visibility !== null) files["src/data/visibility.json"] = `${JSON.stringify(visibility, null, 2)}\n`;
  return files;
}

function changedLines(root: string): string[] {
  return sh(root, "diff", "--unified=0")
    .split("\n")
    .filter((line) => /^[-+][^-+]/.test(line));
}

describe("the crawler catalogue", () => {
  it("says exactly what the site kit says, crawler for crawler", async () => {
    const kit = (await import(pathToFileURL(KIT_CRAWLERS).href)) as {
      AI_CRAWLERS: ReadonlyArray<{ token: string; vendor: string; label: string; purpose: string; crawls: boolean; what: string; ifBlocked: string; caveat?: string; docs: string }>;
      describePolicy: (choices: Record<string, CrawlerChoice>) => string;
    };

    expect(CRAWLERS.map((c) => c.token).sort()).toEqual(kit.AI_CRAWLERS.map((c) => c.token).sort());
    for (const theirs of kit.AI_CRAWLERS) {
      const ours = CRAWLERS.find((c) => c.token === theirs.token)!;

      expect({ vendor: ours.vendor, label: ours.label, purpose: ours.purpose, crawls: ours.crawls, what: ours.what, ifBlocked: ours.ifBlocked, caveat: ours.caveat, docs: ours.source.url }, theirs.token).toEqual({
        vendor: theirs.vendor,
        label: theirs.label,
        purpose: theirs.purpose,
        crawls: theirs.crawls,
        what: theirs.what,
        ifBlocked: theirs.ifBlocked,
        caveat: theirs.caveat,
        docs: theirs.docs,
      });
    }
    for (const choices of [{}, { GPTBot: "block", CCBot: "block", "OAI-SearchBot": "allow" }, { claudebot: "block", "Perplexity-User": "allow", NewBot: "block" }] as Array<Record<string, CrawlerChoice>>) {
      expect(describePolicy(choices)).toBe(kit.describePolicy(choices));
    }
  });
});

describe("crawler choices on a kit site", () => {
  it("are read from the kit's data file and written back there, one line each", async () => {
    const root = makeFixture(kitFiles());
    const { site } = await openSite(root);
    const before = crawlerReport(await readRobots(site, null), false);

    expect(before).toMatchObject({ where: { kind: "kit", path: "src/data/visibility.json" }, readFrom: "kit", editable: true, policy: "Blocks AI training (CCBot)." });
    expect(before.crawlers.find((c) => c.token === "CCBot")).toMatchObject({ allowed: false, decidedBy: "rule" });
    expect(before.summary).toContain("Common Crawl: Common Crawl's crawler is blocked.");

    await applyCrawlerPolicy(site, { GPTBot: "block", CCBot: "allow" });
    const data = JSON.parse(readFileSync(join(root, "src/data/visibility.json"), "utf8"));

    expect(data.crawlers).toEqual({ GPTBot: "block" });
    expect(changedLines(root)).toEqual(['-    "CCBot": "block"', '+    "GPTBot": "block"']);
    // Nothing else was created: the kit keeps writing robots.txt.
    expect(sh(root, "status", "--porcelain")).toBe("M src/data/visibility.json");
    expect(crawlerReport(await readRobots(site, null), false).policy).toBe("Blocks AI training (GPTBot).");
    expect((await applyCrawlerPolicy(site, { GPTBot: "block" })).changed).toBe(false);
  });

  it("start a crawlers section when the data file has none, and create the file when there isn't one", async () => {
    const root = makeFixture(kitFiles({ structuredData: { articles: ["blog"] } }));
    const { site } = await openSite(root);

    await applyCrawlerPolicy(site, { ClaudeBot: "block" });
    expect(JSON.parse(readFileSync(join(root, "src/data/visibility.json"), "utf8"))).toEqual({ structuredData: { articles: ["blog"] }, crawlers: { ClaudeBot: "block" } });
    const bare = makeFixture(kitFiles(null));
    const opened = await openSite(bare);

    await applyCrawlerPolicy(opened.site, { GPTBot: "block" });
    expect(JSON.parse(readFileSync(join(bare, "src/data/visibility.json"), "utf8"))).toEqual({ crawlers: { GPTBot: "block" } });
  });

  it("leave a hand-written robots.txt in charge, and explain a robots route", async () => {
    const own = kitFiles();

    own["public/robots.txt"] = "User-agent: *\nAllow: /\n";
    const { site } = await openSite(makeFixture(own));

    expect(crawlerReport(await readRobots(site, null), true).where).toEqual({ kind: "static", path: "public/robots.txt" });
    const coded = kitFiles();

    coded["src/pages/robots.txt.ts"] = 'export const GET = () => new Response("User-agent: *\\nAllow: /\\n");\n';
    const second = await openSite(makeFixture(coded));

    expect(crawlerReport(await readRobots(second.site, null), true).where).toEqual({ kind: "generated", path: "src/pages/robots.txt.ts" });
    const off = kitFiles();

    off["astro.config.mjs"] = String(off["astro.config.mjs"]).replace("galley()", "galley({ visibility: false })");
    const third = await openSite(makeFixture(off));

    expect(crawlerReport(await readRobots(third.site, null), true).where).toEqual({ kind: "none" });
  });
});

describe("the kit's agent-readable output", () => {
  it("is understood as the kit lays it out, with no findings on a clean build", async () => {
    const { site } = await openSite(makeFixture(kitFiles(), distFiles(cleanRendered(), {}, { kit: true })));
    const audit = await auditSite(site, { now: NOW });

    expect(audit.findings.map((f) => `${f.code} ${f.url ?? f.path ?? "site"}`)).toEqual([]);
    expect(audit.agentReadable).toMatchObject({
      known: true,
      agentPage: true,
      fullText: true,
      kit: { file: "src/data/visibility.json", llmsTxt: true, llmsFullTxt: true, markdownTwins: true, agentPage: true },
      llmsTxt: { present: true, valid: true, links: 7 },
      markdownTwins: { checked: 7, advertised: 7, reachable: 7 },
    });
    expect(audit.agentReadable.summary).toMatch(/^The site kit publishes a markdown version of each page, llms.txt, llms-full.txt and agent.md, set in src\/data\/visibility.json\. The last build serves llms.txt, llms-full.txt and agent.md/);
    expect(audit.crawlers.policy).toBe("Blocks AI training (CCBot).");
  });

  it("doesn't count pages left out on purpose, and reports a page that should have a twin", async () => {
    const pages = cleanRendered();
    const withExcluded = [...pages, { ...pages[1]!, path: "/old-about/", redirect: "/about/" }, { ...pages[2]!, path: "/thanks/", title: "Thanks · Harbour Bakery", noindex: true, noTwin: true }];
    const clean = await openSite(makeFixture(kitFiles(), distFiles(withExcluded, {}, { kit: true })));
    const audit = await auditSite(clean.site, { now: NOW });

    expect(audit.findings.filter((f) => f.group === "ai")).toEqual([]);
    expect(audit.agentReadable.markdownTwins).toMatchObject({ checked: 7, advertised: 7 });
    expect(audit.agentReadable.summary).toContain("2 left out on purpose");
    const gap = pages.map((p) => (p.path === "/contact/" ? { ...p, noTwin: true } : p));
    const broken = await openSite(makeFixture(kitFiles(), distFiles(gap, {}, { kit: true })));
    const found = (await auditSite(broken.site, { now: NOW })).findings.find((f) => f.id.endsWith("missing-twins"))!;

    expect(found).toMatchObject({ code: "agent-readable-broken", evidence: { pages: [{ url: "/contact/" }] } });
  });

  it("shows an agent the page's real markdown version", async () => {
    const { site } = await openSite(makeFixture(kitFiles(), distFiles(cleanRendered(), {}, { kit: true })));
    const view = await agentView(site, "/about/");

    expect(view).toMatchObject({ kind: "markdown" });
    expect(view.from).toMatch(/^\/about\.md, from the last build/);
    expect(view.text).toMatch(/^---\ntitle: "About the bakery"/);
  });
});

describe("sub-path builds", () => {
  it("finds the base path in the build and resolves links, twins and preferred addresses under it", async () => {
    const dist = distFiles(cleanRendered(), {}, { kit: true, base: "/docs" });

    expect(String(dist["dist/about/index.html"])).toContain('href="/docs/about.md"');
    expect(baseFromHome(String(dist["dist/index.html"]))).toBe("/docs");
    expect(baseFromHome('<link rel="alternate" type="text/markdown" href="/index.md"><link rel="canonical" href="https://a.test/">')).toBe("");
    const { site } = await openSite(makeFixture(kitFiles(), dist));
    const audit = await auditSite(site, { now: NOW });

    expect(audit.findings.map((f) => `${f.code} ${f.url ?? f.path ?? "site"}`)).toEqual([]);
    expect(audit.rendering).toMatchObject({ source: "build", sampled: 7 });
    expect(audit.agentReadable.markdownTwins).toMatchObject({ advertised: 7, reachable: 7 });
    expect((await agentView(site, "/about/")).kind).toBe("markdown");
  });
});

describe("pages that aren't HTML", () => {
  it("are skipped and named, rather than checked into false findings", async () => {
    // What a dev server that serialises its bytes wrongly sends: "<!DOCTYPE" as "60,33,68,…".
    const dist = distFiles(cleanRendered(), { "dist/about/index.html": Array.from(Buffer.from("<!DOCTYPE html><html><head><title>About</title>")).join(",") }, { kit: true });
    const { site } = await openSite(makeFixture(kitFiles(), dist));
    const audit = await auditSite(site, { now: NOW });

    expect(audit.rendering.detail).toContain("1 page came back as something other than HTML (/about/) and was skipped.");
    expect(audit.findings.filter((f) => f.url === "/about/")).toEqual([]);
  });
});

describe("article details on a kit site", () => {
  it("are a one-click fix: the posts' collection added to the data file", async () => {
    const pages = cleanRendered().map((p) => (p.path.startsWith("/blog/") && p.path !== "/blog/" ? { ...p, jsonld: [] } : p));
    const root = makeFixture(kitFiles({ structuredData: { articles: ["events"] } }), distFiles(pages, {}, { kit: true }));
    const { site } = await openSite(root);
    const audit = await auditSite(site, { now: NOW });
    const suggestion = audit.findings.find((f) => f.code === "jsonld-suggest-article")!;

    expect(suggestion.fix).toMatchObject({ label: "Describe blog as articles", edits: [{ path: "src/data/visibility.json", ops: [{ op: "insert", path: ["structuredData", "articles"], index: 1, value: "blog" }] }] });
    const result = await applyFixes(site, [suggestion.id]);

    expect(result.refused).toEqual([]);
    expect(JSON.parse(readFileSync(join(root, "src/data/visibility.json"), "utf8")).structuredData.articles).toEqual(["events", "blog"]);
    expect(sh(root, "status", "--porcelain")).toBe("M src/data/visibility.json");
  });
});
