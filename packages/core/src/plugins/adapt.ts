/**
 * Public contributions → the engine's internal shapes. This is where the
 * public API meets the parts of the engine that predate it: an
 * `ImageProviderPlugin` (context object, models as a function) becomes the
 * ImageProviderHandle that ImageService and Settings pick from.
 */
import type { ImageProviderHandle, ProviderKey } from "../ai/images/providers";
import { withArticle } from "../ai/images/providers";
import { SECRET_ENV } from "../ai/secrets";
import type { SecretName } from "../types";
import type { ImageModelInfo, ImageProviderPlugin, PluginContext, PluginSettingField, ProviderCallContext, VideoModelInfo, VideoProviderPlugin } from "./types";

/** Which plugin a contribution belongs to, and how to build its context for one call. */
export interface ContributionOwner {
  name: string;
  trusted: boolean;
  fields: readonly PluginSettingField[];
  context(): Promise<PluginContext>;
  /** Whether a secret setting has a value, and the value — for the provider's key only. */
  secret(key: string): { configured(): Promise<boolean>; read(): Promise<string | null> };
}

const BUILTIN_SECRETS = Object.keys(SECRET_ENV) as SecretName[];

function keyFor(owner: ContributionOwner, keySetting: string | undefined): ProviderKey {
  if (!keySetting) return null;
  const field = owner.fields.find((item) => item.key === keySetting);
  const phrase = withArticle(field?.label ?? "API key");

  // The app's own keys keep their one path through Settings (its checks, its env names).
  if (owner.trusted && field?.secretName && (BUILTIN_SECRETS as string[]).includes(field.secretName)) {
    return { kind: "builtin", secret: field.secretName as SecretName, phrase };
  }
  const secret = owner.secret(keySetting);

  return { kind: "plugin", phrase, configured: () => secret.configured(), read: () => secret.read() };
}

async function callContext(owner: ContributionOwner, key: string | null, fetchImpl: typeof fetch | undefined, signal: AbortSignal | undefined): Promise<ProviderCallContext> {
  const base = await owner.context();

  return { ...base, key, ...(fetchImpl ? { fetch: fetchImpl } : {}), ...(signal ? { signal } : {}) };
}

/**
 * The key a provider may use to list its models (some services only list
 * them to a signed-in caller). Built-in keys are never handed out for this:
 * their model lists are fixed.
 */
async function listingKey(owner: ContributionOwner, keySetting: string | undefined): Promise<string | null> {
  const key = keyFor(owner, keySetting);

  return key?.kind === "plugin" ? key.read().catch(() => null) : null;
}

/** Models are listed often; a provider that throws or hangs here costs its list, never the page. */
async function safeModels<T>(load: () => Promise<T[]> | T[], timeoutMs = 15_000): Promise<T[]> {
  try {
    const result = await Promise.race([Promise.resolve(load()), new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("timed out")), timeoutMs).unref())]);

    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

export function imageHandle(provider: ImageProviderPlugin, owner: ContributionOwner): ImageProviderHandle {
  return {
    id: provider.id,
    label: provider.label,
    plugin: owner.name,
    key: keyFor(owner, provider.keySetting),
    defaultModel: provider.defaultModel,
    supportsReferences: Boolean(provider.supportsReferences),
    supportsTransparency: Boolean(provider.supportsTransparency),
    async models() {
      const ctx = await callContext(owner, await listingKey(owner, provider.keySetting), undefined, undefined);

      return safeModels<ImageModelInfo>(() => provider.models(ctx));
    },
    async generate(request, key, fetchImpl) {
      const ctx = await callContext(owner, key, fetchImpl, request.signal);
      const { signal: _signal, ...rest } = request;

      return provider.generate(rest, ctx);
    },
  };
}

export interface VideoProviderHandle {
  id: string;
  label: string;
  plugin: string;
  key: ProviderKey;
  defaultModel: string;
  models(): Promise<VideoModelInfo[]>;
  call<T>(key: string | null, fetchImpl: typeof fetch | undefined, signal: AbortSignal | undefined, run: (provider: VideoProviderPlugin, ctx: ProviderCallContext) => Promise<T>): Promise<T>;
}

export function videoHandle(provider: VideoProviderPlugin, owner: ContributionOwner): VideoProviderHandle {
  return {
    id: provider.id,
    label: provider.label,
    plugin: owner.name,
    key: keyFor(owner, provider.keySetting),
    defaultModel: provider.defaultModel,
    async models() {
      const ctx = await callContext(owner, await listingKey(owner, provider.keySetting), undefined, undefined);

      return safeModels<VideoModelInfo>(() => provider.models(ctx));
    },
    async call(key, fetchImpl, signal, run) {
      return run(provider, await callContext(owner, key, fetchImpl, signal));
    },
  };
}
