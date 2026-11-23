import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cloneRepository,
  isGitRepository,
  packageName,
  parseCloneProgress,
  runBuild,
  scaffoldFromStarter,
} from "../../src/workspace/index";
import { addBareRemote, cleanupAll, makeRepo, sh, tempDir, writeTree } from "./helpers";

afterEach(() => cleanupAll());

describe("scaffoldFromStarter", () => {
  it("copies the starter without build output or installed packages, names it, and makes the first commit on main", async () => {
    const starter = tempDir("ws-starter-");

    writeTree(starter, {
      "package.json": '{\n    "name": "starter",\n    "version": "0.0.1"\n}\n',
      "src/pages/index.astro": "<h1>Hi</h1>\n",
      "src/content/.gitkeep": "",
      "node_modules/astro/index.js": "x",
      "dist/index.html": "x",
      ".astro/types.d.ts": "x",
      ".DS_Store": "x",
      ".git/HEAD": "ref: refs/heads/main\n",
      ".gitignore": "node_modules\n",
    });
    const target = join(tempDir("ws-parent-"), "Acme Bakery");

    await scaffoldFromStarter({ starterDir: starter, targetDir: target, name: "Acme Bakery" });
    expect(readdirSync(target).sort()).toEqual([".git", ".gitignore", "package.json", "src"]);
    expect(readFileSync(join(target, "package.json"), "utf8")).toBe('{\n    "name": "acme-bakery",\n    "version": "0.0.1"\n}\n');
    expect(await isGitRepository(target)).toBe(true);
    expect(sh(target, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(sh(target, "log", "--format=%B")).toBe("Start Acme Bakery from a starter\n\nGalley-Publish: 1");
    expect(sh(target, "log", "--format=%an")).toBe("Site editor");
    expect(sh(target, "status", "--porcelain")).toBe("");
    expect(sh(target, "ls-files").split("\n").sort()).toEqual([".gitignore", "package.json", "src/content/.gitkeep", "src/pages/index.astro"]);
  });

  it("restores a starter's .gitignore that npm packing renamed, so installed packages never enter the first version", async () => {
    const starter = tempDir("ws-starter-packed-");

    writeTree(starter, { gitignore: "node_modules/\n", "package.json": '{ "name": "packed" }\n', "src/pages/index.astro": "<h1>Hi</h1>\n" });
    const target = join(tempDir("ws-target-parent-"), "packed-site");

    await scaffoldFromStarter({
      starterDir: starter,
      targetDir: target,
      name: "Packed Site",
      // What an install leaves before the first version is recorded.
      prepare: async (root) => writeTree(root, { "node_modules/dep/index.js": "x", "package-lock.json": "{}\n" }),
    });
    expect(sh(target, "ls-files").split("\n").sort()).toEqual([".gitignore", "package-lock.json", "package.json", "src/pages/index.astro"]);
    expect(sh(target, "status", "--porcelain")).toBe("");
  });

  it("refuses a non-empty target and a missing starter", async () => {
    const starter = tempDir("ws-starter-");

    writeTree(starter, { "a.txt": "a" });
    const target = tempDir("ws-target-");

    writeTree(target, { "existing.txt": "mine" });
    await expect(scaffoldFromStarter({ starterDir: starter, targetDir: target, name: "x" })).rejects.toMatchObject({ code: "conflict" });
    expect(readdirSync(target)).toEqual(["existing.txt"]);
    await expect(scaffoldFromStarter({ starterDir: join(starter, "nope"), targetDir: join(target, "new"), name: "x" })).rejects.toMatchObject({
      code: "not-found",
    });
  });

  it("derives npm-safe package names", () => {
    expect(packageName("Café & Bar")).toBe("cafe-bar");
    expect(packageName("...")).toBe("site");
  });
});

describe("cloneRepository", () => {
  it("clones with progress, into a new folder, on a chosen branch", async () => {
    const source = makeRepo({ "src/content/a.md": "a\n" });

    sh(source, "checkout", "-q", "-b", "staging");
    writeTree(source, { "src/content/b.md": "b\n" });
    sh(source, "add", "-A");
    sh(source, "commit", "-q", "-m", "Staging");
    const bare = addBareRemote(source);

    sh(source, "push", "-q", "origin", "staging");
    const target = join(tempDir("ws-clone-"), "site");
    const progress: Array<[string, number | undefined]> = [];

    await cloneRepository({ url: `file://${bare}`, directory: target, branch: "staging" }, (detail, value) => progress.push([detail, value]));
    expect(existsSync(join(target, "src/content/b.md"))).toBe(true);
    expect(sh(target, "rev-parse", "--abbrev-ref", "HEAD")).toBe("staging");
    expect(progress[0]).toEqual(["Connecting", 0]);
    expect(progress[progress.length - 1]).toEqual(["Done", 1]);
    const values = progress.map(([, v]) => v ?? 0);

    expect([...values].sort((a, b) => a - b)).toEqual(values);
  });

  it("explains a missing repository and cleans up after itself", async () => {
    const parent = tempDir("ws-clone-");
    const target = join(parent, "site");

    await expect(cloneRepository({ url: join(parent, "does-not-exist"), directory: target })).rejects.toMatchObject({
      code: "git",
      message: expect.stringContaining("wasn't found"),
    });
    expect(existsSync(target)).toBe(false);
  });

  it("refuses option-like URLs, ext:: transports and non-empty folders", async () => {
    const target = tempDir("ws-clone-");

    await expect(cloneRepository({ url: "--upload-pack=touch /tmp/x", directory: join(target, "a") })).rejects.toMatchObject({ code: "invalid" });
    await expect(cloneRepository({ url: "ext::sh -c touch% /tmp/pwned", directory: join(target, "b") })).rejects.toMatchObject({ code: "invalid" });
    writeTree(target, { "x.txt": "x" });
    await expect(cloneRepository({ url: "https://example.invalid/r.git", directory: target })).rejects.toMatchObject({ code: "conflict" });
  });

  it("maps git's progress lines onto one bar", () => {
    expect(parseCloneProgress("Receiving objects:  50% (5/10)")).toEqual({ detail: "Downloading", progress: 0.45 });
    expect(parseCloneProgress("Resolving deltas: 100% (3/3), done.")).toEqual({ detail: "Unpacking", progress: 0.95 });
    expect(parseCloneProgress("Cloning into 'site'...")).toBeNull();
  });
});

describe("isGitRepository", () => {
  it("tells a repository from a plain folder", async () => {
    expect(await isGitRepository(makeRepo({ "a.md": "a" }))).toBe(true);
    expect(await isGitRepository(tempDir("ws-plain-"))).toBe(false);
    expect(await isGitRepository(join(tempDir("ws-plain-"), "missing"))).toBe(false);
  });
});

describe("runBuild", () => {
  it("reports success with the output tail, and failure without throwing", async () => {
    const root = tempDir("ws-build-");

    writeTree(root, {
      "ok.mjs": "console.log('built 3 pages'); console.log('NO_COLOR=' + process.env.NO_COLOR);",
      "fail.mjs": "console.error('Error: missing layout'); process.exit(2);",
      "slow.mjs": "setInterval(() => {}, 1000);",
    });
    const ok = await runBuild(root, "node ok.mjs");

    expect(ok).toMatchObject({ ok: true });
    expect(ok.output).toContain("built 3 pages");
    expect(ok.output).toContain("NO_COLOR=1");
    expect(ok.durationMs).toBeGreaterThanOrEqual(0);
    const failed = await runBuild(root, "node fail.mjs");

    expect(failed).toMatchObject({ ok: false, output: expect.stringContaining("missing layout") });
    const slow = await runBuild(root, "node slow.mjs", { timeoutMs: 500 });

    expect(slow).toMatchObject({ ok: false, output: expect.stringContaining("took too long") });
    expect(await runBuild(root, "npm run build && rm -rf /")).toMatchObject({ ok: false, output: expect.stringContaining("shell features") });
  });
});
