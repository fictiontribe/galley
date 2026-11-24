import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withCaller } from "../../src/install/caller";
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
const typed = { origin: "user" as const, mode: "content" as const };
const read = (root: string, path: string) => readFileSync(join(root, path), "utf8");
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A signed-in person's request, as the server runs one. */
const as = <T>(accountId: string, work: () => T): T => withCaller({ accountId, role: "editor" }, work);

describe("checkpoints", () => {
  it("restores modified, created and deleted files — and nothing else", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n", "src/content/b.md": "b\n", "src/content/user.md": "u\n" });
    const ws = await workspaceFor(root);

    // A pending user edit from before the turn must survive the undo.
    await ws.writeFile("src/content/user.md", "user edit\n", typed);
    const checkpoint = ws.checkpoint("Turn 1");

    await checkpoint.run(async () => {
      await ws.writeFile("src/content/a.md", "a1\n", content);
      await ws.writeFile("src/content/a.md", "a2\n", content);
      await ws.writeFile("src/content/new/c.md", "c\n", content);
      await ws.deleteFile("src/content/b.md", content);
    });
    checkpoint.close();
    // Writes after close are not recorded, even from inside its own work.
    await checkpoint.run(() => ws.writeFile("src/content/user.md", "later edit\n", typed));
    expect(checkpoint.paths().sort()).toEqual(["src/content/a.md", "src/content/b.md", "src/content/new/c.md"]);

    const events: Array<[string[], string]> = [];

    ws.onChange((paths, origin) => events.push([paths, origin]));
    const restored = await checkpoint.restore();

    expect(restored.sort()).toEqual(["src/content/a.md", "src/content/b.md", "src/content/new/c.md"]);
    expect(checkpoint.left()).toEqual([]);
    expect(read(root, "src/content/a.md")).toBe("a\n");
    expect(read(root, "src/content/b.md")).toBe("b\n");
    expect(existsSync(join(root, "src/content/new/c.md"))).toBe(false);
    expect(read(root, "src/content/user.md")).toBe("later edit\n");
    expect(events).toEqual([[["src/content/a.md", "src/content/b.md", "src/content/new/c.md"], "undo"]]);
    expect(ws.statusOf("src/content/a.md")).toBe("clean");
    expect(ws.statusOf("src/content/b.md")).toBe("clean");
  });

  it("records nothing written outside its own work", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });
    const ws = await workspaceFor(root);
    const checkpoint = ws.checkpoint("open, but this write isn't its work");

    await ws.writeFile("src/content/a.md", "typed\n", typed);
    expect(checkpoint.paths()).toEqual([]);
    expect(await checkpoint.restore()).toEqual([]);
    expect(read(root, "src/content/a.md")).toBe("typed\n");
  });

  it("keeps what its work starts later as its own", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });
    const ws = await workspaceFor(root);
    const checkpoint = ws.checkpoint("turn");
    let later: Promise<void> = Promise.resolve();

    // Started inside the work, written after `run` has returned: a tool that finishes on a timer.
    checkpoint.run(() => {
      later = pause(10).then(() => ws.writeFile("src/content/a.md", "later\n", content));
    });
    await later;
    expect(checkpoint.paths()).toEqual(["src/content/a.md"]);
    await checkpoint.restore();
    expect(read(root, "src/content/a.md")).toBe("a\n");
  });

  it("keeps nested and overlapping checkpoints independent", async () => {
    const root = makeRepo({ "src/content/a.md": "0\n" });
    const ws = await workspaceFor(root);
    const outer = ws.checkpoint("outer");
    const inner = ws.checkpoint("inner");

    await outer.run(async () => {
      await ws.writeFile("src/content/a.md", "1\n", content);
      // Work inside work: both record it.
      await inner.run(async () => {
        await ws.writeFile("src/content/a.md", "2\n", content);
        await ws.writeFile("src/content/b.md", "b\n", content);
      });
      inner.close();
      expect(inner.paths().sort()).toEqual(["src/content/a.md", "src/content/b.md"]);

      await inner.restore();
      expect(read(root, "src/content/a.md")).toBe("1\n");
      expect(existsSync(join(root, "src/content/b.md"))).toBe(false);
    });

    await outer.restore();
    expect(outer.left()).toEqual([]);
    expect(read(root, "src/content/a.md")).toBe("0\n");
    expect(existsSync(join(root, "src/content/b.md"))).toBe(false);
  });

  it("restores writes made in build mode even though undo ignores the mode", async () => {
    const root = makeRepo({ "src/components/Hero.astro": "<h1>Old</h1>\n" });
    const ws = await workspaceFor(root);
    const checkpoint = ws.checkpoint("build turn");

    await checkpoint.run(() => ws.writeFile("src/components/Hero.astro", "<h1>New</h1>\n", { origin: "agent", mode: "build" }));
    await checkpoint.restore();
    expect(read(root, "src/components/Hero.astro")).toBe("<h1>Old</h1>\n");
  });

  it("spills large pre-images to the temp dir and cleans them up on release", async () => {
    const big = Buffer.alloc(SPILL_BYTES + 1024, 7);
    const root = makeRepo({ "public/images/big.bin.png": big });
    const ws = await workspaceFor(root);
    const before = readdirSync(tmpdir()).filter((n) => n.startsWith("galley-checkpoint-"));
    const checkpoint = ws.checkpoint("big");

    await checkpoint.run(() => ws.writeFile("public/images/big.bin.png", Buffer.from("small"), content));
    const spilled = readdirSync(tmpdir()).filter((n) => n.startsWith("galley-checkpoint-") && !before.includes(n));

    expect(spilled).toHaveLength(1);
    await checkpoint.restore();
    expect(readFileSync(join(root, "public/images/big.bin.png")).equals(big)).toBe(true);
    await checkpoint.release();
    expect(existsSync(join(tmpdir(), spilled[0] as string))).toBe(false);
    expect(await checkpoint.restore()).toEqual([]);
  });
});

describe("a checkpoint beside other people's work", () => {
  it("doesn't record another person's save to a different page made during the turn, so undo leaves it", async () => {
    const root = makeRepo({ "src/content/home.md": "home\n", "src/content/about.md": "about\n" });
    const ws = await workspaceFor(root);
    const turn = ws.checkpoint("Anna's assistant");

    // Both under way at once: Bob's save waits its turn behind the assistant's first write and lands before its second.
    const anna = as("anna", () =>
      turn.run(async () => {
        await ws.writeFile("src/content/home.md", "home, by the assistant\n", content);
        await pause(15);
        await ws.writeFile("src/content/home.md", "home, by the assistant again\n", content);
      })
    );
    const bob = as("bob", () => ws.writeFile("src/content/about.md", "about, by Bob\n", typed));

    await Promise.all([anna, bob]);
    turn.close();
    expect(turn.paths()).toEqual(["src/content/home.md"]);

    expect(await as("anna", () => turn.restore())).toEqual(["src/content/home.md"]);
    expect(turn.left()).toEqual([]);
    expect(read(root, "src/content/home.md")).toBe("home\n");
    expect(read(root, "src/content/about.md")).toBe("about, by Bob\n");
  });

  it("leaves a page someone else saved after the assistant's write, names it, and puts the rest back", async () => {
    const root = makeRepo({ "src/content/home.md": "home\n", "src/content/about.md": "about\n" });
    const ws = await workspaceFor(root);
    const turn = ws.checkpoint("Anna's assistant");

    await as("anna", () =>
      turn.run(async () => {
        await ws.writeFile("src/content/home.md", "home, by the assistant\n", content);
        await ws.writeFile("src/content/about.md", "about, by the assistant\n", content);
      })
    );
    turn.close();
    await as("bob", () => ws.writeFile("src/content/home.md", "home, by the assistant, then Bob\n", typed));

    const events: Array<[string[], string]> = [];

    ws.onChange((paths, origin) => events.push([paths, origin]));
    expect(await as("anna", () => turn.restore())).toEqual(["src/content/about.md"]);
    expect(turn.left()).toEqual(["src/content/home.md"]);
    expect(read(root, "src/content/home.md")).toBe("home, by the assistant, then Bob\n");
    expect(read(root, "src/content/about.md")).toBe("about\n");
    // Only what was put back is announced.
    expect(events).toEqual([[["src/content/about.md"], "undo"]]);
  });

  it("leaves a page someone else saved between two of the assistant's writes to it", async () => {
    const root = makeRepo({ "src/content/home.md": "home\n" });
    const ws = await workspaceFor(root);
    const turn = ws.checkpoint("Anna's assistant");
    let bobSaved: () => void = () => undefined;
    const afterBob = new Promise<void>((resolve) => (bobSaved = resolve));

    const anna = as("anna", () =>
      turn.run(async () => {
        await ws.writeFile("src/content/home.md", "one\n", content);
        await afterBob;
        // The assistant read the page again and wrote on top of Bob's save: his work is in the file now.
        await ws.writeFile("src/content/home.md", "one, Bob's line, two\n", content);
      })
    );

    await pause(5);
    await as("bob", () => ws.writeFile("src/content/home.md", "one, Bob's line\n", typed));
    bobSaved();
    await anna;

    expect(await turn.restore()).toEqual([]);
    expect(turn.left()).toEqual(["src/content/home.md"]);
    expect(read(root, "src/content/home.md")).toBe("one, Bob's line, two\n");
  });

  it("sees a save that was waiting its turn ahead of the undo", async () => {
    const root = makeRepo({ "src/content/home.md": "home\n" });
    const ws = await workspaceFor(root);
    const turn = ws.checkpoint("Anna's assistant");

    await turn.run(() => ws.writeFile("src/content/home.md", "home, by the assistant\n", content));
    // Not waited for: Bob's save is already in the queue when the undo joins it.
    const bob = as("bob", () => ws.writeFile("src/content/home.md", "home, by Bob\n", typed));
    const undo = as("anna", () => turn.restore());

    await bob;
    expect(await undo).toEqual([]);
    expect(turn.left()).toEqual(["src/content/home.md"]);
    expect(read(root, "src/content/home.md")).toBe("home, by Bob\n");
  });

  it("keeps two turns open at once apart, on separate pages and on a shared one", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n", "src/content/b.md": "b\n", "src/content/shared.md": "shared\n" });
    const ws = await workspaceFor(root);
    const annas = ws.checkpoint("Anna's assistant");
    const bobs = ws.checkpoint("Bob's assistant");

    const anna = as("anna", () =>
      annas.run(async () => {
        await ws.writeFile("src/content/a.md", "a, Anna's turn\n", content);
        await ws.writeFile("src/content/shared.md", "shared, Anna's turn\n", content);
        await pause(20);
      })
    );
    const bob = as("bob", () =>
      bobs.run(async () => {
        await ws.writeFile("src/content/b.md", "b, Bob's turn\n", content);
        await pause(10);
        await ws.writeFile("src/content/shared.md", "shared, Anna's turn, Bob's turn\n", content);
      })
    );

    await Promise.all([anna, bob]);
    annas.close();
    bobs.close();
    expect(annas.paths().sort()).toEqual(["src/content/a.md", "src/content/shared.md"]);
    expect(bobs.paths().sort()).toEqual(["src/content/b.md", "src/content/shared.md"]);

    // Anna undoes hers: her page goes back, Bob's stays, and the shared page (Bob's turn wrote it last) is left.
    expect(await annas.restore()).toEqual(["src/content/a.md"]);
    expect(annas.left()).toEqual(["src/content/shared.md"]);
    expect(read(root, "src/content/a.md")).toBe("a\n");
    expect(read(root, "src/content/b.md")).toBe("b, Bob's turn\n");
    expect(read(root, "src/content/shared.md")).toBe("shared, Anna's turn, Bob's turn\n");

    // Bob undoes his: both of his go back to what his turn found — the shared page with Anna's change still in it.
    expect((await bobs.restore()).sort()).toEqual(["src/content/b.md", "src/content/shared.md"]);
    expect(bobs.left()).toEqual([]);
    expect(read(root, "src/content/b.md")).toBe("b\n");
    expect(read(root, "src/content/shared.md")).toBe("shared, Anna's turn\n");
  });

  it("leaves a file another program rewrote after the turn", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });
    const ws = await workspaceFor(root);
    const checkpoint = ws.checkpoint("t");

    await checkpoint.run(() => ws.writeFile("src/content/a.md", "agent\n", content));
    writeFileSync(join(root, "src/content/a.md"), "outside\n");
    expect(await checkpoint.restore()).toEqual([]);
    expect(checkpoint.left()).toEqual(["src/content/a.md"]);
    expect(read(root, "src/content/a.md")).toBe("outside\n");
  });

  it("counts a file that is already back as it was as put back", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });
    const ws = await workspaceFor(root);
    const checkpoint = ws.checkpoint("t");

    await checkpoint.run(() => ws.writeFile("src/content/a.md", "agent\n", content));
    await ws.writeFile("src/content/a.md", "a\n", typed);
    expect(await checkpoint.restore()).toEqual(["src/content/a.md"]);
    expect(checkpoint.left()).toEqual([]);
    expect(read(root, "src/content/a.md")).toBe("a\n");
  });
});
