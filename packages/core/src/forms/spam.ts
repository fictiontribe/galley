/**
 * Spam protection for the capture endpoint.
 *
 * Two kinds of answer. A rate limit is refused out loud (429 with
 * Retry-After): a person who hits it can wait, and a flood must stop costing
 * disk. Everything else — a filled-in honeypot, a form sent faster than a
 * person could, a failed Turnstile check — is stored *flagged as spam* and
 * answered exactly like a real submission, so a bot learns nothing about
 * which check caught it. A repeat of the same answers within a minute (a
 * double click) is answered with the first submission's id and not stored
 * again.
 */
import { createHash } from "node:crypto";
import type { FormDefinition } from "../kit";
import type { Answers } from "./validate";

export interface RateLimits {
  /** Submissions one visitor's address may send to one site per minute. */
  perIpPerMinute: number;
  /** Submissions one form accepts per minute from everyone together. */
  perFormPerMinute: number;
}

export const DEFAULT_RATE_LIMITS: RateLimits = { perIpPerMinute: 5, perFormPerMinute: 60 };
export const RATE_WINDOW_MS = 60_000;
export const DUPLICATE_WINDOW_MS = 60_000;
export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Cloudflare's documented maximum token length. */
export const TURNSTILE_TOKEN_MAX = 2048;

/**
 * Sliding-window counters, in memory only. Keys are hashed before they are
 * kept, so the visitor addresses used for per-address limits never sit in
 * memory in the clear for longer than the request, and nothing is written.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly windowMs = RATE_WINDOW_MS) {}

  /** Records a hit when under `limit`; otherwise returns the milliseconds until one is allowed again. */
  take(key: string, limit: number, now = Date.now()): { ok: true } | { ok: false; retryAfterMs: number } {
    const id = hashKey(key);
    const recent = (this.hits.get(id) ?? []).filter((at) => now - at < this.windowMs);

    if (recent.length >= limit) {
      this.hits.set(id, recent);
      return { ok: false, retryAfterMs: Math.max(1, this.windowMs - (now - recent[0]!)) };
    }
    recent.push(now);
    this.hits.set(id, recent);
    if (this.hits.size > 20_000) this.prune(now);
    return { ok: true };
  }

  private prune(now: number): void {
    for (const [key, times] of this.hits) if (!times.some((at) => now - at < this.windowMs)) this.hits.delete(key);
  }
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("base64url").slice(0, 22);
}

/** Remembers a fingerprint of recent answers per form, to recognise a repeat. */
export class DuplicateGuard {
  private readonly seen = new Map<string, { id: string; at: number }>();

  constructor(private readonly windowMs = DUPLICATE_WINDOW_MS) {}

  /** The id of an identical submission accepted within the window, if any. */
  find(siteId: string, form: string, values: Answers, now = Date.now()): string | null {
    const hit = this.seen.get(fingerprint(siteId, form, values));

    return hit && now - hit.at < this.windowMs ? hit.id : null;
  }

  remember(siteId: string, form: string, values: Answers, id: string, now = Date.now()): void {
    this.seen.set(fingerprint(siteId, form, values), { id, at: now });
    if (this.seen.size > 5_000) {
      for (const [key, hit] of this.seen) if (now - hit.at >= this.windowMs) this.seen.delete(key);
    }
  }
}

function fingerprint(siteId: string, form: string, values: Answers): string {
  const sorted = Object.keys(values)
    .sort()
    .map((key) => [key, values[key]]);

  return createHash("sha256").update(JSON.stringify([siteId, form, sorted])).digest("base64url");
}

export interface SpamMeta {
  honeypot?: unknown;
  elapsedMs?: unknown;
  turnstileToken?: unknown;
}

export type SpamReason = "honeypot" | "too-fast" | "turnstile";

/** The checks that need no network: the honeypot and the minimum time. */
export function localSpamReason(form: FormDefinition, meta: SpamMeta): SpamReason | null {
  const honeypotOn = form.spam?.honeypot !== false;

  if (honeypotOn && typeof meta.honeypot === "string" && meta.honeypot.trim() !== "") return "honeypot";
  const minSeconds = form.spam?.minSeconds;

  if (typeof minSeconds === "number" && minSeconds > 0) {
    const elapsed = typeof meta.elapsedMs === "number" && Number.isFinite(meta.elapsedMs) ? meta.elapsedMs : null;

    // A script that sends no timing when the form asks for one isn't a person's browser.
    if (elapsed === null || elapsed < minSeconds * 1000) return "too-fast";
  }
  return null;
}

export interface TurnstileResult {
  success: boolean;
  /** Cloudflare's error codes, for the log. */
  errors: string[];
}

/**
 * Cloudflare Turnstile server-side validation: POST the secret and the token
 * to siteverify (https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
 * Tokens are single-use and valid for 300 seconds. The visitor's address
 * (`remoteip`, optional) is deliberately not sent. A network failure counts
 * as a failed check — the submission is kept, flagged, and can be marked
 * "not spam" in the inbox — rather than letting an unverified one through.
 */
export async function verifyTurnstile(
  secret: string,
  token: unknown,
  options: { fetch?: typeof fetch; timeoutMs?: number; idempotencyKey?: string } = {}
): Promise<TurnstileResult> {
  if (typeof token !== "string" || token === "" || token.length > TURNSTILE_TOKEN_MAX) {
    return { success: false, errors: ["missing-input-response"] };
  }
  const body: Record<string, string> = { secret, response: token };

  if (options.idempotencyKey) body.idempotency_key = options.idempotencyKey;
  try {
    const response = await (options.fetch ?? fetch)(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
      redirect: "error",
    });
    const json = (await response.json()) as { success?: unknown; "error-codes"?: unknown };
    const errors = Array.isArray(json["error-codes"]) ? json["error-codes"].filter((code): code is string => typeof code === "string") : [];

    return { success: json.success === true, errors };
  } catch (error) {
    return { success: false, errors: [`unreachable: ${error instanceof Error ? error.message : String(error)}`] };
  }
}
