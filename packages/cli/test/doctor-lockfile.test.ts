/**
 * `galley doctor` finds a lockfile's package manager on PATH by looking at the file system, never by running it in the
 * site's folder: there, Yarn's `yarnPath` (or Corepack, for a pinned `packageManager`) would run or fetch code the
 * repository names, and doctor reads a site without running any of its code.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { lockfileChecks, onPath } from "../src/commands/doctor";

const made: string[] = [];

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));

  made.push(dir);
  return dir;
}

/** A Yarn site whose .yarnrc.yml points yarnPath at a script that leaves a mark if anything runs it. */
function yarnSite(): { site: string; mark: string } {
  const site = temp("doctor-yarn-site-");
  const mark = join(site, "yarnpath-ran");

  writeFileSync(join(site, "package.json"), JSON.stringify({ name: "site", packageManager: "yarn@4.5.0" }));
  writeFileSync(join(site, "yarn.lock"), "# yarn lockfile v1\n");
  writeFileSync(join(site, ".yarnrc.yml"), "yarnPath: ./tools/yarn.cjs\n");
  mkdirSync(join(site, "tools"));
  writeFileSync(join(site, "tools", "yarn.cjs"), `require("node:fs").writeFileSync(${JSON.stringify(mark)}, "ran");\n`);
  return { site, mark };
}

/** A folder for PATH holding a `yarn` program that leaves a mark if anything runs it. */
function binWithYarn(): { bin: string; mark: string } {
  const bin = temp("doctor-bin-");
  const mark = join(bin, "yarn-ran");

  writeFileSync(join(bin, "yarn"), `#!/bin/sh\necho ran > ${JSON.stringify(mark)}\n`);
  chmodSync(join(bin, "yarn"), 0o755);
  return { bin, mark };
}

describe("galley doctor's lockfile check", () => {
  it("finds the manager on PATH without running it, or the site's yarnPath", async () => {
    const { site, mark: siteMark } = yarnSite();
    const { bin, mark: binMark } = binWithYarn();
    const checks = await lockfileChecks(site, { PATH: bin });

    expect(checks.map((check) => check.text).join("\n")).not.toMatch(/isn't installed/);
    expect(existsSync(siteMark)).toBe(false);
    expect(existsSync(binMark)).toBe(false);
  });

  it("says the manager isn't installed when PATH has none, still running nothing", async () => {
    const { site, mark } = yarnSite();
    const checks = await lockfileChecks(site, { PATH: temp("doctor-empty-bin-") });

    expect(checks).toEqual([{ level: "warn", text: "Found yarn.lock, but yarn isn't installed in PATH — install yarn or switch lockfiles" }]);
    expect(existsSync(mark)).toBe(false);
  });

  it("counts only a runnable file in an absolute PATH folder (with PATHEXT's endings on Windows)", () => {
    const bin = temp("doctor-onpath-");

    writeFileSync(join(bin, "pnpm"), "not runnable");
    chmodSync(join(bin, "pnpm"), 0o644);
    mkdirSync(join(bin, "bun"));
    expect(onPath("pnpm", { PATH: bin }, "linux")).toBe(false);
    expect(onPath("bun", { PATH: bin }, "linux")).toBe(false);
    chmodSync(join(bin, "pnpm"), 0o755);
    expect(onPath("pnpm", { PATH: `relative/dir:${bin}` }, "linux")).toBe(true);
    expect(onPath("pnpm", { PATH: "relative/dir" }, "linux")).toBe(false);
    writeFileSync(join(bin, "npm.CMD"), "@echo off\n");
    expect(onPath("npm", { PATH: bin, PATHEXT: ".EXE;.CMD" }, "win32")).toBe(true);
  });
});
