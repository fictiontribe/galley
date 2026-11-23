/**
 * The plugin and video routes, over a real plugin registry (settings and
 * secrets in a temporary home) and a faked video service.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createFileSecretStore, createSettingsService } from "@galley/core/ai";
import { builtinPlugin, createPluginRegistry, createPluginSettingsStore, definePlugin, PLUGIN_API_VERSION } from "@galley/core/plugins";
import type { Job, MediaItem, VideoService } from "@galley/core/types";
import { fake, fakeSite, json, SITE_ID, testApp } from "./helpers";

const homes: string[] = [];
const SECRET = "sk-hook-secret-0123456789abcdefQRST";

afterAll(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

const userPlugin = definePlugin({
  name: "galley-plugin-pinger",
  displayName: "Pinger",
  apiVersion: PLUGIN_API_VERSION,
  settings: [
    { key: "token", label: "Ping token", secret: true, required: true },
    { key: "room", label: "Room", pattern: "^[a-z]+$" },
  ],
  scriptIntegrations: [
    { kind: "pinger", name: "Pinger widget", description: "A small widget.", category: "support", defaultConsent: "preferences", defaultPlacement: "body-end", settings: [{ key: "id", label: "Widget id" }], snippet: { src: "https://cdn.pinger.example/{{id}}.js" } },
  ],
  hooks: { afterPublish() {} },
});

async function withPlugins() {
  const home = mkdtempSync(join(tmpdir(), "server-plugins-"));

  homes.push(home);
  const secrets = createFileSecretStore(home);
  const settings = createSettingsService({ home, env: {}, secretStore: secrets });
  const plugins = createPluginRegistry({ home, settings: createPluginSettingsStore({ home, env: {}, secrets, setBuiltinSecret: (name, value) => settings.setSecret(name, value) }) });

  plugins.register(builtinPlugin, { source: "builtin", required: true, location: "built in" });
  plugins.register(userPlugin, { source: "user", location: "galley-plugin-pinger@1.0.0" });
  await plugins.start();
  const app = testApp({ site: fakeSite({ readConfig: async () => null }), images: { providers: async () => [] } });

  app.services.plugins = plugins;
  return app;
}

describe("plugin routes", () => {
  it("list every plugin with what it adds, and settings as status only", async () => {
    const { call } = await withPlugins();

    expect((await call("PUT", "/api/plugins/settings", { name: "galley-plugin-pinger", values: { token: SECRET, room: "launch" } })).status).toBe(200);
    const body = await json(await call("GET", "/api/plugins"));
    const pinger = body.plugins.find((p: { name: string }) => p.name === "galley-plugin-pinger");

    expect(body.plugins.map((p: { name: string }) => p.name)).toEqual(["@galley/builtin", "galley-plugin-pinger"]);
    expect(pinger).toMatchObject({
      displayName: "Pinger",
      source: "user",
      location: "galley-plugin-pinger@1.0.0",
      enabled: true,
      active: true,
      canDisable: true,
      contributes: expect.objectContaining({ scriptIntegrations: ["Pinger widget"], hooks: ["afterPublish"] }),
      settings: [expect.objectContaining({ key: "token", secret: true, configured: true, hint: "QRST" }), expect.objectContaining({ key: "room", value: "launch" })],
    });
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(body.plugins[0]).toMatchObject({ canDisable: false, contributes: expect.objectContaining({ imageProviders: ["Placeholder artwork (offline)", "OpenAI", "Google (Nano Banana)"] }) });
  });

  it("turn plugins on and off, and refuse the built-ins and unknown names", async () => {
    const { call } = await withPlugins();
    const off = await call("POST", "/api/plugins/enabled", { name: "galley-plugin-pinger", enabled: false });

    expect(await json(off)).toMatchObject({ name: "galley-plugin-pinger", enabled: false, active: false });
    expect((await json(await call("GET", "/api/catalog"))).scriptIntegrations.map((s: { kind: string }) => s.kind)).not.toContain("pinger");
    expect((await call("POST", "/api/plugins/enabled", { name: "@galley/builtin", enabled: false })).status).toBe(400);
    expect((await call("POST", "/api/plugins/enabled", { name: "galley-plugin-nope", enabled: true })).status).toBe(404);
  });

  it("refuse a setting that doesn't fit without repeating what was typed", async () => {
    const { call } = await withPlugins();
    const response = await call("PUT", "/api/plugins/settings", { name: "galley-plugin-pinger", values: { room: `Not-A-Room ${SECRET}` } });

    expect(response.status).toBe(400);
    expect(JSON.stringify(await json(response))).not.toContain(SECRET);
    expect((await call("PUT", "/api/plugins/settings", { name: "galley-plugin-pinger", values: { nope: "x" } })).status).toBe(400);
  });

  it("serve the merged catalogues, server-wide and for a site", async () => {
    const { call } = await withPlugins();
    const all = await json(await call("GET", "/api/catalog"));

    expect(all.scriptIntegrations.find((s: { kind: string }) => s.kind === "pinger")).toMatchObject({ plugin: "galley-plugin-pinger", snippet: { src: "https://cdn.pinger.example/{{id}}.js" } });
    expect(all.formProviders.map((f: { id: string }) => f.id)).toEqual(["galley", "hubspot", "marketo", "salesforce", "pardot", "webhook", "mailto"]);
    expect(all.deployTargets.map((d: { id: string }) => d.id)).toEqual(["cloudflare", "vercel"]);
    expect(all).toMatchObject({ imageProviders: [], videoProviders: [], importers: [] });
    expect((await json(await call("GET", `/api/sites/${SITE_ID}/catalog`))).scriptIntegrations).toHaveLength(all.scriptIntegrations.length);
    expect((await json(await call("GET", `/api/sites/${SITE_ID}/plugins`))).plugins).toHaveLength(2);
  });

  it("without a plugin registry, list nothing and serve the built-in catalogues", async () => {
    const { call } = testApp({ images: { providers: async () => [] } });

    expect(await json(await call("GET", "/api/plugins"))).toEqual({ plugins: [], conflicts: [] });
    expect((await json(await call("GET", "/api/catalog"))).formProviders[0]).toMatchObject({ id: "galley", plugin: "@galley/builtin" });
    expect((await call("POST", "/api/plugins/enabled", { name: "x", enabled: true })).status).toBe(404);
  });
});

describe("video routes", () => {
  const JOB: Job = { id: "job-v", kind: "video", label: "Making a video: waves", state: "running", siteId: SITE_ID, startedAt: 1 };
  const MP4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);

  function withVideos() {
    const app = testApp({ site: fakeSite() });
    const seen: unknown[] = [];

    app.services.videos = fake<VideoService>("videos", {
      providers: async () => [{ id: "openrouter", label: "OpenRouter", configured: true, models: [{ id: "google/veo-3.1-lite", label: "Veo 3.1 Lite" }], defaultModel: "google/veo-3.1-lite" }],
      generate: async (_site, request) => {
        seen.push(request);
        return JOB;
      },
      status: async (id) => (id === JOB.id ? { job: { ...JOB, state: "done" }, candidates: [{ id: "c1", mime: "video/mp4", size: 8, previewUrl: "/api/videos/candidates/c1", prompt: "waves", provider: "openrouter", model: "google/veo-3.1-lite" }] } : null),
      read: async (id) => (id === "c1" ? { data: MP4, mime: "video/mp4" } : null),
      save: async () => ({ path: "public/images/waves.mp4", type: "video/mp4" }) as MediaItem,
      discard: async () => undefined,
    });
    return { ...app, seen };
  }

  it("start a generation as a job, report it, stream the candidate and save it", async () => {
    const { call, seen } = withVideos();

    expect((await json(await call("GET", "/api/videos/providers"))).providers[0].id).toBe("openrouter");
    expect(await json(await call("POST", `/api/sites/${SITE_ID}/videos/generate`, { prompt: "Waves", aspect: "16:9", durationSeconds: 4 }))).toEqual(JOB);
    expect(seen).toEqual([{ prompt: "Waves", aspect: "16:9", durationSeconds: 4 }]);
    expect((await json(await call("GET", "/api/videos/jobs/job-v"))).job.state).toBe("done");
    expect((await call("GET", "/api/videos/jobs/nope")).status).toBe(404);
    const bytes = await call("GET", "/api/videos/candidates/c1");

    expect(bytes.headers.get("content-type")).toBe("video/mp4");
    expect(bytes.headers.get("content-security-policy")).toContain("sandbox");
    expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(MP4);
    expect((await json(await call("POST", `/api/sites/${SITE_ID}/videos/save`, { candidateId: "c1" }))).path).toBe("public/images/waves.mp4");
    expect(await json(await call("DELETE", "/api/videos/candidates/c1"))).toEqual({ ok: true });
    expect((await call("POST", `/api/sites/${SITE_ID}/videos/generate`, { prompt: "Waves", aspect: "2:1" })).status).toBe(400);
  });

  it("say plainly when the server has no video service", async () => {
    const { call } = testApp({ site: fakeSite() });

    expect(await json(await call("GET", "/api/videos/providers"))).toEqual({ providers: [] });
    const response = await call("POST", `/api/sites/${SITE_ID}/videos/generate`, { prompt: "Waves" });

    expect(response.status).toBe(404);
    expect((await json(response)).error.message).toBe("Video generation isn't available on this server.");
  });
});
