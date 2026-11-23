import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChangeOrigin } from "../../src/types";
import { createWorkspace, type Workspace } from "../../src/workspace/index";
import { cleanupAll, makeRepo, sh, until, WRITABLE, writeTree } from "./helpers";

const open: Workspace[] = [];

afterEach(async () => {
  while (open.length) await open.pop()?.dispose();
  cleanupAll();
});

async function watched(root: string) {
  const ws = await createWorkspace(root, { writable: () => WRITABLE });
  const events: Array<{ paths: string[]; origin: ChangeOrigin }> = [];

  open.push(ws);
  ws.onChange((paths, origin) => events.push({ paths, origin }));
  // Let the native watcher settle before generating events.
  await new Promise((resolve) => setTimeout(resolve, 300));
  return { ws, events };
}

const external = (events: Array<{ paths: string[]; origin: ChangeOrigin }>) => events.filter((e) => e.origin === "external");

describe("watcher", () => {
  it("reports an edit made outside the app, once, debounced", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });
    const { ws, events } = await watched(root);

    writeFileSync(join(root, "src/content/a.md"), "b\n");
    writeFileSync(join(root, "src/content/a.md"), "c\n");
    await until(() => external(events).length > 0);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(external(events)).toEqual([{ paths: ["src/content/a.md"], origin: "external" }]);
    expect(ws.statusOf("src/content/a.md")).toBe("modified");
  });

  it("does not re-report the app's own writes as external", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });
    const { ws, events } = await watched(root);

    await ws.writeFile("src/content/a.md", "mine\n", { origin: "agent", mode: "content" });
    await ws.writeFile("src/content/new/b.md", "mine\n", { origin: "agent", mode: "content" });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(events.map((e) => e.origin)).toEqual(["agent", "agent"]);
  });

  it("does not report a discard or a publish as an external change", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });
    const { ws, events } = await watched(root);

    await ws.writeFile("src/content/a.md", "b\n", { origin: "user", mode: "content" });
    await ws.writeFile("src/content/new.md", "n\n", { origin: "user", mode: "content" });
    await ws.discard(["src/content/a.md"]);
    await ws.publish({ message: "Add new" }, { branch: "", mode: "commit", remote: null, push: false });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(events.map((e) => e.origin)).toEqual(["user", "user", "discard", "publish"]);
  });

  it("ignores node_modules, .git internals and build output", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n", ".gitignore": "dist/\nnode_modules/\n" });
    const { events } = await watched(root);

    writeTree(root, { "node_modules/x/index.js": "x", "dist/index.html": "x", ".astro/types.d.ts": "x" });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(external(events)).toEqual([]);
  });

  it("notices a commit made in a terminal and refreshes statuses", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });
    const { ws, events } = await watched(root);

    writeFileSync(join(root, "src/content/a.md"), "b\n");
    await until(() => ws.statusOf("src/content/a.md") === "modified");
    const before = external(events).length;

    sh(root, "commit", "-q", "-am", "From the terminal");
    await until(() => ws.statusOf("src/content/a.md") === "clean");
    await new Promise((resolve) => setTimeout(resolve, 400));
    const after = external(events).slice(before);

    expect(after).toEqual([{ paths: ["src/content/a.md"], origin: "external" }]);
  });

  it("stops emitting after dispose", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });
    const { ws, events } = await watched(root);

    await ws.dispose();
    writeFileSync(join(root, "src/content/a.md"), "b\n");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(events).toEqual([]);
  });
});
