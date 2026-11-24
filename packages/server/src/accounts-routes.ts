/**
 * People on a hosted install over HTTP: your own account, the People list,
 * invitations, and the one-time links that let someone in (/api/account,
 * /api/people/*, /api/auth/link*, /api/auth/forgot), and the sign-in with an
 * e-mail and a password. Hosted mode only — in local mode every route here
 * answers 404, because one person on their own computer has no accounts.
 *
 * Who may call what is decided before a handler runs, from the one table in
 * core (install/route-access.ts). Nothing secret ever comes back: a link is
 * told once, to the owner who made it, and only its hash is kept. A link or
 * a code never reaches the log; neither does an e-mail address.
 */
import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { ApiRouteKey } from "@galley/core/api";
import type { MailMessage, MailTransport } from "@galley/core/forms";
import {
  invitationEmail,
  LINK_PATHS,
  LINK_REFUSED,
  MAX_INSTALL_PASSWORD_LENGTH,
  passwordLinkEmail,
  ROLE_NAMES,
  WRONG_CURRENT_PASSWORD,
  roleMay,
  type AccountSession,
  type Install,
  type LinkPreview,
} from "@galley/core/install";
import type { ServerEvent } from "@galley/core/types";
import {
  clientAddress,
  EMAIL_LOGIN_LIMIT,
  EMAIL_LOGIN_WINDOW_MS,
  FORGOT_CLIENT_LIMIT,
  FORGOT_CLIENT_WINDOW_MS,
  FORGOT_EMAIL_LIMIT,
  FORGOT_EMAIL_WINDOW_MS,
  Bounded,
  EMAIL_SLOW_AFTER,
  EMAIL_SLOW_DELAY_MS,
  EMAIL_SLOW_QUEUE,
  isLoopbackHost,
  LoginLimiter,
  requestProtocol,
  requestSession,
  SerialDelay,
  SIGN_IN_HASHING,
  SIGN_IN_QUEUE,
  SESSION_MAX_AGE_S,
} from "./auth";
import { GalleyError } from "@galley/core";
import { AuthError, invalid, notFound, RateLimitError } from "./errors";
import type { StreamAccess } from "./events";
import type { RouteContext, RouteTable } from "./routes";
import * as v from "./validate";
import { audit, callerOf, named, personOf } from "./who";

export type AccountsRouteKey = Extract<
  ApiRouteKey,
  | "GET /api/account"
  | "PATCH /api/account"
  | "POST /api/account/password"
  | "GET /api/people"
  | "POST /api/people/invitations"
  | "DELETE /api/people/invitations/:invitationId"
  | "PATCH /api/people/:accountId"
  | "DELETE /api/people/:accountId"
  | "POST /api/people/:accountId/password-link"
  | "POST /api/people/:accountId/sign-out"
  | "POST /api/people/sign-out"
  | "POST /api/auth/link/check"
  | "POST /api/auth/link"
  | "POST /api/auth/forgot"
>;

/** Too many attempts from one address, or too many sign-ins being checked at once. */
export const TOO_MANY_SIGN_INS = "Too many sign-in attempts. Wait a minute, then try again.";
/** Too many wrong attempts for one e-mail from one address. The same for an e-mail nobody has. */
export const TOO_MANY_FOR_EMAIL = `Too many sign-in attempts for that e-mail. Wait ${EMAIL_LOGIN_WINDOW_MS / 60_000} minutes, then try again.`;
/** The key the owner who has no e-mail yet is counted under: nothing typed into the e-mail field can be it. */
const NO_EMAIL = "\u0000(no e-mail)";

/** The same sentence for an unknown e-mail, a wrong password and a switched-off account. */
export const SIGN_IN_REFUSED = "That e-mail and password don't match an account here. Check them and try again.";
/** How long an owner's request waits for the mail server before answering without it (`emailed: false`). */
export const MAIL_WAIT_MS = 15_000;

const ok = { ok: true } as const;
const password = z.string().min(1, "it can't be empty").max(MAX_INSTALL_PASSWORD_LENGTH);
const email = z.string().trim().min(1, "it can't be empty").max(320);
const name = z.string().max(400);
const role = z.enum(["owner", "editor", "contributor"]);
// Any string up to the size of an address is a code to look up: a mangled or over-long one gets the same 404 as any other that can't be used, never a different answer.
const code = z.string().max(4096);
const loginBody = z.object({ password, email: z.string().max(320).optional() });
const profileBody = z.object({ name: name.optional(), email: email.optional(), password: password.optional() }).strict();
const passwordBody = z.object({ current: password, next: password }).strict();
const inviteBody = z.object({ email, role }).strict();
const changeBody = z
  .object({ role: role.optional(), disabled: z.boolean().optional(), email: email.optional() })
  .strict()
  .refine((value) => value.role !== undefined || value.disabled !== undefined || value.email !== undefined, "give a role, an e-mail, or whether the account is switched off");
const checkBody = z.object({ code }).strict();
const useBody = z.object({ code, password, name: name.optional() }).strict();
const forgotBody = z.object({ email: z.string().max(320) }).strict();
const ID = /^[A-Za-z0-9_-]{1,64}$/;

function notHere(): never {
  throw notFound("This app isn't a hosted install, so there are no accounts here.");
}

function installOf(ctx: RouteContext): Install {
  if (ctx.options.mode !== "hosted" || !ctx.options.install) notHere();
  return ctx.options.install;
}

/** A route's id parameter, or a plain refusal (never a crash on a strange value). */
function idParam(c: Context, param: string): string {
  const value = c.req.param(param) ?? "";

  if (!ID.test(value)) throw notFound("That person isn't on this editor any more. Reload the list.");
  return value;
}

interface Limits {
  /** Failed sign-ins per e-mail and client address together: refused past EMAIL_LOGIN_LIMIT. */
  pair: LoginLimiter;
  /** Failed sign-ins per e-mail from every address: past EMAIL_SLOW_AFTER, slowed (never refused). */
  email: LoginLimiter;
  slow: SerialDelay;
  /** Password checks for sign-in, a few at a time. */
  hashing: Bounded;
  /** "Forgot my password" per client address (every request counts). */
  forgotClient: LoginLimiter;
  /** New-password e-mails per address asked for (every request counts, known or not). */
  forgotEmail: LoginLimiter;
}

const limitsByApp = new WeakMap<RouteContext, Limits>();

function limitsOf(ctx: RouteContext): Limits {
  let limits = limitsByApp.get(ctx);

  if (!limits) {
    limits = {
      pair: new LoginLimiter(EMAIL_LOGIN_LIMIT, EMAIL_LOGIN_WINDOW_MS),
      email: new LoginLimiter(Number.MAX_SAFE_INTEGER, EMAIL_LOGIN_WINDOW_MS),
      slow: new SerialDelay(EMAIL_SLOW_DELAY_MS, EMAIL_SLOW_QUEUE),
      hashing: new Bounded(SIGN_IN_HASHING, SIGN_IN_QUEUE),
      forgotClient: new LoginLimiter(FORGOT_CLIENT_LIMIT, FORGOT_CLIENT_WINDOW_MS),
      forgotEmail: new LoginLimiter(FORGOT_EMAIL_LIMIT, FORGOT_EMAIL_WINDOW_MS),
    };
    limitsByApp.set(ctx, limits);
  }
  return limits;
}

/** Signs this browser in as `accountId`: a fresh cookie, issued after that person's and the install's last "sign out everywhere". */
export function signInAs(c: Context, ctx: RouteContext, accountId: string): void {
  const value = ctx.session.issue?.(accountId);

  if (!value) throw new AuthError("Sign in to continue.");
  setCookie(c, ctx.session.cookieName, value, {
    httpOnly: true,
    sameSite: "Strict",
    path: "/",
    secure: ctx.session.secure === true || requestProtocol(c, Boolean(ctx.options.trustProxy)) === "https",
    maxAge: SESSION_MAX_AGE_S,
  });
}

function signOutHere(c: Context, ctx: RouteContext): void {
  deleteCookie(c, ctx.session.cookieName, { path: "/", ...(ctx.session.secure ? { secure: true } : {}) });
}

/** Said when a link would have to be made without the editor's public address, from anywhere but this computer. */
export const NEEDS_PUBLIC_ADDRESS =
  "Links can't be made yet: this editor doesn't know its public address. Set the editor's public address (GALLEY_PUBLIC_URL), start it again, then make the link.";

/** Links go out by e-mail only when there is outgoing mail AND the public address they are built from. */
export function linksAreEmailed(ctx: RouteContext): boolean {
  return Boolean(ctx.options.mailer && ctx.options.publicOrigin);
}

/**
 * The address a link shown to the signed-in owner starts with: always the
 * editor's public address when one is set. Without it, only a trial on one
 * computer gets a link, built from a loopback name the request came in on
 * (and its Host header names the same); anywhere else making one is refused.
 */
function shownLinkAddress(c: Context, ctx: RouteContext): string {
  if (ctx.options.publicOrigin) return ctx.options.publicOrigin;
  const url = new URL(c.req.url);
  const header = (c.req.header("host") ?? "").trim().toLowerCase();

  if (isLoopbackHost(url.hostname) && header === url.host.toLowerCase()) return `${requestProtocol(c, Boolean(ctx.options.trustProxy))}://${url.host}`;
  throw new GalleyError("unconfigured", NEEDS_PUBLIC_ADDRESS);
}

/** `<address>/join#<code>`: the code in the fragment, which never leaves the browser (no server log, no proxy sees it). */
function linkUrl(address: string, kind: LinkPreview["kind"], secret: string): string {
  return `${address}${LINK_PATHS[kind]}#${secret}`;
}

/**
 * Sends one e-mail when the server has outgoing mail, without ever failing
 * the request: a failure (or a mail server that doesn't answer in time) is
 * logged — what kind of e-mail and the mail server's error code, never the
 * address, the link or the mail server's own words, which can quote both.
 */
async function deliver(ctx: RouteContext, message: MailMessage, what: string): Promise<boolean> {
  const mailer: MailTransport | null | undefined = ctx.options.mailer;

  if (!mailer || !linksAreEmailed(ctx)) return false;
  let timer: NodeJS.Timeout | undefined;

  try {
    const sent = await Promise.race([
      mailer.send(message).then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), MAIL_WAIT_MS);
        timer.unref?.();
      }),
    ]);

    if (!sent) audit(ctx, `The e-mail with ${what} wasn't sent in time (the mail server didn't answer within ${MAIL_WAIT_MS / 1000} s). The link was still given to the owner.`);
    return sent;
  } catch (error) {
    const reason = error as { code?: unknown; responseCode?: unknown };
    const said = [typeof reason.code === "string" ? reason.code : null, typeof reason.responseCode === "number" ? `reply ${reason.responseCode}` : null].filter(Boolean).join(", ");

    audit(ctx, `The e-mail with ${what} couldn't be sent${said ? ` (${said})` : ""}. Check GALLEY_SMTP_URL and GALLEY_MAIL_FROM. The link was still given to the owner.`);
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** GET /api/meta on a hosted install: who is signed in, and what the sign-in page should offer. */
export function accountsMeta(c: Context, ctx: RouteContext): { account?: AccountSession; passwordEmail: boolean } {
  const install = installOf(ctx);
  const caller = callerOf(c, ctx);
  const account = caller?.kind === "person" ? install.people.session(caller.account.id) : null;

  return { ...(account ? { account } : {}), passwordEmail: linksAreEmailed(ctx) };
}

/**
 * POST /api/auth/login on a hosted install: an e-mail and a password (or the
 * password alone, for the one owner who has no e-mail yet). The same answer,
 * in about the same time, whatever was wrong.
 */
export async function signInWithAccount(c: Context, ctx: RouteContext): Promise<typeof ok> {
  const install = installOf(ctx);
  const client = clientAddress(c, Boolean(ctx.options.trustProxy));
  const limits = limitsOf(ctx);

  if (ctx.limiter.blocked(client)) {
    audit(ctx, `A sign-in from ${client} was refused: too many attempts.`);
    throw new RateLimitError(TOO_MANY_SIGN_INS);
  }
  const body = await v.body(c, loginBody);
  const address = body.email === undefined ? null : body.email.trim().toLowerCase();
  // The owner who has no e-mail yet is held to the same limits, under a key no e-mail can be.
  const key = address ?? NO_EMAIL;
  const pair = `${key}\n${client}`;

  if (limits.pair.blocked(pair)) {
    audit(ctx, `A sign-in from ${client} was refused: too many attempts for that e-mail from there.`);
    throw new RateLimitError(TOO_MANY_FOR_EMAIL);
  }
  // Guesses from other addresses only slow this e-mail's sign-ins down, one at a time; they never refuse the right password.
  if (limits.email.count(key) >= EMAIL_SLOW_AFTER) await limits.slow.wait(key);
  const result = await limits.hashing.run(() => install.people.verify(address, body.password));

  if (result === null) {
    audit(ctx, `A sign-in from ${client} was refused: too many sign-ins being checked at once.`);
    throw new RateLimitError(TOO_MANY_SIGN_INS);
  }
  if (!result.ok) {
    ctx.limiter.fail(client);
    limits.pair.fail(pair);
    limits.email.fail(key);
    audit(
      ctx,
      result.reason === "disabled"
        ? `A sign-in to ${named(result.account!)} from ${client} was refused: the account is switched off.`
        : result.reason === "wrong"
          ? `A sign-in to ${named(result.account!)} from ${client} failed: wrong password.`
          : `A sign-in from ${client} failed: no account has that e-mail.`
    );
    throw new AuthError(address === null ? "That password isn't right. Check it and try again." : SIGN_IN_REFUSED);
  }
  ctx.limiter.succeed(client);
  limits.pair.succeed(pair);
  signInAs(c, ctx, result.account.id);
  await install.people.noteSignIn(result.account.id).catch((error: unknown) => audit(ctx, `When ${named(result.account)} last signed in couldn't be saved: ${error instanceof Error ? error.message : String(error)}`));
  audit(ctx, `Signed in: ${named(result.account)}, from ${client}.`);
  return ok;
}

/**
 * POST /api/auth/logout on a hosted install: this browser out. A sign-out is
 * written down only for a session that still counts — correctly signed,
 * unexpired, not ended already, its account there and switched on — and
 * only until it would have run out anyway.
 */
export async function signOutThisBrowser(c: Context, ctx: RouteContext): Promise<typeof ok> {
  const install = installOf(ctx);
  const session = requestSession(c, ctx.session);

  if (session?.accountId) await install.store.endSession({ id: session.id, issuedAt: session.issuedAt, accountId: session.accountId });
  signOutHere(c, ctx);
  return ok;
}

/** POST /api/account/password, and its older name POST /api/install/password: change your own password. */
export async function changeOwnPassword(c: Context, ctx: RouteContext): Promise<typeof ok> {
  const install = installOf(ctx);
  const { account } = personOf(c, ctx);
  const client = clientAddress(c, Boolean(ctx.options.trustProxy));

  if (ctx.limiter.blocked(client)) throw new RateLimitError("Too many attempts. Wait a minute, then try again.");
  const body = await v.body(c, passwordBody);

  if (!(await install.people.changePassword(account.id, body.current, body.next))) {
    ctx.limiter.fail(client);
    audit(ctx, `A password change for ${named(account)} from ${client} was refused: the current password was wrong.`);
    // 400, not 401: the session is fine, only the typed password is wrong.
    throw invalid("That isn't the current password.");
  }
  ctx.limiter.succeed(client);
  // Every other browser of theirs is signed out; this one gets a fresh cookie.
  signInAs(c, ctx, account.id);
  audit(ctx, `${named(account)} changed their password (from ${client}); their other browsers were signed out.`);
  return ok;
}

/** POST /api/auth/logout-all: the signed-in person, out of every browser. The operator's token signs everyone out, as it always did. */
export async function signOutEverywhere(c: Context, ctx: RouteContext): Promise<typeof ok> {
  const install = installOf(ctx);
  const caller = callerOf(c, ctx);

  if (caller?.kind === "person") {
    await install.people.signOut(caller.account.id);
    audit(ctx, `${named(caller.account)} signed out everywhere.`);
  } else {
    await install.people.signOutEveryone();
    audit(ctx, "Everyone was signed out (with the server's access token).");
  }
  signOutHere(c, ctx);
  return ok;
}

/**
 * GET /api/events for a signed-in person: what visitors sent through the
 * site's forms rides on "forms.submission" — for someone who may not read
 * the inbox only the fact that the inbox changed is passed on, never the
 * submission itself. The stream ends when the person is signed out
 * (that browser, or everywhere), switched off or removed. It isn't ended by
 * a restore's install-wide sign-out: the browser that started the restore
 * must still hear how it ended (its next request asks it to sign in again).
 * Nothing else on the bus carries a submission's content or a key.
 */
export function eventAccess(c: Context, ctx: RouteContext): StreamAccess | undefined {
  const install = ctx.options.mode === "hosted" ? ctx.options.install : null;
  const caller = install ? callerOf(c, ctx) : null;

  if (!install || caller?.kind !== "person") return undefined;
  const { session } = caller;
  const current = () => {
    if (ctx.session.revoked.has(session.id)) return null;
    const account = install.store.account(caller.account.id);

    return account && !account.disabled && session.issuedAt > account.sessionsValidAfter ? account : null;
  };

  return {
    live: () => current() !== null,
    filter(event: ServerEvent) {
      const account = current();

      if (!account) return null;
      if (event.type === "forms.submission" && !roleMay(account.role, "publish")) {
        const { submission: _left, ...rest } = event;

        return rest;
      }
      return event;
    },
    onChange: (listener) => install.store.onSessionsChanged(listener),
  };
}

export const accountsRoutes: Pick<RouteTable, AccountsRouteKey> = {
  // ── the signed-in person ───────────────────────────────────────────────
  "GET /api/account": async (c, ctx) => {
    const install = installOf(ctx);
    const session = install.people.session(personOf(c, ctx).account.id);

    if (!session) throw new AuthError("Sign in to continue.");
    return session;
  },

  "PATCH /api/account": async (c, ctx) => {
    const install = installOf(ctx);
    const { account } = personOf(c, ctx);
    const client = clientAddress(c, Boolean(ctx.options.trustProxy));
    const body = await v.body(c, profileBody);
    // The current password typed to change an e-mail is held to the same limit as changing the password itself.
    const checksPassword = body.email !== undefined && body.password !== undefined;

    if (checksPassword && ctx.limiter.blocked(client)) throw new RateLimitError("Too many attempts. Wait a minute, then try again.");
    let updated: Awaited<ReturnType<Install["people"]["updateProfile"]>>;

    try {
      updated = await install.people.updateProfile(account.id, body);
    } catch (error) {
      if (error instanceof GalleyError && error.message === WRONG_CURRENT_PASSWORD) {
        ctx.limiter.fail(client);
        audit(ctx, `An e-mail change for ${named(account)} from ${client} was refused: the current password was wrong.`);
      }
      throw error;
    }
    if (checksPassword) ctx.limiter.succeed(client);

    if (body.email !== undefined && updated.email !== account.email) audit(ctx, `${named(updated)} changed the e-mail they sign in with.`);
    if (updated.name !== account.name) audit(ctx, `${named(account)} is now called ${updated.name}.`);
    return install.people.session(updated.id)!;
  },

  "POST /api/account/password": changeOwnPassword,

  // ── people ─────────────────────────────────────────────────────────────
  "GET /api/people": async (c, ctx) => {
    const install = installOf(ctx);

    personOf(c, ctx);
    return { ...install.people.list(), emailAvailable: linksAreEmailed(ctx) };
  },

  "POST /api/people/invitations": async (c, ctx) => {
    const install = installOf(ctx);
    const { account: by } = personOf(c, ctx);
    const body = await v.body(c, inviteBody);
    // Decided before anything is made: without an address to build it from, no invitation is left half-made.
    const address = shownLinkAddress(c, ctx);
    const { invitation, link } = await install.people.invite(by.id, body);
    const url = linkUrl(address, "invitation", link.code);
    const emailed = await deliver(
      ctx,
      invitationEmail({ to: invitation.email, product: ctx.options.brand.productName, address, invitedBy: by.name, role: invitation.role, url, expiresAt: link.expiresAt }),
      `an invitation from ${named(by)}`
    );

    if (emailed) await install.people.markEmailed(link.id, true);
    audit(ctx, `${named(by)} invited a new ${ROLE_NAMES[invitation.role]}${emailed ? "; the link was e-mailed" : ""}.`);
    return { invitation: { ...invitation, emailed }, link: { url, expiresAt: link.expiresAt, emailed } };
  },

  "DELETE /api/people/invitations/:invitationId": async (c, ctx) => {
    const install = installOf(ctx);
    const { account: by } = personOf(c, ctx);
    const id = c.req.param("invitationId") ?? "";

    if (!ID.test(id)) throw notFound("That invitation isn't open any more: it was used, taken back or it ran out.");
    const taken = await install.people.cancelInvitation(by.id, id);

    audit(ctx, `${named(by)} took back an invitation for a new ${ROLE_NAMES[taken.role]}.`);
    return ok;
  },

  "PATCH /api/people/:accountId": async (c, ctx) => {
    const install = installOf(ctx);
    const { account: by } = personOf(c, ctx);
    const target = idParam(c, "accountId");
    const body = await v.body(c, changeBody);
    const { before, after } = await install.people.change(by.id, target, body);

    if (before.email !== after.email) audit(ctx, `${named(by)} changed the e-mail ${named(after)} signs in with; their open links stopped working.`);
    if (before.role !== after.role) audit(ctx, `${named(by)} changed the role of ${named(before)} to ${ROLE_NAMES[after.role]}.`);
    if (before.disabled !== after.disabled) audit(ctx, after.disabled ? `${named(by)} switched off ${named(after)}; they were signed out.` : `${named(by)} switched ${named(after)} back on.`);
    return after;
  },

  "DELETE /api/people/:accountId": async (c, ctx) => {
    const install = installOf(ctx);
    const { account: by } = personOf(c, ctx);
    const removed = await install.people.remove(by.id, idParam(c, "accountId"));

    audit(ctx, `${named(by)} removed ${named(removed)}; they were signed out.`);
    return ok;
  },

  "POST /api/people/:accountId/password-link": async (c, ctx) => {
    const install = installOf(ctx);
    const { account: by } = personOf(c, ctx);
    const target = idParam(c, "accountId");
    const address = shownLinkAddress(c, ctx);
    const made = await install.people.passwordLink(by.id, target);
    const url = linkUrl(address, "password", made.link.code);
    const emailed = made.account.email
      ? await deliver(
          ctx,
          passwordLinkEmail({ to: made.account.email, product: ctx.options.brand.productName, address, url, expiresAt: made.link.expiresAt, ...(by.name ? { madeBy: by.name } : {}) }),
          `a new-password link for ${named(made.account)}`
        )
      : false;

    if (emailed) await install.people.markEmailed(made.link.id, true);
    audit(ctx, `${named(by)} made a new-password link for ${named(made.account)}${emailed ? "; it was e-mailed to them and not shown" : "; it couldn't be e-mailed, so it was shown to them to pass on"}.`);
    // A link that signs in as someone else stays with them: once it is in their inbox, it isn't handed to the asker too.
    return { url: emailed ? null : url, expiresAt: made.link.expiresAt, emailed };
  },

  "POST /api/people/:accountId/sign-out": async (c, ctx) => {
    const install = installOf(ctx);
    const { account: by } = personOf(c, ctx);
    const target = idParam(c, "accountId");
    const account = install.people.get(target);

    if (!account) throw notFound("That person isn't on this editor any more. Reload the list.");
    await install.people.signOut(target);
    if (target === by.id) signOutHere(c, ctx);
    audit(ctx, `${named(by)} signed ${target === by.id ? "themselves" : named(account)} out everywhere.`);
    return ok;
  },

  "POST /api/people/sign-out": async (c, ctx) => {
    const install = installOf(ctx);
    const { account: by } = personOf(c, ctx);

    await install.people.signOutEveryone();
    signOutHere(c, ctx);
    audit(ctx, `${named(by)} signed everyone out.`);
    return ok;
  },

  // ── one-time links: the code is the proof ──────────────────────────────
  "POST /api/auth/link/check": async (c, ctx) => {
    const install = installOf(ctx);
    const client = clientAddress(c, Boolean(ctx.options.trustProxy));

    if (ctx.limiter.blocked(client)) throw new RateLimitError("Too many attempts. Wait a minute, then try again.");
    const body = await v.body(c, checkBody);

    try {
      return install.people.checkLink(body.code);
    } catch (error) {
      if (error instanceof Error && error.message === LINK_REFUSED) {
        ctx.limiter.fail(client);
        audit(ctx, `A one-time link opened from ${client} was refused.`);
      }
      throw error;
    }
  },

  "POST /api/auth/link": async (c, ctx) => {
    const install = installOf(ctx);
    const client = clientAddress(c, Boolean(ctx.options.trustProxy));

    if (ctx.limiter.blocked(client)) throw new RateLimitError("Too many attempts. Wait a minute, then try again.");
    const body = await v.body(c, useBody);
    let used: Awaited<ReturnType<Install["people"]["useLink"]>>;

    try {
      used = await install.people.useLink(body.code, { password: body.password, ...(body.name !== undefined ? { name: body.name } : {}) });
    } catch (error) {
      if (error instanceof Error && error.message === LINK_REFUSED) {
        ctx.limiter.fail(client);
        audit(ctx, `A one-time link used from ${client} was refused.`);
      }
      throw error;
    }
    signInAs(c, ctx, used.account.id);
    await install.people.noteSignIn(used.account.id).catch(() => undefined);
    audit(
      ctx,
      used.kind === "invitation"
        ? `${named(used.account)} accepted an invitation and signed in (from ${client}).`
        : `${named(used.account)} chose a new password through a one-time link (from ${client}); their other browsers were signed out.`
    );
    return ok;
  },

  "POST /api/auth/forgot": async (c, ctx) => {
    const install = installOf(ctx);
    const client = clientAddress(c, Boolean(ctx.options.trustProxy));
    const limits = limitsOf(ctx);

    if (limits.forgotClient.blocked(client)) throw new RateLimitError(`Too many requests. Wait ${FORGOT_CLIENT_WINDOW_MS / 60_000} minutes, then try again.`);
    limits.forgotClient.fail(client);
    const body = await v.body(c, forgotBody);
    const emailAvailable = linksAreEmailed(ctx);

    if (emailAvailable) {
      const address = body.email.trim().toLowerCase();
      // Only ever the configured address: nothing this request says about itself goes into a link.
      const editor = ctx.options.publicOrigin!;
      const url = (secret: string) => linkUrl(editor, "password", secret);

      // In the background: the answer is the same, and as quick, whether or not the address has an account.
      void (async () => {
        if (limits.forgotEmail.blocked(address)) return;
        limits.forgotEmail.fail(address);
        const made = await install.people.forgot(address);

        if (!made) return;
        const sent = await deliver(
          ctx,
          passwordLinkEmail({ to: made.account.email, product: ctx.options.brand.productName, address: editor, url: url(made.link.code), expiresAt: made.link.expiresAt }),
          `a new-password link ${named(made.account)} asked for`
        );

        await install.people.markEmailed(made.link.id, sent);
        audit(ctx, `${named(made.account)} asked for a new-password link${sent ? "; it was e-mailed" : ", but the e-mail couldn't be sent"}.`);
      })().catch((error: unknown) => audit(ctx, `A new-password link someone asked for couldn't be made: ${error instanceof Error ? error.message : String(error)}`));
    }
    return { ok: true, emailAvailable };
  },
};
