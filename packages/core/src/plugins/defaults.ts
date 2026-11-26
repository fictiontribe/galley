/**
 * The built-in plugin's providers without a registry — what ImageService and
 * Settings use when the composer gave them no provider list (tests, an
 * embedded engine). They go through the same adapter as a registry would,
 * so the two paths can't behave differently.
 */
import { PRODUCT, SITE_URL, VERSION } from "../brand";
import type { ImageProviderHandle } from "../ai/images/providers";
import { imageHandle, type ContributionOwner } from "./adapt";
import { builtinPlugin, createBuiltinPlugin } from "./builtin";
import type { PluginContext } from "./types";

let cached: ImageProviderHandle[] | null = null;

const quiet = { info() {}, warn() {}, error() {} };

function buildHandles(plugin: ReturnType<typeof createBuiltinPlugin>): ImageProviderHandle[] {
  const context = async (): Promise<PluginContext> => ({
    plugin: { name: plugin.name, version: plugin.version ?? null },
    settings: Object.freeze({}),
    log: quiet,
    fetch: (input, init) => fetch(input, init),
    brand: { productName: PRODUCT.name, slug: PRODUCT.slug, version: VERSION, siteUrl: SITE_URL },
  });
  const owner: ContributionOwner = {
    name: plugin.name,
    trusted: true,
    fields: plugin.settings ?? [],
    context,
    // Every built-in key is one of the app's own, read through Settings; nothing reaches here.
    secret: () => ({ configured: async () => false, read: async () => null }),
  };

  return (plugin.imageProviders ?? []).map((provider) => imageHandle(provider, owner));
}

export function builtinImageHandles(env?: NodeJS.ProcessEnv): ImageProviderHandle[] {
  if (env) return buildHandles(createBuiltinPlugin(env));
  if (cached) return cached;
  cached = buildHandles(builtinPlugin);
  return cached;
}
