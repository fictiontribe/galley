import { mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GalleyError } from "../../src/errors";
import { createWorkspace, hashContent, normalizeRepoPath, type Workspace } from "../../src/workspace/index";
import { cleanupAll, makeRepo, sh, tempDir, WRITABLE, writeTree } from "./helpers";

const open: Workspace[] = [];

async function workspaceFor(root: string): Promise<Workspace> {
  const ws = await createWorkspace(root, { writable: () => WRITABLE, watch: false });

  open.push(ws);
  return ws;
}

afterEach(async () => {
  while (open.length) await open.pop()?.dispose();
  cleanupAll();
});

function forbidden(fn: () => unknown): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(GalleyError);
    expect((error as GalleyError).code).toBe("forbidden");
    return;
  }
  throw new Error("expected forbidden");
}

describe("path containment", () => {
  const escapes = [
    "../outside.md",
    "src/../../outside.md",
    "src/content/../../../etc/passwd",
    "/etc/passwd",
    "C:/Windows/win.ini",
    "c:\\Windows\\win.ini",
    "src\\content\\x.md",
    "..\\outside.md",
    "src/content/x.md\0.png",
    "~/notes.md",
    "..",
  ];

  it.each(escapes)("refuses %j", async (attempt) => {
    const root = makeRepo({ "src/content/a.md": "a\n" });
    const ws = await workspaceFor(root);

    forbidden(() => ws.resolvePath(attempt));
    await expect(ws.readText(attempt)).rejects.toMatchObject({ code: "forbidden" });
    await expect(ws.writeFile(attempt, "x", { origin: "agent", mode: "build" })).rejects.toMatchObject({ code: "forbidden" });
    expect(ws.canWrite(attempt, "build").ok).toBe(false);
  });

  it("normalises harmless spellings", () => {
    expect(normalizeRepoPath("./src//content/./a.md")).toBe("src/content/a.md");
    expect(normalizeRepoPath("src/content/")).toBe("src/content");
  });

  it("refuses a symlink that points outside the root, for reads and writes", async () => {
    const outside = tempDir("ws-outside-");

    writeTree(outside, { "secret.md": "secret\n" });
    const root = makeRepo({ "src/content/a.md": "a\n" });

    symlinkSync(outside, join(root, "src/content/linked"));
    symlinkSync(join(outside, "secret.md"), join(root, "src/content/secret.md"));
    const ws = await workspaceFor(root);

    forbidden(() => ws.resolvePath("src/content/linked/secret.md"));
    forbidden(() => ws.resolvePath("src/content/secret.md"));
    forbidden(() => ws.resolvePath("src/content/linked/new-file.md"));
    await expect(ws.writeFile("src/content/linked/new.md", "x", { origin: "agent", mode: "content" })).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(readdirSync(outside)).toEqual(["secret.md"]);
  });

  it("refuses a dangling symlink", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });

    symlinkSync("/nonexistent/target-file", join(root, "src/content/dangling.md"));
    const ws = await workspaceFor(root);

    forbidden(() => ws.resolvePath("src/content/dangling.md"));
  });

  it("refuses an in-site symlink that leads into a protected or non-writable place", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n", "src/components/Hero.astro": "<h1/>\n" });

    symlinkSync(join(root, ".git"), join(root, "src/content/dotgit"));
    symlinkSync(join(root, "src/components"), join(root, "src/content/components"));
    const ws = await workspaceFor(root);

    expect(ws.canWrite("src/content/dotgit/config", "build")).toMatchObject({ ok: false });
    // Content mode may write src/content/**, but this one really lands in src/components.
    expect(ws.canWrite("src/content/components/Hero.astro", "content")).toMatchObject({ ok: false });
    expect(ws.canWrite("src/content/components/Hero.astro", "build")).toMatchObject({ ok: true });
  });

  it("reads through no link that leads to a secrets file or into the version history's own folder, whatever the link is called", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n", "docs/plain.md": "plain\n" });

    writeTree(root, { ".env": "TOKEN=behind-a-link\n", "config/.envrc": "export TOKEN=behind-a-link\n" });
    symlinkSync("../.env", join(root, "docs/notes.md"));
    symlinkSync(join(root, "config/.envrc"), join(root, "src/content/settings.md"));
    symlinkSync(join(root, ".git"), join(root, "docs/history"));
    symlinkSync("plain.md", join(root, "docs/also-plain.md"));
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", "Links");
    const ws = await workspaceFor(root);

    for (const path of ["docs/notes.md", "src/content/settings.md", "docs/history/config", "docs/history/HEAD"]) {
      forbidden(() => ws.resolvePath(path));
      await expect(ws.readBytes(path), path).rejects.toMatchObject({ code: "forbidden", message: "That file can't be shown here." });
      await expect(ws.readText(path), path).rejects.toMatchObject({ code: "forbidden" });
      await expect(ws.diff(path), path).rejects.toMatchObject({ code: "forbidden" });
      await expect(ws.readBase(path), path).rejects.toMatchObject({ code: "forbidden" });
    }
    // A link to an ordinary file of the site is read as it always was.
    expect(await ws.readText("docs/also-plain.md")).toBe("plain\n");
    expect(ws.resolvePath("docs/also-plain.md")).toBe(join(root, "docs/also-plain.md"));
  });

  it("writes through an in-site symlink to its target without replacing the link", async () => {
    const root = makeRepo({ "src/content/real.md": "old\n" });

    symlinkSync("real.md", join(root, "src/content/alias.md"));
    const ws = await workspaceFor(root);

    await ws.writeFile("src/content/alias.md", "new\n", { origin: "user", mode: "content" });
    expect(readFileSync(join(root, "src/content/real.md"), "utf8")).toBe("new\n");
  });
});

describe("write policy", () => {
  it("content mode writes content and media only; build mode adds source", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });
    const ws = await workspaceFor(root);

    expect(ws.canWrite("src/content/blog/post.md", "content")).toEqual({ ok: true });
    expect(ws.canWrite("public/images/x.png", "content")).toEqual({ ok: true });
    expect(ws.canWrite("src/components/Hero.astro", "content").ok).toBe(false);
    expect(ws.canWrite("src/components/Hero.astro", "build")).toEqual({ ok: true });
    expect(ws.canWrite("README.md", "build").ok).toBe(false);
    await expect(ws.writeFile("src/components/Hero.astro", "x", { origin: "agent", mode: "content" })).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  const denied = [
    ".git/config",
    ".git/hooks/pre-commit",
    ".GIT/config",
    "src/.git/config",
    "node_modules/x/index.js",
    "src/node_modules/x.js",
    "Node_Modules/x.js",
    ".env",
    ".env.local",
    "src/content/.env",
    "src/.ENV.production",
    ".envrc",
    ".env-production",
    ".env_local",
    ".ENV",
    "src/content/.Envrc",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "src/content/bun.lockb",
    ".vscode/settings.json",
    "src/.astro/types.d.ts",
    "src/content/.hidden/a.md",
  ];

  it.each(denied)("never writes %s, in any mode", async (path) => {
    const root = makeRepo({ "src/content/a.md": "a\n" });
    // Even when the writable globs would allow everything.
    const ws = await createWorkspace(root, { writable: () => ({ content: ["**"], build: ["**"] }), watch: false });

    open.push(ws);
    expect(ws.canWrite(path, "content").ok).toBe(false);
    expect(ws.canWrite(path, "build").ok).toBe(false);
    await expect(ws.writeFile(path, "x", { origin: "agent", mode: "build" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("allows .github/ in build mode only", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });
    const ws = await createWorkspace(root, { writable: () => ({ content: ["**"], build: ["**"] }), watch: false });

    open.push(ws);
    expect(ws.canWrite(".github/workflows/deploy.yml", "build")).toEqual({ ok: true });
    expect(ws.canWrite(".github/workflows/deploy.yml", "content").ok).toBe(false);
    expect(ws.canWrite("src/.github/x.yml", "build").ok).toBe(false);
  });

  it("follows the writable globs as they change", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });
    let writable = { content: ["src/content/**"], build: [] as string[] };
    const ws = await createWorkspace(root, { writable: () => writable, watch: false });

    open.push(ws);
    expect(ws.canWrite("docs/a.md", "content").ok).toBe(false);
    writable = { content: ["docs/**"], build: [] };
    expect(ws.canWrite("docs/a.md", "content").ok).toBe(true);
  });
});

describe("reads and writes", () => {
  it("reads text, bytes and stat; reports a missing file as not-found", async () => {
    const root = makeRepo({ "src/content/a.md": "héllo\n" });
    const ws = await workspaceFor(root);

    expect(await ws.readText("src/content/a.md")).toBe("héllo\n");
    expect((await ws.readBytes("src/content/a.md")).length).toBe(7);
    expect(await ws.stat("src/content/a.md")).toMatchObject({ size: 7 });
    expect(await ws.stat("src/content/none.md")).toBeNull();
    expect(await ws.exists("src/content/a.md")).toBe(true);
    await expect(ws.readText("src/content/none.md")).rejects.toMatchObject({ code: "not-found" });
    await expect(ws.readText("src/content")).rejects.toMatchObject({ code: "invalid" });
  });

  it("writes atomically: creates folders, leaves no temp files, keeps permissions", async () => {
    const root = makeRepo({ "src/scripts/run.js": "1\n" });

    chmodSync(join(root, "src/scripts/run.js"), 0o755);
    const ws = await workspaceFor(root);

    await ws.writeFile("src/content/deep/new/post.md", "# Hi\n", { origin: "agent", mode: "content" });
    await ws.writeFile("src/scripts/run.js", "2\n", { origin: "agent", mode: "build" });
    expect(readFileSync(join(root, "src/content/deep/new/post.md"), "utf8")).toBe("# Hi\n");
    expect(readdirSync(join(root, "src/content/deep/new"))).toEqual(["post.md"]);
    expect(readdirSync(join(root, "src/scripts"))).toEqual(["run.js"]);
    expect(statSync(join(root, "src/scripts/run.js")).mode & 0o777).toBe(0o755);
  });

  it("honours baseHash and refuses a stale edit", async () => {
    const root = makeRepo({ "src/content/a.md": "one\n" });
    const ws = await workspaceFor(root);
    const base = hashContent("one\n");

    expect(base).toMatch(/^[0-9a-f]{16}$/);
    await ws.writeFile("src/content/a.md", "two\n", { origin: "user", mode: "content", baseHash: base });
    await expect(
      ws.writeFile("src/content/a.md", "three\n", { origin: "user", mode: "content", baseHash: base })
    ).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("changed since you opened it") });
    expect(readFileSync(join(root, "src/content/a.md"), "utf8")).toBe("two\n");
    await expect(ws.deleteFile("src/content/a.md", { origin: "user", mode: "content", baseHash: base })).rejects.toMatchObject({
      code: "conflict",
    });
    await ws.deleteFile("src/content/a.md", { origin: "user", mode: "content", baseHash: hashContent("two\n") });
    expect(existsSync(join(root, "src/content/a.md"))).toBe(false);
  });

  it("deleteFile refuses missing files and folders", async () => {
    const root = makeRepo({ "src/content/a.md": "one\n" });

    mkdirSync(join(root, "src/content/folder"));
    const ws = await workspaceFor(root);

    await expect(ws.deleteFile("src/content/none.md", { origin: "user", mode: "content" })).rejects.toMatchObject({ code: "not-found" });
    await expect(ws.deleteFile("src/content/folder", { origin: "user", mode: "content" })).rejects.toMatchObject({ code: "invalid" });
  });

  it("emits one change event per write with its origin, and none for a no-op write", async () => {
    const root = makeRepo({ "src/content/a.md": "one\n" });
    const ws = await workspaceFor(root);
    const events: Array<[string[], string]> = [];

    ws.onChange((paths, origin) => events.push([paths, origin]));
    await ws.writeFile("src/content/a.md", "two\n", { origin: "agent", mode: "content" });
    await ws.writeFile("src/content/a.md", "two\n", { origin: "agent", mode: "content" });
    await ws.deleteFile("src/content/a.md", { origin: "user", mode: "content" });
    expect(events).toEqual([
      [["src/content/a.md"], "agent"],
      [["src/content/a.md"], "user"],
    ]);
  });

  it("lists tracked and untracked files, honours .gitignore, filters by glob", async () => {
    const root = makeRepo({ ".gitignore": "dist/\n*.log\n", "src/content/a.md": "a\n", "src/pages/index.astro": "x\n" });

    writeTree(root, { "src/content/b.md": "b\n", "dist/index.html": "x", "debug.log": "x", "node_modules/p/index.js": "x" });
    const ws = await workspaceFor(root);

    expect(await ws.listFiles()).toEqual([".gitignore", "src/content/a.md", "src/content/b.md", "src/pages/index.astro"]);
    expect(await ws.listFiles({ glob: "src/content/**" })).toEqual(["src/content/a.md", "src/content/b.md"]);
    expect(await ws.listFiles({ limit: 1 })).toEqual([".gitignore"]);
  });

  it("lists files in a folder that is not a repository", async () => {
    const root = tempDir("ws-plain-");

    writeTree(root, { ".gitignore": "out/\n", "a.md": "a", "out/x.html": "x", "node_modules/p/i.js": "x", "src/b.md": "b" });
    const ws = await workspaceFor(root);

    expect(await ws.listFiles()).toEqual([".gitignore", "a.md", "src/b.md"]);
  });

  it("refuses to open a folder that does not exist", async () => {
    await expect(createWorkspace(join(tempDir(), "missing"), { writable: () => WRITABLE, watch: false })).rejects.toMatchObject({
      code: "not-found",
    });
  });
});
