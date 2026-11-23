/**
 * Two small additions to the plugin API: data sources (values a field can
 * be picked from, held outside the site) and tools behind a switch
 * (`enabledBy`) — listed only while the plugin's own setting is on, and
 * refusing to run when it is off, whatever list a caller still holds.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createFileSecretStore } from "../../src/ai/index";
import { validateConfig } from "../../src/content/index";
import { applyFieldConfigs } from "../../src/content/config/config";
import { createPluginRegistry, createPluginSettingsStore, definePlugin, isSwitchOn, PLUGIN_API_VERSION, validatePlugin } from "../../src/plugins/index";
import type { ToolContext } from "../../src/ai/tools/types";
import { disposeAll, makeSite, openSite, tempDir } from "../site/helpers";

afterAll(() => disposeAll());

const ITEMS = [
  { value: "field-coat", title: "Field coat", detail: "£640" },
  { value: "rib-polo", title: "Rib polo", detail: "£210" },
];

const storePlugin = definePlugin({
  name: "galley-plugin-store",
  apiVersion: PLUGIN_API_VERSION,
  settings: [
    { key: "allowEdits", label: "Let the assistant edit product copy", pattern: "^(on|off)$" },
    { key: "token", label: "Token", secret: true },
  ],
  dataSources: [
    {
      id: "store-products",
      label: "Products in the store",
      search: (query, ctx) => ITEMS.filter((item) => item.title.toLowerCase().includes(query.toLowerCase())).slice(0, ctx.limit),
      get: (value) => ITEMS.find((item) => item.value === value) ?? null,
    },
    {
      id: "store-writer",
      label: "A source that tries to write",
      search: async (_query, ctx) => {
        await ctx.site.writeFile("notes.md", "nope", { origin: "agent", mode: "content" });
        return [];
      },
      get: () => null,
    },
  ],
  tools: [
    {
      name: "store_read",
      title: "Read the store",
      description: "Reads the store. Read-only.",
      input: { type: "object", properties: {} },
      mode: "content",
      effect: { readOnly: true, openWorld: true },
      run: () => "read",
    },
    {
      name: "store_edit_copy",
      title: "Edit product copy (changes the store directly)",
      description: "Changes the store directly. Only when switched on.",
      input: { type: "object", properties: { title: { type: "string" } } },
      mode: "content",
      effect: { readOnly: false, destructive: true, openWorld: true },
      enabledBy: "allowEdits",
      run: (input) => `edited ${String(input.title)}`,
    },
  ],
});

function registryIn(home = tempDir("plugins-ds-")) {
  const secrets = createFileSecretStore(home);
  const registry = createPluginRegistry({ home, settings: createPluginSettingsStore({ home, env: {}, secrets }) });

  return { home, registry };
}

describe("validation", () => {
  it("accepts data sources and a switch that names a plain setting", () => {
    const check = validatePlugin(storePlugin);

    expect(check.ok).toBe(true);
  });

  it("refuses a data source without search and get, and a switch that is missing or secret", () => {
    const bad = validatePlugin({
      name: "galley-plugin-bad",
      apiVersion: 1,
      settings: [{ key: "token", label: "Token", secret: true }],
      dataSources: [{ id: "Bad Id", label: "" }],
      tools: [
        { name: "one_tool", title: "One", description: "One.", input: { type: "object", properties: {} }, mode: "content", effect: { readOnly: false }, enabledBy: "missing", run: () => "" },
        { name: "two_tool", title: "Two", description: "Two.", input: { type: "object", properties: {} }, mode: "content", effect: { readOnly: false }, enabledBy: "token", run: () => "" },
      ],
    });

    expect(bad.ok).toBe(false);
    const problems = bad.ok ? [] : bad.problems.join("\n");

    expect(problems).toMatch(/dataSources\[0\]\.id/);
    expect(problems).toMatch(/dataSources\[0\] needs a label/);
    expect(problems).toMatch(/dataSources\[0\]\.search should be a function/);
    expect(problems).toMatch(/enabledBy names “missing”/);
    expect(problems).toMatch(/enabledBy names “token”, a secret/);
  });

  it("reads the usual words for on", () => {
    expect(["on", "Yes", "TRUE", "1", " on "].every(isSwitchOn)).toBe(true);
    expect(["off", "", "no", "0", undefined].some(isSwitchOn)).toBe(false);
  });
});

describe("a tool behind a switch", () => {
  it("is listed only while the switch is on, and refuses to run once it is off", async () => {
    const { registry } = registryIn();

    registry.register(storePlugin, { source: "user", location: "test" });
    await registry.start();
    expect(registry.tools().map((tool) => tool.name)).toEqual(["store_read"]);

    await registry.saveSettings("galley-plugin-store", { allowEdits: "on" });
    const listed = registry.tools();

    expect(listed.map((tool) => tool.name).sort()).toEqual(["store_edit_copy", "store_read"]);
    const edit = listed.find((tool) => tool.name === "store_edit_copy")!;

    expect(edit).toBeDefined();
    expect(edit.effect).toEqual({ readOnly: false, destructive: true, idempotent: false, openWorld: true });
    const ctx = { site: {} as never, siteId: "s", mode: "content", signal: new AbortController().signal } as unknown as ToolContext;

    expect((await edit.run({ title: "Field coat" }, ctx)).content).toBe("edited Field coat");

    // Switched off while someone still holds the old list: it refuses, plainly.
    await registry.saveSettings("galley-plugin-store", { allowEdits: "off" });
    expect(registry.tools().map((tool) => tool.name)).toEqual(["store_read"]);
    const refused = await edit.run({ title: "Field coat" }, ctx);

    expect(refused.isError).toBe(true);
    expect(refused.content).toMatch(/switched off in the plugin's settings/);
  });

  it("is listed on start when the switch was saved before", async () => {
    const home = tempDir("plugins-ds-");
    const first = registryIn(home);

    first.registry.register(storePlugin, { source: "user", location: "test" });
    await first.registry.saveSettings("galley-plugin-store", { allowEdits: "on" });
    const second = registryIn(home);

    second.registry.register(storePlugin, { source: "user", location: "test" });
    await second.registry.start();
    expect(second.registry.tools().map((tool) => tool.name).sort()).toEqual(["store_edit_copy", "store_read"]);
  });
});

describe("data sources", () => {
  it("are listed with their plugin, searched and looked up with the site read-only", async () => {
    const { registry } = registryIn();
    const root = makeSite();
    const { site } = await openSite(root);

    registry.register(storePlugin, { source: "user", location: "test" });
    await registry.start();
    expect(registry.dataSources()).toEqual([
      { id: "store-products", label: "Products in the store", plugin: "galley-plugin-store" },
      { id: "store-writer", label: "A source that tries to write", plugin: "galley-plugin-store" },
    ]);
    expect((await registry.list()).find((plugin) => plugin.name === "galley-plugin-store")?.contributes.dataSources).toEqual(["Products in the store", "A source that tries to write"]);

    const found = registry.dataSource("store-products", site)!;
    const ctx = await found.context(new AbortController().signal, 1);

    expect(await found.contribution.search("o", ctx)).toEqual([ITEMS[0]]);
    expect(await found.contribution.get("rib-polo", ctx)).toEqual(ITEMS[1]);
    expect(await found.contribution.get("gone", ctx)).toBeNull();

    const writer = registry.dataSource("store-writer", site)!;

    await expect(writer.contribution.search("", await writer.context(new AbortController().signal, 5))).rejects.toThrow(/can read the site but not change it/);
    expect(registry.dataSource("nothing-here", site)).toBeNull();
  });

  it("disappear with their plugin", async () => {
    const { registry } = registryIn();

    registry.register(storePlugin, { source: "user", location: "test" });
    await registry.setEnabled("galley-plugin-store", false);
    expect(registry.dataSources()).toEqual([]);
  });

  it("are named by a field in galley.config.json, and the model carries the hint", async () => {
    expect(validateConfig({ collections: [{ id: "pages", fields: [{ key: "product", dataSource: "store-products" }] }] }).ok).toBe(true);
    const refused = validateConfig({ collections: [{ id: "pages", fields: [{ key: "product", dataSource: "Not An Id" }] }] });

    expect(refused.ok).toBe(false);
    const fields = applyFieldConfigs([{ key: "product", label: "Product", type: "string", required: true, source: "inferred" }], [{ key: "product", dataSource: "store-products" }]);

    expect(fields[0]).toMatchObject({ key: "product", type: "string", dataSource: "store-products", source: "config" });

    // And through detection, inside a section of a real site.
    const root = makeSite();
    const config = join(root, "galley.config.json");

    writeFileSync(config, JSON.stringify({ collections: [{ id: "pages", fields: [{ key: "featured", type: "string", dataSource: "store-products" }] }] }));
    const { site } = await openSite(root);
    const pages = (await site.model()).collections.find((collection) => collection.id === "pages")!;

    expect(pages.fields.find((field) => field.key === "featured")?.dataSource).toBe("store-products");
  });
});
