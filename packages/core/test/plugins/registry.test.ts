/**
 * The plugin registry: precedence and conflicts, isolation of a plugin that
 * fails, settings and secrets (never in a listing, a log or an error), and
 * the hooks around a real publish in a real git repository.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createFileSecretStore, createSettingsService } from "../../src/ai/index";
import {
  builtinPlugin,
  checkPublish,
  createPluginRegistry,
  createPluginSettingsStore,
  definePlugin,
  PLUGIN_API_VERSION,
  withSiteHooks,
  wordpressImporterPlugin,
  type GalleyPlugin,
  type PluginRegistry,
} from "../../src/plugins/index";
import type { PublishResult } from "../../src/types";
import { disposeAll, HOME, makeSite, openSite, tempDir } from "../site/helpers";

afterAll(() => disposeAll());

const SECRET = "sk-plugin-secret-0123456789abcdefXYZ";

function registryIn(home = tempDir("plugins-home-"), env: NodeJS.ProcessEnv = {}) {
  const secrets = createFileSecretStore(home);
  const settings = createSettingsService({ home, env, secretStore: secrets });
  const lines: string[] = [];
  const registry = createPluginRegistry({
    home,
    settings: createPluginSettingsStore({ home, env, secrets, setBuiltinSecret: (name, value) => settings.setSecret(name, value) }),
    log: (line) => lines.push(line),
    hookTimeoutMs: { before: 500, after: 500, setup: 500 },
  });

  return { home, registry, lines, settings };
}

function scriptPlugin(name: string, kind: string, label: string): GalleyPlugin {
  return definePlugin({
    name,
    apiVersion: PLUGIN_API_VERSION,
    scriptIntegrations: [
      {
        kind,
        name: label,
        description: `${label} analytics.`,
        category: "analytics",
        defaultConsent: "analytics",
        defaultPlacement: "head",
        settings: [{ key: "id", label: "Id" }],
        snippet: { src: "https://cdn.example.com/{{id}}.js" },
      },
    ],
  });
}

describe("precedence and conflicts", () => {
  it("prefers the site's plugin over an installed one over a built-in, and reports every conflict", async () => {
    const { registry } = registryIn();

    registry.register(builtinPlugin, { source: "builtin", required: true });
    registry.register(scriptPlugin("galley-plugin-builtin-like", "plausible", "Builtin-like Plausible"), { source: "builtin" });
    registry.register(scriptPlugin("galley-plugin-user-a", "plausible", "User Plausible"), { source: "user" });
    registry.register(scriptPlugin("galley-plugin-user-b", "plausible", "Second user Plausible"), { source: "user" });
    registry.register(scriptPlugin("galley-plugin-site", "plausible", "Site Plausible"), { source: "site", siteRoot: "/sites/a" });
    await registry.start();

    // Server-wide: the first installed plugin wins over the built-ins and the later installed one.
    expect(registry.scriptIntegrations().find((item) => item.kind === "plausible")).toMatchObject({ name: "User Plausible", plugin: "galley-plugin-user-a" });
    expect(registry.conflicts()).toContainEqual({
      kind: "scriptIntegration",
      id: "plausible",
      used: "galley-plugin-user-a",
      ignored: ["galley-plugin-user-b", "@galley/builtin", "galley-plugin-builtin-like"],
    });
    // For the site that names one, the site's own wins; another site never sees it.
    expect(registry.scriptIntegrations("/sites/a").find((item) => item.kind === "plausible")?.plugin).toBe("galley-plugin-site");
    expect(registry.scriptIntegrations("/sites/b").find((item) => item.kind === "plausible")?.plugin).toBe("galley-plugin-user-a");
    // Built-in kinds nobody overrides stay, in their declared order.
    expect(registry.scriptIntegrations().map((item) => item.kind).slice(0, 2)).toEqual(["gtm", "ga4"]);
  });

  it("drops a disabled plugin's contributions, keeps the choice across restarts, and won't disable the built-ins", async () => {
    const { registry, home } = registryIn();

    registry.register(builtinPlugin, { source: "builtin", required: true });
    registry.register(scriptPlugin("galley-plugin-user-a", "plausible", "User Plausible"), { source: "user" });
    await registry.start();
    expect(await registry.setEnabled("galley-plugin-user-a", false)).toBe(true);
    expect(registry.scriptIntegrations().find((item) => item.kind === "plausible")?.plugin).toBe("@galley/builtin");
    expect(JSON.parse(readFileSync(join(home, "plugin-state.json"), "utf8"))).toEqual({ disabled: ["galley-plugin-user-a"] });
    await expect(registry.setEnabled("@galley/builtin", false)).rejects.toMatchObject({ code: "invalid" });

    const again = registryIn(home).registry;

    again.register(scriptPlugin("galley-plugin-user-a", "plausible", "User Plausible"), { source: "user" });
    expect((await again.list())[0]).toMatchObject({ name: "galley-plugin-user-a", enabled: false, active: false });
  });
});

describe("isolation", () => {
  it("keeps a plugin that throws in setup, or isn't a plugin at all, out of use — and the rest working", async () => {
    const { registry, lines } = registryIn();
    const broken = definePlugin({
      name: "galley-plugin-broken",
      apiVersion: PLUGIN_API_VERSION,
      setup() {
        throw new Error(`boom with ${SECRET}`);
      },
      tools: [
        {
          name: "broken_tool",
          title: "Broken",
          description: "Never offered, because the plugin failed to start.",
          input: { type: "object", properties: {} },
          mode: "content",
          effect: { readOnly: true },
          run: () => "never",
        },
      ],
    });
    const slow = definePlugin({ name: "galley-plugin-slow", apiVersion: PLUGIN_API_VERSION, setup: () => new Promise(() => {}), hooks: { afterPublish() {} } });

    registry.register(broken, { source: "user" });
    registry.register(slow, { source: "user" });
    registry.register({ name: "Not A Plugin", tools: "yes" }, { source: "user", location: "./weird.mjs" });
    registry.registerFailure("galley-plugin-missing", "galley-plugin-missing could not be loaded (Cannot find module).", { source: "user" });
    registry.register(scriptPlugin("galley-plugin-fine", "fine", "Fine"), { source: "user" });
    await registry.start();

    const list = await registry.list();
    const byName = (name: string) => list.find((item) => item.name === name)!;

    expect(byName("galley-plugin-broken")).toMatchObject({ enabled: true, active: false });
    expect(byName("galley-plugin-broken").problems[0]).toMatch(/couldn't start .* turned off until the app restarts/);
    expect(byName("galley-plugin-slow").problems[0]).toMatch(/took longer than/);
    expect(byName("./weird.mjs").problems.join(" ")).toMatch(/npm package name/);
    expect(byName("galley-plugin-missing").problems).toEqual(["galley-plugin-missing could not be loaded (Cannot find module)."]);
    expect(registry.tools().map((tool) => tool.name)).toEqual([]);
    expect(registry.scriptIntegrations().map((item) => item.kind)).toEqual(["fine"]);
    // The failure is reported with the secret cut out of it.
    expect(JSON.stringify(list)).not.toContain(SECRET);
    expect(lines.join("\n")).not.toContain(SECRET);
  });
});

describe("settings and secrets", () => {
  const secretPlugin = definePlugin({
    name: "galley-plugin-secretive",
    apiVersion: PLUGIN_API_VERSION,
    settings: [
      { key: "token", label: "Access token", secret: true, required: true, env: ["SECRETIVE_TOKEN", "ANTHROPIC_API_KEY", "GALLEY_PASSWORD"] },
      { key: "channel", label: "Channel", pattern: "^#[a-z-]+$", placeholder: "#general" },
      { key: "shared", label: "Shared", secret: true, secretName: "openrouter" },
    ],
    hooks: {
      afterPublish(ctx) {
        ctx.log.info(`publishing with ${ctx.settings.token} to ${ctx.settings.channel}`);
        throw new Error(`failed using ${ctx.settings.token}`);
      },
    },
  });

  it("stores secrets per plugin, never lists or logs them, and refuses what doesn't fit", async () => {
    const { registry, lines, home } = registryIn();

    registry.register(secretPlugin, { source: "user" });
    await registry.start();
    const info = await registry.saveSettings("galley-plugin-secretive", { token: SECRET, channel: "#launches" });

    expect(info.settings).toEqual([
      expect.objectContaining({ key: "token", secret: true, configured: true, source: "stored", hint: "fXYZ" }),
      expect.objectContaining({ key: "channel", secret: false, configured: true, value: "#launches" }),
      expect.objectContaining({ key: "shared", configured: false }),
    ]);
    expect(JSON.stringify(await registry.list())).not.toContain(SECRET);
    // Kept in the secret store under the plugin's own name — an installed plugin can't claim a shared one.
    const stored = JSON.parse(readFileSync(join(home, "secrets.json"), "utf8"));

    expect(stored["plugin:galley-plugin-secretive:token"]).toBe(SECRET);
    expect(readFileSync(join(home, "plugin-settings.json"), "utf8")).not.toContain(SECRET);
    await registry.saveSettings("galley-plugin-secretive", { shared: "sk-or-v1-0123456789abcdefghij" });
    expect(JSON.parse(readFileSync(join(home, "secrets.json"), "utf8")).openrouter).toBeUndefined();

    await expect(registry.saveSettings("galley-plugin-secretive", { channel: "general" })).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("#general") });
    await expect(registry.saveSettings("galley-plugin-secretive", { nope: "x" })).rejects.toMatchObject({ code: "invalid" });

    const site = { id: "s", root: "/nowhere" } as never;

    await registry.afterPublish(site, { ok: true, files: [], pushed: false });
    await registry.settled();
    const info2 = (await registry.list())[0]!;

    expect(info2.log.join("\n")).toContain("publishing with [redacted] to #launches");
    expect(info2.log.join("\n")).toContain("afterPublish failed: failed using [redacted]");
    expect(lines.join("\n")).not.toContain(SECRET);
  });

  it("lets the environment win, but never hands a plugin the engine's own variables", async () => {
    const env = { SECRETIVE_TOKEN: "", ANTHROPIC_API_KEY: "sk-ant-should-never-reach-a-plugin-000", GALLEY_PASSWORD: "hunter2hunter2" };
    const { registry } = registryIn(tempDir("plugins-home-"), env);
    let seen: string | undefined = "unset";

    registry.register(
      definePlugin({ ...secretPlugin, hooks: { afterPublish: (ctx) => void (seen = ctx.settings.token) } }),
      { source: "user" }
    );
    await registry.start();
    await registry.afterPublish({ id: "s", root: "/nowhere" } as never, { ok: true, files: [], pushed: false });
    await registry.settled();
    expect(seen).toBeUndefined();

    const withEnv = registryIn(tempDir("plugins-home-"), { SECRETIVE_TOKEN: SECRET }).registry;

    withEnv.register(secretPlugin, { source: "user" });
    expect((await withEnv.list())[0]!.settings[0]).toMatchObject({ configured: true, source: "env", hint: "fXYZ" });
    await expect(withEnv.saveSettings("galley-plugin-secretive", { token: "other-value-123456" })).rejects.toMatchObject({ message: expect.stringContaining("set by the environment") });
  });
});

describe("hooks around a real publish", () => {
  async function siteWithHooks(registry: PluginRegistry) {
    const root = makeSite();
    const { site } = await openSite(root);

    return { root, site: withSiteHooks(site, registry) };
  }

  it("runs hooks in order, stops a publish on a refusal with its message, and changes nothing", async () => {
    const { registry } = registryIn();
    const order: string[] = [];

    registry.register(definePlugin({ name: "galley-plugin-first", apiVersion: PLUGIN_API_VERSION, hooks: { beforePublish: () => void order.push("builtin") } }), { source: "builtin" });
    registry.register(
      definePlugin({
        name: "galley-plugin-guard",
        displayName: "Spelling guard",
        apiVersion: PLUGIN_API_VERSION,
        hooks: {
          beforePublish(_ctx, changes) {
            order.push(`user:${changes.files.map((file) => file.path).join(",")}`);
            return { refuse: "“Teh” is spelled wrong on the home page." };
          },
        },
      }),
      { source: "user" }
    );
    registry.register(definePlugin({ name: "galley-plugin-after", apiVersion: PLUGIN_API_VERSION, hooks: { beforePublish: () => void order.push("never") } }), { source: "user" });
    await registry.start();
    const { root, site } = await siteWithHooks(registry);

    writeFileSync(join(root, HOME), `${readFileSync(join(root, HOME), "utf8")}\nTeh end.\n`);
    const before = (await site.history()).length;
    const result = await site.publish();

    expect(result).toMatchObject({ ok: false, pushed: false, files: [], error: "Spelling guard stopped this publish: “Teh” is spelled wrong on the home page." });
    expect(order).toEqual(["builtin", `user:${HOME}`]);
    expect((await site.history()).length).toBe(before);
    expect((await site.changes()).files.map((file) => file.path)).toEqual([HOME]);
  });

  it("shows a before hook's warnings ahead of a publish, then publishes with them, naming the plugin", async () => {
    const { registry } = registryIn();

    registry.register(
      definePlugin({
        name: "galley-plugin-shop-check",
        displayName: "Shop check",
        apiVersion: PLUGIN_API_VERSION,
        hooks: {
          beforePublish: (_ctx, changes) => ({ warnings: changes.files.map((file) => `“${file.path}” shows a product the shop no longer has.`) }),
        },
      }),
      { source: "user" }
    );
    registry.register(definePlugin({ name: "galley-plugin-quiet", apiVersion: PLUGIN_API_VERSION, hooks: { beforePublish: () => ({ warnings: [" ", 3 as unknown as string] }) } }), { source: "user" });
    await registry.start();
    const { root, site } = await siteWithHooks(registry);
    const warning = { plugin: "Shop check", message: `“${HOME}” shows a product the shop no longer has.` };

    expect(await checkPublish(site, registry)).toEqual({ warnings: [], refusal: null });
    writeFileSync(join(root, HOME), `${readFileSync(join(root, HOME), "utf8")}\nA new line.\n`);
    const before = (await site.history()).length;

    // Asking ahead changes nothing; empty and non-text warnings are dropped.
    expect(await checkPublish(site, registry)).toEqual({ warnings: [warning], refusal: null });
    expect((await site.history()).length).toBe(before);
    const result = await site.publish({ message: "Add a line" });

    expect(result).toMatchObject({ ok: true, warnings: [warning] });
    expect((await site.history()).length).toBe(before + 1);
    // A real site, two publish checks and a publish: about 10 s alone, more when the whole suite runs at once.
  }, 90_000);

  it("publishes when a before hook throws or an after hook fails, and reports both", async () => {
    const { registry } = registryIn();
    const seen: PublishResult[] = [];

    registry.register(
      definePlugin({
        name: "galley-plugin-flaky",
        apiVersion: PLUGIN_API_VERSION,
        hooks: {
          beforePublish() {
            throw new Error("spell checker offline");
          },
          async afterPublish(ctx, result) {
            seen.push(result);
            // Hooks get a site they can read but not change.
            await ctx.site.discard();
          },
        },
      }),
      { source: "user" }
    );
    await registry.start();
    const { root, site } = await siteWithHooks(registry);

    writeFileSync(join(root, HOME), `${readFileSync(join(root, HOME), "utf8")}\nA new line.\n`);
    const result = await site.publish({ message: "Add a line" });

    expect(result.ok).toBe(true);
    await registry.settled();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.commit).toBe(result.commit);
    const log = (await registry.list())[0]!.log.join("\n");

    expect(log).toContain("beforePublish failed: spell checker offline");
    expect(log).toContain("afterPublish failed: A plugin hook (galley-plugin-flaky) can read the site but not change it.");
  });
});

describe("built-ins that are optional", () => {
  it("register the WordPress importer only when its package can be loaded, with its command", async () => {
    expect(await wordpressImporterPlugin(async () => Promise.reject(new Error("Cannot find package")))).toBeNull();
    // A variable specifier, as in the engine: the importer is optional, so nothing may depend on it statically.
    const source = new URL("../../../import-wordpress/src/index.ts", import.meta.url).href;
    const plugin = await wordpressImporterPlugin(() => import(source));
    const { registry } = registryIn();

    registry.register(plugin, { source: "builtin" });
    expect(registry.importers()).toEqual([expect.objectContaining({ id: "wordpress", name: "WordPress", input: "url-or-file", command: true, plugin: "@galley/import-wordpress" })]);
    const out: string[] = [];
    const code = await registry.importer("wordpress")!.command!.run(["--help"], { out: (line = "") => out.push(line), err: () => {}, cwd: tempDir("wp-"), env: {} });

    expect(code).toBe(0);
    // The importer's own help, word for word: the command prints what the package says, not a copy kept here.
    const { IMPORT_HELP } = (await import(source)) as { IMPORT_HELP: string };

    expect(out.join("\n")).toContain(IMPORT_HELP.split("\n")[0]);
    expect(out.join("\n")).toContain("import wordpress");
  });
});
