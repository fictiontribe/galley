import { describe, expect, it } from "vitest";
import { DEFAULT_PAGES, MAX_PAGES, addPage, briefMessage, emptyDraft, stepProblem, toBrief } from "../../src/features/wizard/brief";

describe("the new-site brief", () => {
  it("starts with sensible defaults", () => {
    const draft = emptyDraft("astro-starter");
    expect(draft.pages).toEqual(DEFAULT_PAGES);
    expect(draft.starter).toBe("astro-starter");
    expect(draft.brandColor).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it("checks each step before moving on, in plain words", () => {
    const draft = emptyDraft("astro-starter");
    expect(stepProblem("name", draft)).toBe("Give the site a name with at least one letter or number.");
    expect(stepProblem("name", { ...draft, name: "Harbour" })).toBeNull();
    expect(stepProblem("about", { ...draft, description: "Shop" })).toBe("Say what the organisation is and does in a sentence or two.");
    expect(stepProblem("style", { ...draft, brandColor: "green" })).toBe("The brand colour should be a hex value like #2F5D50.");
    expect(stepProblem("style", { ...draft, pages: [] })).toBe("Add at least one page.");
    expect(stepProblem("create", { ...draft, name: "Harbour" })).toBe("Say what the organisation is and does in a sentence or two.");
  });

  it("adds pages without duplicates or past the limit", () => {
    expect(addPage(["Home"], "  pricing  ")).toEqual(["Home", "Pricing"]);
    expect(addPage(["Home"], "home")).toEqual(["Home"]);
    expect(addPage(["Home"], "   ")).toEqual(["Home"]);
    const full = Array.from({ length: MAX_PAGES }, (_, i) => `Page ${i}`);
    expect(addPage(full, "One more")).toBe(full);
  });

  it("becomes the brief the assistant receives, empty answers left out", () => {
    const brief = toBrief({ ...emptyDraft("s"), name: "Harbour", description: "  An architecture studio.  ", tone: "Warm and plain", brandColor: "#2f5d50" });
    expect(brief).toEqual({ description: "An architecture studio.", tone: "Warm and plain", pages: DEFAULT_PAGES, brandColor: "#2f5d50" });
    expect(toBrief({ ...emptyDraft("s"), description: "x", brandColor: "nope" }).brandColor).toBeUndefined();
    expect(briefMessage(brief)).toBe("Build the site from my brief: Home, About, Services, and Contact.");
    expect(briefMessage({ description: "x" })).toBe("Build the site from my brief.");
  });
});
