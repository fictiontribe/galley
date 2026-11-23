/**
 * Image providers, their model ids and what each can do — in one table,
 * because image model ids change often.
 *
 * Verified 2026-11-23 against:
 *   OpenAI  https://developers.openai.com/api/reference/resources/images
 *           https://developers.openai.com/api/docs/guides/image-generation
 *           ("For new integrations, use GPT-Image-2.6 Sunburst or Flare";
 *            gpt-image-1 was shut down on 2026-10-23)
 *   Google  https://aistudio.google.com/docs/image-generation
 *           https://aistudio.google.com/api-reference/interactions-api
 *           (Nano Banana 2.1 is the recommended model; image generation is on
 *            the Interactions API; Imagen models are shut down)
 *
 * Neither real provider has been exercised against the live service from this
 * codebase — only against scripted responses copied from those pages.
 */
import type { ImageAspect, ImageProviderInfo, SecretName } from "../../types";

export interface ProviderCatalogEntry {
  id: "mock" | "openai" | "google";
  label: string;
  /** null: needs no key. */
  secret: SecretName | null;
  models: Array<{ id: string; label: string }>;
  defaultModel: string;
  supportsReferences: boolean;
  supportsTransparency: boolean;
}

export const IMAGE_CATALOG: ProviderCatalogEntry[] = [
  {
    id: "mock",
    label: "Placeholder artwork (offline)",
    secret: null,
    models: [{ id: "abstract-svg", label: "Abstract placeholder" }],
    defaultModel: "abstract-svg",
    supportsReferences: false,
    supportsTransparency: false,
  },
  {
    id: "openai",
    label: "OpenAI",
    secret: "openai",
    models: [
      { id: "gpt-image-2.6-sunburst", label: "GPT Image 2.6 Sunburst" },
      { id: "gpt-image-2.6-flare", label: "GPT Image 2.6 Flare" },
      { id: "gpt-image-2.5-sunburst", label: "GPT Image 2.5 Sunburst" },
      { id: "gpt-image-2", label: "GPT Image 2" },
    ],
    defaultModel: "gpt-image-2.6-sunburst",
    // Reference images go through POST /v1/images/edits (`images: [{ image_url }]`).
    supportsReferences: true,
    // `background: "transparent"` with png/webp output.
    supportsTransparency: true,
  },
  {
    id: "google",
    label: "Google (Nano Banana)",
    secret: "google",
    models: [
      { id: "gemini-nano-banana-2.1", label: "Nano Banana 2.1" },
      { id: "gemini-3-pro-image", label: "Nano Banana Pro" },
      { id: "gemini-3.1-flash-lite-image", label: "Nano Banana 2 Lite" },
    ],
    defaultModel: "gemini-nano-banana-2.1",
    // Inline `{ type: "image", mime_type, data }` input parts, up to 14.
    supportsReferences: true,
    // Not documented for these models; the output format list is JPEG only.
    supportsTransparency: false,
  },
];

export function catalogEntry(id: string): ProviderCatalogEntry | undefined {
  return IMAGE_CATALOG.find((entry) => entry.id === id);
}

/** The built-in generator used whenever no image service is chosen: it needs no key and makes labelled artwork offline. */
export const PLACEHOLDER_PROVIDER = "mock";

export function providerInfos(configured: (secret: SecretName) => boolean): ImageProviderInfo[] {
  return IMAGE_CATALOG.map((entry) => ({
    id: entry.id,
    label: entry.label,
    configured: entry.secret === null ? true : configured(entry.secret),
    models: entry.models,
    defaultModel: entry.defaultModel,
    supportsReferences: entry.supportsReferences,
    supportsTransparency: entry.supportsTransparency,
    ...(entry.id === PLACEHOLDER_PROVIDER ? { placeholder: true } : {}),
  }));
}

/**
 * The image service that is actually in use: the chosen one while its key is
 * there, else none (null) — and none means the placeholder generator. So
 * Settings never shows a service as selected that generation would refuse.
 */
export function effectiveProvider(chosen: string | null | undefined, configured: (secret: SecretName) => boolean): string | null {
  const entry = chosen ? catalogEntry(chosen) : undefined;

  if (!entry) return null;
  return entry.secret === null || configured(entry.secret) ? entry.id : null;
}

/**
 * OpenAI GPT Image 2.x sizes: both edges multiples of 16, long/short ≤ 3:1,
 * 655,360–8,294,400 pixels. The three "recommended" sizes are used where they
 * fit; the rest are the nearest valid custom sizes.
 */
export const OPENAI_SIZES: Record<ImageAspect, { width: number; height: number }> = {
  "1:1": { width: 1024, height: 1024 },
  "16:9": { width: 1536, height: 864 },
  "4:3": { width: 1280, height: 960 },
  "3:2": { width: 1536, height: 1024 },
  "9:16": { width: 864, height: 1536 },
  "3:4": { width: 960, height: 1280 },
  "2:3": { width: 1024, height: 1536 },
};

/** Every product aspect is in Google's `aspect_ratio` enum as written. */
export const GOOGLE_ASPECTS: Record<ImageAspect, string> = {
  "1:1": "1:1",
  "16:9": "16:9",
  "4:3": "4:3",
  "3:2": "3:2",
  "9:16": "9:16",
  "3:4": "3:4",
  "2:3": "2:3",
};

export function aspectDimensions(aspect: ImageAspect, longEdge = 1200): { width: number; height: number } {
  const [w, h] = aspect.split(":").map(Number) as [number, number];

  return w >= h
    ? { width: longEdge, height: Math.round((longEdge * h) / w) }
    : { width: Math.round((longEdge * w) / h), height: longEdge };
}
