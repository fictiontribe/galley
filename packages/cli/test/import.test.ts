/**
 * `galley import` — the one door for importers, dispatched through the
 * plugin registry — and proof that the built CLI (the same bundle the
 * desktop sidecar runs) carries the WordPress importer inside it rather than
 * finding it in the repository's node_modules.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { Io } from "../src/io";
import { main } from "../src/main";

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "galley-cli-import-")));
const here = fileURLToPath(new URL("..", import.meta.url));
const WXR = fileURLToPath(new URL("../../import-wordpress/test/fixtures/quillfield.wxr", import.meta.url));

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function io() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const value: Io & { stdout: string[]; stderr: string[] } = {
    stdout,
    stderr,
    out: (line = "") => stdout.push(line),
    err: (line = "") => stderr.push(line),
    cwd: tmp,
    env: { PATH: process.env.PATH, HOME: tmp, GALLEY_HOME: join(tmp, "home"), GALLEY_DISABLE_USER_PLUGINS: "1" },
    startServer: () => {
      throw new Error("not in this test");
    },
    openBrowser: async () => true,
    waitForStop: async () => {},
    watchParent: () => ({ gone: new Promise<void>(() => {}), stop: () => {} }),
  };

  return value;
}

describe("galley import", () => {
  it("lists what can be imported from", async () => {
    const run = io();

    expect(await main(["import"], run)).toBe(0);
    expect(run.stdout.join("\n")).toMatch(/You can import from\n {2}wordpress {2}WordPress, from an address or an export file/);
  });

  it("hands everything after the id to that importer's own command", async () => {
    const help = io();

    expect(await main(["import", "wordpress", "--help"], help)).toBe(0);
    expect(help.stdout.join("\n")).toMatch(/^Usage: galley import wordpress <address\|file> \[path\] \[options\]/);
    const missing = io();

    expect(await main(["import", "wordpress", join(tmp, "nowhere.xml"), join(tmp, "not-a-site"), "--plan"], missing)).toBe(2);
    expect(missing.stderr.join("\n")).toMatch(/There's no folder at .*not-a-site to import into/);
    expect(missing.stderr.join("\n")).not.toMatch(/at .*\.ts:\d+/);
  });

  it("says so when there's no such importer", async () => {
    const run = io();

    expect(await main(["import", "squarespace"], run)).toBe(2);
    expect(run.stderr.join("\n")).toMatch(/There's no importer called “squarespace” here\. You can import from: wordpress\./);
  });

  it("the built CLI finds the WordPress importer inside its own bundle", { timeout: 240_000 }, () => {
    const out = join(tmp, "bundle");

    execFileSync(process.execPath, ["build.mjs"], { cwd: here, env: { ...process.env, GALLEY_CLI_DIST: out }, stdio: "pipe" });
    // Moved away from the repository, where no node_modules can lend it the package.
    const alone = join(tmp, "elsewhere");

    cpSync(out, alone, { recursive: true });
    const env = { PATH: process.env.PATH, HOME: tmp, GALLEY_HOME: join(tmp, "bundle-home"), GALLEY_DISABLE_USER_PLUGINS: "1" };
    const listed = JSON.parse(execFileSync(process.execPath, [join(alone, "galley.mjs"), "import", "--json"], { cwd: tmp, env, encoding: "utf8" })) as { importers: Array<{ id: string; command: boolean; plugin: string }> };

    expect(listed.importers).toContainEqual(expect.objectContaining({ id: "wordpress", command: true, plugin: "@galley/import-wordpress" }));
    // And it runs: an export file read and planned, nothing written.
    const site = join(tmp, "plain-site");

    // A plain folder of posts: the generic adapter takes it as a blog.
    mkdirSync(join(site, "posts"), { recursive: true });
    for (const name of ["first", "second"]) writeFileSync(join(site, "posts", `${name}.md`), `---\ntitle: ${name}\ndate: 2024-01-0${name === "first" ? 1 : 2}\n---\n\nHello.\n`);
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: site });
    const plan = execFileSync(process.execPath, [join(alone, "galley.mjs"), "import", "wordpress", WXR, site, "--plan", "--only", "posts"], { cwd: tmp, env, encoding: "utf8" });

    expect(plan).toMatch(/^Import plan \(nothing was written\) — Quillfield Pottery/);
  });
});
