/**
 * Moving inside the app goes through its router, and exports are downloads:
 * setting `location` loads the whole app again (and leaves the demo). Two
 * places reload on purpose, each saying why where it does.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));
const RELOADS = /location\.(assign|replace)\(|location\.href\s*=[^=]|window\.location\s*=[^=]/;

/** Starting over on purpose: a restore replaced everything, sessions included; a link signed this browser in as someone else. */
const DELIBERATE = new Set(["features/install/InstallScreen.tsx", "features/accounts/LinkScreen.tsx"]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("in-app navigation", () => {
  it("never reloads the app to move within it or to save an export", () => {
    const found = sources(SRC)
      .filter((path) => readFileSync(path, "utf8").split("\n").some((line) => RELOADS.test(line) && !/^\s*(\/\/|\*)/.test(line) && !/contentWindow|tab\.location/.test(line)))
      .map((path) => relative(SRC, path));

    expect(found.filter((path) => !DELIBERATE.has(path))).toEqual([]);
  });

  it("the Brand screen opens Proof with the router and saves its exports as downloads", () => {
    const brand = readFileSync(join(SRC, "features/brand/BrandScreen.tsx"), "utf8");

    expect(brand).not.toMatch(/window\.location/);
    expect(brand).toMatch(/onClick: \(\) => navigate\(`\/sites\/\$\{siteId\}\/proof`\)/);
    expect(brand.match(/download\(buildUrl\("GET \/api\/sites\/:siteId\/brand\/export"/g)).toHaveLength(2);
  });
});
