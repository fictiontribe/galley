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
}

function keyOf(cookieKey: Uint8Array): Buffer {
  return Buffer.from(hkdfSync("sha256", cookieKey, Buffer.alloc(0), LABEL, 32));
}

export function sealPreLogin(cookieKey: Uint8Array, value: PreLogin): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyOf(cookieKey), iv);
  const plain = Buffer.from(JSON.stringify({ v: VERSION, ...value }), "utf8");
  const sealed = Buffer.concat([cipher.update(plain), cipher.final()]);

  return Buffer.concat([iv, sealed, cipher.getAuthTag()]).toString("base64url");
}

const TEXT = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;

/** The sign-in sealed in `value`, when it opens under this key and started at most ten minutes ago (and not ahead of this clock); else null. */
export function openPreLogin(cookieKey: Uint8Array, value: string | undefined, now = Date.now()): PreLogin | null {
  if (!value || value.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const raw = Buffer.from(value, "base64url");

    if (raw.length < 12 + 16 + 2) return null;
    const decipher = createDecipheriv("aes-256-gcm", keyOf(cookieKey), raw.subarray(0, 12));

    decipher.setAuthTag(raw.subarray(raw.length - 16));
    const plain = Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(plain) as Record<string, unknown>;

    if (parsed.v !== VERSION || !TEXT(parsed.state, 200) || !TEXT(parsed.nonce, 200) || !TEXT(parsed.verifier, 200) || !TEXT(parsed.returnTo, 2048)) return null;
    const startedAt = parsed.startedAt;

    if (typeof startedAt !== "number" || !Number.isSafeInteger(startedAt) || startedAt > now + 60_000 || now - startedAt > PRE_LOGIN_LIFETIME_MS) return null;
    return { state: parsed.state, nonce: parsed.nonce, verifier: parsed.verifier, returnTo: parsed.returnTo, startedAt };
  } catch {
    return null;
  }
}

/**
 * Where to go after signing in: a path on the editor's own origin, rebuilt
 * from its path, query and fragment with leading slashes collapsed;
 * anything else is `/`. Never an address from the round trip: this is
 * checked when the sign-in starts and kept in the sealed cookie.
 */
export function safeReturnPath(raw: string | undefined, origin: string): string {
  if (typeof raw !== "string" || raw === "" || raw.length > 2048) return "/";
  try {
    const url = new URL(raw, origin);

    if (url.origin !== origin) return "/";
    const path = `${url.pathname.replace(/^\/+/, "/")}${url.search}${url.hash}`;

    return path.startsWith("/") ? path : "/";
  } catch {
    return "/";
  }
}
