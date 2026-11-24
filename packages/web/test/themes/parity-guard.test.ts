/**
 * The legibility check measures what the engine derives (core
 * src/themes/derive.ts and the colours it copies), and that is only true
 * while the stylesheets say the same. The browser parity test
 * (parity.browser.test.ts) proves it, but needs a browser and is skipped in
 * CI. This guard runs everywhere: it records a hash of exactly the CSS the
 * engine mirrors, so any edit to it fails here until someone has run the
 * browser test again and, if it passed (or derive.ts was brought back in
 * step), recorded the new hash.
 *
 * Mirrored: brand/tokens.css §2 (the accent), §3 (dark inks and the dark
 * pencil text), §5 (the pencil ramp), §6 (the theme recipes), §7 (the
 * switches), §8 (the people colours), every proof and status ink's value
 * (§1 and §3), packages/web/src/styles/themes.css, and look.css's mapping of
 * the older accent tints onto the pencil ramp.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const RECORDED = "93434d9fada75883";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

/** What the engine mirrors, as one text: the hash input. */
export function mirroredCss(): string {
  const tokens = read("../../../../brand/tokens.css");
  // Sections start with a rule of dashes and a numbered title ("   6. Themes — …").
  const sections = tokens.split(/\n(?=\/\* -{20,}\n {3}\d+[a-z]?\. )/);
  const numbered = (number: string) => sections.filter((section) => new RegExp(`^/\\* -{20,}\\n {3}${number}\\. `).test(section));
  const picked = ["2", "3", "5", "6", "7", "8"].flatMap(numbered);
  const inks = tokens.split("\n").filter((line) => /^\s*--(proof-(insert|delete|change)|success|warning|danger|info):/.test(line));
  const look = read("../../src/styles/look.css");
  const accentTints = /\.g-root \{\s*--accent-subtle:[^}]*\}/.exec(look)?.[0] ?? "(look.css no longer maps the accent tints)";
  return [...picked, inks.join("\n"), read("../../src/styles/themes.css"), accentTints].join("\n/* ---- */\n");
}

describe("the CSS the theme engine mirrors", () => {
  it("is the CSS the browser parity test last passed against", () => {
    const sections = mirroredCss();
    expect(sections).toContain("6. Themes");
    expect(sections).toContain("8. People");
    const hash = createHash("sha256").update(sections).digest("hex").slice(0, 16);
    expect(
      hash,
      `brand/tokens.css, styles/themes.css or look.css changed where the theme engine mirrors them. Run the browser parity test (THEME_PARITY_PLAYWRIGHT=<folder with playwright-core> pnpm --filter @galley/web exec vitest run test/themes/parity.browser.test.ts); if it fails, bring packages/core/src/themes/derive.ts (or the colours it copies) back in step; then record ${hash} in ${fileURLToPath(import.meta.url)}.`,
    ).toBe(RECORDED);
  });
});
