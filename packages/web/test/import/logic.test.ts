import { describe, expect, it } from "vitest";
import type { ImportReportView, ImportRunStatus } from "@galley/core/types";
import { addressReady, costRange, exportFileProblem, inspectionFacts, nextSteps, reportHead, reportStanding, shortAddress, stepLine, toBase64, visibleSteps } from "@/features/import/logic";

const report = (patch: Partial<ImportReportView> = {}): ImportReportView => ({
  runId: "r",
  finishedAt: 0,
  stopped: false,
  source: { title: "Old", siteUrl: "https://old.example", kind: "address" },
  arrived: { posts: 41, pages: 9, images: 120, updated: 0, unchanged: 0, embeds: 0 },
  entries: [],
  needsLook: [],
  notImported: [],
  leftBehind: [],
  rebuilds: [],
  redirects: { count: 0, file: null, list: [] },
  seo: { descriptions: 0, descriptionsWritten: 0, titlesKept: 0, titlesNotKept: 0, canonicals: 0 },
  files: [],
  ...patch,
});

describe("the WordPress move's words and checks", () => {
  it("looks at an address only once it could be one", () => {
    expect(addressReady("exa")).toBe(false);
    expect(addressReady("example.com")).toBe(true);
    expect(addressReady("https://blog.example.org/news/")).toBe(true);
    expect(addressReady("127.0.0.1:4641")).toBe(true);
    expect(addressReady("http://localhost:8080")).toBe(true);
    expect(addressReady("my site.com")).toBe(false);
    expect(shortAddress("https://www.example.com/")).toBe("www.example.com");
  });

  it("says what the site has, with comments marked as staying behind", () => {
    const facts = inspectionFacts({ ok: true, kind: "address", title: "", siteUrl: "", counts: { posts: 312, pages: 1, media: null, comments: 4 }, signedIn: false, notes: [] });

    expect(facts).toEqual([
      { value: "312", label: "posts" },
      { value: "1", label: "page" },
      { value: "4", label: "comments — stay behind", muted: true },
    ]);
  });

  it("counts steps the way people read them", () => {
    expect(stepLine({ id: "posts", label: "Bringing over posts", state: "running", done: 41, total: 312 })).toBe("Bringing over posts — 41 of 312");
    expect(stepLine({ id: "read", label: "Reading the old site", state: "running" })).toBe("Reading the old site");
    const status = { state: "done", steps: [{ id: "read", label: "", state: "done" }, { id: "media", label: "", state: "skipped" }, { id: "pages", label: "", state: "done" }] } as unknown as ImportRunStatus;

    expect(visibleSteps(status).map((step) => step.id)).toEqual(["read"]);
  });

  it("lists the next steps in order, with only the ones this import needs", () => {
    expect(nextSteps(report()).map((step) => step.id)).toEqual(["proof", "online", "domain"]);
    const full = nextSteps(report({ redirects: { count: 412, file: "wordpress-import/_redirects", list: [] }, rebuilds: [{ title: "Home", path: "p.md", url: "/", originalUrl: "", builder: "Elementor", sections: 5, matched: 4 }] }));

    expect(full.map((step) => step.id)).toEqual(["proof", "rebuild", "redirects", "online", "domain"]);
    expect(full[0]!.body).toBe("50 entries and 120 images are waiting there. Nothing is live until you publish.");
    expect(full[2]!.body).toBe("So 412 old addresses keep working, and search engines follow them.");
    // Someone whose role doesn't publish reads who does.
    expect(nextSteps(report(), "an editor or owner publishes")[0]!.body).toBe("50 entries and 120 images are waiting there. Nothing is live until an editor or owner publishes.");
    // Rebuilding runs the assistant in build mode: someone whose role doesn't include it reads who does.
    const rebuilds = report({ rebuilds: [{ title: "Home", path: "p.md", url: "/", originalUrl: "", builder: "Elementor", sections: 5, matched: 4 }] });
    expect(nextSteps(rebuilds, "an editor or owner publishes", false).find((step) => step.id === "rebuild")?.body).toBe("1 page came across as plain text. An editor or owner can rebuild it with the assistant.");
    expect(reportHead(report(), "an editor or owner publishes").lede).toBe("Everything is a pending change: nothing is live until an editor or owner publishes.");
  });

  it("says so once what it brought isn't waiting any more, and offers to start again when it was all discarded", () => {
    // As a run hands it back, and while every entry is still pending: unchanged.
    expect(reportStanding(report())).toBe("waiting");
    expect(reportStanding(report({ standing: { pending: 17, published: 0, discarded: 0 } }))).toBe("waiting");

    const discarded = report({ standing: { pending: 0, published: 0, discarded: 17 } });
    expect(reportStanding(discarded)).toBe("discarded");
    expect(nextSteps(discarded).map((step) => step.id)).toEqual(["again"]);
    expect(reportHead(discarded)).toEqual({ title: "The import was discarded", lede: "Everything it brought was discarded in Proof, so none of it is waiting. Start again to bring your WordPress site over." });
    expect(nextSteps(discarded)[0]!.body).not.toMatch(/waiting there/);

    const published = report({ standing: { pending: 0, published: 17, discarded: 0 } });
    expect(nextSteps(published).map((step) => step.id)).toEqual(["published", "online", "domain"]);
    expect(nextSteps(published)[0]!.body).toBe("All 17 entries it brought are published.");
    expect(reportHead(published).lede).toBe("Everything it brought is published.");

    const settled = report({ standing: { pending: 0, published: 3, discarded: 14 } });
    expect(nextSteps(settled)[0]).toMatchObject({ id: "published", body: "Of what it brought, 3 published and 14 discarded." });
    expect(reportHead(settled).lede).toBe("None of it is waiting in Proof any more: 17 entries, 3 published and 14 discarded.");

    const some = report({ standing: { pending: 5, published: 0, discarded: 12 } });
    expect(nextSteps(some)[0]).toMatchObject({ id: "proof", body: "5 entries are still waiting there; 12 discarded." });
  });

  it("turns away files that can't be exports before sending them", () => {
    expect(exportFileProblem({ name: "site.WordPress.2026-11-23.xml", size: 10 })).toBeNull();
    expect(exportFileProblem({ name: "photo.jpg", size: 10 })).toMatch(/ends in \.xml/);
    expect(exportFileProblem({ name: "huge.xml", size: 300 * 1024 * 1024 })).toMatch(/over 200 MB/);
  });

  it("encodes a chunk the way the server decodes it", () => {
    const bytes = new TextEncoder().encode("<rss xmlns:wp=\"http://wordpress.org/export/1.2/\">é</rss>");

    expect(Buffer.from(toBase64(bytes), "base64").toString("utf8")).toBe("<rss xmlns:wp=\"http://wordpress.org/export/1.2/\">é</rss>");
  });

  it("shows the cost as a range", () => {
    expect(costRange({ low: 0.42, high: 1.6 })).toBe("about $0.42–$1.60");
    expect(costRange(null)).toBeNull();
  });
});
