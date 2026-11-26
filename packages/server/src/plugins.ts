/**
 * The plugin system as a server (or `galley mcp`, or `galley plugin list`)
 * assembles it: the engine's built-ins, the first-party plugins that ship
 * with the app (OpenRouter, the WordPress importer), then everything installed in `<home>/plugins`. A site's own
 * plugins join per site, when it is opened (see @galley/core/plugins site.ts).
 */
import { PRODUCT, SITE_URL, VERSION } from "@galley/core/brand";
import type { GalleySettingsService, SecretStore } from "@galley/core/ai";
import {
  createBuiltinPlugin,
  createPluginRegistry,
  createPluginSettingsStore,
  loadInstalledPlugins,
  wordpressImporterPlugin,
  type GalleyPlugin,
  type PluginRegistry,
} from "@galley/core/plugins";
import { createOpenRouterPlugin, OPENROUTER_API } from "@galley/plugin-openrouter";
import { shopifyPlugin } from "@galley/plugin-shopify";

/** Plugins written against the public kit and shipped with the app; they can be turned off like any other. */
export function firstPartyPlugins(env?: NodeJS.ProcessEnv): GalleyPlugin[] {
  const openrouter = createOpenRouterPlugin({
    baseUrl: () => env?.GALLEY_OPENROUTER_BASE_URL?.trim() || process.env.GALLEY_OPENROUTER_BASE_URL?.trim() || OPENROUTER_API,
  });

  return [openrouter, shopifyPlugin];
}

export interface PluginSystemOptions {
  home: string;
  env: NodeJS.ProcessEnv;
  settings: GalleySettingsService;
  secrets: SecretStore;
  log?: (line: string) => void;
  fetch?: typeof fetch;
  productName?: string;
  /** Skip loading `<home>/plugins` (GALLEY_DISABLE_USER_PLUGINS=1 does the same). */
  installed?: boolean;
  /**
   * Told the environment variables every plugin registered (built in,
   * installed, or a site's own, later) names for its secret settings — so a
   * hosted install hides them from the site's own commands too.
   */
  onSecretEnv?: (names: string[]) => void;
}

/** The environment variables a plugin's secret settings are read from. Read defensively: the plugin hasn't been checked yet. */
export function secretEnvNames(plugin: unknown): string[] {
  const settings = (plugin as { settings?: unknown } | null)?.settings;

  if (!Array.isArray(settings)) return [];
  return settings.flatMap((field: unknown) => {
    const { secret, env } = (field ?? {}) as { secret?: unknown; env?: unknown };

    return secret === true && Array.isArray(env) ? env.filter((name): name is string => typeof name === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) : [];
  });
}

export async function createPluginSystem(options: PluginSystemOptions): Promise<PluginRegistry> {
  const plugins = createPluginRegistry({
    home: options.home,
    settings: createPluginSettingsStore({
      home: options.home,
      env: options.env,
      secrets: options.secrets,
      // The app's own keys keep the checks Settings applies to them.
      setBuiltinSecret: (name, value) => options.settings.setSecret(name, value),
    }),
    brand: { productName: options.productName ?? PRODUCT.name, slug: PRODUCT.slug, version: VERSION, siteUrl: SITE_URL },
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.log ? { log: options.log } : {}),
  });

  if (options.onSecretEnv) {
    const register = plugins.register.bind(plugins);
    const notify = options.onSecretEnv;

    // Every registration goes through here, a site's own plugins (registered later, as the site opens) included.
    plugins.register = (plugin, registerOptions) => {
      const names = secretEnvNames(plugin);

      if (names.length > 0) notify(names);
      return register(plugin, registerOptions);
    };
  }
  plugins.register(createBuiltinPlugin(options.env), { source: "builtin", required: true, location: "built in" });
  for (const plugin of firstPartyPlugins(options.env)) plugins.register(plugin, { source: "builtin", location: "ships with the app" });
  // A literal specifier, so the CLI bundle (and the desktop sidecar, which runs it) carries the importer inside it.
  const wordpress = await wordpressImporterPlugin(() => import("@galley/import-wordpress"));

  if (wordpress) plugins.register(wordpress, { source: "builtin", location: "ships with the app" });
  const off = options.env.GALLEY_DISABLE_USER_PLUGINS;

  if (options.installed !== false && !(off && /^(1|true|yes|on)$/i.test(off.trim()))) await loadInstalledPlugins(plugins, options.home);
  await plugins.start();
  return plugins;
}
