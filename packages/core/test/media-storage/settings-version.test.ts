/**
 * The media settings are saved over the version of the settings file they
 * were made from: a key somebody else saved between a connect's read of the
 * file and its save is not set back. A real site, the stand-in bucket and the
 * stand-in Cloudflare Images.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createMediaStorageService } from "../../src/media-storage/service";
import type { OpenSite } from "../../src/site/service";
import type { MediaImagesConfig, MediaStorageConfig } from "../../src/types";
import { cleanupAll, disposeAll, makeSite, openSite } from "../site/helpers";
import { startFakeImages, type FakeImages } from "./fakes/cloudflare-images";
import { startFakeS3, type FakeS3 } from "./fakes/s3";
import { tempHome } from "./helpers";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const KEY = { accessKeyId: ACCOUNT, secretAccessKey: "9".repeat(64) };
const TOKEN = "images-token-0123456789abcdefghijklmnop";
let images: FakeImages;
let s3: FakeS3;

beforeAll(async () => {
  images = await startFakeImages();
  images.addAccount(ACCOUNT, { hash: "Hx9kQ2wAcct", flexibleVariants: true });
  images.addToken({ value: TOKEN, accounts: { [ACCOUNT]: "write" } });
  s3 = await startFakeS3();
  s3.addBucket("files", { region: "auto" });
  s3.addBucket("more-files", { region: "auto" });
  s3.addKey({ id: KEY.accessKeyId, secret: KEY.secretAccessKey, buckets: { files: ["read", "write", "list", "delete"], "more-files": ["read", "write", "list", "delete"] } });
});
afterAll(async () => {
  await images.close();
  await s3.close();
});
afterEach(async () => {
  await disposeAll();
  cleanupAll();
});

const bucket = (name = "files"): MediaStorageConfig => ({ connector: "r2", account: ACCOUNT, bucket: name, endpoint: s3.endpoint, publicUrl: s3.publicUrl(name) });
const pictures = (): MediaImagesConfig => ({ connector: "cloudflare-images", account: ACCOUNT, accountHash: "Hx9kQ2wAcct" });

/** The site as a service holds it, with someone else saving `name` in the settings just before the next save lands. */
function withSomeoneElseSaving(site: OpenSite, name: string): OpenSite {
  let saved = false;

  return new Proxy(site, {
    get(target, key) {
      if (key === "saveConfig") {
        return async (...args: Parameters<OpenSite["saveConfig"]>) => {
          if (!saved) {
            saved = true;
            await target.saveConfig({ ...(await target.readConfig()), name });
          }
          return target.saveConfig(...args);
        };
      }
      const value = Reflect.get(target, key) as unknown;

      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

describe("the media settings are saved over the version they were made from", { timeout: 120_000 }, () => {
  it("connecting a bucket, changing it and stopping, and the same for Cloudflare Images, keep a key someone else saved meanwhile", async () => {
    const home = await tempHome();
    const storage = createMediaStorageService({
      home: home.home,
      env: {},
      listTtlMs: 0,
      imagesApi: images.apiBase,
      publicFetch: (url, init) => fetch(String(url).startsWith(s3.publicBase) ? String(url) : images.local(String(url)), init),
    });
    const { site } = await openSite(makeSite());

    try {
      // Connecting a bucket.
      expect((await storage.connect(withSomeoneElseSaving(site, "One"), { config: bucket(), ...KEY })).check.ok).toBe(true);
      expect(await site.readConfig()).toMatchObject({ name: "One", media: { storage: bucket() } });
      // Changing it: another bucket.
      expect((await storage.connect(withSomeoneElseSaving(site, "Two"), { config: bucket("more-files"), ...KEY })).check.ok).toBe(true);
      expect(await site.readConfig()).toMatchObject({ name: "Two", media: { storage: bucket("more-files") } });
      // Cloudflare Images beside it.
      expect((await storage.connectImages(withSomeoneElseSaving(site, "Three"), { config: pictures(), token: TOKEN })).check.ok).toBe(true);
      expect(await site.readConfig()).toMatchObject({ name: "Three", media: { storage: bucket("more-files"), images: pictures() } });
      // Stopping each.
      await storage.disconnectImages(withSomeoneElseSaving(site, "Four"));
      expect(await site.readConfig()).toMatchObject({ name: "Four", media: { storage: bucket("more-files") } });
      expect((await site.readConfig())?.media?.images).toBeUndefined();
      await storage.disconnect(withSomeoneElseSaving(site, "Five"));
      expect(await site.readConfig()).toMatchObject({ name: "Five" });
      expect((await site.readConfig())?.media?.storage).toBeUndefined();
    } finally {
      await home.done();
    }
  });
});
