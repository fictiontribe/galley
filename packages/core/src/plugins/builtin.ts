/**
 * Everything the engine ships, as plugins registered through the same
 * registry as anyone else's — the proof that the public API is enough. If a
 * built-in ever needs a private door, the API is missing something.
 *
 *   @galley/builtin             the framework adapters, the mock/OpenAI/Google
 *                               image providers, the form destinations and
 *                               script integrations of the kit catalogue, and
 *                               the Cloudflare and Vercel deploy targets
 *   @galley/import-wordpress    the WordPress importer, when that package is installed
 */
import { BUILTIN_ADAPTERS } from "../adapters/index";
import { createCloudflareTarget } from "../deploy/cloudflare";
import { createVercelTarget } from "../deploy/vercel";
import { createCloudflareEditorHost } from "../hosting/cloudflare";
import { createFlyHost } from "../hosting/fly";
import { createOwnServerHost } from "../hosting/own-server";
import { PRODUCT, VERSION } from "../brand";
import { FORM_PROVIDERS, SCRIPT_INTEGRATIONS } from "../kit-catalog";
import { IMAGE_CATALOG, type ProviderCatalogEntry } from "../ai/images/catalog";
import { googleProvider } from "../ai/images/google";
import { mockProvider } from "../ai/images/mock";
import { openaiProvider } from "../ai/images/openai";
import type { ImageProvider } from "../ai/images/provider";
import { SECRET_ENV } from "../ai/secrets";
import { PLUGIN_API_VERSION } from "./define";
import type { GalleyPlugin, ImageProviderPlugin, ImporterContribution, ImporterIo } from "./types";

export const BUILTIN_PLUGIN_NAME = "@galley/builtin";

const INTERNAL: Record<ProviderCatalogEntry["id"], ImageProvider> = { mock: mockProvider, openai: openaiProvider, google: googleProvider };
const KEY_LABELS: Record<"openai" | "google", string> = { openai: "OpenAI API key", google: "Google AI API key" };

function builtinImageProvider(entry: ProviderCatalogEntry): ImageProviderPlugin {
  const internal = INTERNAL[entry.id];

  return {
    id: entry.id,
    label: entry.label,
    ...(entry.secret ? { keySetting: entry.secret } : {}),
    models: () => entry.models,
    defaultModel: entry.defaultModel,
    supportsReferences: entry.supportsReferences,
    supportsTransparency: entry.supportsTransparency,
    generate: (request, ctx) => internal.generate({ ...request, ...(ctx.signal ? { signal: ctx.signal } : {}) }, ctx.key, ctx.fetch),
  };
}

export const builtinPlugin: GalleyPlugin = {
  name: BUILTIN_PLUGIN_NAME,
  displayName: `${PRODUCT.name} built-ins`,
  description: "The framework adapters, image providers, form destinations and script integrations that come with the app.",
  version: VERSION,
  apiVersion: PLUGIN_API_VERSION,
  adapters: [...BUILTIN_ADAPTERS],
  imageProviders: IMAGE_CATALOG.map(builtinImageProvider),
  formProviders: FORM_PROVIDERS,
  scriptIntegrations: SCRIPT_INTEGRATIONS,
  deployTargets: [createCloudflareTarget(), createVercelTarget()],
  editorHosts: [createFlyHost(), createCloudflareEditorHost(), createOwnServerHost()],
  // The app's own image keys keep their names and environment variables.
  settings: (["openai", "google"] as const).map((name) => ({
    key: name,
    label: KEY_LABELS[name],
    secret: true,
    secretName: name,
    env: [...SECRET_ENV[name]],
  })),
};

interface WordPressModule {
  importCommand?: { run(args: string[], io: ImporterIo): Promise<number> };
  IMPORT_HELP?: string;
}

/**
 * The WordPress importer as a plugin, when its package can be loaded from
 * here. The specifier is a variable so bundlers leave the import alone: the
 * importer is optional, and a bundle without it simply doesn't offer it.
 */
export async function wordpressImporterPlugin(load: (specifier: string) => Promise<unknown> = (specifier) => import(specifier)): Promise<GalleyPlugin | null> {
  const specifier = ["@galley", "import-wordpress"].join("/");
  let module: WordPressModule;

  try {
    module = (await load(specifier)) as WordPressModule;
  } catch {
    return null;
  }
  const command = module.importCommand;
  const importer: ImporterContribution = {
    id: "wordpress",
    name: "WordPress",
    description: "Posts, pages, images and SEO details from a WordPress site (its address or an export file), as pending changes to proof.",
    input: "url-or-file",
    ...(command && typeof module.IMPORT_HELP === "string"
      ? { command: { help: module.IMPORT_HELP, run: (argv: string[], io: ImporterIo) => command.run(["wordpress", ...argv], io) } }
      : {}),
  };

  return {
    name: specifier,
    displayName: "WordPress importer",
    description: importer.description,
    version: VERSION,
    apiVersion: PLUGIN_API_VERSION,
    importers: [importer],
  };
}
