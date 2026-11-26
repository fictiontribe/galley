/**
 * Signing in through an identity provider (OpenID Connect): what the
 * operator set, read once when the server starts, from the server's
 * environment and nowhere else — never from the starting-values file, which
 * may sit where the site's own code can write. A variable that is wrong or
 * half-given stops the start, in a sentence that names it. The provider
 * itself is asked nothing here: its documents are read at the first sign-in.
 */
import type { AccountRole } from "@galley/core/install";
import { isLoopbackHost } from "../auth";

/** The algorithms an ID token may be signed with: one is chosen, never a list. */
export const ID_TOKEN_ALGS = ["RS256", "PS256", "ES256", "EdDSA"] as const;
export type IdTokenAlg = (typeof ID_TOKEN_ALGS)[number];

/** How long a session started through the provider lasts, by default and at most (hours). */
export const DEFAULT_SESSION_HOURS = 12;
export const MAX_SESSION_HOURS = 720;

export interface OidcConfig {
  /** The issuer exactly as given: the discovery document's `issuer` must equal it byte for byte. */
  issuer: string;
  /** Where the discovery document is read: the issuer with one trailing slash dropped, then `/.well-known/openid-configuration`. */
  discoveryUrl: string;
  clientId: string;
  /** Null: a public client, bound by PKCE alone. */
  clientSecret: string | null;
  idTokenAlg: IdTokenAlg;
  /** What the sign-in button says after "Sign in with". */
  name: string;
  /** The claim that carries the role here. */
  roleClaim: string;
  /** The role for a token with no role claim; null: such a sign-in is refused. Never owner. */
  defaultRole: Exclude<AccountRole, "owner"> | null;
  sessionHours: number;
  /** The subject of the first owner, read only while the install has no owner. */
  owner: string | null;
  /** The exact redirect address registered at the provider. */
  redirectUri: string;
  /** Tests only: an http:// issuer on this computer. */
  allowLoopbackHttp: boolean;
}

/** The variables, so a half-given set can be named. */
export const OIDC_ENV_NAMES = [
  "GALLEY_OIDC_ISSUER",
  "GALLEY_OIDC_CLIENT_ID",
  "GALLEY_OIDC_CLIENT_SECRET",
  "GALLEY_OIDC_ID_TOKEN_ALG",
  "GALLEY_OIDC_NAME",
  "GALLEY_OIDC_ROLE_CLAIM",
  "GALLEY_OIDC_DEFAULT_ROLE",
  "GALLEY_OIDC_SESSION_HOURS",
  "GALLEY_OIDC_OWNER",
  "GALLEY_OIDC_ONLY",
] as const;

/** A configuration that can't be used: the server doesn't start, and says this. */
export class OidcConfigError extends Error {}

export interface OidcConfigInput {
  env: NodeJS.ProcessEnv;
  mode: "local" | "hosted";
  /** The public address, and whether it came from the environment (or the server's own options) rather than the starting-values file. */
  publicUrl: URL | null;
  publicUrlFromEnvironment: boolean;
  /** Tests only: allow an http:// issuer on this computer. Never offered to an operator. */
  allowLoopbackHttp?: boolean;
}

function given(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = env[name]?.trim();

  return raw ? raw : undefined;
}

/** A subject as an ID token may carry one: 1 to 255 printable ASCII characters. */
export function validSubject(subject: unknown): subject is string {
  return typeof subject === "string" && /^[\x20-\x7e]{1,255}$/.test(subject);
}

/**
 * The provider configured in `input.env`, or null when none is. Throws an
 * OidcConfigError, in a sentence naming the variable, for anything wrong.
 * Local mode ignores the variables (it has no accounts) and says so through
 * `warnings`.
 */
export function readOidcConfig(input: OidcConfigInput, warnings: string[]): OidcConfig | null {
  const { env } = input;
  const set = OIDC_ENV_NAMES.filter((name) => given(env, name) !== undefined);

  if (set.length === 0) return null;
  if (input.mode === "local") {
    warnings.push(`${set.join(", ")} ${set.length === 1 ? "is" : "are"} ignored: signing in through an identity provider is for a hosted install, and this app has no accounts.`);
    return null;
  }
  const rawIssuer = given(env, "GALLEY_OIDC_ISSUER");

  if (!rawIssuer) throw new OidcConfigError(`${set.join(", ")} ${set.length === 1 ? "is" : "are"} set without GALLEY_OIDC_ISSUER. Set the provider's issuer (an https:// address), or unset ${set.length === 1 ? "it" : "them"}.`);
  let issuerUrl: URL;

  try {
    issuerUrl = new URL(rawIssuer);
  } catch {
    throw new OidcConfigError(`GALLEY_OIDC_ISSUER must be the provider's full issuer address, like https://id.example.com, not “${rawIssuer}”.`);
  }
  const loopbackHttp = Boolean(input.allowLoopbackHttp) && issuerUrl.protocol === "http:" && isLoopbackHost(issuerUrl.hostname);

  if (issuerUrl.protocol !== "https:" && !loopbackHttp) throw new OidcConfigError(`GALLEY_OIDC_ISSUER must start with https://, not “${issuerUrl.protocol}//”: the provider's keys and answers are only trusted over HTTPS.`);
  if (issuerUrl.username || issuerUrl.password || issuerUrl.search || issuerUrl.hash) {
    throw new OidcConfigError("GALLEY_OIDC_ISSUER must be the issuer address alone: no user name, password, query or fragment.");
  }
  if (env.GALLEY_OIDC_ONLY?.trim()) {
    throw new OidcConfigError("GALLEY_OIDC_ONLY can't be used with this version: passwords stay on beside the provider. Unset it.");
  }
  const clientId = given(env, "GALLEY_OIDC_CLIENT_ID");

  if (!clientId) throw new OidcConfigError("GALLEY_OIDC_ISSUER is set without GALLEY_OIDC_CLIENT_ID. Set this editor's client id at the provider.");
  if (clientId.length > 1024) throw new OidcConfigError("GALLEY_OIDC_CLIENT_ID is longer than 1024 characters: check it.");
  const rawAlg = given(env, "GALLEY_OIDC_ID_TOKEN_ALG") ?? "RS256";

  if (!(ID_TOKEN_ALGS as readonly string[]).includes(rawAlg)) throw new OidcConfigError(`GALLEY_OIDC_ID_TOKEN_ALG must be one of ${ID_TOKEN_ALGS.join(", ")}, not “${rawAlg}”.`);
  const roleClaim = given(env, "GALLEY_OIDC_ROLE_CLAIM") ?? "galley_role";

  if (!/^[\x21-\x7e]{1,200}$/.test(roleClaim)) throw new OidcConfigError(`GALLEY_OIDC_ROLE_CLAIM must be a claim's name: printable characters, no spaces, not “${roleClaim}”.`);
  const rawDefault = given(env, "GALLEY_OIDC_DEFAULT_ROLE");

  if (rawDefault === "owner") throw new OidcConfigError("GALLEY_OIDC_DEFAULT_ROLE can't be owner: an owner is someone the provider says is one. Use editor or contributor, or unset it.");
  if (rawDefault !== undefined && rawDefault !== "editor" && rawDefault !== "contributor") {
    throw new OidcConfigError(`GALLEY_OIDC_DEFAULT_ROLE must be editor or contributor, not “${rawDefault}”.`);
  }
  const rawHours = given(env, "GALLEY_OIDC_SESSION_HOURS");
  const sessionHours = rawHours === undefined ? DEFAULT_SESSION_HOURS : Number(rawHours);

  if (!Number.isInteger(sessionHours) || sessionHours < 1 || sessionHours > MAX_SESSION_HOURS) {
    throw new OidcConfigError(`GALLEY_OIDC_SESSION_HOURS must be a whole number of hours from 1 to ${MAX_SESSION_HOURS}, not “${rawHours}”.`);
  }
  const owner = given(env, "GALLEY_OIDC_OWNER") ?? null;

  if (owner !== null && !validSubject(owner)) throw new OidcConfigError("GALLEY_OIDC_OWNER must be the owner's subject at the provider: 1 to 255 printable characters.");
  // The redirect address, the __Host- cookies and the allowed host all follow the public address: it must be HTTPS, and the operator's own.
  if (!input.publicUrl) throw new OidcConfigError("GALLEY_OIDC_ISSUER needs GALLEY_PUBLIC_URL: the provider sends people back to an address on it. Set it to the https:// address people use.");
  if (!input.publicUrlFromEnvironment) {
    throw new OidcConfigError("With GALLEY_OIDC_ISSUER set, GALLEY_PUBLIC_URL must be set in the server's environment, not only as the starting-values file's address.");
  }
  if (input.publicUrl.protocol !== "https:") {
    throw new OidcConfigError("With GALLEY_OIDC_ISSUER set, GALLEY_PUBLIC_URL must start with https://: the sign-in cookies are __Host- cookies, which need HTTPS.");
  }
  const name = given(env, "GALLEY_OIDC_NAME") ?? issuerUrl.hostname;

  if (name.length > 100 || /[\x00-\x1f\x7f<>]/.test(name)) throw new OidcConfigError("GALLEY_OIDC_NAME must be at most 100 characters, with no angle brackets or control characters.");
  const clientSecret = given(env, "GALLEY_OIDC_CLIENT_SECRET") ?? null;

  return {
    issuer: rawIssuer,
    discoveryUrl: `${rawIssuer.endsWith("/") ? rawIssuer.slice(0, -1) : rawIssuer}/.well-known/openid-configuration`,
    clientId,
    clientSecret,
    idTokenAlg: rawAlg as IdTokenAlg,
    name,
    roleClaim,
    defaultRole: (rawDefault as "editor" | "contributor" | undefined) ?? null,
    sessionHours,
    owner,
    redirectUri: `${input.publicUrl.origin}/api/auth/oidc/callback`,
    allowLoopbackHttp: loopbackHttp,
  };
}
