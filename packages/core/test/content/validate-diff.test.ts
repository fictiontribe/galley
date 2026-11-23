import { describe, expect, it } from "vitest";

import { buildContentIndex, buildEntry, detectSite, diffFields, labelForKey, summarizeChange, validateEntry } from "../../src/content/index";
import type { ValidationContext } from "../../src/content/index";
import { ASTRO } from "./helpers";

const model = await detectSite(ASTRO);
const index = await buildContentIndex(ASTRO, model);
const ctx: ValidationContext = {
  mediaExists: (url) => url === "/images/hero.png",
  routeExists: (url) => index.routeExists(url),
};
const pages = model.collections.find((collection) => collection.id === "pages")!;

function issuesFor(path: string, raw: string) {
  return validateEntry(model, buildEntry(model, path, raw, { mtimeMs: 0 }), ctx);
}

describe("validateEntry", () => {
  it("passes a well-formed entry", () => {
    expect(issuesFor("src/content/blog/ok.md", "---\ntitle: Fine\npubDate: 2026-01-01\nauthor: ana\nstatus: live\n---\n\nSee [the guide](/guides/tides/).\n")).toEqual([]);
  });

  it("reports schema problems as errors: required, types, enums, dates", () => {
    const issues = issuesFor("src/content/blog/bad.md", "---\npubDate: someday\nauthor: ana\nstatus: published\ndraft: maybe\n---\n");

    expect(issues.map((issue) => [issue.severity, issue.code, issue.field])).toEqual([
      ["error", "required", ["title"]],
      ["error", "date", ["pubDate"]],
      ["error", "enum", ["status"]],
      ["error", "type", ["draft"]],
    ]);
    expect(issues[2]?.message).toBe("“Status” is “published”, which isn't one of: draft, review, live.");
  });

  it("warns about images that aren't in the media folders and links that match no page", () => {
    const issues = validateEntry(model, buildEntry(model, "src/content/pages/about.md", "---\ntitle: About\nsections:\n  - type: hero\n    heading: Hi\n    image: /images/missing.png\n  - type: cta\n    label: Go\n    link: /nowhere/\n---\n\n![Photo](/images/gone.jpg) and [a link](/also-nowhere/#part) and [ok](/about/).\n", { mtimeMs: 0 }), ctx);

    expect(issues.map((issue) => [issue.severity, issue.code, issue.field ?? null])).toEqual([
      ["warning", "broken-image", ["sections", 0, "image"]],
      ["warning", "broken-link", ["sections", 1, "link"]],
      ["warning", "broken-image", null],
      ["warning", "broken-link", null],
    ]);
    expect(issues[1]?.message).toBe("The link to /nowhere/ in “Sections › 2 (CTA) › Link” doesn't match any page on the site.");
  });

  it("flags unknown block types and treats inferred rules as warnings", () => {
    const issues = issuesFor("src/content/pages/x.md", "---\ntitle: X\nsections:\n  - type: carousel\n    slides: []\n  - type: hero\n---\n");

    expect(issues.map((issue) => [issue.severity, issue.code, issue.field])).toEqual([
      ["error", "unknown-block", ["sections", 0]],
      // Every hero in the files has a heading and an image, so inference expects them — as warnings.
      ["warning", "required", ["sections", 1, "heading"]],
      ["warning", "required", ["sections", 1, "image"]],
    ]);
  });

  it("keeps unknown extra keys as warnings, never errors", () => {
    const issues = issuesFor("src/content/blog/extra.md", "---\ntitle: X\npubDate: 2026-01-01\nauthor: ana\nlegacyId: 42\n---\n");

    expect(issues).toEqual([expect.objectContaining({ severity: "warning", code: "unknown-field", field: ["legacyId"] })]);
  });
});

describe("diffFields", () => {
  type Section = { type: string; heading?: string; title?: string; label?: string; items?: Array<{ label: string }> };
  const before: { title: string; tags: string[]; hero: { heading: string }; sections: Section[] } = {
    title: "About",
    tags: ["a"],
    hero: { heading: "Old" },
    sections: [
      { type: "hero", heading: "Hi" },
      { type: "feature-grid", title: "What we do", items: [{ label: "Keep watch" }] },
    ],
  };

  it("labels changes the way the form does, in the form's field order", () => {
    const after = structuredClone(before);

    after.hero.heading = "New";
    after.sections[1]!.title = "What we really do";
    after.sections[1]!.items![0]!.label = "Keep a watch";
    after.tags = ["a", "b"];
    const changes = diffFields(pages, before, after);

    expect(changes.map((change) => [change.label, change.kind])).toEqual([
      ["Sections › 2 (Feature grid) › Title", "changed"],
      ["Sections › 2 (Feature grid) › Items › 1 › Label", "changed"],
      ["Tags", "changed"],
      ["Hero › Heading", "changed"],
    ]);
    expect(changes[3]).toMatchObject({ field: ["hero", "heading"], before: "Old", after: "New" });
  });

  it("reads an inserted section as one added section, not a cascade of changes", () => {
    const after = { ...before, sections: [before.sections[0]!, { type: "cta", label: "Go" }, before.sections[1]!] };

    expect(diffFields(pages, before, after)).toEqual([{ field: ["sections", 1], label: "Sections › 2 (CTA)", kind: "added", after: { type: "cta", label: "Go" } }]);
  });

  it("reports added and removed keys, and whole-file additions", () => {
    const { tags: _tags, ...withoutTags } = before;

    expect(diffFields(pages, before, { ...withoutTags, description: "New" }).map((change) => [change.label, change.kind])).toEqual([
      ["Description", "added"],
      ["Tags", "removed"],
    ]);
    expect(diffFields(null, null, { metaTitle: "x" })).toEqual([{ field: ["metaTitle"], label: "Meta title", kind: "added", after: "x" }]);
    expect(diffFields(pages, before, structuredClone(before))).toEqual([]);
  });
});

describe("summarizeChange", () => {
  const change = (label: string, kind: "added" | "removed" | "changed" = "changed") => ({ field: [label], label, kind });

  it("says what changed in one plain sentence", () => {
    expect(summarizeChange({ status: "modified", fieldChanges: [change("Hero › Heading"), change("Title"), change("Tags")], bodyChanged: false })).toBe("Changed the heading and 2 other fields.");
    expect(summarizeChange({ status: "modified", fieldChanges: [change("SEO title")], bodyChanged: true })).toBe("Changed the SEO title and edited the main text.");
    expect(summarizeChange({ status: "modified", fieldChanges: [], bodyChanged: true })).toBe("Edited the main text.");
    expect(summarizeChange({ status: "modified", fieldChanges: [change("Sections › 3 (Feature grid)", "added")], bodyChanged: false })).toBe("Added the feature grid in sections.");
    expect(summarizeChange({ status: "added", title: "Night watch", singular: "blog post", fieldChanges: [], bodyChanged: false })).toBe("Added the blog post “Night watch”.");
    expect(summarizeChange({ status: "deleted", title: "Old page", singular: "page", fieldChanges: [], bodyChanged: false })).toBe("Deleted the page “Old page”.");
    expect(summarizeChange({ status: "modified", fieldChanges: [], bodyChanged: false })).toBe("Made formatting changes only.");
  });
});

describe("labelForKey", () => {
  it("turns keys into plain labels", () => {
    expect(["metaTitle", "hero_image", "seo-description", "ogImage", "pubDate", "_component", "id", "heroCTAText", "url"].map(labelForKey)).toEqual([
      "Meta title",
      "Hero image",
      "SEO description",
      "OG image",
      "Pub date",
      "Component",
      "ID",
      "Hero CTA text",
      "URL",
    ]);
  });
});
