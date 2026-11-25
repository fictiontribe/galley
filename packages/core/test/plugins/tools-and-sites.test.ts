/**
 * Plugin tools reach the built-in assistant (the real loop, a scripted
 * model) in the right mode and vanish when the plugin is turned off; a
 * site's own plugins load only when its config names them and the trust
 * switches allow it; the `adapters` key keeps working through the same path.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { loadSiteModel } from "../../src/content/index";
import { buildToolNames, runTool, runningActivity, toolDefinitions, toolsForMode } from "../../src/ai/tools/index";
import {
  createPluginRegistry,
  definePlugin,
  ensureSitePlugins,
  PLUGIN_API_VERSION,
  setActivePlugins,
  setHostedMode,
  type PluginRegistry,
} from "../../src/plugins/index";
import { scopedSite } from "../../src/plugins/tools";
import { harness } from "../ai/helpers/env";
import { createFakeSite } from "../ai/helpers/fake-site";
import { scriptedFetch, stream, testClient, type MessageSpec } from "../ai/helpers/scripted-fetch";
import { disposeAll, HOME, makeSite, openSite } from "../site/helpers";

const released: Array<() => void> = [];

afterEach(async () => {
  while (released.length) released.pop()!();
  setHostedMode(false);
  await disposeAll();
});

function activate(registry: PluginRegistry): void {
  released.push(setActivePlugins({ adapters: (root) => registry.adapters(root), tools: (root) => registry.tools(root) }));
}

const toolPlugin = definePlugin({
  name: "galley-plugin-tools",
  apiVersion: PLUGIN_API_VERSION,
  tools: [
    {
      name: "shout_title",
      title: "Shout a page's title",
      description: "Return the title of an entry in capitals. Read-only; use when the person asks to hear a title loudly.",
      input: { type: "object", properties: { path: { type: "string", description: "The entry's path." } }, required: ["path"] },
      mode: "content",
      effect: { readOnly: true },
      label: () => "Shouting the title",
      async run(input, ctx) {
        const entry = await ctx.site.readEntry(String(input.path));

        return { shout: entry.title.toUpperCase(), mode: ctx.mode, plugin: ctx.plugin.name };
      },
    },
    {
      name: "sneaky_write",
      title: "Try to write while claiming to read",
      description: "A tool that says it only reads but tries to write, to prove the declared effect is enforced.",
      input: { type: "object", properties: {} },
      mode: "content",
      effect: { readOnly: true },
      async run(_input, ctx) {
        await ctx.site.writeFile("notes.md", "nope", { origin: "agent", mode: "build" });
        return "wrote";
      },
    },
    {
      name: "rebuild_search_index",
      title: "Rebuild the search index",
      description: "A build-mode tool: rewrites the site's search index file. Only offered in build mode.",
      input: { type: "object", properties: { full: { type: "boolean" } } },
      mode: "build",
      effect: { readOnly: false, idempotent: true },
      run: () => "rebuilt",
    },
  ],
});

async function toolsRegistry() {
  const registry = createPluginRegistry();

  registry.register(toolPlugin, { source: "user" });
  await registry.start();
  activate(registry);
  return registry;
}

const thinking = { type: "thinking" as const, thinking: "", signature: "sig-plugin" };
const step = (name: string, input: unknown): MessageSpec => ({ content: [thinking, { type: "tool_use", id: "toolu_p1", name, input }], stop_reason: "tool_use" });
const done = (text: string): MessageSpec => ({ content: [{ ...thinking, signature: "sig-done" }, { type: "text", text }], stop_reason: "end_turn" });

describe("plugin tools in the assistant", () => {
  it("are offered in the right mode, deferred when build-only, and gone once the plugin is off", async () => {
    const registry = await toolsRegistry();
    const content = toolsForMode("content").map((tool) => tool.name);

    expect(content).toEqual(expect.arrayContaining(["shout_title", "sneaky_write"]));
    expect(content).not.toContain("rebuild_search_index");
    expect(toolsForMode("build").map((tool) => tool.name)).toContain("rebuild_search_index");
    expect(toolDefinitions().find((tool) => tool.name === "rebuild_search_index")).toMatchObject({ defer_loading: true });
    expect(toolDefinitions().find((tool) => tool.name === "shout_title")?.input_schema).toMatchObject({ type: "object", required: ["path"] });
    expect(buildToolNames()).toContain("rebuild_search_index");

    await registry.setEnabled("galley-plugin-tools", false);
    expect(toolsForMode("build").map((tool) => tool.name)).not.toContain("shout_title");
    expect(toolDefinitions().map((tool) => tool.name)).not.toContain("rebuild_search_index");
  });

  it("run inside a real turn, with the plugin's context and the mode enforced", async () => {
    await toolsRegistry();
    const script = scriptedFetch([stream(step("shout_title", { path: "src/content/pages/index.md" })), stream(done("It says HARBOUR BAKERY."))]);
    const site = createFakeSite();
    const h = harness({ client: testClient(script.fetch), site });
    const thread = await h.runtime.createThread(site.id);

    await h.turn(thread.id, "Shout the home page title");
    expect(script.requests[0]!.body.tools.map((tool: { name: string }) => tool.name)).toContain("shout_title");
    const result = script.requests[1]!.body.messages.at(-1).content.find((block: { type: string }) => block.type === "tool_result");

    expect(JSON.parse(result.content)).toMatchObject({ mode: "content", plugin: "galley-plugin-tools" });
    expect(result.is_error).toBeUndefined();
  });

  it("refuses a write from a tool that declared itself read-only", async () => {
    await toolsRegistry();
    const root = makeSite();
    const { site } = await openSite(root);
    const ctx = { site, siteId: site.id, mode: "build" as const, model: await site.model(), images: undefined as never, signal: new AbortController().signal, titles: new Map(), question: null, askedLastTurn: false };
    const block = { type: "tool_use", id: "toolu_x", name: "sneaky_write", input: {} } as Anthropic.Beta.BetaToolUseBlock;
    const run = await runTool(block, ctx, runningActivity(block, ctx));

    expect(run.result.is_error).toBe(true);
    expect(String(run.result.content)).toContain("said it only reads, so it can't change the site");
    expect((await site.changes()).files).toEqual([]);
  });
});

function siteWithPlugin(root: string): void {
  mkdirSync(join(root, "tools"), { recursive: true });
  writeFileSync(
    join(root, "tools", "plugin.mjs"),
    `export default {
  name: "galley-plugin-local",
  apiVersion: 1,
  tools: [{
    name: "local_hello",
    title: "Say hello from the site",
    description: "A tool this site's own plugin adds; it answers with a greeting and the site's id.",
    input: { type: "object", properties: {} },
    mode: "content",
    effect: { readOnly: true },
    run: (_input, ctx) => "hello from " + ctx.siteId,
  }],
  adapters: [{
    id: "local-astro",
    name: "Local Astro",
    detect: (ctx) => (ctx.exists("package.json") ? { confidence: 0.99 } : null),
  }],
};
`
  );
  writeFileSync(join(root, "tools", "adapter.mjs"), `export default { id: "named-adapter", name: "Named adapter", detect: () => ({ confidence: 1 }) };\n`);
}

describe("plugins a site names", () => {
  it("load from inside the site only when named, and show for that site alone", async () => {
    const root = makeSite();

    siteWithPlugin(root);
    const { site } = await openSite(root);
    const registry = createPluginRegistry();

    activate(registry);
    await ensureSitePlugins(registry, site, {});
    expect(registry.tools(root)).toEqual([]);

    writeFileSync(join(root, "galley.config.json"), JSON.stringify({ plugins: ["./tools/plugin.mjs", "../outside.mjs"] }));
    await ensureSitePlugins(registry, site, {});
    expect(registry.tools(root).map((tool) => tool.name)).toEqual(["local_hello"]);
    expect(registry.tools("/another/site")).toEqual([]);
    expect(toolsForMode("content", root).map((tool) => tool.name)).toContain("local_hello");
    const list = await registry.list(root);

    expect(list.find((item) => item.name === "galley-plugin-local")).toMatchObject({ source: "site", active: true, location: "./tools/plugin.mjs", siteId: site.id });
    expect(list.find((item) => item.name === "../outside.mjs")?.problems[0]).toMatch(/not found in the site folder|outside the site folder/);
    // Its adapter is used for detection, with the trust statement in the site's notes.
    const model = await loadSiteModel(root);

    expect(model.framework.id).toBe("local-astro");
    expect(model.notes.join(" ")).toContain("Loaded the Local Astro adapter from the plugin ./tools/plugin.mjs.");
  });

  it("are not loaded when GALLEY_DISABLE_SITE_PLUGINS=1 — adapters named by the site included", async () => {
    const root = makeSite();

    siteWithPlugin(root);
    writeFileSync(join(root, "galley.config.json"), JSON.stringify({ plugins: ["./tools/plugin.mjs"], adapters: ["./tools/adapter.mjs"] }));
    const { site } = await openSite(root);
    const registry = createPluginRegistry();
    const env = { GALLEY_DISABLE_SITE_PLUGINS: "1" };

    await ensureSitePlugins(registry, site, env);
    expect(registry.tools(root)).toEqual([]);
    expect((await registry.list(root)).map((item) => item.problems[0]).sort()).toEqual([
      "./tools/adapter.mjs in galley.config.json was not loaded: site plugins are turned off (GALLEY_DISABLE_SITE_PLUGINS).",
      "./tools/plugin.mjs in galley.config.json was not loaded: site plugins are turned off (GALLEY_DISABLE_SITE_PLUGINS).",
    ]);
    const previous = process.env.GALLEY_DISABLE_SITE_PLUGINS;

    process.env.GALLEY_DISABLE_SITE_PLUGINS = "1";
    try {
      const model = await loadSiteModel(root);

      expect(model.framework.id).toBe("astro");
      expect(model.notes.join(" ")).toContain("were not loaded: site plugins are turned off");
    } finally {
      if (previous === undefined) delete process.env.GALLEY_DISABLE_SITE_PLUGINS;
      else process.env.GALLEY_DISABLE_SITE_PLUGINS = previous;
    }
  });

  it("are off on a hosted server unless the operator sets GALLEY_ALLOW_SITE_PLUGINS=1", async () => {
    const root = makeSite();

    siteWithPlugin(root);
    writeFileSync(join(root, "galley.config.json"), JSON.stringify({ plugins: ["./tools/plugin.mjs"] }));
    const { site } = await openSite(root);
    const registry = createPluginRegistry();

    setHostedMode(true);
    await ensureSitePlugins(registry, site, {});
    expect(registry.tools(root)).toEqual([]);
    expect((await registry.list(root))[0]!.problems[0]).toContain("GALLEY_ALLOW_SITE_PLUGINS=1");

    await ensureSitePlugins(registry, site, { GALLEY_ALLOW_SITE_PLUGINS: "1" });
    expect(registry.tools(root).map((tool) => tool.name)).toEqual(["local_hello"]);
  });

  it("keep the `adapters` key working: each adapter is listed as a plugin contributing one adapter", async () => {
    const root = makeSite();

    siteWithPlugin(root);
    writeFileSync(join(root, "galley.config.json"), JSON.stringify({ adapters: ["./tools/adapter.mjs"] }));
    const { site } = await openSite(root);
    const registry = createPluginRegistry();

    await ensureSitePlugins(registry, site, {});
    expect((await registry.list(root))[0]).toMatchObject({ name: "site-adapter-named-adapter", source: "site", contributes: expect.objectContaining({ adapters: ["Named adapter"] }) });
    expect((await loadSiteModel(root)).framework.id).toBe("named-adapter");
    expect((await site.readEntry(HOME)).title).toBeTruthy();
  });
});

describe("the site a plugin is handed", () => {
  it("can't close the site, hands a checkpoint of its public members only, and can't be changed or looked round", async () => {
    const { site } = await openSite(makeSite());
    const scoped = scopedSite(site, { readOnly: true, mode: "content", name: "a hook" }) as unknown as Record<string, unknown>;

    for (const name of ["dispose", "snapshot", "previewHandle", "liveUrl", "undoOffered", "isClosed"]) {
      expect(scoped[name], name).toBeUndefined();
      expect(name in scoped, name).toBe(false);
    }
    // Read-only, looked at as a descriptor too: the same refusal.
    const described = Object.getOwnPropertyDescriptor(scoped, "writeFile")!.value as (...args: unknown[]) => Promise<unknown>;

    await expect(described(HOME, "x", { origin: "user", mode: "content" })).rejects.toMatchObject({ code: "forbidden" });
    expect(() => Object.defineProperty(scoped, "added", { value: () => site })).toThrow(TypeError);
    expect(() => Object.freeze(scoped)).toThrow(TypeError);
    expect(Reflect.set(scoped, "readFile", () => "mine")).toBe(false);
    // Still the site's own, every member: nothing above changed it.
    expect((await site.readFile(HOME)).content).toBeTruthy();

    const writing = scopedSite(site, { readOnly: false, mode: "content", name: "a tool" });
    const checkpoint = writing.checkpoint("a tool's work") as unknown as Record<string, unknown>;

    expect(Object.keys(checkpoint).sort()).toEqual(["close", "id", "left", "paths", "release", "restore", "run"]);
    expect("offer" in checkpoint).toBe(false);
    expect("manager" in checkpoint).toBe(false);
    await (checkpoint.release as () => Promise<void>)();
  }, 120_000);

  it("a closed site's refused read of its settings isn't taken for a site naming no plugins", async () => {
    const root = makeSite();

    siteWithPlugin(root);
    writeFileSync(join(root, "galley.config.json"), JSON.stringify({ plugins: ["./tools/plugin.mjs"] }));
    const kept = await openSite(root);
    const registry = createPluginRegistry();

    activate(registry);
    await ensureSitePlugins(registry, kept.site, {});
    expect(registry.tools(root).map((tool) => tool.name)).toEqual(["local_hello"]);
    // The settings change, and the site that was kept is closed before it reloads them.
    writeFileSync(join(root, "galley.config.json"), JSON.stringify({ plugins: ["./tools/plugin.mjs"], name: "Renamed" }));
    await kept.site.dispose();
    await ensureSitePlugins(registry, kept.site, {});
    expect(registry.tools(root).map((tool) => tool.name)).toEqual(["local_hello"]);
    // The site opened next loads them itself.
    const next = await openSite(root);

    await ensureSitePlugins(registry, next.site, {});
    expect(registry.tools(root).map((tool) => tool.name)).toEqual(["local_hello"]);
  }, 120_000);
});

describe("more of what a plugin is handed", () => {
  it("a preview of its four public members, which a plugin that only reads can't start, stop or restart", async () => {
    const { site } = await openSite(makeSite());
    const reading = scopedSite(site, { readOnly: true, mode: "content", name: "a hook" }).preview() as unknown as Record<string, unknown>;
    const writing = scopedSite(site, { readOnly: false, mode: "content", name: "a tool" }).preview() as unknown as Record<string, unknown>;

    for (const preview of [reading, writing]) {
      expect(Object.keys(preview).sort()).toEqual(["restart", "start", "status", "stop"]);
      expect("dispose" in preview).toBe(false);
      expect("pause" in preview).toBe(false);
    }
    expect((reading.status as () => { state: string }).call(null).state).toBeTruthy();
    for (const change of ["start", "stop", "restart"]) await expect((reading[change] as () => Promise<unknown>)(), change).rejects.toMatchObject({ code: "forbidden" });
    // The site's own preview is the same four members too: nothing hands the controller out.
    expect(Object.keys(site.preview()).sort()).toEqual(["restart", "start", "status", "stop"]);
  }, 120_000);

  it("no member keyed by a symbol, however it is looked for", async () => {
    const { site } = await openSite(makeSite());
    const scoped = scopedSite(site, { readOnly: false, mode: "content", name: "a tool" });

    expect(Object.getOwnPropertySymbols(scoped)).toEqual([]);
    for (const symbol of Object.getOwnPropertySymbols(site)) {
      expect((scoped as unknown as Record<symbol, unknown>)[symbol]).toBeUndefined();
      expect(symbol in scoped).toBe(false);
    }
  }, 120_000);

  it("two loads of a site's plugins at once load them once", async () => {
    const root = makeSite();

    siteWithPlugin(root);
    writeFileSync(join(root, "galley.config.json"), JSON.stringify({ plugins: ["./tools/plugin.mjs"] }));
    const { site } = await openSite(root);
    const registry = createPluginRegistry();

    activate(registry);
    await ensureSitePlugins(registry, site, {});
    writeFileSync(join(root, "galley.config.json"), JSON.stringify({ plugins: ["./tools/plugin.mjs"], name: "Again" }));
    await Promise.all([ensureSitePlugins(registry, site, {}), ensureSitePlugins(registry, site, {})]);
    const list = await registry.list(root);

    expect(registry.tools(root).map((tool) => tool.name)).toEqual(["local_hello"]);
    expect(list.flatMap((item) => item.problems ?? [])).toEqual([]);
  }, 120_000);
});
