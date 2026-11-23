import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classifyKind, computeHunks, createWorkspace, parsePorcelain, type Workspace } from "../../src/workspace/index";
import { cleanupAll, makeRepo, pngHeader, sh, tempDir, WRITABLE, writeTree } from "./helpers";

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

describe("classification", () => {
  it.each([
    ["src/content/blog/post.md", "content"],
    ["src/content/blog/post.mdx", "content"],
    ["src/data/nav.yaml", "content"],
    ["content/en/about.md", "content"],
    ["_data/site.json", "content"],
    ["index.md", "content"],
    ["README.md", "other"],
    ["public/images/a.webp", "media"],
    ["public/fonts/x.woff2", "media"],
    ["public/files/brochure.pdf", "media"],
    ["package.json", "config"],
    ["astro.config.mjs", "config"],
    ["galley.config.json", "config"],
    ["tsconfig.json", "config"],
    ["tsconfig.app.json", "config"],
    ["settings.yaml", "config"],
    [".github/workflows/deploy.yml", "config"],
    ["src/components/Hero.astro", "code"],
    ["src/styles/global.css", "code"],
    ["src/pages/index.tsx", "code"],
    ["LICENSE", "other"],
  ])("%s → %s", (path, kind) => {
    expect(classifyKind(path)).toBe(kind);
  });
});

describe("porcelain parsing", () => {
  it("maps statuses relative to HEAD, splits renames, strips a prefix", () => {
    const text = [
      " M site/a.md",
      "A  site/new.md",
      "AD site/gone-again.md",
      "D  site/del.md",
      "?? site/del.md",
      "R  site/to.md",
      "site/from.md",
      "?? other/outside.md",
      "UU site/conflict.md",
      "",
    ].join("\0");
    const map = parsePorcelain(text, "site/");

    expect(Object.fromEntries(map)).toEqual({
      "a.md": "modified",
      "new.md": "added",
      "del.md": "modified",
      "to.md": "added",
      "from.md": "deleted",
      "conflict.md": "modified",
    });
  });
});

describe("change set", () => {
  it("is empty with baseCommit null in a folder that is not a repository", async () => {
    const root = tempDir("ws-plain-");

    writeTree(root, { "src/content/a.md": "a\n" });
    const ws = await workspaceFor(root);

    expect(await ws.changes()).toEqual({ branch: "", baseCommit: null, files: [], totals: { files: 0, additions: 0, deletions: 0 } });
    expect(ws.statusOf("src/content/a.md")).toBe("clean");
    await expect(ws.discard()).rejects.toMatchObject({ code: "invalid" });
    expect(existsSync(join(root, "src/content/a.md"))).toBe(true);
  });

  it("treats everything as added in a repo with zero commits", async () => {
    const root = makeRepo({ "src/content/a.md": "1\n2\n3\n", "public/images/x.png": Buffer.from([137, 80, 0, 1, 2]) }, { commit: false });
    const ws = await workspaceFor(root);
    const set = await ws.changes();

    expect(set.baseCommit).toBeNull();
    expect(set.branch).toBe("main");
    expect(set.files).toEqual([
      expect.objectContaining({ path: "public/images/x.png", status: "added", kind: "media", binary: true, additions: 0, summary: "Added x.png" }),
      expect.objectContaining({ path: "src/content/a.md", status: "added", kind: "content", binary: false, additions: 3, deletions: 0 }),
    ]);
    expect(ws.statusOf("src/content/a.md")).toBe("added");
    const diff = await ws.diff("src/content/a.md");

    expect(diff).toMatchObject({ status: "added", before: null, after: "1\n2\n3\n" });
    expect(diff.hunks[0]?.lines.map((l) => [l.type, l.newNumber])).toEqual([
      ["add", 1],
      ["add", 2],
      ["add", 3],
    ]);
  });

  it("reports modified, added, deleted and renamed files with line counts and summaries", async () => {
    const root = makeRepo({
      "src/content/keep.md": "a\nb\nc\n",
      "src/content/old-name.md": "moved\n",
      "src/content/remove.md": "x\ny\n",
      "src/components/Hero.astro": "<h1>Hi</h1>\n",
    });

    writeFileSync(join(root, "src/content/keep.md"), "a\nB\nc\nd\n");
    rmSync(join(root, "src/content/remove.md"));
    sh(root, "mv", "src/content/old-name.md", "src/content/new-name.md");
    writeTree(root, { "src/content/fresh.md": "one\ntwo\n", "src/components/Hero.astro": "<h1>Hello</h1>\n" });
    const ws = await workspaceFor(root);
    const set = await ws.changes();
    const byPath = Object.fromEntries(set.files.map((f) => [f.path, f]));

    expect(Object.keys(byPath).sort()).toEqual([
      "src/components/Hero.astro",
      "src/content/fresh.md",
      "src/content/keep.md",
      "src/content/new-name.md",
      "src/content/old-name.md",
      "src/content/remove.md",
    ]);
    expect(byPath["src/content/keep.md"]).toMatchObject({ status: "modified", additions: 2, deletions: 1, summary: "Changed keep.md" });
    expect(byPath["src/content/remove.md"]).toMatchObject({ status: "deleted", additions: 0, deletions: 2, summary: "Removed remove.md" });
    expect(byPath["src/content/fresh.md"]).toMatchObject({ status: "added", additions: 2, summary: "Added fresh.md" });
    expect(byPath["src/content/old-name.md"]).toMatchObject({ status: "deleted" });
    expect(byPath["src/content/new-name.md"]).toMatchObject({ status: "added" });
    expect(byPath["src/components/Hero.astro"]).toMatchObject({ kind: "code", status: "modified" });
    expect(set.totals).toEqual({
      files: 6,
      additions: set.files.reduce((n, f) => n + f.additions, 0),
      deletions: set.files.reduce((n, f) => n + f.deletions, 0),
    });
    expect(set.baseCommit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("survives unusual filenames", async () => {
    const names = ["src/content/with space.md", "src/content/quote\"d.md", "src/content/ünïcødé.md", "src/content/star*.md", "src/content/:colon.md", "src/content/tab\there.md"];
    const root = makeRepo({ "src/content/base.md": "x\n" });

    writeTree(root, Object.fromEntries(names.map((n) => [n, "hello\n"])));
    const ws = await workspaceFor(root);
    const set = await ws.changes();

    expect(set.files.map((f) => f.path).sort()).toEqual([...names].sort());
    for (const name of names) expect(ws.statusOf(name)).toBe("added");
  });

  it("lets an enricher refine entries and receive both versions as text", async () => {
    const root = makeRepo({ "src/content/a.md": "---\ntitle: Old\n---\n", "public/images/x.png": Buffer.from([0, 1, 2]) });

    writeFileSync(join(root, "src/content/a.md"), "---\ntitle: New\n---\n");
    writeFileSync(join(root, "public/images/x.png"), Buffer.from([0, 1, 2, 3]));
    const ws = await workspaceFor(root);
    const seen: Array<[string, string | null, string | null]> = [];
    const set = await ws.changes((file, before, after) => {
      seen.push([file.path, before, after]);
      return file.kind === "content" ? { collection: "pages", title: "About", summary: "Changed the title" } : {};
    });

    expect(seen).toContainEqual(["src/content/a.md", "---\ntitle: Old\n---\n", "---\ntitle: New\n---\n"]);
    expect(seen).toContainEqual(["public/images/x.png", null, null]);
    expect(set.files.find((f) => f.path === "src/content/a.md")).toMatchObject({ collection: "pages", title: "About", summary: "Changed the title" });
  });

  it("says what each changed image is now: type, size and pixel size when readable", async () => {
    const root = makeRepo({ "public/images/old.png": pngHeader(10, 10), "public/images/gone.png": pngHeader(2, 2), "src/content/a.md": "a\n" });

    writeFileSync(join(root, "public/images/old.png"), pngHeader(640, 480));
    rmSync(join(root, "public/images/gone.png"));
    writeTree(root, {
      "public/images/new.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"></svg>',
      "public/images/broken.webp": Buffer.from("not really a webp"),
      "public/files/menu.pdf": Buffer.from("%PDF-1.4"),
      "src/content/a.md": "b\n",
    });
    const ws = await workspaceFor(root);
    const byPath = new Map((await ws.changes()).files.map((file) => [file.path, file]));

    expect(byPath.get("public/images/old.png")?.media).toEqual({ type: "image/png", size: pngHeader(640, 480).byteLength, width: 640, height: 480 });
    expect(byPath.get("public/images/new.svg")?.media).toMatchObject({ type: "image/svg+xml", width: 120, height: 40 });
    // Unreadable bytes still say what the file claims to be and how big it is.
    expect(byPath.get("public/images/broken.webp")?.media).toEqual({ type: "image/webp", size: 17 });
    expect(byPath.get("public/images/gone.png")?.media).toBeUndefined();
    expect(byPath.get("public/files/menu.pdf")?.media).toBeUndefined();
    expect(byPath.get("src/content/a.md")?.media).toBeUndefined();
  });

  it("keeps the status cache fresh after every write", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });
    const ws = await workspaceFor(root);

    expect(ws.statusOf("src/content/a.md")).toBe("clean");
    await ws.writeFile("src/content/a.md", "b\n", { origin: "user", mode: "content" });
    expect(ws.statusOf("src/content/a.md")).toBe("modified");
    await ws.writeFile("src/content/a.md", "a\n", { origin: "user", mode: "content" });
    expect(ws.statusOf("src/content/a.md")).toBe("clean");
    await ws.writeFile("src/content/b.md", "b\n", { origin: "user", mode: "content" });
    expect(ws.statusOf("src/content/b.md")).toBe("added");
    await ws.deleteFile("src/content/a.md", { origin: "user", mode: "content" });
    expect(ws.statusOf("src/content/a.md")).toBe("deleted");
    expect(ws.statusOf("../nope")).toBe("clean");
  });
});

describe("diff", () => {
  it("numbers old and new lines correctly across hunks", async () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
    const lines = before.split("\n");

    lines[2] = "LINE 3";
    lines.splice(15, 0, "inserted");
    const after = lines.join("\n");
    const root = makeRepo({ "src/content/a.md": before });

    writeFileSync(join(root, "src/content/a.md"), after);
    const ws = await workspaceFor(root);
    const diff = await ws.diff("src/content/a.md");

    expect(diff).toMatchObject({ status: "modified", binary: false, before, after });
    expect(diff.hunks).toHaveLength(2);
    const [first, second] = diff.hunks;

    expect(first).toMatchObject({ oldStart: 1, oldLines: 6, newStart: 1, newLines: 6 });
    expect(first?.lines.find((l) => l.type === "del")).toEqual({ type: "del", text: "line 3", oldNumber: 3 });
    expect(first?.lines.find((l) => l.type === "add")).toEqual({ type: "add", text: "LINE 3", newNumber: 3 });
    expect(second).toMatchObject({ oldStart: 13, newStart: 13 });
    expect(second?.lines.find((l) => l.type === "add")).toEqual({ type: "add", text: "inserted", newNumber: 16 });
    const context = second?.lines.filter((l) => l.type === "context") ?? [];

    expect(context[0]).toEqual({ type: "context", text: "line 13", oldNumber: 13, newNumber: 13 });
    expect(context[context.length - 1]).toEqual({ type: "context", text: "line 18", oldNumber: 18, newNumber: 19 });
  });

  it("strips CR from CRLF lines and ignores the no-newline marker", () => {
    const hunks = computeHunks("a\r\nb\r\n", "a\r\nc");

    expect(hunks[0]?.lines).toEqual([
      { type: "context", text: "a", oldNumber: 1, newNumber: 1 },
      { type: "del", text: "b", oldNumber: 2 },
      { type: "add", text: "c", newNumber: 2 },
    ]);
  });

  it("shows a deleted file, and skips hunks for binary and oversized files", async () => {
    const big = "x".repeat(410 * 1024);
    const root = makeRepo({ "src/content/a.md": "a\n", "public/images/p.png": Buffer.from([1, 0, 2]), "src/data/big.json": big });

    rmSync(join(root, "src/content/a.md"));
    writeFileSync(join(root, "public/images/p.png"), Buffer.from([1, 0, 3]));
    writeFileSync(join(root, "src/data/big.json"), big + "y");
    const ws = await workspaceFor(root);

    expect(await ws.diff("src/content/a.md")).toMatchObject({ status: "deleted", before: "a\n", after: null, binary: false });
    expect(await ws.diff("public/images/p.png")).toEqual({ path: "public/images/p.png", status: "modified", binary: true, before: null, after: null, hunks: [] });
    expect(await ws.diff("src/data/big.json")).toMatchObject({ binary: true, before: null, after: null, hunks: [] });
    expect(Buffer.from((await ws.readBase("public/images/p.png")) ?? []).equals(Buffer.from([1, 0, 2]))).toBe(true);
    expect(await ws.readBase("src/content/never.md")).toBeNull();
    await expect(ws.diff("src/content/never.md")).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("discard", () => {
  it("restores tracked files and deletes untracked ones, leaving other changes alone", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n", "src/content/b.md": "b\n", "src/content/c.md": "c\n" });

    writeFileSync(join(root, "src/content/a.md"), "changed\n");
    rmSync(join(root, "src/content/b.md"));
    writeTree(root, { "src/content/new.md": "new\n", "src/content/keep-me.md": "mine\n", ".env.local": "SECRET=1\n" });
    sh(root, "add", "src/content/new.md");
    renameSync(join(root, "src/content/c.md"), join(root, "src/content/c2.md"));
    const ws = await workspaceFor(root);
    const events: Array<[string[], string]> = [];

    ws.onChange((paths, origin) => events.push([paths, origin]));
    const discarded = await ws.discard(["src/content/a.md", "src/content/b.md", "src/content/new.md", "src/content/c.md", "src/content/c2.md", "src/content/clean-file.md"]);

    expect(discarded).toEqual(["src/content/a.md", "src/content/b.md", "src/content/c.md", "src/content/c2.md", "src/content/new.md"]);
    expect(readFileSync(join(root, "src/content/a.md"), "utf8")).toBe("a\n");
    expect(readFileSync(join(root, "src/content/b.md"), "utf8")).toBe("b\n");
    expect(readFileSync(join(root, "src/content/c.md"), "utf8")).toBe("c\n");
    expect(existsSync(join(root, "src/content/c2.md"))).toBe(false);
    expect(existsSync(join(root, "src/content/new.md"))).toBe(false);
    expect(existsSync(join(root, "src/content/keep-me.md"))).toBe(true);
    expect(events).toEqual([[discarded, "discard"]]);
    expect((await ws.changes()).files.map((f) => f.path)).toEqual([".env.local", "src/content/keep-me.md"]);

    // Discard everything: the untracked secrets file is never deleted.
    expect(await ws.discard()).toEqual(["src/content/keep-me.md"]);
    expect(existsSync(join(root, ".env.local"))).toBe(true);
  });

  it("discards in a repo with zero commits by removing the new files", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" }, { commit: false });

    sh(root, "add", "-A");
    const ws = await workspaceFor(root);

    expect(await ws.discard()).toEqual(["src/content/a.md"]);
    expect(existsSync(join(root, "src/content/a.md"))).toBe(false);
    expect(sh(root, "status", "--porcelain")).toBe("");
  });
});
