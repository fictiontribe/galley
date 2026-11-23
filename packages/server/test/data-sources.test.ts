/**
 * The data-source route a field's picker calls: search a plugin's source,
 * look up a saved value, and the refusals — over a real plugin registry.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createFileSecretStore } from "@galley/core/ai";
import { createPluginRegistry, createPluginSettingsStore, definePlugin, PLUGIN_API_VERSION } from "@galley/core/plugins";
import { fakeSite, json, SITE_ID, testApp } from "./helpers";

const homes: string[] = [];

afterAll(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

const ITEMS = [
  { value: "field-coat", title: "Field coat", detail: "£640", image: "https://cdn.example.com/coat.webp", extra: "dropped" },
  { value: "rib-polo", title: "Rib polo", image: "javascript:alert(1)" },
];

const sourcePlugin = definePlugin({
  name: "galley-plugin-catalogue",
  apiVersion: PLUGIN_API_VERSION,
  dataSources: [
    {
      id: "catalogue-products",
      label: "Products in the catalogue",
      search: (query, ctx) => ITEMS.filter((item) => item.title.toLowerCase().includes(query.toLowerCase())).slice(0, ctx.limit),
      get: (value) => ITEMS.find((item) => item.value === value) ?? null,
    },
    {
      id: "broken-source",
      label: "A source that fails",
      search: () => {
        throw new Error("The catalogue is closed for the night.");
      },
      get: () => null,
    },
  ],
});

async function withSource() {
  const home = mkdtempSync(join(tmpdir(), "server-ds-"));

  homes.push(home);
  const plugins = createPluginRegistry({ home, settings: createPluginSettingsStore({ home, env: {}, secrets: createFileSecretStore(home) }) });

  plugins.register(sourcePlugin, { source: "user", location: "test" });
  await plugins.start();
  const app = testApp({ site: fakeSite({ readConfig: async () => null }), images: { providers: async () => [] } });

  app.services.plugins = plugins;
  return app;
}

describe("GET /api/sites/:siteId/data-sources/:sourceId", () => {
  const base = `/api/sites/${SITE_ID}/data-sources`;

  it("searches a source and sends only what the picker shows", async () => {
    const { call } = await withSource();
    const body = await json(await call("GET", `${base}/catalogue-products?q=o&limit=5`));

    expect(body).toEqual({
      source: { id: "catalogue-products", label: "Products in the catalogue", plugin: "galley-plugin-catalogue" },
      items: [
        { value: "field-coat", title: "Field coat", detail: "£640", image: "https://cdn.example.com/coat.webp" },
        { value: "rib-polo", title: "Rib polo" },
      ],
    });
    expect((await json(await call("GET", `${base}/catalogue-products?limit=1`))).items).toHaveLength(1);
  });

  it("looks up the value a file holds, or says it is gone", async () => {
    const { call } = await withSource();

    expect((await json(await call("GET", `${base}/catalogue-products?value=rib-polo`))).item).toEqual({ value: "rib-polo", title: "Rib polo" });
    expect((await json(await call("GET", `${base}/catalogue-products?value=gone`))).item).toBeNull();
  });

  it("is listed in the site's catalogue", async () => {
    const { call } = await withSource();

    expect((await json(await call("GET", `/api/sites/${SITE_ID}/catalog`))).dataSources).toEqual([
      { id: "catalogue-products", label: "Products in the catalogue", plugin: "galley-plugin-catalogue" },
      { id: "broken-source", label: "A source that fails", plugin: "galley-plugin-catalogue" },
    ]);
  });

  it("refuses unknown sources, mixed questions and failures in plain words", async () => {
    const { call } = await withSource();
    const unknown = await call("GET", `${base}/nothing?q=x`);

    expect(unknown.status).toBe(404);
    expect((await json(unknown)).error.message).toMatch(/Nothing called “nothing” offers values here/);
    expect((await call("GET", `${base}/catalogue-products?q=a&value=b`)).status).toBe(400);
    expect((await call("GET", `${base}/catalogue-products?limit=500`)).status).toBe(400);
    const broken = await call("GET", `${base}/broken-source?q=x`);

    expect(broken.status).toBe(502);
    expect((await json(broken)).error.message).toBe("A source that fails couldn't be searched just now. The catalogue is closed for the night.");
  });

  it("answers 404 when the server has no plugins", async () => {
    const { call } = testApp({ site: fakeSite({ readConfig: async () => null }), images: { providers: async () => [] } });

    expect((await call("GET", `${base}/catalogue-products?q=x`)).status).toBe(404);
  });
});

describe("POST /api/sites/:siteId/publish/check", () => {
  const changes = { files: [{ path: "src/content/pages/index.md", status: "modified", kind: "content", binary: false, additions: 1, deletions: 1, title: "Home" }], totals: { files: 1, additions: 1, deletions: 1 } };

  async function withCheck(warn: boolean) {
    const home = mkdtempSync(join(tmpdir(), "server-check-"));

    homes.push(home);
    const plugins = createPluginRegistry({ home, settings: createPluginSettingsStore({ home, env: {}, secrets: createFileSecretStore(home) }) });

    plugins.register(
      definePlugin({
        name: "galley-plugin-shop-check",
        displayName: "Shop check",
        apiVersion: PLUGIN_API_VERSION,
        hooks: { beforePublish: (_ctx, pending) => (warn ? { warnings: pending.files.map((file) => `“${file.title}” shows a product the shop no longer has.`) } : undefined) },
      }),
      { source: "user", location: "test" }
    );
    await plugins.start();
    const app = testApp({ site: fakeSite({ readConfig: async () => null, changes: async () => changes as never }), images: { providers: async () => [] } });

    app.services.plugins = plugins;
    return app;
  }

  it("says what the plugins' checks warn about, named by plugin, without publishing", async () => {
    const { call } = await withCheck(true);

    expect(await json(await call("POST", `/api/sites/${SITE_ID}/publish/check`, {}))).toEqual({
      warnings: [{ plugin: "Shop check", message: "“Home” shows a product the shop no longer has." }],
      refusal: null,
    });
    // Only some paths: none of the pending ones, so nothing is asked.
    expect(await json(await call("POST", `/api/sites/${SITE_ID}/publish/check`, { paths: ["src/content/pages/about.md"] }))).toEqual({ warnings: [], refusal: null });
  });

  it("answers nothing to say when no check speaks", async () => {
    const { call } = await withCheck(false);

    expect(await json(await call("POST", `/api/sites/${SITE_ID}/publish/check`, {}))).toEqual({ warnings: [], refusal: null });
  });
});
