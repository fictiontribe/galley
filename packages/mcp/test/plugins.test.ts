/**
 * Tools a plugin adds reach any harness over MCP — from the same registry the
 * built-in assistant uses — in the right mode, with read-only annotations,
 * and are gone once the plugin is turned off.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPluginRegistry, definePlugin, PLUGIN_API_VERSION, setActivePlugins, type PluginRegistry } from "@galley/core/plugins";
import { callTool, connect, makeSite, openEngine, type Engine } from "./helpers";

const plugin = definePlugin({
  name: "galley-plugin-mcp-tools",
  apiVersion: PLUGIN_API_VERSION,
  tools: [
    {
      name: "count_sections",
      title: "Count a page's sections",
      description: "Count the sections on a page. Read-only; use it to answer how long a page is.",
      input: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      mode: "content",
      effect: { readOnly: true },
      async run(input, ctx) {
        const entry = await ctx.site.readEntry(String(input.path));

        return { sections: Array.isArray(entry.data.sections) ? entry.data.sections.length : 0 };
      },
    },
    {
      name: "regenerate_sitemap",
      title: "Regenerate the sitemap",
      description: "Rewrite the sitemap source file from the site's pages. Build mode only.",
      input: { type: "object", properties: {} },
      mode: "build",
      effect: { readOnly: false, idempotent: true },
      run: () => "done",
    },
  ],
});

describe("plugin tools over MCP", () => {
  let engine: Engine;
  let registry: PluginRegistry;
  let release: () => void;

  beforeAll(async () => {
    engine = await openEngine(makeSite());
    registry = createPluginRegistry();
    registry.register(plugin, { source: "user" });
    await registry.start();
    release = setActivePlugins({ adapters: () => [], tools: (root) => registry.tools(root) });
  });
  afterAll(async () => {
    release();
    await engine.site.dispose();
  });

  it("are listed in the right mode, annotated, and run through the shared dispatcher", async () => {
    const content = await connect(engine);
    const listed = (await content.client.listTools()).tools;
    const count = listed.find((tool) => tool.name === "count_sections");

    expect(count).toMatchObject({ title: "Count a page's sections", annotations: { readOnlyHint: true, destructiveHint: false } });
    expect(count?.inputSchema).toMatchObject({ type: "object", required: ["path"] });
    expect(listed.map((tool) => tool.name)).not.toContain("regenerate_sitemap");
    const result = await callTool(content.client, "count_sections", { path: "src/content/pages/index.md" });

    expect(result.isError).toBe(false);
    expect(result.json().sections).toBeGreaterThan(0);
    expect((await callTool(content.client, "count_sections", {})).isError).toBe(true);
    await content.close();

    const build = await connect(engine, { mode: "build" });

    expect((await build.client.listTools()).tools.map((tool) => tool.name)).toContain("regenerate_sitemap");
    await build.close();
    const readOnly = await connect(engine, { mode: "build", readOnly: true });

    expect((await readOnly.client.listTools()).tools.map((tool) => tool.name)).not.toContain("regenerate_sitemap");
    await readOnly.close();
  });

  it("are gone once the plugin is turned off", async () => {
    await registry.setEnabled("galley-plugin-mcp-tools", false);
    const session = await connect(engine, { mode: "build" });
    const names = (await session.client.listTools()).tools.map((tool) => tool.name);

    expect(names).not.toContain("count_sections");
    expect(names).not.toContain("regenerate_sitemap");
    await session.close();
  });
});
