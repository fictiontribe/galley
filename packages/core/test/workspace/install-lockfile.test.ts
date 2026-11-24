/**
 * Installing a site's dependencies without leaving a lockfile it didn't
 * have (a hosted install's preview): each package manager is a small script
 * on PATH that writes down its arguments and writes its lockfile unless its
 * own "no lockfile" switch was given. Real temporary repositories.
 */
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { installDependencies } from "../../src/workspace/build";
import type { PackageManager } from "../../src/types";
import { cleanupAll, makeRepo, sh, tempDir } from "./helpers";

const FAKE = `#!/bin/sh
name=$(basename "$0")
echo "$name $*" >> "$FAKE_LOG"
case "$name" in
  npm) lock=package-lock.json; skip=--no-package-lock ;;
  pnpm) lock=pnpm-lock.yaml; skip=--no-lockfile ;;
  yarn) lock=yarn.lock; skip=--never-given ;;
  bun) lock=bun.lock; skip=--no-save ;;
esac
for arg in "$@"; do [ "$arg" = "$skip" ] && exit 0; done
echo "written by $name" > "$lock"
`;

let bin = "";
let log = "";
let path: string | undefined;

beforeAll(() => {
  bin = tempDir("fake-managers-");
  log = join(bin, "calls.log");
  for (const name of ["npm", "pnpm", "yarn", "bun"]) {
    writeFileSync(join(bin, name), FAKE);
    chmodSync(join(bin, name), 0o755);
  }
  path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
});

afterAll(() => {
  process.env.PATH = path;
  cleanupAll();
});

afterEach(() => rmSync(log, { force: true }));

const PACKAGE = `${JSON.stringify({ name: "site", private: true })}\n`;
const calls = () => readFileSync(log, "utf8").trim().split("\n");
const install = (root: string, manager: PackageManager, addLockfile?: boolean) => installDependencies(root, manager, undefined, { FAKE_LOG: log }, addLockfile === undefined ? {} : { addLockfile });

describe("installing without adding a lockfile", () => {
  it.each([
    ["npm", "npm install --no-audit --no-fund --no-package-lock", "package-lock.json"],
    ["pnpm", "pnpm install --no-lockfile", "pnpm-lock.yaml"],
    ["bun", "bun install --no-save", "bun.lock"],
  ] as const)("%s: uses its own switch, and the checkout stays as it was", async (manager, expected, lockfile) => {
    const root = makeRepo({ "package.json": PACKAGE });

    await install(root, manager, false);
    expect(calls()).toEqual([expected]);
    expect(existsSync(join(root, lockfile))).toBe(false);
    expect(sh(root, "status", "--porcelain")).toBe("");
  });

  it("yarn, which has no switch every version takes: the lockfile it wrote is taken away again", async () => {
    const root = makeRepo({ "package.json": PACKAGE });

    await install(root, "yarn", false);
    expect(calls()).toEqual(["yarn install"]);
    expect(existsSync(join(root, "yarn.lock"))).toBe(false);
    expect(sh(root, "status", "--porcelain")).toBe("");
  });

  it("a site that has a lockfile is installed exactly as before", async () => {
    const root = makeRepo({ "package.json": PACKAGE, "package-lock.json": "{}\n" });

    await install(root, "npm", false);
    expect(calls()).toEqual(["npm install --no-audit --no-fund"]);
    expect(readFileSync(join(root, "package-lock.json"), "utf8")).toBe("written by npm\n");
  });

  it("a site in a folder of a workspace whose lockfile is at the top is installed exactly as before", async () => {
    const root = makeRepo({ "pnpm-lock.yaml": "lockfileVersion: '9.0'\n", "pnpm-workspace.yaml": "packages:\n  - apps/*\n", "apps/site/package.json": PACKAGE });
    const site = join(root, "apps", "site");

    await install(site, "pnpm", false);
    expect(calls()).toEqual(["pnpm install"]);
  });

  it("a lockfile the repository tracks is never taken away, even one deleted in the working copy", async () => {
    const root = makeRepo({ "package.json": PACKAGE, "yarn.lock": "# tracked\n" });

    rmSync(join(root, "yarn.lock"));
    await install(root, "yarn", false);
    expect(readFileSync(join(root, "yarn.lock"), "utf8")).toBe("written by yarn\n");
  });

  it("left as it is (on a computer of one's own), the package manager does what it does by itself", async () => {
    const root = makeRepo({ "package.json": PACKAGE });

    await install(root, "npm");
    expect(calls()).toEqual(["npm install --no-audit --no-fund"]);
    expect(existsSync(join(root, "package-lock.json"))).toBe(true);
  });
});
