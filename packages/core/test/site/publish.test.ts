import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSiteModel } from "../../src/content/index";
import {
  addBareRemote,
  AUTHOR,
  cleanupAll,
  copyStarter,
  disposeAll,
  HOME,
  makeSite,
  openSite,
  pngHeader,
  POST,
  PRICING,
  sh,
  tempDir,
} from "./helpers";

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

afterEach(async () => {
  await disposeAll();
  cleanupAll();
});

const read = (root: string, path: string) => readFileSync(join(root, ...path.split("/")), "utf8");

describe("publish, history and undo", GIT_HEAVY, () => {
  it("publishes with a message built from the changes, then undoes the publish", async () => {
    const root = makeSite();
    const { site, of } = await openSite(root);
    const original = read(root, HOME);

    await site.updateEntry(HOME, [{ op: "set", path: ["sections", 0, "heading"], value: "A brand new heading" }]);
    await site.updateEntry(PRICING, [{ op: "set", path: ["description"], value: "Plain fees." }]);
    await site.saveMedia({ filename: "one.png", data: pngHeader(4, 4) });
    await site.saveMedia({ filename: "two.png", data: pngHeader(4, 4) });
    const result = await site.publish();

    expect(result).toMatchObject({ ok: true, pushed: false, branch: "main" });
    expect(result.files).toHaveLength(4);
    const [latest] = await site.history(5);

    expect(latest).toMatchObject({ viaGalley: true, author: AUTHOR.name, email: AUTHOR.email, message: "Update Home page and Pricing; add 2 images" });
    expect((await site.changes()).files).toEqual([]);
    expect((await site.listEntries("pages", { status: "modified" })).total).toBe(0);
    expect((await site.entryForUrl("/"))?.status).toBe("clean");
    expect(of("changes.updated").some((event) => event.origin === "publish")).toBe(true);

    const undone = await site.revert(latest!.commit);

    expect(undone.ok).toBe(true);
    expect(read(root, HOME)).toBe(original);
    expect(existsSync(join(root, "public/images/one.png"))).toBe(false);
    const history = await site.history(5);

    expect(history[0]!.message).toMatch(/^Undo “Update Home page and Pricing; add 2 images”/);
    expect(history[0]!.viaGalley).toBe(true);
    expect((await site.changes()).files).toEqual([]);
    // The index follows the undo: the published heading is gone again.
    expect(await site.search("A brand new heading")).toEqual([]);
    expect((await site.resolveText({ urlPath: "/", text: "Make more of the home you already have." })).status).toBe("unique");
  });

  it("pushes to a bare remote when there is one", async () => {
    const root = makeSite();
    const bare = addBareRemote(root);
    const { site } = await openSite(root);

    await site.updateEntry(POST, [{ op: "set", path: ["title"], value: "Measured surveys, explained" }]);
    const result = await site.publish({ message: "Retitle the survey post" });

    expect(result).toMatchObject({ ok: true, pushed: true, branch: "main" });
    expect(sh(bare, "log", "-1", "--format=%s", "main")).toBe("Retitle the survey post");
    expect((await site.gitStatus()).ahead).toBe(0);
  });

  it("discards pending changes and the caches follow", async () => {
    const root = makeSite();
    const { site } = await openSite(root);
    const original = read(root, HOME);

    await site.updateEntry(HOME, [{ op: "set", path: ["sections", 0, "heading"], value: "Soon to be discarded" }]);
    const created = await site.createEntry({ collection: "blog", slug: "draft-to-drop", data: { title: "Draft to drop" } });

    expect((await site.model()).collections.find((collection) => collection.id === "blog")!.count).toBe(5);
    const after = await site.discard();

    expect(after.files).toEqual([]);
    expect(read(root, HOME)).toBe(original);
    expect(existsSync(join(root, created.path))).toBe(false);
    expect((await site.model()).collections.find((collection) => collection.id === "blog")!.count).toBe(4);
    expect(await site.search("Soon to be discarded")).toEqual([]);
    expect(await site.entryForUrl("/blog/draft-to-drop/")).toBeNull();
  });

  it("fetches the latest version and the index reflects it", async () => {
    const root = makeSite();
    const bare = addBareRemote(root);
    const other = tempDir("site-other-");

    sh(other, "clone", "-q", bare, ".");
    writeFileSync(join(other, HOME), read(other, HOME).replace("Four ways we usually help", "Pulled in from elsewhere"));
    sh(other, "commit", "-q", "-am", "Edit elsewhere");
    sh(other, "push", "-q", "origin", "main");
    const { site, of } = await openSite(root);

    await site.search("warm the index");
    const status = await site.pull();

    expect(status.behind).toBe(0);
    expect(of("changes.updated").at(-1)).toMatchObject({ origin: "external", paths: [HOME] });
    expect((await site.resolveText({ urlPath: "/", text: "Pulled in from elsewhere" })).status).toBe("unique");
    expect((await site.changes()).files).toEqual([]);
  });
});

describe("a site inside a larger repository", GIT_HEAVY, () => {
  it("scopes every change, publish and discard to the site's own folder", async () => {
    const repo = tempDir("site-mono-");

    copyStarter(join(repo, "apps", "site"));
    writeFileSync(join(repo, "README.md"), "# The monorepo\n");
    sh(repo, "init", "-q", "-b", "trunk");
    sh(repo, "add", "-A");
    sh(repo, "commit", "-q", "-m", "Initial");
    const root = join(repo, "apps", "site");

    // Detection reads .git/HEAD from the site folder, finds none and guesses.
    expect((await loadSiteModel(root)).publish.branch).toBe("main");
    const { site } = await openSite(root);

    expect((await site.model()).publish.branch).toBe("trunk");
    writeFileSync(join(repo, "README.md"), "# Edited outside the site\n");
    await site.updateEntry(HOME, [{ op: "set", path: ["title"], value: "Monorepo home" }]);
    expect((await site.changes()).files.map((file) => file.path)).toEqual([HOME]);
    expect((await site.detail()).pendingChanges).toBe(1);

    const published = await site.publish();

    expect(published).toMatchObject({ ok: true, files: [HOME], branch: "trunk" });
    expect(sh(repo, "show", "--name-only", "--format=", "HEAD")).toBe(`apps/site/${HOME}`);
    expect(sh(repo, "status", "--porcelain")).toBe("M README.md");
    expect((await site.history(1))[0]!.files).toEqual([HOME]);

    await site.updateEntry(POST, [{ op: "set", path: ["title"], value: "To be discarded" }]);
    await site.discard();
    expect(sh(repo, "status", "--porcelain")).toBe("M README.md");
    expect(read(repo, "README.md")).toBe("# Edited outside the site\n");
  });
});
