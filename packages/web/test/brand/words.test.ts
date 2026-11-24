import { describe, expect, it } from "vitest";
import { bytes, contrastWords, evidenceWords, inkFor, pairWords, plan, quotePlace, whereFrom, whereKept } from "../../src/features/brand/words";

describe("the Brand screen's words", () => {
  it("names a contrast pair once, not “Text on accent on accent”", () => {
    expect(pairWords("text", "background")).toBe("Text on background");
    expect(pairWords("accent-text", "accent")).toBe("Text on accent");
    expect(pairWords("inverse-text", "inverse-background")).toBe("Text on dark");
    expect(pairWords("accent-text", "background")).toBe("The accent’s text colour on background");
  });

  it("says contrast in plain words", () => {
    expect(contrastWords("aaa")).toBe("Easy to read");
    expect(contrastWords("aa")).toBe("Easy to read");
    expect(contrastWords("large")).toBe("Large text only");
    expect(contrastWords("fail")).toBe("Hard to read");
  });

  it("says where a value came from the way people say it", () => {
    expect(evidenceWords({ kind: "source", sourceName: "Guidelines.pdf", sourcePage: 14 })).toBe("page 14 of Guidelines.pdf");
    expect(evidenceWords({ kind: "page", page: "/pricing/" })).toBe("measured on /pricing/");
    expect(evidenceWords({ kind: "file", file: "src/styles/tokens.css", line: 12 })).toBe("tokens.css:12");
    expect(whereFrom([{ kind: "page", page: "/" }, { kind: "file", file: "src/styles/tokens.css", line: 44 }])).toBe("measured on the home page and tokens.css:44");
    expect(whereFrom([{ kind: "page", page: "/" }, { kind: "page", page: "/a/" }, { kind: "page", page: "/b/" }])).toBe("measured on the home page and 2 more");
  });

  it("says what will be done with each file before it is read", () => {
    expect(plan({ type: "pdf", pages: 12 })).toBe("Read page by page (12 pages): colours, fonts and the rules it gives.");
    expect(plan({ type: "svg" })).toMatch(/Never run/);
    expect(plan({ type: "pdf", limited: "Too long to read in full." })).toBe("Too long to read in full.");
    expect(bytes(60 * 1024 * 1024)).toBe("60 MB");
  });

  it("says where a piece of material is, true before and after saving", () => {
    const settings = { dir: "galley/brand", largeFileBytes: 20 * 1024 * 1024 };
    const logo = { type: "svg" as const, bytes: 4_000, stored: "outside" as const };

    // Added, not saved: a small file waits outside and goes into the site on save.
    expect(whereKept(logo, true, settings)).toBe("goes into the site (galley/brand/sources/) when you save");
    // Saved: it is in the site, at its path.
    expect(whereKept({ ...logo, stored: "site", file: "galley/brand/sources/logo.svg" }, false, settings)).toBe("in the site, galley/brand/sources/logo.svg");
    // Too large, or a web page read for its styles: outside, before and after.
    expect(whereKept({ type: "pdf", bytes: 60 * 1024 * 1024, stored: "outside" }, true, settings)).toBe("kept outside the site");
    expect(whereKept({ type: "pdf", bytes: 60 * 1024 * 1024, stored: "outside" }, false, settings)).toBe("kept outside the site");
    expect(whereKept({ type: "website", bytes: 9_000, stored: "outside" }, true, settings)).toBe("kept outside the site");
  });

  it("names the page a voice example was taken from, never a bare address", () => {
    expect(quotePlace("/")).toBe("Home page");
    expect(quotePlace("/", { path: "src/content/pages/index.md", title: "Caddow — coats and knitwear, made in runs of forty" })).toBe("Home page");
    expect(quotePlace("/atelier/", { path: "src/content/pages/atelier.md", title: "Atelier" })).toBe("Atelier");
    // An address no entry answers to, or a source's name, reads as written.
    expect(quotePlace("/old/")).toBe("/old/");
    expect(quotePlace("Brand guidelines, page 4")).toBe("Brand guidelines, page 4");
  });

  it("picks ink that reads on a swatch", () => {
    expect(inkFor("#F6F1E7")).toBe("#141210");
    expect(inkFor("#1A1712")).toBe("#FAF7F0");
    // A mid-dark text colour (a lightness cut-off gave it dark ink): whichever ink has more contrast wins.
    expect(inkFor("#5E5143")).toBe("#FAF7F0");
    expect(inkFor("#2E2BFF")).toBe("#FAF7F0");
    expect(inkFor("#FFE45C")).toBe("#141210");
    expect(inkFor("#2E2BFF")).toBe("#FAF7F0");
  });
});
