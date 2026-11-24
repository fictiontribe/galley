/**
 * The library with a bucket, on a real site (a git checkout of the starter)
 * and the strict stand-in S3: uploads go to the bucket under names that never
 * overwrite, sizes are known without downloading, Proof sees what was put
 * there since the last publish, "used on" reads the working copy and the
 * published version, and deletes refuse anything a page uses.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createMediaStorageService } from "../../src/media-storage/service";
import { cleanupAll, disposeAll, HOME, makeSite, openSite, pngHeader } from "../site/helpers";
import { startFakeS3, type FakeS3 } from "./fakes/s3";
import { tempHome } from "./helpers";

const KEY = { accessKeyId: "0123456789abcdef0123456789abcdef", secretAccessKey: "b".repeat(64) };
let fake: FakeS3;

beforeAll(async () => {
  fake = await startFakeS3({ pageSize: 2 });
});
afterAll(() => fake.close());
afterEach(async () => {
  await disposeAll();
  cleanupAll();
});

async function setUp(bucketName: string) {
  const bucket = fake.addBucket(bucketName, { region: "auto" });
  const key = fake.addKey({ id: KEY.accessKeyId, secret: KEY.secretAccessKey, buckets: { ...(fake.keys.get(KEY.accessKeyId)?.buckets ?? {}), [bucketName]: ["read", "write", "list", "delete"] } });
  const home = await tempHome();
  const storage = createMediaStorageService({ home: home.home, env: {}, listTtlMs: 0 });
  const root = makeSite();
  const { site } = await openSite(root, { media: storage });
  const config = { connector: "r2", account: KEY.accessKeyId, bucket: bucketName, endpoint: fake.endpoint, prefix: "lowfield", publicUrl: fake.publicUrl(bucketName) };
  const connected = await storage.connect(site, { config, ...KEY });

  expect(connected.check.ok).toBe(true);
  return { bucket, key, storage, site, root, base: `${fake.publicUrl(bucketName)}/lowfield/`, done: home.done };
}

describe("a site that keeps its media in a bucket", { timeout: 240_000 }, () => {
  it("uploads to the bucket, never over an existing name, with sizes known", async () => {
    const { bucket, site, base, done } = await setUp("never-overwrite");
    const first = await site.saveMedia({ filename: "My Coat.png", data: pngHeader(1200, 800) });

    expect(first).toMatchObject({ path: "bucket:lowfield/my-coat.png", url: `${base}my-coat.png`, location: "bucket", key: "lowfield/my-coat.png", width: 1200, height: 800, status: "added" });
    // Someone else put a file there under the next name: it is skipped, not replaced.
    bucket.objects.set("lowfield/my-coat-2.png", { body: Buffer.from("theirs"), contentType: "image/png", cacheControl: null, metadata: {}, etag: "x", lastModified: new Date() });
    const second = await site.saveMedia({ filename: "my-coat.png", data: pngHeader(10, 10) });

    expect(second.key).toBe("lowfield/my-coat-3.png");
    expect(bucket.objects.get("lowfield/my-coat-2.png")!.body.toString()).toBe("theirs");
    expect(bucket.objects.get("lowfield/my-coat.png")!.cacheControl).toBe("public, max-age=31536000, immutable");
    // A PDF goes to the bucket too; a subfolder of the media folder becomes part of the key.
    const pdf = await site.saveMedia({ filename: "Menu.pdf", directory: `${(await site.model()).media.dir}/menus`, data: Buffer.from("%PDF-1.4\n%%EOF") });

    expect(pdf.key).toBe("lowfield/menus/menu.pdf");
    // An SVG is saved, not run, when its address is opened on its own.
    const svg = await site.saveMedia({ filename: "logo.svg", data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>') });
    const served = await fetch(svg.url);

    expect(served.headers.get("content-disposition")).toBe("attachment");
    expect(served.headers.get("content-type")).toBe("image/svg+xml");
    expect(bucket.objects.get("lowfield/menus/menu.pdf")!.contentDisposition ?? null).toBeNull();
    // Nothing was written to the repository.
    expect((await site.changes()).files.filter((file) => /my-coat|menu/.test(file.path))).toEqual([]);
    await done();
  });

  it("lists the bucket with the repository, keeping what it knew when the bucket can't be listed", async () => {
    const { key, storage, site, done } = await setUp("listing");

    await site.saveMedia({ filename: "a.png", data: pngHeader(40, 30) });
    // A file uploaded by another copy of Galley: its size comes from what the bucket keeps about it.
    fake.buckets.get("listing")!.objects.set("lowfield/other.png", { body: Buffer.from(pngHeader(64, 48)), contentType: "image/png", cacheControl: null, metadata: { width: "64", height: "48" }, etag: "y", lastModified: new Date() });
    const items = await site.listMedia();
    const stored = items.filter((item) => item.location === "bucket");

    expect(stored.map((item) => [item.key, item.width, item.height, item.status])).toEqual(
      expect.arrayContaining([
        ["lowfield/a.png", 40, 30, "added"],
        ["lowfield/other.png", 64, 48, "clean"],
      ])
    );
    expect(items.some((item) => !item.location)).toBe(true);
    key.buckets.listing = ["read", "write"];
    const again = await site.listMedia();

    expect(again.filter((item) => item.location === "bucket")).toHaveLength(2);
    expect(storage.problems(site.id).bucket).toMatch(/couldn't be listed just now/);
    key.buckets.listing = ["read", "write", "list", "delete"];
    await done();
  });

  it("shows uploads in Proof until a published page uses them, and says where they are used", async () => {
    const { storage, site, root, done } = await setUp("proof");
    const used = await site.saveMedia({ filename: "hero.png", data: pngHeader(1600, 900) });
    const spare = await site.saveMedia({ filename: "spare.png", data: pngHeader(10, 10) });

    let changes = await site.changes();
    expect(changes.storeUploads?.map((item) => [item.key, item.used])).toEqual(expect.arrayContaining([[used.key, false], [spare.key, false]]));

    const home = join(root, ...HOME.split("/"));
    writeFileSync(home, `${readFileSync(home, "utf8")}\n![Hero](${used.url})\n`);
    changes = await site.changes();
    expect(changes.storeUploads?.find((item) => item.key === used.key)?.used).toBe(true);
    // Validation takes a bucket address as a real file.
    expect((await site.validate([HOME])).filter((issue) => issue.message.includes(used.url))).toEqual([]);

    const usage = await storage.usage(site, used.url);
    expect(usage.working.map((page) => page.path)).toEqual([HOME]);
    expect(usage.working[0]!.title).toBeTruthy();
    expect(usage.published).toEqual([]);
    // Another variant of the same address (a query string) is the same file.
    expect((await storage.usage(site, `${used.url}?v=2`)).working).toHaveLength(1);

    // Used by the working copy: refused. Unused: deleted for good.
    const deleted = await storage.deleteStored(site, [used.path, spare.path]);
    expect(deleted.deleted).toEqual([spare.path]);
    expect(deleted.refused).toEqual([{ path: used.path, name: "hero.png", working: [HOME], published: [] }]);
    expect(fake.buckets.get("proof")!.objects.has(spare.key!)).toBe(false);

    await site.publish({ message: "Hero picture" });
    await storage.afterPublish(site);
    changes = await site.changes();
    expect(changes.storeUploads ?? []).toEqual([]);
    expect((await storage.usage(site, used.url)).published).toEqual([HOME]);
    // Published: still refused, even once the working copy stops using it.
    writeFileSync(home, readFileSync(home, "utf8").replace(`![Hero](${used.url})`, ""));
    expect((await storage.deleteStored(site, [used.path])).refused[0]?.published).toEqual([HOME]);
    await done();
  });

  it("reads and deletes only the site's own names: nothing outside its folder, no . or .. parts", async () => {
    const { storage, site, done } = await setUp("confined");
    const own = await site.saveMedia({ filename: "own.png", data: pngHeader(4, 4) });
    const objects = fake.buckets.get("confined")!.objects;
    const secret = { body: Buffer.from("not this site's"), contentType: "image/png", cacheControl: null, metadata: {}, etag: "s", lastModified: new Date() };

    objects.set("other-site/secret.png", secret);
    fake.addBucket("elsewhere", { region: "auto" }).objects.set("secret.png", secret);
    fake.keys.get(KEY.accessKeyId)!.buckets.elsewhere = ["read", "write", "list", "delete"];
    const outside = ["bucket:other-site/secret.png", "bucket:lowfield/../other-site/secret.png", "bucket:lowfield/./own.png", "bucket:lowfield//own.png", "bucket:lowfield/../../elsewhere/secret.png", "bucket:lowfield/..\\x.png"];

    for (const path of outside) {
      await expect(storage.readStored(site, path), path).rejects.toThrow("That file isn't one of this site's.");
      await expect(storage.deleteStored(site, [path]), path).rejects.toThrow("That file isn't one of this site's.");
    }
    expect(objects.has("other-site/secret.png")).toBe(true);
    expect(fake.buckets.get("elsewhere")!.objects.has("secret.png")).toBe(true);
    expect(Buffer.from((await storage.readStored(site, own.path))!).byteLength).toBeGreaterThan(0);
    await done();
  });

  it("keeps a file a page reaches through an earlier address or the bucket's own address, and deletes nothing when it can't search", async () => {
    const { storage, site, root, base, done } = await setUp("every-form");
    const a = await site.saveMedia({ filename: "a.png", data: pngHeader(4, 4) });
    const b = await site.saveMedia({ filename: "b.png", data: pngHeader(4, 4) });
    const home = join(root, ...HOME.split("/"));

    // b through the bucket's own S3 address (path-style on the stand-in).
    writeFileSync(home, `${readFileSync(home, "utf8")}\n![B](${fake.endpoint}/every-form/${b.key})\n`);
    expect((await storage.deleteStored(site, [b.path])).refused).toHaveLength(1);
    // a through the address the bucket had before a change.
    const earlier = base.replace(/\/lowfield\/$/, "");

    writeFileSync(home, `${readFileSync(home, "utf8")}\n![A](${earlier}/${a.key})\n`);
    const next = earlier.replace("127.0.0.1", "localhost");

    await storage.move(site, { kind: "address", store: "bucket", publicUrl: next });
    writeFileSync(home, readFileSync(home, "utf8").replace(`${next}/${a.key}`, `${earlier}/${a.key}`));
    expect((await storage.deleteStored(site, [a.path])).refused).toHaveLength(1);
    // No search: nothing is deleted.
    const blind = new Proxy(site, { get: (target, name) => (name === "grepText" ? undefined : Reflect.get(target, name)) });

    await expect(storage.deleteStored(blind, [a.path])).rejects.toThrow(/can't be searched/);
    expect(fake.buckets.get("every-form")!.objects.has(a.key!)).toBe(true);
    await done();
  });

  it("goes back to the repository once disconnected; the bucket's files stay", async () => {
    const { storage, site, done } = await setUp("disconnect");
    const stored = await site.saveMedia({ filename: "kept.png", data: pngHeader(5, 5) });

    await storage.disconnect(site);
    const local = await site.saveMedia({ filename: "local.png", data: pngHeader(5, 5) });

    expect(local.location).toBeUndefined();
    expect(local.path).toMatch(/local\.png$/);
    expect(fake.buckets.get("disconnect")!.objects.has(stored.key!)).toBe(true);
    await done();
  });
});
