/**
 * The plugin registry in use by this process, for the two places that are
 * module-level by design: site detection (content/config) and the
 * assistant's tool list (ai/tools). Both existed before plugins and take no
 * engine object to pass one through, and a process runs one engine — so the
 * composer (the server, `galley mcp`) sets it once at start-up. With none set,
 * both behave exactly as they did before plugins.
 */
import type { GalleyAdapter } from "../adapter/types";
import type { AssistantTool } from "../ai/tools/types";

export interface ActivePlugins {
  /** Enabled plugins' adapters, most specific first (the site's own, then installed). Built-in adapters are not included. */
  adapters(siteRoot: string | null): readonly GalleyAdapter[];
  /** Enabled plugins' tools, adapted to registry tools. */
  tools(siteRoot: string | null): readonly AssistantTool[];
}

let active: ActivePlugins | null = null;

/** Returns a function that unsets it again (only if it is still the one set). */
export function setActivePlugins(plugins: ActivePlugins | null): () => void {
  active = plugins;
  return () => {
    if (active === plugins) active = null;
  };
}

export function activePlugins(): ActivePlugins | null {
  return active;
}

let hosted = false;

/**
 * Hosted mode (a shared server people sign in to): a site's own plugins and
 * adapters are not loaded unless the operator sets GALLEY_ALLOW_SITE_PLUGINS=1,
 * because anyone who can open a site there would otherwise run code on it.
 */
export function setHostedMode(value: boolean): void {
  hosted = value;
}

export function hostedMode(): boolean {
  return hosted;
}
