/**
 * The plugin list — the app's, or a site's (which adds the plugins that
 * site names) — and the two things done to it: turning a plugin on or off,
 * saving its settings. Both answer with the plugin's new state, which is put
 * into every list on screen at once; the `plugins.updated` event that
 * follows refreshes them from the server (lib/sync.ts).
 */
import type { PluginList } from "@galley/core/api";
import type { PluginInfo } from "@galley/core/types";
import { api } from "@/lib/api";
import { getQueryState, setQueryData, useQuery, type QueryKey } from "@/lib/query";
import { keys } from "@/lib/sync";

/** The list keys read so far, so a mutation's answer can patch each one. */
const listKeys = new Map<string, QueryKey>();

export function usePluginList(siteId?: string) {
  const key = keys.plugins(siteId);
  listKeys.set(JSON.stringify(key), key);
  return useQuery<PluginList>(key, () => (siteId ? api("GET /api/sites/:siteId/plugins", { params: { siteId } }) : api("GET /api/plugins")), {
    // A changed settings file can name or drop a site's plugins.
    ...(siteId ? { deps: [keys.site(siteId)] } : {}),
  });
}

/** Put a plugin's new state into every list that shows it. */
export function applyPluginInfo(info: PluginInfo): void {
  for (const key of listKeys.values()) {
    const list = getQueryState<PluginList>(key).data;
    if (!list || !list.plugins.some((plugin) => plugin.name === info.name)) continue;
    setQueryData<PluginList>(key, { ...list, plugins: list.plugins.map((plugin) => (plugin.name === info.name ? { ...info, ...(plugin.siteId && !info.siteId ? { siteId: plugin.siteId } : {}) } : plugin)) });
  }
}

export async function setPluginEnabled(plugin: PluginInfo, enabled: boolean, siteId?: string): Promise<PluginInfo> {
  const info = await api("POST /api/plugins/enabled", { body: { name: plugin.name, enabled, ...(siteId ? { siteId } : {}) } });
  applyPluginInfo(info);
  return info;
}
