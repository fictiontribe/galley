import { createHash } from "node:crypto";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cloudflareHash, collectFiles, contentTypeFor, DeployError, defaultProjectName, eachLimited, projectNameProblem, sha1 } from "../../src/deploy/index";
import { CLOUDFLARE_INFO, CLOUDFLARE_TOKEN_TEMPLATE_URL } from "../../src/deploy/info";
import { cleanupAll, tempDir, writeTree } from "../workspace/helpers";

afterAll(cleanupAll);

const LIMITS = { maxFiles: 100, maxFileBytes: 1024, maxTotalBytes: 4096 };

describe("collectFiles", () => {
  it("lists every file with POSIX paths, sizes, both hashes and a type", async () => {
    const dir = tempDir("deploy-files-");

    writeTree(dir, { "index.html": "<h1>Hi</h1>", "blog/post/index.html": "<p>Post</p>", "img/a.png": new Uint8Array([137, 80, 78, 71]) });
    const files = await collectFiles(dir, LIMITS, "Host", "dist");

    expect(files.map((file) => file.path)).toEqual(["blog/post/index.html", "img/a.png", "index.html"]);
    const index = files.find((file) => file.path === "index.html")!;

    expect(index.size).toBe(11);
    expect(index.sha1).toBe(createHash("sha1").update("<h1>Hi</h1>").digest("hex"));
    // The Direct Upload guide's sample: sha256(base64(content) + extension without the dot), first 32 hex.
    expect(index.cfHash).toBe(createHash("sha256").update(Buffer.from("<h1>Hi</h1>").toString("base64") + "html").digest("hex").slice(0, 32));
    expect(index.cfHash).toHaveLength(32);
    expect(index.type).toBe("text/html; charset=utf-8");
    expect(files.find((file) => file.path === "img/a.png")!.type).toBe("image/png");
  });

  it("never takes .git, node_modules, .env files or symbolic links", async () => {
    const dir = tempDir("deploy-files-");
    const outside = tempDir("deploy-outside-");

    writeTree(outside, { "secret.txt": "not the site's" });
    writeTree(dir, { "index.html": "ok", ".git/config": "x", "node_modules/pkg/index.js": "x", ".env": "TOKEN=1", ".env.local": "TOKEN=2", "nested/.env.production": "TOKEN=3", ".envrc": "export TOKEN=4", "nested/.env-production": "TOKEN=5", ".ENV_local": "TOKEN=6", "env.js": "ok" });
    symlinkSync(join(outside, "secret.txt"), join(dir, "linked.txt"));
    symlinkSync(outside, join(dir, "linked-dir"), "dir");
    const files = await collectFiles(dir, LIMITS, "Host", "dist");

    expect(files.map((file) => file.path)).toEqual(["env.js", "index.html"]);
  });

  it("refuses a missing or empty output folder in plain words", async () => {
    const empty = tempDir("deploy-empty-");

    await expect(collectFiles(join(empty, "nope"), LIMITS, "Host", "dist")).rejects.toMatchObject({ reason: "no-output", message: expect.stringContaining("no “dist” folder") });
    mkdirSync(join(empty, "dist"));
    await expect(collectFiles(join(empty, "dist"), LIMITS, "Host", "dist")).rejects.toMatchObject({ reason: "no-output", message: expect.stringContaining("is empty") });
  });

  it("refuses folders over the host's limits, with the numbers", async () => {
    const many = tempDir("deploy-many-");

    for (let index = 0; index < 5; index += 1) writeFileSync(join(many, `${index}.html`), "x");
    await expect(collectFiles(many, { ...LIMITS, maxFiles: 3 }, "Cloudflare", "dist")).rejects.toThrow("more than 3 files, and Cloudflare takes at most 3");

    const big = tempDir("deploy-big-");

    writeTree(big, { "index.html": "x", "video.mp4": Buffer.alloc(2048) });
    const error = await collectFiles(big, LIMITS, "Cloudflare", "dist").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DeployError);
    expect((error as DeployError).reason).toBe("too-large");
    expect((error as DeployError).message).toBe("“video.mp4” is 2 KB, and Cloudflare takes files up to 1 KB. Make it smaller or move it elsewhere. Nothing was uploaded.");

    const total = tempDir("deploy-total-");

    for (let index = 0; index < 5; index += 1) writeFileSync(join(total, `${index}.bin`), Buffer.alloc(1000));
    await expect(collectFiles(total, LIMITS, "Vercel", "dist")).rejects.toThrow("The site is 4.9 KB, and Vercel takes up to 4 KB in one go.");
  });
});

describe("helpers", () => {
  it("hashes like the hosts", () => {
    expect(sha1(Buffer.from("abc"))).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(cloudflareHash(Buffer.from("abc"), "x.css")).toBe(createHash("sha256").update("YWJjcss").digest("hex").slice(0, 32));
    expect(contentTypeFor("a/b/c.woff2")).toBe("font/woff2");
    expect(contentTypeFor("README")).toBe("application/octet-stream");
    expect(contentTypeFor("about.md")).toBe("text/markdown; charset=utf-8");
  });

  it("names projects from the site's name, within both hosts' rules", () => {
    expect(defaultProjectName("Lowfield Studio")).toBe("lowfield-studio");
    expect(defaultProjectName("Café & Bar — Zürich!")).toBe("cafe-bar-zurich");
    expect(defaultProjectName("***")).toBe("my-site");
    expect(defaultProjectName("a".repeat(80))).toHaveLength(54);
    expect(projectNameProblem("my-site")).toBeNull();
    expect(projectNameProblem("My Site")).toMatch(/lowercase letters/);
    expect(projectNameProblem("-x")).toMatch(/lowercase letters/);
    expect(projectNameProblem("")).toBe("Give the project a name.");
  });

  it("runs work with a cap and stops at the first failure", async () => {
    let inFlight = 0;
    let peak = 0;
    const done: number[] = [];

    await eachLimited([1, 2, 3, 4, 5, 6], 2, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      done.push(item);
      inFlight -= 1;
    });
    expect(peak).toBe(2);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6]);
    await expect(eachLimited([1, 2, 3], 1, async (item) => { if (item === 2) throw new Error("two"); })).rejects.toThrow("two");
  });
});

describe("Cloudflare's pre-filled token page", () => {
  it("is the documented user-token template: permission groups, all accounts, all zones, a name", () => {
    const url = new URL(CLOUDFLARE_TOKEN_TEMPLATE_URL);

    expect(`${url.origin}${url.pathname}`).toBe("https://dash.cloudflare.com/profile/api-tokens");
    expect(JSON.parse(url.searchParams.get("permissionGroupKeys")!)).toEqual([
      { key: "workers_scripts", type: "edit" },
      { key: "account_settings", type: "read" },
    ]);
    expect(url.searchParams.get("accountId")).toBe("*");
    expect(url.searchParams.get("zoneId")).toBe("all");
    expect(url.searchParams.get("name")).toBe("Website publishing");
    expect(CLOUDFLARE_INFO.keyUrl).toBe(CLOUDFLARE_TOKEN_TEMPLATE_URL);
    expect(CLOUDFLARE_INFO.keySteps).toHaveLength(4);
    expect(CLOUDFLARE_INFO.keyStepsByHand!.length).toBeGreaterThan(4);
  });
});
