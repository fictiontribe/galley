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
import type { IncomingMessage } from "node:http";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { isIP } from "node:net";

export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;
export const LOGIN_LIMIT = 5;
export const LOGIN_WINDOW_MS = 60_000;
/**
 * Failed sign-ins for one e-mail from one client before that pair waits out
 * the window. The e-mail's own limits, whatever the client, are the sign-in
 * gate's (sign-in-gate.ts).
 */
export const EMAIL_LOGIN_LIMIT = 10;
export const EMAIL_LOGIN_WINDOW_MS = 15 * 60_000;
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

/**
 * Whether a presented signature is the expected one, in constant time. They
 * are compared as bytes, and the byte counts first: two strings with the
 * same number of characters need not be the same number of bytes (a cookie
 * can carry any character), and the comparison refuses buffers of unequal
 * length outright.
 */
export function sameSignature(presented: string, expected: string): boolean {
  const left = Buffer.from(presented, "utf8");
  const right = Buffer.from(expected, "utf8");

  return left.length === right.length && timingSafeEqual(left, right);
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

  if (!sameSignature(signature, expected)) return null;
  const issuedAt = Number(parts[0]);

  if (!Number.isFinite(issuedAt) || issuedAt > now + 60_000 || now - issuedAt > SESSION_MAX_AGE_S * 1000) return null;
  return { id: parts[1]!, issuedAt, ...(accountId !== undefined ? { accountId } : {}) };
}

/**
 * A browser someone has signed in on before (hosted): a long-lived cookie of
 * its own, `kb1.issuedAt.nonce.accountId.hmac` under its own MAC label. Five
 * parts and a different label, so it is never read as a session (three or
 * four parts, other labels), whatever it holds. All it does is let a
 * sign-in to that one account skip the e-mail's line (sign-in-gate.ts).
 */
export const KNOWN_BROWSER_MAX_AGE_S = 365 * 24 * 60 * 60;
const KNOWN_BROWSER_PURPOSE = "known-browser/v1";
const KNOWN_BROWSER_TAG = "kb1";

export interface KnownBrowser {
  id: string;
  issuedAt: number;
  accountId: string;
}

export function signKnownBrowser(key: Uint8Array, accountId: string, issuedAt = Date.now(), nonce = randomBytes(16).toString("base64url")): string {
  if (!ACCOUNT_ID.test(accountId)) throw new Error("An account id is letters, digits, - and _ only.");
  const payload = `${KNOWN_BROWSER_TAG}.${issuedAt}.${nonce}.${accountId}`;

  return `${payload}.${mac(key, `${KNOWN_BROWSER_PURPOSE}\n${payload}`)}`;
}

/** The known browser in `value` when it is validly signed and not too old, else null. Says nothing about the account. */
export function readKnownBrowser(key: Uint8Array, value: string | undefined, now = Date.now()): KnownBrowser | null {
  if (!value) return null;
  const parts = value.split(".");

  if (parts.length !== 5 || parts[0] !== KNOWN_BROWSER_TAG) return null;
  const [, issued, id, accountId, signature] = parts as [string, string, string, string, string];

  if (!ACCOUNT_ID.test(accountId) || !id) return null;
  const expected = mac(key, `${KNOWN_BROWSER_PURPOSE}\n${parts.slice(0, 4).join(".")}`);

  if (!sameSignature(signature, expected)) return null;
  const issuedAt = Number(issued);

  if (!Number.isFinite(issuedAt) || issuedAt > now + 60_000 || now - issuedAt > KNOWN_BROWSER_MAX_AGE_S * 1000) return null;
  return { id, issuedAt, accountId };
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

/**
 * Requests that arrived on the server's Unix socket (GALLEY_SOCKET). Only the front the operator put there can
 * open it, so what it says it saw — X-Forwarded-For and X-Forwarded-Proto — is believed for these requests.
 */
const arrivedOnSocket = new WeakSet<IncomingMessage>();

/** Marks a request (or an upgrade) as having arrived on the server's Unix socket. */
export function markArrivedOnSocket(req: IncomingMessage): void {
  arrivedOnSocket.add(req);
}

/** Whether this request came in on the server's Unix socket. */
export function cameThroughSocket(c: Context): boolean {
  const incoming = (c.env as { incoming?: IncomingMessage } | undefined)?.incoming;

  return incoming !== undefined && arrivedOnSocket.has(incoming);
}

/**
 * Whether the forwarded headers of this request are believed: always for one that came through the server's Unix
 * socket; otherwise only when GALLEY_TRUST_PROXY is on (`trustProxy`), which believes them from any connection —
 * and which the server passes as off once a socket is set, so that only the socket is believed.
 */
function forwardedTrusted(c: Context, trustProxy: boolean): boolean {
  return trustProxy || cameThroughSocket(c);
}

/**
 * The protocol a request arrived over: the trusted proxy's word (see `forwardedTrusted`), else the connection's own —
 * TLS or not. Never the request line: a request may name an absolute address there (`POST https://… HTTP/1.1`), and
 * a URL built from it would say HTTPS for a request that came over plain HTTP. (The listener also puts every request
 * line in origin form before Hono builds a URL; this doesn't lean on that.) Only a request made inside the process
 * (no connection, so no request line) goes by its URL.
 */
export function requestProtocol(c: Context, trustProxy: boolean): "http" | "https" {
  if (forwardedTrusted(c, trustProxy)) {
    const forwarded = firstHeaderValue(c.req.header("x-forwarded-proto"));

    if (forwarded === "https" || forwarded === "http") return forwarded;
  }
  const incoming = (c.env as { incoming?: IncomingMessage } | undefined)?.incoming;

  if (incoming !== undefined) return (incoming.socket as { encrypted?: boolean } | null | undefined)?.encrypted === true ? "https" : "http";
  return new URL(c.req.url).protocol === "https:" ? "https" : "http";
}

/** The client's address, for rate limiting. Behind a trusted proxy, the address the proxy saw. */
export function clientAddress(c: Context, trustProxy: boolean): string {
  if (forwardedTrusted(c, trustProxy)) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",").map((part) => part.trim()).filter(Boolean);
    // The last hop is the one our own proxy appended; anything before it the client could have written.
    const last = forwarded?.[forwarded.length - 1];

    if (last) return last;
  }
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;

  return env?.incoming?.socket?.remoteAddress ?? "unknown";
}

/**
 * What every limit in the server counts a client as: an IPv4 address is
 * itself (also when it arrives IPv4-mapped, ::ffff:a.b.c.d); an IPv6 address
 * is its /64, the smallest network one subscriber is normally given, so
 * the addresses inside it are one client. Anything else is keyed as it is.
 */
export function clientKey(address: string): string {
  let value = address.trim().toLowerCase();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);

  if (bracketed) value = bracketed[1]!;
  const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(value);

  if (withPort) value = withPort[1]!;
  value = value.replace(/%.*$/, "");
  const kind = isIP(value);

  if (kind === 4) return value;
  if (kind !== 6) return address;
  const groups = ipv6Groups(value);

  if (!groups) return address;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return [groups[6]! >> 8, groups[6]! & 255, groups[7]! >> 8, groups[7]! & 255].join(".");
  }
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(":")}::/64`;
}

/** The eight 16-bit groups of a valid IPv6 address (`isIP` said so), a trailing dotted IPv4 part included. */
function ipv6Groups(address: string): number[] | null {
  let text = address;
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);

  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number];

    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", tail, extra] = text.split("::");

  if (extra !== undefined) return null;
  const parse = (part: string) => (part ? part.split(":").map((group) => Number.parseInt(group, 16)) : []);
  const front = parse(head);
  const back = tail === undefined ? [] : parse(tail);
  const missing = 8 - front.length - back.length;

  if (missing < 0 || (tail === undefined && missing !== 0)) return null;
  const groups = [...front, ...Array<number>(missing).fill(0), ...back];

  return groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : null;
}

/** The client a request counts as for every limit: clientKey of its address. */
export function clientKeyOf(c: Context, trustProxy: boolean): string {
  return clientKey(clientAddress(c, trustProxy));
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
  /** Hosted install: the known-browser cookie's name (never a session). */
  knownCookieName?: string;
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
