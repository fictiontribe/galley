import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanDeclared, type SiteFile } from "../../src/sitebrand/declared";

const SAAS = fileURLToPath(new URL("../../../../starters/astro-saas/", import.meta.url));
const read = (path: string): SiteFile => ({ path, content: readFileSync(`${SAAS}${path}`, "utf8") });

describe("declared tokens", () => {
  it("finds custom properties with their file, line and byte range, and resolves var() chains", () => {
    const css = [":root {", "  --brand: #2e2bff;", "  --color-accent: var(--brand);", "  --space-4: 1rem;", "}", ".dark { --color-accent: #8a88ff; }"].join("\n");
    const scan = scanDeclared([{ path: "src/styles/tokens.css", content: css }, { path: "src/styles/extra.css", content: ":root { --color-text: #111; --color-bg: #fff; --color-border: #ddd; }" }], () => null, { tokensFile: "src/styles/tokens.css" });
    const accent = scan.variables.find((v) => v.name === "--color-accent" && v.context === ":root")!;

    expect(accent).toMatchObject({ file: "src/styles/tokens.css", line: 3, raw: "var(--brand)", resolved: "#2e2bff", kind: "color" });
    expect(css.slice(accent.start, accent.end)).toBe("var(--brand)");
    expect(scan.variables.find((v) => v.name === "--space-4")?.kind).toBe("space");
    expect(scan.variables.find((v) => v.context === ".dark")?.resolved).toBe("#8a88ff");
    expect(scan.tokensFile).toBe("src/styles/tokens.css");
  });

  it("picks the SaaS starter's tokens file, sets its alternative looks aside, and resolves its font packages", () => {
    const files = [read("src/styles/tokens.css"), read("src/styles/themes/meridian.css"), read("src/styles/themes/signal.css"), read("src/styles/themes/night-shift.css"), read("src/styles/global.css")];
    const scan = scanDeclared(
      files,
      (spec) => (spec === "@fontsource-variable/public-sans/wght.css" ? [{ file: "pkg:@fontsource-variable/public-sans/wght.css", content: "@font-face { font-family: 'Public Sans Variable'; font-style: normal; font-weight: 100 900; src: url(./files/public-sans-latin-wght-normal.woff2) format('woff2-variations'); unicode-range: U+0000-00FF; }" }] : null),
      { tokensFile: null }
    );

    expect(scan.tokensFile).toBe("src/styles/tokens.css");
    expect(scan.looks.sort()).toEqual(["src/styles/themes/meridian.css", "src/styles/themes/night-shift.css", "src/styles/themes/signal.css"]);
    expect(scan.variables.every((v) => !v.file.includes("/themes/"))).toBe(true);
    expect(scan.fonts.map((f) => [f.token, f.family, f.source.kind === "package" ? f.source.ref : null])).toEqual(
      expect.arrayContaining([
        ["--font-display", "Bricolage Grotesque Variable", "@fontsource-variable/bricolage-grotesque"],
        ["--font-body", "Public Sans Variable", "@fontsource-variable/public-sans"],
      ])
    );
    expect(scan.fontFaces).toEqual(expect.arrayContaining([expect.objectContaining({ family: "Public Sans Variable", file: "pkg:@fontsource-variable/public-sans/files/public-sans-latin-wght-normal.woff2" })]));
    expect(scan.notes.join(" ")).toMatch(/alternative looks/);
  });

  it("reads Tailwind v4 @theme blocks, plain v3 config colours, @font-face and Sass variables", () => {
    const scan = scanDeclared(
      [
        { path: "src/app.css", content: '@import "tailwindcss";\n@theme {\n  --color-brand-500: oklch(54.5% 0.19 39);\n  --font-display: "Inter", sans-serif;\n}\n@font-face { font-family: "Brand Serif"; src: url("../fonts/brand.woff2") format("woff2"); font-weight: 400; }' },
        { path: "tailwind.config.js", content: "export default { theme: { extend: { colors: { ink: '#1A1712', paper: \"#F6F1E7\" } } } }" },
        { path: "src/styles/_vars.scss", content: "$accent: #2e2bff !default;\n$gap: 4px;" },
      ],
      () => null
    );

    expect(scan.variables.find((v) => v.name === "--color-brand-500")).toMatchObject({ context: "@theme", kind: "color" });
    expect(scan.fonts[0]).toMatchObject({ family: "Inter", token: "--font-display" });
    expect(scan.fontFaces[0]).toMatchObject({ family: "Brand Serif", file: "fonts/brand.woff2", weight: "400" });
    expect(scan.otherColors.map((c) => [c.name, c.value])).toEqual(expect.arrayContaining([["tailwind:ink", "#1A1712"], ["tailwind:paper", "#F6F1E7"], ["$accent", "#2E2BFF"]]));
  });

  it("reads custom properties inside component <style> blocks with lines counted from the file", () => {
    const scan = scanDeclared([{ path: "src/components/Hero.astro", content: "---\nconst a = 1;\n---\n<section/>\n<style>\n  :root { --hero-ground: #f6f1e7; }\n</style>" }], () => null);

    expect(scan.variables[0]).toMatchObject({ name: "--hero-ground", line: 6, kind: "color", context: ":root" });
  });
});
