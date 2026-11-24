import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMediaStorageService } from "@galley/core/media-storage";
import type { GalleyConfig, SiteModel } from "@galley/core/types";
import { startFakeS3, type FakeS3 } from "../../core/test/media-storage/fakes/s3";
import { tempHome } from "../../core/test/media-storage/helpers";
import { fakeSite, json, SITE_ID, testApp } from "./helpers";

const KEY = { accessKeyId: "0123456789abcdef0123456789abcdef", secretAccessKey: "a".repeat(64) };
let fake: FakeS3;

beforeAll(async () => {
  fake = await startFakeS3();
  fake.addBucket("lowfield-media", { region: "auto" });
  fake.addKey({ id: KEY.accessKeyId, secret: KEY.secretAccessKey, buckets: { "lowfield-media": ["read", "write", "list", "delete"] } });
});
afterAll(() => fake.close());

async function withStorage() {
  const home = await tempHome();
  let config: GalleyConfig = {};
  const site = fakeSite({
    model: async () => ({ media: { dir: "public/images", publicPath: "/images", roots: [], ...(config.media?.storage ? { storage: config.media.storage } : {}) } }) as unknown as SiteModel,
    readConfig: async () => config,
    saveConfig: async (next: GalleyConfig) => {
      config = next;
      return {} as SiteModel;
    },
  });
  const app = testApp({ site });

  app.services.mediaStorage = createMediaStorageService({ home: home.home, env: {} });
  return { ...app, config: () => config, done: home.done };
}

const config = () => ({ connector: "r2", account: KEY.accessKeyId, bucket: "lowfield-media", endpoint: fake.endpoint, publicUrl: fake.publicUrl("lowfield-media") });

describe("media storage routes", () => {
  it("say so in plain words when the server has no media storage", async () => {
    const { call } = testApp({ site: fakeSite() });
    const response = await call("GET", `/api/sites/${SITE_ID}/media/storage`);

    expect(response.status).toBe(404);
    expect((await json(response)).error.message).toBe("Keeping media outside the repository isn't available on this server.");
  });

  it("list the connectors with their steps", async () => {
    const app = await withStorage();
    const body = await json(await app.call("GET", "/api/media-storage/connectors"));

    expect(body.connectors.map((c: { id: string }) => c.id)).toEqual(["r2", "s3"]);
    await app.done();
  });

  it("connect after a real check, answer with status only, and never echo the secret", async () => {
    const app = await withStorage();
    const response = await app.call("PUT", `/api/sites/${SITE_ID}/media/storage`, { config: config(), ...KEY });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).not.toContain(KEY.secretAccessKey);
    const body = JSON.parse(text);

    expect(body.check.ok).toBe(true);
    expect(body.status.bucket.connected).toBe(true);
    expect(app.config().media?.storage?.bucket).toBe("lowfield-media");
    expect(app.logs.join("\n")).not.toContain(KEY.secretAccessKey);

    const status = await json(await app.call("GET", `/api/sites/${SITE_ID}/media/storage`));
    expect(status.bucket.keys.secretAccessKey).toEqual({ configured: true, source: "site", hint: "aaaa" });

    const check = await json(await app.call("POST", `/api/sites/${SITE_ID}/media/storage/check`));
    expect(check.ok).toBe(true);

    const off = await json(await app.call("DELETE", `/api/sites/${SITE_ID}/media/storage?forgetKeys=true`));
    expect(off.bucket.connected).toBe(false);
    expect(off.bucket.keys.accessKeyId.configured).toBe(false);
    await app.done();
  });

  it("refuse a badly shaped key with a sentence, not the value", async () => {
    const app = await withStorage();
    const response = await app.call("POST", `/api/sites/${SITE_ID}/media/storage/check`, { config: config(), accessKeyId: KEY.accessKeyId, secretAccessKey: "has spaces in it, oops" });
    const body = await json(response);

    expect(body.ok).toBe(false);
    expect(body.steps[0]).toMatchObject({ id: "settings", state: "failed", field: "secretAccessKey" });
    expect(JSON.stringify(body)).not.toContain("oops");
    expect((await app.call("PUT", `/api/sites/${SITE_ID}/media/storage`, { config: { ...config(), extra: 1 } })).status).toBe(400);
    await app.done();
  });
});
