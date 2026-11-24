/**
 * Who is asking, on a hosted install: the signed-in person (from their
 * session cookie, checked against the install's state on every request, so
 * a role change or a switch-off applies to the very next one), or the
 * operator's Bearer token (GALLEY_TOKEN, the reach it always had), or nobody.
 *
 * Local mode has no accounts: there the answer is only whether the request
 * is signed in at all.
 */
import type { Context } from "hono";
import { ROLE_NAMES, type Account } from "@galley/core/install";
import { bearerToken, requestSession, safeEqual, type SessionInfo } from "./auth";
import { AuthError, forbidden } from "./errors";
import type { RouteContext } from "./routes";

export type Caller = { kind: "token" } | { kind: "person"; session: SessionInfo; account: Account };

export const NEEDS_A_PERSON = "That needs someone signed in to this editor in a browser; a script's access token can't do it.";

const known = new WeakMap<Request, Caller | null>();

/** The caller of a hosted install's request, worked out once per request. Null: nobody (or a wrong token, a session that ended). */
export function callerOf(c: Context, ctx: RouteContext): Caller | null {
  if (known.has(c.req.raw)) return known.get(c.req.raw) ?? null;
  let caller: Caller | null = null;
  const bearer = bearerToken(c);

  if (bearer !== null) caller = ctx.session.token !== null && safeEqual(bearer, ctx.session.token) ? { kind: "token" } : null;
  else caller = personFromCookie(c, ctx);
  known.set(c.req.raw, caller);
  return caller;
}

/** The person the session cookie names, whatever Bearer value rides along (a setup page that keeps sending its used code beside the cookie). */
export function personFromCookie(c: Context, ctx: RouteContext): Caller | null {
  const install = ctx.options.mode === "hosted" ? ctx.options.install : null;
  const session = install ? requestSession(c, ctx.session) : null;
  const account = session?.accountId ? install!.people.get(session.accountId) : null;

  return session && account && !account.disabled ? { kind: "person", session, account } : null;
}

/** Settles who the caller is for the rest of the request (the guard decided the cookie counts, not the Bearer beside it). */
export function settleCaller(c: Context, caller: Caller | null): void {
  known.set(c.req.raw, caller);
}

/** The signed-in person, or a plain refusal: 401 for nobody, 403 for a script's token. */
export function personOf(c: Context, ctx: RouteContext): { session: SessionInfo; account: Account } {
  const caller = callerOf(c, ctx);

  if (!caller) throw new AuthError("Sign in to continue.");
  if (caller.kind === "token") throw forbidden(NEEDS_A_PERSON);
  return caller;
}

/** How a person is named in the log: their name and role — never their e-mail. */
export function named(account: Pick<Account, "name" | "role">): string {
  return account.name ? `${account.name} (${ROLE_NAMES[account.role]})` : `${ROLE_NAMES[account.role]} with no name yet`;
}

function stderrLog(line: string): void {
  process.stderr.write(`${new Date().toISOString()} ${line}\n`);
}

/** One line in the server's log (scrubbed of secrets where it is written). */
export function audit(ctx: RouteContext, line: string): void {
  (ctx.options.log ?? stderrLog)(line);
}
