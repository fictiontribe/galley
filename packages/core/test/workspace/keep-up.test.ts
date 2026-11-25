/**
 * Keeping up with the code host: looking (what is new, changing no file) and
 * bringing newer versions in forward only — against a real bare repository
 * as the code host and a second clone as "someone publishing elsewhere".
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspace, hashContent, type Workspace } from "../../src/workspace/index";
import { addBareRemote, cleanupAll, makeRepo, PUBLISH, sh, tempDir, until, WRITABLE, writeTree } from "./helpers";

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

/**
 * A code host that is slow to answer: whenever this copy asks it for
 * versions, the answer waits for `release()`. `asked()` counts the times it
 * was asked. (git runs the program a remote names for serving its versions;
 * this one waits, then hands over to the real one.)
 */
function slowCodeHost(root: string) {
  const dir = tempDir("ws-slow-host-");
  const program = join(dir, "serve.sh");

  writeFileSync(program, `#!/bin/sh\necho asked >> '${dir}/asked'\nwhile [ ! -e '${dir}/go' ]; do sleep 0.05; done\nexec git upload-pack "$@"\n`, { mode: 0o755 });
  sh(root, "config", "remote.origin.uploadpack", program);
  return {
    asked: () => (existsSync(join(dir, "asked")) ? readFileSync(join(dir, "asked"), "utf8").trim().split("\n").length : 0),
    release: () => writeFileSync(join(dir, "go"), ""),
    hold: () => rmSync(join(dir, "go"), { force: true }),
  };
}

const SAVE = { origin: "user", mode: "content" } as const;
// The stand-in for a slow code host is a shell script.
const posix = process.platform !== "win32";

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
    // Get latest says the same, as somebody else's server not answering rather than a failure of this one.
    await expect(ws.getLatest()).rejects.toMatchObject({ code: "git", status: 502, message: failed.checkProblem });
    expect(read(site.root, "src/content/a.md")).toBe("a\n");
    // The plain status says the same until the next look works.
    expect((await ws.gitStatus()).checkProblem).toBe(failed.checkProblem);
  });

  it.skipIf(!posix)("never holds up a save while the code host is slow to answer, and looks asked for together are one look", async () => {
    const site = setUp({ "src/content/a.md": "a\n", "src/content/b.md": "b\n" });
    const ws = await workspaceFor(site.root);
    const host = slowCodeHost(site.root);

    site.elsewhere({ "src/content/a.md": "theirs\n" });
    let answered = false;
    const first = ws.check().finally(() => void (answered = true));
    const second = ws.check();
    const third = ws.check();

    await until(() => host.asked() === 1);
    // Saving, deleting and discarding all go through while the look is still waiting for its answer.
    await ws.writeFile("src/content/b.md", "saved\n", SAVE);
    await ws.writeFile("src/content/c.md", "new\n", SAVE);
    await ws.deleteFile("src/content/c.md", SAVE);
    expect(await ws.discard(["src/content/b.md"])).toEqual(["src/content/b.md"]);
    await ws.writeFile("src/content/b.md", "saved again\n", SAVE);
    expect(answered).toBe(false);
    expect(read(site.root, "src/content/b.md")).toBe("saved again\n");
    // The plain status doesn't wait either, and can't know yet.
    expect((await ws.gitStatus()).behind).toBe(0);
    expect(answered).toBe(false);

    host.release();
    const [a, b, c] = await Promise.all([first, second, third]);

    expect(a).toMatchObject({ behind: 1, ahead: 0, clean: false });
    expect(b.checkedAt).toBe(a.checkedAt);
    expect(c.checkedAt).toBe(a.checkedAt);
    expect(host.asked()).toBe(1);
    // A look asked for once that one has finished is a new look.
    await ws.check();
    expect(host.asked()).toBe(2);
  });

  it.skipIf(!posix)("a publish waits its turn behind a look rather than run beside it, and saves still don't wait", async () => {
    const site = setUp({ "src/content/a.md": "a\n", "src/content/b.md": "b\n" });
    const ws = await workspaceFor(site.root);
    const host = slowCodeHost(site.root);

    await ws.writeFile("src/content/b.md", "mine\n", SAVE);
    const looking = ws.check();

    await until(() => host.asked() === 1);
    let published = false;
    const publishing = ws.publish({ message: "Mine" }, { ...PUBLISH, push: false }).finally(() => void (published = true));

    await ws.writeFile("src/content/a.md", "saved meanwhile\n", SAVE);
    expect(published).toBe(false);
    expect(sh(site.root, "log", "--format=%s", "-1")).toBe("Initial");
    host.release();
    await looking;
    expect(await publishing).toMatchObject({ ok: true, pushed: false });
    // The save that went through first was pending by the time the publish ran, so it was published with it.
    expect(sh(site.root, "log", "--format=%s", "-1")).toBe("Mine");
    expect(sh(site.root, "show", "HEAD:src/content/a.md")).toBe("saved meanwhile");
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
    // Publishing is paused while newer versions wait, so it isn't offered as a way on: discarding is, with Proof to copy from.
    expect(result?.status.inTheWay?.message).toBe("The newer versions change a.md, which has unpublished changes here. Discard the change to that file (Proof shows it, so what you wrote can be copied first), then the newer versions can come in.");
    expect(result?.status.inTheWay?.message).not.toMatch(/merge|commit|fast-forward|branch|pull/i);
    expect(touched).toBe(false);
    expect(read(site.root, "src/content/a.md")).toBe("mine\n");
    expect(sh(site.root, "rev-parse", "HEAD")).toBe(head);
    // Get latest says the same, before anything is touched.
    await expect(ws.pull()).rejects.toMatchObject({ code: "conflict", status: 409, message: result?.status.inTheWay?.message });
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
  it.skipIf(!posix)("a round lets a save through while it looks, and holds back when that save is to a file the newer version changes", async () => {
    const site = setUp({ "src/content/a.md": "a\n", "src/content/b.md": "b\n" });
    const ws = await workspaceFor(site.root);
    const host = slowCodeHost(site.root);
    const head = sh(site.root, "rev-parse", "HEAD");
    const around: string[] = [];
    const hooks = { before: async () => void around.push("before"), after: async () => void around.push("after") };

    site.elsewhere({ "src/content/a.md": "theirs\n" });
    let finished = false;
    const round = ws.catchUp(hooks).finally(() => void (finished = true));

    await until(() => host.asked() === 1);
    await ws.writeFile("src/content/a.md", "mine\n", SAVE);
    expect(finished).toBe(false);
    host.release();
    const result = await round;

    expect(result).toMatchObject({ brought: 0, paths: [], status: { behind: 1, inTheWay: { kind: "changes", paths: ["src/content/a.md"] } } });
    expect(read(site.root, "src/content/a.md")).toBe("mine\n");
    expect(sh(site.root, "rev-parse", "HEAD")).toBe(head);
    expect(around).toEqual([]);
    // Once the change is out of the way the next round brings the version in.
    await ws.discard(["src/content/a.md"]);
    expect(await ws.catchUp(hooks)).toMatchObject({ brought: 1, paths: ["src/content/a.md"] });
    expect(read(site.root, "src/content/a.md")).toBe("theirs\n");
    expect(around).toEqual(["before", "after"]);
  });

  it.skipIf(!posix)("a round gives way to a publish that was asked for while it looked, and joins a look already going", async () => {
    const site = setUp({ "src/content/a.md": "a\n", "src/content/b.md": "b\n" });
    const ws = await workspaceFor(site.root);
    const host = slowCodeHost(site.root);

    site.elsewhere({ "src/content/a.md": "theirs\n" });
    await ws.writeFile("src/content/b.md", "mine\n", SAVE);
    // A person's look is going: the round asks nothing of its own.
    const looking = ws.check();

    await until(() => host.asked() === 1);
    const round = ws.catchUp();
    const publishing = ws.publish({ message: "Mine" }, { ...PUBLISH, push: false });

    host.release();
    expect(await round).toBeNull();
    expect(await publishing).toMatchObject({ ok: true, pushed: false });
    expect((await looking).behind).toBe(1);
    expect(host.asked()).toBe(1);
    expect(read(site.root, "src/content/a.md")).toBe("a\n");
  });

  it("a save that arrives while versions are coming in waits for them, and is refused if it was made from the older text", async () => {
    const site = setUp({ "src/content/a.md": "a\n", "src/content/b.md": "b\n" });
    const ws = await workspaceFor(site.root);
    const opened = hashContent(readFileSync(join(site.root, "src/content/a.md")));
    let stale: Promise<unknown> = Promise.resolve();
    let other: Promise<unknown> = Promise.resolve();

    site.elsewhere({ "src/content/a.md": "theirs\n" });
    const result = await ws.catchUp({
      // The round holds the save lock from here until the files have changed.
      before: async () => {
        stale = ws.writeFile("src/content/a.md", "mine, from the older text\n", { ...SAVE, baseHash: opened }).then(
          () => "saved",
          (error: unknown) => error
        );
        other = ws.writeFile("src/content/b.md", "mine\n", SAVE).then(() => "saved");
        // Neither has been written by the time the files change.
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(read(site.root, "src/content/a.md")).toBe("a\n");
        expect(read(site.root, "src/content/b.md")).toBe("b\n");
      },
      after: async () => undefined,
    });

    expect(result).toMatchObject({ brought: 1, paths: ["src/content/a.md"] });
    expect(await stale).toMatchObject({ code: "conflict", message: expect.stringMatching(/changed since you opened it/) });
    expect(await other).toBe("saved");
    expect(read(site.root, "src/content/a.md")).toBe("theirs\n");
    expect(read(site.root, "src/content/b.md")).toBe("mine\n");
  });

  it("starts the preview again even when stopping it failed, and changes nothing", async () => {
    const site = setUp({ "src/content/a.md": "a\n" });
    const ws = await workspaceFor(site.root);
    const head = sh(site.root, "rev-parse", "HEAD");
    const after: string[][] = [];
    const hooks = {
      before: async () => {
        throw new Error("the preview wouldn't stop");
      },
      after: async (paths: string[]) => void after.push(paths),
    };

    site.elsewhere({ "src/content/a.md": "theirs\n" });
    await expect(ws.catchUp(hooks)).rejects.toThrow("the preview wouldn't stop");
    await expect(ws.getLatest(hooks)).rejects.toThrow("the preview wouldn't stop");
    expect(after).toEqual([[], []]);
    expect(sh(site.root, "rev-parse", "HEAD")).toBe(head);
    expect(read(site.root, "src/content/a.md")).toBe("a\n");
    // The workspace is left free: the next one goes through.
    expect(await ws.catchUp()).toMatchObject({ brought: 1 });
  });

  it.skipIf(!posix)("runs none of the repository's own hooks while versions come in", async () => {
    const site = setUp({ "src/content/a.md": "a\n" });
    const ws = await workspaceFor(site.root);
    const ran = join(tempDir("ws-hooks-"), "ran");

    for (const hook of ["post-merge", "post-checkout", "pre-merge-commit", "post-rewrite", "reference-transaction"]) {
      writeFileSync(join(site.root, ".git", "hooks", hook), `#!/bin/sh\necho ${hook} >> '${ran}'\n`, { mode: 0o755 });
    }
    site.elsewhere({ "src/content/a.md": "theirs\n" }, "One");
    expect(await ws.catchUp()).toMatchObject({ brought: 1 });
    site.elsewhere({ "src/content/a.md": "theirs again\n" }, "Two");
    expect(await ws.getLatest()).toMatchObject({ brought: 1 });
    expect(read(site.root, "src/content/a.md")).toBe("theirs again\n");
    // Nothing of the site's ran for either. (Looking does run the one hook git has for it: it changes no file.)
    expect(existsSync(ran) ? readFileSync(ran, "utf8").split("\n").filter((line) => line && line !== "reference-transaction") : []).toEqual([]);
    // The hooks themselves are sound: the same step by hand, in a terminal, runs them.
    site.elsewhere({ "src/content/a.md": "by hand\n" }, "Three");
    sh(site.root, "pull", "-q", "--ff-only");
    expect(readFileSync(ran, "utf8")).toContain("post-merge");
  });

  it("holds back for an unpublished deletion of a file the newer version changes, and for a new file where the newer version adds one", async () => {
    const site = setUp({ "src/content/a.md": "a\n", "src/content/b.md": "b\n" });
    const ws = await workspaceFor(site.root);
    const head = sh(site.root, "rev-parse", "HEAD");
    let touched = false;
    const hooks = { before: async () => void (touched = true), after: async () => undefined };

    // Deleted here, changed there.
    await ws.deleteFile("src/content/a.md", SAVE);
    site.elsewhere({ "src/content/a.md": "theirs\n" });
    const deleted = await ws.catchUp(hooks);

    expect(deleted).toMatchObject({ brought: 0, status: { behind: 1, inTheWay: { kind: "changes", paths: ["src/content/a.md"] } } });
    await expect(ws.getLatest(hooks)).rejects.toMatchObject({ code: "conflict", message: deleted?.status.inTheWay?.message });
    expect(existsSync(join(site.root, "src/content/a.md"))).toBe(false);
    expect(ws.statusOf("src/content/a.md")).toBe("deleted");
    expect(sh(site.root, "rev-parse", "HEAD")).toBe(head);
    await ws.discard(["src/content/a.md"]);
    expect(await ws.catchUp(hooks)).toMatchObject({ brought: 1 });
    expect(read(site.root, "src/content/a.md")).toBe("theirs\n");

    // Made here and never published, and made there too.
    touched = false;
    await ws.writeFile("src/content/new.md", "mine\n", SAVE);
    site.elsewhere({ "src/content/new.md": "theirs\n", "src/content/b.md": "theirs\n" });
    const added = await ws.catchUp(hooks);

    expect(added).toMatchObject({ brought: 0, status: { behind: 1, inTheWay: { kind: "changes", paths: ["src/content/new.md"] } } });
    expect(added?.status.inTheWay?.message).toMatch(/Discard the change to that file \(Proof shows it/);
    expect(added?.status.inTheWay?.message).not.toMatch(/Publish or/i);
    await expect(ws.getLatest(hooks)).rejects.toMatchObject({ code: "conflict" });
    expect(touched).toBe(false);
    expect(read(site.root, "src/content/new.md")).toBe("mine\n");
    // Nothing came in part-way: the other file of that version is as it was.
    expect(read(site.root, "src/content/b.md")).toBe("b\n");
  });

  it("does nothing while the copy shows an older version or an operation from outside the app is half-done, and Get latest says so", async () => {
    const site = setUp({ "src/content/a.md": "a\n" });
    const ws = await workspaceFor(site.root);
    let touched = false;
    const hooks = { before: async () => void (touched = true), after: async () => undefined };

    site.elsewhere({ "src/content/a.md": "theirs\n" }, "One");
    site.elsewhere({ "src/content/a.md": "theirs again\n" }, "Two");
    // An older version checked out by hand: there is no line of versions to move forward.
    sh(site.root, "checkout", "-q", "--detach", "HEAD");
    const head = sh(site.root, "rev-parse", "HEAD");

    expect(await ws.catchUp(hooks)).toMatchObject({ brought: 0, paths: [], status: { detached: true } });
    const detached = await ws.getLatest(hooks).catch((error: unknown) => error);

    expect(detached).toMatchObject({ code: "invalid", message: expect.stringMatching(/older version/) });
    expect((detached as Error).message).not.toMatch(/fetch|branch|HEAD|commit/i);
    expect(sh(site.root, "rev-parse", "HEAD")).toBe(head);
    sh(site.root, "checkout", "-q", "main");
    expect(await ws.catchUp(hooks)).toMatchObject({ brought: 2 });
    touched = false;

    // Someone began undoing a version in a terminal and left it there.
    sh(site.root, "revert", "--no-commit", "HEAD");
    expect(existsSync(join(site.root, ".git", "REVERT_HEAD"))).toBe(true);
    site.elsewhere({ "src/content/a.md": "theirs once more\n" }, "Three");
    expect(await ws.catchUp(hooks)).toMatchObject({ brought: 0, paths: [] });
    await expect(ws.getLatest(hooks)).rejects.toMatchObject({ code: "busy", message: expect.stringMatching(/another operation/) });
    expect(touched).toBe(false);
    expect(read(site.root, "src/content/a.md")).not.toContain("once more");
    // Cancelled there: the next round brings the version in.
    sh(site.root, "revert", "--abort");
    expect(await ws.catchUp(hooks)).toMatchObject({ brought: 1 });
    expect(read(site.root, "src/content/a.md")).toBe("theirs once more\n");
  });
});
