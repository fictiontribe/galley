/**
 * Talking to OpenRouter: the headers every request carries, reading a body
 * that may not be JSON, and turning a failure into one plain sentence.
 *
 * Errors are classified by HTTP status and the structured fields OpenRouter
 * documents — `error.metadata.error_type` and `error.metadata.limit_source` —
 * never by matching the message text, which is free prose and changes.
 * Per https://openrouter.ai/docs/api/reference/errors-and-debugging
 * (read 2026-11-23).
 */
import { ProviderError, type ProviderCallContext, type ProviderErrorKind } from "@galleycms/plugin-kit";

export const OPENROUTER_API = "https://openrouter.ai/api/v1";

export type BaseUrlOption = string | (() => string);

/** Resolves a static or dynamic OpenRouter API base URL, falling back to `OPENROUTER_API`. */
export function resolveBaseUrl(baseUrl?: BaseUrlOption): string {
  const raw = typeof baseUrl === "function" ? baseUrl() : baseUrl;

  return (raw?.trim() || OPENROUTER_API).replace(/\/+$/, "");
}

const PROXY_ERROR_CODES: ReadonlySet<string> = new Set([
  "galley_ai_allowance_used",
  "galley_ai_paused_unpaid",
  "galley_ai_switched_off",
]);

export interface OpenRouterErrorBody {
  error?: {
    code?: number | string;
    type?: string;
    message?: string;
    details?: { error_code?: string } | null;
    metadata?: { error_code?: string; error_type?: string; limit_source?: string; reasons?: unknown; provider_code?: unknown } | null;
  };
}

/**
 * Bearer auth plus OpenRouter's app-attribution headers, with the product's
 * own name and public site — generic values, nothing about the person or
 * the site being edited.
 */
export function headers(ctx: Pick<ProviderCallContext, "key" | "brand">, json = true): Record<string, string> {
  return {
    authorization: `Bearer ${ctx.key ?? ""}`,
    ...(json ? { "content-type": "application/json" } : {}),
    "http-referer": ctx.brand.siteUrl,
    "x-openrouter-title": ctx.brand.productName,
  };
}

export async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

/** Cut the key out of anything that could reach a message or a log. */
export function scrub(text: string, key: string | null): string {
  let out = text;

  if (key && key.length >= 4) out = out.split(key).join("[redacted]");
  return out.replace(/sk-or-[A-Za-z0-9_-]{8,}/g, "[redacted]").slice(0, 600);
}

type What = "image" | "video";

const nouns: Record<What, string> = { image: "image", video: "video" };

/** One failure, classified. `status` is the HTTP status; the body is OpenRouter's error object when it sent one. */
export function classify(status: number, body: unknown, key: string | null, what: What): ProviderError {
  const error = (body as OpenRouterErrorBody | null)?.error;
  const type = error?.metadata?.error_type ?? "";
  const limit = error?.metadata?.limit_source ?? "";
  const detail = scrub(`openrouter ${status} code=${String(error?.code ?? "")} type=${type} limit=${limit} ${error?.message ?? ""}`, key);
  const noun = nouns[what];
  const fail = (kind: ProviderErrorKind, plain: string) => new ProviderError(kind, plain, detail);
  const proxyCode = [error?.details?.error_code, error?.metadata?.error_code, error?.metadata?.error_type, error?.code, error?.type].find(
    (value): value is string => typeof value === "string" && PROXY_ERROR_CODES.has(value)
  );

  if (proxyCode && typeof error?.message === "string" && error.message.trim()) {
    return fail(proxyCode === "galley_ai_switched_off" ? "auth" : "quota", scrub(error.message.trim(), key));
  }
  if (status === 401 || type === "authentication") return fail("auth", "OpenRouter didn't accept the API key in Settings. Add a fresh key and try again.");
  if (status === 402) {
    return limit === "openrouter_in_flight_budget"
      ? fail("rate", "OpenRouter is holding new requests until the running ones finish. Wait a minute, then try again.")
      : fail("quota", "The OpenRouter account is out of credit. Add credit, then try again.");
  }
  if (limit === "openrouter_key_limit") return fail("quota", "This OpenRouter key has reached its spending limit. Raise the limit on OpenRouter, or use another key.");
  if (limit === "openrouter_workspace_budget" || limit === "openrouter_guardrail_budget") {
    return fail("quota", "The OpenRouter workspace has used its spending budget. Raise it on OpenRouter, then try again.");
  }
  if (type === "content_policy_violation" || type === "refusal" || (status === 403 && Array.isArray(error?.metadata?.reasons))) {
    return fail("policy", `OpenRouter declined to make that ${noun}. Try describing it differently.`);
  }
  if (status === 403 || type === "permission_denied") return fail("auth", `This OpenRouter key isn't allowed to use that model. Choose another model, or check the key's settings on OpenRouter.`);
  if (status === 404 || type === "not_found") return fail("unavailable", `That model isn't available on OpenRouter any more. Choose another in Settings.`);
  if (status === 429 || type === "rate_limit_exceeded") return fail("rate", "OpenRouter is limiting requests right now. Wait a minute, then try again.");
  if (status === 413 || type === "payload_too_large" || type === "image_too_large") return fail("invalid", "The reference pictures are too large to send. Use smaller ones, or fewer.");
  if (type === "invalid_image" || type === "unsupported_image_format" || type === "image_too_small" || type === "image_download_failed" || type === "image_not_found") {
    return fail("invalid", "OpenRouter couldn't use one of the reference pictures. Try another picture.");
  }
  if (status === 503 || type === "provider_overloaded") return fail("unavailable", `No service behind OpenRouter can make this ${noun} right now. Try again in a few minutes, or choose another model.`);
  if (status >= 500 || type === "provider_unavailable" || type === "timeout" || type === "server") return fail("unavailable", `OpenRouter's ${noun} service had a problem. Try again in a minute.`);
  return fail("invalid", `OpenRouter couldn't make that ${noun} with these settings. Try another shape, length or model.`);
}

/** fetch, with a network failure turned into a plain ProviderError. */
export async function call(ctx: ProviderCallContext, url: string, init: RequestInit, what: What): Promise<Response> {
  try {
    return await ctx.fetch(url, { ...init, ...(ctx.signal ? { signal: ctx.signal } : {}) });
  } catch (error) {
    if (ctx.signal?.aborted) throw new ProviderError("unavailable", "Stopped.", "aborted");
    throw new ProviderError("unavailable", "Couldn't reach OpenRouter. Check the internet connection, then try again.", scrub(String(error), ctx.key));
  }
}

export function base64ToBytes(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data, "base64"));
}

export function dataUrl(data: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(data).toString("base64")}`;
}

/** "$0.04", "$0.0135", "$0.000004" — enough digits to be honest, no more. */
export function money(value: number): string {
  if (!Number.isFinite(value)) return "";
  const digits = value >= 0.1 ? 2 : value >= 0.001 ? 4 : 6;

  return `$${value.toFixed(digits).replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "")}`;
}
