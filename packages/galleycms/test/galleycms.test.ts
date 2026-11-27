import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findGalley, nodeProblem, olderThan } from "../index.js";

const BIN = fileURLToPath(new URL("../bin/galleycms.js", import.meta.url));
const PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

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
      "Galley needs Node 20.11 or newer, and this computer has Node 18.19.0. Install the current LTS version from https://nodejs.org, then run the same command again."
    );
  });
});

describe("the command", () => {
  it("finds galley-cms beside it", () => {
    const galley = findGalley(import.meta.url);

    expect(galley?.bin).toMatch(/bin[\\/]galley\.js$/);
  });

  it("forwards version --json to galley-cms", () => {
    const output = execFileSync(process.execPath, [BIN, "version", "--json"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "" } });

    expect(JSON.parse(output)).toMatchObject({ version: PKG.version });
  });

  it("forwards --help to galley-cms", () => {
    const output = execFileSync(process.execPath, [BIN, "--help"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "" } });

    expect(output).toContain("Usage\n  galley [path]");
    expect(output).toContain("galley doctor [path]");
  });

  it("passes galley's exit code and stderr on", () => {
    const result = spawnSync(process.execPath, [BIN, "new", "x", "--starter", "nope"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: "/nonexistent" } });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("There's no starter called “nope”");
  });
});
