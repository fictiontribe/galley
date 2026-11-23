/**
 * Multi-site: the registry file's version 2 (groups, pins, notes, facts) and
 * the migration from version 1, filing sites, the folder scan and bulk add,
 * the list staying instant with fifty sites, the background facts, and the
 * preview policy against real dev servers.
 */
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GalleyError } from "../../src/errors";
import { countPorcelain, createEventBus, createSiteRegistry, createSiteStore, findShareImage, probeSite, readSiteFacts, scanForSites, siteIdFor, type FactsResult, type GalleySiteRegistry, type SiteRecord } from "../../src/site/index";
import type { OpenSite } from "../../src/site/service";
import type { PreviewPolicySettings, ServerEvent, Settings } from "../../src/types";
import { AUTHOR, cleanupAll, makeSite, sh, tempDir, until } from "./helpers";

// Speed limits are for a quiet laptop; a shared CI runner or a busy machine gets room, and the test still fails if the work stops scaling.
const SLACK = process.env.CI ? 10 : 3;

const registries: GalleySiteRegistry[] = [];

afterEach(async () => {
  while (registries.length) await registries.pop()?.dispose();
  cleanupAll();
});

async function setup(
  options: {
    home?: string;
    readFacts?: (record: SiteRecord) => Promise<FactsResult | null>;
    previews?: PreviewPolicySettings;
    releaseAfterMs?: number;
    scanLimits?: { maxFolders?: number; maxSites?: number; maxMs?: number };
  } = {}
) {
  const home = options.home ?? join(tempDir("multi-home-"), ".galley");
  const bus = createEventBus();
  const events: ServerEvent[] = [];

  bus.subscribe((event) => events.push(event));
  const registry = await createSiteRegistry({
    home,
    sitesDir: join(home, "..", "Sites"),
    startersDir: join(home, "..", "no-starters"),
    events: bus,
    overlayScript: () => "",
    settings: { get: async () => ({ author: AUTHOR, previews: options.previews ?? { maxRunning: 3, idleMinutes: 20 } }) as Settings },
    install: async () => undefined,
    previewPolicy: { sweepMs: 0 },
    ...(options.readFacts ? { readFacts: options.readFacts } : {}),
    ...(options.releaseAfterMs !== undefined ? { releaseAfterMs: options.releaseAfterMs } : {}),
    ...(options.scanLimits ? { scanLimits: options.scanLimits } : {}),
  });

  registries.push(registry);
  return { registry, events, home, bus };
}

async function refusal(promise: Promise<unknown>): Promise<GalleyError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(GalleyError);
    return error as GalleyError;
  }
  throw new Error("expected a refusal");
}

/** A folder that looks like an Astro site to the scan (and is nothing more). */
function fakeAstro(dir: string, name?: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "astro.config.mjs"), "export default {};\n");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: name ?? basename(dir), dependencies: { astro: "^7.1.0" } }));
  return dir;
}

const v1Record = (id: string, root: string, at: number) => ({ id, root, name: `Site ${id}`, framework: { id: "astro", name: "Astro" }, lastOpenedAt: at });

describe("the registry file", () => {
  it("reads a version 1 file (and the bare array before it), keeps every site, and writes version 2 on the next change", async () => {
    const home = tempDir("multi-v1-");
    const a = tempDir("multi-a-");
    const b = tempDir("multi-b-");

    writeFileSync(join(home, "sites.json"), JSON.stringify({ version: 1, sites: [v1Record("aaa", a, 2), v1Record("bbb", b, 1), { id: "broken" }] }));
    const store = await createSiteStore(home);

    expect(store.loadedVersion()).toBe(1);
    expect(store.all().map((record) => record.id).sort()).toEqual(["aaa", "bbb"]);
    expect(store.groups()).toEqual([]);
    // Untouched until something changes: an old app reading the file meanwhile still can.
    expect(JSON.parse(readFileSync(join(home, "sites.json"), "utf8")).version).toBe(1);
    await store.setGroups([{ id: "g1", name: "First client", color: "green", collapsed: false }]);
    await store.put({ ...store.get("aaa")!, group: "g1", pinned: true, note: "Launch in spring" });
    const written = JSON.parse(readFileSync(join(home, "sites.json"), "utf8"));

    expect(written.version).toBe(2);
    expect(written.groups).toEqual([{ id: "g1", name: "First client", color: "green", collapsed: false }]);
    expect(written.sites.find((s: SiteRecord) => s.id === "aaa")).toMatchObject({ group: "g1", pinned: true, note: "Launch in spring" });

    const bare = tempDir("multi-bare-");

    writeFileSync(join(bare, "sites.json"), JSON.stringify([v1Record("ccc", a, 3)]));
    const fromBare = await createSiteStore(bare);

    expect(fromBare.all().map((record) => record.id)).toEqual(["ccc"]);
    expect(fromBare.loadedVersion()).toBe(1);
  });

  it("drops what it doesn't understand: unknown fields, bad colours, and groups that no longer exist", async () => {
    const home = tempDir("multi-v2-");
    const root = tempDir("multi-root-");

    writeFileSync(
      join(home, "sites.json"),
      JSON.stringify({
        version: 2,
        groups: [{ id: "g1", name: "Kept", color: "neon", collapsed: true, extra: 1 }, { id: "g1", name: "Duplicate" }],
        sites: [{ ...v1Record("aaa", root, 1), group: "gone", pinned: "yes", note: 42, secret: "nope" }, { ...v1Record("bbb", root, 2), group: "g1" }],
      })
    );
    const store = await createSiteStore(home);

    expect(store.groups()).toEqual([{ id: "g1", name: "Kept", color: "ink", collapsed: true }]);
    expect(store.get("aaa")).toEqual(v1Record("aaa", root, 1));
    expect(store.get("bbb")?.group).toBe("g1");
  });
});

describe("filing sites", { timeout: 90_000 }, () => {
  it("creates, renames, colours, collapses, orders and removes groups; files, pins and notes sites", async () => {
    const root = makeSite();
    const { registry, home } = await setup();
    const site = await registry.open({ path: root });
    const first = await registry.createGroup!({ name: "  First   client " });
    const second = await registry.createGroup!({ name: "Second client", color: "plum" });

    expect(first).toMatchObject({ name: "First client", color: "ink", collapsed: false });
    expect(second.color).toBe("plum");
    expect((await registry.createGroup!({ name: "Third" })).color).toBe("pencil");
    expect((await refusal(registry.createGroup!({ name: "  " }))).message).toBe("Give the group a name.");
    expect((await refusal(registry.createGroup!({ name: "x", color: "neon" as never }))).code).toBe("invalid");

    await registry.update!(site.id, { group: first.id, pinned: true, note: "Dana is the contact; launch 12 March" });
    let [listed] = await registry.list();

    expect(listed).toMatchObject({ group: first.id, pinned: true, note: "Dana is the contact; launch 12 March" });
    expect((await refusal(registry.update!(site.id, { group: "g-nope" }))).code).toBe("not-found");
    expect((await refusal(registry.update!(site.id, { note: "x".repeat(501) }))).message).toContain("under 500");
    expect((await refusal(registry.update!("unknown", { pinned: true }))).code).toBe("not-found");

    await registry.updateGroup!(first.id, { name: "Renamed", color: "green", collapsed: true });
    const groups = await registry.orderGroups!([second.id, first.id, (await registry.groups!())[2]!.id]);

    expect(groups.map((group) => group.name)).toEqual(["Second client", "Renamed", "Third"]);
    expect(groups[1]).toMatchObject({ color: "green", collapsed: true });
    expect((await refusal(registry.orderGroups!([first.id]))).code).toBe("invalid");

    // Filing survives the site being reopened (the record is rebuilt from the live site then).
    await registry.dispose();
    registries.pop();
    const again = await setup({ home });

    await again.registry.open({ path: root });
    [listed] = await again.registry.list();
    expect(listed).toMatchObject({ group: first.id, pinned: true, note: "Dana is the contact; launch 12 March" });

    // Removing a group leaves its sites in the list, ungrouped.
    await again.registry.removeGroup!(first.id);
    [listed] = await again.registry.list();
    expect(listed!.group).toBeUndefined();
    expect(listed!.pinned).toBe(true);
    await again.registry.update!(site.id, { pinned: false, note: null });
    [listed] = await again.registry.list();
    expect(listed!.pinned).toBeUndefined();
    expect(listed!.note).toBeUndefined();
  });
});

describe("fifty sites", () => {
  it("lists from the stored records at once, then reads facts in the background two at a time", async () => {
    const home = join(tempDir("multi-fifty-"), ".galley");
    const roots = Array.from({ length: 50 }, (_, index) => fakeAstro(join(tempDir("multi-fifty-site-"), `site-${index}`)));

    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "sites.json"), JSON.stringify({ version: 1, sites: roots.map((root, index) => v1Record(siteIdFor(root), root, index)) }));
    let running = 0;
    let most = 0;
    let calls = 0;
    const { registry, events } = await setup({
      home,
      readFacts: async (record) => {
        calls += 1;
        running += 1;
        most = Math.max(most, running);
        // A slow disk or a big repository: 40 ms a site, 2 s for the lot one at a time.
        await new Promise((resolve) => setTimeout(resolve, 40));
        running -= 1;
        return { facts: { checkedAt: Date.now(), pendingChanges: record.lastOpenedAt % 3, unsent: 0, notLive: null, unread: 0 } };
      },
    });
    const started = performance.now();
    const list = await registry.list();
    const elapsed = performance.now() - started;

    expect(list).toHaveLength(50);
    expect(calls).toBe(0);
    expect(elapsed).toBeLessThan(100 * SLACK);
    expect(registry.openSites()).toEqual([]);
    console.log(`[measure] list of 50 sites: ${elapsed.toFixed(1)} ms; facts read afterwards in the background`);

    await until(() => events.some((event) => event.type === "sites.updated"), 10_000);
    await registry.refreshFacts();
    expect(calls).toBe(50);
    expect(most).toBe(2);
    const after = await registry.list();

    expect(after.filter((site) => site.facts).length).toBe(50);
    expect(after.find((site) => site.lastOpenedAt === 4)?.pendingChanges).toBe(1);
    // Fresh facts aren't read again on the next list.
    await registry.refreshFacts();
    expect(calls).toBe(50);
    // Still nothing open: no watcher, no index, no process for a listed site.
    expect(registry.openSites()).toEqual([]);
  });

  it("reads real facts: pending changes, versions not sent, the live address, unread submissions and the share image", async () => {
    const root = makeSite();
    const home = tempDir("multi-facts-");

    writeFileSync(join(root, "src/content/pages/index.md"), readFileSync(join(root, "src/content/pages/index.md"), "utf8") + "\nMore.\n");
    writeFileSync(join(root, "new-file.md"), "# New\n");
    writeFileSync(join(root, "galley.config.json"), JSON.stringify({ urls: { production: "https://www.example.com" } }));
    mkdirSync(join(home, "state", "site-1", "submissions"), { recursive: true });
    writeFileSync(
      join(home, "state", "site-1", "submissions", "contact.jsonl"),
      [{ id: "a", read: false }, { id: "b", read: true }, { id: "c", read: false, spam: true }, { id: "d", read: false }]
        .map((item) => JSON.stringify({ ...item, form: "contact", siteId: "site-1", at: new Date().toISOString(), values: {} }))
        .join("\n") + "\n"
    );
    const result = await readSiteFacts({ id: "site-1", root, name: "x", framework: { id: "astro", name: "Astro" }, lastOpenedAt: 0 }, home);

    expect(result?.facts).toMatchObject({ pendingChanges: 3, unsent: 0, liveUrl: "https://www.example.com", notLive: null, unread: 2 });
    expect(result?.thumbnail).toBe("public/images/share.png");
    expect(await findShareImage(tempDir("multi-empty-"))).toBeUndefined();
    expect(countPorcelain(" M a.md\0R  new.md\0old.md\0?? b.md\0")).toBe(3);
    expect(await readSiteFacts({ id: "gone", root: join(root, "missing"), name: "x", framework: { id: "astro", name: "Astro" }, lastOpenedAt: 0 }, home)).toBeNull();
  });
});

describe("adding sites from a folder", () => {
  it("finds sites one or two levels down, never in node_modules, hidden folders or a site's own folders", async () => {
    const parent = tempDir("multi-scan-");

    fakeAstro(join(parent, "client-one", "marketing-site"), "marketing-site");
    fakeAstro(join(parent, "client-one", "docs"), "@client/docs");
    fakeAstro(join(parent, "solo"), "solo");
    fakeAstro(join(parent, "solo", "nested", "inner"));
    fakeAstro(join(parent, "node_modules", "astro-thing"));
    fakeAstro(join(parent, ".hidden", "secret-site"));
    fakeAstro(join(parent, "a", "b", "too-deep"));
    mkdirSync(join(parent, "eleventy"));
    writeFileSync(join(parent, "eleventy", "eleventy.config.js"), "");
    mkdirSync(join(parent, "plain"));
    writeFileSync(join(parent, "plain", "galley.config.json"), JSON.stringify({ name: "Plain notes" }));
    mkdirSync(join(parent, "not-a-site"));

    const outcome = await scanForSites(parent);
    const names = outcome.sites.map((site) => `${site.name}:${site.framework.id}`);

    expect(names).toEqual(["Docs:astro", "marketing-site:astro", "eleventy:eleventy", "Plain notes:generic", "solo:astro"]);
    expect(outcome.sites.find((site) => site.name === "solo")?.framework).toEqual({ id: "astro", name: "Astro", version: "7.1" });
    expect(outcome).toMatchObject({ truncated: false, cancelled: false });
    expect((await scanForSites(parent, { depth: 1 })).sites.map((site) => site.name)).toEqual(["eleventy", "Plain notes", "solo"]);
  });

  it("never follows a link to a folder, and stops at its caps or when cancelled", async () => {
    const parent = tempDir("multi-links-");
    const elsewhere = fakeAstro(join(tempDir("multi-elsewhere-"), "outside"));

    fakeAstro(join(parent, "real"));
    symlinkSync(elsewhere, join(parent, "link-to-outside"), "dir");
    symlinkSync(parent, join(parent, "loop"), "dir");
    for (let index = 0; index < 30; index += 1) mkdirSync(join(parent, `empty-${String(index).padStart(2, "0")}`));

    const outcome = await scanForSites(parent);

    expect(outcome.sites.map((site) => site.path)).toEqual([join(parent, "real")]);
    expect(outcome.skippedLinks).toBe(2);
    const capped = await scanForSites(parent, { limits: { maxFolders: 5 } });

    expect(capped.truncated).toBe(true);
    expect(capped.visited).toBe(5);
    const controller = new AbortController();

    controller.abort();
    expect(await scanForSites(parent, { signal: controller.signal })).toMatchObject({ cancelled: true, visited: 0, sites: [] });
    expect(await probeSite(join(parent, "empty-00"))).toBeNull();
  });

  it("adds the ticked folders in one go, checking each like Open a folder, and opens none of them", async () => {
    const parent = tempDir("multi-add-");
    const one = fakeAstro(join(parent, "one"), "one-site");
    const two = fakeAstro(join(parent, "two"));
    const { registry, events, home } = await setup();
    const group = await registry.createGroup!({ name: "Client" });
    const scan = await registry.scan!({ path: parent });

    expect(scan.sites.map((site) => site.known)).toEqual([false, false]);
    const result = await registry.addMany!({ paths: [one, two, one, "relative/path", join(parent, "missing"), homedir(), join(one, "package.json")], group: group.id });

    expect(result.added.map((site) => [site.name, site.group, site.lastOpenedAt])).toEqual([
      ["One site", group.id, 0],
      ["two", group.id, 0],
    ]);
    expect(result.skipped.map((entry) => entry.reason)).toEqual([
      "Use the folder's full location, starting from the top of the disk.",
      "That folder doesn't exist. Check the location and try again.",
      "Your home folder can't be opened as a site. Choose the site's own folder inside it.",
      "That's a file, not a folder. Choose the folder the site is in.",
    ]);
    expect(registry.openSites()).toEqual([]);
    expect(events.filter((event) => event.type === "sites.updated").length).toBeGreaterThanOrEqual(1);
    expect((await registry.scan!({ path: parent })).sites.every((site) => site.known)).toBe(true);
    expect((await registry.addMany!({ paths: [one] })).skipped[0]?.reason).toBe("It's already in the list.");
    expect((await refusal(registry.scan!({ path: "/" }))).code).toBe("forbidden");
    expect((await refusal(registry.addMany!({ paths: [] }))).code).toBe("invalid");
    // The app's own folder is never offered.
    fakeAstro(join(home, "inside-app"));
    expect((await registry.scan!({ path: home })).sites).toEqual([]);
  });
});

describe("open sites that sit unused", { timeout: 90_000 }, () => {
  it("are closed again after the release time and reopen on the next get", async () => {
    const root = makeSite();
    const { registry } = await setup({ releaseAfterMs: 60_000 });
    const site = await registry.open({ path: root });

    expect(await registry.releaseIdle(Date.now() + 1_000)).toEqual([]);
    expect(await registry.releaseIdle(Date.now() + 61_000)).toEqual([site.id]);
    expect(registry.openSites()).toEqual([]);
    const reopened = await registry.get(site.id);

    expect(reopened).not.toBe(site);
    expect((await reopened!.listEntries("pages")).items.length).toBeGreaterThan(0);
  });
});

/** A dev server that answers at once on a free port and says where, like Vite does. */
const DEV = `import http from "node:http";
const server = http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<html><head></head><body>" + process.cwd() + "</body></html>"); });
server.listen(0, "127.0.0.1", () => console.log("  Local: http://localhost:" + server.address().port + "/"));
`;

function devSite(name: string): string {
  const root = tempDir(`multi-preview-${name}-`);

  mkdirSync(join(root, "notes"));
  writeFileSync(join(root, "notes", "one.md"), "---\ntitle: One\n---\nHello.\n");
  writeFileSync(join(root, "notes", "two.md"), "---\ntitle: Two\n---\nHello.\n");
  writeFileSync(join(root, "dev.mjs"), DEV);
  writeFileSync(join(root, "galley.config.json"), JSON.stringify({ name, dev: { command: "node dev.mjs" } }));
  sh(root, "init", "-q", "-b", "main");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "Initial");
  return root;
}

// Real dev servers: generous timeouts, the full suite runs many of these at once.
describe("the preview policy, with real dev servers", { timeout: 120_000 }, () => {
  it("keeps at most the limit running, pauses the least recently used, and wakes it on return", async () => {
    const { registry, events } = await setup({ previews: { maxRunning: 3, idleMinutes: 20 } });
    const sites = await Promise.all(["a", "b", "c", "d"].map(async (name) => registry.open({ path: devSite(name) })));
    const policy = registry.previewPolicy!;

    for (const site of sites.slice(0, 3)) {
      expect((await site.preview().start()).state).toBe("ready");
      // Each used a little later than the one before: "a" is the least recent.
      await new Promise((resolve) => setTimeout(resolve, 15));
      policy.touch(site.id);
    }
    expect(policy.running().sort()).toEqual(sites.slice(0, 3).map((site) => site.id).sort());
    const fourth = await sites[3]!.preview().start();

    expect(fourth.state).toBe("ready");
    policy.touch(sites[3]!.id);
    await until(() => sites[0]!.preview().status().state === "idle", 10_000);
    expect(sites[0]!.preview().status()).toMatchObject({ state: "idle", paused: "limit", url: null });
    expect(sites[0]!.preview().status().detail).toContain("make room");
    expect(policy.running().length).toBe(3);
    // Coming back starts it again, saying it is waking, and the limit pauses the next least recent.
    const waking = events.length;
    const back = await sites[0]!.preview().start();

    expect(back.state).toBe("ready");
    expect(events.slice(waking).some((event) => event.type === "preview.status" && event.siteId === sites[0]!.id && event.status.detail === "Waking the preview…")).toBe(true);
    await until(() => sites[1]!.preview().status().paused === "limit", 10_000);
    expect(policy.running().length).toBe(3);
  });

  it("pauses previews nobody used for the idle time, but never one with an editor open, one starting, or one a job is using", async () => {
    let clock = Date.now();
    const { registry, bus } = await setup({ previews: { maxRunning: 6, idleMinutes: 20 } });
    const policy = registry.previewPolicy!;
    const sites = await Promise.all(["idle", "editing", "deploying"].map(async (name) => registry.open({ path: devSite(name) })));

    for (const site of sites) expect((await site.preview().start()).state).toBe("ready");
    // Another policy on the same registry's controllers, with a clock the test moves.
    const { createPreviewPolicy } = await import("../../src/site/index");
    const timed = createPreviewPolicy({
      events: bus,
      limits: () => ({ maxRunning: 6, idleMinutes: 20 }),
      controller: (id) => (sites.find((site) => site.id === id) as OpenSite | undefined)?.previewHandle() ?? null,
      now: () => clock,
      sweepMs: 0,
    });

    for (const site of sites) bus.emit({ type: "preview.status", siteId: site.id, status: site.preview().status() });
    bus.emit({ type: "job", job: { id: "job-1", kind: "deploy", label: "Putting it online", state: "running", startedAt: clock, siteId: sites[2]!.id } });
    clock += 25 * 60_000;
    timed.touch(sites[1]!.id);
    expect(await timed.sweep()).toEqual([sites[0]!.id]);
    expect(sites[0]!.preview().status()).toMatchObject({ state: "idle", paused: "idle" });
    expect(sites[1]!.preview().status().state).toBe("ready");
    expect(sites[2]!.preview().status().state).toBe("ready");
    // The job ends: now nothing protects it.
    bus.emit({ type: "job", job: { id: "job-1", kind: "deploy", label: "Putting it online", state: "done", startedAt: clock, siteId: sites[2]!.id } });
    clock += 2 * 60_000;
    expect(await timed.sweep()).toEqual([sites[2]!.id]);
    timed.dispose();
    expect(policy.isProtected(sites[2]!.id)).toBe(false);
  });

  it("never pauses a preview that is still starting", async () => {
    const { registry } = await setup({ previews: { maxRunning: 1, idleMinutes: 20 } });
    const [first, second] = await Promise.all(["one", "two"].map(async (name) => registry.open({ path: devSite(name) })));

    expect((await first!.preview().start()).state).toBe("ready");
    const starting = second!.preview().start();

    // While "two" is on its way, the limit is exceeded but only ready previews are candidates — "two" itself is never one.
    expect(await registry.previewPolicy!.enforce()).toEqual([first!.id]);
    expect((await starting).state).toBe("ready");
    expect(second!.preview().status().paused).toBeUndefined();
    expect(existsSync(first!.root)).toBe(true);
  });
});
