/**
 * Image and video providers from plugins, through the real ImageService,
 * VideoService and Settings: chosen like the built-ins, the key rule kept,
 * the service's own cost recorded, a video saved into a real site's media.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createFileSecretStore, createImageService, createSettingsService, createVideoService } from "../../src/ai/index";
import { readUsage } from "../../src/ai/usage";
import { builtinPlugin, createPluginRegistry, createPluginSettingsStore, definePlugin, PLUGIN_API_VERSION, ProviderError, type PluginRegistry, type VideoJobState } from "../../src/plugins/index";
import type { ServerEvent } from "../../src/types";
import { disposeAll, makeSite, openSite, tempDir } from "../site/helpers";

afterAll(() => disposeAll());

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const KEY = "fake-key-0123456789abcdef";
/** The smallest file that starts like an MP4 (an `ftyp` box); the media library checks the extension, not the codec. */
const MP4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 2, 0, 105, 115, 111, 109, 105, 115, 111, 50]);

async function engine(plugin = mediaPlugin()) {
  const home = tempDir("plugin-media-");
  const env = {};
  const secrets = createFileSecretStore(home);
  let registry: PluginRegistry | null = null;
  const settings = createSettingsService({ home, env, secretStore: secrets, imageProviders: () => registry?.imageProviders() ?? [] });
  const plugins = createPluginRegistry({ home, settings: createPluginSettingsStore({ home, env, secrets, setBuiltinSecret: (name, value) => settings.setSecret(name, value) }) });

  registry = plugins;
  plugins.register(builtinPlugin, { source: "builtin", required: true });
  plugins.register(plugin.plugin, { source: "user" });
  await plugins.start();
  const events: ServerEvent[] = [];
  const images = createImageService({ home, settings, providers: () => plugins.imageProviders() });
  const sleeps: number[] = [];
  const videos = createVideoService({
    home,
    settings,
    events: { emit: (event) => void events.push(event), subscribe: () => () => {} },
    providers: () => plugins.videoProviders(),
    sleep: async (ms) => void sleeps.push(ms),
    poll: { timeoutMs: 60 * 60_000 },
  });

  return { home, registry: plugins, settings, images, videos, events, sleeps, calls: plugin.calls };
}

function mediaPlugin(polls: VideoJobState[] = [{ state: "running", progress: 0.3 }, { state: "running" }, { state: "done", outputs: 1, cost: 0.4 }], mime = "video/mp4") {
  const calls: Array<{ what: string; key: string | null; body?: unknown }> = [];
  const queue = [...polls];

  return {
    calls,
    plugin: definePlugin({
      name: "galley-plugin-fake-media",
      apiVersion: PLUGIN_API_VERSION,
      settings: [{ key: "apiKey", label: "Fake API key", secret: true, required: true }],
      imageProviders: [
        {
          id: "fake",
          label: "Fake",
          keySetting: "apiKey",
          defaultModel: "fake/sketch",
          supportsReferences: true,
          models: () => [
            { id: "fake/sketch", label: "Sketch", price: "$0.01 per image" },
            { id: "fake/blind", label: "Blind", supportsReferences: false },
          ],
          async generate(request, ctx) {
            calls.push({ what: "image", key: ctx.key, body: request });
            return [{ data: new Uint8Array(Buffer.from(PNG_1X1, "base64")), mime: "image/png", cost: 0.012 }];
          },
        },
      ],
      videoProviders: [
        {
          id: "fake",
          label: "Fake",
          keySetting: "apiKey",
          defaultModel: "fake/reel",
          models: () => [{ id: "fake/reel", label: "Reel", durations: [4, 8] }],
          async start(request, ctx) {
            calls.push({ what: "start", key: ctx.key, body: request });
            if (request.prompt.includes("refuse")) throw new ProviderError("policy", "Fake declined to make that video.", "status=403");
            return { jobId: "job-1" };
          },
          async poll() {
            return queue.shift() ?? { state: "running" };
          },
          async download(_jobId, index) {
            return { data: MP4, mime: index === 0 ? mime : "video/mp4" };
          },
        },
      ],
    }),
  };
}

describe("a plugin's image provider", () => {
  it("is listed beside the built-ins and can't be chosen before its key is there", async () => {
    const { registry, settings } = await engine();
    const providers = (await settings.get()).images.providers;

    expect(providers.map((p) => p.id)).toEqual(["mock", "openai", "google", "fake"]);
    expect(providers.find((p) => p.id === "fake")).toMatchObject({ configured: false, models: [{ id: "fake/sketch", label: "Sketch", price: "$0.01 per image" }, { id: "fake/blind", label: "Blind", supportsReferences: false }] });
    await expect(settings.update({ images: { provider: "fake" } })).rejects.toMatchObject({ code: "invalid", message: "Add a Fake API key first, then choose Fake." });

    await registry.saveSettings("galley-plugin-fake-media", { apiKey: KEY });
    expect((await settings.update({ images: { provider: "fake", model: "fake/sketch" } })).images).toMatchObject({ provider: "fake", model: "fake/sketch" });
  });

  it("generates with the plugin's key, records the cost the service reported, and honours a model's own limits", async () => {
    const { registry, settings, images, home, calls } = await engine();

    await registry.saveSettings("galley-plugin-fake-media", { apiKey: KEY });
    await settings.update({ images: { provider: "fake" } });
    const [candidate] = await images.generate({ prompt: "A loaf on a board", aspect: "16:9" }, { siteId: "site-a" });

    expect(candidate).toMatchObject({ provider: "fake", model: "fake/sketch", mime: "image/png", width: 1, height: 1 });
    expect(calls[0]).toMatchObject({ what: "image", key: KEY, body: { aspect: "16:9", count: 1, model: "fake/sketch", transparent: false } });
    expect((await readUsage(home)).at(-1)).toMatchObject({ siteId: "site-a", model: "fake:fake/sketch", images: 1, cost: 0.012 });
    const root = makeSite();
    const { site } = await openSite(root);

    await expect(images.generate({ prompt: "Like this one", model: "fake/blind", referencePaths: ["public/favicon.svg"] }, { site })).rejects.toMatchObject({
      code: "invalid",
      message: expect.stringContaining("can't work from reference images"),
    });
    await expect(images.generate({ prompt: "See-through logo", transparent: true })).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("transparent") });
  });
});

describe("a plugin's video provider", () => {
  it("makes a video as a job, polls with backoff, and saves an MP4 into the site's media", async () => {
    const { registry, videos, events, sleeps, calls, home } = await engine();

    await expect(videos.providers()).resolves.toEqual([{ id: "fake", label: "Fake", configured: false, models: [{ id: "fake/reel", label: "Reel", durations: [4, 8] }], defaultModel: "fake/reel" }]);
    const root = makeSite();
    const { site } = await openSite(root);

    await expect(videos.generate(site, { prompt: "Waves on a pebble beach" })).rejects.toMatchObject({ code: "unconfigured", message: "Add a Fake API key in Settings to make videos with Fake." });
    await registry.saveSettings("galley-plugin-fake-media", { apiKey: KEY });
    const job = await videos.generate(site, { prompt: "Waves on a pebble beach", aspect: "16:9", durationSeconds: 4 });

    expect(job).toMatchObject({ kind: "video", state: "running", siteId: site.id });
    const status = await videos.settled(job.id);

    expect(status?.job).toMatchObject({ state: "done", detail: "The video is ready." });
    expect(status?.candidates).toEqual([expect.objectContaining({ mime: "video/mp4", provider: "fake", model: "fake/reel", cost: 0.4, size: MP4.byteLength })]);
    expect(calls.find((call) => call.what === "start")).toMatchObject({ key: KEY, body: { prompt: "Waves on a pebble beach", model: "fake/reel", aspect: "16:9", durationSeconds: 4 } });
    expect(sleeps).toEqual([5_000, 8_000, 12_800]);
    expect(events.filter((event) => event.type === "job").map((event) => (event as { job: { state: string } }).job.state)).toContain("done");
    expect((await readUsage(home)).at(-1)).toMatchObject({ model: "fake:fake/reel", cost: 0.4 });

    const item = await videos.save(site, { candidateId: status!.candidates[0]!.id });

    expect(item).toMatchObject({ path: "public/images/waves-pebble-beach.mp4", type: "video/mp4", status: "added" });
    expect(new Uint8Array(readFileSync(join(root, item.path)))).toEqual(MP4);
    await expect(videos.read(status!.candidates[0]!.id)).resolves.toBeNull();
  });

  it("hands the site's imagery direction to the provider after the request, as images do", async () => {
    const { registry, videos, calls } = await engine();
    const { site } = await openSite(makeSite());

    await registry.saveSettings("galley-plugin-fake-media", { apiKey: KEY });
    const job = await videos.generate(site, { prompt: "Steam over a loaf", brandDirection: "Warm daylight. Palette: oat, rust." });

    await videos.settled(job.id);
    expect(calls.find((call) => call.what === "start")).toMatchObject({ body: { prompt: "Steam over a loaf\n\nBrand direction: Warm daylight. Palette: oat, rust." } });
  });

  it("never takes a secrets file for a video's starting picture, whatever its name ends in", async () => {
    const { registry, videos, calls } = await engine();
    const root = makeSite();
    const { site } = await openSite(root);

    await registry.saveSettings("galley-plugin-fake-media", { apiKey: KEY });
    writeFileSync(join(root, ".env.png"), "TOKEN=not-a-picture\n");
    for (const firstFramePath of [".env.png", "config/.ENV.local.jpg", ".git/objects/pack.webp"]) {
      await expect(videos.generate(site, { prompt: "Waves", firstFramePath }), firstFramePath).rejects.toMatchObject({ code: "forbidden", message: "That file can't be used as the starting picture." });
    }
    // Nothing was started with the provider.
    expect(calls.filter((call) => call.what === "start")).toEqual([]);
  });

  it("ends the job with a plain sentence when the provider refuses, fails, or sends a kind of file the media library can't keep", async () => {
    const root = makeSite();
    const { site } = await openSite(root);

    for (const [plugin, prompt, message] of [
      [mediaPlugin(), "Please refuse this", "Fake declined to make that video."],
      [mediaPlugin([{ state: "failed", kind: "unavailable", message: "The video couldn't be made. Try a different description.", detail: "upstream 500" }]), "Waves", "The video couldn't be made. Try a different description."],
      [mediaPlugin(undefined, "video/webm"), "Waves", "Fake sent a kind of video the media library can't keep (video/webm). Only MP4 videos can be added."],
    ] as const) {
      const { registry, videos } = await engine(plugin);

      await registry.saveSettings("galley-plugin-fake-media", { apiKey: KEY });
      const job = await videos.generate(site, { prompt });
      const status = await videos.settled(job.id);

      expect(status?.job).toMatchObject({ state: "error", detail: message });
      expect(status?.candidates).toEqual([]);
    }
  });
});
