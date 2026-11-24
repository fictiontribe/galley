/** One plain paragraph saying what a plugin adds — for a README, a listing, or `galley plugin list`. */
import type { GalleyPlugin } from "@galley/core/plugins";

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function summarizePlugin(plugin: GalleyPlugin): string {
  const parts: string[] = [];
  const list = <T>(items: T[] | undefined, one: string, many: string | undefined, name: (item: T) => string) => {
    if (items?.length) parts.push(`${count(items.length, one, many)} (${items.map(name).join(", ")})`);
  };

  list(plugin.adapters, "framework adapter", undefined, (item) => item.name);
  list(plugin.imageProviders, "image provider", undefined, (item) => item.label);
  list(plugin.videoProviders, "video provider", undefined, (item) => item.label);
  list(plugin.formProviders, "form destination", undefined, (item) => item.name);
  list(plugin.scriptIntegrations, "script integration", undefined, (item) => item.name);
  list(plugin.importers, "importer", undefined, (item) => item.name);
  list(plugin.deployTargets, "deploy target", undefined, (item) => item.name);
  list(plugin.editorHosts, "editor host", undefined, (item) => item.info?.name || item.name);
  list(plugin.tools, "assistant tool", undefined, (item) => `${item.name}${item.effect.readOnly ? ", read-only" : ""}`);
  const hooks = Object.keys(plugin.hooks ?? {});

  if (hooks.length) parts.push(`${count(hooks.length, "hook")} (${hooks.join(", ")})`);
  const settings = plugin.settings ?? [];
  const head = `${plugin.displayName ?? plugin.name}${plugin.version ? ` ${plugin.version}` : ""}`;
  const adds = parts.length ? `adds ${parts.join("; ")}` : "adds nothing yet";
  const asks = settings.length ? ` It asks for ${count(settings.length, "setting")}${settings.some((field) => field.secret) ? `, ${count(settings.filter((field) => field.secret).length, "secret")} among them` : ""}.` : "";

  return `${head} ${adds}.${asks}`;
}
