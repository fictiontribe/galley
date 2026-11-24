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
import { cleanupAll, disposeAll, makeSite, openSite } from "../site/helpers";
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

async function setUp() {
  fake.buckets.get("moves")!.objects.clear();
  const home = await tempHome();
  const storage = createMediaStorageService({ home: home.home, env: {}, listTtlMs: 0 });
  const root = makeSite();
  const { site } = await openSite(root, { media: storage });
  const publicUrl = fake.publicUrl("moves");
  const connected = await storage.connect(site, { config: { connector: "r2", account: KEY.accessKeyId, bucket: "moves", endpoint: fake.endpoint, prefix: "lowfield", publicUrl }, ...KEY });

  expect(connected.check.ok).toBe(true);
  return { storage, site, root, publicUrl, done: home.done };
}

const read = (root: string, path: string) => readFileSync(join(root, ...path.split("/")), "utf8");

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

    expect(first.copied).toBe(plan.files - first.problems.filter((p) => !p.reason.startsWith("Couldn't update")).length);
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
    expect(outcome.summary).toMatch(/left in the repository: still mentioned in src\/content\/authors\/tomas-reyes\.md/);
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
});
