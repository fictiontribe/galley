import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateLegacyThreads, ThreadStore } from "../../src/ai/threads";
import { createEventBus, createSiteRegistry } from "../../src/site/index";
import type { Settings } from "../../src/types";
import { cleanupAll, tempDir } from "../workspace/helpers";

afterEach(() => cleanupAll());

const SITE = "0123456789ab";

function legacyThread(home: string, siteId: string, threadId: string, title: string): void {
  const dir = join(home, "sites", siteId, "threads");

  mkdirSync(join(dir, `${threadId}.files`), { recursive: true });
  writeFileSync(join(dir, `${threadId}.files`, "img.png"), "png");
  writeFileSync(
    join(dir, `${threadId}.json`),
    JSON.stringify({ version: 1, siteId, thread: { id: threadId, title, mode: "content", createdAt: 1, updatedAt: 2, messageCount: 0, messages: [] }, api: { messages: [], systemCard: null, cardHash: null, mode: null, buildTools: false, pendingNotes: [] }, turns: [] })
  );
}

describe("where conversations are kept", () => {
  it("keeps them in <home>/state/<site>/threads, outside the folder new sites go in", async () => {
    const home = tempDir("threads-home-");
    const store = new ThreadStore(home);
    const record = await store.create(SITE, { title: "Pricing" }, 10);

    expect(existsSync(join(home, "state", SITE, "threads", `${record.thread.id}.json`))).toBe(true);
    expect(existsSync(join(home, "sites"))).toBe(false);
  });

  it("moves conversations left in the old place once, and only folders that hold conversations", async () => {
    const home = tempDir("threads-home-");

    legacyThread(home, SITE, "thread-1", "Old chat");
    // A real site that happens to sit in the default sites folder with a "threads" folder of its own.
    mkdirSync(join(home, "sites", "my-site", "threads"), { recursive: true });
    writeFileSync(join(home, "sites", "my-site", "threads", "notes.md"), "# mine");
    // A folder named like a site id whose threads folder holds something else.
    mkdirSync(join(home, "sites", "abcdefabcdef", "threads"), { recursive: true });
    writeFileSync(join(home, "sites", "abcdefabcdef", "threads", "README.md"), "not ours");

    const store = new ThreadStore(home);
    const listed = await store.list(SITE);

    expect(listed.map((record) => record.thread.title)).toEqual(["Old chat"]);
    expect(readFileSync(join(home, "state", SITE, "threads", "thread-1.files", "img.png"), "utf8")).toBe("png");
    // The emptied old folder is gone; everything that wasn't a conversation is untouched.
    expect(existsSync(join(home, "sites", SITE))).toBe(false);
    expect(readFileSync(join(home, "sites", "my-site", "threads", "notes.md"), "utf8")).toBe("# mine");
    expect(readdirSync(join(home, "sites", "abcdefabcdef", "threads"))).toEqual(["README.md"]);
    // Once is enough: nothing is left to move.
    expect(await migrateLegacyThreads(home)).toEqual([]);
  });

  it("keeps a conversation already in the new place rather than overwrite it", async () => {
    const home = tempDir("threads-home-");

    legacyThread(home, SITE, "thread-1", "Old copy");
    mkdirSync(join(home, "state", SITE, "threads"), { recursive: true });
    writeFileSync(join(home, "state", SITE, "threads", "thread-1.json"), readFileSync(join(home, "sites", SITE, "threads", "thread-1.json"), "utf8").replace("Old copy", "New copy"));
    await migrateLegacyThreads(home);

    expect((await new ThreadStore(home).list(SITE)).map((record) => record.thread.title)).toEqual(["New copy"]);
    expect(existsSync(join(home, "sites", SITE, "threads", "thread-1.json"))).toBe(true);
  });

  it("never offers a state folder as a site", async () => {
    const home = tempDir("threads-home-");
    const store = new ThreadStore(home);

    await store.create(SITE, {}, 1);
    const registry = await createSiteRegistry({
      home,
      sitesDir: join(home, "sites"),
      startersDir: tempDir("threads-starters-"),
      events: createEventBus(),
      overlayScript: () => "",
      settings: { get: async () => ({ author: { name: "", email: "" } }) as Settings },
      install: async () => undefined,
    });

    try {
      await expect(registry.open({ path: join(home, "state", SITE) })).rejects.toMatchObject({ code: "forbidden" });
      await expect(registry.open({ path: join(home, "state", SITE, "threads") })).rejects.toMatchObject({ code: "forbidden" });
    } finally {
      await registry.dispose();
    }
  });
});

describe("renaming a conversation", () => {
  it("trims the name, keeps its place in the list, and refuses an empty or overlong one", async () => {
    const { harness } = await import("./helpers/env");
    const { createFakeSite } = await import("./helpers/fake-site");
    const { scriptedFetch, testClient } = await import("./helpers/scripted-fetch");
    const site = createFakeSite();
    const h = harness({ client: testClient(scriptedFetch([]).fetch), site });
    const thread = await h.runtime.createThread(site.id, { title: "New conversation" });
    const renamed = await h.runtime.renameThread(site.id, thread.id, "  Spring   menu  ");

    expect(renamed).toMatchObject({ id: thread.id, title: "Spring menu", updatedAt: thread.updatedAt, busy: false });
    expect((await h.runtime.getThread(site.id, thread.id))?.title).toBe("Spring menu");
    await expect(h.runtime.renameThread(site.id, thread.id, "   ")).rejects.toMatchObject({ code: "invalid", message: "Give the conversation a name." });
    await expect(h.runtime.renameThread(site.id, thread.id, "x".repeat(121))).rejects.toMatchObject({ code: "invalid" });
    expect((await h.runtime.renameThread(site.id, thread.id, "x".repeat(120))).title).toHaveLength(120);
    await expect(h.runtime.renameThread(site.id, "no-such-thread", "Name")).rejects.toMatchObject({ code: "not-found" });
  });
});
