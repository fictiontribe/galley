import { describe, expect, it } from "vitest";
import { bytes, collectionNouns, compactNumber, count, dirName, fileName, friendlyLabel, joinWords, money, plural, relativeTime, mediaFacts } from "../src/lib/format";

const NOW = new Date(2026, 10, 23, 15, 0, 0).getTime();

describe("relativeTime", () => {
  it("speaks in recent terms, then switches to a date after a week", () => {
    expect(relativeTime(NOW - 10_000, NOW)).toBe("just now");
    expect(relativeTime(NOW - 2 * 60_000, NOW)).toBe("2 min ago");
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3 h ago");
    expect(relativeTime(new Date(2026, 10, 22, 9, 0).getTime(), NOW)).toBe("yesterday");
    expect(relativeTime(NOW - 4 * 86_400_000, NOW)).toBe("4 days ago");
    expect(relativeTime(NOW - 30 * 86_400_000, NOW, "en-GB")).toMatch(/^24 Oct, \d\d:\d\d$/);
    expect(relativeTime(new Date(2025, 2, 12, 14, 5).getTime(), NOW, "en-GB")).toBe("12 Mar 2025, 14:05");
  });
});

describe("counts and plurals", () => {
  it("never says '1 changes'", () => {
    expect(count(1, "change")).toBe("1 change");
    expect(count(3, "change")).toBe("3 changes");
    expect(count(0, "change")).toBe("0 changes");
    expect(count(2, "team member")).toBe("2 team members");
    expect(count(2, "entry", "entries")).toBe("2 entries");
  });

  it("joins lists with an Oxford comma", () => {
    expect(joinWords(["Home page"])).toBe("Home page");
    expect(joinWords(["Home page", "About page"])).toBe("Home page and About page");
    expect(joinWords(["Home page", "About page", "one image"])).toBe("Home page, About page, and one image");
  });
});

describe("sizes and money", () => {
  it("formats bytes like a file browser", () => {
    expect(bytes(512)).toBe("512 B");
    expect(bytes(219_136)).toBe("214 KB");
    expect(bytes(1_677_722)).toBe("1.6 MB");
  });

  it("formats usage", () => {
    expect(money(null)).toBe("—");
    expect(money(0.004)).toBe("<$0.01");
    expect(money(12.3)).toBe("$12.30");
    expect(compactNumber(9_999)).toBe((9_999).toLocaleString());
    expect(compactNumber(46_200)).toBe("46.2 k");
    expect(compactNumber(2_800_000)).toBe("2.8 M");
  });
});

describe("paths", () => {
  it("splits and labels paths", () => {
    expect(fileName("src/content/pages/index.md")).toBe("index.md");
    expect(dirName("src/content/pages/index.md")).toBe("src/content/pages/");
    expect(dirName("index.md")).toBe("");
    expect(friendlyLabel("src/content/blog/living-through-a-renovation.md")).toBe("Living through a renovation");
    expect(friendlyLabel("src/content/pages/index.md")).toBe("Home");
    expect(friendlyLabel("galley.config.json")).toBe("Site settings");
  });
});

describe("mediaFacts", () => {
  it("reads like the specimen: dimensions, then size", () => {
    expect(mediaFacts({ size: 219_136, width: 1600, height: 900 })).toBe("1600 × 900 · 214 KB");
    expect(mediaFacts({ size: 2048 })).toBe("2 KB");
    expect(mediaFacts(undefined)).toBe("");
  });
});

describe("plurals", () => {
  it("follows English rules and keeps a noun's own capital", () => {
    expect(plural("story")).toBe("stories");
    expect(plural("day")).toBe("days");
    expect(plural("box")).toBe("boxes");
    expect(plural("branch")).toBe("branches");
    expect(plural("person")).toBe("people");
    expect(plural("team member")).toBe("team members");
    expect(plural("Product story")).toBe("Product stories");
    expect(plural("news")).toBe("news");
    expect(plural("FAQ")).toBe("FAQs");
  });

  it("counts with the singular for one and the plural otherwise", () => {
    expect(count(1, "story")).toBe("1 story");
    expect(count(4, "story")).toBe("4 stories");
    expect(count(0, "line")).toBe("0 lines");
    expect(count(2, "thing to check", "things to check")).toBe("2 things to check");
  });

  it("takes a collection's plural from its own label when the label is one", () => {
    expect(collectionNouns({ label: "Stories", singular: "story" })).toEqual({ one: "story", many: "stories" });
    expect(collectionNouns({ label: "Product stories", singular: "product story" })).toEqual({ one: "product story", many: "product stories" });
    expect(collectionNouns({ label: "People", singular: "person" })).toEqual({ one: "person", many: "people" });
    // A label that names the collection rather than counting its entries leaves the plural to the rules.
    expect(collectionNouns({ label: "Journal", singular: "post" })).toEqual({ one: "post", many: "posts" });
    expect(collectionNouns({ label: "Team", singular: "team member" })).toEqual({ one: "team member", many: "team members" });
  });

  it("writes sizes with proper unit symbols", () => {
    expect(bytes(10 * 1024 * 1024)).toBe("10 MB");
  });
});
