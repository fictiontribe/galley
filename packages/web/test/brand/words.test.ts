import { describe, expect, it } from "vitest";
import { bytes, contrastWords, evidenceWords, inkFor, plan, whereFrom } from "../../src/features/brand/words";

describe("the Brand screen's words", () => {
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
