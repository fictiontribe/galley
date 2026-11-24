/**
 * "What is stored where": the background measurement of the data folder.
 * It never walks installed packages, lets go when the server closes, and
 * leaves a line it couldn't finish in time null, to be measured again.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createStorageMeter } from "../../src/install/storage";
import { tempDir } from "./helpers";

function files(dir: string, count: number, bytes = 10): void {
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i += 1) writeFileSync(join(dir, `f${i}.txt`), "x".repeat(bytes));
}

const sizeOf = (lines: ReturnType<ReturnType<typeof createStorageMeter>["lines"]>, id: string) => lines.find((line) => line.id === id)?.bytes;

describe("the storage meter", () => {
  it("never walks into node_modules; installed packages leave the caches line unmeasured instead", async () => {
    const home = tempDir("storage-");

    files(join(home, "site", "src"), 3, 100);
    files(join(home, "site", "node_modules", "pkg", "lib"), 50, 1000);
    files(join(home, "plugins", "one", "node_modules", "dep"), 20, 1000);
    writeFileSync(join(home, "plugins", "one", "package.json"), "{}");
    files(join(home, "home", ".npm"), 2, 50);
    const meter = createStorageMeter(home);

    expect(sizeOf(meter.lines("site", null), "site")).toBeNull();
    await meter.settled();
    const lines = meter.lines("site", null);

    expect(sizeOf(lines, "site")).toBe(300);
    expect(sizeOf(lines, "plugins")).toBe(2);
    // The site has installed packages, which aren't counted: no number at all rather than a wrong one.
    expect(sizeOf(lines, "cache")).toBeNull();
    expect(lines.find((line) => line.id === "plugins")?.label).toMatch(/carries their settings; their packages are added again after a restore/);
  });

  it("without installed packages, measures the caches line", async () => {
    const home = tempDir("storage-");

    files(join(home, "site"), 1);
    files(join(home, "home", ".npm"), 2, 50);
    const meter = createStorageMeter(home);

    meter.lines("site", null);
    await meter.settled();
    expect(sizeOf(meter.lines("site", null), "cache")).toBe(100);
  });

  it("leaves a line that runs out of time null, and measures it again on the next request", async () => {
    const home = tempDir("storage-");

    files(join(home, "site", "small"), 3);
    for (let i = 0; i < 50; i += 1) files(join(home, "site", "big", `d${i}`), 200);
    // Never stale by age: only the unfinished line makes the next request measure again.
    const meter = createStorageMeter(home, { budgetMs: 50, maxAgeMs: 60 * 60_000, now: () => 0 });

    meter.lines("site", null);
    await meter.settled();
    const short = meter.lines("site", null);

    expect(sizeOf(short, "site")).toBeNull();
    expect(sizeOf(short, "settings")).toBe(0);
    await meter.settled();
    rmSync(join(home, "site", "big"), { recursive: true, force: true });
    meter.lines("site", null);
    await meter.settled();
    expect(sizeOf(meter.lines("site", null), "site")).toBe(30);
  });

  it("stops a walk in progress when closed, and starts no more", async () => {
    const home = tempDir("storage-");

    for (let i = 0; i < 40; i += 1) files(join(home, "site", `d${i}`), 50);
    const meter = createStorageMeter(home, { budgetMs: 60_000 });

    meter.lines("site", null);
    const at = Date.now();

    await meter.close();
    expect(Date.now() - at).toBeLessThan(1000);
    expect(sizeOf(meter.lines("site", null), "site")).toBeNull();
    await meter.settled();
    expect(sizeOf(meter.lines("site", null), "site")).toBeNull();
  });
});
