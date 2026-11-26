/**
 * Turning failures into one sentence a person can act on, and making sure no
 * secret ever rides along in a message, a `detail`, an event or a log line.
 */
import Anthropic from "@anthropic-ai/sdk";
import { GalleyError } from "../errors";

/**
 * Every secret value this process has handled. Scrubbing by value catches keys
 * whose shape no pattern knows; the patterns catch keys we never saw (a key
 * echoed back inside a provider's error body, say).
 */
const knownSecrets = new Set<string>();

export function rememberSecret(value: string): void {
  if (value.length >= 8) knownSecrets.add(value);
}

const KEY_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{16,}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /\b(?:key|token|secret|authorization)\s*[:=]\s*["']?[A-Za-z0-9._:-]{12,}/gi,
];

export function scrubSecrets(text: string): string {
  let out = text;

  for (const secret of knownSecrets) out = out.split(secret).join("[redacted]");
  for (const pattern of KEY_PATTERNS) out = out.replace(pattern, "[redacted]");
  return out;
}

/** Technical detail for logs and "Technical details" disclosures — scrubbed and bounded. */
export function safeDetail(value: unknown, max = 2000): string {
  const raw =
    value instanceof Anthropic.APIError
      ? `${value.constructor.name} status=${value.status ?? "none"} type=${value.type ?? "none"} request=${value.requestID ?? "none"}`
      : value instanceof Error
        ? `${value.name}: ${value.message}`
        : String(value);

  return scrubSecrets(raw).slice(0, max);
}

export interface ApiFailure {
  /** One sentence for the person: what happened, what to do. */
  message: string;
  /** True when the turn was stopped on purpose — no error should be shown. */
  aborted: boolean;
}

/**
 * Maps the SDK's typed errors to plain sentences. The classes are checked most
 * specific first; `APIError.type` (the API's own error type, typed by the SDK)
 * covers errors that arrive inside an open stream, which carry no HTTP status.
 * Nothing here looks at message text.
 */
/** The API endpoint the assistant talks to unless an operator points it elsewhere. */
export const DEFAULT_API_BASE_URL = "https://api.anthropic.com";

/** The host of an endpoint an operator chose (GALLEY_ANTHROPIC_BASE_URL), or null for the public API. */
function overriddenHost(baseURL: string | undefined): string | null {
  if (!baseURL) return null;
  try {
    const url = new URL(baseURL);

    return url.origin === new URL(DEFAULT_API_BASE_URL).origin ? null : url.host;
  } catch {
    return null;
  }
}

/** Structured error codes returned by the Galley Cloud AI proxy whose plain-English message should be surfaced directly. */
export const PROXY_ERROR_CODES: ReadonlySet<string> = new Set([
  "galley_ai_allowance_used",
  "galley_ai_paused_unpaid",
  "galley_ai_switched_off",
]);

/**
 * Extracts a Galley Cloud proxy error from a provider JSON body (Anthropic,
 * OpenAI, Google, or OpenRouter shape), returning its code and scrubbed
 * plain-English message when recognised.
 */
export function extractProxyError(body: unknown): { code: string; message: string } | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const nested = record.error && typeof record.error === "object" ? (record.error as Record<string, unknown>) : record;
  const message = typeof nested.message === "string" ? nested.message.trim() : "";

  if (!message) return null;
  const details = nested.details;
  const metadata = nested.metadata && typeof nested.metadata === "object" ? (nested.metadata as Record<string, unknown>) : null;
  const candidates: unknown[] = [
    details && !Array.isArray(details) && typeof details === "object" ? (details as Record<string, unknown>).error_code : undefined,
    ...(Array.isArray(details)
      ? details.flatMap((entry) =>
          entry && typeof entry === "object" ? [(entry as Record<string, unknown>).reason, (entry as Record<string, unknown>).error_code] : []
        )
      : []),
    nested.code,
    nested.type,
    metadata?.error_code,
    metadata?.error_type,
  ];
  const code = candidates.find((value): value is string => typeof value === "string" && PROXY_ERROR_CODES.has(value));

  return code ? { code, message: scrubSecrets(message) } : null;
}

function anthropicProxyError(error: InstanceType<typeof Anthropic.APIError>): { code: string; message: string } | null {
  const fromBody = extractProxyError(error.error);

  if (fromBody) return fromBody;
  const extra = error as unknown as { errorCode?: unknown; apiMessage?: unknown };

  if (typeof extra.errorCode === "string" && PROXY_ERROR_CODES.has(extra.errorCode) && typeof extra.apiMessage === "string" && extra.apiMessage.trim()) {
    return { code: extra.errorCode, message: scrubSecrets(extra.apiMessage.trim()) };
  }
  return null;
}

export function describeApiFailure(error: unknown, options: { baseURL?: string } = {}): ApiFailure {
  const say = (message: string): ApiFailure => ({ message, aborted: false });
  const host = overriddenHost(options.baseURL);
  // With an operator's gateway in between, "the key was rejected" must say who rejected it.
  const rejected = host
    ? `The assistant can't connect: ${host} rejected the API key. That address comes from GALLEY_ANTHROPIC_BASE_URL; check the key is one it accepts, or remove that setting to use the public API.`
    : "The assistant can't connect: the API key in Settings was rejected. Add a fresh key in Settings.";

  if (error instanceof Anthropic.APIUserAbortError) return { message: "", aborted: true };
  if (error instanceof Anthropic.APIError) {
    const proxy = anthropicProxyError(error);

    if (proxy) return say(proxy.message);
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return say("The assistant took too long to answer, so the request was stopped. Try again in a moment.");
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return say("Couldn't reach the assistant. Check this computer's internet connection, then try again.");
  }
  if (error instanceof Anthropic.AuthenticationError) return say(rejected);
  if (error instanceof Anthropic.PaymentRequiredError) {
    return say("The assistant's API account is out of credit. Add credit to the account, then try again.");
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return say("This API key isn't allowed to use the chosen model. Pick another model in Settings, or check the key's access.");
  }
  if (error instanceof Anthropic.NotFoundError) {
    return say("The chosen model isn't available to this API key. Pick another model in Settings.");
  }
  if (error instanceof Anthropic.ContentTooLargeError) {
    return say("That message is too large to send. Try fewer or smaller images.");
  }
  if (error instanceof Anthropic.RateLimitError) {
    return say("The assistant has had too many requests in a short time. Wait a minute, then try again.");
  }
  if (error instanceof Anthropic.OverloadedError) {
    return say("The assistant is overloaded right now. Try again in a minute.");
  }
  if (error instanceof Anthropic.InternalServerError) {
    return say("The assistant's service had a problem. Try again in a minute.");
  }
  if (error instanceof Anthropic.BadRequestError) {
    return say("The assistant couldn't accept that request. Try again; if it keeps happening, start a new conversation.");
  }
  if (error instanceof Anthropic.APIError) {
    switch (error.type) {
      case "overloaded_error":
        return say("The assistant is overloaded right now. Try again in a minute.");
      case "rate_limit_error":
        return say("The assistant has had too many requests in a short time. Wait a minute, then try again.");
      case "billing_error":
        return say("The assistant's API account is out of credit. Add credit to the account, then try again.");
      case "authentication_error":
        return say(rejected);
      case "permission_error":
        return say("This API key isn't allowed to use the chosen model. Pick another model in Settings, or check the key's access.");
      case "invalid_request_error":
        return say("The assistant couldn't accept that request. Try again; if it keeps happening, start a new conversation.");
      default:
        return say("The assistant's service had a problem. Try again in a minute.");
    }
  }
  if (error instanceof GalleyError) return say(error.message);
  return say("The assistant stopped unexpectedly. Nothing else was changed. Try again.");
}

export const NO_KEY_MESSAGE = "Connect the assistant first: add an Anthropic API key in Settings.";

export function noKeyError(): GalleyError {
  return new GalleyError("unconfigured", NO_KEY_MESSAGE);
}
