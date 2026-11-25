/**
 * Moving media between the repository and a bucket, and changing the
 * bucket's address — on a real site and the strict stand-in S3. Each run is
 * safe to repeat, never overwrites, and every page change is an ordinary
 * pending change.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createMediaStorageService } from "../../src/media-storage/service";
import type { GalleyConfig } from "../../src/types";
import { writeRefusal } from "../../src/workspace/policy";
import { cleanupAll, disposeAll, makeSite, openSite, sh, STARTERS, type StarterName } from "../site/helpers";
import { startFakeS3, type FakeS3 } from "./fakes/s3";
import { tempHome } from "./helpers";

const KEY = { accessKeyId: "0123456789abcdef0123456789abcdef", secretAccessKey: "c".repeat(64) };
const AUTHOR = "src/content/authors/tomas-reyes.md";
const PHOTO = "public/images/team/tomas-reyes.svg";
let fake: FakeS3;

beforeAll(async () => {
  fake = await startFakeS3({ pageSize: 5 });
  fake.addBucket("moves", { region: "auto" });
  fake.addKey({ id: KEY.accessKeyId, secret: KEY.secretAccessKey, buckets: { moves: ["read", "write", "list", "delete"] } });
});
afterAll(() => fake.close());
afterEach(async () => {
  await disposeAll();
  cleanupAll();
});

async function setUp(starter?: StarterName, settings?: (config: GalleyConfig) => GalleyConfig) {
  fake.buckets.get("moves")!.objects.clear();
  const home = await tempHome();
  const storage = createMediaStorageService({ home: home.home, env: {}, listTtlMs: 0 });
  const root = makeSite(starter ? { starter } : {});

  if (settings) {
    const file = join(root, "galley.config.json");

    writeFileSync(file, `${JSON.stringify(settings(JSON.parse(readFileSync(file, "utf8")) as GalleyConfig), null, 2)}\n`);
    sh(root, "commit", "-q", "-am", "Settings");
  }
  const { site } = await openSite(root, { media: storage });
  const publicUrl = fake.publicUrl("moves");
  const connected = await storage.connect(site, { config: { connector: "r2", account: KEY.accessKeyId, bucket: "moves", endpoint: fake.endpoint, prefix: "lowfield", publicUrl }, ...KEY });

  expect(connected.check.ok).toBe(true);
  homes.set(storage, home.home);
  return { storage, site, root, publicUrl, done: home.done };
}

/** The data folder each test's service keeps its record in. */
const homes = new WeakMap<object, string>();
const homeOf = (storage: object) => homes.get(storage)!;

const read = (root: string, path: string) => readFileSync(join(root, ...path.split("/")), "utf8");

/**
 * What a move to the bucket does on each starter: how many copies it makes,
 * how many of the repository's it then removes, how many of Galley's page
 * templates it updates, which files the site is built from keep how many
 * pictures, and which files beside the site name some and keep none. Then the
 * same count of copies removed when the site has build mode off (the page
 * templates are left, and keep what they use), and when its settings say the
 * build reads scripts/gallery too.
 */
const LAYOUT = "src/layouts/Base.astro";
const GALLERY = "scripts/gallery/sections.md";
const ON_STARTERS: Record<StarterName, { files: number; removes: number; templates: number; keeps: Record<string, number>; beside: string[]; withBuildModeOff: number; withGalleryBuilt: number }> = {
  "astro-starter": { files: 27, removes: 25, templates: 3, keeps: { [LAYOUT]: 2 }, beside: [GALLERY], withBuildModeOff: 18, withGalleryBuilt: 15 },
  "astro-editorial": { files: 31, removes: 29, templates: 4, keeps: { [LAYOUT]: 2 }, beside: ["README.md", "galley/photography/shots.json", GALLERY], withBuildModeOff: 14, withGalleryBuilt: 15 },
  "astro-saas": { files: 37, removes: 35, templates: 4, keeps: { [LAYOUT]: 2 }, beside: ["README.md", GALLERY], withBuildModeOff: 22, withGalleryBuilt: 19 },
  "astro-storefront": { files: 52, removes: 30, templates: 6, keeps: { "src/data/shop/catalogue.json": 20, [LAYOUT]: 2 }, beside: ["galley/photography/shots.json", GALLERY], withBuildModeOff: 25, withGalleryBuilt: 24 },
};

/** For each file that keeps a picture in the repository, how many it keeps. */
function keptBy(list: Array<{ path: string; pages: string[] }> | undefined): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const item of list ?? []) for (const page of item.pages) counts[page] = (counts[page] ?? 0) + 1;
  return counts;
}

describe("moving media", { timeout: 240_000 }, () => {
  it("to the bucket: copies, points the pages at the full addresses, removes what nothing else reaches — and runs again safely", async () => {
    const { storage, site, root, publicUrl, done } = await setUp();
    const plan = await storage.planMove(site, { kind: "move", from: "repository", to: "bucket" });

    expect(plan.files).toBeGreaterThan(5);
    expect(plan.references).toBeGreaterThan(0);
    expect(plan.done).toBe(0);
    expect(plan.keepCopies).toBe(false);
    // The plan changed nothing.
    expect(read(root, AUTHOR)).toContain("photo: /images/team/tomas-reyes.svg");

    const first = await storage.move(site, { kind: "move", from: "repository", to: "bucket" });

    expect(first.copied).toBe(plan.files);
    expect(read(root, AUTHOR)).toContain(`photo: ${publicUrl}/lowfield/team/tomas-reyes.svg`);
    expect(fake.buckets.get("moves")!.objects.get("lowfield/team/tomas-reyes.svg")!.body.toString()).toContain("<svg");
    const changes = await site.changes();

    expect(changes.files.find((file) => file.path === PHOTO)?.status).toBe("deleted");
    expect(changes.files.find((file) => file.path === AUTHOR)?.status).toBe("modified");
    // Moved files aren't new uploads: Proof shows the pages, not a list of every file.
    expect(changes.storeUploads ?? []).toEqual([]);

    // Again: everything is there already; nothing is copied or overwritten twice.
    const second = await storage.move(site, { kind: "move", from: "repository", to: "bucket" });

    expect(second.copied).toBe(0);
    await done();
  });

  it("ends as done when files stay because the site's code uses them, and says how many and where", async () => {
    const { storage, site, root, done } = await setUp();
    const plan = await storage.planMove(site, { kind: "move", from: "repository", to: "bucket" });
    const started = await storage.startMove(site, { kind: "move", from: "repository", to: "bucket" });

    expect(started).toMatchObject({ kind: "media", label: "Moving media to the bucket", state: "running" });
    expect((await storage.status(site)).moving?.id).toBe(started.id);
    for (let i = 0; i < 600 && storage.job(started.id)?.state === "running"; i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    const job = storage.job(started.id)!;
    const status = await storage.status(site);
    const result = status.lastMove!;

    // The starter's layout names two pictures, and a move never changes the site's code.
    expect(result.stayedFiles).toBe(2);
    expect(result.stayed).toHaveLength(result.stayedFiles);
    const code = [...new Set(result.stayed.flatMap((item) => item.pages))].sort();

    expect(code).toEqual(["src/layouts/Base.astro"]);
    // It worked: done, with nothing called a problem.
    expect(job.state).toBe("done");
    expect(job.output).toBeUndefined();
    expect(result).toMatchObject({ state: "done", request: { kind: "move", from: "repository", to: "bucket" }, copied: plan.files, removed: plan.files - result.stayedFiles, problems: [] });
    expect(result.pages).toBeGreaterThan(0);
    expect(status.moving).toBeUndefined();
    // The words say how many were copied, how many pages and page templates changed, how many stayed and what still uses them,
    // and which files beside the site name them without keeping anything.
    expect(result.templates).toBe(3);
    expect(result.alsoMentioned).toEqual(["scripts/gallery/sections.md"]);
    expect(job.detail).toBe(result.summary);
    expect(result.summary).toBe(
      `${plan.files} files copied to Cloudflare R2, ${result.pages} pages and 3 page templates updated, ${result.removed} removed from the repository. ` +
        "2 left in the repository: still used by src/layouts/Base.astro. " +
        "The site is built from that file and a move doesn't change it, so what it uses stays where it is. " +
        "Also mentioned in scripts/gallery/sections.md: not part of the site as built, so not changed. Publish to make it live."
    );
    // Every file that stayed is still there, and a page that uses it still has its own address.
    for (const item of result.stayed) expect(read(root, item.path).length, item.path).toBeGreaterThan(0);
    expect((await site.changes()).files.filter((file) => file.status === "deleted")).toHaveLength(result.removed);
    // Still there for whoever comes back later, from another start of the app.
    const later = createMediaStorageService({ home: homeOf(storage), env: {}, listTtlMs: 0 });

    expect((await later.status(site)).lastMove).toEqual(result);
    // And after the library's record is written again (an upload, a new listing of the bucket).
    await site.saveMedia({ filename: "after-the-move.svg", data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="3" height="3"/>') });
    await site.listMedia();
    expect((await storage.status(site)).lastMove).toEqual(result);
    // Run again: nothing new to copy, the same files stay, and it is still done.
    const again = await storage.move(site, { kind: "move", from: "repository", to: "bucket" });

    expect(again.problems).toEqual([]);
    expect(again.copied).toBe(0);
    expect(again.stillMentioned).toHaveLength(result.stayedFiles);
    expect(again.leftAlone).toEqual(code);
    await done();
  });

  it("ends as an error when a file can't be moved, with the list of what went wrong", async () => {
    const { storage, site, done } = await setUp();

    fake.buckets.get("moves")!.objects.set("lowfield/team/tomas-reyes.svg", { body: Buffer.from("<svg>someone else's</svg>"), contentType: "image/svg+xml", cacheControl: null, metadata: {}, etag: "z", lastModified: new Date() });
    const started = await storage.startMove(site, { kind: "move", from: "repository", to: "bucket", keepCopies: true });

    for (let i = 0; i < 600 && storage.job(started.id)?.state === "running"; i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    const job = storage.job(started.id)!;
    const result = (await storage.status(site)).lastMove!;

    expect(job.state).toBe("error");
    expect(job.output).toBe(`${PHOTO}: A different file is already in Cloudflare R2 as “lowfield/team/tomas-reyes.svg”, so this one stays in the repository.`);
    expect(job.detail).toMatch(/\. 1 problem — see the list\. Publish to make it live\.$/);
    expect(result.state).toBe("error");
    expect(result.problems).toEqual([{ path: PHOTO, reason: "A different file is already in Cloudflare R2 as “lowfield/team/tomas-reyes.svg”, so this one stays in the repository." }]);
    // What code and templates use is still not counted among the problems.
    expect(result.problems.some((problem) => /code or templates/.test(problem.reason))).toBe(false);
    await done();
  });

  it("says which files of the site's code still point at the bucket when the files come back", async () => {
    const { storage, site, root, publicUrl, done } = await setUp();
    const layout = join(root, "src/layouts/Base.astro");

    await storage.move(site, { kind: "move", from: "repository", to: "bucket" });
    writeFileSync(layout, `${readFileSync(layout, "utf8")}\n<!-- ${publicUrl}/lowfield/team/tomas-reyes.svg -->\n`);
    const back = await storage.move(site, { kind: "move", from: "bucket", to: "repository" });

    expect(back.problems).toEqual([]);
    expect(back.leftAlone).toEqual(["src/layouts/Base.astro"]);
    expect(back.summary).toContain("src/layouts/Base.astro still points at Cloudflare R2: a move doesn't change the site's code, so change it by hand. The files are still in Cloudflare R2; remove them there once the pages are published.");
    expect(read(root, "src/layouts/Base.astro")).toContain(`${publicUrl}/lowfield/team/tomas-reyes.svg`);
    expect((await storage.status(site)).lastMove).toMatchObject({ state: "done", request: { kind: "move", from: "bucket", to: "repository" }, stayedFiles: 0 });
    await done();
  });

  it.each(STARTERS)("on %s the move moves: a copy stays only for what the site is built from, and the plan says what the move then does", async (starter) => {
    const { storage, site, root, publicUrl, done } = await setUp(starter);
    const expected = ON_STARTERS[starter];
    const plan = await storage.planMove(site, { kind: "move", from: "repository", to: "bucket" });
    const templates = ((await site.model()).templates ?? []).map((template) => template.file);
    const before = new Map(templates.map((file) => [file, read(root, file)]));
    // What was waiting before the move: the settings file, saved when the bucket was connected.
    const waiting = new Set((await site.changes()).files.map((file) => file.path));
    const outcome = await storage.move(site, { kind: "move", from: "repository", to: "bucket" });
    const byPath = (list: Array<{ path: string; pages: string[] }> | undefined) => [...(list ?? [])].map((item) => ({ path: item.path, pages: [...item.pages].sort() })).sort((a, b) => a.path.localeCompare(b.path));

    expect(outcome.problems).toEqual([]);
    // The counts, as the table has them.
    expect({ files: plan.files, removes: plan.removes, templates: plan.templates ?? 0 }).toEqual({ files: expected.files, removes: expected.removes, templates: expected.templates });
    expect(keptBy(plan.stillMentioned)).toEqual(expected.keeps);
    expect(plan.leftAlone).toEqual(Object.keys(expected.keeps).sort());
    expect(plan.alsoMentioned).toEqual(expected.beside);
    expect(outcome.alsoMentioned).toEqual(expected.beside);
    expect(outcome.rewrittenTemplates ?? 0).toBe(expected.templates);
    expect(outcome.rewrittenPages).toBe(plan.pages);
    // Galley's page templates that named a picture now name its address in the bucket, as changes Proof shows;
    // a file beside the site is as it was.
    const changed = (await site.changes()).files.filter((file) => file.status !== "deleted" && !waiting.has(file.path)).map((file) => file.path);
    const updated = templates.filter((file) => read(root, file) !== before.get(file));

    expect(updated).toHaveLength(expected.templates);
    for (const file of updated) {
      expect(read(root, file), file).toContain(publicUrl);
      expect(changed, file).toContain(file);
    }
    for (const file of expected.beside) expect(changed, file).not.toContain(file);
    // The write surface: every file the move wrote is one content mode may write, or one of the templates the
    // settings name. Nothing of the site's code, and nothing beside the site.
    const writable = (await site.model()).writable;

    expect(changed.filter((path) => !templates.includes(path) && writeRefusal(path, writable, "content") !== null)).toEqual([]);
    for (const file of Object.keys(expected.keeps)) expect(changed, file).not.toContain(file);
    // Every file the plan said would stay stayed, no other did, and each for the files the plan named.
    expect(byPath(plan.stillMentioned)).toEqual(byPath(outcome.stillMentioned));
    expect(plan.leftAlone ?? []).toEqual(outcome.leftAlone ?? []);
    expect(plan.removes).toBe(outcome.removed);
    expect(plan.files).toBe(outcome.copied);
    expect(plan.removes + (plan.stillMentioned?.length ?? 0)).toBe(plan.files);
    // And on disk: what stayed is there, what was removed waits in Proof as a deletion.
    for (const item of outcome.stillMentioned ?? []) expect(read(root, item.path).length, item.path).toBeGreaterThan(0);
    expect((await site.changes()).files.filter((file) => file.status === "deleted")).toHaveLength(outcome.removed);
    // Run again: the plan is still the truth (nothing new to copy, the same files stay).
    const again = await storage.planMove(site, { kind: "move", from: "repository", to: "bucket" });
    const second = await storage.move(site, { kind: "move", from: "repository", to: "bucket" });

    expect(byPath(again.stillMentioned)).toEqual(byPath(second.stillMentioned));
    expect(again.removes).toBe(second.removed);
    await done();
  });

  it.each(STARTERS)("on %s with build mode off, the page templates are left and keep what they use", async (starter) => {
    const { storage, site, root, done } = await setUp(starter, (config) => ({ ...config, ai: { ...config.ai, allowBuild: false } }));
    const templates = ((await site.model()).templates ?? []).map((template) => template.file);
    const before = new Map(templates.map((file) => [file, read(root, file)]));
    const plan = await storage.planMove(site, { kind: "move", from: "repository", to: "bucket" });
    const outcome = await storage.move(site, { kind: "move", from: "repository", to: "bucket" });

    expect(outcome.problems).toEqual([]);
    expect(plan.templates).toBeUndefined();
    expect(outcome.rewrittenTemplates).toBeUndefined();
    expect({ removes: plan.removes, removed: outcome.removed }).toEqual({ removes: ON_STARTERS[starter].withBuildModeOff, removed: ON_STARTERS[starter].withBuildModeOff });
    // Not one template was written, and each is named among the files a move doesn't change.
    for (const file of templates) expect(read(root, file), file).toBe(before.get(file));
    const naming = templates.filter((file) => Object.hasOwn(keptBy(plan.stillMentioned), file));

    expect(naming.length).toBe(ON_STARTERS[starter].templates);
    expect(plan.leftAlone).toEqual([...naming, ...Object.keys(ON_STARTERS[starter].keeps)].sort());
    expect(outcome.leftAlone).toEqual(plan.leftAlone);
    await done();
  });

  it.each(STARTERS)("on %s, a folder the settings say the build reads counts as what the site is built from", async (starter) => {
    const { storage, site, root, done } = await setUp(starter, (config) => ({ ...config, build: { ...config.build, sources: ["scripts/gallery/**"] } }));
    const plan = await storage.planMove(site, { kind: "move", from: "repository", to: "bucket" });
    const gallery = read(root, GALLERY);
    const outcome = await storage.move(site, { kind: "move", from: "repository", to: "bucket" });

    expect(outcome.problems).toEqual([]);
    expect((await site.model()).builtFrom).toContain("scripts/gallery/**");
    expect({ removes: plan.removes, removed: outcome.removed }).toEqual({ removes: ON_STARTERS[starter].withGalleryBuilt, removed: ON_STARTERS[starter].withGalleryBuilt });
    // The script's file keeps every picture it names, isn't changed, and is no longer listed as beside the site.
    expect(plan.leftAlone).toContain(GALLERY);
    expect(plan.alsoMentioned ?? []).not.toContain(GALLERY);
    expect(read(root, GALLERY)).toBe(gallery);
    for (const item of outcome.stillMentioned ?? []) expect(read(root, item.path).length, item.path).toBeGreaterThan(0);
    await done();
  });

  it("foresees a file that stays for a mention the move doesn't read, in a page it does update", async () => {
    const { storage, site, root, done } = await setUp();
    const page = join(root, AUTHOR);

    // One line holds the address twice: once as the photo (read and updated), once inside a sentence (left as it is).
    writeFileSync(page, readFileSync(page, "utf8").replace("photo: /images/team/tomas-reyes.svg", "photo: /images/team/tomas-reyes.svg # was:/images/team/tomas-reyes.svg"));
    const plan = await storage.planMove(site, { kind: "move", from: "repository", to: "bucket" });
    const outcome = await storage.move(site, { kind: "move", from: "repository", to: "bucket" });

    expect(plan.stillMentioned).toContainEqual({ path: PHOTO, pages: [AUTHOR] });
    expect(outcome.stillMentioned).toContainEqual({ path: PHOTO, pages: [AUTHOR] });
    expect(plan.removes).toBe(outcome.removed);
    await done();
  });

  it("with the copies kept, the plan removes nothing and names nothing as staying", async () => {
    const { storage, site, done } = await setUp("astro-editorial");
    const plan = await storage.planMove(site, { kind: "move", from: "repository", to: "bucket", keepCopies: true });

    expect(plan.removes).toBe(0);
    expect(plan.stillMentioned).toBeUndefined();
    expect(plan.leftAlone).toBeUndefined();
    await done();
  });

  it("changes only real references, and a round trip leaves the page byte for byte as it was", async () => {
    const { storage, site, root, publicUrl, done } = await setUp();
    const page = join(root, AUTHOR);
    const lookalikes = [
      "Partner logo: https://partner.example/images/team/tomas-reyes.svg",
      "Their copy: //cdn.example/images/team/tomas-reyes.svg",
      "Elsewhere on the site: /blog/images/team/tomas-reyes.svg and /about/favicon.svg",
      "In a word: logo/favicon.svg",
      "A real one: ![Icon](/favicon.svg) and src=\"/images/team/tomas-reyes.svg?v=2\".",
      "Angle brackets: [x](</favicon.svg>)",
      "Escaped quotes: <img src=&quot;/images/team/tomas-reyes.svg&quot;>",
      'JSON slashes: {"image":"\\/images\\/team\\/tomas-reyes.svg"}',
      "A table: |/favicon.svg|x|",
    ].join("\n");
    const original = `${readFileSync(page, "utf8")}\n${lookalikes}\n`;

    writeFileSync(page, original);
    await storage.move(site, { kind: "move", from: "repository", to: "bucket", keepCopies: true });
    const moved = readFileSync(page, "utf8");

    expect(moved).toContain("https://partner.example/images/team/tomas-reyes.svg");
    expect(moved).toContain("//cdn.example/images/team/tomas-reyes.svg");
    expect(moved).toContain("/blog/images/team/tomas-reyes.svg and /about/favicon.svg");
    expect(moved).toContain("In a word: logo/favicon.svg");
    expect(moved).toContain(`![Icon](${publicUrl}/lowfield/favicon.svg)`);
    expect(moved).toContain(`src="${publicUrl}/lowfield/team/tomas-reyes.svg?v=2"`);
    expect(moved).toContain(`photo: ${publicUrl}/lowfield/team/tomas-reyes.svg`);
    expect(moved).toContain(`[x](<${publicUrl}/lowfield/favicon.svg>)`);
    expect(moved).toContain(`src=&quot;${publicUrl}/lowfield/team/tomas-reyes.svg&quot;`);
    expect(moved).toContain(`{"image":"${`${publicUrl}/lowfield/team/tomas-reyes.svg`.replace(/\//g, "\\/")}"}`);
    expect(moved).toContain(`|${publicUrl}/lowfield/favicon.svg|x|`);

    await storage.move(site, { kind: "move", from: "bucket", to: "repository" });
    expect(readFileSync(page, "utf8")).toBe(original);
    await done();
  });

  it("never removes a repository file a page still mentions in a form Galley doesn't change", async () => {
    const { storage, site, root, done } = await setUp();
    const page = join(root, AUTHOR);

    writeFileSync(page, `${readFileSync(page, "utf8")}\nIts own words:/images/team/tomas-reyes.svg\n`);
    const plan = await storage.planMove(site, { kind: "move", from: "repository", to: "bucket" });

    expect(plan.stillMentioned).toContainEqual({ path: PHOTO, pages: [AUTHOR] });
    const outcome = await storage.move(site, { kind: "move", from: "repository", to: "bucket" });

    expect(outcome.stillMentioned).toContainEqual({ path: PHOTO, pages: [AUTHOR] });
    expect(outcome.summary).toMatch(/left in the repository: still used by .*src\/content\/authors\/tomas-reyes\.md/);
    expect(read(root, PHOTO)).toContain("<svg");
    expect((await site.changes()).files.find((file) => file.path === PHOTO)).toBeUndefined();
    await done();
  });

  it("keeps the repository's copies when asked, and leaves a different file of the same name alone", async () => {
    const { storage, site, root, done } = await setUp();

    fake.buckets.get("moves")!.objects.set("lowfield/team/tomas-reyes.svg", { body: Buffer.from("<svg>someone else's</svg>"), contentType: "image/svg+xml", cacheControl: null, metadata: {}, etag: "z", lastModified: new Date() });
    const size = readFileSync(join(root, "public/images/team/nell-okafor.svg")).byteLength;

    fake.buckets.get("moves")!.objects.set("lowfield/team/nell-okafor.svg", { body: Buffer.alloc(size, 32), contentType: "image/svg+xml", cacheControl: null, metadata: {}, etag: "0123456789abcdef0123456789abcdef", lastModified: new Date() });
    const outcome = await storage.move(site, { kind: "move", from: "repository", to: "bucket", keepCopies: true });

    expect(outcome.removed).toBe(0);
    expect(outcome.problems.find((problem) => problem.path === PHOTO)?.reason).toMatch(/different file is already/);
    // The same size isn't enough: different bytes are a different file.
    expect(outcome.problems.find((problem) => problem.path === "public/images/team/nell-okafor.svg")?.reason).toMatch(/different file is already/);
    expect(read(root, "src/content/authors/nell-okafor.md")).toContain("photo: /images/team/nell-okafor.svg");
    // Its page still uses the repository's file.
    expect(read(root, AUTHOR)).toContain("photo: /images/team/tomas-reyes.svg");
    expect(fake.buckets.get("moves")!.objects.get("lowfield/team/tomas-reyes.svg")!.body.toString()).toBe("<svg>someone else's</svg>");
    expect((await site.changes()).files.some((file) => file.status === "deleted")).toBe(false);
    await done();
  });

  it("back to the repository: files come back and pages use site addresses again; the bucket keeps its files", async () => {
    const { storage, site, root, done } = await setUp();

    await storage.move(site, { kind: "move", from: "repository", to: "bucket" });
    const back = await storage.move(site, { kind: "move", from: "bucket", to: "repository" });

    expect(read(root, AUTHOR)).toContain("photo: /images/team/tomas-reyes.svg");
    expect(read(root, PHOTO)).toContain("<svg");
    expect(back.summary).toMatch(/still in Cloudflare R2/);
    expect(fake.buckets.get("moves")!.objects.has("lowfield/team/tomas-reyes.svg")).toBe(true);
    // The photo is as it was: nothing waits to be published for it.
    expect((await site.changes()).files.find((file) => file.path === PHOTO)).toBeUndefined();
    await done();
  });

  it("says which files aren't published yet, and keeps them in Proof once moved", async () => {
    const { storage, site, root, done } = await setUp();

    await site.writeFile("public/images/draft.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="3" height="3"/>', { origin: "user", mode: "content" });
    const plan = await storage.planMove(site, { kind: "move", from: "repository", to: "bucket", keepCopies: true });

    expect(plan.unpublished).toBe(1);
    await storage.move(site, { kind: "move", from: "repository", to: "bucket", keepCopies: true });
    const pending = (await site.changes()).storeUploads ?? [];

    expect(pending.map((item) => item.key)).toEqual(["lowfield/draft.svg"]);
    await done();
  });

  it("counts what is already back as names, not patterns", async () => {
    const { storage, site, root, publicUrl, done } = await setUp();

    fake.buckets.get("moves")!.objects.set("lowfield/st*r.svg", { body: Buffer.from("<svg/>"), contentType: "image/svg+xml", cacheControl: null, metadata: {}, etag: "e", lastModified: new Date() });
    writeFileSync(join(root, "public/images/stXr.svg"), "<svg/>");
    writeFileSync(join(root, AUTHOR), `${readFileSync(join(root, AUTHOR), "utf8")}\n![s](${publicUrl}/lowfield/st*r.svg)\n`);
    const plan = await storage.planMove(site, { kind: "move", from: "bucket", to: "repository" });

    expect(plan.files).toBe(1);
    expect(plan.done).toBe(0);
    await done();
  });

  it("runs one move at a time for a site", async () => {
    const { storage, site, done } = await setUp();
    const both = await Promise.allSettled([storage.startMove(site, { kind: "move", from: "repository", to: "bucket", keepCopies: true }), storage.startMove(site, { kind: "move", from: "repository", to: "bucket", keepCopies: true })]);

    expect(both.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(String((both.find((result) => result.status === "rejected") as PromiseRejectedResult).reason)).toMatch(/already being moved/);
    const job = (both.find((result) => result.status === "fulfilled") as PromiseFulfilledResult<{ id: string }>).value;

    for (let i = 0; i < 600 && storage.job(job.id)?.state === "running"; i += 1) await new Promise((resolve) => setTimeout(resolve, 200));
    await done();
  });

  it("changes the bucket's address only once the new one serves the files", async () => {
    const { storage, site, root, publicUrl, done } = await setUp();

    await storage.move(site, { kind: "move", from: "repository", to: "bucket" });
    await expect(storage.move(site, { kind: "address", store: "bucket", publicUrl: "http://127.0.0.1:9/nowhere" })).rejects.toThrow(/doesn't serve this bucket's files yet/);
    expect(read(root, AUTHOR)).toContain(publicUrl);

    const next = publicUrl.replace("127.0.0.1", "localhost");
    const plan = await storage.planMove(site, { kind: "address", store: "bucket", publicUrl: next });

    expect(plan.references).toBeGreaterThan(0);
    const outcome = await storage.move(site, { kind: "address", store: "bucket", publicUrl: next });

    expect(outcome.problems).toEqual([]);
    expect(read(root, AUTHOR)).toContain(`photo: ${next}/lowfield/team/tomas-reyes.svg`);
    expect((await site.readConfig())?.media?.storage?.publicUrl).toBe(next);
    // New uploads use the new address.
    expect((await site.saveMedia({ filename: "new.svg", data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') })).url.startsWith(next)).toBe(true);
    await done();
  });

  it("keeps the old address while a file of the site's code still uses it, and says which", async () => {
    const { storage, site, root, publicUrl, done } = await setUp();
    const layout = join(root, "src/layouts/Base.astro");

    await storage.move(site, { kind: "move", from: "repository", to: "bucket" });
    writeFileSync(layout, `${readFileSync(layout, "utf8")}\n<!-- ${publicUrl}/lowfield/team/tomas-reyes.svg -->\n`);
    const next = publicUrl.replace("127.0.0.1", "localhost");
    const outcome = await storage.move(site, { kind: "address", store: "bucket", publicUrl: next });

    expect(outcome.problems).toEqual([{ path: "src/layouts/Base.astro", reason: "Couldn't update it: the site is built from it and a move doesn't change the site's code, so Galley leaves it as it is" }]);
    expect(outcome.summary).toMatch(/1 couldn't be: the address in use stays the old one until they are/);
    expect((await site.readConfig())?.media?.storage?.publicUrl).toBe(publicUrl);
    expect((await storage.status(site)).lastMove).toMatchObject({ state: "error", request: { kind: "address" } });
    await done();
  });
});
