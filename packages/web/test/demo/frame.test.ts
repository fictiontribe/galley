/** How the preview frame finds and redraws the working copy's changes on a built page. */
import { describe, expect, it } from "vitest";
import type { JsonValue } from "@galley/core/types";
import { blockKeyOf, inlineHtml, isImagePath, leafChanges, paragraphsOf, plainText, planFor, sectionsChanged } from "../../demo/frame/changes";
import { isIdentity, matchSections } from "../../demo/frame/sections";

describe("changes to draw", () => {
  it("lists every value that differs, down to the words", () => {
    const before: JsonValue = { title: "Home", sections: [{ type: "hero", heading: "A" }, { type: "cta", label: "Go" }] };
    const after: JsonValue = { title: "Home", sections: [{ type: "hero", heading: "B" }, { type: "cta", label: "Go" }] };
    expect(leafChanges(before, after)).toEqual([{ path: ["sections", 0, "heading"], before: "A", after: "B" }]);
    expect(leafChanges(before, before)).toEqual([]);
    expect(leafChanges({ tags: ["a"] }, { tags: ["a", "b"] })).toEqual([{ path: ["tags"], before: ["a"], after: ["a", "b"] }]);
  });

  it("reads words as the page shows them, and writes them as the site renders them", () => {
    expect(plainText("Coats for *the long afternoon*.")).toBe("Coats for the long afternoon.");
    expect(plainText("See [the lookbook](/collections/)  now")).toBe("See the lookbook now");
    expect(inlineHtml("Coats for *the <long>* afternoon")).toBe("Coats for <em>the &lt;long&gt;</em> afternoon");
    expect(inlineHtml("**Forty** of each, [ask](/contact/)")).toBe('<strong>Forty</strong> of each, <a href="/contact/">ask</a>');
    expect(paragraphsOf("One.\n\nTwo.\n  \nThree.")).toEqual(["One.", "Two.", "Three."]);
  });

  it("knows a section's marker, a picture and the page's own fields", () => {
    expect(blockKeyOf(["sections", 2, "heading"])).toBe("sections.2");
    expect(blockKeyOf(["title"])).toBeNull();
    expect(isImagePath("/images/pieces/gansey.webp")).toBe(true);
    expect(isImagePath("Gansey")).toBe(false);
    expect(planFor({ path: ["title"], before: "A", after: "B" }, true)).toEqual({ kind: "title", after: "B" });
    expect(planFor({ path: ["sections", 1, "image"], before: "/images/a.webp", after: "/images/b.webp" }, true)).toMatchObject({ kind: "image", scope: "sections.1" });
    expect(planFor({ path: ["sections", 1, "columns"], before: 3, after: 4 }, true)).toMatchObject({ kind: "none" });
    expect(planFor({ path: ["header", 0, "label"], before: "Atelier", after: "Workroom" }, false)).toMatchObject({ kind: "text", scope: null });
  });
});

describe("sections in a new order", () => {
  const hero: { [key: string]: JsonValue } = { type: "hero", heading: "A" };
  const quote: { [key: string]: JsonValue } = { type: "quote", quote: "Q" };
  const cta: { [key: string]: JsonValue } = { type: "cta", label: "Go" };

  it("leaves a page alone when nothing moved, even after an edit", () => {
    const match = matchSections([hero, quote], [{ ...hero, heading: "B" }, quote]);
    expect(match).toEqual([0, 1]);
    expect(isIdentity(match, 2)).toBe(true);
    expect(sectionsChanged([hero, quote], [{ ...hero, heading: "B" }, quote])).toBe(false);
  });

  it("follows a moved section, a removed one and an added one", () => {
    expect(matchSections([hero, quote, cta], [quote, hero, cta])).toEqual([1, 0, 2]);
    expect(matchSections([hero, quote, cta], [hero, cta])).toEqual([0, 2]);
    expect(matchSections([hero, cta], [hero, { type: "gallery" }, cta])).toEqual([0, null, 1]);
    expect(isIdentity([0, 2], 3)).toBe(false);
    expect(sectionsChanged([hero, quote], [quote, hero])).toBe(true);
  });

  it("follows a section that moved and was edited", () => {
    expect(matchSections([hero, quote, cta], [{ ...quote, quote: "R" }, hero, cta])).toEqual([1, 0, 2]);
  });
});
