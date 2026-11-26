/**
 * The pre-login cookie of a sign-in through the identity provider
 * (`__Host-galley_oidc`): what the browser that started the sign-in must
 * bring back to the callback — `state`, `nonce`, the PKCE verifier, where to
 * go afterwards and when it started. Sealed (AES-256-GCM) with a key of its
 * own, derived from the install's cookie key under a label of its own, so it
 * can never be read as a session, nor a session as it, and a page can't read
 * or make one. It proves nothing but that some browser started a sign-in in
 * the last ten minutes.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/** Its name: a proxy in front has to pass it through, so it is in the docs and stays. */
export const PRE_LOGIN_COOKIE = "__Host-galley_oidc";
/** How long a started sign-in can be finished. */
export const PRE_LOGIN_LIFETIME_MS = 10 * 60_000;
const LABEL = "galley oidc pre-login/v1";
const VERSION = 1;

export interface PreLogin {
  state: string;
  nonce: string;
  verifier: string;
  /** A path on the editor, already checked. */
  returnTo: string;
  /** When the sign-in started (ms). */
  startedAt: number;
  /** A link of a signed-in person's account to the provider (POST /api/auth/oidc/link), not a sign-in: which account. */
  link?: { accountId: string };
}

/**
 * A link waiting for the person to confirm it (`__Host-galley_oidc_link`,
 * Strict, ten minutes): whom the provider signed in, for which account.
 * Nothing is bound until Connect.
 */
export interface PendingLink {
  accountId: string;
  subject: string;
  /** Only an e-mail the provider confirmed. */
  email: string | null;
  /** The provider's name for the person. */
  name: string | null;
  /** When the provider's sign-in came back (ms). */
  at: number;
}

export const PENDING_LINK_COOKIE = "__Host-galley_oidc_link";
const PENDING_LABEL = "galley oidc pending-link/v1";
const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/;

function keyOf(cookieKey: Uint8Array, label = LABEL): Buffer {
  return Buffer.from(hkdfSync("sha256", cookieKey, Buffer.alloc(0), label, 32));
}

/** Seals a value under a label of its own: what one label seals, another can't open. */
function seal(cookieKey: Uint8Array, label: string, value: Record<string, unknown>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyOf(cookieKey, label), iv);
  const plain = Buffer.from(JSON.stringify({ v: VERSION, ...value }), "utf8");
  const sealed = Buffer.concat([cipher.update(plain), cipher.final()]);

  return Buffer.concat([iv, sealed, cipher.getAuthTag()]).toString("base64url");
}

function unseal(cookieKey: Uint8Array, label: string, value: string | undefined): Record<string, unknown> | null {
  if (!value || value.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const raw = Buffer.from(value, "base64url");

    if (raw.length < 12 + 16 + 2) return null;
    const decipher = createDecipheriv("aes-256-gcm", keyOf(cookieKey, label), raw.subarray(0, 12));

    decipher.setAuthTag(raw.subarray(raw.length - 16));
    const parsed = JSON.parse(Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString("utf8")) as Record<string, unknown>;

    return typeof parsed === "object" && parsed !== null && parsed.v === VERSION ? parsed : null;
  } catch {
    return null;
  }
}

const recent = (at: unknown, now: number): at is number => typeof at === "number" && Number.isSafeInteger(at) && at <= now + 60_000 && now - at <= PRE_LOGIN_LIFETIME_MS;

export function sealPreLogin(cookieKey: Uint8Array, value: PreLogin): string {
  return seal(cookieKey, LABEL, { ...value });
}

const TEXT = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;

/** The sign-in sealed in `value`, when it opens under this key and started at most ten minutes ago (and not ahead of this clock); else null. */
export function openPreLogin(cookieKey: Uint8Array, value: string | undefined, now = Date.now()): PreLogin | null {
  const parsed = unseal(cookieKey, LABEL, value);

  if (!parsed || !TEXT(parsed.state, 200) || !TEXT(parsed.nonce, 200) || !TEXT(parsed.verifier, 200) || !TEXT(parsed.returnTo, RETURN_PATH_LIMIT) || !recent(parsed.startedAt, now)) return null;
  const link = parsed.link as { accountId?: unknown } | undefined;

  if (link !== undefined && (typeof link !== "object" || link === null || typeof link.accountId !== "string" || !ACCOUNT_ID.test(link.accountId))) return null;
  return { state: parsed.state, nonce: parsed.nonce, verifier: parsed.verifier, returnTo: parsed.returnTo, startedAt: parsed.startedAt, ...(link ? { link: { accountId: link.accountId as string } } : {}) };
}

export function sealPendingLink(cookieKey: Uint8Array, value: PendingLink): string {
  return seal(cookieKey, PENDING_LABEL, { ...value });
}

/** The link waiting in `value`, when it opens under its own label and came back at most ten minutes ago; else null. */
export function openPendingLink(cookieKey: Uint8Array, value: string | undefined, now = Date.now()): PendingLink | null {
  const parsed = unseal(cookieKey, PENDING_LABEL, value);

  if (!parsed || typeof parsed.accountId !== "string" || !ACCOUNT_ID.test(parsed.accountId) || !TEXT(parsed.subject, 255) || !recent(parsed.at, now)) return null;
  const email = typeof parsed.email === "string" ? parsed.email : null;
  const name = typeof parsed.name === "string" ? parsed.name : null;

  return { accountId: parsed.accountId, subject: parsed.subject, email, name, at: parsed.at };
}

/**
 * Where to go after signing in: a path on the editor's own origin, rebuilt
 * from its path, query and fragment with leading slashes collapsed;
 * anything else is `/`. Never an address from the round trip: this is
 * checked when the sign-in starts and kept in the sealed cookie.
 */
/** The longest return path kept: the sealed cookie must stay well inside a browser's 4 KB, or it is dropped without a word. */
export const RETURN_PATH_LIMIT = 1024;

export function safeReturnPath(raw: string | undefined, origin: string): string {
  if (typeof raw !== "string" || raw === "" || raw.length > RETURN_PATH_LIMIT) return "/";
  try {
    const url = new URL(raw, origin);

    if (url.origin !== origin) return "/";
    const path = `${url.pathname.replace(/^\/+/, "/")}${url.search}${url.hash}`;

    return path.startsWith("/") && path.length <= RETURN_PATH_LIMIT ? path : "/";
  } catch {
    return "/";
  }
}
