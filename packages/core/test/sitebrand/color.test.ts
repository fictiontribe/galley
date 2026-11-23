import { describe, expect, it } from "vitest";
import { contrastRatio, contrastResult, deltaE, formatLike, isNeutral, normalizeColor, parseColor } from "../../src/sitebrand/color";

describe("colour parsing", () => {
  it("reads what sites write and browsers report", () => {
    expect(normalizeColor("#fff")).toBe("#FFFFFF");
    expect(normalizeColor("#1a1712")).toBe("#1A1712");
    expect(normalizeColor("rgb(246, 241, 231)")).toBe("#F6F1E7");
    expect(normalizeColor("rgb(246 241 231 / 50%)")).toBe("#F6F1E780");
    expect(normalizeColor("rgba(0,0,0,0.5)")).toBe("#00000080");
    expect(normalizeColor("hsl(0 100% 50%)")).toBe("#FF0000");
    expect(normalizeColor("color(srgb 1 0 0)")).toBe("#FF0000");
    expect(normalizeColor("white")).toBe("#FFFFFF");
  });

  it("converts oklch the way browsers do (the SaaS starter's accent and ground)", () => {
    // Reference values from Chrome's computed style for these declarations.
    expect(normalizeColor("oklch(54.5% 0.19 39)")).toBe("#C53500");
    expect(normalizeColor("oklch(98.3% 0.004 85)")).toBe("#FBF9F6");
    expect(normalizeColor("oklch(0.21 0.022 258)")).toBe(normalizeColor("oklch(21% 0.022 258)"));
  });

  it("never guesses: var(), color-mix(), lab() and unknown names come back null", () => {
    for (const value of ["var(--accent)", "color-mix(in oklch, red, blue)", "lab(50% 20 30)", "rebeccapurple-ish", "oklch(from var(--a) l c h)", "#12345"]) expect(parseColor(value)).toBeNull();
  });
});

describe("contrast", () => {
  it("is WCAG 2.x relative luminance", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBe(21);
    expect(contrastRatio("#777777", "#FFFFFF")).toBe(4.48);
    expect(contrastRatio("#1A1712", "#F6F1E7")).toBe(15.87);
    expect(contrastRatio("#FFFFFF", "#2E2BFF")).toBeGreaterThan(6);
  });

  it("composites translucent text over its ground", () => {
    expect(contrastRatio("#00000080", "#FFFFFF")).toBe(contrastRatio("#7F7F7F", "#FFFFFF"));
  });

  it("names the result in WCAG's bands", () => {
    expect(contrastResult(7.2)).toBe("aaa");
    expect(contrastResult(4.6)).toBe("aa");
    expect(contrastResult(3.2)).toBe("large");
    expect(contrastResult(2.9)).toBe("fail");
  });
});

describe("closeness and notation", () => {
  it("ΔE tells near-copies from different colours", () => {
    expect(deltaE("#F5F5F5", "#F6F6F6")).toBeLessThan(1);
    expect(deltaE("#F6F1E7", "#2E2BFF")).toBeGreaterThan(50);
    expect(isNeutral("#6B6356")).toBe(true);
    expect(isNeutral("#2E2BFF")).toBe(false);
  });

  it("writes a value in the file's own notation, round-tripping exactly", () => {
    const oklch = formatLike("#F6F1E7", "oklch(97.4% 0.009 84)");

    expect(oklch.startsWith("oklch(")).toBe(true);
    expect(normalizeColor(oklch)).toBe("#F6F1E7");
    expect(formatLike("#2E2BFF", "#ff0000")).toBe("#2e2bff");
    expect(formatLike("#2E2BFF", "#FF0000")).toBe("#2E2BFF");
    expect(formatLike("#2E2BFF", "rgb(1 2 3)")).toBe("rgb(46 43 255)");
  });
});
