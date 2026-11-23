import { readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspace, type Workspace } from "../../src/workspace/index";
import { cleanupAll, makeRepo, tempDir, WRITABLE } from "./helpers";

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

describe("system writes", () => {
  it("write a file outside every writable glob, atomically, and report it as a change", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });
    const ws = await workspaceFor(root);
    const events: Array<[string[], string]> = [];

    ws.onChange((paths, origin) => events.push([paths, origin]));
    await expect(ws.writeFile("galley.config.json", "{}\n", { origin: "user", mode: "content" })).rejects.toMatchObject({ code: "forbidden" });
    await ws.writeFile("galley.config.json", "{}\n", { origin: "user", mode: "content", system: true });
    expect(readFileSync(join(root, "galley.config.json"), "utf8")).toBe("{}\n");
    expect(ws.statusOf("galley.config.json")).toBe("added");
    expect(ws.pendingPaths()).toEqual(["galley.config.json"]);
    expect(events).toEqual([[["galley.config.json"], "user"]]);
  });

  it("still refuse the hard deny-list and anything outside the site", async () => {
    const root = makeRepo({ "a.md": "a\n" });
    const outside = tempDir("ws-outside-");

    symlinkSync(outside, join(root, "linked"));
    const ws = await workspaceFor(root);
    const system = { origin: "user" as const, mode: "build" as const, system: true };

    for (const path of [".git/config", "node_modules/x.js", ".env", "package-lock.json", "../x.json", "linked/x.json"]) {
      await expect(ws.writeFile(path, "x", system), path).rejects.toMatchObject({ code: "forbidden" });
    }
  });
});
