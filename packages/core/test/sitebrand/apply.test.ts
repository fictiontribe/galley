import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { planApply } from "../../src/sitebrand/apply";
import { checkChanges, drift } from "../../src/sitebrand/check";
import { normalizeColor } from "../../src/sitebrand/color";
import { exportBundle, exportDesignTokens, readBundle } from "../../src/sitebrand/export";
import { mergeMeasurements, parseMeasurements } from "../../src/sitebrand/measured";
import { refresh } from "../../src/sitebrand/proposal";
import type { BrandColor, SiteBrandFile } from "../../src/sitebrand/types";
import { measuredPage } from "./fixtures";

const STARTER_TOKENS = readFileSync(fileURLToPath(new URL("../../../../starters/astro-starter/src/styles/tokens.css", import.meta.url)), "utf8");
const FILE = "src/styles/tokens.css";

const color = (id: string, role: BrandColor["role"], value: string, token?: string): BrandColor => ({ id, role, name: id, value, ...(token ? { token } : {}), confidence: "declared", evidence: [] });

function brand(overrides: Partial<SiteBrandFile> = {}): SiteBrandFile {
  return refresh({
    version: 1,
    name: "Paper and ink",
    updatedAt: "2026-11-23T00:00:00.000Z",
    colors: [color("background", "background", "#F6F1E7"), color("text", "text", "#1A1712"), color("accent", "accent", "#2E2BFF")],
    contrast: [],
    typography: {
      fonts: [
        { id: "display", role: "display", family: "Newsreader", fallbacks: [], source: { kind: "embedded" }, weights: [], confidence: "declared", evidence: [] },
        { id: "body", role: "body", family: "Figtree", fallbacks: [], source: { kind: "embedded" }, weights: [], confidence: "declared", evidence: [] },
      ],
      scale: [],
    },
    spacing: [{ id: "s1", name: "space-4", value: "16px", confidence: "declared", evidence: [] }, { id: "s2", name: "section", value: "clamp(4rem, 2.6rem + 6.5vw, 8.5rem)", confidence: "declared", evidence: [] }],
    radius: [{ id: "r1", name: "radius-m", value: "4px", confidence: "declared", evidence: [] }],
    shadows: [{ id: "sh1", name: "raised", value: "0 1px 2px rgb(0 0 0 / 0.06), 0 12px 32px -8px rgb(0 0 0 / 0.16)", confidence: "declared", evidence: [] }],
    logos: [],
    imagery: null,
    components: [],
    voice: { summary: "Calm.", tone: [], rules: [], vocabulary: [{ say: "Publish", insteadOf: ["commit", "deploy"] }], formatting: { headlineCase: "sentence", punctuation: "", numbers: "", cta: "" }, confidence: "inferred", evidence: [] },
    layout: { do: [], dont: [] },
    tokensFile: FILE,
    ...overrides,
  });
}

describe("Apply to the site", () => {
  it("maps brand values onto the starter's tokens as surgical, same-notation edits", () => {
    const { plan, content } = planApply(brand(), FILE, STARTER_TOKENS, new Set(["Newsreader Variable", "Instrument Sans Variable"]));

    expect(plan.edits.map((e) => [e.token, e.label])).toEqual([
      ["--color-background", "Background"],
      ["--color-text", "Text"],
      ["--color-accent", "Accent"],
      ["--font-body", "Body text font"],
    ]);
    for (const edit of plan.edits.filter((e) => e.token.startsWith("--color"))) expect(edit.after.startsWith("oklch(")).toBe(true);
    expect(normalizeColor(plan.edits[0]!.after)).toBe("#F6F1E7");
    expect(normalizeColor(plan.edits[2]!.after)).toBe("#2E2BFF");
    expect(plan.edits[3]!.after).toBe('"Figtree", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif');
    // Exactly those four lines differ; every other byte stays.
    const before = STARTER_TOKENS.split("\n");
    const after = content.split("\n");

    expect(after.length).toBe(before.length);
    expect(before.map((line, i) => (line === after[i] ? null : i + 1)).filter(Boolean)).toEqual(plan.edits.map((e) => e.line));
    // Newsreader is already the display font (as "Newsreader Variable"), so it isn't touched.
    expect(plan.edits.some((e) => e.token === "--font-display")).toBe(false);
    expect(plan.notes.join(" ")).toMatch(/Figtree isn't installed in this site/);
    expect(plan.notes.join(" ")).toMatch(/Left as they were \(the brand has no value for them\): --color-accent-strong/);
  });

  it("does nothing when the site already wears the brand, and warns about contrast it would break", () => {
    const { content } = planApply(brand(), FILE, STARTER_TOKENS, new Set());
    const again = planApply(brand(), FILE, content, new Set(["Figtree"]));

    expect(again.plan.edits).toEqual([]);
    const pale = planApply(brand({ colors: [color("text", "text", "#EEEEEE")] }), FILE, STARTER_TOKENS, new Set());

    expect(pale.plan.warnings.join(" ")).toMatch(/Text on the background would be 1\.\d:1/);
  });
});

describe("Brand check", () => {
  const files = [
    { path: "src/components/Card.astro", after: "", added: [{ line: 12, text: "  color: #ff00aa;" }, { line: 13, text: '  font-family: "Comic Sans MS", cursive;' }, { line: 14, text: "  background: var(--color-surface);" }, { line: 15, text: "  border-color: #2e2bff;" }] },
    { path: "src/content/pages/index.md", after: "", added: [{ line: 3, text: "heading: Commit your changes and deploy" }] },
    { path: "galley/brand/brand.json", after: "", added: [{ line: 2, text: '"value": "#ABCDEF"' }] },
  ];

  it("suggests, with the place, colours and fonts that aren't the brand's and words the guide avoids", () => {
    const items = checkChanges(brand(), files, { brandDir: "galley/brand" });

    expect(items.map((i) => [i.kind, i.path, i.line, i.value])).toEqual([
      ["colour", "src/components/Card.astro", 12, "#FF00AA"],
      ["font", "src/components/Card.astro", 13, "Comic Sans MS"],
      ["words", "src/content/pages/index.md", 3, "Commit"],
      ["words", "src/content/pages/index.md", 3, "deploy"],
    ]);
    expect(items[2]!.text).toBe("“Commit” — the brand guide says “Publish”.");
  });

  it("notices a tokens change that makes text hard to read", () => {
    const tokens = `:root {\n  --color-text: #E0E0E0;\n  --color-background: #F6F1E7;\n}`;
    const withTokens = brand({ colors: [color("text", "text", "#1A1712", "--color-text"), color("background", "background", "#F6F1E7", "--color-background")] });
    const items = checkChanges(withTokens, [{ path: FILE, after: tokens, added: [{ line: 2, text: "  --color-text: #E0E0E0;" }] }], { brandDir: "galley/brand" });

    expect(items.find((i) => i.kind === "contrast")?.text).toMatch(/^Text on the background is now 1\.\d:1, which is hard to read\.$/);
  });
});

describe("Drift", () => {
  it("lists what the pages use that the brand doesn't know, and brand values nothing uses", () => {
    const measured = mergeMeasurements(parseMeasurements([measuredPage("/")]));
    const report = drift(brand(), measured, new Date("2026-11-23T00:00:00Z"), new Set());

    expect(report.unknown.map((u) => u.value)).toEqual(expect.arrayContaining(["#111827", "#C53500", "Geist Variable", "Schibsted Grotesk Variable"]));
    expect(report.unused.map((u) => u.value)).toEqual(expect.arrayContaining(["#1A1712", "#2E2BFF", "Newsreader"]));
    const referenced = drift(brand({ colors: [color("border", "border", "#D2C7B4", "--color-border")] }), measured, new Date(), new Set(["--color-border"]));

    expect(referenced.unused.some((u) => u.value === "#D2C7B4")).toBe(false);
  });
});

describe("Export", () => {
  it("writes the W3C design tokens format (2025.10): srgb components, px/rem dimensions, shadows, font families", () => {
    const tokens = exportDesignTokens(brand()) as Record<string, Record<string, Record<string, unknown>>>;

    expect(tokens.color!.$type).toBe("color");
    expect(tokens.color!.accent!.$value).toEqual({ colorSpace: "srgb", components: [0.1804, 0.1686, 1], hex: "#2e2bff" });
    expect(tokens.font!.body).toMatchObject({ $type: "fontFamily", $value: ["Figtree"] });
    expect(tokens.spacing!["space-4"]).toEqual({ $value: { value: 16, unit: "px" } });
    expect(tokens.spacing!.$extensions).toEqual({ "com.fictiontribe.galley.brand": { cssValues: { section: "clamp(4rem, 2.6rem + 6.5vw, 8.5rem)" } } });
    const shadow = tokens.shadow!.raised!.$value as Array<Record<string, unknown>>;

    expect(shadow).toHaveLength(2);
    expect(shadow[1]).toMatchObject({ offsetX: { value: 0, unit: "px" }, offsetY: { value: 12, unit: "px" }, blur: { value: 32, unit: "px" }, spread: { value: -8, unit: "px" } });
  });

  it("round-trips the bundle and refuses anything that isn't one", () => {
    const bundle = exportBundle(brand(), "# Guide\n", { version: 1, sources: [] }, new Date("2026-11-23T00:00:00Z"));
    const back = readBundle(JSON.parse(JSON.stringify(bundle)));

    expect(back.brand.colors.map((c) => c.value)).toEqual(["#F6F1E7", "#1A1712", "#2E2BFF"]);
    expect(back.guide).toBe("# Guide\n");
    expect(() => readBundle({ kind: "other" })).toThrow(/isn't a brand/);
    expect(() => readBundle({ ...bundle, brand: { ...bundle.brand, extra: true } })).toThrow(/can't be used/);
  });
});
