import { describe, expect, it } from "vitest";
import { finding } from "@galley/core/seo";
import { batchesFor, crawlerChangeWords, kindLabel, pageName, rebaseChoices, sampleWords, sourceOwner, WRITE_LABEL } from "@/features/seo/logic";

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

  it("names a finding's page as the rest of the app does: Home page, a data file's own name, never a path", () => {
    const stockists = { label: "Stockists", kind: "data" as const, path: "src/data/stockists.json" };

    expect(pageName(finding("link-broken", { path: "src/content/pages/index.md", url: "/", pageTitle: "Caddow — coats and knitwear, made in runs of forty" }))).toBe("Home page");
    expect(pageName(finding("link-broken", { path: "src/data/stockists.json" }), [stockists])).toBe("Stockists");
    expect(pageName(finding("link-broken", { path: "src/data/stockists.json" }))).toBe("Stockists");
    expect(pageName(finding("title-long", { path: "src/content/pages/atelier.md", url: "/atelier/", pageTitle: "The atelier — where the coats are cut" }))).toBe("The atelier");
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

describe("crawler choices waiting to be confirmed", () => {
  it("says how many rules will change and to what, for the bar beside the switches", () => {
    expect(crawlerChangeWords([])).toBeNull();
    expect(crawlerChangeWords([{ label: "Anthropic's training crawler", to: "block" }])).toEqual({
      title: "1 rule will change",
      detail: "Block Anthropic's training crawler. Nothing changes until you confirm.",
      confirm: "Change 1 rule",
    });
    const many = crawlerChangeWords([
      { label: "OpenAI's training crawler", to: "block" },
      { label: "Anthropic's training crawler", to: "block" },
      { label: "Common Crawl's crawler", to: "allow" },
    ]);
    expect(many?.title).toBe("3 rules will change");
    expect(many?.detail).toBe("Block OpenAI's training crawler and Anthropic's training crawler; allow Common Crawl's crawler. Nothing changes until you confirm.");
    expect(many?.confirm).toBe("Change 3 rules");
  });

  it("keeps a choice not yet confirmed when the audit is read again", () => {
    const saved = { GPTBot: "allow", ClaudeBot: "allow", CCBot: "allow" } as const;
    const draft = { ...saved, ClaudeBot: "block" as const };
    // The audit reran after a fix elsewhere; nothing about crawlers changed.
    expect(rebaseChoices(draft, saved, { ...saved })).toEqual(draft);
    // The saved rules changed underneath (another tab blocked CCBot): that comes through, the pending choice stays.
    expect(rebaseChoices(draft, saved, { ...saved, CCBot: "block" })).toEqual({ GPTBot: "allow", ClaudeBot: "block", CCBot: "block" });
    // Saved as chosen: it simply stops being a change.
    expect(rebaseChoices(draft, saved, { ...saved, ClaudeBot: "block" })).toEqual({ ...saved, ClaudeBot: "block" });
  });
});
