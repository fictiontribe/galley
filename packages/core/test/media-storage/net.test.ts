/**
 * Media storage's outbound requests on a hosted install: https and public
 * addresses only, checked before connecting; redirects asked for again, never
 * followed blindly; settings that don't pass the checks are not used.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateConfig } from "../../src/content/config/schema";
import { createMediaFetch, getFollowing } from "../../src/media-storage/net";
import { createMediaStorageService } from "../../src/media-storage/service";
import { startFakeS3, type FakeS3 } from "./fakes/s3";
import { fakeSite, tempHome } from "./helpers";

let fake: FakeS3;
const KEY = { accessKeyId: "0123456789abcdef0123456789abcdef", secretAccessKey: "1".repeat(64) };

beforeAll(async () => {
  fake = await startFakeS3();
  fake.addBucket("guarded", { region: "auto" });
  fake.addKey({ id: KEY.accessKeyId, secret: KEY.secretAccessKey, buckets: { guarded: ["read", "write", "list", "delete"] } });
});
afterAll(() => fake.close());

const resolveTo = (address: string) => async () => [{ address, family: 4 as const }];

describe("the guarded fetch", () => {
  it("on a hosted install, refuses http, loopback, private and link-local addresses before connecting", async () => {
    const hosted = createMediaFetch({ hosted: true, maxBytes: 1024, resolve: resolveTo("10.0.0.5") });

    await expect(hosted("http://media.example.com/a.png")).rejects.toThrow(/https/);
    await expect(hosted("https://media.example.com/a.png")).rejects.toThrow(/private or local network/);
    await expect(createMediaFetch({ hosted: true, maxBytes: 1024, resolve: resolveTo("169.254.169.254") })("https://metadata.example/latest")).rejects.toThrow(/private or local network/);
    await expect(createMediaFetch({ hosted: true, maxBytes: 1024 })("https://127.0.0.1:9000/x")).rejects.toThrow(/private or local network/);
  });

  it("locally, reaches this computer's own stand-in, and doesn't read an answer over the cap", async () => {
    const local = createMediaFetch({ hosted: false, maxBytes: 64 });
    const small = await local(`${fake.publicUrl("guarded")}/missing.png`);

    expect(small.status).toBe(404);
    fake.buckets.get("guarded")!.objects.set("big.bin", { body: Buffer.alloc(4096), contentType: "application/octet-stream", cacheControl: null, metadata: {}, etag: "b", lastModified: new Date() });
    await expect(local(`${fake.publicUrl("guarded")}/big.bin`)).rejects.toThrow(/larger than/);
  });

  it("asks for each redirect again, so the guard checks every address", async () => {
    const asked: string[] = [];
    const doFetch = (async (url: string | URL) => {
      asked.push(String(url));
      if (asked.length === 1) return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
      throw new Error("refused by the guard");
    }) as typeof fetch;

    await expect(getFollowing(doFetch, "https://media.example.com/a.png")).rejects.toThrow("refused by the guard");
    expect(asked).toEqual(["https://media.example.com/a.png", "http://169.254.169.254/latest/meta-data"]);
  });
});

describe("a hosted install's media settings", () => {
  it("must use https, and settings that don't pass the checks are not used", async () => {
    const home = await tempHome();
    const hosted = createMediaStorageService({ home: home.home, env: {}, hosted: true });
    const site = fakeSite();
    const config = { connector: "r2", account: KEY.accessKeyId, bucket: "guarded", endpoint: fake.endpoint, publicUrl: fake.publicUrl("guarded") };
    const result = await hosted.connect(site.site, { config, ...KEY });

    expect(result.check.steps[0]).toMatchObject({ id: "settings", state: "failed" });
    expect(result.check.message).toMatch(/https/);
    // Written into the file by hand: not used.
    site.config = { media: { storage: config } };
    expect(await hosted.stores(site.site)).toEqual([]);
    expect((await hosted.status(site.site)).bucket.connected).toBe(false);
    // Locally, the same settings are this computer's own stand-in, and work.
    const local = createMediaStorageService({ home: home.home, env: {} });
    expect((await local.connect(fakeSite().site, { config, ...KEY })).check.ok).toBe(true);
    await home.done();
  });

  it("the settings file itself refuses other schemes and bucket names that aren't bucket names", () => {
    const base = { connector: "r2", account: KEY.accessKeyId, bucket: "guarded", publicUrl: "https://media.example.com" };

    expect(validateConfig({ media: { storage: base } }).ok).toBe(true);
    expect(validateConfig({ media: { storage: { ...base, publicUrl: "ftp://media.example.com" } } }).ok).toBe(false);
    expect(validateConfig({ media: { storage: { ...base, endpoint: "file:///etc" } } }).ok).toBe(false);
    expect(validateConfig({ media: { storage: { ...base, bucket: "evil.com/x" } } }).ok).toBe(false);
    expect(validateConfig({ media: { storage: { ...base, bucket: "Bad_Name" } } }).ok).toBe(false);
  });
});
