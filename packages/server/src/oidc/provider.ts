/**
 * The identity provider, as the editor talks to it: three kinds of call and
 * no others — its discovery document, its keys, and its token endpoint —
 * each only to an address in the issuer's own discovery document, over
 * HTTPS, following no redirect, with a timeout, and read up to 64 KB, the
 * bound enforced on the stream while it is read. The protocol and the
 * signature checks are the library's (oauth4webapi); the editor's own
 * stricter checks of the ID token are here, and every one is asserted by
 * its tests whichever library does it.
 *
 * Nothing is asked at start. The discovery document is read at the first
 * sign-in and kept; after a failure it is read again at the next sign-in,
 * at most once every few seconds.
 */
import { createPublicKey, verify, constants, type JsonWebKey } from "node:crypto";
import * as oauth from "oauth4webapi";
import { ACCOUNT_ROLES, type AccountRole } from "@galley/core/install";
import { validSubject, type OidcConfig } from "./config";

/** The most of any one answer the editor reads. */
export const ANSWER_LIMIT_BYTES = 64 * 1024;
/** How long one call to the provider may take, answer included. */
export const PROVIDER_TIMEOUT_MS = 10_000;
/** After a failed read of the provider's documents, the next try waits this long at least. */
export const RETRY_AFTER_FAILURE_MS = 5_000;
/** How old an ID token may be. */
export const ID_TOKEN_MAX_AGE_S = 10 * 60;
/** Leeway on every time in a token. */
export const CLOCK_LEEWAY_S = 60;

/** Why a sign-in through the provider was refused: each is a sentence on the sign-in page (`?signin=<code>`). */
export type OidcRefusalCode =
  | "provider-unreachable"
  | "provider-no-pkce"
  | "provider-misconfigured"
  | "refused-state"
  | "another-tab"
  | "provider-error"
  | "provider-cancelled"
  | "refused-token"
  | "no-role"
  | "bad-role"
  | "removed"
  | "switched-off"
  | "signed-out"
  | "full"
  | "too-many";

/** A refusal: its code for the page, and one line for the log (never a token, a code or a secret). */
export class OidcRefusal extends Error {
  constructor(
    readonly code: OidcRefusalCode,
    readonly logLine: string
  ) {
    super(logLine);
  }
}

/** An answer past the bound, stopped while it was being read. */
class AnswerTooLarge extends Error {}

/**
 * The editor's one way to call the provider: no redirect, a timeout over the
 * whole call, and at most ANSWER_LIMIT_BYTES read, counted as it arrives.
 */
export async function boundedFetch(url: string, init: RequestInit = {}, timeoutMs = PROVIDER_TIMEOUT_MS): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs);
  const response = await fetch(url, { ...init, redirect: "error", signal });
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) break;
      total += value.byteLength;
      if (total > ANSWER_LIMIT_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new AnswerTooLarge(`the answer from ${new URL(url).host} was larger than ${ANSWER_LIMIT_BYTES / 1024} KB`);
      }
      chunks.push(value);
    }
  }
  const body = response.status === 204 || response.status === 304 ? null : Buffer.concat(chunks);

  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/** Cut to a length and stripped of control characters: what the provider says, made safe for one log line. */
export function forTheLog(text: unknown, max = 200): string {
  const plain = typeof text === "string" ? text.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, " ") : "";

  return plain.length > max ? `${plain.slice(0, max)}…` : plain;
}

/** What a failed call to the provider was, in words for the log. */
function describe(error: unknown): string {
  if (error instanceof AnswerTooLarge) return error.message;
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return `no answer within ${PROVIDER_TIMEOUT_MS / 1000} seconds`;
  if (error instanceof TypeError && /redirect/i.test(String(error.cause ?? error.message))) return "it answered with a redirect, which isn't followed";
  // The error code only: a provider may echo the code it refused in its description.
  if (error instanceof oauth.ResponseBodyError) return `it answered ${error.status}: ${forTheLog(error.error, 60)}`;
  if (error instanceof oauth.OperationProcessingError) return forTheLog(error.message);
  return forTheLog(error instanceof Error ? (error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message) : String(error));
}

/** The claims of a checked ID token that the editor uses: nothing else of it is kept. */
export interface CheckedSignIn {
  subject: string;
  name: string | null;
  /** Only when `email_verified` is the boolean true. */
  email: string | null;
  /** From the role claim; null: the token has none (the default role, if any, is the caller's to apply). */
  role: AccountRole | null;
  /** `iat`, in ms. */
  issuedAt: number;
  /** The signing key's id, for the log. */
  keyId: string | null;
}

export interface OidcProvider {
  readonly config: OidcConfig;
  /**
   * Where to send the browser to sign in: the provider's authorization
   * endpoint with this sign-in's `state`, `nonce` and PKCE challenge. Reads
   * the discovery document first if it isn't kept yet; refuses when the
   * provider can't be reached or doesn't say it enforces PKCE (S256) and no
   * client secret is set.
   */
  authorizationUrl(input: { state: string; nonce: string; verifier: string }): Promise<string>;
  /**
   * The callback's answer: `iss` checked, a provider's `error` refused with a
   * fixed code, the code exchanged with the verifier, and the ID token
   * checked in full. Throws an OidcRefusal for anything wrong.
   */
  finish(params: URLSearchParams, expected: { state: string; nonce: string; verifier: string }): Promise<CheckedSignIn>;
  /** The discovery document says the provider sends `iss` in its answers (RFC 9207). */
  readonly sendsIssuer: boolean | null;
  /**
   * A back-channel logout token, checked in full: signed as an ID token is
   * (the same keys, the one algorithm, a key that fits it), for this editor
   * alone, the logout event, `iat` and `jti` present, no `nonce`, `exp` (when
   * present) in the future, no older than 30 days, and a subject. Throws a
   * LogoutRefusal; `retry` when it couldn't be checked now (the provider's
   * keys unreachable), not when it is bad.
   */
  checkLogoutToken(token: string): Promise<{ subject: string; issuedAt: number; keyId: string | null }>;
}

/** A logout token that isn't good (`retry` false), or couldn't be checked now (`retry` true). The reason is for the log only. */
export class LogoutRefusal extends Error {
  constructor(
    readonly reason: string,
    readonly retry = false
  ) {
    super(reason);
  }
}

/** The event a logout token must carry. */
export const LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";
/** The oldest logout token taken: the longest a session lasts. */
export const LOGOUT_TOKEN_MAX_AGE_S = 30 * 24 * 60 * 60;
/** The provider's keys are read again for a key id they don't have at most this often, and every five minutes anyway. */
const KEYS_REFRESH_FOR_UNKNOWN_KID_MS = 60_000;
const KEYS_KEPT_MS = 5 * 60_000;
/** After a failed read of the keys, they aren't asked for again for this long: a failing address isn't fetched on every logout. */
const KEYS_RETRY_AFTER_FAILURE_MS = 5_000;
/** While the keys can't be read, the last good ones are used if they are no older than this. */
const KEYS_LAST_GOOD_MS = 60 * 60_000;
/** The smallest RSA key a logout token is taken from. */
export const MIN_RSA_BITS = 2048;

type Jwk = JsonWebKey & { kid?: string; alg?: string; use?: string; key_ops?: string[] };

/** The key type (and curve) each of the four algorithms takes. */
const KEY_FOR: Record<string, { kty: string; crv?: string }> = { RS256: { kty: "RSA" }, PS256: { kty: "RSA" }, ES256: { kty: "EC", crv: "P-256" }, EdDSA: { kty: "OKP", crv: "Ed25519" } };

/** A JWS `typ` compared as RFC 7515 4.1.9 says: without regard to case, `application/` added to one with no slash. */
function mediaType(typ: string): string {
  const lower = typ.toLowerCase();

  return lower.includes("/") ? lower : `application/${lower}`;
}

/** Verifies a compact JWS signature with a public JWK, for one of the four algorithms. An RSA key under MIN_RSA_BITS is never used. */
function signatureHolds(alg: string, jwk: Jwk, input: string, signature: Buffer): boolean {
  const key = createPublicKey({ key: jwk, format: "jwk" });
  const data = Buffer.from(input);

  if (key.asymmetricKeyType === "rsa" || key.asymmetricKeyType === "rsa-pss") {
    if ((key.asymmetricKeyDetails?.modulusLength ?? 0) < MIN_RSA_BITS) throw new LogoutRefusal(`its key is an RSA key under ${MIN_RSA_BITS} bits`);
  }

  if (alg === "RS256") return verify("sha256", data, key, signature);
  if (alg === "PS256") return verify("sha256", data, { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, signature);
  if (alg === "ES256") return verify("sha256", data, { key, dsaEncoding: "ieee-p1363" }, signature);
  if (alg === "EdDSA") return verify(null, data, key, signature);
  return false;
}

/** The fixed sentence code for an `error` the provider sent; its own text is never shown. */
function errorCode(error: string): OidcRefusalCode {
  return error === "access_denied" ? "provider-cancelled" : "provider-error";
}

export function createOidcProvider(config: OidcConfig, now: () => number = () => Date.now()): OidcProvider {
  let discovered: oauth.AuthorizationServer | null = null;
  let failedAt = Number.NEGATIVE_INFINITY;
  let reading: Promise<oauth.AuthorizationServer> | null = null;
  /** The provider's keys as last read, which the library keeps here: how many there are decides whether a kid is required. */
  const jwks: { jwks?: { keys: unknown[] }; uat?: number } = {};
  const client: oauth.Client = { client_id: config.clientId, id_token_signed_response_alg: config.idTokenAlg, [oauth.clockTolerance]: CLOCK_LEEWAY_S };
  const clientAuth = config.clientSecret ? oauth.ClientSecretBasic(config.clientSecret) : oauth.None();
  const http = { [oauth.customFetch]: boundedFetch, ...(config.allowLoopbackHttp ? { [oauth.allowInsecureRequests]: true } : {}) };
  const secure = (raw: unknown, what: string): string => {
    let url: URL;

    try {
      url = new URL(String(raw));
    } catch {
      throw new OidcRefusal("provider-misconfigured", `The provider's discovery document has no usable ${what}.`);
    }
    if (url.protocol !== "https:" && !(config.allowLoopbackHttp && url.protocol === "http:")) throw new OidcRefusal("provider-misconfigured", `The provider's ${what} isn't an https:// address, so it isn't used.`);
    return url.href;
  };

  async function read(): Promise<oauth.AuthorizationServer> {
    let response: Response;

    try {
      response = await boundedFetch(config.discoveryUrl, { headers: { accept: "application/json" } });
    } catch (error) {
      throw new OidcRefusal("provider-unreachable", `The provider's discovery document couldn't be read: ${describe(error)}.`);
    }
    if (!response.ok) throw new OidcRefusal("provider-unreachable", `The provider's discovery document couldn't be read: it answered ${response.status}.`);
    let document: Record<string, unknown>;

    try {
      document = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new OidcRefusal("provider-misconfigured", "The provider's discovery document isn't JSON.");
    }
    if (typeof document !== "object" || document === null || Array.isArray(document)) throw new OidcRefusal("provider-misconfigured", "The provider's discovery document isn't a JSON object.");
    const issuer = document.issuer;

    if (issuer !== config.issuer) {
      const slash = typeof issuer === "string" && (issuer === `${config.issuer}/` || `${issuer}/` === config.issuer);

      throw new OidcRefusal(
        "provider-misconfigured",
        slash
          ? `The provider calls itself “${forTheLog(issuer)}” and GALLEY_OIDC_ISSUER is “${config.issuer}”: they differ only by the trailing slash, and must be the same byte for byte. Set GALLEY_OIDC_ISSUER to exactly the provider's issuer.`
          : `The provider's discovery document names another issuer (“${forTheLog(issuer)}”), not GALLEY_OIDC_ISSUER, so it isn't trusted.`
      );
    }
    const methods = document.code_challenge_methods_supported;

    // The editor can't see whether a provider enforces PKCE: it must say so, or a client secret must bind the code.
    if (!(Array.isArray(methods) && methods.includes("S256")) && !config.clientSecret) {
      throw new OidcRefusal("provider-no-pkce", "The provider's discovery document doesn't list S256 in code_challenge_methods_supported, and no client secret is set, so a leaked code could be used by someone else. Sign-ins through it are refused until one of the two is true.");
    }
    return {
      issuer: config.issuer,
      authorization_endpoint: secure(document.authorization_endpoint, "authorization endpoint"),
      token_endpoint: secure(document.token_endpoint, "token endpoint"),
      jwks_uri: secure(document.jwks_uri, "keys address (jwks_uri)"),
      ...(Array.isArray(methods) ? { code_challenge_methods_supported: methods.filter((one): one is string => typeof one === "string") } : {}),
      ...(document.authorization_response_iss_parameter_supported === true ? { authorization_response_iss_parameter_supported: true } : {}),
    };
  }

  /** The discovery document: kept once read; after a failure read again, but not more than once every few seconds. */
  async function server(): Promise<oauth.AuthorizationServer> {
    if (discovered) return discovered;
    if (now() - failedAt < RETRY_AFTER_FAILURE_MS) throw new OidcRefusal("provider-unreachable", "The provider couldn't be reached a moment ago; it isn't asked again yet.");
    reading ??= read().finally(() => {
      reading = null;
    });
    try {
      discovered = await reading;
      return discovered;
    } catch (error) {
      failedAt = now();
      throw error;
    }
  }

  /** The provider's keys for logout tokens: kept five minutes, read again for an unknown key id at most once a minute. */
  let logoutKeys: { keys: Jwk[]; at: number } | null = null;
  let readingKeys: Promise<Jwk[]> | null = null;
  let keysFailedAt = Number.NEGATIVE_INFINITY;

  /**
   * The provider's keys for a logout token naming `kid`, and whether they
   * were read just now. Kept five minutes, read again for an unknown key id
   * at most once a minute. When a read fails, it isn't tried again for a few
   * seconds, and meanwhile the last good keys are used if they are under an
   * hour old; otherwise the logout is to be sent again (retry).
   */
  async function keysFor(kid: string | undefined): Promise<{ keys: Jwk[]; readNow: boolean }> {
    const fresh = logoutKeys && now() - logoutKeys.at < KEYS_KEPT_MS;
    const known = (keys: Jwk[]) => kid === undefined || keys.some((key) => key.kid === kid);
    const lastGood = () => (logoutKeys && now() - logoutKeys.at < KEYS_LAST_GOOD_MS ? logoutKeys.keys : null);

    if (fresh && (known(logoutKeys!.keys) || now() - logoutKeys!.at < KEYS_REFRESH_FOR_UNKNOWN_KID_MS)) return { keys: logoutKeys!.keys, readNow: false };
    if (now() - keysFailedAt < KEYS_RETRY_AFTER_FAILURE_MS) {
      const keys = lastGood();

      if (keys) return { keys, readNow: false };
      throw new LogoutRefusal("the provider's keys couldn't be read a moment ago; they aren't asked for again yet", true);
    }
    const reading = (readingKeys ??= (async () => {
      const as = await server();
      let response: Response;

      try {
        response = await boundedFetch(as.jwks_uri!, { headers: { accept: "application/json, application/jwk-set+json" } });
      } catch (error) {
        throw new LogoutRefusal(`the provider's keys couldn't be read: ${describe(error)}`, true);
      }
      if (!response.ok) throw new LogoutRefusal(`the provider's keys couldn't be read: it answered ${response.status}`, true);
      const body = (await response.json().catch(() => null)) as { keys?: unknown } | null;

      if (!body || !Array.isArray(body.keys)) throw new LogoutRefusal("the provider's keys aren't a JSON Web Key Set", true);
      logoutKeys = { keys: body.keys.filter((key): key is Jwk => typeof key === "object" && key !== null && !Array.isArray(key)), at: now() };
      return logoutKeys.keys;
    })().finally(() => {
      readingKeys = null;
    }));

    try {
      return { keys: await reading, readNow: true };
    } catch (error) {
      keysFailedAt = now();
      const keys = lastGood();

      // The keys address failing for a while doesn't stop logouts the keys in hand can check.
      if (keys) return { keys, readNow: false };
      throw error;
    }
  }

  /** A failure talking to the provider: read its documents again at a later sign-in, not within the next few seconds. */
  function forget(): void {
    discovered = null;
    failedAt = now();
    delete jwks.jwks;
    delete jwks.uat;
  }

  return {
    config,
    async checkLogoutToken(token) {
      const refuse = (why: string): never => {
        throw new LogoutRefusal(why);
      };
      const parts = token.split(".");

      // An encrypted token (five parts) is refused: the editor registers no encryption.
      if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]*$/.test(part))) refuse(parts.length === 5 ? "it is encrypted" : "it isn't a signed JWT");
      const [rawHeader, rawPayload, rawSignature] = parts as [string, string, string];
      let header: Record<string, unknown>;
      let claims: Record<string, unknown>;

      try {
        header = JSON.parse(Buffer.from(rawHeader, "base64url").toString("utf8")) as Record<string, unknown>;
        claims = JSON.parse(Buffer.from(rawPayload, "base64url").toString("utf8")) as Record<string, unknown>;
      } catch {
        return refuse("it isn't a signed JWT");
      }
      if (typeof header !== "object" || header === null || typeof claims !== "object" || claims === null || Array.isArray(claims)) refuse("it isn't a signed JWT");
      // One algorithm, the configured one: never none, never the HMAC family. jwk, jku, x5u and x5c in the header are never used.
      if (header.alg !== config.idTokenAlg) refuse(`it is signed with ${forTheLog(header.alg, 20)}, not ${config.idTokenAlg}`);
      if (header.typ !== undefined && (typeof header.typ !== "string" || !["application/logout+jwt", "application/jwt"].includes(mediaType(header.typ)))) refuse(`its typ (${forTheLog(header.typ, 40)}) isn't a logout token's`);
      if (header.crit !== undefined) refuse("it has critical header parameters this editor doesn't know");
      const kid = typeof header.kid === "string" ? header.kid : header.kid === undefined ? undefined : refuse("its kid isn't a string");
      const { keys: published, readNow } = await keysFor(kid);

      // A key id the provider's keys don't have yet (a key just rotated in, read again only once a minute): sent again later, not refused for good.
      if (kid !== undefined && !readNow && !published.some((key) => key.kid === kid)) throw new LogoutRefusal("its key (kid) isn't among the provider's keys as last read; they are read again within a minute", true);
      const fit = KEY_FOR[config.idTokenAlg]!;
      const candidates = published.filter(
        (key) =>
          key.kty === fit.kty &&
          (fit.crv === undefined || key.crv === fit.crv) &&
          (kid === undefined || key.kid === kid) &&
          (key.alg === undefined || key.alg === config.idTokenAlg) &&
          (key.use === undefined || key.use === "sig") &&
          (key.key_ops === undefined || (Array.isArray(key.key_ops) && key.key_ops.includes("verify")))
      );

      if (kid === undefined && published.length > 1) refuse("it names no key (kid), and the provider publishes more than one");
      if (candidates.length !== 1) refuse(candidates.length === 0 ? "no key the provider publishes fits it" : "more than one published key fits it");
      let holds = false;

      try {
        holds = signatureHolds(config.idTokenAlg, candidates[0]!, `${rawHeader}.${rawPayload}`, Buffer.from(rawSignature, "base64url"));
      } catch (error) {
        if (error instanceof LogoutRefusal) throw error;
        holds = false;
      }
      if (!holds) refuse("its signature doesn't hold");
      const at = Math.floor(now() / 1000);
      const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      const events = claims.events as Record<string, unknown> | undefined;

      if (claims.iss !== config.issuer) refuse("it is from another issuer");
      if (audiences.length !== 1 || audiences[0] !== config.clientId) refuse("its audience isn't this editor alone");
      if (claims.azp !== undefined && claims.azp !== config.clientId) refuse("it was issued to another party (azp)");
      if (typeof events !== "object" || events === null || Array.isArray(events) || !Object.hasOwn(events, LOGOUT_EVENT) || typeof events[LOGOUT_EVENT] !== "object" || events[LOGOUT_EVENT] === null) {
        refuse("it doesn't carry the back-channel logout event");
      }
      if (typeof claims.iat !== "number" || !Number.isFinite(claims.iat)) refuse("it has no iat");
      if (typeof claims.jti !== "string" || claims.jti === "") refuse("it has no jti");
      if (Object.hasOwn(claims, "nonce")) refuse("it has a nonce, which a logout token never has");
      if (claims.exp !== undefined && (typeof claims.exp !== "number" || claims.exp <= at - CLOCK_LEEWAY_S)) refuse("it has expired");
      if ((claims.iat as number) > at + CLOCK_LEEWAY_S) refuse("it is issued in the future");
      if (at - (claims.iat as number) > LOGOUT_TOKEN_MAX_AGE_S) refuse("it is older than 30 days");
      // The editor keeps no provider session ids: a logout naming only one (sid) can't be done, and is refused as failed.
      if (claims.sub === undefined) refuse(claims.sid !== undefined ? "it names only a provider session (sid), not a subject" : "it has no subject");
      if (!validSubject(claims.sub)) refuse("its subject isn't 1 to 255 printable characters");
      return { subject: claims.sub as string, issuedAt: (claims.iat as number) * 1000, keyId: kid === undefined ? null : forTheLog(kid, 100) };
    },
    get sendsIssuer() {
      return discovered ? discovered.authorization_response_iss_parameter_supported === true : null;
    },

    async authorizationUrl({ state, nonce, verifier }) {
      const as = await server();
      const url = new URL(as.authorization_endpoint!);

      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", config.redirectUri);
      url.searchParams.set("scope", "openid profile email");
      url.searchParams.set("state", state);
      url.searchParams.set("nonce", nonce);
      url.searchParams.set("code_challenge", await oauth.calculatePKCECodeChallenge(verifier));
      url.searchParams.set("code_challenge_method", "S256");
      return url.href;
    },

    async finish(params, expected) {
      const as = await server();
      const iss = params.get("iss");

      // RFC 9207: whenever it is present it must be this issuer; where the provider says it sends it, it must be present.
      if (iss !== null && iss !== config.issuer) throw new OidcRefusal("refused-state", `The answer came from another issuer (“${forTheLog(iss)}”).`);
      if (iss === null && as.authorization_response_iss_parameter_supported === true) throw new OidcRefusal("refused-state", "The answer has no iss, which this provider says it always sends.");
      // Only now is an error from the provider read: shown as a fixed sentence, its own words only logged.
      const error = params.get("error");

      if (error !== null) throw new OidcRefusal(errorCode(error), `The provider refused the sign-in: ${forTheLog(error, 60)}${params.get("error_description") ? ` (${forTheLog(params.get("error_description"))})` : ""}.`);
      let callback: URLSearchParams;

      try {
        callback = oauth.validateAuthResponse(as, client, params, expected.state);
      } catch (failure) {
        throw new OidcRefusal("refused-state", `The provider's answer couldn't be used: ${describe(failure)}.`);
      }
      let response: Response;

      try {
        response = await oauth.authorizationCodeGrantRequest(as, client, clientAuth, callback, config.redirectUri, expected.verifier, http);
      } catch (failure) {
        forget();
        throw new OidcRefusal("provider-unreachable", `The code couldn't be exchanged at the token endpoint: ${describe(failure)}.`);
      }
      let result: oauth.TokenEndpointResponse;

      try {
        // The nonce check is not optional: it still refuses a leaked code when a provider ignores PKCE.
        result = await oauth.processAuthorizationCodeResponse(as, client, response, { expectedNonce: expected.nonce, requireIdToken: true });
        await oauth.validateApplicationLevelSignature(as, response, { ...http, [oauth.jwksCache]: jwks as oauth.JWKSCacheInput });
      } catch (failure) {
        if (failure instanceof oauth.ResponseBodyError) throw new OidcRefusal("refused-token", `The token endpoint refused the code: ${describe(failure)}.`);
        if (failure instanceof TypeError || failure instanceof AnswerTooLarge || (failure instanceof Error && failure.name === "TimeoutError")) forget();
        throw new OidcRefusal(failure instanceof AnswerTooLarge ? "provider-unreachable" : "refused-token", `The ID token was refused: ${describe(failure)}.`);
      }
      const claims = oauth.getValidatedIdTokenClaims(result)!;
      const header = JSON.parse(Buffer.from(String(result.id_token).split(".")[0]!, "base64url").toString("utf8")) as { alg?: unknown; kid?: unknown };
      const refuse = (why: string): never => {
        throw new OidcRefusal("refused-token", `The ID token was refused: ${why}.`);
      };
      const at = Math.floor(now() / 1000);

      if (header.alg !== config.idTokenAlg) refuse(`it is signed with ${forTheLog(header.alg, 20)}, not ${config.idTokenAlg}`);
      // A kid is required whenever the provider publishes more than one key.
      if ((jwks.jwks?.keys.length ?? 0) > 1 && typeof header.kid !== "string") refuse("it names no key (kid), and the provider publishes more than one");
      // This editor's client id and nothing else; azp, when present, the same.
      const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];

      if (audiences.length !== 1 || audiences[0] !== config.clientId) refuse("its audience isn't this editor alone");
      if (claims.azp !== undefined && claims.azp !== config.clientId) refuse("it was issued to another party (azp)");
      if (typeof claims.iat !== "number" || claims.iat > at + CLOCK_LEEWAY_S) refuse("it is issued in the future");
      if (at - (claims.iat as number) > ID_TOKEN_MAX_AGE_S) refuse(`it is older than ${ID_TOKEN_MAX_AGE_S / 60} minutes`);
      if (typeof claims.nonce !== "string" || claims.nonce !== expected.nonce) refuse("its nonce isn't this sign-in's");
      // It is logged and shown to owners: a newline in it would forge log lines.
      if (!validSubject(claims.sub)) refuse("its subject isn't 1 to 255 printable characters");
      // The token's own claim only, whatever the claim is called.
      const rawRole = Object.hasOwn(claims, config.roleClaim) ? (claims as Record<string, unknown>)[config.roleClaim] : undefined;
      let role: AccountRole | null = null;

      if (rawRole !== undefined) {
        // Anything present that isn't exactly a role is a refusal, never the default role.
        if (typeof rawRole !== "string" || !(ACCOUNT_ROLES as readonly string[]).includes(rawRole)) throw new OidcRefusal("bad-role", `The ID token's ${config.roleClaim} claim isn't exactly owner, editor or contributor.`);
        role = rawRole as AccountRole;
      }
      const email = claims.email_verified === true && typeof claims.email === "string" ? claims.email : null;
      const name = typeof claims.name === "string" ? claims.name : null;

      return { subject: claims.sub, name, email, role, issuedAt: (claims.iat as number) * 1000, keyId: typeof header.kid === "string" ? forTheLog(header.kid, 100) : null };
    },
  };
}
