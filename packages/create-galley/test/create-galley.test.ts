import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findGalley, galleyArguments, nodeProblem, olderThan } from "../index.js";

const BIN = fileURLToPath(new URL("../bin/create-galley.js", import.meta.url));
const STARTERS = ["astro-blog", "sarking", "astro-editorial", "caddow", "astro-saas", "ferrow", "astro-starter", "lowfield", "astro-storefront", "storefront"];
const NPM = { npm_config_user_agent: "npm/10.9.2 node/v22.23.4 darwin arm64 workspaces/false" };

describe("Node versions", () => {
  it.each([
    ["18.19.0", true],
    ["20.10.9", true],
    ["v20.11.0", false],
    ["22.23.4", false],
    ["24.0.0", false],
  ])("%s too old: %s", (version, old) => {
    expect(olderThan(version, "20.11.0")).toBe(old);
    expect(nodeProblem(version) !== null).toBe(old);
  });

  it("says which version, and where to get it", () => {
    expect(nodeProblem("18.19.0")).toBe(
      "Galley needs Node 20.11 or newer (its starters need 22.23.4), and this computer has Node 18.19.0. Install the current LTS version from https://nodejs.org, then run the same command again."
    );
  });
});

describe("arguments for galley new", () => {
  it("passes everything on, after the --", () => {
    expect(galleyArguments(["my-site", "--starter", "caddow", "--no-open"], NPM, STARTERS)).toEqual(["new", "my-site", "--starter", "caddow", "--no-open"]);
    expect(galleyArguments(["my-site", "--", "--starter", "caddow"], { npm_config_user_agent: "pnpm/10.15.0 npm/? node/v22.23.4" }, STARTERS)).toEqual(["new", "my-site", "--starter", "caddow"]);
    expect(galleyArguments([], {}, STARTERS)).toEqual(["new"]);
  });

  it("puts back what npm kept for itself when the -- was left out", () => {
    // npm create galley my-site --starter caddow
    expect(galleyArguments(["my-site", "caddow"], { ...NPM, npm_config_starter: "true" }, STARTERS)).toEqual(["new", "my-site", "--starter", "caddow"]);
    // npm create galley --starter caddow my-site
    expect(galleyArguments(["caddow", "my-site"], { ...NPM, npm_config_starter: "true" }, STARTERS)).toEqual(["new", "my-site", "--starter", "caddow"]);
    // npm create galley --starter caddow
    expect(galleyArguments(["caddow"], { ...NPM, npm_config_starter: "true" }, STARTERS)).toEqual(["new", "--starter", "caddow"]);
    // npm create galley my-site --starter=ferrow --no-open --no-install
    expect(galleyArguments(["my-site"], { ...NPM, npm_config_starter: "ferrow", npm_config_open: "", npm_config_install: "" }, STARTERS)).toEqual([
      "new",
      "my-site",
      "--starter",
      "ferrow",
      "--no-open",
      "--no-install",
    ]);
  });

  it("leaves other package managers' arguments alone", () => {
    expect(galleyArguments(["my-site", "caddow"], { npm_config_user_agent: "yarn/1.22.22 npm/? node/v22.23.4", npm_config_starter: "true" }, STARTERS)).toEqual(["new", "my-site", "caddow"]);
  });
});

describe("the command", () => {
  it("finds galley-cms beside it", () => {
    const galley = findGalley(import.meta.url);

    expect(galley?.bin).toMatch(/bin[\\/]galley\.js$/);
  });

  it("prints its usage and galley new's options", () => {
    const output = execFileSync(process.execPath, [BIN, "--help"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "" } });

    expect(output).toContain("Usage: npm create galley@latest [name] -- [options]");
    expect(output).toContain("--starter <name>");
    expect(output).toContain("caddow");
  });

  it("passes galley new's exit code on", () => {
    const result = spawnSync(process.execPath, [BIN, "x", "--starter", "nope"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: "/nonexistent" } });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("There's no starter called “nope”. Choose caddow, ferrow, lowfield, sarking or storefront");
  });
});
