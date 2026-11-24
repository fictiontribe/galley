/**
 * Cloudflare Images against its strict stand-in: the check and its precise
 * refusals, pictures to Images and everything else to the bucket (or the
 * repository), sizes from the pictures' metadata, every address form
 * recognised, and the moves.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createImagesStore, imageIdOf } from "../../src/media-storage/cloudflare-images";
import { createMediaStorageService } from "../../src/media-storage/service";
import type { MediaImagesConfig } from "../../src/types";
import { cleanupAll, disposeAll, makeSite, openSite, pngHeader } from "../site/helpers";
import { startFakeImages, type FakeImages } from "./fakes/cloudflare-images";
import { startFakeS3, type FakeS3 } from "./fakes/s3";
import { fakeSite, tempHome } from "./helpers";

const ACCOUNT = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const FREE = "f".repeat(32);
const TOKEN = "images-token-0123456789abcdefghijklmnop";
const READ_ONLY = "images-read-0123456789abcdefghijklmnopq";
const DEPLOY = "deploy-key-without-images-0123456789abc";
let images: FakeImages;
let s3: FakeS3;

beforeAll(async () => {
  images = await startFakeImages();
  images.addAccount(ACCOUNT, { hash: "Hx9kQ2wAcct", flexibleVariants: true });
  images.addAccount(FREE, { hash: "FreeHash001", paid: false });
  images.addToken({ value: TOKEN, accounts: { [ACCOUNT]: "write", [FREE]: "write" } });
  images.addToken({ value: READ_ONLY, accounts: { [ACCOUNT]: "read" } });
  images.addToken({ value: DEPLOY, accounts: {} });
  s3 = await startFakeS3();
  s3.addBucket("files", { region: "auto" });
  s3.addKey({ id: "0123456789abcdef0123456789abcdef", secret: "9".repeat(64), buckets: { files: ["read", "write", "list", "delete"] } });
});
afterAll(async () => {
  await images.close();
  await s3.close();
});
afterEach(async () => {
  await disposeAll();
  cleanupAll();
});

const config = (overrides: Partial<MediaImagesConfig> = {}): MediaImagesConfig => ({ connector: "cloudflare-images", account: ACCOUNT, accountHash: "Hx9kQ2wAcct", ...overrides });

async function service(options: { deployKey?: string } = {}) {
  const home = await tempHome();
  const storage = createMediaStorageService({
    home: home.home,
    env: {},
    listTtlMs: 0,
    imagesApi: images.apiBase,
    publicFetch: (url, init) => fetch(images.local(String(url)), init),
    settings: { readSecret: async (name) => (name === "cloudflare" ? (options.deployKey ?? null) : null) },
  });

  return { storage, done: home.done };
}

describe("addresses", () => {
  it("finds the image id in every form Cloudflare delivers it", () => {
    expect(imageIdOf("Hx9kQ2wAcct", "https://imagedelivery.net/Hx9kQ2wAcct/083eb7b2-5392/public")).toBe("083eb7b2-5392");
    expect(imageIdOf("Hx9kQ2wAcct", "https://imagedelivery.net/Hx9kQ2wAcct/083eb7b2-5392/w=400,sharpen=3")).toBe("083eb7b2-5392");
    expect(imageIdOf("Hx9kQ2wAcct", "https://www.example.com/cdn-cgi/imagedelivery/Hx9kQ2wAcct/083eb7b2-5392/thumb")).toBe("083eb7b2-5392");
    expect(imageIdOf("Hx9kQ2wAcct", "https://imagedelivery.net/OtherHash/083eb7b2-5392/public")).toBeNull();
    expect(imageIdOf("Hx9kQ2wAcct", "https://www.example.com/images/083eb7b2-5392/public")).toBeNull();
    const store = createImagesStore({ config: config({ deliveryUrl: "https://www.example.com", variant: "hero" }), token: TOKEN });

    expect(store.urlOf("abc")).toBe("https://www.example.com/cdn-cgi/imagedelivery/Hx9kQ2wAcct/abc/hero");
    expect(store.rebase!("https://www.example.com/cdn-cgi/imagedelivery/Hx9kQ2wAcct/abc/w=400", "https://imagedelivery.net")).toBe("https://imagedelivery.net/Hx9kQ2wAcct/abc/w=400");
  });
});

describe("connecting Cloudflare Images", () => {
  it("checks for real with its own token, then saves the settings and keeps the token out of the site", async () => {
    const { storage, done } = await service();
    const site = fakeSite();
    const result = await storage.connectImages(site.site, { config: config(), token: TOKEN });

    expect(result.check.ok, result.check.message).toBe(true);
    expect(site.config.media?.images).toEqual(config());
    expect(JSON.stringify(site.config)).not.toContain(TOKEN);
    expect(result.status?.images).toMatchObject({ connected: true, token: { configured: true, use: "own" } });
    expect(images.accounts.get(ACCOUNT)!.images.size).toBe(0);
    await done();
  });

  it("names what to change for each refusal", async () => {
    const { storage, done } = await service({ deployKey: DEPLOY });
    const site = fakeSite();
    const failing: Array<[Parameters<typeof storage.connectImages>[1], string, string, RegExp]> = [
      [{ config: config(), token: "not-a-token-at-all-but-long-enough-000" }, "reach", "token", /doesn't accept that API token/],
      [{ config: config(), token: READ_ONLY }, "write", "token", /Cloudflare Images › Edit/],
      [{ config: config(), useDeployKey: true }, "reach", "token", /site's Cloudflare key \(the one for putting it online\) doesn't have Cloudflare Images: Edit/],
      [{ config: config({ account: "0".repeat(32) }), token: TOKEN }, "reach", "account", /doesn't know that Account ID/],
      [{ config: config({ account: FREE, accountHash: "FreeHash001" }), token: TOKEN }, "reach", "", /needs the Images Paid plan/],
      [{ config: config({ accountHash: "WrongHash99" }), token: TOKEN }, "public", "publicUrl", /Check the account hash/],
      [{ config: config({ variant: "missing" }), token: TOKEN }, "public", "publicUrl", /variant exists/],
      [{ config: config({ deliveryUrl: "http://www.example.com" }), token: TOKEN }, "settings", "deliveryUrl", /https/],
    ];

    for (const [request, step, field, message] of failing) {
      const result = await storage.connectImages(site.site, request);
      const failed = result.check.steps.find((s) => s.state === "failed");

      expect(failed?.id, String(message)).toBe(step);
      if (field) expect(failed?.field).toBe(field);
      expect(result.check.message).toMatch(message);
      expect(JSON.stringify(result)).not.toContain(TOKEN);
    }
    expect(site.saves).toBe(0);
    // Failed after the upload: the test picture is removed all the same.
    expect(images.accounts.get(ACCOUNT)!.images.size).toBe(0);
    await done();
  });

  it("uses the site's Cloudflare key when it carries Images: Edit", async () => {
    images.addToken({ value: "deploy-key-with-images-0123456789abcdef", accounts: { [ACCOUNT]: "write" } });
    const { storage, done } = await service({ deployKey: "deploy-key-with-images-0123456789abcdef" });
    const site = fakeSite();
    const result = await storage.connectImages(site.site, { config: config(), useDeployKey: true });

    expect(result.check.ok).toBe(true);
    expect(result.status?.images.token.use).toBe("deploy");
    await done();
  });
});

describe("a site with pictures in Images and other files in a bucket", { timeout: 240_000 }, () => {
  async function setUp(withBucket: boolean) {
    const { storage, done } = await service();
    const root = makeSite();
    const { site } = await openSite(root, { media: storage });

    expect((await storage.connectImages(site, { config: config(), token: TOKEN })).check.ok).toBe(true);
    if (withBucket) {
      const bucket = await storage.connect(site, { config: { connector: "r2", account: "0123456789abcdef0123456789abcdef", bucket: "files", endpoint: s3.endpoint, publicUrl: s3.publicUrl("files") }, accessKeyId: "0123456789abcdef0123456789abcdef", secretAccessKey: "9".repeat(64) });

      expect(bucket.check.ok).toBe(true);
    }
    return { storage, site, root, done };
  }

  it("routes by what each store takes, and says where each file went", async () => {
    const { site, done } = await setUp(true);
    const picture = await site.saveMedia({ filename: "Wool Coat.png", data: pngHeader(1600, 900) });

    expect(picture).toMatchObject({ location: "images", name: "wool-coat.png", width: 1600, height: 900 });
    expect(picture.url).toMatch(/^https:\/\/imagedelivery\.net\/Hx9kQ2wAcct\/[0-9a-f-]{36}\/public$/);
    const pdf = await site.saveMedia({ filename: "Menu.pdf", data: Buffer.from("%PDF-1.4\n%%EOF") });

    expect(pdf.location).toBe("bucket");
    expect(pdf.placement).toBe("Kept in the bucket: Cloudflare Images takes only pictures (PNG, JPG, GIF, WebP or SVG).");
    // Over Images' 10 MB: the bucket takes it.
    const big = Buffer.concat([Buffer.from(pngHeader(4000, 3000)), Buffer.alloc(11 * 1024 * 1024)]);

    expect((await site.saveMedia({ filename: "huge.png", data: big })).placement).toMatch(/up to 10 MB/);
    await done();
  });

  it("keeps other files in the repository when there is no bucket, and says so", async () => {
    const { site, done } = await setUp(false);
    const pdf = await site.saveMedia({ filename: "Menu.pdf", data: Buffer.from("%PDF-1.4\n%%EOF") });

    expect(pdf.location).toBeUndefined();
    expect(pdf.placement).toMatch(/^Kept in the repository: Cloudflare Images takes only pictures/);
    await done();
  });

  it("reads and deletes only pictures this site holds", async () => {
    const { storage, site, done } = await setUp(false);
    const own = await site.saveMedia({ filename: "own.png", data: pngHeader(8, 8) });

    images.accounts.get(ACCOUNT)!.images.set("someone-elses", { id: "someone-elses", filename: "theirs.png", meta: {}, uploaded: new Date().toISOString(), body: Buffer.from("x"), type: "image/png" });
    for (const path of ["images:someone-elses", "images:../someone-elses", "images:a/./b"]) {
      await expect(storage.readStored(site, path), path).rejects.toThrow("That file isn't one of this site's.");
      await expect(storage.deleteStored(site, [path]), path).rejects.toThrow("That file isn't one of this site's.");
    }
    expect(images.accounts.get(ACCOUNT)!.images.has("someone-elses")).toBe(true);
    expect(await storage.readStored(site, own.path)).not.toBeNull();
    images.accounts.get(ACCOUNT)!.images.delete("someone-elses");
    await done();
  });

  it("knows sizes from the listing, finds pages using any variant, and refuses to delete a used picture", async () => {
    const { storage, site, root, done } = await setUp(false);
    const picture = await site.saveMedia({ filename: "hero.png", data: pngHeader(2400, 1200) });
    // Another app's upload: its size comes from the metadata every listing returns.
    const listed = (await site.listMedia()).find((item) => item.key === picture.key);

    expect([listed?.width, listed?.height]).toEqual([2400, 1200]);
    const page = join(root, "src/content/authors/tomas-reyes.md");

    writeFileSync(page, readFileSync(page, "utf8").replace(/photo: .*/, `photo: ${picture.url.replace(/\/public$/, "/w=400,sharpen=3")}`));
    expect((await storage.usage(site, picture.url)).working.map((w) => w.path)).toEqual(["src/content/authors/tomas-reyes.md"]);
    expect((await storage.deleteStored(site, [picture.path])).refused).toHaveLength(1);
    expect((await site.changes()).storeUploads?.find((item) => item.key === picture.key)?.used).toBe(true);
    await done();
  });

  it("moves pictures there and back — only pictures; the rest stays", async () => {
    const { storage, site, root, done } = await setUp(false);
    const plan = await storage.planMove(site, { kind: "move", from: "repository", to: "images" });

    expect(plan.files).toBeGreaterThan(0);
    const there = await storage.move(site, { kind: "move", from: "repository", to: "images" });
    const photo = readFileSync(join(root, "src/content/authors/tomas-reyes.md"), "utf8");

    expect(photo).toMatch(/photo: https:\/\/imagedelivery\.net\/Hx9kQ2wAcct\/[0-9a-f-]{36}\/public/);
    expect(there.copied).toBeGreaterThan(0);
    // Again: nothing is uploaded twice.
    const again = await storage.move(site, { kind: "move", from: "repository", to: "images", keepCopies: true });

    expect(again.copied).toBe(0);
    const back = await storage.move(site, { kind: "move", from: "images", to: "repository" });

    expect(readFileSync(join(root, "src/content/authors/tomas-reyes.md"), "utf8")).toContain("photo: /images/team/tomas-reyes.svg");
    expect(back.summary).toMatch(/still in Cloudflare Images/);
    await done();
  });
});

describe("make the bucket for me", () => {
  it("makes an R2 bucket and its r2.dev address with the site's Cloudflare key, and removes only that one", async () => {
    images.addAccount("b".repeat(32), { hash: "MakeHash001" });
    images.addAccount("d".repeat(32), { hash: "NoR2Hash001", r2: false });
    images.addToken({ value: "deploy-with-r2-0123456789abcdefghijklm", accounts: {}, r2: ["b".repeat(32), "d".repeat(32)] });
    const without = await service({ deployKey: DEPLOY });
    const site = fakeSite();

    await expect(without.storage.makeBucket(site.site, { account: "b".repeat(32), name: "lowfield-media" })).rejects.toThrow(/add Account › Workers R2 Storage › Edit/);
    await without.done();
    const { storage, done } = await service({ deployKey: "deploy-with-r2-0123456789abcdefghijklm" });

    await expect(storage.makeBucket(site.site, { account: "d".repeat(32), name: "lowfield-media" })).rejects.toThrow(/R2 isn't turned on/);
    const made = await storage.makeBucket(site.site, { account: "b".repeat(32), name: "lowfield-media" });

    expect(made.config).toMatchObject({ connector: "r2", bucket: "lowfield-media", publicUrl: expect.stringMatching(/^https:\/\/pub-.*\.r2\.dev$/) });
    expect(images.accounts.get("b".repeat(32))!.buckets.get("lowfield-media")?.devUrl).toBe(true);
    expect((await storage.status(site.site)).bucket.created?.bucket).toBe("lowfield-media");
    await expect(storage.makeBucket(site.site, { account: "b".repeat(32), name: "lowfield-media" })).rejects.toThrow(/already exists/);
    images.accounts.get("b".repeat(32))!.buckets.set("someone-elses", { devUrl: false, files: 3 });
    images.accounts.get("b".repeat(32))!.buckets.get("lowfield-media")!.files = 2;
    await expect(storage.removeMadeBucket(site.site)).rejects.toThrow(/still has files/);
    images.accounts.get("b".repeat(32))!.buckets.get("lowfield-media")!.files = 0;
    expect((await storage.removeMadeBucket(site.site)).bucket.created).toBeNull();
    expect([...images.accounts.get("b".repeat(32))!.buckets.keys()]).toEqual(["someone-elses"]);
    await done();
  });
});
