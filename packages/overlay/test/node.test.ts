import { rm, stat, utimes } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { overlaySource } from "../src/node";

const outFile = fileURLToPath(new URL("../dist/overlay.js", import.meta.url));
const entry = fileURLToPath(new URL("../src/main.ts", import.meta.url));

describe("overlaySource()", () => {
  it("builds the script on demand when dist is missing, as one small IIFE", async () => {
    await rm(outFile, { force: true });
    const source = await overlaySource();
    expect(source.startsWith("/* galley overlay */")).toBe(true);
    expect(source).toContain("__galley-hover");
    expect(source).not.toMatch(/\bimport\s|\brequire\(/);
    // Click to edit was ~15 KB; Arrange (section mapping, the chrome in its shadow root, drag
    // and drop, keyboard) brought it to ~41 KB minified, ~15 KB gzipped. Measure (read-only style
    // sampling for the Brand screen, with its colour parser) adds ~12 KB, and colour-only section
    // marks add ~1.2 KB. The budget keeps it there.
    expect(source.length).toBeLessThan(60 * 1024);
  }, 20_000);

  it("rebuilds when a source is newer than the build, and reuses it otherwise", async () => {
    await overlaySource();
    const built = (await stat(outFile)).mtimeMs;
    expect((await stat(outFile)).mtimeMs).toBe(built);
    await overlaySource();
    expect((await stat(outFile)).mtimeMs).toBe(built);
    const later = new Date(built + 5000);
    await utimes(entry, later, later);
    await overlaySource();
    expect((await stat(outFile)).mtimeMs).toBeGreaterThan(built);
  }, 20_000);
});
