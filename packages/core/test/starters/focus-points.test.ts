/**
 * The two fashion starters anchor each crop on its photograph's focus point.
 * The points are in src/lib/focus.json, written from the shot list by
 * scripts/focus-points.mjs: the site reads that copy, so the shot list stays
 * a record beside the site and keeps no picture in the repository when the
 * pictures move to a bucket. This holds the copy to the shot list, and the
 * starters' source to reading nothing of the shot list itself.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const STARTERS_DIR = fileURLToPath(new URL("../../../../starters", import.meta.url));

const FASHION = ["astro-editorial", "astro-storefront"] as const;

describe.each(FASHION)("%s: focus points", (starter) => {
  const root = join(STARTERS_DIR, starter);

  it("src/lib/focus.json says what the shot list says", () => {
    const run = spawnSync(process.execPath, [join(root, "scripts/focus-points.mjs"), "--check"], { encoding: "utf8" });

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    const { shots } = JSON.parse(readFileSync(join(root, "galley/photography/shots.json"), "utf8")) as { shots: Array<{ file: string }> };
    const { points } = JSON.parse(readFileSync(join(root, "src/lib/focus.json"), "utf8")) as { points: Record<string, string> };

    expect(Object.keys(points).sort()).toEqual(shots.map((shot) => shot.file.replace(/^public\/images\//, "")).sort());
    for (const point of Object.values(points)) expect(point).toMatch(/^\d{1,3}% \d{1,3}%$/);
  });

  it("the site's source reads the copy, not the shot list", () => {
    const source = readFileSync(join(root, "src/lib/site.ts"), "utf8");

    expect(source).toContain('from "./focus.json"');
    expect(source).not.toMatch(/["'`][^"'`]*shots\.json["'`]/);
  });
});
