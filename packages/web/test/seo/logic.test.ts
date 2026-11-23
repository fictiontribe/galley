import { describe, expect, it } from "vitest";
import { finding } from "@galley/core/seo";
import { batchesFor, kindLabel, pageName, sampleWords, sourceOwner, WRITE_LABEL } from "@/features/seo/logic";

describe("Search & AI copy", () => {
  it("says how many rendered pages were checked in good grammar", () => {
    expect(sampleWords({ sampled: 1, total: 14 })).toBe("1 of 14 pages was checked as sent.");
    expect(sampleWords({ sampled: 3, total: 14 })).toBe("3 of 14 pages were checked as sent.");
    expect(sampleWords({ sampled: 14, total: 14 })).toBe("");
  });

  it("names who documents a finding, and marks judgements as such", () => {
    const documented = finding("title-duplicate", { path: "a.md", url: "/a/", pageTitle: "About" });
    const judged = finding("thin-page", { path: "a.md", url: "/a/" });
    const measured = finding("link-broken", { path: "a.md", url: "/a/" });

    expect(sourceOwner(documented)).toBe("Google");
    expect(kindLabel(documented)).toBe("Documented by Google");
    expect(kindLabel(judged)).toBe("A judgement, not proven");
    expect(kindLabel(measured)).toBe("Measured");
    expect(kindLabel(finding("image-alt-filename", { path: "a.md" }))).toBe("Documented by W3C");
    expect(pageName(documented)).toBe("About");
    expect(pageName(finding("sitemap-missing", {}))).toBeNull();
  });

  it("offers a batch only when more than one page can be written, with the count in the button", () => {
    const one = finding("description-missing", { path: "a.md", field: ["description"], write: "description" });
    const two = finding("description-missing", { path: "b.md", field: ["description"], write: "description" });
    const fixable = { ...finding("noindex-important", { path: "c.md" }), fix: { label: "Let search engines show it", edits: [] } };

    expect(batchesFor([one]).writes).toEqual([]);
    expect(batchesFor([one, two, fixable])).toEqual({ writes: [{ kind: "description", count: 2 }], fixes: [fixable] });
    expect(WRITE_LABEL.description.many(14)).toBe("Write the 14 missing descriptions");
    expect(WRITE_LABEL.alt.many(1)).toBe("Write alt text for 1 image");
  });
});
