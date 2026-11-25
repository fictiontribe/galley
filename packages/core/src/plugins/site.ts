/**
 * Plugins (and adapters) a site's galley.config.json names. Loading them runs
 * code from the site's repository inside this process — the same trust the
 * site already gets when its dev server starts — so:
 *
 *   - only what the config names is loaded, only from inside the site folder
 *     or its own node_modules (never a parent's, never a global install);
 *   - GALLEY_DISABLE_SITE_PLUGINS=1 turns site plugins off (and site adapters
 *     with them; GALLEY_DISABLE_SITE_ADAPTERS=1 still turns off adapters alone);
 *   - on a hosted server they are off unless the operator sets
 *     GALLEY_ALLOW_SITE_PLUGINS=1.
 *
 * Nothing here throws: every problem becomes a note on the site or a
 * problem on the plugin's entry in the list.
 */
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { loadSiteAdapters, resolveSpecifier } from "../adapter/load";
import type { GalleyAdapter } from "../adapter/types";
import { BUILTIN_ADAPTERS } from "../adapters/index";
import { PRODUCT } from "../brand";
import { GalleyError } from "../errors";
import { SITE_CLOSED } from "../workspace/closed";
import type { GalleyConfig } from "../types";
import { activePlugins, hostedMode } from "./active";
import { PLUGIN_API_VERSION } from "./define";
import type { PluginRegistry } from "./registry";
import type { GalleyPlugin } from "./types";
import { pluginFromModule, validatePlugin } from "./validate";

const flag = (value: string | undefined) => value !== undefined && /^(1|true|yes|on)$/i.test(value.trim());

export type SitePluginPolicy = { allowed: true } | { allowed: false; reason: string };

/** Whether this process may load code a site names, and if not, why — in words for the site's notes. */
export function sitePluginPolicy(env: NodeJS.ProcessEnv = process.env): SitePluginPolicy {
  if (flag(env.GALLEY_DISABLE_SITE_PLUGINS)) return { allowed: false, reason: "site plugins are turned off (GALLEY_DISABLE_SITE_PLUGINS)" };
  if (hostedMode() && !flag(env.GALLEY_ALLOW_SITE_PLUGINS)) {
    return { allowed: false, reason: "this is a shared server, where a site's own code only runs when the operator allows it (GALLEY_ALLOW_SITE_PLUGINS=1)" };
  }
  return { allowed: true };
}

function listOf(items: string[]): string {
  return items.map((item) => `“${item}”`).join(", ");
}

/** Imports one plugin the config names. A string is the reason it couldn't be. */
export async function importSitePlugin(root: string, specifier: string): Promise<{ plugin: unknown } | string> {
  const resolved = resolveSpecifier(root, specifier, "plugins");

  if (typeof resolved === "string") return resolved;
  try {
    return { plugin: pluginFromModule(await import(resolved.url)) };
  } catch (error) {
    return `it could not be loaded (${error instanceof Error ? error.message.split("\n")[0] : String(error)})`;
  }
}

export interface SiteExtensions {
  adapters: GalleyAdapter[];
  notes: string[];
}

/**
 * The adapters detection should consider for a site, most specific first:
 * the ones its config names (`adapters`, and `plugins` that contribute
 * adapters), then those of plugins installed for this user or server. The
 * built-in adapters are added by detection itself.
 */
export async function siteExtensions(root: string, config: GalleyConfig | null, env: NodeJS.ProcessEnv = process.env): Promise<SiteExtensions> {
  const notes: string[] = [];
  const adapters: GalleyAdapter[] = [];
  const named = [...(config?.adapters ?? []), ...(config?.plugins ?? [])];
  const policy = sitePluginPolicy(env);

  if (!policy.allowed && named.length) {
    notes.push(`${listOf(named)} in ${PRODUCT.configFile} ${named.length === 1 ? "was" : "were"} not loaded: ${policy.reason}. The built-in adapters were used.`);
  } else if (policy.allowed) {
    const loaded = await loadSiteAdapters(root, config?.adapters ?? [], env);

    adapters.push(...loaded.adapters);
    notes.push(...loaded.notes);
    for (const specifier of config?.plugins ?? []) {
      const imported = await importSitePlugin(root, specifier);

      // Problems with a site plugin are reported on the Plugins screen; detection only needs its adapters.
      if (typeof imported === "string") continue;
      const check = validatePlugin(imported.plugin, specifier);

      if (!check.ok) continue;
      for (const adapter of check.plugin.adapters ?? []) {
        if (adapters.some((other) => other.id === adapter.id)) continue;
        adapters.push(adapter);
        notes.push(`Loaded the ${adapter.name} adapter from the plugin ${specifier}.`);
      }
    }
  }
  for (const adapter of activePlugins()?.adapters(null) ?? []) {
    if (!BUILTIN_ADAPTERS.includes(adapter) && !adapters.some((other) => other.id === adapter.id)) adapters.push(adapter);
  }
  return { adapters, notes };
}

/** An entry of `adapters` as a plugin contributing one adapter, so the Plugins screen lists it like the rest. */
function adapterPlugin(adapter: GalleyAdapter): GalleyPlugin {
  return {
    name: `site-adapter-${adapter.id}`,
    displayName: `${adapter.name} adapter`,
    description: "An adapter this site's configuration names.",
    apiVersion: PLUGIN_API_VERSION,
    adapters: [adapter],
  };
}

const loadedAt = new WeakMap<PluginRegistry, Map<string, Promise<void> & { stamp?: string }>>();

async function configStamp(root: string): Promise<string> {
  try {
    const info = await stat(join(root, PRODUCT.configFile));

    return `${info.mtimeMs}:${info.size}`;
  } catch {
    return "none";
  }
}

/**
 * Registers the plugins (and adapters) a site names into the registry's
 * layer for that site, again whenever its config file changes. Cheap to
 * call often: it only stats the config file when nothing changed.
 */
export async function ensureSitePlugins(
  registry: PluginRegistry,
  site: { root: string; id: string; readConfig(): Promise<GalleyConfig | null> },
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  let perSite = loadedAt.get(registry);

  if (!perSite) loadedAt.set(registry, (perSite = new Map()));
  const stamp = `${await configStamp(site.root)}|${JSON.stringify(sitePluginPolicy(env))}`;
  const current = perSite.get(site.root);

  if (current && current.stamp === stamp) return current;
  // Made and noted at once, with nothing awaited in between, so two callers never load the same plugins side by side.
  let load!: Promise<void> & { stamp?: string };

  load = (async () => {
    await current?.catch(() => undefined);
    // Read before anything is let go: a site that was closed refuses (SITE_CLOSED), and that is not the settings naming no
    // plugins. Nothing is changed then, and the load before is put back, so the site opened next loads them itself.
    let config: GalleyConfig | null;

    try {
      config = await site.readConfig();
    } catch (error) {
      if (error instanceof GalleyError && error.message === SITE_CLOSED) {
        if (perSite.get(site.root) === load) {
          if (current) perSite.set(site.root, current);
          else perSite.delete(site.root);
        }
        return;
      }
      config = null;
    }
    await registry.removeSite(site.root);
    const named = { adapters: config?.adapters ?? [], plugins: config?.plugins ?? [] };

    if (named.adapters.length === 0 && named.plugins.length === 0) return;
    const policy = sitePluginPolicy(env);
    const base = { source: "site" as const, siteRoot: site.root, siteId: site.id };

    if (!policy.allowed) {
      for (const specifier of [...named.adapters, ...named.plugins]) {
        registry.registerFailure(specifier, `${specifier} in ${PRODUCT.configFile} was not loaded: ${policy.reason}.`, { ...base, location: specifier });
      }
      return;
    }
    const adapters = await loadSiteAdapters(site.root, named.adapters, env);

    for (const adapter of adapters.adapters) registry.register(adapterPlugin(adapter), { ...base, location: `“adapters” in ${PRODUCT.configFile}` });
    for (const specifier of named.plugins) {
      const imported = await importSitePlugin(site.root, specifier);

      if (typeof imported === "string") {
        registry.registerFailure(specifier, `The plugin ${specifier} in ${PRODUCT.configFile} was skipped: ${imported}.`, { ...base, location: specifier });
        continue;
      }
      registry.register(imported.plugin, { ...base, location: specifier });
    }
    await registry.start();
  })() as Promise<void> & { stamp?: string };
  load.stamp = stamp;
  perSite.set(site.root, load);
  return load;
}
