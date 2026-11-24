/**
 * The audit against real files in real git repositories: a clean site must
 * produce nothing, a site with planted problems must produce exactly those,
 * with evidence; re-audits read only what changed; fixes are one-line diffs
 * and are refused when the page changed since it was checked.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { auditEntry, auditSite, forgetAudit } from "../../src/seo/audit";
import { applyFixes, undoFixes } from "../../src/seo/fixes";
import { applyCrawlerPolicy, crawlerReport, readRobots } from "../../src/seo/policy";
import { POLICY_START } from "../../src/seo/robots";
import { disposeAll, openSite, sh } from "../site/helpers";
import { cleanFiles, cleanRendered, distFiles, makeFixture, plantedFiles, plantedRendered } from "./fixture";

afterAll(() => disposeAll());

const NOW = new Date("2026-11-23T12:00:00Z");

function codes(findings: Array<{ code: string; url?: string | null; path?: string }>): string[] {
  return findings.map((f) => `${f.code} ${f.url ?? f.path ?? "site"}`).sort();
}

describe("a clean site", () => {
  it("has no findings from the content files alone", async () => {
    const { site } = await openSite(makeFixture(cleanFiles()));
    const audit = await auditSite(site, { now: NOW });

    expect(codes(audit.findings)).toEqual([]);
    expect(audit.rendering.source).toBe("none");
    expect(audit.summary).toMatch(/Nothing to fix or suggest\..*start the preview or build the site/);
    // Every rendered check is listed as skipped, with the reason, so nothing is silently left out.
    expect(audit.skipped.map((s) => s.code)).toEqual(expect.arrayContaining(["h1-missing", "canonical-missing", "sitemap-missing", "jsonld-invalid"]));
    expect(audit.crawlers.where).toEqual({ kind: "static", path: "public/robots.txt" });
    expect(audit.crawlers.crawlers.every((c) => c.allowed)).toBe(true);
  });

  it("has no findings from its rendered pages either", async () => {
    const { site } = await openSite(makeFixture(cleanFiles(), distFiles(cleanRendered())));
    const audit = await auditSite(site, { now: NOW });

    expect(codes(audit.findings)).toEqual([]);
    expect(audit.rendering).toMatchObject({ source: "build", sampled: 7, total: 7 });
    expect(audit.agentReadable).toMatchObject({ known: true, llmsTxt: { present: true, valid: true }, markdownTwins: { checked: 7, advertised: 7, reachable: 7 } });
    expect(audit.counts).toEqual({ must: 0, should: 0, idea: 0 });
  });
});

describe("a site with problems planted", () => {
  it("finds each one, with its evidence, kind and source", async () => {
    const { site } = await openSite(makeFixture(plantedFiles(), plantedRendered()));
    const audit = await auditSite(site, { now: NOW });

    expect(codes(audit.findings)).toEqual(
      [
        "agent-readable-broken site",
        "ai-search-blocked site",
        "canonical-missing /about/",
        "date-past-upcoming /events/sourdough-afternoon/",
        "description-missing /contact/",
        "h1-missing /about/",
        "image-alt-filename /blog/overnight-dough/",
        "image-alt-missing /",
        "image-alt-missing /about/",
        "jsonld-invalid /contact/",
        "link-broken /about/",
        "link-slash-mixed /about/",
        "link-text-vague /about/",
        "noindex-important /",
        "page-orphan /allergens/",
        "placeholder-text /contact/",
        "sitemap-missing-page /contact/",
        "thin-page /allergens/",
        "title-brand-repeated /blog/apple-cake/",
        "title-duplicate /about/",
        "title-duplicate /contact/",
        "title-long /allergens/",
      ].sort()
    );
    const by = (code: string, url?: string) => audit.findings.find((f) => f.code === code && (!url || f.url === url))!;

    expect(by("title-duplicate", "/contact/")).toMatchObject({ severity: "should", kind: "documented", field: ["title"], write: "title", evidence: { value: "About the bakery", pages: [{ url: "/about/" }] } });
    expect(by("title-duplicate").source?.url).toBe("https://developers.google.com/search/docs/appearance/title-link");
    expect(by("noindex-important")).toMatchObject({ severity: "must", title: "The home page is kept out of search", fix: { edits: [{ path: "src/content/pages/index.md", ops: [{ op: "set", path: ["noindex"], value: false }] }] } });
    expect(by("link-broken")).toMatchObject({ severity: "must", kind: "measurable", evidence: { value: "/old-menu/", note: "That page now lives at /contact/." } });
    expect(by("placeholder-text").evidence.note).toBe("Contains a bracketed placeholder: “[Add opening hours]”.");
    expect(by("image-alt-missing", "/")).toMatchObject({ field: ["sections", 0, "imageAlt"], write: "alt", rendered: false });
    expect(by("image-alt-missing", "/about/")).toMatchObject({ rendered: true, evidence: { value: "/images/loaves.png" } });
    expect(by("title-long").evidence.measure).toMatchObject({ unit: "px", limit: 600 });
    expect(by("title-long").evidence.measure!.reasoning).toMatch(/Google publishes no limit/);
    expect(by("ai-search-blocked")).toMatchObject({ title: "ChatGPT's search crawler is blocked", source: { url: "https://developers.openai.com/api/docs/bots" } });
    expect(by("date-past-upcoming").evidence.value).toBe("2025-03-14");
    expect(by("thin-page").kind).toBe("judgement");
    expect(by("agent-readable-broken").evidence.note).toMatch(/top-level heading/);
    expect(audit.crawlers.summary[0]).toBe("OpenAI: ChatGPT's search crawler is blocked; OpenAI's training crawler is blocked; ChatGPT fetching a page for someone is allowed.");
    // Judgement findings never pose as documented ones.
    for (const finding of audit.findings.filter((f) => f.kind === "judgement")) expect(["thin-page", "near-duplicate", "ai-intro-unclear", "facts-in-images", "h1-multiple", "heading-decoration", "date-past-upcoming", "agent-readable-missing"]).toContain(finding.code);
  });

  it("without a build, says what it couldn't check and still finds the content problems", async () => {
    const { site } = await openSite(makeFixture(plantedFiles()));
    const audit = await auditSite(site, { now: NOW });

    expect(audit.rendering.source).toBe("none");
    expect(codes(audit.findings)).toEqual(expect.arrayContaining(["title-duplicate /contact/", "link-broken /about/", "noindex-important /", "page-orphan /allergens/"]));
    expect(audit.findings.some((f) => f.rendered)).toBe(false);
  });
});

describe("re-auditing", () => {
  it("re-reads only the entries whose content changed", async () => {
    const root = makeFixture(cleanFiles());
    const { site } = await openSite(root);

    forgetAudit(root);
    expect((await auditSite(site, { now: NOW })).pages).toEqual({ checked: 7, reused: 0 });
    expect((await auditSite(site, { now: NOW })).pages).toEqual({ checked: 7, reused: 7 });
    await site.updateEntry("src/content/pages/about.md", [{ op: "set", path: ["description"], value: "" }]);
    const third = await auditSite(site, { now: NOW });

    expect(third.pages).toEqual({ checked: 7, reused: 6 });
    expect(codes(third.findings)).toEqual(["description-missing /about/"]);
  });

  it("re-checks links on unchanged pages when the page they point at goes away", async () => {
    const root = makeFixture(cleanFiles());
    const { site } = await openSite(root);

    await auditSite(site, { now: NOW });
    await site.deleteEntry("src/content/pages/about.md");
    const audit = await auditSite(site, { now: NOW });

    expect(codes(audit.findings).filter((code) => code.startsWith("link-broken"))).toEqual(["link-broken /contact/", "link-broken src/data/navigation.json"]);
  });

  it("audits one entry against the whole site, fast, with a result preview", async () => {
    const { site } = await openSite(makeFixture(plantedFiles(), plantedRendered()));
    const entry = await auditEntry(site, "src/content/pages/contact.md", { now: NOW });

    expect(codes(entry.findings)).toEqual(["description-missing /contact/", "jsonld-invalid /contact/", "placeholder-text /contact/", "title-duplicate /contact/"]);
    expect(entry.preview).toMatchObject({ titleFrom: "rendered", title: "Visit us · Harbour Bakery", descriptionFrom: "rendered", titleField: ["title"], descriptionField: ["description"] });
    expect(entry.structuredData).toEqual([]);
    expect(entry.rendering.sampled).toBe(1);
  });
});

describe("fixes", () => {
  it("are one-line edits, applied together and undone together", async () => {
    const root = makeFixture(plantedFiles(), plantedRendered());
    const { site } = await openSite(root);
    const audit = await auditSite(site, { now: NOW });
    const ids = audit.findings.filter((f) => f.fix).map((f) => f.id);

    expect(audit.findings.filter((f) => f.fix).map((f) => f.code).sort()).toEqual(["link-broken", "link-slash-mixed", "noindex-important", "title-brand-repeated"]);
    const result = await applyFixes(site, ids);

    expect(result.refused).toEqual([]);
    expect(result.applied).toHaveLength(4);
    const diff = sh(root, "diff", "--unified=0");
    const changed = diff.split("\n").filter((line) => /^[-+][^-+]/.test(line));

    expect(changed).toEqual([
      "-title: The October apple cake | Harbour Bakery",
      "+title: The October apple cake",
      "-Our [menu](/old-menu/) has moved. [Click here](/blog/) for what we are baking this month.",
      "+Our [menu](/contact/) has moved. [Click here](/blog/) for what we are baking this month.",
      "-Opening hours: [Add opening hours]. The [story of the bakery](/about) is on its own page.",
      "+Opening hours: [Add opening hours]. The [story of the bakery](/about/) is on its own page.",
      "-noindex: true",
      "+noindex: false",
    ]);
    const after = await auditSite(site, { now: NOW });

    expect(codes(after.findings)).not.toEqual(expect.arrayContaining(["link-broken /about/", "noindex-important /"]));
    const undone = await undoFixes(site, result.undoId!);

    expect(undone.restored).toHaveLength(4);
    expect(undone.left).toEqual([]);
    expect(sh(root, "status", "--porcelain")).toBe("");
  });

  it("are refused when the page changed after it was checked", async () => {
    const root = makeFixture(plantedFiles());
    const { site } = await openSite(root);
    const audit = await auditSite(site, { now: NOW });
    const fix = audit.findings.find((f) => f.code === "noindex-important")!;
    const file = join(root, "src/content/pages/index.md");

    writeFileSync(file, readFileSync(file, "utf8").replace("Bread and cakes on the quay", "Bread on the quay"));
    const result = await applyFixes(site, [fix.id]);

    expect(result.applied).toEqual([]);
    expect(result.refused[0]!.reason).toMatch(/changed since it was checked/);
  });

  it("aren't offered where the right edit isn't certain", async () => {
    const files = plantedFiles();

    // Two different moves for one old address: no redirect to trust, so no fix.
    delete files["netlify.toml"];
    const { site } = await openSite(makeFixture(files));
    const audit = await auditSite(site, { now: NOW });

    expect(audit.findings.find((f) => f.code === "link-broken")!.fix).toBeUndefined();
    expect(audit.findings.find((f) => f.code === "title-duplicate")!.fix).toBeUndefined();
    expect(audit.findings.find((f) => f.code === "description-missing")!.fix).toBeUndefined();
  });
});

describe("the AI crawler policy", () => {
  it("is written into a marked block of the site's own robots.txt", async () => {
    const files = cleanFiles();

    files["galley.config.json"] = String(files["galley.config.json"]).replace('"name"', '"ai": { "allowBuild": true },\n  "name"');
    const root = makeFixture(files);
    const { site } = await openSite(root);

    await applyCrawlerPolicy(site, { GPTBot: "block", CCBot: "block" });
    const text = readFileSync(join(root, "public/robots.txt"), "utf8");

    expect(text.startsWith("User-agent: *\nAllow: /\n\nSitemap: https://harbour-bakery.test/sitemap.xml\n\n")).toBe(true);
    expect(text).toContain(`${POLICY_START}\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: CCBot\nDisallow: /\n`);
    const report = crawlerReport(await readRobots(site, null), true);

    expect(report.crawlers.filter((c) => !c.allowed).map((c) => c.token)).toEqual(["GPTBot", "CCBot"]);
    expect(report.summary).toContain("Common Crawl: Common Crawl's crawler is blocked.");
  });

  it("is refused when the site writes robots.txt in code", async () => {
    const files = cleanFiles();

    delete files["public/robots.txt"];
    files["src/pages/robots.txt.ts"] = 'export const GET = () => new Response("User-agent: *\\nAllow: /\\n");\n';
    const { site } = await openSite(makeFixture(files));
    const report = crawlerReport(await readRobots(site, null), true);

    expect(report).toMatchObject({ where: { kind: "generated", path: "src/pages/robots.txt.ts" }, editable: false, readable: false });
    await expect(applyCrawlerPolicy(site, { GPTBot: "block" })).rejects.toThrow(/writes its robots rules in code/);
  });
});
