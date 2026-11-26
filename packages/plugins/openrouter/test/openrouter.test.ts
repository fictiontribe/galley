/**
 * The OpenRouter plugin against scripted responses shaped like OpenRouter's
 * documentation (2026-11-23): the kit's checks, the exact requests, the
 * model catalogue with prices, error classification, and a full video job.
 * Nothing here reaches the network.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkPlugin, fakeFetch, formatPluginReport, json, providerContext, type FakeRoute, type RecordedRequest } from "@galley/plugin-kit";
import { createFileSecretStore, createSettingsService } from "@galley/core/ai";
import { createPluginRegistry, createPluginSettingsStore } from "@galley/core/plugins";
import { aspectFor, classify, createOpenRouterPlugin, DEFAULT_IMAGE_MODEL, FALLBACK_IMAGE_MODELS, priceFrom, resolutionFor, videoPrice } from "../src/index";

const BASE = "https://openrouter.test/api/v1";
const KEY = "sk-or-v1-0123456789abcdef0123456789abcdef";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const MP4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
const homes: string[] = [];

afterAll(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

/** The catalogue as GET /images/models returns it (one text-only model to be filtered out). */
const IMAGE_MODELS = {
  data: [
    {
      id: "bytedance-seed/seedream-5-0-lite",
      name: "ByteDance Seed: Seedream 5.0 Lite",
      architecture: { input_modalities: ["text", "image"], output_modalities: ["image"] },
      supported_parameters: {
        aspect_ratio: { type: "enum", values: ["1:1", "16:9", "9:16", "4:3", "3:4"] },
        resolution: { type: "enum", values: ["1K", "2K", "4K"] },
        n: { type: "range", min: 1, max: 4 },
      },
      supports_streaming: false,
      endpoints: "/api/v1/images/models/bytedance-seed/seedream-5-0-lite/endpoints",
    },
    {
      id: "openai/gpt-image-2",
      name: "OpenAI: GPT Image 2",
      architecture: { input_modalities: ["text", "image"], output_modalities: ["image"] },
      supported_parameters: { background: { type: "enum", values: ["auto", "transparent", "opaque"] }, size: { type: "enum", values: ["1024x1024"] } },
      supports_streaming: true,
      endpoints: "/api/v1/images/models/openai/gpt-image-2/endpoints",
    },
    {
      id: "black-forest-labs/flux.2-klein-4b",
      name: "Black Forest Labs: FLUX.2 Klein 4B",
      architecture: { input_modalities: ["text"], output_modalities: ["image"] },
      supported_parameters: { aspect_ratio: { type: "enum", values: ["1:1", "16:9"] }, resolution: { type: "enum", values: ["512", "1K"] } },
      supports_streaming: false,
      endpoints: "/api/v1/images/models/black-forest-labs/flux.2-klein-4b/endpoints",
    },
    { id: "some/text-model", name: "Text only", architecture: { input_modalities: ["text"], output_modalities: ["text"] }, supported_parameters: {} },
  ],
};

const ENDPOINTS: Record<string, unknown> = {
  "bytedance-seed/seedream-5-0-lite": { id: "x", endpoints: [{ provider_name: "BytePlus", pricing: [{ billable: "output_image", unit: "image", cost_usd: 0.035 }] }] },
  "openai/gpt-image-2": { id: "x", endpoints: [{ provider_name: "OpenAI", pricing: [{ billable: "input_text", unit: "token", cost_usd: 0.000005 }, { billable: "output_image", unit: "token", cost_usd: 0.00004 }] }] },
  "black-forest-labs/flux.2-klein-4b": {
    id: "x",
    endpoints: [
      { provider_name: "A", pricing: [{ billable: "output_image", unit: "megapixel", cost_usd: 0.02 }] },
      { provider_name: "B", pricing: [{ billable: "output_image", unit: "megapixel", cost_usd: 0.014 }] },
    ],
  },
};

/** A scripted OpenRouter: the catalogue, the endpoints, image generation and the video job routes. */
function openRouter(overrides: Partial<Record<"generate" | "videoStart" | "videoPoll" | "videoContent", FakeRoute>> = {}) {
  let polls = 0;
  const route: FakeRoute = (request) => {
    const url = new URL(request.url);
    const path = url.pathname.replace("/api/v1", "");

    if (request.headers.authorization !== `Bearer ${KEY}`) return json(401, { error: { code: 401, message: "No auth credentials found" } });
    if (path === "/images/models") return json(200, IMAGE_MODELS);
    const endpoints = /^\/images\/models\/(.+)\/endpoints$/.exec(path);

    if (endpoints) return json(200, ENDPOINTS[decodeURIComponent(endpoints[1]!)] ?? { endpoints: [] });
    if (path === "/images" && request.method === "POST") {
      return (overrides.generate ?? (() => json(200, { created: 1, data: [{ b64_json: PNG, media_type: "image/png" }], usage: { prompt_tokens: 0, completion_tokens: 4175, total_tokens: 4175, cost: 0.035 } })))(request);
    }
    if (path === "/videos/models") {
      return json(200, {
        data: [
          {
            id: "google/veo-3.1-lite",
            canonical_slug: "google/veo-3.1-lite",
            name: "Google: Veo 3.1 Lite",
            created: 1,
            allowed_passthrough_parameters: [],
            generate_audio: true,
            seed: null,
            pricing_skus: { "per-video-second-720p": "0.03", "per-video-second-1080p": "0.08" },
            supported_resolutions: ["720p", "1080p"],
            supported_aspect_ratios: ["16:9", "9:16"],
            supported_sizes: null,
            supported_durations: [4, 6, 8, -1],
            supported_frame_images: ["first_frame", "last_frame"],
          },
        ],
      });
    }
    if (path === "/videos" && request.method === "POST") {
      return (overrides.videoStart ?? (() => json(202, { id: "gen-vid-1748372400-abcdefghij0123456789", polling_url: "/api/v1/videos/gen-vid-1748372400-abcdefghij0123456789", status: "pending" })))(request);
    }
    if (/^\/videos\/gen-vid-[^/]+$/.test(path)) {
      polls += 1;
      return (overrides.videoPoll ??
        (() =>
          json(200, polls < 3 ? { id: "gen-vid-1", status: polls === 1 ? "pending" : "in_progress", progress: polls * 30 } : { id: "gen-vid-1", status: "completed", unsigned_urls: ["https://x/0"], usage: { cost: 0.24, is_byok: false } })))(request);
    }
    if (/^\/videos\/gen-vid-[^/]+\/content$/.test(path)) {
      return (overrides.videoContent ?? (() => new Response(MP4, { status: 200, headers: { "content-type": "video/mp4" } })))(request);
    }
    return json(404, { error: { code: 404, message: `no route ${path}` } });
  };

  return route;
}

const plugin = createOpenRouterPlugin({ baseUrl: BASE });
const images = plugin.imageProviders![0]!;
const videos = plugin.videoProviders![0]!;
const request = { prompt: "A lighthouse at dusk", aspect: "16:9" as const, count: 1, model: DEFAULT_IMAGE_MODEL, transparent: false, references: [] };

describe("the kit's checks", () => {
  it("pass, with scripted replies for images and video", async () => {
    const report = await checkPlugin(createOpenRouterPlugin({ baseUrl: BASE }), {
      imageProviders: { openrouter: { route: (r) => (r.url.endsWith("/images") ? json(200, { data: [{ b64_json: PNG, media_type: "image/png" }] }) : json(404, {})) } },
      videoProviders: {
        openrouter: {
          route: (r) =>
            r.method === "POST"
              ? json(202, { id: "gen-vid-1748372400-abcdefghij0123456789", polling_url: "/x", status: "pending" })
              : r.url.endsWith("/content?index=0")
                ? new Response(MP4, { headers: { "content-type": "video/mp4" } })
                : json(200, { status: "completed", unsigned_urls: ["a"] }),
        },
      },
    });

    expect(report.ok, formatPluginReport(report)).toBe(true);
    expect(report.checks.map((check) => check.id)).toEqual(["shape", "image:openrouter:auth", "image:openrouter:offline", "image:openrouter:models", "image:openrouter:generate", "video:openrouter:auth", "video:openrouter:cycle"]);
  });
});

describe("images", () => {
  it("sends the documented request with generic attribution headers, and keeps the reported cost", async () => {
    const api = fakeFetch(openRouter());
    const fresh = createOpenRouterPlugin({ baseUrl: BASE }).imageProviders![0]!;
    const ctx = providerContext({ key: KEY, fetch: api.fetch });

    await fresh.models(ctx);
    const result = await fresh.generate({ ...request, count: 2 }, ctx);
    const sent = api.requests.find((r) => r.method === "POST") as RecordedRequest;

    expect(sent.url).toBe(`${BASE}/images`);
    expect(sent.headers).toMatchObject({ authorization: `Bearer ${KEY}`, "content-type": "application/json", "http-referer": ctx.brand.siteUrl, "x-openrouter-title": ctx.brand.productName });
    expect(sent.body).toEqual({ model: DEFAULT_IMAGE_MODEL, prompt: "A lighthouse at dusk", n: 2, aspect_ratio: "16:9", resolution: "1K" });
    expect(result).toEqual([expect.objectContaining({ mime: "image/png", cost: 0.035 })]);
    expect(Buffer.from(result[0]!.data).toString("base64")).toBe(PNG);
  });

  it("sends reference pictures and a transparent background only where the model takes them", async () => {
    const api = fakeFetch(openRouter());
    const fresh = createOpenRouterPlugin({ baseUrl: BASE }).imageProviders![0]!;
    const ctx = providerContext({ key: KEY, fetch: api.fetch });
    const reference = { data: new Uint8Array(Buffer.from(PNG, "base64")), mime: "image/png" };

    await fresh.models(ctx);
    await fresh.generate({ ...request, model: "openai/gpt-image-2", aspect: "1:1", transparent: true, references: [reference] }, ctx);
    const body = api.requests.filter((r) => r.method === "POST").at(-1)!.body as Record<string, unknown>;

    expect(body).toMatchObject({ model: "openai/gpt-image-2", background: "transparent", output_format: "png", input_references: [{ type: "image_url", image_url: { url: `data:image/png;base64,${PNG}` } }] });
    await expect(fresh.generate({ ...request, model: "black-forest-labs/flux.2-klein-4b", references: [reference] }, ctx)).rejects.toMatchObject({ kind: "invalid", plain: expect.stringContaining("can't work from reference pictures") });
    await expect(fresh.generate({ ...request, transparent: true }, ctx)).rejects.toMatchObject({ kind: "invalid", plain: expect.stringContaining("transparent") });
  });

  it("reads the catalogue with prices, caches it, and falls back without a key or a network", async () => {
    let now = 0;
    const api = fakeFetch(openRouter());
    const fresh = createOpenRouterPlugin({ baseUrl: BASE, now: () => now }).imageProviders![0]!;
    const models = await fresh.models(providerContext({ key: KEY, fetch: api.fetch }));

    expect(models.map(({ id, label, price, supportsReferences, supportsTransparency }) => ({ id, label, price, supportsReferences, supportsTransparency }))).toEqual([
      { id: "black-forest-labs/flux.2-klein-4b", label: "FLUX.2 Klein 4B", price: "$0.014 per megapixel", supportsReferences: false, supportsTransparency: false },
      { id: "openai/gpt-image-2", label: "GPT Image 2", price: "$40 per million output tokens", supportsReferences: true, supportsTransparency: true },
      { id: "bytedance-seed/seedream-5-0-lite", label: "Seedream 5.0 Lite", price: "$0.035 per image", supportsReferences: true, supportsTransparency: false },
    ]);
    const count = api.requests.length;

    await fresh.models(providerContext({ key: KEY, fetch: api.fetch }));
    expect(api.requests.length).toBe(count);
    now += 2 * 60 * 60_000;
    await fresh.models(providerContext({ key: KEY, fetch: api.fetch }));
    expect(api.requests.length).toBeGreaterThan(count);

    expect(await createOpenRouterPlugin({ baseUrl: BASE }).imageProviders![0]!.models(providerContext({ key: null }))).toBe(FALLBACK_IMAGE_MODELS);
    const offline = providerContext({ key: KEY, fetch: fakeFetch(() => Promise.reject(new TypeError("fetch failed"))).fetch });

    expect(await createOpenRouterPlugin({ baseUrl: BASE }).imageProviders![0]!.models(offline)).toBe(FALLBACK_IMAGE_MODELS);
    expect(offline.lines.join("\n")).not.toContain(KEY);
  });

  it("maps the product's shapes onto what a model offers", () => {
    const model = { ...FALLBACK_IMAGE_MODELS[0]!, aspects: ["1:1", "16:9", "4:3", "auto"], resolutions: ["512", "2K", "1K"] };

    expect(aspectFor("16:9", model)).toBe("16:9");
    expect(aspectFor("3:2", model)).toBe("4:3");
    expect(aspectFor("9:16", { ...model, aspects: ["1:1", "16:9"] })).toBe("1:1");
    expect(aspectFor("2:3", undefined)).toBe("2:3");
    expect(resolutionFor(model)).toBe("1K");
    expect(resolutionFor({ ...model, resolutions: ["2K", "4K"] })).toBe("2K");
    expect(resolutionFor({ ...model, resolutions: null })).toBeUndefined();
    expect(priceFrom([{ pricing: [{ billable: "output_image", unit: "request", cost_usd: 0.04, variant: "4K" }] }])).toBeUndefined();
  });
});

describe("errors", () => {
  const cases: Array<[number, unknown, string, RegExp]> = [
    [401, { error: { code: 401, message: `Invalid key ${KEY}` } }, "auth", /didn't accept the API key/],
    [402, { error: { code: 402, message: "Insufficient credits", metadata: { limit_source: "openrouter_credits" } } }, "quota", /out of credit/],
    [402, { error: { code: 402, message: "In-flight budget", metadata: { limit_source: "openrouter_in_flight_budget" } } }, "rate", /holding new requests/],
    [403, { error: { code: 403, message: "Key limit exceeded", metadata: { limit_source: "openrouter_key_limit" } } }, "quota", /spending limit/],
    [403, { error: { code: 403, message: "Input flagged", metadata: { reasons: ["violence"], flagged_input: "…", provider_name: "x", model_slug: "y" } } }, "policy", /declined to make that image/],
    [400, { error: { code: 400, message: "Refused", metadata: { error_type: "content_policy_violation" } } }, "policy", /declined/],
    [403, { error: { code: 403, message: "Forbidden", metadata: { error_type: "permission_denied" } } }, "auth", /isn't allowed to use that model/],
    [404, { error: { code: 404, message: "Model not found" } }, "unavailable", /isn't available on OpenRouter any more/],
    [429, { error: { code: 429, message: "Slow down", metadata: { error_type: "rate_limit_exceeded" } } }, "rate", /limiting requests/],
    [400, { error: { code: 400, message: "bad image", metadata: { error_type: "invalid_image" } } }, "invalid", /reference pictures/],
    [503, { error: { code: 503, message: "No providers" } }, "unavailable", /No service behind OpenRouter/],
    [502, { error: { code: 502, message: "Upstream died" } }, "unavailable", /had a problem/],
    [400, { error: { code: 400, message: "Mysterious" } }, "invalid", /with these settings/],
    [500, { raw: "<html>oops</html>" }, "unavailable", /had a problem/],
  ];

  it.each(cases)("classifies %i by status and code, never by the message, and never repeats the key", (status, body, kind, plain) => {
    const error = classify(status, body, KEY, "image");

    expect(error).toMatchObject({ kind, plain: expect.stringMatching(plain) });
    expect(`${error.plain} ${error.detail} ${error.message}`).not.toContain(KEY);
  });

  it("turns a refused generation into the matching plain error", async () => {
    const api = fakeFetch(openRouter({ generate: () => json(402, { error: { code: 402, message: "Insufficient credits" } }) }));

    await expect(images.generate(request, providerContext({ key: KEY, fetch: api.fetch }))).rejects.toMatchObject({ kind: "quota" });
    await expect(images.generate(request, providerContext({ key: null }))).rejects.toMatchObject({ kind: "auth" });
  });

  it("surfaces Galley Cloud proxy error messages directly and scrubs the key", () => {
    for (const [code, status, expectedKind] of [
      ["galley_ai_allowance_used", 402, "quota"],
      ["galley_ai_paused_unpaid", 402, "quota"],
      ["galley_ai_switched_off", 403, "auth"],
    ] as const) {
      const error = classify(
        status,
        { error: { type: "billing_error", message: `Proxy says ${code} (${KEY})`, details: { error_code: code } } },
        KEY,
        "image"
      );

      expect(error).toMatchObject({ kind: expectedKind, plain: `Proxy says ${code} ([redacted])` });
      expect(`${error.plain} ${error.detail}`).not.toContain(KEY);
    }
  });

  it("resolves a dynamic baseUrl getter on every request so live switches take effect", async () => {
    let currentBase = "https://proxy-a.test/api/v1";
    const dynamic = createOpenRouterPlugin({ baseUrl: () => currentBase });
    const api = fakeFetch((req) => {
      if (req.url.endsWith("/images")) return json(200, { data: [{ b64_json: PNG, media_type: "image/png" }] });
      if (req.url.endsWith("/videos")) return json(202, { id: "gen-vid-1748372400-abcdefghij0123456789", status: "pending" });
      return json(404, {});
    });
    const ctx = providerContext({ key: KEY, fetch: api.fetch });

    await dynamic.imageProviders![0]!.generate(request, ctx);
    expect(api.requests[0]!.url).toBe("https://proxy-a.test/api/v1/images");

    currentBase = "https://proxy-b.test/api/v1/";
    await dynamic.imageProviders![0]!.generate(request, ctx);
    expect(api.requests[1]!.url).toBe("https://proxy-b.test/api/v1/images");

    await dynamic.videoProviders![0]!.start({ prompt: "Waves", model: "google/veo-3.1-lite", durationSeconds: 4 }, ctx);
    expect(api.requests[2]!.url).toBe("https://proxy-b.test/api/v1/videos");
  });
});

describe("video", () => {
  it("submits, polls and downloads a job the way the Video API documents it", async () => {
    const api = fakeFetch(openRouter());
    const ctx = providerContext({ key: KEY, fetch: api.fetch });
    const fresh = createOpenRouterPlugin({ baseUrl: BASE }).videoProviders![0]!;
    const models = await fresh.models(ctx);

    expect(models).toEqual([{ id: "google/veo-3.1-lite", label: "Veo 3.1 Lite", durations: [4, 6, 8], resolutions: ["720p", "1080p"], aspects: ["16:9", "9:16"], supportsFirstFrame: true, audio: true, price: "$0.03–$0.08 per second" }]);
    const frame = { data: new Uint8Array(Buffer.from(PNG, "base64")), mime: "image/png" };
    const { jobId } = await fresh.start({ prompt: "Waves on a pebble beach", model: "google/veo-3.1-lite", aspect: "16:9", durationSeconds: 4, resolution: "720p", audio: false, firstFrame: frame }, ctx);

    expect(api.requests.find((r) => r.method === "POST")!.body).toEqual({
      model: "google/veo-3.1-lite",
      prompt: "Waves on a pebble beach",
      aspect_ratio: "16:9",
      duration: 4,
      resolution: "720p",
      generate_audio: false,
      frame_images: [{ type: "image_url", image_url: { url: `data:image/png;base64,${PNG}` }, frame_type: "first_frame" }],
    });
    expect(await fresh.poll(jobId, ctx)).toMatchObject({ state: "running", progress: 0.3, detail: "Waiting for its turn…" });
    expect(await fresh.poll(jobId, ctx)).toMatchObject({ state: "running", progress: 0.6 });
    expect(await fresh.poll(jobId, ctx)).toEqual({ state: "done", outputs: 1, cost: 0.24 });
    const file = await fresh.download(jobId, 0, ctx);

    expect(file).toEqual({ data: MP4, mime: "video/mp4" });
    expect(api.requests.at(-1)!.url).toBe(`${BASE}/videos/gen-vid-1748372400-abcdefghij0123456789/content?index=0`);
    await expect(fresh.start({ prompt: "x", model: "google/veo-3.1-lite", durationSeconds: 5 }, ctx)).rejects.toMatchObject({ kind: "invalid", plain: expect.stringContaining("4, 6, 8 seconds") });
  });

  it("reports failed, cancelled and expired jobs in plain words, keeping the provider's reason in the detail", async () => {
    for (const [status, plain] of [
      ["failed", /couldn't be made/],
      ["cancelled", /cancelled/],
      ["expired", /expired/],
    ] as const) {
      const api = fakeFetch(openRouter({ videoPoll: () => json(200, { id: "gen-vid-1", status, error: `upstream said no ${KEY}` }) }));
      const state = await videos.poll("gen-vid-1", providerContext({ key: KEY, fetch: api.fetch }));

      expect(state).toMatchObject({ state: "failed", kind: "unavailable", message: expect.stringMatching(plain) });
      expect(JSON.stringify(state)).not.toContain(KEY);
    }
    expect(videoPrice({ generate: "0.50" })).toBe("$0.5 (generate)");
  });
});

describe("in the registry", () => {
  it("keeps its key under the shared name “openrouter” when built in, with OPENROUTER_API_KEY winning", async () => {
    const home = mkdtempSync(join(tmpdir(), "openrouter-home-"));

    homes.push(home);
    const secrets = createFileSecretStore(home);
    const settings = createSettingsService({ home, env: {}, secretStore: secrets });
    const registry = createPluginRegistry({ home, settings: createPluginSettingsStore({ home, env: {}, secrets, setBuiltinSecret: (name, value) => settings.setSecret(name, value) }) });

    registry.register(createOpenRouterPlugin({ baseUrl: BASE }), { source: "builtin" });
    await registry.saveSettings("@galley/plugin-openrouter", { apiKey: KEY });
    expect(JSON.parse(readFileSync(join(home, "secrets.json"), "utf8"))).toEqual({ openrouter: KEY });
    expect(JSON.stringify(await registry.list())).not.toContain(KEY);
    await expect(registry.saveSettings("@galley/plugin-openrouter", { apiKey: "not a key" })).rejects.toMatchObject({ code: "invalid" });

    const fromEnv = createPluginRegistry({ home, settings: createPluginSettingsStore({ home, env: { OPENROUTER_API_KEY: "sk-or-v1-fromtheenvironment0000" }, secrets }) });

    fromEnv.register(createOpenRouterPlugin({ baseUrl: BASE }), { source: "builtin" });
    expect((await fromEnv.list())[0]!.settings[0]).toMatchObject({ key: "apiKey", configured: true, source: "env", hint: "0000" });
    expect(await fromEnv.imageProviders()[0]!.key!.kind).toBe("plugin");
  });
});
