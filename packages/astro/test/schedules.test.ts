import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { filterPublished, isPublished, parsePublishAt } from "../src/schedules/index.js";
import { readSiteContent } from "../src/visibility/content.js";
import { defaultSettings } from "../src/visibility/config.js";
import { readPage } from "../src/visibility/page.js";
import { planSite } from "../src/visibility/site.js";

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("@galleycms/astro/schedules", () => {
  it("filters future-dated and draft entries with isPublished and filterPublished", () => {
    const now = new Date("2026-12-01T12:00:00.000Z");

    expect(parsePublishAt("2026-12-01")).toBe(Date.parse("2026-12-01T00:00:00.000Z"));
    expect(parsePublishAt("invalid")).toBeNull();

    const entries = [
      { id: "live-no-date", data: { title: "Live" } },
      { id: "live-past", data: { title: "Past", publishAt: "2026-11-30T10:00:00Z" } },
      { id: "future-publishAt", data: { title: "Future 1", publishAt: "2026-12-02T09:00:00Z" } },
      { id: "future-scheduledAt", data: { title: "Future 2", scheduledAt: "2026-12-05" } },
      { id: "draft-past", data: { title: "Draft", draft: true, publishAt: "2026-11-01T00:00:00Z" } },
    ];

    expect(isPublished(entries[0]!, now)).toBe(true);
    expect(isPublished(entries[2]!, now)).toBe(false);
    expect(filterPublished(entries, now).map((e) => e.id)).toEqual(["live-no-date", "live-past"]);
  });

  it("omits future publishAt/scheduledAt content entries in readSiteContent", () => {
    const root = mkdtempSync(join(tmpdir(), "galley-astro-sched-"));
    dirs.push(root);
    const blog = join(root, "src/content/blog");
    mkdirSync(blog, { recursive: true });
    writeFileSync(join(blog, "live.md"), "---\ntitle: Live Post\npublishAt: 2020-01-01T00:00:00Z\n---\nHello.\n");
    writeFileSync(join(blog, "upcoming.md"), "---\ntitle: Upcoming Post\npublishAt: 2099-01-01T00:00:00Z\n---\nSoon.\n");
    writeFileSync(join(blog, "scheduled.md"), "---\ntitle: Scheduled Post\nscheduledAt: 2099-06-01\n---\nLater.\n");

    const content = readSiteContent(root);

    expect(content.drafts).not.toContain("/blog/live/");
    expect(content.drafts).toContain("/blog/upcoming/");
    expect(content.drafts).toContain("/blog/scheduled/");
  });

  it("excludes rendered pages carrying a future galley:publish-at meta tag from sitemap, llms.txt, and twins", () => {
    const liveHtml = '<!doctype html><html lang="en"><head><title>Live</title><meta name="description" content="Live page."></head><body><main><h1>Live</h1><p>Visible now.</p></main></body></html>';
    const futureHtml = '<!doctype html><html lang="en"><head><title>Upcoming</title><meta name="description" content="Future page."><meta name="galley:publish-at" content="2099-01-01T09:00:00Z"></head><body><main><h1>Upcoming</h1><p>Not live yet.</p></main></body></html>';

    const pages = [
      readPage(liveHtml, { path: "/", url: "https://example.com/" }),
      readPage(futureHtml, { path: "/upcoming/", url: "https://example.com/upcoming/" }),
    ];

    const planned = planSite({
      pages,
      settings: defaultSettings(),
      origin: "https://example.com",
      base: "",
      own: { robots: null, sitemap: null, llmsTxt: false, llmsFullTxt: false, agentPage: false },
      patterns: {},
      fileExists: () => false,
    });

    expect(planned.files["index.md"]).toBeTruthy();
    expect(planned.files["upcoming.md"]).toBeUndefined();
    expect(planned.files["sitemap.xml"]).toContain("https://example.com/");
    expect(planned.files["sitemap.xml"]).not.toContain("/upcoming/");
    expect(planned.files["llms.txt"]).not.toContain("/upcoming");
    expect(planned.files["llms-full.txt"]).not.toContain("Not live yet.");
  });
});
