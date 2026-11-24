import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withCaller } from "../../src/install/caller";
import { ROLE_REFUSAL } from "../../src/install/route-access";
import { createMediaStorageService, type MediaStorageService } from "../../src/media-storage/service";
import type { MediaStorageConfig } from "../../src/types";
import { startFakeS3, type FakeS3 } from "./fakes/s3";
import { fakeSite, tempHome } from "./helpers";

let fake: FakeS3;
let home: { home: string; done: () => Promise<void> };
let service: MediaStorageService;

const R2_KEY = { accessKeyId: "0123456789abcdef0123456789abcdef", secretAccessKey: "f".repeat(64) };
const S3_KEY = { accessKeyId: "AKIAFOLDERONLY000001", secretAccessKey: "s3secret/0123456789+abcdefghijklmnopq" };
const READ_ONLY = { accessKeyId: "AKIAREADONLY00000001", secretAccessKey: "readonly/0123456789+abcdefghijklmnopq" };

function r2(overrides: Partial<MediaStorageConfig> = {}): MediaStorageConfig {
  return { connector: "r2", account: "0123456789abcdef0123456789abcdef", bucket: "lowfield-media", endpoint: fake.endpoint, publicUrl: fake.publicUrl("lowfield-media"), ...overrides };
}

function s3(overrides: Partial<MediaStorageConfig> = {}): MediaStorageConfig {
  return { connector: "s3", region: "eu-west-1", bucket: "aws-media", endpoint: fake.endpoint, pathStyle: true, prefix: "lowfield", publicUrl: fake.publicUrl("aws-media"), ...overrides };
}

beforeAll(async () => {
  fake = await startFakeS3({ pageSize: 2 });
  fake.addBucket("lowfield-media", { region: "auto" });
  fake.addBucket("aws-media", { region: "eu-west-1" });
  fake.addBucket("private-media", { region: "eu-west-1", public: false });
  fake.addKey({ id: R2_KEY.accessKeyId, secret: R2_KEY.secretAccessKey, buckets: { "lowfield-media": ["read", "write", "list", "delete"] } });
  // The policy Galley gives for S3: everything, but only inside the site's folder.
  fake.addKey({ id: S3_KEY.accessKeyId, secret: S3_KEY.secretAccessKey, buckets: { "aws-media": ["read", "write", "list", "delete"], "private-media": ["read", "write", "list", "delete"] }, prefix: "lowfield/" });
  fake.addKey({ id: READ_ONLY.accessKeyId, secret: READ_ONLY.secretAccessKey, buckets: { "aws-media": ["read", "list"] } });
});
afterAll(() => fake.close());

beforeEach(async () => {
  home = await tempHome();
  service = createMediaStorageService({ home: home.home, env: {} });
  return () => home.done();
});

describe("connecting a bucket", () => {
  it("checks R2 for real, then saves the settings and keeps the keys out of the site", async () => {
    const lowfield = fakeSite();
    const result = await service.connect(lowfield.site, { config: r2(), ...R2_KEY });

    expect(result.check.ok).toBe(true);
    expect(result.check.steps.map((s) => [s.id, s.state])).toEqual([
      ["settings", "ok"],
      ["reach", "ok"],
      ["write", "ok"],
      ["read", "ok"],
      ["list", "ok"],
      ["public", "ok"],
      ["delete", "ok"],
    ]);
    expect(lowfield.config.media?.storage).toEqual(r2());
    expect(JSON.stringify(lowfield.config)).not.toContain(R2_KEY.secretAccessKey);
    expect(result.status?.bucket.connected).toBe(true);
    expect(result.status?.bucket.keys.secretAccessKey).toEqual({ configured: true, source: "site", hint: "ffff" });
    expect(JSON.stringify(result)).not.toContain(R2_KEY.secretAccessKey);
    // The test picture is gone again.
    expect([...fake.buckets.get("lowfield-media")!.objects.keys()]).toEqual([]);
    // The keys are in their own file, readable by this user only.
    const file = join(home.home, "state", "lowfield", "media", "secrets.json");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readFile(file, "utf8")).toContain(R2_KEY.secretAccessKey);
  });

  it("works with the folder-only S3 policy: the reach check is a listing of the folder, not HeadBucket", async () => {
    const lowfield = fakeSite();
    const result = await service.connect(lowfield.site, { config: s3(), ...S3_KEY });

    expect(result.check.message).toBeUndefined();
    expect(result.check.ok).toBe(true);
    expect(lowfield.config.media?.storage?.prefix).toBe("lowfield/");
    expect(fake.log.some((entry) => entry.method === "HEAD" && entry.path === "/aws-media")).toBe(false);
  });

  it("names the field to change for each kind of refusal, and saves nothing", async () => {
    const lowfield = fakeSite();
    const cases: Array<[Parameters<MediaStorageService["connect"]>[1], string, string, RegExp]> = [
      [{ config: r2(), accessKeyId: "0000000000000000aaaaaaaaaaaaaaaa", secretAccessKey: R2_KEY.secretAccessKey }, "reach", "accessKeyId", /doesn't know that Access Key ID/],
      [{ config: r2(), accessKeyId: R2_KEY.accessKeyId, secretAccessKey: "e".repeat(64) }, "reach", "secretAccessKey", /doesn't go with that Access Key ID/],
      [{ config: r2({ bucket: "no-such-bucket" }), ...R2_KEY }, "reach", "bucket", /no bucket called “no-such-bucket”/],
      [{ config: s3({ region: "us-east-2" }), ...S3_KEY }, "reach", "region", /in eu-west-1, not us-east-2/],
      [{ config: s3({ prefix: "" }), ...READ_ONLY }, "write", "accessKeyId", /isn't allowed to add files/],
      [{ config: s3({ prefix: "" }), ...S3_KEY }, "reach", "accessKeyId", /isn't allowed to look in the bucket/],
      [{ config: s3({ bucket: "private-media", publicUrl: fake.publicUrl("private-media") }), ...S3_KEY }, "public", "publicUrl", /turns visitors away/],
      [{ config: r2({ publicUrl: fake.publicUrl("aws-media") }), ...R2_KEY }, "public", "publicUrl", /answers, but not with this bucket's files/],
      [{ config: r2({ publicUrl: "http://media.example.com" }), ...R2_KEY }, "settings", "publicUrl", /https/],
      [{ config: r2() }, "settings", "accessKeyId", /Paste the key's Access Key ID/],
    ];

    for (const [request, step, field, message] of cases) {
      const result = await service.connect(lowfield.site, request);
      const failed = result.check.steps.find((s) => s.state === "failed");

      expect(result.check.ok, `${step} ${field}`).toBe(false);
      expect(failed?.id).toBe(step);
      expect(failed?.field).toBe(field);
      expect(result.check.message).toMatch(message);
      expect(result.status).toBeUndefined();
      expect(JSON.stringify(result)).not.toMatch(/f{64}|e{64}|s3secret|readonly\//);
    }
    expect(lowfield.saves).toBe(0);
    // A refused check leaves no test picture behind, even when it failed after storing one.
    expect([...fake.buckets.get("private-media")!.objects.keys()]).toEqual([]);
  });

  it("never replaces working keys with ones that fail", async () => {
    const lowfield = fakeSite();

    await service.connect(lowfield.site, { config: r2(), ...R2_KEY });
    await service.connect(lowfield.site, { config: r2(), accessKeyId: R2_KEY.accessKeyId, secretAccessKey: "e".repeat(64) });
    const again = await service.check(lowfield.site);

    expect(again.ok).toBe(true);
  });

  it("checks the saved settings with the stored keys, and disconnects without touching the files", async () => {
    const lowfield = fakeSite();

    await service.connect(lowfield.site, { config: r2(), ...R2_KEY });
    expect((await service.check(lowfield.site)).ok).toBe(true);
    expect(await service.stores(lowfield.site)).toHaveLength(1);
    const status = await service.disconnect(lowfield.site, { forgetKeys: true });

    expect(status.bucket.connected).toBe(false);
    expect(status.bucket.keys.accessKeyId.configured).toBe(false);
    expect(lowfield.config.media).toBeUndefined();
    expect(await service.stores(lowfield.site)).toEqual([]);
  });

  it("never sends the saved key to a different bucket or address: the key has to be typed again", async () => {
    const lowfield = fakeSite();

    await service.connect(lowfield.site, { config: r2(), ...R2_KEY });
    const before = fake.log.length;

    for (const config of [r2({ endpoint: "http://127.0.0.1:9" }), r2({ bucket: "other-bucket" }), r2({ account: "f".repeat(32) })]) {
      const result = await service.check(lowfield.site, { config });

      expect(result.steps[0]).toMatchObject({ id: "settings", state: "failed", field: "accessKeyId" });
      expect(result.message).toMatch(/saved key isn't sent there/);
    }
    expect(fake.log.length).toBe(before);
    // The same bucket, unchanged: the saved key is used.
    expect((await service.check(lowfield.site, { config: r2() })).ok).toBe(true);
  });

  it("uses keys from the environment when the site has none of its own", async () => {
    const pinned = createMediaStorageService({ home: home.home, env: { GALLEY_MEDIA_ACCESS_KEY_ID: R2_KEY.accessKeyId, GALLEY_MEDIA_SECRET_ACCESS_KEY: R2_KEY.secretAccessKey } });
    const lowfield = fakeSite();
    const result = await pinned.connect(lowfield.site, { config: r2() });

    expect(result.check.ok).toBe(true);
    expect(result.status?.bucket.keys.accessKeyId.source).toBe("env");
  });

  it("re-signs once when this computer's clock is off", async () => {
    fake.clockOffsetMs = 40 * 60_000;
    try {
      expect((await service.connect(fakeSite().site, { config: r2(), ...R2_KEY })).check.ok).toBe(true);
    } finally {
      fake.clockOffsetMs = 0;
    }
  });
});

describe("an S3-compatible store", () => {
  it("connects with its own address and region, path-style, and says plainly what to change", async () => {
    const lowfield = fakeSite();
    const config = { connector: "s3-compatible", endpoint: fake.endpoint, region: "eu-west-1", bucket: "aws-media", prefix: "lowfield", publicUrl: fake.publicUrl("aws-media") };

    expect((await service.connect(lowfield.site, { config: { ...config, endpoint: "" }, ...S3_KEY })).check.steps[0]?.field).toBe("endpoint");
    expect((await service.connect(lowfield.site, { config: { ...config, region: "" }, ...S3_KEY })).check.steps[0]?.field).toBe("region");
    const result = await service.connect(lowfield.site, { config, ...S3_KEY });

    expect(result.check.ok, result.check.message).toBe(true);
    expect(result.status?.bucket.store?.name).toBe("Another S3-compatible store");
  });
});

describe("who may", () => {
  it("checks the level in the engine, whoever calls: manage to connect or move, publish to delete for good", async () => {
    const lowfield = fakeSite();
    const as = <T>(role: "owner" | "editor" | "contributor", run: () => Promise<T>) => withCaller({ accountId: `${role}-1`, role }, run);

    await expect(as("editor", () => service.connect(lowfield.site, { config: r2(), ...R2_KEY }))).rejects.toThrow(ROLE_REFUSAL);
    await expect(as("editor", () => service.planMove(lowfield.site, { kind: "move", from: "repository", to: "bucket" }))).rejects.toThrow(ROLE_REFUSAL);
    await expect(as("contributor", () => service.deleteStored(lowfield.site, ["bucket:a.png"]))).rejects.toThrow(ROLE_REFUSAL);
    expect(lowfield.saves).toBe(0);
    expect((await as("owner", () => service.connect(lowfield.site, { config: r2(), ...R2_KEY }))).check.ok).toBe(true);
    // Reading where files go is for everyone who edits.
    expect((await as("contributor", () => service.status(lowfield.site))).bucket.connected).toBe(true);
  });
});
