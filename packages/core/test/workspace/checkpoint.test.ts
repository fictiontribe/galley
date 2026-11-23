import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspace, SPILL_BYTES, type Workspace } from "../../src/workspace/index";
import { cleanupAll, makeRepo, WRITABLE } from "./helpers";

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

const content = { origin: "agent" as const, mode: "content" as const };

describe("checkpoints", () => {
  it("restores modified, created and deleted files — and nothing else", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n", "src/content/b.md": "b\n", "src/content/user.md": "u\n" });
    const ws = await workspaceFor(root);

    // A pending user edit from before the turn must survive the undo.
    await ws.writeFile("src/content/user.md", "user edit\n", { origin: "user", mode: "content" });
    const checkpoint = ws.checkpoint("Turn 1");

    await ws.writeFile("src/content/a.md", "a1\n", content);
    await ws.writeFile("src/content/a.md", "a2\n", content);
    await ws.writeFile("src/content/new/c.md", "c\n", content);
    await ws.deleteFile("src/content/b.md", content);
    checkpoint.close();
    // Writes after close are not recorded.
    await ws.writeFile("src/content/user.md", "later edit\n", { origin: "user", mode: "content" });
    expect(checkpoint.paths().sort()).toEqual(["src/content/a.md", "src/content/b.md", "src/content/new/c.md"]);

    const events: Array<[string[], string]> = [];

    ws.onChange((paths, origin) => events.push([paths, origin]));
    const restored = await checkpoint.restore();

    expect(restored.sort()).toEqual(["src/content/a.md", "src/content/b.md", "src/content/new/c.md"]);
    expect(readFileSync(join(root, "src/content/a.md"), "utf8")).toBe("a\n");
    expect(readFileSync(join(root, "src/content/b.md"), "utf8")).toBe("b\n");
    expect(existsSync(join(root, "src/content/new/c.md"))).toBe(false);
    expect(readFileSync(join(root, "src/content/user.md"), "utf8")).toBe("later edit\n");
    expect(events).toEqual([[["src/content/a.md", "src/content/b.md", "src/content/new/c.md"], "undo"]]);
    expect(ws.statusOf("src/content/a.md")).toBe("clean");
    expect(ws.statusOf("src/content/b.md")).toBe("clean");
  });

  it("keeps nested and overlapping checkpoints independent", async () => {
    const root = makeRepo({ "src/content/a.md": "0\n" });
    const ws = await workspaceFor(root);
    const outer = ws.checkpoint("outer");

    await ws.writeFile("src/content/a.md", "1\n", content);
    const inner = ws.checkpoint("inner");

    await ws.writeFile("src/content/a.md", "2\n", content);
    await ws.writeFile("src/content/b.md", "b\n", content);
    inner.close();
    expect(inner.paths().sort()).toEqual(["src/content/a.md", "src/content/b.md"]);

    await inner.restore();
    expect(readFileSync(join(root, "src/content/a.md"), "utf8")).toBe("1\n");
    expect(existsSync(join(root, "src/content/b.md"))).toBe(false);

    await outer.restore();
    expect(readFileSync(join(root, "src/content/a.md"), "utf8")).toBe("0\n");
    expect(existsSync(join(root, "src/content/b.md"))).toBe(false);
  });

  it("restores writes made in build mode even though undo ignores the mode", async () => {
    const root = makeRepo({ "src/components/Hero.astro": "<h1>Old</h1>\n" });
    const ws = await workspaceFor(root);
    const checkpoint = ws.checkpoint("build turn");

    await ws.writeFile("src/components/Hero.astro", "<h1>New</h1>\n", { origin: "agent", mode: "build" });
    await checkpoint.restore();
    expect(readFileSync(join(root, "src/components/Hero.astro"), "utf8")).toBe("<h1>Old</h1>\n");
  });

  it("spills large pre-images to the temp dir and cleans them up on release", async () => {
    const big = Buffer.alloc(SPILL_BYTES + 1024, 7);
    const root = makeRepo({ "public/images/big.bin.png": big });
    const ws = await workspaceFor(root);
    const before = readdirSync(tmpdir()).filter((n) => n.startsWith("galley-checkpoint-"));
    const checkpoint = ws.checkpoint("big");

    await ws.writeFile("public/images/big.bin.png", Buffer.from("small"), content);
    const spilled = readdirSync(tmpdir()).filter((n) => n.startsWith("galley-checkpoint-") && !before.includes(n));

    expect(spilled).toHaveLength(1);
    await checkpoint.restore();
    expect(readFileSync(join(root, "public/images/big.bin.png")).equals(big)).toBe(true);
    await checkpoint.release();
    expect(existsSync(join(tmpdir(), spilled[0] as string))).toBe(false);
    expect(await checkpoint.restore()).toEqual([]);
  });

  it("restores a file the user rewrote outside the app back to its pre-turn bytes", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });
    const ws = await workspaceFor(root);
    const checkpoint = ws.checkpoint("t");

    await ws.writeFile("src/content/a.md", "agent\n", content);
    writeFileSync(join(root, "src/content/a.md"), "outside\n");
    await checkpoint.restore();
    expect(readFileSync(join(root, "src/content/a.md"), "utf8")).toBe("a\n");
  });
});
