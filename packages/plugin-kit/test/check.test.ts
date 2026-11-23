/**
 * checkPlugin catches what would go wrong in the engine, and says what to change.
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkPlugin, definePlugin, json, PLUGIN_API_VERSION, ProviderError, summarizePlugin, TEST_KEY, type GalleyPlugin, type ImageProviderPlugin } from "../src/index";

const ELEVENTY_FIXTURE = fileURLToPath(new URL("../../../examples/adapter-eleventy/fixture", import.meta.url));

function provider(generate: ImageProviderPlugin["generate"], extra: Partial<ImageProviderPlugin> = {}): GalleyPlugin {
  return definePlugin({
    name: "galley-plugin-pictures",
    apiVersion: PLUGIN_API_VERSION,
    settings: [{ key: "apiKey", label: "Pictures API key", secret: true }],
    imageProviders: [{ id: "pictures", label: "Pictures", keySetting: "apiKey", defaultModel: "p1", models: () => [{ id: "p1", label: "P1" }], generate, ...extra }],
  });
}

const statusOf = (report: Awaited<ReturnType<typeof checkPlugin>>, id: string) => report.checks.find((check) => check.id === id);

describe("checkPlugin", () => {
  it("passes a careful provider and fails one that throws raw errors or leaks its key", async () => {
    const careful = provider(async (_request, ctx) => {
      let response: Response;

      try {
        response = await ctx.fetch("https://pictures.example/v1", { method: "POST", headers: { authorization: `Bearer ${ctx.key}` } });
      } catch {
        throw new ProviderError("unavailable", "Couldn't reach Pictures.");
      }
      if (response.status === 401) throw new ProviderError("auth", "Pictures didn't accept the key.", `status=401`);
      if (!response.ok) throw new ProviderError("unavailable", "Pictures had a problem.");
      return [{ data: new Uint8Array([137, 80, 78, 71]), mime: "image/png" }];
    });
    const good = await checkPlugin(careful, { imageProviders: { pictures: { route: () => json(200, {}) } } });

    expect(good.ok).toBe(true);
    expect(good.checks.map((check) => [check.id, check.status])).toEqual([
      ["shape", "pass"],
      ["image:pictures:auth", "pass"],
      ["image:pictures:offline", "pass"],
      ["image:pictures:models", "pass"],
      ["image:pictures:generate", "pass"],
    ]);

    const raw = await checkPlugin(
      provider(async (_request, ctx) => {
        const response = await ctx.fetch("https://pictures.example/v1");

        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      })
    );

    expect(raw.ok).toBe(false);
    expect(statusOf(raw, "image:pictures:auth")?.detail).toMatch(/threw a raw error .* Throw ProviderError/);
    expect(statusOf(raw, "image:pictures:offline")?.status).toBe("fail");

    const leaky = await checkPlugin(provider(async (_request, ctx) => Promise.reject(new ProviderError("auth", "Bad key", `the key ${ctx.key} was refused`))));

    expect(statusOf(leaky, "image:pictures:auth")).toMatchObject({ status: "fail", detail: expect.stringContaining("put the API key in its error") });
    expect(JSON.stringify(leaky)).not.toContain(TEST_KEY);
  });

  it("explains structural problems in words an author can act on", async () => {
    const report = await checkPlugin({
      name: "galley-plugin-mess",
      apiVersion: 2,
      tools: [{ name: "read_entry", title: "Mine", description: "x", input: { type: "object", properties: {} }, mode: "content", effect: { readOnly: true }, run: () => "" }],
      scriptIntegrations: [{ kind: "widget", name: "Widget", description: "A widget.", category: "other", defaultConsent: "marketing", defaultPlacement: "head", settings: [], snippet: { src: "http://cdn.example.com/{{siteKey}}.js" } }],
    });

    expect(report.ok).toBe(false);
    const detail = report.checks[0]!.detail!;

    expect(detail).toContain("written for plugin API version 2");
    expect(detail).toContain("“read_entry” is a built-in tool's name");
    expect(detail).toContain("uses {{siteKey}}, which isn't one of its settings");
    expect(detail).toContain("should start with https://");
  });

  it("runs the adapter kit's conformance checks on a contributed adapter when given a fixture", async () => {
    const { default: eleventy } = await import("../../../examples/adapter-eleventy/src/index");
    const plugin = definePlugin({ name: "galley-plugin-eleventy", apiVersion: PLUGIN_API_VERSION, adapters: [eleventy] });

    expect(statusOf(await checkPlugin(plugin), "adapter:eleventy")?.status).toBe("warn");
    expect(statusOf(await checkPlugin(plugin, { adapters: { eleventy: { fixture: ELEVENTY_FIXTURE } } }), "adapter:eleventy")?.status).toBe("pass");
  });

  it("catches a setup that throws, and says what the plugin adds", async () => {
    const plugin = definePlugin({
      name: "galley-plugin-moody",
      displayName: "Moody",
      version: "1.0.0",
      apiVersion: PLUGIN_API_VERSION,
      settings: [{ key: "token", label: "Token", secret: true }],
      hooks: { afterPublish() {} },
      setup() {
        throw new Error("not today");
      },
    });

    expect(statusOf(await checkPlugin(plugin), "setup")).toMatchObject({ status: "fail", detail: expect.stringContaining("not today") });
    expect(summarizePlugin(plugin)).toBe("Moody 1.0.0 adds 1 hook (afterPublish). It asks for 1 setting, 1 secret among them.");
  });
});
