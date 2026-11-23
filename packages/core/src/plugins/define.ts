/**
 * The runtime half of the public plugin API — small enough that a plugin
 * that uses it pays nothing: `definePlugin` (identity, for type checking),
 * `ProviderError` (the error a provider throws for a plain message) and
 * `resolveScriptSnippet`. Imports nothing from the engine.
 */
import type { GalleyPlugin, ProviderErrorKind, ScriptIntegrationContribution } from "./types";

/** The plugin API version this engine speaks. */
export const PLUGIN_API_VERSION = 1 as const;

/** Identity. Exists so a plugin written in TypeScript is checked against `GalleyPlugin`. */
export function definePlugin<T extends GalleyPlugin>(plugin: T): T {
  return plugin;
}

const KINDS: readonly ProviderErrorKind[] = ["auth", "policy", "quota", "rate", "unavailable", "invalid", "empty"];

/**
 * Thrown by an image or video provider: `plain` is the sentence the person
 * reads; `detail` is technical (scrub keys out of it — the engine scrubs
 * again). Recognised by shape, not by class, so a plugin bundling its own
 * copy of the kit is understood just the same.
 */
export class ProviderError extends Error {
  readonly providerError = true;

  constructor(
    readonly kind: ProviderErrorKind,
    readonly plain: string,
    readonly detail: string = ""
  ) {
    super(plain);
    this.name = "ProviderError";
  }
}

export function isProviderError(value: unknown): value is { kind: ProviderErrorKind; plain: string; detail?: string } {
  if (!(value instanceof Error)) return false;
  const record = value as unknown as Record<string, unknown>;

  return (
    (record.providerError === true || value.name === "ProviderError" || value.name === "ImageProviderError") &&
    typeof record.plain === "string" &&
    KINDS.includes(record.kind as ProviderErrorKind)
  );
}

/**
 * A plugin integration's snippet with its settings filled in: `src` values
 * are URL-encoded, `inline` values JSON-escaped (without the quotes), so a
 * setting can never close the string it sits in. Unknown placeholders are
 * left empty.
 */
export function resolveScriptSnippet(
  integration: Pick<ScriptIntegrationContribution, "snippet">,
  settings: Record<string, unknown>
): { src?: string; inline?: string; attributes?: Record<string, string> } {
  const value = (key: string) => {
    const raw = settings[key];

    return raw === undefined || raw === null ? "" : String(raw);
  };
  const fill = (template: string, escape: (text: string) => string) => template.replace(/\{\{\s*([A-Za-z][\w-]*)\s*\}\}/g, (_whole, key: string) => escape(value(key)));
  const inlineEscape = (text: string) =>
    JSON.stringify(text)
      .slice(1, -1)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e");
  const out: { src?: string; inline?: string; attributes?: Record<string, string> } = {};

  if (!integration.snippet) return out;
  if (integration.snippet.src) out.src = fill(integration.snippet.src, encodeURIComponent);
  if (integration.snippet.inline) out.inline = fill(integration.snippet.inline, inlineEscape);
  if (integration.snippet.attributes) {
    out.attributes = Object.fromEntries(Object.entries(integration.snippet.attributes).map(([name, template]) => [name, fill(template, (text) => text.replace(/"/g, "&quot;"))]));
  }
  return out;
}
