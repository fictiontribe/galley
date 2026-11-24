import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { git, type GitCommandError } from "../../src/workspace/git";
import { compareUrl, createWorkspace, parseRemoteUrl, redactRemoteUrl, type Workspace } from "../../src/workspace/index";
import { classifyLookError, classifyPullError } from "../../src/workspace/publish";
import { addBareRemote, cleanupAll, makeRepo, PUBLISH, sh, tempDir, WRITABLE, writeTree } from "./helpers";

/**
 * Each test here runs dozens of real git processes one after another (60 for
 * a publish-and-undo), each 15–300 ms depending on how busy the machine is —
 * on macOS /usr/bin/git is a shim that looks the real binary up every time.
 * Alone they take 2–11 s; in the full suite, beside real dev servers and
 * installs, the default 30 s was a timing assumption that failed. Nothing
 * here waits on a timer, so a longer limit only stops a slow machine from
 * failing them.
 */
const GIT_HEAVY = { timeout: 120_000 };

const open: Workspace[] = [];
const AUTHOR = { name: "Ana Editor", email: "ana@example.org" };

async function workspaceFor(root: string, author: { name: string; email: string } | null = AUTHOR): Promise<Workspace> {
  const ws = await createWorkspace(root, { writable: () => WRITABLE, author: () => author, watch: false });

  open.push(ws);
  return ws;
}

afterEach(async () => {
  while (open.length) await open.pop()?.dispose();
  cleanupAll();
});

describe("publish", GIT_HEAVY, () => {
  it("commits only the requested paths with the trailer and author, then pushes", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n", "src/content/b.md": "b\n", "src/content/gone.md": "x\n" });
    const bare = addBareRemote(root);

    writeFileSync(join(root, "src/content/a.md"), "a2\n");
    writeFileSync(join(root, "src/content/b.md"), "b2\n");
    writeTree(root, { "src/content/new.md": "n\n" });
    sh(root, "rm", "-q", "src/content/gone.md");
    // Something the user staged themselves must not ride along.
    sh(root, "add", "src/content/b.md");
    const ws = await workspaceFor(root);
    const events: Array<[string[], string]> = [];

    ws.onChange((paths, origin) => events.push([paths, origin]));
    const result = await ws.publish(
      { message: "Refresh the about page", paths: ["src/content/a.md", "src/content/new.md", "src/content/gone.md"] },
      PUBLISH
    );

    expect(result).toMatchObject({ ok: true, branch: "main", pushed: true, files: ["src/content/a.md", "src/content/gone.md", "src/content/new.md"] });
    expect(result.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(sh(root, "log", "-1", "--format=%B")).toBe("Refresh the about page\n\nGalley-Publish: 1");
    expect(sh(root, "log", "-1", "--format=%an <%ae>|%cn <%ce>")).toBe("Ana Editor <ana@example.org>|Ana Editor <ana@example.org>");
    expect(sh(root, "show", "--name-status", "--format=", "HEAD").split("\n").sort()).toEqual([
      "A\tsrc/content/new.md",
      "D\tsrc/content/gone.md",
      "M\tsrc/content/a.md",
    ]);
    expect(sh(bare, "rev-parse", "main")).toBe(result.commit);
    // b.md is still pending (and still staged, as the user left it).
    expect(sh(root, "status", "--porcelain")).toBe("M  src/content/b.md");
    expect(ws.statusOf("src/content/a.md")).toBe("clean");
    expect(ws.statusOf("src/content/b.md")).toBe("modified");
    expect(events).toEqual([[["src/content/a.md", "src/content/gone.md", "src/content/new.md"], "publish"]]);
  });

  it("uses describe(), then a default, for the message; falls back to git config and a neutral author", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });

    writeFileSync(join(root, "src/content/a.md"), "b\n");
    const ws = await workspaceFor(root, null);
    const result = await ws.publish({}, { ...PUBLISH, remote: null }, (files) => `Update ${files.length} page`);

    expect(result).toMatchObject({ ok: true, pushed: false });
    expect(result.pushError).toBeUndefined();
    expect(sh(root, "log", "-1", "--format=%s|%an")).toBe("Update 1 page|Site editor");

    sh(root, "config", "user.name", "Repo Person");
    sh(root, "config", "user.email", "repo@example.org");
    writeFileSync(join(root, "src/content/a.md"), "c\n");
    await ws.publish({}, { ...PUBLISH, remote: null });
    expect(sh(root, "log", "-1", "--format=%s|%an <%ae>")).toBe("Update a.md|Repo Person <repo@example.org>");
  });

  it("creates the first commit in a repo with zero commits", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n", "package.json": "{}\n" }, { commit: false });
    const ws = await workspaceFor(root);
    const result = await ws.publish({ message: "First version" }, PUBLISH);

    expect(result).toMatchObject({ ok: true, pushed: false, files: ["package.json", "src/content/a.md"] });
    expect(sh(root, "log", "--format=%s")).toBe("First version");
    expect((await ws.changes()).files).toEqual([]);
  });

  it("commits without error when there is no remote", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });

    writeFileSync(join(root, "src/content/a.md"), "b\n");
    const ws = await workspaceFor(root);
    const result = await ws.publish({ message: "Edit" }, PUBLISH);

    expect(result).toMatchObject({ ok: true, pushed: false });
    expect(result.pushError).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it("pauses a publish on top of an older copy, before anything is committed, so getting the latest works", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });
    const bare = addBareRemote(root);
    const other = tempDir("ws-other-");

    sh(other, "clone", "-q", bare, ".");
    writeTree(other, { "src/content/theirs.md": "theirs\n" });
    sh(other, "add", "-A");
    sh(other, "commit", "-q", "-m", "Their change");
    sh(other, "push", "-q", "origin", "main");

    writeFileSync(join(root, "src/content/a.md"), "mine\n");
    const ws = await workspaceFor(root);
    const before = sh(root, "log", "-1", "--format=%s");
    const paused = await ws.publish({ message: "Mine" }, PUBLISH);

    expect(paused).toMatchObject({ ok: false, pushed: false, behind: true, error: expect.stringContaining("The live site has newer changes than this copy") });
    expect(paused.error).not.toMatch(/branch|push|remote|commit/i);
    // Nothing was committed, so "Get the latest" can fast-forward under the pending edit, and the publish then goes through.
    expect(sh(root, "log", "-1", "--format=%s")).toBe(before);
    await ws.pull();
    expect(readFileSync(join(root, "src/content/a.md"), "utf8")).toBe("mine\n");
    expect(await ws.publish({ message: "Mine" }, PUBLISH)).toMatchObject({ ok: true, pushed: true });
    expect(sh(bare, "log", "-1", "--format=%s", "main")).toBe("Mine");
  });

  it("keeps the commit and explains a push refused because someone published at the same moment", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });
    const bare = addBareRemote(root);
    const other = tempDir("ws-other-");
    const ws = await workspaceFor(root);

    // Published here without sending, then someone else publishes: sending now is refused.
    writeFileSync(join(root, "src/content/a.md"), "mine\n");
    await ws.publish({ message: "Mine" }, { ...PUBLISH, push: false });
    sh(other, "clone", "-q", bare, ".");
    writeTree(other, { "src/content/theirs.md": "theirs\n" });
    sh(other, "add", "-A");
    sh(other, "commit", "-q", "-m", "Their change");
    sh(other, "push", "-q", "origin", "main");
    const result = await ws.send(PUBLISH);

    expect(result).toMatchObject({ ok: true, pushed: false, pushError: expect.stringContaining("A developer needs to combine the two versions") });
    expect(result.pushError).not.toMatch(/pull|branch|remote|commit/i);
    expect(result.detail).toMatch(/rejected/);
    expect(sh(root, "log", "-1", "--format=%s")).toBe("Mine");

    // Pull refuses to combine diverged histories, in plain words.
    await expect(ws.pull()).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("can't be combined automatically") });
  });

  it("refuses on a detached HEAD, in a non-repo, with nothing pending, and on a branch mismatch", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });

    sh(root, "checkout", "-q", "--detach");
    writeFileSync(join(root, "src/content/a.md"), "b\n");
    const ws = await workspaceFor(root);

    expect(await ws.publish({}, PUBLISH)).toMatchObject({ ok: false, pushed: false, error: expect.stringContaining("showing an older version") });
    sh(root, "checkout", "-q", "main");
    // The names are for whoever fixes it: in the detail, not in the sentence.
    expect(await ws.publish({}, { ...PUBLISH, branch: "production" })).toMatchObject({ ok: false, error: expect.stringContaining("different copy of its history"), detail: expect.stringContaining("“production”") });
    expect(await ws.publish({ paths: ["src/content/clean.md"] }, PUBLISH)).toMatchObject({ ok: false, error: "None of those files have changes to publish." });

    const plain = tempDir("ws-plain-");

    writeTree(plain, { "a.md": "a" });
    const plainWs = await workspaceFor(plain);
    const refused = await plainWs.publish({}, PUBLISH);

    expect(refused).toMatchObject({ ok: false, files: [], pushed: false });
    expect(refused.error).toContain("isn't set up for publishing yet");
    expect(await plainWs.history()).toEqual([]);
    expect(await plainWs.gitStatus()).toEqual({ branch: "", detached: false, hasRemote: false, ahead: 0, behind: 0, clean: true });
  });

  it("respects the repo's hooks and reports a failing hook's output", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });
    const hook = join(root, ".git/hooks/pre-commit");

    writeFileSync(hook, "#!/bin/sh\necho 'lint: missing alt text' >&2\nexit 1\n");
    chmodSync(hook, 0o755);
    writeFileSync(join(root, "src/content/a.md"), "b\n");
    const ws = await workspaceFor(root);
    const result = await ws.publish({ message: "Edit" }, PUBLISH);

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("checks stopped the publish") });
    expect(result.detail).toContain("lint: missing alt text");
    expect(sh(root, "log", "--format=%s")).toBe("Initial");
    // The index is as we found it; the edit is still pending.
    expect(sh(root, "status", "--porcelain")).toBe("M src/content/a.md");
  });

  it("pull-request mode commits on a new branch, pushes it, and takes the change out of the working tree", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n", "src/content/b.md": "b\n" });
    const bare = addBareRemote(root);

    writeFileSync(join(root, "src/content/a.md"), "proposed\n");
    writeFileSync(join(root, "src/content/b.md"), "unrelated pending\n");
    const ws = await workspaceFor(root);
    const result = await ws.publish({ message: "Propose a new intro!", paths: ["src/content/a.md"], mode: "pull-request" }, PUBLISH);

    expect(result).toMatchObject({ ok: true, pushed: true, files: ["src/content/a.md"] });
    expect(result.branch).toMatch(/^galley\/propose-a-new-intro-[0-9a-f]{7}$/);
    // A local bare remote is not a known code host, so there is no PR URL.
    expect(result.pullRequestUrl).toBeUndefined();
    const branch = result.branch as string;

    expect(sh(bare, "show", `${branch}:src/content/a.md`)).toBe("proposed");
    expect(sh(bare, "log", "-1", "--format=%B", branch)).toBe("Propose a new intro!\n\nGalley-Publish: 1");
    expect(sh(bare, "log", "-1", "--format=%an", branch)).toBe("Ana Editor");
    expect(sh(root, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(sh(bare, "rev-parse", "main")).toBe(sh(root, "rev-parse", "HEAD"));
    expect(readFileSync(join(root, "src/content/a.md"), "utf8")).toBe("a\n");
    expect(readFileSync(join(root, "src/content/b.md"), "utf8")).toBe("unrelated pending\n");
    expect(ws.statusOf("src/content/a.md")).toBe("clean");
    expect(ws.statusOf("src/content/b.md")).toBe("modified");
  });

  it("pull-request mode refuses without a remote and leaves the changes in place", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });

    writeFileSync(join(root, "src/content/a.md"), "b\n");
    const ws = await workspaceFor(root);
    const result = await ws.publish({ mode: "pull-request" }, PUBLISH);

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("connected to a code host") });
    expect(readFileSync(join(root, "src/content/a.md"), "utf8")).toBe("b\n");
  });
});

describe("sending versions that didn't reach the remote", GIT_HEAVY, () => {
  it("sends what a failed push left behind, says plainly when it still can't, and reports nothing to send after", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });
    const bare = addBareRemote(root);
    const realRemote = sh(root, "remote", "get-url", "origin");

    // The code host can't be reached: publishing keeps the version here.
    sh(root, "remote", "set-url", "origin", join(tempDir("ws-gone-"), "missing.git"));
    writeFileSync(join(root, "src/content/a.md"), "mine\n");
    writeTree(root, { "src/content/b.md": "b\n" });
    const ws = await workspaceFor(root);
    const published = await ws.publish({ message: "Mine" }, PUBLISH);

    expect(published).toMatchObject({ ok: true, pushed: false });
    const stillUnreachable = await ws.send(PUBLISH);

    expect(stillUnreachable).toMatchObject({ ok: true, pushed: false, files: ["src/content/a.md", "src/content/b.md"], pushError: published.pushError });
    expect((await ws.gitStatus()).ahead).toBe(1);
    // Reachable again: the version goes out, nothing in the working tree is touched.
    sh(root, "remote", "set-url", "origin", realRemote);
    writeFileSync(join(root, "src/content/a.md"), "unpublished edit\n");
    const sent = await ws.send(PUBLISH);

    expect(sent).toMatchObject({ ok: true, pushed: true, branch: "main", files: ["src/content/a.md", "src/content/b.md"], commit: sh(root, "rev-parse", "HEAD") });
    expect(sh(bare, "log", "-1", "--format=%s", "main")).toBe("Mine");
    expect(readFileSync(join(root, "src/content/a.md"), "utf8")).toBe("unpublished edit\n");
    expect((await ws.gitStatus()).ahead).toBe(0);
    // Nothing left: done, with an empty list — and no network needed to know it.
    sh(root, "remote", "set-url", "origin", join(tempDir("ws-gone-"), "missing.git"));
    expect(await ws.send(PUBLISH)).toMatchObject({ ok: true, pushed: true, files: [] });
  });

  it("explains a rejected send the same way publish does", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });
    const bare = addBareRemote(root);
    const other = tempDir("ws-other-");
    const ws = await workspaceFor(root);

    writeFileSync(join(root, "src/content/a.md"), "mine\n");
    await ws.publish({ message: "Mine" }, { ...PUBLISH, push: false });
    sh(other, "clone", "-q", bare, ".");
    writeTree(other, { "src/content/theirs.md": "theirs\n" });
    sh(other, "add", "-A");
    sh(other, "commit", "-q", "-m", "Their change");
    sh(other, "push", "-q", "origin", "main");

    expect(await ws.send(PUBLISH)).toMatchObject({ ok: true, pushed: false, files: ["src/content/a.md"], pushError: expect.stringContaining("Someone else published at the same moment") });
  });

  it("refuses plainly without a remote, outside version control and on a detached version", async () => {
    const local = makeRepo({ "src/content/a.md": "a\n" });
    const ws = await workspaceFor(local);

    expect(await ws.send(PUBLISH)).toEqual({
      ok: false,
      files: [],
      pushed: false,
      error: "This site isn't connected to a code host, so there's nowhere to send its versions. They're saved on this computer.",
    });
    sh(local, "checkout", "-q", "--detach");
    expect((await ws.send(PUBLISH)).error).toMatch(/showing an older version/);
    const plain = tempDir("ws-plain-");

    writeTree(plain, { "a.md": "a" });
    expect((await (await workspaceFor(plain)).send(PUBLISH)).error).toMatch(/isn't set up for publishing yet/);
  });
});

describe("history, revert and status", GIT_HEAVY, () => {
  it("lists history with files and the trailer flag", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });

    writeFileSync(join(root, "src/content/a.md"), "b\n");
    writeTree(root, { "src/content/c d.md": "c\n" });
    const ws = await workspaceFor(root);

    await ws.publish({ message: "Galley edit\n\nWith a body." }, PUBLISH);
    const entries = await ws.history();

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      message: "Galley edit\n\nWith a body.",
      author: "Ana Editor",
      email: "ana@example.org",
      viaGalley: true,
      files: ["src/content/a.md", "src/content/c d.md"],
    });
    expect(entries[0]?.shortCommit.length).toBeGreaterThanOrEqual(7);
    expect(entries[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entries[1]).toMatchObject({ message: "Initial", viaGalley: false, files: ["src/content/a.md"] });
    expect(await ws.history(1)).toHaveLength(1);
  });

  it("reverts a publish with a new commit and pushes it", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });
    const bare = addBareRemote(root);

    writeFileSync(join(root, "src/content/a.md"), "b\n");
    const ws = await workspaceFor(root);
    const published = await ws.publish({ message: "Change a" }, PUBLISH);
    const result = await ws.revert(published.commit as string, PUBLISH);

    expect(result).toMatchObject({ ok: true, pushed: true, files: ["src/content/a.md"] });
    expect(readFileSync(join(root, "src/content/a.md"), "utf8")).toBe("a\n");
    expect(sh(root, "log", "-1", "--format=%B")).toBe(`Undo “Change a”\n\nThis reverts commit ${published.commit}.\n\nGalley-Publish: 1`);
    expect(sh(bare, "rev-parse", "main")).toBe(result.commit);
    expect(sh(root, "rev-list", "--count", "HEAD")).toBe("3");
  });

  it("refuses to revert over pending changes to the same files, and explains a conflict", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });
    const ws = await workspaceFor(root);

    writeFileSync(join(root, "src/content/a.md"), "b\n");
    const first = await ws.publish({ message: "b" }, PUBLISH);

    writeFileSync(join(root, "src/content/a.md"), "c\n");
    const overlap = await ws.revert(first.commit as string, PUBLISH);

    expect(overlap).toMatchObject({ ok: false, error: expect.stringContaining("unpublished changes (a.md)") });
    await ws.publish({ message: "c" }, PUBLISH);
    const conflict = await ws.revert(first.commit as string, PUBLISH);

    expect(conflict).toMatchObject({ ok: false, error: expect.stringContaining("can't be undone automatically") });
    expect(sh(root, "status", "--porcelain")).toBe("");
    expect(existsSync(join(root, ".git/REVERT_HEAD"))).toBe(false);
    await expect(ws.revert("--help", PUBLISH)).rejects.toMatchObject({ code: "invalid" });
    await expect(ws.revert("deadbeef", PUBLISH)).rejects.toMatchObject({ code: "not-found" });
  });

  it("reports git status and fast-forwards on pull", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });
    const bare = addBareRemote(root);
    const ws = await workspaceFor(root);

    expect(await ws.gitStatus()).toMatchObject({ branch: "main", detached: false, hasRemote: true, remote: "origin", remoteUrl: bare, ahead: 0, behind: 0, clean: true });
    const other = tempDir("ws-other-");

    sh(other, "clone", "-q", bare, ".");
    writeTree(other, { "src/content/a.md": "theirs\n" });
    sh(other, "commit", "-q", "-am", "Their change");
    sh(other, "push", "-q", "origin", "main");
    sh(root, "fetch", "-q");
    expect(await ws.gitStatus()).toMatchObject({ behind: 1, ahead: 0 });
    const events: Array<[string[], string]> = [];

    ws.onChange((paths, origin) => events.push([paths, origin]));
    const after = await ws.pull();

    expect(after).toMatchObject({ behind: 0, lastCommit: expect.objectContaining({ message: "Their change" }) });
    expect(readFileSync(join(root, "src/content/a.md"), "utf8")).toBe("theirs\n");
    expect(events).toEqual([[["src/content/a.md"], "external"]]);
  });
});

describe("a site inside a larger repository", GIT_HEAVY, () => {
  it("scopes changes, diffs, publish, history and discard to the site folder", async () => {
    const repo = makeRepo({ "apps/site/src/content/a.md": "a\n", "apps/site/src/content/b.md": "b\n", "other/x.md": "x\n" });
    const root = join(repo, "apps/site");

    writeFileSync(join(root, "src/content/a.md"), "a2\n");
    writeFileSync(join(root, "src/content/b.md"), "b2\n");
    writeFileSync(join(repo, "other/x.md"), "x2\n");
    const ws = await workspaceFor(root);
    const set = await ws.changes();

    expect(set.files.map((f) => [f.path, f.additions, f.deletions])).toEqual([
      ["src/content/a.md", 1, 1],
      ["src/content/b.md", 1, 1],
    ]);
    expect(await ws.listFiles()).toEqual(["src/content/a.md", "src/content/b.md"]);
    expect((await ws.diff("src/content/a.md")).before).toBe("a\n");
    expect(ws.statusOf("src/content/a.md")).toBe("modified");
    expect(await ws.publish({ message: "Site only" }, PUBLISH)).toMatchObject({ ok: true, files: ["src/content/a.md", "src/content/b.md"] });
    expect(sh(repo, "show", "--name-only", "--format=", "HEAD").split("\n").sort()).toEqual(["apps/site/src/content/a.md", "apps/site/src/content/b.md"]);
    expect((await ws.history())[0]).toMatchObject({ message: "Site only", files: ["src/content/a.md", "src/content/b.md"] });
    writeTree(root, { "src/content/new.md": "n\n" });
    expect(await ws.discard()).toEqual(["src/content/new.md"]);
    expect(sh(repo, "status", "--porcelain")).toBe("M other/x.md");
  });
});

describe("remote URLs", GIT_HEAVY, () => {
  it("parses hosts and builds compare URLs without credentials", () => {
    expect(parseRemoteUrl("git@github.com:acme/site.git")).toEqual({ host: "github.com", path: "acme/site", kind: "github" });
    expect(parseRemoteUrl("https://user:tok@gitlab.com/group/sub/site.git")).toMatchObject({ host: "gitlab.com", path: "group/sub/site", kind: "gitlab" });
    expect(parseRemoteUrl("/tmp/bare")).toBeNull();
    expect(compareUrl("git@github.com:acme/site.git", "main", "galley/x-1")).toBe("https://github.com/acme/site/compare/main...galley%2Fx-1?expand=1");
    expect(compareUrl("https://gitlab.com/g/s.git", "main", "b")).toContain("/-/merge_requests/new?");
    expect(compareUrl("https://bitbucket.org/t/s.git", "main", "b")).toBe("https://bitbucket.org/t/s/pull-requests/new?source=b&dest=main");
    expect(compareUrl("/tmp/bare", "main", "b")).toBeUndefined();
    expect(redactRemoteUrl("https://x-access-token:abc@github.com/a/b.git")).toBe("https://github.com/a/b.git");
  });

  it("takes what signs in out of every address in a message, wherever the address is", () => {
    // As git reports it: the address in the middle of the line, in quotes.
    expect(redactRemoteUrl("fatal: unable to access 'https://x-access-token:not-a-real-key@code.example/acme/site.git/': Could not resolve host: code.example")).toBe(
      "fatal: unable to access 'https://code.example/acme/site.git/': Could not resolve host: code.example"
    );
    expect(redactRemoteUrl("remote: Not Found\nfatal: repository 'http://sam:secret@code.example/a/b.git/' not found\nsee https://other:key@mirror.example/a/b.git")).toBe(
      "remote: Not Found\nfatal: repository 'http://code.example/a/b.git/' not found\nsee https://mirror.example/a/b.git"
    );
    // Nothing to take out: left exactly as it was.
    for (const plain of ["https://code.example/a/b.git", "git@code.example:acme/site.git", "fatal: unable to access 'https://code.example/a/b.git/': The requested URL returned error: 403", "write to sam@example.com about https://code.example/a"]) {
      expect(redactRemoteUrl(plain)).toBe(plain);
    }
  });

  it("a git command that fails never carries what signs in to an address in its technical details", async () => {
    const root = makeRepo({ "src/content/a.md": "a\n" });
    const ws = await workspaceFor(root);

    const address = "https://x-access-token:not-a-real-key@127.0.0.1:9/acme/site.git";

    sh(root, "remote", "add", "origin", address);
    // A command that is given the address itself and fails: the details quote the command as it was run.
    const failed = await git(root)
      .run(["ls-remote", "--exit-code", "--", address], { timeoutMs: 20_000 })
      .catch((error: unknown) => error);

    expect(failed).toMatchObject({ code: "git" });
    expect((failed as GitCommandError).detail).toContain("git ls-remote --exit-code -- https://127.0.0.1:9/acme/site.git");
    expect((failed as GitCommandError).detail).not.toContain("not-a-real-key");
    expect((failed as GitCommandError).detail).not.toContain("x-access-token");
    // A look that fails says so in plain words, and its details are as clean.
    const looked = await ws.check();

    expect(looked.checkProblem).toMatch(/^Couldn't reach the code host\./);
    await expect(ws.pull()).rejects.toSatisfy((error: unknown) => {
      const { message, detail } = error as { message: string; detail?: string };

      return message === looked.checkProblem && Boolean(detail?.includes("127.0.0.1:9/acme/site.git")) && !detail?.includes("not-a-real-key");
    });
    expect((await ws.gitStatus()).remoteUrl).toBe("https://127.0.0.1:9/acme/site.git");
  });
});

describe("the words for a look and a bring-in that didn't work", () => {
  const publishingWords = /publish|sending it|saved on this computer|signed in to it on this computer|Send for review/i;
  const gitWords = /\b(fetch|branch|commit|merge|rebase|HEAD|origin|remote)\b/i;

  it("a failed look speaks of looking, never of publishing, whatever the code host said", () => {
    const cases: Array<[string, boolean, RegExp]> = [
      ["", true, /^Couldn't reach the code host in time\. Check your connection and try again\.$/],
      ["fatal: Authentication failed for 'https://code.example/a/b.git/'", false, /didn't accept this copy's sign-in/],
      ["git@code.example: Permission denied (publickey).", false, /didn't accept this copy's sign-in/],
      ["fatal: unable to access 'https://code.example/a/b.git/': Could not resolve host: code.example", false, /^Couldn't reach the code host\. Check your connection and try again\.$/],
      ["fatal: '/nowhere/site.git' does not appear to be a git repository", false, /doesn't point at a repository this copy can read/],
      ["fatal: couldn't find remote ref main", false, /nothing newer to look for/],
      ["error: something git has never said before", false, /^The code host couldn't be asked for newer versions\. Try again in a moment\.$/],
    ];

    for (const [stderr, timedOut, expected] of cases) {
      const said = classifyLookError(stderr, timedOut);

      expect(said, stderr).toMatch(expected);
      expect(said, stderr).not.toMatch(publishingWords);
      expect(said, stderr).not.toMatch(gitWords);
      expect(said, stderr).toMatch(/\.$/);
    }
  });

  it("a bring-in that took too long doesn't blame the code host, and says the files may be part-way", () => {
    const tooLong = classifyPullError("", true);

    expect(tooLong).toMatch(/took too long and was stopped before it finished/);
    expect(tooLong).toMatch(/some files may be newer than others/);
    expect(tooLong).not.toMatch(/reach the code host|connection/i);
    for (const said of [tooLong, classifyPullError("error: Your local changes to the following files would be overwritten by merge:", false), classifyPullError("fatal: Not possible to fast-forward, aborting.", false), classifyPullError("error: unable to write file", false)]) {
      // "Publish or discard your changes" is the way out of one of these; the words for a failed publish are not.
      expect(said).not.toMatch(/sending it|saved on this computer|signed in to it on this computer|Send for review/i);
      expect(said).not.toMatch(gitWords);
      expect(said).toMatch(/\.$/);
    }
  });
});
