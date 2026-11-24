/**
 * Sessions, sign-in, and the request guards.
 *
 * Local mode: a random token minted at start-up travels once in the URL the
 * CLI opens (`?token=`), and is exchanged for an HttpOnly cookie. Hosted
 * mode: a person's e-mail and password exchanged for the same kind of
 * cookie. The cookie value is `issuedAt.nonce.hmac` (local) or
 * `issuedAt.nonce.accountId.hmac` (hosted: whose session it is, under the
 * MAC, so it can't be swapped), signed with a server key, so it can be
 * checked without server-side session state.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";

export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;
export const LOGIN_LIMIT = 5;
export const LOGIN_WINDOW_MS = 60_000;
/**
 * Failed sign-ins for one e-mail from one client address before that pair
 * waits out the window. Guesses from other addresses never count here, so
 * they can't keep the right password out.
 */
export const EMAIL_LOGIN_LIMIT = 10;
export const EMAIL_LOGIN_WINDOW_MS = 15 * 60_000;
/**
 * Failed sign-ins for one e-mail from every address together, in the same
 * window, past which each attempt for it waits its turn: one at a time,
 * EMAIL_SLOW_DELAY_MS apart. Slowed, never refused — and the wait is
 * bounded: beyond EMAIL_SLOW_QUEUE waiting, an attempt waits the delay alone.
 */
export const EMAIL_SLOW_AFTER = 30;
export const EMAIL_SLOW_DELAY_MS = 1_000;
export const EMAIL_SLOW_QUEUE = 10;
/** Password checks for sign-in run this many at a time, with at most SIGN_IN_QUEUE waiting; beyond that the answer is "too many attempts". */
export const SIGN_IN_HASHING = 2;
export const SIGN_IN_QUEUE = 16;
/** "Forgot my password" requests per client address, and e-mails per address asked for, in their windows. */
export const FORGOT_CLIENT_LIMIT = 5;
export const FORGOT_CLIENT_WINDOW_MS = 15 * 60_000;
export const FORGOT_EMAIL_LIMIT = 3;
export const FORGOT_EMAIL_WINDOW_MS = 60 * 60_000;
/** The MAC's label for a hosted (person's) cookie: its MAC is never a local cookie's MAC, whatever the payload. */
const ACCOUNT_PURPOSE = "account-session/v1";
const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/;

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

export function signSession(key: Uint8Array, issuedAt = Date.now(), nonce = randomBytes(16).toString("base64url"), accountId?: string): string {
  if (accountId !== undefined) {
    if (!ACCOUNT_ID.test(accountId)) throw new Error("An account id is letters, digits, - and _ only.");
    const payload = `${issuedAt}.${nonce}.${accountId}`;

    return `${payload}.${mac(key, `${ACCOUNT_PURPOSE}\n${payload}`)}`;
  }
  const payload = `${issuedAt}.${nonce}`;

  return `${payload}.${mac(key, payload)}`;
}

/** A session cookie that is correctly signed and not too old: its id (the nonce), when it was issued, and whose it is (hosted). */
export interface SessionInfo {
  id: string;
  issuedAt: number;
  accountId?: string;
}

/** The session in `value` when it is validly signed and unexpired, else null. Says nothing about revocation. */
export function readSession(key: Uint8Array, value: string | undefined, now = Date.now()): SessionInfo | null {
  if (!value) return null;
  const parts = value.split(".");

  if (parts.length !== 3 && parts.length !== 4) return null;
  const signature = parts[parts.length - 1]!;
  const payload = parts.slice(0, -1).join(".");
  const accountId = parts.length === 4 ? parts[2]! : undefined;

  if (accountId !== undefined && !ACCOUNT_ID.test(accountId)) return null;
  const expected = mac(key, accountId !== undefined ? `${ACCOUNT_PURPOSE}\n${payload}` : payload);

  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const issuedAt = Number(parts[0]);

  if (!Number.isFinite(issuedAt) || issuedAt > now + 60_000 || now - issuedAt > SESSION_MAX_AGE_S * 1000) return null;
  return { id: parts[1]!, issuedAt, ...(accountId !== undefined ? { accountId } : {}) };
}

/** Returns the session nonce when `value` is a valid, unexpired session, else null. */
export function verifySession(key: Uint8Array, value: string | undefined, now = Date.now()): string | null {
  return readSession(key, value, now)?.id ?? null;
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

  /** Failures counted for `client` in the current window. */
  count(client: string, now = Date.now()): number {
    const entry = this.attempts.get(client);

    return entry && now - entry.since < this.windowMs ? entry.count : 0;
  }

  private prune(now: number): void {
    for (const [client, entry] of this.attempts) if (now - entry.since >= this.windowMs) this.attempts.delete(client);
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);

    timer.unref?.();
  });

/** Attempts for one key, one at a time and `delayMs` apart (at most `queue` waiting; past that, each waits `delayMs` alone). */
export class SerialDelay {
  private readonly lines = new Map<string, { tail: Promise<void>; waiting: number }>();

  constructor(
    private readonly delayMs = EMAIL_SLOW_DELAY_MS,
    private readonly queue = EMAIL_SLOW_QUEUE
  ) {}

  async wait(key: string): Promise<void> {
    const line = this.lines.get(key) ?? { tail: Promise.resolve(), waiting: 0 };

    if (line.waiting >= this.queue) return sleep(this.delayMs);
    const mine = line.tail.then(() => sleep(this.delayMs));

    line.tail = mine;
    line.waiting += 1;
    this.lines.set(key, line);
    try {
      await mine;
    } finally {
      line.waiting -= 1;
      if (line.waiting === 0 && line.tail === mine) this.lines.delete(key);
    }
  }
}

/** Runs at most `limit` tasks at a time with at most `queue` waiting; `run` answers null when both are full. */
export class Bounded {
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly limit = SIGN_IN_HASHING,
    private readonly queue = SIGN_IN_QUEUE
  ) {}

  async run<T>(task: () => Promise<T>): Promise<T | null> {
    if (this.running >= this.limit) {
      if (this.waiting.length >= this.queue) return null;
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.running += 1;
    }
    try {
      return await task();
    } finally {
      // The slot passes straight to the next one waiting, so the count stays right.
      const next = this.waiting.shift();

      if (next) next();
      else this.running -= 1;
    }
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

/** Ended sessions by id. A Set in memory; a hosted install keeps it in its state, so a restart doesn't bring a signed-out cookie back. */
export interface RevocationList {
  has(id: string): boolean;
  add(id: string): unknown;
}

export interface SessionCheck {
  key: Uint8Array;
  token: string | null;
  cookieName: string;
  revoked: RevocationList;
  /** Hosted install: whether a signed, unexpired session still counts ("sign out everywhere", a changed password). */
  valid?: (session: SessionInfo) => boolean;
  /** Hosted install: a new cookie value for this person — issued after the last "sign out everywhere" (theirs and the install's), so it isn't caught by it. */
  issue?: (accountId?: string) => string;
  /** Hosted install: checks the sign-in password against the stored hash. */
  verifyPassword?: (password: string) => Promise<boolean>;
  /** Always mark the cookie Secure (a hosted install on an https:// address), whatever the forwarded protocol says. */
  secure?: boolean;
}

/** The current request's session — its id and issue time — when its cookie is valid and still counts. */
export function requestSession(c: Context, check: SessionCheck): SessionInfo | null {
  const session = readSession(check.key, getCookie(c, check.cookieName));

  if (!session || check.revoked.has(session.id)) return null;
  if (check.valid && !check.valid(session)) return null;
  return session;
}

export function isAuthenticated(c: Context, check: SessionCheck): boolean {
  const bearer = bearerToken(c);

  if (bearer !== null) return check.token !== null && safeEqual(bearer, check.token);
  return requestSession(c, check) !== null;
}

/** Cookie nonce of the current session (for logout), when valid. */
export function sessionNonce(c: Context, check: SessionCheck): string | null {
  return verifySession(check.key, getCookie(c, check.cookieName));
}
