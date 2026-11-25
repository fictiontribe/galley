/**
 * The settings name the folder a site's brand is kept in, and what is in it
 * is shown: to the brand screen, to the assistant's get_brand and in every
 * conversation's first words. So a folder that may not be shown is never
 * taken for it, whatever the settings say.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { brandLocation, readSavedBrand } from "../../src/sitebrand/files";
import type { GalleyConfig } from "../../src/types";
import { cleanupAll, disposeAll, makeSite, openSite } from "../site/helpers";

afterAll(async () => {
  await disposeAll();
  cleanupAll();
});

describe("the folder a brand is kept in", () => {
  it("is the usual one when the settings name a secrets folder or the version history's own", () => {
    const usual = brandLocation(null).dir;

    for (const dir of [".envs/brand", ".env", "config/.ENV.d/brand", ".git/brand", "sub/.git"]) expect(brandLocation({ siteBrand: { dir } } as GalleyConfig).dir, dir).toBe(usual);
    expect(brandLocation({ siteBrand: { dir: "design/brand/" } } as GalleyConfig).dir).toBe("design/brand");
  });

  it("is read out of nowhere that may not be shown, and a brand file's mistake is said by its place, not by what is written there", async () => {
    const root = makeSite();

    mkdirSync(join(root, ".envs/brand/sources"), { recursive: true });
    writeFileSync(join(root, ".envs/brand/brand.json"), "SECRET_KEY=not-a-brand\n");
    writeFileSync(join(root, ".envs/brand/guide.md"), "SECRET_KEY=not-a-guide\n");
    writeFileSync(join(root, ".envs/brand/sources/manifest.json"), '{"version":1,"sources":[]}\n');
    mkdirSync(join(root, "design/brand"), { recursive: true });
    writeFileSync(join(root, "design/brand/brand.json"), '{\n  "name": SECRET_KEY\n}\n');
    const { site } = await openSite(root);
    // A place put together by hand, as code that skipped brandLocation would.
    const hidden = { ...brandLocation(null), dir: ".envs/brand", brandFile: ".envs/brand/brand.json", guideFile: ".envs/brand/guide.md", sourcesDir: ".envs/brand/sources", manifestFile: ".envs/brand/sources/manifest.json" };
    const nothing = await readSavedBrand(site, hidden);

    expect(nothing).toMatchObject({ brand: null, problem: null, guide: null });
    expect(JSON.stringify(nothing)).not.toMatch(/SECRET|not-a/);
    const mistaken = await readSavedBrand(site, brandLocation({ siteBrand: { dir: "design/brand" } } as GalleyConfig));

    expect(mistaken.problem).toBe("The brand file has a formatting mistake near line 2, column 11, so it can't be read.");
    expect(JSON.stringify(mistaken)).not.toContain("SECRET");
  });
});
