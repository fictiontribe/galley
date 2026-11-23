/**
 * The image providers the engine can use, as one shape whatever registered
 * them: the built-ins (mock, OpenAI, Google) and any plugin's. The plugin
 * registry builds these from `ImageProviderPlugin`s; without a registry
 * (tests, embedding) the built-in plugin's providers are used directly.
 * ImageService and Settings both pick a provider from this list — there is
 * no second table.
 */
import type { ImageProviderInfo, SecretName } from "../../types";
import type { ImageModelInfo } from "../../plugins/types";
import type { GeneratedImage, ProviderRequest } from "./provider";

/** Where a provider's key comes from: one of the app's own keys, a plugin's secret setting, or none. */
export type ProviderKey =
  | { kind: "builtin"; secret: SecretName; phrase: string }
  | { kind: "plugin"; phrase: string; configured(): Promise<boolean>; read(): Promise<string | null> }
  | null;

export interface ImageProviderHandle {
  id: string;
  label: string;
  /** The plugin that registered it. */
  plugin: string;
  key: ProviderKey;
  /** Models to offer; may fetch, and must not throw (fall back instead). */
  models(): Promise<ImageModelInfo[]>;
  defaultModel: string;
  supportsReferences: boolean;
  supportsTransparency: boolean;
  generate(request: ProviderRequest, key: string | null, fetchImpl: typeof fetch): Promise<Array<GeneratedImage & { cost?: number }>>;
}

export type ImageProviderSource = () => readonly ImageProviderHandle[];

/** "OpenAI API key" → "an OpenAI API key". */
export function withArticle(label: string): string {
  return `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`;
}

/** Whether a provider's key is there, through whichever path holds it. */
export async function keyConfigured(handle: ImageProviderHandle | { key: ProviderKey }, builtin: (secret: SecretName) => boolean | Promise<boolean>): Promise<boolean> {
  if (!handle.key) return true;
  if (handle.key.kind === "builtin") return builtin(handle.key.secret);
  return handle.key.configured().catch(() => false);
}

export async function readKey(handle: { key: ProviderKey }, builtin: (secret: SecretName) => Promise<string | null>): Promise<string | null> {
  if (!handle.key) return null;
  if (handle.key.kind === "builtin") return builtin(handle.key.secret);
  return handle.key.read();
}

/** The model's own capability when it states one, else the provider's. */
export function capability(handle: ImageProviderHandle, model: ImageModelInfo | undefined, flag: "supportsReferences" | "supportsTransparency"): boolean {
  return model?.[flag] ?? handle[flag];
}

export async function providerInfo(handle: ImageProviderHandle, configured: boolean): Promise<ImageProviderInfo> {
  let models: ImageModelInfo[];

  try {
    models = await handle.models();
  } catch {
    models = [];
  }
  return {
    id: handle.id,
    label: handle.label,
    configured,
    models: models.map((model) => ({
      id: model.id,
      label: model.label,
      ...(model.supportsReferences !== undefined ? { supportsReferences: model.supportsReferences } : {}),
      ...(model.supportsTransparency !== undefined ? { supportsTransparency: model.supportsTransparency } : {}),
      ...(model.price ? { price: model.price } : {}),
    })),
    defaultModel: handle.defaultModel,
    supportsReferences: handle.supportsReferences,
    supportsTransparency: handle.supportsTransparency,
    ...(handle.id === "mock" ? { placeholder: true } : {}),
  };
}
