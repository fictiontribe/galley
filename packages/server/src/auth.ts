/**
 * Sessions, sign-in, and the request guards.
 *
 * Local mode: a random token minted at start-up travels once in the URL the
 * CLI opens (`?token=`), and is exchanged for an HttpOnly cookie. Hosted
 * mode: a password exchanged for the same kind of cookie. Either way the
 * cookie value is `issuedAt.nonce.hmac` signed with a server key, so it can
 * be checked without server-side session state.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";

export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;
export const LOGIN_LIMIT = 5;
export const LOGIN_WINDOW_MS = 60_000;

export function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Constant-time string comparison. Both sides are hashed first so their lengths never leak. */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a, "utf8").digest();
  const right = createHash("sha256").update(b, "utf8").digest();

  return timingSafeEqual(left, right);
}

function mac(key: Uint8Array, payload: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function signSession(key: Uint8Array, issuedAt = Date.now(), nonce = randomBytes(16).toString("base64url")): string {
  const payload = `${issuedAt}.${nonce}`;

  return `${payload}.${mac(key, payload)}`;
}

/** Returns the session nonce when `value` is a valid, unexpired session, else null. */
export function verifySession(key: Uint8Array, value: string | undefined, now = Date.now()): string | null {
  if (!value) return null;
  const parts = value.split(".");

  if (parts.length !== 3) return null;
  const [issued, nonce, signature] = parts as [string, string, string];
  const expected = mac(key, `${issued}.${nonce}`);

  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const issuedAt = Number(issued);

  if (!Number.isFinite(issuedAt) || issuedAt > now + 60_000 || now - issuedAt > SESSION_MAX_AGE_S * 1000) return null;
  return nonce;
}

/** Failed sign-ins per client address: LOGIN_LIMIT in LOGIN_WINDOW_MS, then everything waits out the window. */
export class LoginLimiter {
  private readonly attempts = new Map<string, { count: number; since: number }>();

  constructor(
    private readonly limit = LOGIN_LIMIT,
    private readonly windowMs = LOGIN_WINDOW_MS
  ) {}

  blocked(client: string, now = Date.now()): boolean {
    const entry = this.attempts.get(client);

    if (!entry) return false;
    if (now - entry.since >= this.windowMs) {
      this.attempts.delete(client);
      return false;
    }
    return entry.count >= this.limit;
  }

  fail(client: string, now = Date.now()): void {
    const entry = this.attempts.get(client);

    if (!entry || now - entry.since >= this.windowMs) this.attempts.set(client, { count: 1, since: now });
    else entry.count += 1;
    if (this.attempts.size > 10_000) this.prune(now);
  }

  succeed(client: string): void {
    this.attempts.delete(client);
  }

  private prune(now: number): void {
    for (const [client, entry] of this.attempts) if (now - entry.since >= this.windowMs) this.attempts.delete(client);
  }
}

// ─────────────────────────────────────────────────────────────── hosts and origins

const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "::1"]);

export function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

export function isLoopbackHost(host: string): boolean {
  const name = normalizeHostname(host);

  return LOOPBACK_NAMES.has(name) || /^127(\.\d{1,3}){3}$/.test(name);
}

export function loopbackHostnames(): string[] {
  return [...LOOPBACK_NAMES];
}

function firstHeaderValue(value: string | undefined): string | undefined {
  return value?.split(",")[0]?.trim().toLowerCase() || undefined;
}

export function requestProtocol(c: Context, trustProxy: boolean): "http" | "https" {
  if (trustProxy) {
    const forwarded = firstHeaderValue(c.req.header("x-forwarded-proto"));

    if (forwarded === "https" || forwarded === "http") return forwarded;
  }
  return new URL(c.req.url).protocol === "https:" ? "https" : "http";
}

/** The client's address, for rate limiting. Behind a trusted proxy, the address the proxy saw. */
export function clientAddress(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",").map((part) => part.trim()).filter(Boolean);
    // The last hop is the one our own proxy appended; anything before it the client could have written.
    const last = forwarded?.[forwarded.length - 1];

    if (last) return last;
  }
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;

  return env?.incoming?.socket?.remoteAddress ?? "unknown";
}

export function bearerToken(c: Context): string | null {
  const header = c.req.header("authorization");
  const match = header ? /^Bearer\s+(\S+)\s*$/i.exec(header) : null;

  return match?.[1] ?? null;
}

export interface SessionCheck {
  key: Uint8Array;
  token: string | null;
  cookieName: string;
  revoked: Set<string>;
}

export function isAuthenticated(c: Context, check: SessionCheck): boolean {
  const bearer = bearerToken(c);

  if (bearer !== null) return check.token !== null && safeEqual(bearer, check.token);
  const nonce = verifySession(check.key, getCookie(c, check.cookieName));

  return nonce !== null && !check.revoked.has(nonce);
}

/** Cookie nonce of the current session (for logout), when valid. */
export function sessionNonce(c: Context, check: SessionCheck): string | null {
  return verifySession(check.key, getCookie(c, check.cookieName));
}
