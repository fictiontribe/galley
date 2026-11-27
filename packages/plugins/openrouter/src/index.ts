/**
 * @galley/plugin-openrouter — image and video generation through OpenRouter,
 * written against @galleycms/plugin-kit only, exactly the way a third party
 * writes a plugin. One key (the "openrouter" secret, or OPENROUTER_API_KEY)
 * reaches every image and video model OpenRouter routes to; the model lists
 * and prices come from OpenRouter's own catalogue at run time.
 */
import { definePlugin, PLUGIN_API_VERSION, type GalleyPlugin } from "@galleycms/plugin-kit";
import { OPENROUTER_API, resolveBaseUrl, type BaseUrlOption } from "./client";
import { createImageCatalogue, imageProvider } from "./images";
import { createVideoCatalogue, videoProvider } from "./videos";

export interface OpenRouterOptions {
  /** API origin or dynamic getter; tests point it at a fake and managed hosts may switch it live. */
  baseUrl?: BaseUrlOption;
  /** How long a fetched model list is kept. Default one hour. */
  cacheMs?: number;
  now?: () => number;
}

export const OPENROUTER_PLUGIN_NAME = "@galley/plugin-openrouter";

// #region settings
const settings = [
  {
    key: "apiKey",
    label: "OpenRouter API key",
    help: "Create one at openrouter.ai › Keys. Images and videos are paid from that account's credit.",
    secret: true,
    required: true,
    pattern: "^sk-or-[A-Za-z0-9_-]{16,}$",
    placeholder: "sk-or-v1-…",
    // The one name this key has everywhere in the app; the environment wins over what is saved.
    secretName: "openrouter",
    env: ["OPENROUTER_API_KEY"],
  },
];
// #endregion settings

export function createOpenRouterPlugin(options: OpenRouterOptions = {}): GalleyPlugin {
  const baseUrl = () => resolveBaseUrl(options.baseUrl);
  const cache = { baseUrl, cacheMs: options.cacheMs ?? 60 * 60_000, now: options.now ?? Date.now };

  return definePlugin({
    name: OPENROUTER_PLUGIN_NAME,
    displayName: "OpenRouter",
    description: "Make images and videos with the models OpenRouter offers, on one OpenRouter key.",
    version: "0.1.0",
    apiVersion: PLUGIN_API_VERSION,
    settings,
    imageProviders: [imageProvider(createImageCatalogue(cache), { baseUrl })],
    videoProviders: [videoProvider(createVideoCatalogue(cache), { baseUrl })],
  });
}

export const openrouterPlugin = createOpenRouterPlugin();
export default openrouterPlugin;

export { OPENROUTER_API, classify } from "./client";
export { aspectFor, DEFAULT_IMAGE_MODEL, FALLBACK_IMAGE_MODELS, priceFrom, recordFrom, resolutionFor } from "./images";
export { DEFAULT_VIDEO_MODEL, FALLBACK_VIDEO_MODELS, videoPrice, videoRecordFrom } from "./videos";
