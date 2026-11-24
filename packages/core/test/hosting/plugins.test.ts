/**
 * Editor hosts are pluggable exactly as deploy targets are: a plugin's
 * `editorHosts` is checked, listed in the catalogue and merged after the
 * built-ins, and can't replace one.
 */
import { describe, expect, it } from "vitest";
import { createFileSecretStore, createSettingsService } from "../../src/ai/index";
import { builtInEditorHosts, createHostingService, registerEditorHost } from "../../src/hosting/index";
import type { EditorHost } from "../../src/hosting/types";
import { builtinPlugin, createPluginRegistry, createPluginSettingsStore, definePlugin, PLUGIN_API_VERSION, validatePlugin } from "../../src/plugins/index";
import { createEventBus } from "../../src/site/index";
import { tempDir } from "../workspace/helpers";

function exampleHost(id = "example-cloud"): EditorHost {
  return {
    id,
    name: "Example Cloud",
    apis: { example: "https://api.example.net" },
    info: {
      id,
      name: "Example Cloud",
      summary: "Runs the editor at Example Cloud.",
      kind: "managed",
      credentials: [],
      cost: { monthly: 5, currency: "USD", lines: [{ label: "A small computer", amount: 5 }], note: "Always on.", source: "https://example.net/pricing", checked: "2026-11-23" },
      options: [],
      docsUrl: "https://example.net/docs",
    },
    inspect: async () => ({ accounts: [{ id: "team", name: "Team" }], regions: [], domains: [], gaps: [] }),
    plan: async () => ({ resources: [], cost: exampleHost().info.cost, steps: [], files: [], problems: [] }),
    create: async () => undefined,
    removal: async () => ({ resources: [], skipped: [] }),
    remove: async () => undefined,
  };
}

function registry() {
  const home = tempDir("hosting-plugins-");
  const secrets = createFileSecretStore(home);
  const settings = createSettingsService({ home, env: {}, secretStore: secrets });

  return createPluginRegistry({ home, settings: createPluginSettingsStore({ home, env: {}, secrets, setBuiltinSecret: (name, value) => settings.setSecret(name, value) }) });
}

describe("editor hosts from plugins", () => {
  it("are checked like every contribution, with sentences that say what to change", () => {
    expect(validatePlugin(definePlugin({ name: "galley-plugin-example-cloud", apiVersion: PLUGIN_API_VERSION, editorHosts: [exampleHost()] }))).toMatchObject({ ok: true });
    const broken = { ...exampleHost("Example Cloud"), plan: "not a function", info: { ...exampleHost().info, kind: "somewhere" } };
    const check = validatePlugin({ name: "galley-plugin-broken", apiVersion: PLUGIN_API_VERSION, editorHosts: [broken, exampleHost("twice"), exampleHost("twice")] });

    expect(check.ok).toBe(false);
    expect((check as { problems: string[] }).problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining("editorHosts[0].id should be lowercase letters, digits and dashes"),
        expect.stringContaining('editorHosts[0].info.kind should be "managed" or "self-run"'),
        "The plugin: editorHosts[0].plan should be a function.",
        expect.stringContaining("twice"),
      ])
    );
  });

  it("are listed in the catalogue after the built-ins, which they can't replace", () => {
    const plugins = registry();

    plugins.register(builtinPlugin, { source: "builtin", required: true });
    plugins.register(definePlugin({ name: "galley-plugin-example-cloud", apiVersion: PLUGIN_API_VERSION, editorHosts: [exampleHost(), exampleHost("fly")] }), { source: "user" });
    // The catalogue resolves ids the way every contribution does (a plugin over a built-in) and reports the clash…
    expect(plugins.editorHosts().map((host) => `${host.id}:${host.plugin}`)).toEqual([
      "cloudflare:@galley/builtin",
      "own-server:@galley/builtin",
      "example-cloud:galley-plugin-example-cloud",
      "fly:galley-plugin-example-cloud",
    ]);
    expect(plugins.conflicts()).toEqual([{ kind: "editorHost", id: "fly", used: "galley-plugin-example-cloud", ignored: ["@galley/builtin"] }]);
    // …and the server merges them as it merges deploy targets: built-ins first, a plugin's "fly" ignored.
    const builtIns = builtInEditorHosts();
    const ids = new Set(builtIns.map((host) => host.id));
    const merged = [...builtIns, ...plugins.editorHostObjects().filter((host) => !ids.has(host.id))];

    expect(merged.map((host) => host.id)).toEqual(["fly", "cloudflare", "own-server", "example-cloud"]);
    expect(merged.find((host) => host.id === "fly")!.info.summary).toContain("Fly.io");
    expect(() => registerEditorHost(exampleHost("own-server"))).toThrow("already registered");
  });

  it("are offered by the hosting service beside the built-ins", async () => {
    const hosting = createHostingService({
      home: tempDir("hosting-plugins-home-"),
      settings: { readSecret: async () => null, setSecret: async (name) => ({ name, configured: false, source: null }), get: async () => ({}) as never },
      events: createEventBus(),
      hosts: [...builtInEditorHosts(), exampleHost()],
      env: {},
    });

    expect((await hosting.hosts()).map((host) => host.id)).toEqual(["fly", "cloudflare", "own-server", "example-cloud"]);
    expect(await hosting.connect("example-cloud")).toEqual({ accounts: [{ id: "team", name: "Team" }], regions: [], domains: [], gaps: [] });
    hosting.dispose();
  });
});
