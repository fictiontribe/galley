import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { outsideAnyPerson, withCaller } from "../../src/install/caller";
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
    // A write after close, by someone else: not this checkpoint's, in any way.
    await ws.writeFile("src/content/user.md", "later edit\n", typed);
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

describe("what a checkpoint's own work does after it is closed", () => {
  it("is not put back, and is named: a write that was still on its way when the reply ended", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n", "src/content/b.md": "b\n" });
    const ws = await workspaceFor(root);
    const turn = ws.checkpoint("turn");
    let late: Promise<void> = Promise.resolve();

    await turn.run(async () => {
      await ws.writeFile("src/content/a.md", "a, by the turn\n", content);
      // Started by the turn, landing after it has ended.
      late = pause(15).then(() => ws.writeFile("src/content/b.md", "b, late\n", content));
    });
    turn.close();
    expect(turn.paths()).toEqual(["src/content/a.md"]);
    await late;

    expect(await turn.restore()).toEqual(["src/content/a.md"]);
    expect(turn.left()).toEqual(["src/content/b.md"]);
    expect(read(root, "src/content/a.md")).toBe("a\n");
    expect(read(root, "src/content/b.md")).toBe("b, late\n");
  });

  it("leaves a page it wrote again after closing", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });
    const ws = await workspaceFor(root);
    const turn = ws.checkpoint("turn");
    let late: Promise<void> = Promise.resolve();

    await turn.run(async () => {
      await ws.writeFile("src/content/a.md", "one\n", content);
      late = pause(15).then(() => ws.writeFile("src/content/a.md", "two\n", content));
    });
    turn.close();
    await late;

    expect(await turn.restore()).toEqual([]);
    expect(turn.left()).toEqual(["src/content/a.md"]);
    expect(read(root, "src/content/a.md")).toBe("two\n");
  });
});

describe("what is made during a turn to serve everyone after", () => {
  it("is nobody's work: its writes are not the turn's, then or later", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n", "src/content/watched.md": "w\n" });
    const ws = await workspaceFor(root);
    const turn = ws.checkpoint("turn");
    let later: Promise<void> = Promise.resolve();

    await turn.run(async () => {
      await ws.writeFile("src/content/a.md", "a, by the turn\n", content);
      // A site opened during the turn: its watcher and timers start here and go on for everyone.
      await outsideAnyPerson(async () => {
        await ws.writeFile("src/content/watched.md", "w, at once\n", typed);
        later = pause(10).then(() => ws.writeFile("src/content/watched.md", "w, later\n", typed));
      });
      await later;
    });
    turn.close();
    expect(turn.paths()).toEqual(["src/content/a.md"]);
    expect(await turn.restore()).toEqual(["src/content/a.md"]);
    expect(turn.left()).toEqual([]);
    expect(read(root, "src/content/watched.md")).toBe("w, later\n");
  });
});

describe("an undo that can't finish", () => {
  it("puts back what it can, names the rest, and says what it put back", async () => {
    const big = Buffer.alloc(SPILL_BYTES + 1024, 7);
    const root = makeRepo({ "src/content/a.md": "a\n", "public/images/big.bin.png": big, "src/content/z.md": "z\n" });
    const ws = await workspaceFor(root);
    const before = readdirSync(tmpdir()).filter((n) => n.startsWith("galley-checkpoint-"));
    const turn = ws.checkpoint("turn");

    await turn.run(async () => {
      await ws.writeFile("src/content/a.md", "a, by the turn\n", content);
      await ws.writeFile("public/images/big.bin.png", Buffer.from("small"), content);
      await ws.writeFile("src/content/z.md", "z, by the turn\n", content);
    });
    turn.close();
    // What the large file was is kept beside the system's temporary files, and those can be cleared away.
    for (const dir of readdirSync(tmpdir()).filter((n) => n.startsWith("galley-checkpoint-") && !before.includes(n))) rmSync(join(tmpdir(), dir), { recursive: true, force: true });

    const events: Array<[string[], string]> = [];

    ws.onChange((paths, origin) => events.push([paths, origin]));
    expect((await turn.restore()).sort()).toEqual(["src/content/a.md", "src/content/z.md"]);
    expect(turn.left()).toEqual(["public/images/big.bin.png"]);
    expect(read(root, "src/content/a.md")).toBe("a\n");
    expect(read(root, "src/content/z.md")).toBe("z\n");
    expect(read(root, "public/images/big.bin.png")).toBe("small");
    expect(events).toEqual([[["src/content/a.md", "src/content/z.md"], "undo"]]);
  });
});

describe("a page the turn moved", () => {
  const OLD = "src/content/pages/about.md";
  const NEW = "src/content/pages/about-us.md";
  const page = (title: string) => `---\ntitle: ${title}\n---\nWe are four people.\nWe draw houses.\nCome and see us.\n`;

  async function moved() {
    const root = makeRepo({ [OLD]: page("About"), "src/content/pages/other.md": "other\n" });
    const ws = await workspaceFor(root);
    const turn = ws.checkpoint("turn");

    await turn.run(async () => {
      await ws.writeFile(NEW, page("About us"), content);
      await ws.deleteFile(OLD, content);
      await ws.writeFile("src/content/pages/other.md", "other, by the turn\n", content);
    });
    turn.close();
    return { root, ws, turn };
  }

  it("goes back as a pair", async () => {
    const { root, turn } = await moved();

    expect((await turn.restore()).sort()).toEqual([NEW, OLD, "src/content/pages/other.md"].sort());
    expect(turn.left()).toEqual([]);
    expect(read(root, OLD)).toBe(page("About"));
    expect(existsSync(join(root, NEW))).toBe(false);
  });

  it("stays as a pair when someone changed it under its new name: never the page twice", async () => {
    const { root, ws, turn } = await moved();

    await as("bob", () => ws.writeFile(NEW, `${page("About us")}And Bob's line.\n`, typed));
    expect(await turn.restore()).toEqual(["src/content/pages/other.md"]);
    expect(turn.left().sort()).toEqual([NEW, OLD].sort());
    expect(existsSync(join(root, OLD))).toBe(false);
    expect(read(root, NEW)).toContain("And Bob's line.");
    expect(read(root, "src/content/pages/other.md")).toBe("other\n");
  });

  it("is not assumed of a page removed and an unrelated page made", async () => {
    const root = makeRepo({ [OLD]: page("About") });
    const ws = await workspaceFor(root);
    const turn = ws.checkpoint("turn");

    await turn.run(async () => {
      await ws.deleteFile(OLD, content);
      await ws.writeFile("src/content/pages/prices.md", "---\ntitle: Prices\n---\nA first visit is free.\n", content);
    });
    turn.close();
    await as("bob", () => ws.writeFile("src/content/pages/prices.md", "---\ntitle: Prices\n---\nBob's prices.\n", typed));

    // Two changes, not one page: the removed page comes back though the new one was changed.
    expect(await turn.restore()).toEqual([OLD]);
    expect(turn.left()).toEqual(["src/content/pages/prices.md"]);
    expect(read(root, OLD)).toBe(page("About"));
  });
});

