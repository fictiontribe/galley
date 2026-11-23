/**
 * End to end on a real copy of the starter: import → everything is a pending
 * change → the site's own build passes and the posts render → a second run
 * changes nothing → a dry run writes nothing.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SiteService } from "@galley/core/types";
import { planContext } from "../src/command";
import { planImport } from "../src/plan";
import { renderReport } from "../src/report";
import { runImport } from "../src/run";
import { readWordPress } from "../src/source/index";
import type { ImportReport, WordPressSite } from "../src/types";
import { startFakeWordPress, type FakeWordPress } from "./fake-wordpress";
import { FIXTURES, git, makeSite, openSite, redirectFetch, tempDir, uploads } from "./helpers";

const WXR = join(FIXTURES, "quillfield.wxr");

function snapshot(root: string): string {
  const status = git(root, "status", "--porcelain", "-uall");
  const files = status
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3))
    .map((path) => `${path} ${createHash("sha256").update(readFileSync(join(root, path))).digest("hex")}`);

  return `${status}\n${files.join("\n")}`;
}

async function importInto(site: SiteService, wp: WordPressSite, fetchImpl: typeof fetch, extra: { dryRun?: boolean; writeRedirects?: boolean } = {}): Promise<ImportReport> {
  const model = await site.model();
  const plan = planImport(wp, model, { context: await planContext(site, model) });

  return runImport(site, wp, plan, { fetch: fetchImpl, ...extra });
}

describe("importing an export file into the starter", () => {
  let server: FakeWordPress;
  let root: string;
  let site: SiteService;
  let wp: WordPressSite;
  let report: ImportReport;
  let fetchImpl: typeof fetch;

  beforeAll(async () => {
    server = await startFakeWordPress({ files: uploads() });
    fetchImpl = redirectFetch(server.url);
    root = makeSite("wxr");
    site = await openSite(root);
    wp = await readWordPress({ file: WXR });
  });

  afterAll(async () => {
    await site.dispose();
    await server.close();
  });

  it("a dry run plans everything and writes nothing", async () => {
    const dry = await importInto(site, wp, fetchImpl, { dryRun: true, writeRedirects: true });

    expect(git(root, "status", "--porcelain", "-uall")).toBe("");
    expect(dry.dryRun).toBe(true);
    expect(dry.counts.posts).toEqual({ created: 4, updated: 0, unchanged: 0, skipped: 2 });
    expect(dry.counts.pages.created).toBe(5);
    expect(dry.items.filter((item) => item.action === "would-create")).toHaveLength(9);
    expect(server.requests.length).toBe(0);
    expect(renderReport(dry)).toMatch(/^Import plan \(nothing was written\)/);
  });

  it("imports posts, pages and media as pending changes", async () => {
    report = await importInto(site, wp, fetchImpl, { writeRedirects: true });

    expect(report.counts.posts).toEqual({ created: 4, updated: 0, unchanged: 0, skipped: 2 });
    expect(report.counts.pages).toEqual({ created: 5, updated: 0, unchanged: 0, skipped: 2 });
    expect(report.counts.media).toMatchObject({ saved: 13, failed: 1, skipped: 1 });
    expect(report.counts.embeds).toBe(5);
    const changes = await site.changes();
    const byKind = (kind: string) => changes.files.filter((file) => file.kind === kind).map((file) => file.path);

    expect(changes.files.every((file) => file.status === "added")).toBe(true);
    expect(byKind("content")).toHaveLength(9);
    expect(byKind("media").length).toBeGreaterThanOrEqual(13);
    expect(changes.files.map((file) => file.path)).toEqual(expect.arrayContaining(["wordpress-import/manifest.json", "wordpress-import/redirects.mjs", "public/_redirects"]));
    for (const path of ["public/images/kiln-room.png", "public/images/throwing.png", "public/images/banner-1200x600.png", "public/images/price-list.pdf", "public/images/throwing-demo.mp4"]) {
      expect(existsSync(join(root, path)), path).toBe(true);
    }
    // A thumbnail and its original are one file; the same picture under two names would be too.
    expect(existsSync(join(root, "public/images/kiln-room-2.png"))).toBe(false);
    expect(await site.validate()).toEqual([]);
  });

  it("rewrites media and links, and never hot-links the old site", () => {
    const glaze = readFileSync(join(root, "src/content/blog/glaze-notes.md"), "utf8");

    expect(glaze).toContain("image: /images/glaze-tiles.png");
    expect(glaze).toContain("![Hands on a wheel](/images/throwing.png)");
    expect(glaze).toContain('<video controls src="/images/throwing-demo.mp4"></video>');
    expect(glaze).toContain('<iframe width="560" height="315" src="https://www.youtube.com/embed/Zq3fR2b8kXw"');
    expect(glaze).toContain("[See the kiln room](/blog/opening-the-new-kiln-room/)");
    const kiln = readFileSync(join(root, "src/content/blog/opening-the-new-kiln-room.md"), "utf8");

    expect(kiln).toContain("[price list](/images/price-list.pdf)");
    expect(kiln).toContain("<!-- An image (“A photo that no longer exists”) couldn't be brought across");
    // The only old-site addresses left: the link to a page that wasn't imported, and the note naming the missing image.
    const leftovers = [...kiln.matchAll(/https:\/\/old\.example\.org\S*/g)].map((match) => match[0]);

    expect(leftovers).toEqual(["https://old.example.org/shop/).", "https://old.example.org/wp-content/uploads/2024/03/missing-photo.png"]);
    const diary = readFileSync(join(root, "src/content/blog/studio-diary-spring-term.md"), "utf8");

    expect(diary).toContain('<audio controls src="https://old.example.org/wp-content/uploads/2024/04/kiln-sounds.mp3"></audio>');
    expect(report.needsAttention.media.map((entry) => entry.url)).toEqual(expect.arrayContaining(["https://old.example.org/wp-content/uploads/2024/04/kiln-sounds.mp3"]));
    expect(readFileSync(join(root, "public/_redirects"), "utf8")).toContain("/2024/03/glaze-notes/");
  });

  it("running it again changes nothing", async () => {
    const before = snapshot(root);
    const requests = server.requests.length;
    const again = await importInto(site, wp, fetchImpl, { writeRedirects: true });

    expect(snapshot(root)).toBe(before);
    expect(again.counts.posts).toEqual({ created: 0, updated: 0, unchanged: 4, skipped: 2 });
    expect(again.counts.pages).toEqual({ created: 0, updated: 0, unchanged: 5, skipped: 2 });
    expect(again.files).toEqual([]);
    expect(server.requests.length).toBe(requests);
    expect(renderReport(again)).toMatch(/Nothing changed at the source since the last import/);
  });

  it("updates what changed at the source, and leaves alone what a person edited", async () => {
    const changed: WordPressSite = { ...wp, items: wp.items.map((item) => (item.id === 302 ? { ...item, content: "<p>The studio is a six-minute walk from the station.</p>" } : item.id === 301 ? { ...item, title: "Opening times" } : item)) };

    await site.updateEntry("src/content/pages/opening-hours.md", [{ op: "body-replace", find: "We're open", replace: "We are open" }]);
    const result = await importInto(site, changed, fetchImpl);

    expect(result.counts.pages).toMatchObject({ updated: 1, unchanged: 3 });
    expect(readFileSync(join(root, "src/content/pages/visiting.md"), "utf8")).toContain("six-minute walk");
    expect(result.items.find((item) => item.title === "Opening times")?.reason).toMatch(/also been edited here/);
    expect(readFileSync(join(root, "src/content/pages/opening-hours.md"), "utf8")).toContain("title: Opening hours");
  });

  it("the site's own build passes, and the imported posts render", () => {
    // The build runs in a clean environment, as it would on a host.
    execFileSync("env", ["-i", `PATH=${process.env.PATH}`, `HOME=${process.env.HOME}`, "npm", "--prefix", root, "run", "build"], { stdio: "pipe", timeout: 240_000 });
    const page = (path: string) => readFileSync(join(root, "dist", path, "index.html"), "utf8");
    const glaze = page("blog/glaze-notes");

    expect(glaze).toContain("Glaze notes: three recipes we keep coming back to");
    expect(glaze).toContain("https://www.youtube.com/embed/Zq3fR2b8kXw");
    expect(glaze).toContain('src="/images/throwing.png"');
    expect(glaze).toMatch(/<table>/);
    expect(page("classes")).toContain("Make something with your hands");
    expect(page("visiting/kiln-room")).toContain("Visitors are welcome in the kiln room");
    expect(existsSync(join(root, "dist/images/throwing.png"))).toBe(true);
    expect(existsSync(join(root, "dist/_redirects"))).toBe(true);
    rmSync(join(root, "dist"), { recursive: true, force: true });
  }, 300_000);
});

describe("importing a live site through the REST API", () => {
  let server: FakeWordPress;
  let root: string;
  let site: SiteService;

  beforeAll(async () => {
    server = await startFakeWordPress({ files: uploads(), maxPerPage: 2, rateLimitOnce: ["/wp/v2/posts"] });
    root = makeSite("rest");
    site = await openSite(root);
  });

  afterAll(async () => {
    await site.dispose();
    await server.close();
  });

  it("imports the rendered content with the same safeguards", async () => {
    const wp = await readWordPress({ url: server.url }, { cacheDir: tempDir("cache-") });
    const report = await importInto(site, wp, fetch);

    expect(report.counts.posts).toMatchObject({ created: 3 });
    expect(report.counts.pages).toMatchObject({ created: 2 });
    const kiln = readFileSync(join(root, "src/content/blog/opening-the-new-kiln-room.md"), "utf8");

    expect(kiln).toContain("image: /images/kiln-room.png");
    expect(kiln).toContain("It’s the first “proper” kiln we’ve owned.");
    expect(kiln).toContain("[glaze notes](/blog/glaze-notes/)");
    const diary = readFileSync(join(root, "src/content/blog/studio-diary-spring-term.md"), "utf8");

    // The REST excerpt was generated ("[…]"), so the SEO description is used; the leftover shortcode stays visible.
    expect(diary).toContain("description: What we made, broke and learned in the spring term.");
    expect(diary).toContain("[newsletter_signup list=”spring”]");
    expect(diary).toContain("<!-- A form (“Contact form”) was here.");
    expect(diary).not.toContain("tracker.js");
    expect(report.rebuilds.map((rebuild) => rebuild.title)).toEqual(["Classes"]);
    expect(report.rebuilds[0]!.suggestions.map((s) => s.blockType)).toEqual(["hero", "features", "testimonial", "faq", "contact"]);
    expect(JSON.stringify(report.rebuilds)).not.toContain("/wp-content/uploads/2024/02/mara");
    expect(report.offeredTypes).toEqual([{ slug: "course", name: "Courses", count: 1 }]);
    expect(await site.validate()).toEqual([]);
  });
});
