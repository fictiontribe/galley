/**
 * People on a hosted install, in the mock.
 *
 * Local mode keeps `accountsHandlers()` — every account route answers "not
 * here", as the real server does: one person on their own computer has no
 * accounts. A hosted mock (install.ts `withInstall()`, then `withAccounts()`
 * here) answers them from memory the way a hosted server does: accounts,
 * roles, invitations and one-time links, the e-mail it would have sent kept
 * in `outbox`. server.ts enforces ROUTE_ACCESS for whoever is signed in, so
 * a screen that calls what its person may not is refused here as it would be
 * for real.
 *
 * Who exists (every password is "proof"):
 *   first run at "password"      nobody yet: the setup page creates the owner
 *   first run at "site"/"details" the owner, Sam Rivera <sam@example.com>
 *   first run "done"             the owner; Robin Park <robin@example.com>, Editor;
 *                                Jo Chen <jo@example.com>, Contributor; Kim Lee
 *                                <kim@example.com>, Contributor, switched off; and an
 *                                open invitation for new@example.com
 *   legacy                       an install from before accounts: one owner with no
 *                                name or e-mail, who signs in with the password alone
 *
 * The mock has one browser: `signedIn` is whoever that browser is signed in
 * as. A test that sets `backend.authenticated = true` without signing in is
 * the first owner, as before accounts.
 *
 * Like the real server, it also holds what a route's level can't say by
 * itself: asking for build mode needs BUILD_MODE_LEVEL, and writing the
 * site's settings file needs SITE_SETTINGS_LEVEL, whichever route writes it
 * (`withAccounts`, "what a request asks for"). Those refusals are marked in
 * the request log like the table's.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { ApiRouteKey } from "@galley/core/api";
import type { GitStatus, MetaInfo, SiteDetail } from "@galley/core/types";
import { MIN_INSTALL_PASSWORD_LENGTH } from "@galley/core/install/types";
import { PRODUCT } from "@galley/core/brand";
import {
  ACCOUNT_ROLES,
  INVITATION_DAYS,
  LINK_PATHS,
  PASSWORD_LINK_MINUTES,
  ROLE_ACCESS,
  roleMay,
  type AccessLevel,
  type Account,
  type AccountRole,
  type AccountSession,
  type Invitation,
  type LinkPreview,
  type OneTimeLink,
  type People,
} from "@galley/core/install/accounts";
import type { Handlers, MockBackend, MockRequest } from "./backend.ts";
import type { MockInstall } from "./install.ts";
import { MockError, MockTooManyError } from "./site.ts";

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
  | "GET /api/auth/oidc/start"
  | "GET /api/auth/oidc/callback"
>;

function notHere(): never {
  throw new MockError("not-found", "This app isn't a hosted install, so there are no accounts here.");
}

/** Local mode: there are no accounts, so every account route answers "not here". */
export function accountsHandlers(): Pick<Handlers, AccountsRouteKey> {
  return {
    "GET /api/account": () => notHere(),
    "PATCH /api/account": () => notHere(),
    "POST /api/account/password": () => notHere(),
    "GET /api/people": () => notHere(),
    "POST /api/people/invitations": () => notHere(),
    "DELETE /api/people/invitations/:invitationId": () => notHere(),
    "PATCH /api/people/:accountId": () => notHere(),
    "DELETE /api/people/:accountId": () => notHere(),
    "POST /api/people/:accountId/password-link": () => notHere(),
    "POST /api/people/:accountId/sign-out": () => notHere(),
    "POST /api/people/sign-out": () => notHere(),
    "POST /api/auth/link/check": () => notHere(),
    "POST /api/auth/link": () => notHere(),
    "POST /api/auth/forgot": () => notHere(),
    "GET /api/auth/oidc/start": () => notHere(),
    "GET /api/auth/oidc/callback": () => notHere(),
  };
}

// ── the hosted install ────────────────────────────────────────────────────

/** Every mock account's password. Obviously not a secret. */
export const MOCK_ACCOUNT_PASSWORD = "proof";

export interface MockAccountsOptions {
  /** This server has outgoing e-mail: links are e-mailed too, and "Forgot your password?" sends one — when it also has a public address. */
  email?: boolean;
  /**
   * false: the server was started without its own public address. Then it
   * e-mails no link at all, outgoing e-mail or not (`emailAvailable` false,
   * "Forgot your password?" sends nothing); links are still shown to the
   * owner who makes them, as on a trial on one computer.
   */
  publicAddress?: boolean;
  /** An install from before accounts: one owner, no name or e-mail, signing in with the password alone. */
  legacy?: boolean;
  /** Start this browser signed in as the first person with this role (first run must be over). */
  role?: AccountRole;
}

interface MockAccount extends Account {
  password: string;
}

interface MockInvitation extends Invitation {
  code: string;
}

interface MockLink {
  kind: LinkPreview["kind"];
  /** The account a new-password link is for. */
  accountId?: string;
  /** The invitation an invitation link is for. */
  invitationId?: string;
  expiresAt: string;
  used: boolean;
}

/** What the server would have e-mailed. */
export interface MockMail {
  to: string;
  kind: LinkPreview["kind"];
  url: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// The real server's sentences (core/src/install/people.ts, server/src/accounts-routes.ts), so screens built here read as they will for real.
const REFUSED_LINK = "This link doesn't work any more: it was used already, taken back, or it ran out. Ask an owner of this editor for a new one.";
const ASK_ANOTHER_OWNER = "Ask another owner to change your own account.";
const LAST_OWNER = "This is the last owner who can sign in, so they stay an owner and stay switched on. Make someone else an owner first.";
const SIGN_IN_REFUSED = "That e-mail and password don't match an account here. Check them and try again.";
const TAKEN = "Someone with that e-mail already has an account here.";
const NOT_AN_EMAIL = "That e-mail address is missing something. It should look like name@example.com.";
/** What someone without the level is told when a request asks for build mode, or would write the site's settings file (the real server's sentences, core install/caller.ts). */
export const BUILD_MODE_REFUSAL = "Your account can change the site's content, but not its code and templates (build mode). Ask an owner or an editor of this editor.";
export const SITE_SETTINGS_REFUSAL = "Your account can't change the site's settings. Ask an owner of this editor.";
export const OWN_EMAIL_REFUSAL = "Only an owner can change the e-mail you sign in with. Ask an owner of this editor to change it for you.";

/** Refused for the signed-in person's role, though the route itself was theirs: server.ts marks it in the log like a refusal from the table. */
export class MockRoleError extends MockError {
  constructor(message: string) {
    super("forbidden", message);
  }
}

/** The two levels a route can't express (core route-access.ts), handed over by server.ts once the table is loaded. */
export interface MockRequestLevels {
  build: AccessLevel;
  settings: AccessLevel;
}

const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

/**
 * The real server's limits (server/src/auth.ts), for the mock's one browser:
 * failed sign-ins, bad link codes and a wrong current password together, 5 a
 * minute, then everything waits out the minute; "forgot my password" 5 times
 * in 15 minutes. The per-e-mail limit (10 in 15 minutes from any address)
 * isn't here: with one browser the first limit always comes first.
 */
const TRY_LIMIT = 5;
const TRY_WINDOW_MS = 60_000;
const FORGOT_LIMIT = 5;
const FORGOT_WINDOW_MS = 15 * 60_000;
const TOO_MANY = "Too many attempts. Wait a minute, then try again.";

class Tries {
  private entry: { count: number; since: number } | null = null;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  blocked(): boolean {
    if (!this.entry) return false;
    if (this.now() - this.entry.since >= this.windowMs) {
      this.entry = null;
      return false;
    }
    return this.entry.count >= this.limit;
  }

  fail(): void {
    if (!this.entry || this.now() - this.entry.since >= this.windowMs) this.entry = { count: 1, since: this.now() };
    else this.entry.count += 1;
  }

  succeed(): void {
    this.entry = null;
  }
}

export class MockAccounts {
  accounts: MockAccount[] = [];
  invitations: MockInvitation[] = [];
  readonly links = new Map<string, MockLink>();
  readonly outbox: MockMail[] = [];
  /** Who the mock's one browser is signed in as. */
  signedIn: string | null = null;
  emailAvailable: boolean;
  /** Set by server.ts from the loaded role-access table, before any request is answered. */
  levels: MockRequestLevels = { build: "publish", settings: "manage" };
  /** The limits' clock: a test moves it on to let the wait run out. */
  now: () => number = () => Date.now();
  private readonly tries = new Tries(TRY_LIMIT, TRY_WINDOW_MS, () => this.now());
  private readonly forgotTries = new Tries(FORGOT_LIMIT, FORGOT_WINDOW_MS, () => this.now());

  constructor(
    readonly mock: MockBackend,
    readonly install: MockInstall,
    readonly options: MockAccountsOptions = {},
  ) {
    // A link is only ever e-mailed when it can be built from the server's own public address.
    this.emailAvailable = Boolean(options.email) && options.publicAddress !== false;
    this.seed(install.step() === "done");
    if (options.role && install.step() === "done") {
      const person = this.accounts.find((account) => account.role === options.role && !account.disabled);
      if (person) {
        this.signedIn = person.id;
        mock.authenticated = true;
      }
    }
  }

  /** The people a mock install starts with (also what a restored backup brings back). */
  seed(finished: boolean): void {
    this.accounts = [];
    this.invitations = [];
    this.links.clear();
    if (!this.install.password) return;
    const created = new Date(Date.now() - 12 * 86_400_000).toISOString();
    const person = (name: string, email: string, role: AccountRole, extra: Partial<MockAccount> = {}): MockAccount => ({ id: randomUUID(), name, email, role, createdAt: created, lastSeenAt: null, disabled: false, password: MOCK_ACCOUNT_PASSWORD, ...extra });
    if (this.options.legacy) {
      this.accounts.push(person("", "", "owner", { incomplete: true, lastSeenAt: new Date(Date.now() - 86_400_000).toISOString() }));
      return;
    }
    this.accounts.push(person("Sam Rivera", "sam@example.com", "owner", { lastSeenAt: new Date(Date.now() - 3_600_000).toISOString() }));
    if (!finished) return;
    this.accounts.push(
      person("Robin Park", "robin@example.com", "editor", { lastSeenAt: new Date(Date.now() - 2 * 86_400_000).toISOString() }),
      person("Jo Chen", "jo@example.com", "contributor", { lastSeenAt: new Date(Date.now() - 5 * 86_400_000).toISOString() }),
      person("Kim Lee", "kim@example.com", "contributor", { disabled: true }),
    );
    this.invite("new@example.com", "contributor", "Sam Rivera");
  }

  // ── who is signed in ──────────────────────────────────────────────────

  /** The person the browser is signed in as; a session made before anyone signed in (tests, first run) is the first owner's. */
  current(): MockAccount | null {
    if (!this.mock.authenticated) return null;
    const person = this.signedIn ? this.accounts.find((account) => account.id === this.signedIn) : this.accounts.find((account) => account.role === "owner");
    if (this.signedIn && (!person || person.disabled)) {
      // Removed or switched off while signed in: that sign-in is over.
      this.signOutBrowser();
      return null;
    }
    return person ?? null;
  }

  me(): MockAccount {
    const person = this.current();
    if (!person) throw new MockError("unauthorized", "Sign in to continue.");
    return person;
  }

  signInAs(person: MockAccount): void {
    this.signedIn = person.id;
    this.mock.authenticated = true;
    person.lastSeenAt = new Date().toISOString();
  }

  signOutBrowser(): void {
    this.signedIn = null;
    this.mock.authenticated = false;
  }

  session(person: MockAccount): AccountSession {
    return { ...this.public(person), access: [...ROLE_ACCESS[person.role]] };
  }

  public(person: MockAccount): Account {
    const { password: _password, ...account } = person;
    return { ...account, ...(person.incomplete ? { incomplete: true } : {}) };
  }

  meta(meta: MetaInfo): MetaInfo {
    const person = this.current();
    const install = meta.install ? { ...meta.install, signInWith: this.signInWith(), passwordEmail: this.emailAvailable } : meta.install;
    return { ...meta, install, ...(person ? { account: this.session(person) } : {}) };
  }

  /** The password alone, while the only way in is an owner from before accounts who has no e-mail yet. */
  signInWith(): "email" | "password" {
    return this.accounts.some((account) => !account.email && !account.disabled) ? "password" : "email";
  }

  // ── signing in ────────────────────────────────────────────────────────

  login(body: { password: string; email?: string }): void {
    if (!this.install.password && this.accounts.length === 0) throw new MockError("unauthorized", "This editor isn’t set up yet. Open the setup link to create its owner.");
    if (this.tries.blocked()) throw new MockTooManyError("Too many sign-in attempts. Wait a minute, then try again.");
    const email = body.email?.trim().toLowerCase() ?? "";
    const person = this.accounts.find((account) => account.email === email);
    if (!person || person.disabled || person.password !== body.password) {
      this.tries.fail();
      throw new MockError("unauthorized", email ? SIGN_IN_REFUSED : "That password isn't right. Check it and try again.");
    }
    this.tries.succeed();
    this.signInAs(person);
  }

  /** First run: the owner. */
  createOwner(body: { password: string; name?: string; email?: string }): void {
    const name = body.name?.trim() ?? "";
    const email = body.email?.trim().toLowerCase() ?? "";
    if (email && !EMAIL.test(email)) throw new MockError("invalid", "That e-mail address is missing something. It should look like name@example.com.");
    const owner: MockAccount = { id: randomUUID(), name, email, role: "owner", createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), disabled: false, password: body.password, ...(name && email ? {} : { incomplete: true }) };
    this.accounts = [owner];
    this.signInAs(owner);
  }

  forgot(email: string): { ok: true; emailAvailable: boolean } {
    if (this.forgotTries.blocked()) throw new MockTooManyError("Too many requests. Wait 15 minutes, then try again.");
    this.forgotTries.fail();
    if (this.emailAvailable) {
      const person = this.accounts.find((account) => account.email === email.trim().toLowerCase() && !account.disabled);
      if (person) this.passwordLink(person.id, false);
    }
    return { ok: true, emailAvailable: this.emailAvailable };
  }

  // ── one-time links ────────────────────────────────────────────────────

  private mint(link: MockLink): { code: string; url: string } {
    const code = randomBytes(18).toString("base64url");
    this.links.set(code, link);
    return { code, url: `${this.install.address}${LINK_PATHS[link.kind]}#${code}` };
  }

  /** A link's code, as the server checks it: a bad one counts against the limit. */
  private usableCounted(code: string): MockLink {
    if (this.tries.blocked()) throw new MockTooManyError(TOO_MANY);
    try {
      return this.usable(code);
    } catch (error) {
      this.tries.fail();
      throw error;
    }
  }

  private usable(code: string): MockLink {
    const link = this.links.get(code);
    if (!link || link.used || Date.parse(link.expiresAt) < Date.now()) throw new MockError("not-found", REFUSED_LINK);
    if (link.kind === "invitation" && !this.invitations.some((invitation) => invitation.id === link.invitationId)) throw new MockError("not-found", REFUSED_LINK);
    if (link.kind === "password" && !this.accounts.some((account) => account.id === link.accountId)) throw new MockError("not-found", REFUSED_LINK);
    return link;
  }

  check(code: string): LinkPreview {
    const link = this.usableCounted(code);
    if (link.kind === "invitation") {
      const invitation = this.invitations.find((candidate) => candidate.id === link.invitationId) as MockInvitation;
      return { kind: "invitation", email: invitation.email, role: invitation.role, invitedBy: invitation.invitedBy, expiresAt: link.expiresAt };
    }
    const person = this.accounts.find((account) => account.id === link.accountId) as MockAccount;
    return { kind: "password", email: person.email, expiresAt: link.expiresAt };
  }

  use(body: { code: string; password: string; name?: string }): void {
    const link = this.usableCounted(body.code);
    if (body.password.length < MIN_INSTALL_PASSWORD_LENGTH) throw new MockError("invalid", `Use at least ${MIN_INSTALL_PASSWORD_LENGTH} characters.`);
    if (link.kind === "invitation") {
      const name = body.name?.trim() ?? "";
      if (!name) throw new MockError("invalid", "Add a name. It's what this editor shows, and what your publishes carry.");
      const invitation = this.invitations.find((candidate) => candidate.id === link.invitationId) as MockInvitation;
      const person: MockAccount = { id: randomUUID(), name, email: invitation.email, role: invitation.role, createdAt: new Date().toISOString(), lastSeenAt: null, disabled: false, password: body.password };
      this.accounts.push(person);
      this.invitations = this.invitations.filter((candidate) => candidate.id !== invitation.id);
      link.used = true;
      this.signInAs(person);
      return;
    }
    const person = this.accounts.find((account) => account.id === link.accountId) as MockAccount;
    person.password = body.password;
    link.used = true;
    this.signInAs(person);
  }

  // ── your own account ─────────────────────────────────────────────────

  updateMe(body: { name?: string; email?: string; password?: string }): AccountSession {
    const person = this.me();
    if (body.name !== undefined) {
      if (!body.name.trim()) throw new MockError("invalid", "Add a name. It's what this editor shows, and what your publishes carry.");
    }
    let email: string | undefined;
    if (body.email !== undefined) {
      email = body.email.trim().toLowerCase();
      if (!EMAIL.test(email)) throw new MockError("invalid", NOT_AN_EMAIL);
      if (email !== person.email) {
        // Your own e-mail is an owner's to change — yours, if you are one, or if your account has none yet.
        if (person.role !== "owner" && person.email) throw new MockRoleError(OWN_EMAIL_REFUSAL);
        if (!body.password) throw new MockError("invalid", "Type your current password to change your e-mail.");
        if (body.password !== person.password) throw new MockError("invalid", "That isn't your current password.");
        if (this.accounts.some((account) => account.id !== person.id && account.email === email)) throw new MockError("conflict", TAKEN);
      }
    }
    if (body.name !== undefined) person.name = body.name.trim();
    if (email !== undefined) person.email = email;
    if (person.name && person.email) delete person.incomplete;
    return this.session(person);
  }

  changePassword(current: string, next: string): void {
    const person = this.me();
    if (this.tries.blocked()) throw new MockTooManyError(TOO_MANY);
    if (current !== person.password) {
      this.tries.fail();
      throw new MockError("invalid", "That isn't the current password.");
    }
    this.tries.succeed();
    if (next.length < MIN_INSTALL_PASSWORD_LENGTH) throw new MockError("invalid", `Use at least ${MIN_INSTALL_PASSWORD_LENGTH} characters.`);
    person.password = next;
    this.install.passwordChangedAt = new Date().toISOString();
  }

  // ── people ────────────────────────────────────────────────────────────

  people(): People {
    return {
      accounts: this.accounts.map((account) => this.public(account)),
      invitations: this.invitations.map(({ code: _code, ...invitation }) => invitation),
      emailAvailable: this.emailAvailable,
    };
  }

  private invite(email: string, role: AccountRole, invitedBy: string): { invitation: Invitation; link: OneTimeLink } {
    const expiresAt = days(INVITATION_DAYS);
    const id = randomUUID();
    const { code, url } = this.mint({ kind: "invitation", invitationId: id, expiresAt, used: false });
    const invitation: MockInvitation = { id, email, role, invitedBy, createdAt: new Date().toISOString(), expiresAt, emailed: this.emailAvailable, code };
    this.invitations.push(invitation);
    if (this.emailAvailable) this.outbox.push({ to: email, kind: "invitation", url });
    const { code: _code, ...told } = invitation;
    return { invitation: told, link: { url, expiresAt, emailed: this.emailAvailable } };
  }

  inviteBy(body: { email: string; role: AccountRole }): { invitation: Invitation; link: OneTimeLink } {
    const email = body.email.trim().toLowerCase();
    if (!EMAIL.test(email)) throw new MockError("invalid", "That e-mail address is missing something. It should look like name@example.com.");
    if (!ACCOUNT_ROLES.includes(body.role)) throw new MockError("invalid", "Choose a role: Owner, Editor or Contributor.");
    const me = this.me();
    if (!me.name || !me.email) throw new MockError("conflict", "Add your name and e-mail to your account first: an invitation says who sent it.");
    if (this.accounts.some((account) => account.email === email)) throw new MockError("conflict", TAKEN);
    if (this.invitations.some((invitation) => invitation.email === email)) throw new MockError("conflict", "That e-mail has an open invitation already. Take it back first to make a new one.");
    return this.invite(email, body.role, me.name);
  }

  takeBack(invitationId: string): void {
    if (!this.invitations.some((invitation) => invitation.id === invitationId)) throw new MockError("not-found", "That invitation isn't open any more: it was used, taken back or it ran out.");
    this.invitations = this.invitations.filter((invitation) => invitation.id !== invitationId);
    for (const link of this.links.values()) if (link.invitationId === invitationId) link.used = true;
  }

  private person(accountId: string): MockAccount {
    const person = this.accounts.find((account) => account.id === accountId);
    if (!person) throw new MockError("not-found", "That person isn't on this editor any more. Reload the list.");
    return person;
  }

  private otherOwners(person: MockAccount): number {
    return this.accounts.filter((account) => account.id !== person.id && account.role === "owner" && !account.disabled).length;
  }

  change(accountId: string, body: { role?: AccountRole; disabled?: boolean; email?: string }): Account {
    if (body.role !== undefined && !ACCOUNT_ROLES.includes(body.role)) throw new MockError("invalid", "Choose a role: Owner, Editor or Contributor.");
    const person = this.person(accountId);
    if (person.id === this.me().id) throw new MockError("conflict", ASK_ANOTHER_OWNER);
    const email = body.email === undefined ? undefined : body.email.trim().toLowerCase();
    if (email !== undefined) {
      if (!EMAIL.test(email)) throw new MockError("invalid", NOT_AN_EMAIL);
      if (this.accounts.some((account) => account.id !== person.id && account.email === email)) throw new MockError("conflict", TAKEN);
    }
    const losesOwner = person.role === "owner" && !person.disabled && ((body.role !== undefined && body.role !== "owner") || body.disabled === true);
    if (losesOwner && this.otherOwners(person) === 0) throw new MockError("conflict", LAST_OWNER);
    if (body.role !== undefined) person.role = body.role;
    if (body.disabled !== undefined) person.disabled = body.disabled;
    if (email !== undefined && email !== person.email) {
      person.email = email;
      if (person.name) delete person.incomplete;
      // A link made for the old address doesn't work any more.
      for (const link of this.links.values()) if (link.accountId === person.id) link.used = true;
    }
    return this.public(person);
  }

  remove(accountId: string): void {
    const person = this.person(accountId);
    if (person.id === this.me().id) throw new MockError("conflict", ASK_ANOTHER_OWNER);
    if (person.role === "owner" && !person.disabled && this.otherOwners(person) === 0) throw new MockError("conflict", LAST_OWNER);
    this.accounts = this.accounts.filter((account) => account.id !== person.id);
  }

  passwordLink(accountId: string, byOwner = true): OneTimeLink {
    const person = this.person(accountId);
    if (person.disabled && byOwner) throw new MockError("conflict", "This account is switched off, so it can't sign in. Switch it on first.");
    const expiresAt = new Date(Date.now() + PASSWORD_LINK_MINUTES * 60_000).toISOString();
    const { url } = this.mint({ kind: "password", accountId: person.id, expiresAt, used: false });
    const emailed = this.emailAvailable && Boolean(person.email);
    if (emailed) this.outbox.push({ to: person.email, kind: "password", url });
    // E-mailed: the link goes only to the person it is for, not back to whoever asked for it.
    return { url: emailed ? null : url, expiresAt, emailed };
  }

  signOutPerson(accountId: string): void {
    const person = this.person(accountId);
    if (this.current()?.id === person.id) this.signOutBrowser();
  }

  /** Refuse, for the signed-in person, what needs `level` and their role doesn't have. Nobody signed in as a person (first run, tests): allowed. */
  need(level: AccessLevel, refusal: string): void {
    const person = this.current();
    if (person && !roleMay(person.role, level)) throw new MockRoleError(refusal);
  }

  /** The author a publish is recorded as: the signed-in person. */
  author(): { name: string; email: string } | null {
    const person = this.current();
    return person && person.name && person.email ? { name: person.name, email: person.email } : null;
  }
}

type Request<K extends ApiRouteKey> = MockRequest<K>;

function wrap<K extends ApiRouteKey>(handlers: Handlers, key: K, handler: (req: Request<K>, base: Handlers[K]) => unknown): void {
  const base = handlers[key];
  (handlers as Record<ApiRouteKey, unknown>)[key] = (req: Request<K>) => handler(req, base);
}

/**
 * The handler table of a hosted install with accounts: `handlers` (already
 * `withInstall`) with sign-in by e-mail, the people routes, `meta.account`,
 * and publishes recorded as whoever made them.
 */
export function withAccounts(mock: MockBackend, base: Handlers, accounts: MockAccounts): Handlers {
  const handlers = { ...base };
  const ok = { ok: true as const };

  wrap(handlers, "GET /api/meta", async (req, original) => accounts.meta((await original(req)) as MetaInfo));
  wrap(handlers, "POST /api/auth/login", (req) => {
    accounts.login(req.body);
    return ok;
  });
  wrap(handlers, "POST /api/auth/logout", () => {
    accounts.signOutBrowser();
    return ok;
  });
  wrap(handlers, "POST /api/auth/logout-all", () => {
    accounts.signOutBrowser();
    return ok;
  });
  wrap(handlers, "POST /api/setup/password", async (req, original) => {
    const status = await original(req);
    accounts.createOwner(req.body);
    return status;
  });
  wrap(handlers, "POST /api/install/password", (req) => {
    accounts.changePassword(req.body.current, req.body.next);
    return ok;
  });
  accounts.install.onRestored = () => {
    accounts.seed(true);
    accounts.signOutBrowser();
  };

  // Each person's publishes carry their own name.
  const asAuthor = async <T>(run: () => T | Promise<T>): Promise<T> => {
    const author = accounts.author();
    if (!author) return run();
    const before = mock.settings.author;
    mock.settings.author = author;
    try {
      return await run();
    } finally {
      mock.settings.author = before;
    }
  };
  const withAuthor = (git: GitStatus): GitStatus => {
    const author = accounts.author();
    return author ? { ...git, author: { ...author, from: "account" } } : git;
  };
  // ── what a request asks for (the real server holds these in the engine, whatever route asks) ──
  const build = () => accounts.need(accounts.levels.build, BUILD_MODE_REFUSAL);
  const settings = () => accounts.need(accounts.levels.settings, SITE_SETTINGS_REFUSAL);
  wrap(handlers, "POST /api/sites/:siteId/threads", (req, original) => {
    if (req.body?.mode === "build") build();
    return original(req);
  });
  wrap(handlers, "POST /api/sites/:siteId/threads/:threadId/messages", (req, original) => {
    if (req.body.mode === "build") build();
    return original(req);
  });
  wrap(handlers, "PUT /api/sites/:siteId/file", (req, original) => {
    if ((req.query.path ?? "").replace(/^\.?\/+/, "") === PRODUCT.configFile) settings();
    if (req.body.mode === "build") build();
    return original(req);
  });
  const before = <K extends ApiRouteKey>(key: K, check: () => void) =>
    wrap(handlers, key, (req, original) => {
      check();
      return original(req);
    });
  // The site kit is code: setting it up, or any part of it, writes in build mode.
  before("POST /api/sites/:siteId/kit/setup", build);
  before("POST /api/sites/:siteId/kit/visibility", build);
  before("POST /api/sites/:siteId/kit/endpoint", build);
  // A host's leftover redirect file is the site's code; rebuilding an imported page runs the assistant in build mode.
  before("POST /api/sites/:siteId/redirects/leftover/remove", build);
  before("POST /api/sites/:siteId/import/rebuild", build);
  before("POST /api/sites/:siteId/import/rebuild-all", build);
  // Where the redirects take effect is kept in the site's settings file.
  before("PUT /api/sites/:siteId/redirects/settings", settings);

  wrap(handlers, "POST /api/sites/:siteId/publish", (req, original) => asAuthor(() => original(req)));
  wrap(handlers, "POST /api/sites/:siteId/revert", (req, original) => asAuthor(() => original(req)));
  wrap(handlers, "GET /api/sites/:siteId/git", async (req, original) => withAuthor((await original(req)) as GitStatus));
  wrap(handlers, "POST /api/sites/:siteId/git/check", async (req, original) => withAuthor((await original(req)) as GitStatus));
  wrap(handlers, "GET /api/sites/:siteId", async (req, original) => {
    const detail = (await original(req)) as SiteDetail;
    return { ...detail, git: withAuthor(detail.git) };
  });

  const own: Pick<Handlers, AccountsRouteKey> = {
    "GET /api/account": () => accounts.session(accounts.me()),
    "PATCH /api/account": ({ body }) => accounts.updateMe(body),
    "POST /api/account/password": ({ body }) => {
      accounts.changePassword(body.current, body.next);
      return ok;
    },
    "GET /api/people": () => accounts.people(),
    "POST /api/people/invitations": ({ body }) => accounts.inviteBy(body),
    "DELETE /api/people/invitations/:invitationId": ({ params }) => {
      accounts.takeBack(params.invitationId);
      return ok;
    },
    "PATCH /api/people/:accountId": ({ params, body }) => accounts.change(params.accountId, body),
    "DELETE /api/people/:accountId": ({ params }) => {
      accounts.remove(params.accountId);
      return ok;
    },
    "POST /api/people/:accountId/password-link": ({ params }) => accounts.passwordLink(params.accountId),
    "POST /api/people/:accountId/sign-out": ({ params }) => {
      accounts.signOutPerson(params.accountId);
      return ok;
    },
    "POST /api/people/sign-out": () => {
      accounts.signOutBrowser();
      return ok;
    },
    "POST /api/auth/link/check": ({ body }) => accounts.check(body.code),
    "POST /api/auth/link": ({ body }) => {
      accounts.use(body);
      return ok;
    },
    "POST /api/auth/forgot": ({ body }) => accounts.forgot(body.email),
    // The demo has no identity provider: these routes aren't there.
    "GET /api/auth/oidc/start": () => notHere(),
    "GET /api/auth/oidc/callback": () => notHere(),
  };
  return { ...handlers, ...own };
}
