import { describe, expect, it } from "vitest";
import type { Field, JsonValue, ResolveResult, SourceMatch } from "@galley/core/types";
import { actionFor, actionForMatch, editFor, fieldPathLabel, findImageFields, matchLabel, placedFieldLabel, plainFieldLabel } from "../../src/features/preview/clickToEdit";
import { addressToPath, canGo, frameUrl, go, pagePath, parseOverlayMessage, startHistory, visit } from "../../src/features/preview/frames";

const field = (patch: Partial<SourceMatch> = {}): SourceMatch => ({
  path: "src/content/pages/index.md",
  title: "Home page",
  location: { kind: "field", field: ["sections", 0, "heading"], label: "Hero › Heading" },
  value: "Make more of the home you already have.",
  plain: true,
  editable: true,
  ...patch,
});

describe("resolve result → what the person can do", () => {
  it("unique, plain and editable: retype in place", () => {
    const match = field();
    expect(actionFor({ status: "unique", matches: [match] })).toEqual({ kind: "in-place", match });
  });

  it("unique but stored with formatting: edit as stored", () => {
    const match = field({ value: "Make more of the *home you already have*.", plain: false });
    expect(actionFor({ status: "unique", matches: [match] })).toEqual({ kind: "stored", match });
  });

  it("several places: choose", () => {
    const result: ResolveResult = { status: "ambiguous", matches: [field(), field({ path: "src/data/site.json", title: undefined })], reason: "This text appears 2 times." };
    expect(actionFor(result)).toMatchObject({ kind: "choose", reason: "This text appears 2 times." });
  });

  it("not content, or only in the site's code: part of the design", () => {
    expect(actionFor({ status: "none", matches: [], reason: "This text isn't in any content file." })).toMatchObject({ kind: "design", reason: expect.stringContaining("part of the site’s design") });
    expect(actionFor({ status: "none", matches: [], reason: "This text appears in 40 places, which is too many to tell which one this is." })).toMatchObject({ reason: expect.stringContaining("too many") });
    expect(actionFor({ status: "none", matches: [], reason: "The selected text is too short to find reliably." })).toEqual({ kind: "design", reason: "The selected text is too short to find reliably." });
    expect(actionForMatch(field({ location: { kind: "source", line: 3, column: 4 }, editable: false }))).toMatchObject({ kind: "design" });
  });

  it("writes exactly where the resolver said, and nowhere else", () => {
    expect(editFor(field(), "New heading")).toEqual({ path: "src/content/pages/index.md", ops: [{ op: "set", path: ["sections", 0, "heading"], value: "New heading" }] });
    const body = field({ location: { kind: "body", start: 10, end: 30, block: "p2" }, value: "Old paragraph." });
    expect(editFor(body, "New paragraph.")).toEqual({ path: "src/content/pages/index.md", ops: [{ op: "body-replace", find: "Old paragraph.", replace: "New paragraph." }] });
    const settings = field({ path: "src/data/site.json", location: { kind: "field", field: ["tagline"], label: "Tagline" } });
    expect(editFor(settings, "x")?.path).toBe("src/data/site.json");
    expect(editFor(field({ location: { kind: "source", line: 1, column: 1 } }), "x")).toBeNull();
  });

  it("labels each candidate in plain terms", () => {
    expect(matchLabel(field())).toBe("Home page › Hero › Heading");
    expect(matchLabel(field({ title: undefined, path: "src/data/site.json", location: { kind: "field", field: ["tagline"], label: "Tagline" } }), "Site settings")).toBe("Site settings › Tagline");
    expect(matchLabel(field({ location: { kind: "body", start: 0, end: 1, block: "p1" } }))).toBe("Home page › Body text");
    const long = field({ title: "Harbour Dental — architecture for the homes people already love", location: { kind: "field", field: ["sections", 0, "heading"], label: "Sections › 1 (Hero) › Heading" } });
    expect(matchLabel(long)).toBe("Home page › Hero › Heading");
    expect(matchLabel({ ...long, path: "src/content/pages/about.md", title: "About the studio — Harbour" })).toBe("About the studio › Hero › Heading");
    expect(plainFieldLabel("Sections › 3 (Features) › Items › 2 (Item) › Heading")).toBe("Features › Item › Heading");
  });

  it("says where each of two alike matches is, when asking which one", () => {
    const first = field({ location: { kind: "field", field: ["sections", 1, "cta", "label"], label: "Sections › 2 (Features) › Button label" } });
    const second = field({ location: { kind: "field", field: ["sections", 4, "cta", "label"], label: "Sections › 5 (Features) › Button label" } });

    expect(matchLabel(first)).toBe(matchLabel(second));
    expect(matchLabel(first, undefined, { places: true })).toBe("Home page › Features (section 2) › Button label");
    expect(matchLabel(second, undefined, { places: true })).toBe("Home page › Features (section 5) › Button label");
    expect(placedFieldLabel("Sections › 3 (Features) › Items › 2 (Item) › Heading")).toBe("Features (section 3) › Item 2 › Heading");
  });
});

describe("images", () => {
  const data: { [key: string]: JsonValue } = { sections: [{ type: "hero", image: "/images/projects/hero-house.svg" }, { type: "logos", items: [{ image: "/images/logos/a.svg" }] }], image: "/images/projects/hero-house.svg" };

  it("finds only exact uses of the image's address", () => {
    expect(findImageFields(data, "/images/projects/hero-house.svg")).toEqual([["sections", 0, "image"], ["image"]]);
    expect(findImageFields(data, "/images/logos/a.svg")).toEqual([["sections", 1, "items", 0, "image"]]);
    expect(findImageFields(data, "/images/elsewhere.svg")).toEqual([]);
    expect(findImageFields({ cover: "/src/assets/a.png" }, "/_image?href=%2Fsrc%2Fassets%2Fa.png&w=800")).toEqual([["cover"]]);
  });

  it("names a field path in the form's words", () => {
    const fields: Field[] = [
      {
        key: "sections",
        label: "Sections",
        type: "blocks",
        required: false,
        source: "inferred",
        discriminator: "type",
        blocks: [{ type: "hero", label: "Hero", count: 1, fields: [{ key: "image", label: "Image", type: "image", required: false, source: "inferred" }] }],
      },
    ];
    expect(fieldPathLabel(fields, data, ["sections", 0, "image"])).toBe("Sections › Hero › Image");
    expect(fieldPathLabel(fields, data, ["sections", 1, "items", 0, "image"])).toBe("Sections › Logos › Items › Item 1 › Image");
  });
});

describe("overlay messages", () => {
  it("accepts only well-formed messages", () => {
    expect(parseOverlayMessage({ galley: 1, type: "navigate", path: "/about/", title: "About" })).toEqual({ galley: 1, type: "navigate", path: "/about/", title: "About" });
    expect(parseOverlayMessage({ galley: 1, type: "select", text: "Hi", tag: "h1", occurrence: 0, total: 1, rect: { x: 1, y: 2, width: 3, height: 4 } })).not.toBeNull();
    expect(parseOverlayMessage({ galley: 1, type: "select", text: "Hi", tag: "h1", occurrence: 0, total: 1 })).toBeNull();
    expect(parseOverlayMessage({ galley: 1, type: "navigate", path: "https://evil.example/", title: "" })).toBeNull();
    expect(parseOverlayMessage({ galley: 1, type: "navigate", path: "//evil.example/", title: "" })).toBeNull();
    expect(parseOverlayMessage({ galley: 1, type: "edit", text: "a", newText: "b", occurrence: -1, total: 1 })).toBeNull();
    expect(parseOverlayMessage({ type: "ready", path: "/", title: "" })).toBeNull();
    expect(parseOverlayMessage("ready")).toBeNull();
  });
});

describe("addresses", () => {
  const origins = ["http://127.0.0.1:4611", null];

  it("takes paths, or full addresses on the preview's own origin", () => {
    expect(addressToPath("pricing/", origins)).toBe("/pricing/");
    expect(addressToPath(" /blog/?page=2#top ", origins)).toBe("/blog/?page=2#top");
    expect(addressToPath("http://127.0.0.1:4611/about/", origins)).toBe("/about/");
    expect(addressToPath("https://example.com/", origins)).toBeNull();
    expect(addressToPath("javascript:alert(1)", origins)).toBeNull();
    expect(addressToPath("//example.com/", origins)).toBeNull();
    expect(addressToPath("", origins)).toBeNull();
  });

  it("builds frame addresses and page paths", () => {
    expect(frameUrl("http://127.0.0.1:4611/", "/about/")).toBe("http://127.0.0.1:4611/about/");
    expect(pagePath("/about/?x=1#team")).toBe("/about/");
    expect(pagePath("#top")).toBe("/");
  });
});

describe("the preview's own history", () => {
  it("records visits, goes back and forward, and drops the forward trail on a new visit", () => {
    let history = startHistory("/");
    history = visit(history, "/about/");
    history = visit(history, "/about/");
    history = visit(history, "/team/");
    expect(history.entries).toEqual(["/", "/about/", "/team/"]);
    expect(canGo(history, 1)).toBe(false);

    const back = go(history, -1);
    expect(back?.path).toBe("/about/");
    history = visit(back!.history, "/about/");
    expect(history.index).toBe(1);
    expect(canGo(history, 1)).toBe(true);

    history = visit(history, "/contact/");
    expect(history.entries).toEqual(["/", "/about/", "/contact/"]);
    expect(go(startHistory("/"), -1)).toBeNull();
  });
});

describe("the protocol additions", () => {
  it("reads an explicit cancel from the overlay", () => {
    expect(parseOverlayMessage({ galley: 1, type: "edit-cancelled", text: "Hi", occurrence: 0 })).toEqual({ galley: 1, type: "edit-cancelled", text: "Hi", occurrence: 0 });
    expect(parseOverlayMessage({ galley: 1, type: "edit-cancelled", text: "Hi", occurrence: -1 })).toBeNull();
  });

  it("turns the accent in use into a hex colour for the overlay", async () => {
    const { toHex } = await import("../../src/features/preview/frames");
    expect(toHex("#2e2bff")).toBe("#2E2BFF");
    expect(toHex(" rgb(46, 43, 255) ")).toBe("#2E2BFF");
    expect(toHex("oklch(0.5 0.2 270)")).toBeNull();
  });
});
