import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { GalleyError } from "../../src/errors";
import { createEventBus, createSiteRegistry, siteIdFor } from "../../src/site/index";
import type { Job, ServerEvent, Settings, SiteRegistry } from "../../src/types";
import { addBareRemote, AUTHOR, cleanupAll, copyStarter, HOME, makeSite, sh, tempDir, until } from "./helpers";

const STARTERS = fileURLToPath(new URL("../../../../starters", import.meta.url));
const registries: SiteRegistry[] = [];

afterEach(async () => {
  while (registries.length) await registries.pop()?.dispose();
  cleanupAll();
});

interface Setup {
  registry: SiteRegistry;
  events: ServerEvent[];
  home: string;
  sitesDir: string;
  jobsOf(id: string): Job[];
}

async function setup(options: { home?: string; startersDir?: string; install?: (root: string, onLog: (line: string) => void) => Promise<void> } = {}): Promise<Setup> {
  const home = options.home ?? join(tempDir("site-home-"), ".galley");
  const sitesDir = join(home, "..", "Sites");
  const bus = createEventBus();
  const events: ServerEvent[] = [];

  bus.subscribe((event) => events.push(event));
  const registry = await createSiteRegistry({
    home,
    sitesDir,
    startersDir: options.startersDir ?? STARTERS,
    events: bus,
    overlayScript: () => "",
    settings: { get: async () => ({ author: AUTHOR }) as Settings },
    install: options.install ?? (async () => undefined),
  });

  registries.push(registry);
  return {
    registry,
    events,
    home,
    sitesDir,
    jobsOf: (id) => events.filter((event): event is Extract<ServerEvent, { type: "job" }> => event.type === "job" && event.job.id === id).map((event) => event.job),
  };
}

async function finished(registry: SiteRegistry, id: string): Promise<Job> {
  await until(() => registry.job(id)?.state !== "running", 60_000);
  return registry.job(id)!;
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

describe("opening and listing sites", () => {
  it("opens, lists, gets and forgets a site", async () => {
    const root = makeSite();
    const { registry, events } = await setup();
    const site = await registry.open({ path: root });

    expect(site.id).toBe(siteIdFor(root));
    expect(await registry.open({ path: root })).toBe(site);
    expect(await registry.get(site.id)).toBe(site);
    expect(await registry.get("unknown")).toBeNull();
    expect(events.filter((event) => event.type === "sites.updated").length).toBeGreaterThanOrEqual(2);

    const [listed] = await registry.list();

    expect(listed).toMatchObject({ id: site.id, root, name: "Lowfield Studio", framework: { id: "astro" }, branch: "main", pendingChanges: 0 });
    expect(listed!.missing).toBeUndefined();
    await site.updateEntry(HOME, [{ op: "set", path: ["title"], value: "Changed" }]);
    expect((await registry.list())[0]!.pendingChanges).toBe(1);

    await registry.remove(site.id);
    expect(await registry.list()).toEqual([]);
    expect(existsSync(join(root, HOME))).toBe(true);
    expect(await registry.get(site.id)).toBeNull();
  });

  it("remembers sites across restarts, opens them lazily and flags a folder that is gone", async () => {
    const root = makeSite();
    const first = await setup();
    const opened = await first.registry.open({ path: root });
    const id = opened.id;
    // What a fresh open finds is what a reopen after the restart must find too.
    const collections = (await opened.model()).collections.map((collection) => collection.id);

    await first.registry.dispose();
    registries.splice(registries.indexOf(first.registry), 1);
    const stored = JSON.parse(readFileSync(join(first.home, "sites.json"), "utf8")) as { sites: Array<Record<string, unknown>> };

    expect(stored.sites).toMatchObject([{ id, root, name: "Lowfield Studio", framework: { id: "astro" } }]);
    const second = await setup({ home: first.home });

    expect(await second.registry.list()).toMatchObject([{ id, root, name: "Lowfield Studio", pendingChanges: 0 }]);
    const reopened = await second.registry.get(id);

    expect(reopened?.root).toBe(root);
    expect((await reopened!.model()).collections.map((collection) => collection.id)).toEqual(collections);
    expect(collections).toEqual(expect.arrayContaining(["pages", "blog", "team"]));
    await second.registry.dispose();
    registries.splice(registries.indexOf(second.registry), 1);

    rmSync(root, { recursive: true, force: true });
    const third = await setup({ home: first.home });

    expect(await third.registry.list()).toMatchObject([{ id, missing: true }]);
  });

  it("starts empty from an unreadable list and keeps the old file aside", async () => {
    const home = join(tempDir("site-home-"), ".galley");

    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "sites.json"), "{ this is not json");
    const { registry } = await setup({ home });

    expect(await registry.list()).toEqual([]);
    expect(readFileSync(join(home, "sites.json.bak"), "utf8")).toBe("{ this is not json");
    await registry.open({ path: makeSite() });
    expect(JSON.parse(readFileSync(join(home, "sites.json"), "utf8")).sites).toHaveLength(1);
  });

  it("refuses folders that can't be a site", async () => {
    const { registry, home } = await setup();
    const file = join(makeSite(), "package.json");

    mkdirSync(join(home, "threads"), { recursive: true });
    expect((await refusal(registry.open({ path: "/" }))).code).toBe("forbidden");
    expect((await refusal(registry.open({ path: homedir() }))).code).toBe("forbidden");
    expect((await refusal(registry.open({ path: join(home, "threads") }))).code).toBe("forbidden");
    expect((await refusal(registry.open({ path: join(home, "..", "does-not-exist") }))).code).toBe("not-found");
    expect((await refusal(registry.open({ path: file }))).code).toBe("invalid");
    expect((await refusal(registry.open({ path: "relative/site" }))).code).toBe("invalid");
    expect(await registry.list()).toEqual([]);
  });

  it("opens a folder inside a larger repository as the site", async () => {
    const repo = tempDir("site-mono-");

    copyStarter(join(repo, "web"));
    writeFileSync(join(repo, "README.md"), "# Monorepo\n");
    sh(repo, "init", "-q", "-b", "main");
    sh(repo, "add", "-A");
    sh(repo, "commit", "-q", "-m", "Initial");
    const { registry } = await setup();
    const site = await registry.open({ path: join(repo, "web") });

    expect(site.root).toBe(join(repo, "web"));
    writeFileSync(join(repo, "README.md"), "# Changed outside\n");
    expect((await site.changes()).files).toEqual([]);
  });
});

describe("starters and new sites", () => {
  it("lists starters from package.json, or from starter.json when there is one", async () => {
    const { registry } = await setup();

    // The starter's own starter.json names it.
    const declared = JSON.parse(readFileSync(join(STARTERS, "astro-starter", "starter.json"), "utf8")) as { name: string };

    expect(await registry.starters()).toEqual(expect.arrayContaining([expect.objectContaining({ id: "astro-starter", framework: "astro", name: declared.name })]));
    const dir = tempDir("site-starters-");

    mkdirSync(join(dir, "plain"));
    writeFileSync(join(dir, "plain", "package.json"), JSON.stringify({ name: "plain-notes", description: "Notes." }));
    mkdirSync(join(dir, "fancy"));
    writeFileSync(join(dir, "fancy", "package.json"), JSON.stringify({ name: "x", dependencies: { astro: "1" } }));
    writeFileSync(join(dir, "fancy", "starter.json"), JSON.stringify({ name: "Fancy studio", description: "A studio site." }));
    mkdirSync(join(dir, "not-a-starter"));
    const custom = await setup({ startersDir: dir });

    expect(await custom.registry.starters()).toEqual([
      { id: "fancy", name: "Fancy studio", description: "A studio site.", framework: "astro" },
      { id: "plain", name: "Plain notes", description: "Notes.", framework: "generic" },
    ]);
  });

  it("creates a site from the starter as a job, with throttled progress", async () => {
    const installs: string[] = [];
    const { registry, jobsOf, sitesDir } = await setup({
      install: async (root, onLog) => {
        installs.push(root);
        for (let i = 0; i < 100; i += 1) onLog(`added package ${i}`);
        await new Promise((resolve) => setTimeout(resolve, 300));
        onLog("installed");
      },
    });
    const job = await registry.create({ name: "Harbour Bakery", starter: "astro-starter" });

    expect(job).toMatchObject({ kind: "create", state: "running" });
    const done = await finished(registry, job.id);

    expect(done.state).toBe("done");
    expect(done.siteId).toBeDefined();
    const root = join(sitesDir, "harbour-bakery");

    expect(installs).toEqual([root]);
    expect(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).name).toBe("harbour-bakery");
    expect(sh(root, "log", "--format=%an|%s")).toBe(`${AUTHOR.name}|Start Harbour Bakery from a starter`);
    expect(existsSync(join(root, "node_modules"))).toBe(false);
    // 100 progress lines in an instant must not become 100 events.
    expect(jobsOf(job.id).length).toBeLessThan(10);
    expect(jobsOf(job.id).at(-1)!.state).toBe("done");
    const site = await registry.get(done.siteId!);

    expect(site?.root).toBe(root);
    expect((await registry.list()).map((summary) => summary.id)).toContain(done.siteId);

    const again = await finished(registry, (await registry.create({ name: "Harbour Bakery", starter: "astro-starter" })).id);

    expect(again.state).toBe("done");
    expect((await registry.get(again.siteId!))?.root).toBe(join(sitesDir, "harbour-bakery-2"));
  });

  it("opens a new site with its own name and no pending changes — the install's lock file is in the first version", async () => {
    const { registry, sitesDir } = await setup({
      install: async (root) => writeFileSync(join(root, "package-lock.json"), '{ "lockfileVersion": 3 }\n'),
    });
    const done = await finished(registry, (await registry.create({ name: "Harbour Bakery", starter: "astro-starter" })).id);
    const root = join(sitesDir, "harbour-bakery");
    const site = (await registry.get(done.siteId!))!;

    expect((await site.model()).name).toBe("Harbour Bakery");
    expect((await registry.list()).find((summary) => summary.id === site.id)?.name).toBe("Harbour Bakery");
    expect(JSON.parse(readFileSync(join(root, "src/data/site.json"), "utf8")).name).toBe("Harbour Bakery");
    expect((await site.changes()).files).toEqual([]);
    expect((await site.detail()).pendingChanges).toBe(0);
    expect(sh(root, "status", "--porcelain")).toBe("");
    expect(sh(root, "show", "--name-only", "--format=", "HEAD").split("\n")).toContain("package-lock.json");
    // Only the name's values changed in the starter's files.
    const starterConfig = readFileSync(join(STARTERS, "astro-starter", "galley.config.json"), "utf8");

    expect(readFileSync(join(root, "galley.config.json"), "utf8")).toBe(starterConfig.replace('"name": "Lowfield Studio"', '"name": "Harbour Bakery"'));
    const starterSite = readFileSync(join(STARTERS, "astro-starter", "src/data/site.json"), "utf8");

    expect(readFileSync(join(root, "src/data/site.json"), "utf8")).toBe(starterSite.replace('"name": "Lowfield Studio"', '"name": "Harbour Bakery"'));
    const starterPackage = readFileSync(join(STARTERS, "astro-starter", "package.json"), "utf8");

    expect(readFileSync(join(root, "package.json"), "utf8")).toBe(starterPackage.replace('"name": "galley-astro-starter"', '"name": "harbour-bakery"'));
  });

  it("reads tags, previews and looks from starter.json, serves only the declared previews, and applies a chosen look", async () => {
    const dir = tempDir("site-starters-");
    const looks = [
      { id: "harbour", label: "Harbour", file: "galley/looks/harbour.css", swatches: ["#123456", "nope"], preview: "galley/looks/harbour.png" },
      { id: "dusk", label: "Dusk", file: "galley/looks/dusk.css", swatches: ["#332211"] },
    ];

    mkdirSync(join(dir, "studio", "galley", "looks"), { recursive: true });
    mkdirSync(join(dir, "studio", "src", "styles"), { recursive: true });
    writeFileSync(join(dir, "studio", "package.json"), JSON.stringify({ name: "studio", dependencies: { astro: "1" } }, null, 2));
    writeFileSync(
      join(dir, "studio", "starter.json"),
      JSON.stringify({ name: "Studio", description: "For a studio.", framework: "astro", tags: ["business"], preview: "galley/preview.png", tokens: "src/styles/tokens.css", looks: [...looks, { id: "../escape", label: "x" }] })
    );
    writeFileSync(join(dir, "studio", "galley", "preview.png"), Buffer.from([0x89, 0x50]));
    writeFileSync(join(dir, "studio", "galley", "looks", "harbour.png"), Buffer.from([0x89, 0x50]));
    writeFileSync(join(dir, "studio", "galley", "looks", "harbour.css"), ":root { --accent: #123456; }\n");
    writeFileSync(join(dir, "studio", "galley", "looks", "dusk.css"), ":root { --accent: #332211; }\n");
    writeFileSync(join(dir, "studio", "galley", "secret.txt"), "not served");
    writeFileSync(join(dir, "studio", "src", "styles", "tokens.css"), ":root { --accent: #123456; }\n");
    const { registry, sitesDir } = await setup({ startersDir: dir });

    expect(await registry.starters()).toEqual([
      {
        id: "studio",
        name: "Studio",
        description: "For a studio.",
        framework: "astro",
        tags: ["business"],
        previewUrl: "/api/starters/studio/preview",
        looks: [
          { id: "harbour", label: "Harbour", swatches: ["#123456"], previewUrl: "/api/starters/studio/preview?look=harbour" },
          { id: "dusk", label: "Dusk", swatches: ["#332211"] },
        ],
      },
    ]);
    expect(await registry.starterPreview("studio")).toEqual({ path: join(dir, "studio", "galley", "preview.png"), type: "image/png" });
    expect(await registry.starterPreview("studio", "harbour")).toMatchObject({ type: "image/png" });
    expect(await registry.starterPreview("studio", "dusk")).toBeNull();
    expect(await registry.starterPreview("..", undefined)).toBeNull();
    expect(await registry.starterPreview("studio", "secret")).toBeNull();

    // An unknown look is refused before anything is copied.
    const refused = await refusal(registry.create({ name: "Nope", starter: "studio", look: "neon" }));

    expect(refused).toMatchObject({ code: "invalid", message: "That starter has no look called “neon”. Choose one of: harbour, dusk." });
    expect(existsSync(join(sitesDir, "nope"))).toBe(false);
    const done = await finished(registry, (await registry.create({ name: "Dusk Studio", starter: "studio", look: "dusk" })).id);
    const root = join(sitesDir, "dusk-studio");

    expect(done.state).toBe("done");
    expect(readFileSync(join(root, "src/styles/tokens.css"), "utf8")).toBe(":root { --accent: #332211; }\n");
    expect(existsSync(join(root, "starter.json"))).toBe(false);
    expect(sh(root, "status", "--porcelain")).toBe("");
    // The default look leaves the starter's own colours.
    await finished(registry, (await registry.create({ name: "Plain Studio", starter: "studio", look: "harbour" })).id);
    expect(readFileSync(join(sitesDir, "plain-studio", "src/styles/tokens.css"), "utf8")).toBe(":root { --accent: #123456; }\n");
  });

  it("still registers a site whose install failed, with a note", async () => {
    const { registry } = await setup({
      install: async () => {
        throw new Error("network down");
      },
    });
    const done = await finished(registry, (await registry.create({ name: "Offline site", starter: "astro-starter" })).id);

    expect(done.state).toBe("done");
    expect(done.detail).toMatch(/installing its dependencies didn't work/);
    expect(await registry.get(done.siteId!)).not.toBeNull();
  });

  it("refuses a nameless site and an unknown starter before starting a job", async () => {
    const { registry, events } = await setup();

    expect((await refusal(registry.create({ name: "  !!  ", starter: "astro-starter" }))).code).toBe("invalid");
    expect((await refusal(registry.create({ name: "Fine", starter: "no-such-starter" }))).code).toBe("not-found");
    expect(events.filter((event) => event.type === "job")).toEqual([]);
  });
});

describe("cloning", () => {
  it("clones from a repository into the sites folder and registers it", async () => {
    const source = makeSite();
    const bare = addBareRemote(source);
    const { registry, sitesDir, jobsOf, events } = await setup();
    const job = await registry.clone({ url: bare });

    expect(job).toMatchObject({ kind: "clone", state: "running" });
    const done = await finished(registry, job.id);

    expect(done.state).toBe("done");
    const root = join(sitesDir, basename(bare));
    const site = await registry.get(done.siteId!);

    expect(site?.root).toBe(root);
    expect(existsSync(join(root, HOME))).toBe(true);
    expect((await site!.model()).publish).toMatchObject({ remote: "origin", push: true, branch: "main" });
    expect(jobsOf(job.id).at(-1)).toMatchObject({ state: "done", siteId: done.siteId });
    expect(events.some((event) => event.type === "sites.updated")).toBe(true);
    expect(registry.job(job.id)).toMatchObject({ id: job.id, state: "done" });
    expect(registry.job("nope")).toBeNull();

    const second = await finished(registry, (await registry.clone({ url: bare })).id);

    expect((await registry.get(second.siteId!))?.root).toBe(`${root}-2`);
  });

  it("ends in a plain error and leaves no folder behind when the repository isn't there", async () => {
    const { registry, sitesDir } = await setup();
    const missing = join(tempDir("site-nothing-"), "no-repo-here.git");
    const done = await finished(registry, (await registry.clone({ url: missing })).id);

    expect(done.state).toBe("error");
    expect(done.detail).toMatch(/wasn't found/);
    expect(existsSync(join(sitesDir, "no-repo-here"))).toBe(false);
    expect(await registry.list()).toEqual([]);
  });
});
