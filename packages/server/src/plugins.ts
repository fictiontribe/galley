/**
 * The plugin system as a server (or `galley mcp`, or `galley plugin list`)
 * assembles it: the engine's built-ins, the first-party plugins that ship
 * with the app (OpenRouter, the WordPress importer), then everything installed in `<home>/plugins`. A site's own
 * plugins join per site, when it is opened (see @galley/core/plugins site.ts).
 */
import { PRODUCT, SITE_URL, VERSION } from "@galley/core/brand";
import type { GalleySettingsService, SecretStore } from "@galley/core/ai";
import {
  builtinPlugin,
  createPluginRegistry,
  createPluginSettingsStore,
  loadInstalledPlugins,
  wordpressImporterPlugin,
  type GalleyPlugin,
  type PluginRegistry,
} from "@galley/core/plugins";
import { openrouterPlugin } from "@galley/plugin-openrouter";
import { shopifyPlugin } from "@galley/plugin-shopify";

/** Plugins written against the public kit and shipped with the app; they can be turned off like any other. */
export function firstPartyPlugins(): GalleyPlugin[] {
  return [openrouterPlugin, shopifyPlugin];
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

  plugins.register(builtinPlugin, { source: "builtin", required: true, location: "built in" });
  for (const plugin of firstPartyPlugins()) plugins.register(plugin, { source: "builtin", location: "ships with the app" });
  // A literal specifier, so the CLI bundle (and the desktop sidecar, which runs it) carries the importer inside it.
  const wordpress = await wordpressImporterPlugin(() => import("@galley/import-wordpress"));

  if (wordpress) plugins.register(wordpress, { source: "builtin", location: "ships with the app" });
  const off = options.env.GALLEY_DISABLE_USER_PLUGINS;

  if (options.installed !== false && !(off && /^(1|true|yes|on)$/i.test(off.trim()))) await loadInstalledPlugins(plugins, options.home);
  await plugins.start();
  return plugins;
}
