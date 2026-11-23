/**
 * The catalogues the pickers choose from — form destinations and script
 * integrations — merged from every plugin active for the site, from
 * `GET /api/sites/:siteId/catalog`. While the server can't be asked (or is
 * an older one without the route) the built-in catalogue is used, so the
 * pickers always work.
 *
 * The last catalogue read is also kept in a small store, so the synchronous
 * lookups the form builder and the scripts list already make by id
 * (`providerInfo`, `integrationOf`) can find plugin entries without each
 * caller fetching.
 */
import { create } from "zustand";
import type { PluginCatalog } from "@galley/core/api";
import type { ScriptEntry, ScriptIntegrationInfo } from "@galley/core/kit";
import { FORM_PROVIDERS, SCRIPT_INTEGRATIONS } from "@galley/core/kit-catalog";
import type { JsonValue } from "@galley/core/types";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/query";
import { keys } from "@/lib/sync";

/** The engine's own plugin: its entries are the built-in catalogue, not "from a plugin". */
export const BUILTIN_PLUGIN = "@galley/builtin";

export type CatalogFormProvider = PluginCatalog["formProviders"][number];
export type CatalogScript = PluginCatalog["scriptIntegrations"][number];

interface CatalogStore {
  formProviders: CatalogFormProvider[];
  scriptIntegrations: CatalogScript[];
  /** Plugin name → the name people read (its displayName). */
  pluginNames: Record<string, string>;
  set: (catalog: Pick<PluginCatalog, "formProviders" | "scriptIntegrations">, names: Record<string, string>) => void;
}

const builtin = <T extends object>(items: readonly T[]) => items.map((item) => ({ ...item, plugin: BUILTIN_PLUGIN }));

export const useCatalogStore = create<CatalogStore>((set) => ({
  formProviders: builtin(FORM_PROVIDERS),
  scriptIntegrations: builtin(SCRIPT_INTEGRATIONS),
  pluginNames: {},
  set: (catalog, pluginNames) => set({ formProviders: catalog.formProviders, scriptIntegrations: catalog.scriptIntegrations, pluginNames }),
}));

/** A plugin's entry (not the built-in one) by id, from the last catalogue read. */
export function pluginFormProvider(id: string): CatalogFormProvider | null {
  return useCatalogStore.getState().formProviders.find((provider) => provider.id === id && provider.plugin !== BUILTIN_PLUGIN) ?? null;
}

export function pluginScriptIntegration(kind: string): CatalogScript | null {
  return useCatalogStore.getState().scriptIntegrations.find((integration) => integration.kind === kind && integration.plugin !== BUILTIN_PLUGIN) ?? null;
}

/** The name people read for a plugin, or its package name when the list hasn't said. */
export function pluginName(plugin: string): string {
  return useCatalogStore.getState().pluginNames[plugin] ?? plugin;
}

/** "From a plugin that isn't active: fathom" — what an id no active plugin offers is shown as, instead of breaking. */
export function inactiveKindLine(kind: string): string {
  return `From a plugin that isn’t active: ${kind}`;
}

export interface SiteCatalog {
  formProviders: CatalogFormProvider[];
  scriptIntegrations: CatalogScript[];
  /** Read from the server (false: the built-in catalogue, because it couldn't be). */
  live: boolean;
  nameOf: (plugin: string) => string;
}

/** The site's catalogue for the pickers, falling back to the built-in one. */
export function useSiteCatalog(siteId: string): SiteCatalog {
  const catalog = useQuery(
    keys.catalog(siteId),
    async () => {
      const result = await api("GET /api/sites/:siteId/catalog", { params: { siteId } });
      // The plugin list names each plugin; a server without it still has a usable catalogue.
      const list = await api("GET /api/sites/:siteId/plugins", { params: { siteId } }).catch(() => null);
      const names = Object.fromEntries((list?.plugins ?? []).map((plugin) => [plugin.name, plugin.displayName]));
      useCatalogStore.getState().set(result, names);
      return { result, names };
    },
    // A config change can name or drop a site plugin.
    { enabled: Boolean(siteId), deps: [keys.site(siteId), ["plugins"]] },
  );
  const fallback = useCatalogStore.getState();
  const data = catalog.data;
  return {
    formProviders: data?.result.formProviders ?? builtin(FORM_PROVIDERS),
    scriptIntegrations: data?.result.scriptIntegrations ?? builtin(SCRIPT_INTEGRATIONS),
    live: Boolean(data),
    nameOf: (plugin) => data?.names[plugin] ?? fallback.pluginNames[plugin] ?? plugin,
  };
}

/** Whether an integration carries its own snippet (a plugin's), so it is written as the runtime's "custom" kind. */
export function hasSnippet(integration: ScriptIntegrationInfo): integration is CatalogScript & { snippet: NonNullable<CatalogScript["snippet"]> } {
  return Boolean((integration as CatalogScript).snippet && (integration as CatalogScript).plugin !== BUILTIN_PLUGIN);
}

/**
 * The same filling-in the engine's `resolveScriptSnippet` does (the browser
 * can't import the engine's plugin module): `{{key}}` becomes the setting's
 * value — URL-encoded in an address, JSON-escaped in code, quote-escaped in
 * an attribute — so a value can never close the string it sits in.
 */
export function resolveSnippet(snippet: NonNullable<CatalogScript["snippet"]>, settings: Record<string, unknown>): { src?: string; inline?: string; attributes?: Record<string, string> } {
  const value = (key: string) => {
    const raw = settings[key];
    return raw === undefined || raw === null ? "" : String(raw);
  };
  const fill = (template: string, escape: (text: string) => string) => template.replace(/\{\{\s*([A-Za-z][\w-]*)\s*\}\}/g, (_whole, key: string) => escape(value(key)));
  const inline = (text: string) => JSON.stringify(text).slice(1, -1).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  const out: { src?: string; inline?: string; attributes?: Record<string, string> } = {};
  if (snippet.src) out.src = fill(snippet.src, encodeURIComponent);
  if (snippet.inline) out.inline = fill(snippet.inline, inline);
  if (snippet.attributes) out.attributes = Object.fromEntries(Object.entries(snippet.attributes).map(([name, template]) => [name, fill(template, (text) => text.replace(/"/g, "&quot;"))]));
  return out;
}

/**
 * A plugin's integration as an entry the site's runtime can load: the
 * runtime only writes its built-in kinds, so the filled-in snippet goes in as
 * a "custom" script labelled with the integration's name, with a note saying
 * where it came from.
 */
export function pluginScriptEntry(entry: ScriptEntry, integration: CatalogScript & { snippet: NonNullable<CatalogScript["snippet"]> }, pluginLabel: string): ScriptEntry {
  const resolved = resolveSnippet(integration.snippet, entry.settings);
  const settings: { [key: string]: JsonValue } = {};
  if (resolved.src) settings.src = resolved.src;
  if (resolved.inline) settings.inline = resolved.inline;
  if (resolved.attributes && Object.keys(resolved.attributes).length) settings.attributes = resolved.attributes;
  return { ...entry, kind: "custom", label: integration.name, settings, note: `Added from the plugin ${pluginLabel}.` };
}
