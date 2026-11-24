/**
 * Keeping up with the code host: looking (what is new, changing no file) and
 * bringing newer versions in forward only — against a real bare repository
 * as the code host and a second clone as "someone publishing elsewhere".
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspace, type Workspace } from "../../src/workspace/index";
import { addBareRemote, cleanupAll, makeRepo, PUBLISH, sh, tempDir, WRITABLE, writeTree } from "./helpers";

// Many real git processes per test (see publish.test.ts); nothing here waits on a timer.
const GIT_HEAVY = { timeout: 120_000 };
const open: Workspace[] = [];

afterEach(async () => {
  while (open.length) await open.pop()?.dispose();
  cleanupAll();
});

async function workspaceFor(root: string): Promise<Workspace> {
  const ws = await createWorkspace(root, { writable: () => WRITABLE, author: () => ({ name: "Sam", email: "sam@example.com" }), watch: false });

  open.push(ws);
  return ws;
}

/** A copy with a code host, and a way to publish there from elsewhere. */
function setUp(files: Record<string, string>) {
  const root = makeRepo(files);
  const bare = addBareRemote(root);
  const other = tempDir("ws-other-");

  sh(other, "clone", "-q", bare, ".");
  return {
    root,
    bare,
    elsewhere(changes: Record<string, string>, message = "Their change") {
      writeTree(other, changes);
      sh(other, "add", "-A");
      sh(other, "commit", "-q", "-m", message);
      sh(other, "push", "-q", "origin", "main");
    },
  };
}

const read = (root: string, path: string) => readFileSync(join(root, path), "utf8");

describe("looking at the code host", GIT_HEAVY, () => {
  it("finds newer versions without touching a file, and a look that fails says why and changes nothing", async () => {
    const site = setUp({ "src/content/a.md": "a\n" });
    const ws = await workspaceFor(site.root);
    const head = sh(site.root, "rev-parse", "HEAD");

    expect(await ws.gitStatus()).toMatchObject({ behind: 0, checkedAt: null });
    site.elsewhere({ "src/content/a.md": "theirs\n" });
    // What was last seen of the code host is old: the plain status can't know yet.
    expect((await ws.gitStatus()).behind).toBe(0);
    const events: string[][] = [];

    ws.onChange((paths) => events.push(paths));
    const looked = await ws.check();

    expect(looked).toMatchObject({ behind: 1, ahead: 0 });
    expect(looked.checkProblem).toBeUndefined();
    expect(looked.inTheWay).toBeUndefined();
    expect(Date.now() - Date.parse(looked.checkedAt ?? "")).toBeLessThan(60_000);
    expect(read(site.root, "src/content/a.md")).toBe("a\n");
    expect(sh(site.root, "rev-parse", "HEAD")).toBe(head);
    expect(sh(site.root, "status", "--porcelain")).toBe("");
    expect(events).toEqual([]);

    // The code host goes away: the look says so in one plain sentence, doesn't throw, and keeps when it last worked.
    sh(site.root, "remote", "set-url", "origin", join(site.root, "..", "no-such-repository.git"));
    const failed = await ws.check();

    expect(failed.checkProblem).toMatch(/\.$/);
    expect(failed.checkProblem).not.toMatch(/fatal|fetch|origin|remote ref/i);
    expect(failed).toMatchObject({ behind: 1, checkedAt: looked.checkedAt });
    expect(sh(site.root, "rev-parse", "HEAD")).toBe(head);
    expect(read(site.root, "src/content/a.md")).toBe("a\n");
    // The plain status says the same until the next look works.
    expect((await ws.gitStatus()).checkProblem).toBe(failed.checkProblem);
  });
});

describe("bringing newer versions in", GIT_HEAVY, () => {
  it("moves forward, reports the files, and isn't stopped by unpublished changes to a file it doesn't touch", async () => {
    const site = setUp({ "src/content/a.md": "a\n", "src/content/b.md": "b\n" });
    const ws = await workspaceFor(site.root);

    writeFileSync(join(site.root, "src/content/b.md"), "mine\n");
    site.elsewhere({ "src/content/a.md": "theirs\n", "src/content/new.md": "new\n" }, "One");
    site.elsewhere({ "src/content/a.md": "theirs again\n" }, "Two");
    const events: Array<[string[], string]> = [];
    const around: string[] = [];

    ws.onChange((paths, origin) => events.push([paths, origin]));
    const result = await ws.catchUp({ before: async () => void around.push("before"), after: async (paths) => void around.push(`after ${paths.join(",")}`) });

    expect(result).toMatchObject({ brought: 2, paths: ["src/content/a.md", "src/content/new.md"], status: { behind: 0, ahead: 0, lastCommit: { message: "Two" } } });
    expect(read(site.root, "src/content/a.md")).toBe("theirs again\n");
    expect(read(site.root, "src/content/b.md")).toBe("mine\n");
    expect(ws.statusOf("src/content/b.md")).toBe("modified");
    expect(events).toEqual([[["src/content/a.md", "src/content/new.md"], "external"]]);
    expect(around).toEqual(["before", "after src/content/a.md,src/content/new.md"]);

    // Nothing new: nothing changes, and the hooks around files changing don't run.
    expect(await ws.catchUp({ before: async () => void around.push("again") , after: async () => void around.push("again") })).toMatchObject({ brought: 0, paths: [] });
    expect(around).toHaveLength(2);
  });

  it("is stopped, with the plain reason, by an unpublished change to a file the newer version changes — and leaves everything as it was", async () => {
    const site = setUp({ "src/content/a.md": "a\n" });
    const ws = await workspaceFor(site.root);
    const head = sh(site.root, "rev-parse", "HEAD");

    writeFileSync(join(site.root, "src/content/a.md"), "mine\n");
    site.elsewhere({ "src/content/a.md": "theirs\n" });
    let touched = false;
    const result = await ws.catchUp({ before: async () => void (touched = true), after: async () => undefined });

    expect(result).toMatchObject({ brought: 0, paths: [], status: { behind: 1, inTheWay: { kind: "changes", paths: ["src/content/a.md"] } } });
    expect(result?.status.inTheWay?.message).toContain("a.md");
    expect(result?.status.inTheWay?.message).toMatch(/Publish or discard/);
    expect(result?.status.inTheWay?.message).not.toMatch(/merge|commit|fast-forward|branch|pull/i);
    expect(touched).toBe(false);
    expect(read(site.root, "src/content/a.md")).toBe("mine\n");
    expect(sh(site.root, "rev-parse", "HEAD")).toBe(head);
    // Get latest says the same, before anything is touched.
    await expect(ws.pull()).rejects.toMatchObject({ code: "git", message: result?.status.inTheWay?.message });
    expect(read(site.root, "src/content/a.md")).toBe("mine\n");
  });

  it("says when the two have gone separate ways, and never runs while a publish is in progress", async () => {
    const site = setUp({ "src/content/a.md": "a\n", "src/content/b.md": "b\n" });
    const ws = await workspaceFor(site.root);

    writeFileSync(join(site.root, "src/content/b.md"), "mine\n");
    // A publish holds the workspace for its whole run: the round doesn't wait behind it, it skips.
    const publishing = ws.publish({ message: "Mine" }, { ...PUBLISH, push: false });

    expect(await ws.catchUp()).toBeNull();
    expect(await publishing).toMatchObject({ ok: true, pushed: false });
    site.elsewhere({ "src/content/a.md": "theirs\n" });
    const head = sh(site.root, "rev-parse", "HEAD");
    const result = await ws.catchUp();

    expect(result).toMatchObject({ brought: 0, status: { ahead: 1, behind: 1, inTheWay: { kind: "separate-ways", paths: [] } } });
    expect(result?.status.inTheWay?.message).toMatch(/separate ways/);
    expect(result?.status.inTheWay?.message).toMatch(/Someone who knows the repository/);
    expect(sh(site.root, "rev-parse", "HEAD")).toBe(head);
    expect(read(site.root, "src/content/a.md")).toBe("a\n");
  });
});
