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

    expect(body.connectors.map((c: { id: string }) => c.id)).toEqual(["r2", "s3", "cloudflare-images"]);
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

  it("hand usage and store deletes to the engine, and refuse store paths on the repository's delete", async () => {
    const app = await withStorage();
    const calls: unknown[] = [];

    app.services.mediaStorage = {
      ...app.services.mediaStorage!,
      usage: async (_site, url) => {
        calls.push(["usage", url]);
        return { url, working: [], published: [] };
      },
      deleteStored: async (_site, paths) => {
        calls.push(["delete", paths]);
        return { deleted: paths, refused: [] };
      },
      planMove: async (_site, request) => {
        calls.push(["plan", request]);
        return { kind: "move", from: "repository", to: "bucket", files: 3, bytes: 10, references: 2, pages: 1, done: 0, problems: [], keepCopies: false };
      },
      startMove: async (_site, request) => {
        calls.push(["move", request]);
        return { id: "job-media", kind: "media", label: "Moving media to the bucket", state: "running", startedAt: 1 };
      },
    };
    expect((await json(await app.call("POST", `/api/sites/${SITE_ID}/media/storage/move/plan`, { kind: "move", from: "repository", to: "bucket" }))).files).toBe(3);
    expect((await json(await app.call("POST", `/api/sites/${SITE_ID}/media/storage/move`, { kind: "address", store: "bucket", publicUrl: "https://cdn.example.com" }))).kind).toBe("media");
    expect((await app.call("POST", `/api/sites/${SITE_ID}/media/storage/move`, { kind: "move", from: "attic", to: "bucket" })).status).toBe(400);
    calls.splice(0, 2);
    expect((await json(await app.call("GET", `/api/sites/${SITE_ID}/media/usage?url=${encodeURIComponent("https://media.example.com/a.png")}`))).working).toEqual([]);
    expect((await json(await app.call("POST", `/api/sites/${SITE_ID}/media/storage/delete`, { paths: ["bucket:a.png"] }))).deleted).toEqual(["bucket:a.png"]);
    expect(calls).toEqual([["usage", "https://media.example.com/a.png"], ["delete", ["bucket:a.png"]]]);
    const refused = await app.call("DELETE", `/api/sites/${SITE_ID}/media?path=${encodeURIComponent("bucket:a.png")}`);

    expect(refused.status).toBe(400);
    expect((await json(refused)).error.message).toMatch(/kept outside the repository/);
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
