/**
 * Signing in through the identity provider (OpenID Connect, authorization
 * code flow with PKCE): the two routes a browser is sent through. Both are
 * top-level navigations, so every answer is a redirect, never JSON: on to
 * the provider, back to where the person was, or to the sign-in page with a
 * short code (`/login?signin=<code>`) the page turns into its sentence.
 *
 * Without a provider configured neither route exists (404).
 */
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import * as oauth from "oauth4webapi";
import { ROLE_NAMES, type AccountRole } from "@galley/core/install";
import { signInAs } from "../accounts-routes";
import { clientAddress, clientKeyOf, LoginLimiter, sameSignature } from "../auth";
import { notFound } from "../errors";
import type { RouteContext, RouteTable } from "../routes";
import { audit, named } from "../who";
import { openPreLogin, PRE_LOGIN_COOKIE, PRE_LOGIN_LIFETIME_MS, safeReturnPath, sealPreLogin } from "./cookie";
import { LogoutRefusal, OidcRefusal, type OidcProvider, type OidcRefusalCode } from "./provider";

export type OidcRouteKey = "GET /api/auth/oidc/start" | "GET /api/auth/oidc/callback" | "POST /api/auth/oidc/backchannel-logout";

/** The back-channel logout's one path: exempt from the origin check by exactly this, never a prefix (app.ts). */
export const BACKCHANNEL_LOGOUT_PATH = "/api/auth/oidc/backchannel-logout";
/** Its body's cap, applied before the general limit. A logout token is a few hundred bytes. */
export const BACKCHANNEL_BODY_LIMIT_BYTES = 16 * 1024;
/** What the provider is asked to wait before sending a logout again. */
export const LOGOUT_RETRY_AFTER_S = 30;
/** Refused logout tokens are logged at most this many times a minute in all, and once a minute per client. */
export const LOGOUT_REFUSALS_LOGGED_PER_MINUTE = 30;

/** Sign-ins a client may start in a minute: enough for people, too few to make the editor hammer the provider. */
export const STARTS_PER_MINUTE = 20;
/** `state` values remembered as used, at most (each for ten minutes). */
const USED_STATES_KEPT = 10_000;

/** A refusal that counts nothing is logged at most this often per client: an image tag in a page left open can't fill the log. */
export const QUIET_LOG_MS = 60_000;
/** Clients whose last quiet line is remembered, at most. */
const QUIET_CLIENTS_KEPT = 10_000;

interface OidcLimits {
  /** Refused logout tokens logged in the current minute, in all. */
  logoutLines: { since: number; count: number };
  starts: LoginLimiter;
  /** When each client's last uncounted refusal was logged. */
  quiet: Map<string, number>;
  /** Each `state` accepted at a callback, until it could no longer be: a copied cookie value is refused the second time. */
  used: Map<string, number>;
}

const limitsByApp = new WeakMap<RouteContext, OidcLimits>();

function limitsOf(ctx: RouteContext): OidcLimits {
  let limits = limitsByApp.get(ctx);

  if (!limits) {
    limits = { logoutLines: { since: 0, count: 0 }, starts: new LoginLimiter(STARTS_PER_MINUTE, 60_000), used: new Map(), quiet: new Map() };
    limitsByApp.set(ctx, limits);
  }
  return limits;
}

function providerOf(ctx: RouteContext): OidcProvider {
  const provider = ctx.options.mode === "hosted" && ctx.options.install ? (ctx.options.oidc ?? null) : null;

  if (!provider) throw notFound("Not found.");
  return provider;
}

/** The sign-in page, with the reason a sign-in was refused. */
function toSignIn(c: Context, code: OidcRefusalCode, extra: Record<string, string> = {}): Response {
  return c.redirect(`/login?${new URLSearchParams({ signin: code, ...extra }).toString()}`, 303);
}

/** Refusals that say something is wrong with the provider or this server, not with the browser: they don't count against it. */
const NOT_THE_BROWSERS: ReadonlySet<OidcRefusalCode> = new Set(["provider-unreachable", "provider-no-pkce", "provider-misconfigured", "too-many"]);

/** Whether an uncounted refusal from this client is logged now: once a minute at most. */
function quietly(ctx: RouteContext, client: string, now = Date.now()): boolean {
  const { quiet } = limitsOf(ctx);
  const last = quiet.get(client);

  if (last !== undefined && now - last < QUIET_LOG_MS) return false;
  quiet.delete(client);
  if (quiet.size >= QUIET_CLIENTS_KEPT) {
    for (const [key, at] of quiet) if (now - at >= QUIET_LOG_MS) quiet.delete(key);
    // Still full of clients refused this minute: the oldest goes.
    if (quiet.size >= QUIET_CLIENTS_KEPT) quiet.delete(quiet.keys().next().value!);
  }
  quiet.set(client, now);
  return true;
}

/** Whether a refused logout token is logged now: once a minute per client, and a few a minute in all (no limiter stands in front of the route). */
function logoutLineAllowed(ctx: RouteContext, client: string, now = Date.now()): boolean {
  const { logoutLines } = limitsOf(ctx);

  if (now - logoutLines.since >= 60_000) {
    logoutLines.since = now;
    logoutLines.count = 0;
  }
  if (logoutLines.count >= LOGOUT_REFUSALS_LOGGED_PER_MINUTE || !quietly(ctx, `logout ${client}`, now)) return false;
  logoutLines.count += 1;
  return true;
}

/** An answer to the provider's server: JSON or nothing, never kept by anything on the way. */
function forProvider(c: Context, status: 200 | 400 | 404 | 503, body: { error: string } | null): Response {
  const headers: Record<string, string> = { "cache-control": "no-store", ...(status === 503 ? { "retry-after": String(LOGOUT_RETRY_AFTER_S) } : {}) };

  return body === null ? c.body(null, status, headers) : c.json(body, status, headers);
}

/** What a restore answers the provider: it sends the logout again, after the backup is back (one written now would be overwritten). */
export function logoutDuringRestore(c: Context): Response {
  return forProvider(c, 503, { error: "temporarily_unavailable" });
}

function clearPreLogin(c: Context): void {
  deleteCookie(c, PRE_LOGIN_COOKIE, { path: "/", secure: true });
}

export const oidcRoutes: Pick<RouteTable, OidcRouteKey> = {
  "GET /api/auth/oidc/start": async (c, ctx) => {
    const provider = providerOf(ctx);
    const client = clientKeyOf(c, Boolean(ctx.options.trustProxy));
    const { starts } = limitsOf(ctx);

    if (starts.blocked(client)) {
      if (quietly(ctx, client)) audit(ctx, `A sign-in through ${provider.config.name} from ${clientAddress(c, Boolean(ctx.options.trustProxy))} wasn't started: too many in a minute.`);
      return toSignIn(c, "too-many");
    }
    // Counted only when a browser navigates here: an image or a fetch from another page can't use up a client's starts.
    // A script can send any Sec-Fetch-Mode, or none, and so start without being counted; that gains it nothing a
    // stranger lacks: a start reads only what the provider publishes for anyone, once (it is kept), and makes a
    // sealed cookie for that script alone. The limit is there so pages elsewhere can't make browsers hammer it.
    const mode = c.req.header("sec-fetch-mode");

    if (mode === undefined || mode === "navigate") starts.fail(client);
    const origin = ctx.options.publicOrigin ?? new URL(c.req.url).origin;
    const returnTo = safeReturnPath(c.req.query("return"), origin);
    const state = oauth.generateRandomState();
    const nonce = oauth.generateRandomNonce();
    const verifier = oauth.generateRandomCodeVerifier();
    let to: string;

    try {
      to = await provider.authorizationUrl({ state, nonce, verifier });
    } catch (error) {
      if (!(error instanceof OidcRefusal)) throw error;
      audit(ctx, `A sign-in through ${provider.config.name} couldn't be started: ${error.logLine}`);
      return toSignIn(c, error.code);
    }
    // Lax: it comes back on the provider's redirect, a top-level navigation from another site. The session cookie stays Strict.
    setCookie(c, PRE_LOGIN_COOKIE, sealPreLogin(ctx.session.key, { state, nonce, verifier, returnTo, startedAt: Date.now() }), {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: PRE_LOGIN_LIFETIME_MS / 1000,
    });
    return c.redirect(to, 302);
  },

  "GET /api/auth/oidc/callback": async (c, ctx) => {
    const provider = providerOf(ctx);
    const install = ctx.options.install!;
    const trustProxy = Boolean(ctx.options.trustProxy);
    const client = clientKeyOf(c, trustProxy);
    const from = clientAddress(c, trustProxy);
    const params = new URL(c.req.url).searchParams;
    // Until the state has matched a cookie this browser opened, nothing was tested: a page anywhere can send a browser here
    // without one, and that must never count against everyone at its address, whose passwords the same count holds back.
    let tested = false;
    const refuse = (code: OidcRefusalCode, why: string, extra: Record<string, string> = {}): Response => {
      const counted = tested && !NOT_THE_BROWSERS.has(code);

      // Counted against this client as a wrong password is, unless it is the provider's or this server's doing.
      if (counted) ctx.limiter.fail(client);
      if (counted || quietly(ctx, client)) audit(ctx, `A sign-in through ${provider.config.name} from ${from} was refused: ${why}`);
      return toSignIn(c, code, extra);
    };

    if (ctx.limiter.blocked(client)) return refuse("too-many", "too many failed sign-ins from there.");
    // 1. The browser that started this sign-in.
    const preLogin = openPreLogin(ctx.session.key, getCookie(c, PRE_LOGIN_COOKIE));

    if (!preLogin) {
      clearPreLogin(c);
      return refuse("refused-state", "no sign-in was started in this browser in the last ten minutes.");
    }
    // 2. Its state. Another one is left as it is: it may be another tab's sign-in, or a callback someone made up.
    if (!sameSignature(params.get("state") ?? "", preLogin.state)) return refuse("another-tab", "the answer is for another sign-in than the one this browser started last.");
    tested = true;
    clearPreLogin(c);
    // 3. Used once.
    const { used } = limitsOf(ctx);
    const now = Date.now();

    for (const [state, until] of used) if (until <= now) used.delete(state);
    if (used.has(preLogin.state)) return refuse("refused-state", "that sign-in was finished already (its state was used once).");
    if (used.size >= USED_STATES_KEPT) used.delete(used.keys().next().value!);
    used.set(preLogin.state, now + PRE_LOGIN_LIFETIME_MS);
    // 4–8. The issuer, the provider's error, the code and the ID token.
    let checked: Awaited<ReturnType<OidcProvider["finish"]>>;

    try {
      checked = await provider.finish(params, preLogin);
    } catch (error) {
      if (!(error instanceof OidcRefusal)) throw error;
      return refuse(error.code, error.logLine);
    }
    const role: AccountRole | null = checked.role ?? provider.config.defaultRole;

    if (!role) return refuse("no-role", `the ID token has no ${provider.config.roleClaim} claim, and no default role is set.`);
    // 9. The account, found by issuer and subject, or made.
    const result = await install.people.signInThroughProvider({ issuer: provider.config.issuer, subject: checked.subject, name: checked.name, email: checked.email, role, issuedAt: checked.issuedAt });

    if (!result.ok) {
      const who = result.account ? named(result.account) : "a subject with no account here";

      if (result.reason === "removed") return refuse("removed", `${who} was removed from this editor.`);
      if (result.reason === "switched-off") return refuse("switched-off", `${who} is switched off here.`);
      if (result.reason === "full") return refuse("full", `this editor has as many accounts as it can hold.`);
      return refuse("signed-out", `the provider signed ${who} out after this sign-in began.`, { at: String(result.signedOutAt ?? "") });
    }
    // 10. A session of its own kind, as long as the operator set; then where the person was going.
    // A good sign-in clears nothing: the same count holds back passwords guessed from this client.
    signInAs(c, ctx, result.account.id, { kind: "provider", lastsMs: provider.config.sessionHours * 60 * 60_000 });
    audit(
      ctx,
      `Signed in through ${provider.config.name}: ${named(result.account)}${result.created ? `, a new ${ROLE_NAMES[result.account.role]}` : ""}, from ${from}${checked.keyId ? ` (key ${checked.keyId})` : ""}${result.notes.length ? `; ${result.notes.join("; ")}` : ""}.`
    );
    return c.redirect(preLogin.returnTo, 303);
  },

  "POST /api/auth/oidc/backchannel-logout": async (c, ctx) => {
    const provider = ctx.options.mode === "hosted" && ctx.options.install ? (ctx.options.oidc ?? null) : null;

    if (!provider) return forProvider(c, 404, { error: "not_found" });
    const install = ctx.options.install!;
    const trustProxy = Boolean(ctx.options.trustProxy);
    const client = clientKeyOf(c, trustProxy);
    // Server to server: no cookie is read, and no limiter stands in front of it (sign-in failures never block it, nor it them).
    const body = new URLSearchParams(await c.req.text().catch(() => ""));
    const token = body.get("logout_token");
    const refused = (why: string, retry: boolean): Response => {
      if (logoutLineAllowed(ctx, client)) audit(ctx, `A back-channel logout from ${clientAddress(c, trustProxy)} was refused: ${why}.`);
      return retry ? forProvider(c, 503, { error: "temporarily_unavailable" }) : forProvider(c, 400, { error: "invalid_request" });
    };

    if (!token || token.length > BACKCHANNEL_BODY_LIMIT_BYTES) return refused("there is no logout_token", false);
    let checked: Awaited<ReturnType<OidcProvider["checkLogoutToken"]>>;

    try {
      checked = await provider.checkLogoutToken(token);
    } catch (error) {
      if (error instanceof LogoutRefusal) return refused(error.reason, error.retry);
      if (error instanceof OidcRefusal) return refused(error.logLine, true);
      throw error;
    }
    let result: Awaited<ReturnType<typeof install.people.providerLogout>>;

    // Answered 200 only once it is written: a provider sends again anything that isn't.
    try {
      result = await install.people.providerLogout({ issuer: provider.config.issuer, subject: checked.subject, issuedAt: checked.issuedAt });
    } catch (error) {
      audit(ctx, `A back-channel logout from ${provider.config.name} couldn't be written, so nobody was signed out by it; it is answered as failed, to be sent again: ${error instanceof Error ? error.message : String(error)}`);
      return forProvider(c, 400, { error: "server_error" });
    }
    if (!result.ok) return refused("the list of recent logouts for people with no account here is full; it will be sent again", true);
    audit(ctx, `The provider (${provider.config.name}) signed ${result.account ? named(result.account) : "someone with no account here"} out${checked.keyId ? ` (key ${checked.keyId})` : ""}.`);
    return forProvider(c, 200, null);
  },
};
