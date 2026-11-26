/**
 * The people on a hosted install, over its state file (state.ts): signing
 * in, first run's owner, invitations, roles, switching off, removing, and
 * the one-time links that let someone in (an invitation, a new password).
 *
 * Every change goes through the store's one-at-a-time `update`, and every
 * rule is checked inside it against the state as it is at that moment — two
 * owners demoting each other at once can't leave the install without one.
 *
 * A one-time link's code is 32 random bytes; only its SHA-256 is kept, so the
 * state file (and a backup of it) can't be used to sign anyone in. Nothing
 * this module returns for the API carries a hash or a code: the code is
 * handed back once, to the caller that made the link, to put in the link.
 */
import { PRODUCT } from "../brand";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { GalleyError } from "../errors";
import { ACCOUNT_ROLES, INVITATION_DAYS, PASSWORD_LINK_MINUTES, ROLE_ACCESS, type Account, type AccountRole, type AccountSession, type Invitation, type LinkPreview, type OperatorAccount, type PeopleAccount } from "./accounts";
import { nameKey, tidyName } from "./names";
import { hashPassword, passwordProblem, verifyPassword } from "./password";
import { hasOwner, PROVIDER_LOGOUT_KEPT_MS, PROVIDER_LOGOUTS_KEPT, sha256Hex, signsInWithPassword, spendSetupCode, TOMBSTONES_KEPT, type InstallStateFile, type InstallStore, type StoredAccount, type StoredLink, type StoredTombstone } from "./state";

/** One refusal for every code that can't be used — unknown, used, taken back, expired — so a guesser learns nothing. */
export const LINK_REFUSED = "This link doesn't work any more: it was used already, taken back, or it ran out. Ask an owner of this editor for a new one.";
export const ASK_ANOTHER_OWNER = "Ask another owner to change your own account.";
export const LAST_OWNER = "This is the last owner who can sign in, so they stay an owner and stay switched on. Make someone else an owner first.";
export const NAME_LIMIT = 100;
/** A typed current password that isn't the person's: the route counts it against the address's limit. */
export const WRONG_CURRENT_PASSWORD = "That isn't your current password.";
/** Someone who isn't an owner asks to change the e-mail they sign in with. */
export const OWN_EMAIL_REFUSAL = "Only an owner can change the e-mail you sign in with. Ask an owner of this editor to change it for you.";
/** The server's access token asked to change an account in any way but switching it off. */
export const TOKEN_ONLY_SWITCHES_OFF = 'With the server\'s access token, an account can only be switched off ({ "disabled": true }). Switching someone on, a role and an e-mail are an owner\'s, in People.';
/** The server's access token asked to delete an account that is still switched on. */
export const TOKEN_DELETES_ONLY_SWITCHED_OFF = "With the server's access token, only an account that is switched off can be deleted. Switch it off first.";
/** Deleting a linked account when the list of removed ones is full. */
/** A removed account that signed in through a provider, as the list of removed accounts shows it. */
export interface RemovedIdentity {
  id: string;
  issuer: string;
  subject: string;
  removedAt: string;
  /** The account that removed it; null: the server's access token, or the server. */
  removedBy: string | null;
}

function removedIdentity(removed: StoredTombstone): RemovedIdentity {
  return { id: removed.id, issuer: removed.issuer, subject: removed.subject, removedAt: removed.removedAt, removedBy: removed.removedBy };
}

export const REMOVED_LIST_FULL = `This editor remembers at most ${TOMBSTONES_KEPT.toLocaleString("en")} removed accounts that signed in through its identity provider, and the list is full, so this account can't be deleted now. Switch it off instead.`;
/** An account with no password (it signs in through a provider) asked to change it. */
export const NO_PASSWORD_TO_CHANGE = "This account signs in without a password, so it has none to change.";
/** An account with no password asked to change its own e-mail, which needs the current password. */
export const NO_PASSWORD_FOR_EMAIL = "This account signs in without a password, so its e-mail can't be changed in the editor.";
/** The longest e-mail address there can be (RFC 5321's path limit). */
export const EMAIL_LIMIT = 254;

const CODE = /^[A-Za-z0-9_-]{43}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const EMAIL = /^[^@\s,;:<>"()[\]\\]+@[^@\s,;:<>"()[\]\\]+\.[^@\s,;:<>"()[\]\\]+$/;

/** What a sign-in attempt came to. The reason is for the log only: the person is told the same thing whatever it is. */
export type SignInResult = { ok: true; account: Account } | { ok: false; reason: "unknown" | "wrong" | "disabled" | "no-password"; account: Account | null };

/** A one-time link just made: its code goes into the link, once, and nowhere else. */
export interface MadeLink {
  id: string;
  code: string;
  expiresAt: string;
}

/** What a sign-in through the identity provider brings, its ID token already checked. */
export interface ProviderSignIn {
  issuer: string;
  subject: string;
  /** The `name` claim, as sent (null: none). */
  name: string | null;
  /** The e-mail, only when the provider marked it verified (null otherwise). */
  email: string | null;
  /** From the role claim, else the default role: the caller has refused a sign-in with neither. */
  role: AccountRole;
  /** The ID token's `iat`, in ms (the provider's clock). */
  issuedAt: number;
}

/** Why a sign-in through the provider was refused. */
export type ProviderSignInRefusal = "removed" | "switched-off" | "full" | "signed-out";

export type ProviderSignInResult =
  | {
      ok: true;
      account: Account;
      created: boolean;
      /** What changed at this sign-in, said for the log (no e-mails, no subjects). */
      notes: string[];
    }
  | { ok: false; reason: ProviderSignInRefusal; account: Account | null; signedOutAt?: number };

/** The most accounts an install's state holds: past it, the next start would refuse the state. */
export const ACCOUNTS_KEPT = 10_000;

export interface PeopleService {
  /** Everyone (with their subject, for those who sign in through the provider) and the open invitations (newest first). */
  list(): { accounts: PeopleAccount[]; invitations: Invitation[] };
  get(id: string): Account | null;
  /** The signed-in person as GET /api/meta tells the app: their account and what their role may do. */
  session(id: string): AccountSession | null;
  /** What the sign-in page asks for: the password alone only while everyone here who signs in with a password is an owner with no e-mail yet. */
  signInWith(): "email" | "password" | "provider";

  /**
   * Checks an e-mail and password. Without an e-mail, the password is tried
   * against the account that has none yet (an owner carried over from the
   * single password; never an account with no password or with an identity
   * at a provider). An account with no password is refused ("no-password").
   * Takes as long for an unknown e-mail as for a wrong password: a stand-in
   * hash is checked when there is no such account or no password.
   */
  verify(email: string | null, password: string): Promise<SignInResult>;
  /** Writes down when this person signed in. */
  noteSignIn(id: string): Promise<void>;
  /**
   * A sign-in through the identity provider: the account with that issuer
   * and subject, brought up to date (name, e-mail, role), or made at the
   * first sign-in — never found by e-mail. Refused for a removed subject, an
   * account switched off here, an ID token from before the subject's last
   * logout at the provider, and a new account past the limit; nothing is
   * written then.
   */
  signInThroughProvider(input: ProviderSignIn): Promise<ProviderSignInResult>;
  /**
   * The identity provider signed this subject out (back-channel logout): the
   * account's sessions issued up to a minute after the logout end, and a
   * sign-in whose ID token is from before it is refused. For a subject with
   * no account here, the logout is kept a while, so a sign-in begun before it
   * can't make the account after it. Both times only ever go up. It never
   * makes an account, switches one on or changes a role. `full`: the list of
   * recent logouts holds as many as it can, so this one wasn't kept.
   */
  providerLogout(input: { issuer: string; subject: string; issuedAt: number }): Promise<{ ok: true; account: Account | null } | { ok: false; reason: "full" }>;
  /**
   * `galley accounts link`: binds an account to a subject at the provider.
   * The subject must be on no other account and not removed, and the account
   * must have no identity yet unless `replace` (a wrong link put right). The
   * account loses its password and open password links, and every session of
   * it ends. Two accounts are never merged.
   */
  linkIdentity(accountId: string, identity: { issuer: string; subject: string }, options?: { replace?: boolean }): Promise<{ account: Account; replaced: { issuer: string; subject: string } | null }>;
  /** Whether `password` is this account's own (false for an account with none). Takes as long either way. */
  passwordIs(accountId: string, password: string): Promise<boolean>;
  /**
   * From a recovery session (`serve --reset-password`): the account stops
   * signing in through the provider and signs in with this new password
   * instead — the way to put a wrong link right from the app. Every other
   * session of it ends. Refused with passwords off: the provider is the
   * one way in there.
   */
  removeIdentity(accountId: string, newPassword: string): Promise<{ account: Account; removed: { issuer: string; subject: string } }>;
  /**
   * `galley accounts rekey`: every identity and removed account under one
   * issuer moves to another, in one write — or none does, when one would
   * meet an identity or removed account already under the new issuer.
   */
  rekeyIssuer(from: string, to: string): Promise<{ accounts: number; removed: number }>;
  /**
   * The removed accounts that signed in through a provider, oldest first: each entry's id, its identity, when it was
   * removed, and by which account (null: the server's access token, or the server).
   */
  removed(): RemovedIdentity[];
  /**
   * Takes the removed entry with this id off the list, so that identity may sign in again (as a new account) or be
   * linked. What the removal ended stays ended. Not-found when no entry has the id.
   */
  unremove(id: string): Promise<RemovedIdentity>;
  /** Makes the first owner, named by subject (GALLEY_OIDC_OWNER), while the install has no owner. Nothing when it has one. */
  nameFirstOwner(issuer: string, subject: string): Promise<Account | null>;
  /** Whether `password` is the password of one of the owners who has one (GALLEY_PASSWORD, at start-up). */
  ownerPasswordIs(password: string): Promise<boolean>;

  /** First run: the owner. Spends the setup code. Without a name or an e-mail the owner is `incomplete`. */
  createOwner(input: { password: string; name?: string; email?: string }): Promise<Account>;
  /** A starting value (GALLEY_OWNER_NAME / GALLEY_OWNER_EMAIL): fills in what the owner is missing. False when nothing was missing or the e-mail is taken. */
  completeOwner(input: { name?: string; email?: string }): Promise<boolean>;

  invite(byId: string, input: { email: string; role: AccountRole }): Promise<{ invitation: Invitation; link: MadeLink }>;
  /** Takes an invitation back; its link stops working. Returns what it was. */
  cancelInvitation(byId: string, invitationId: string): Promise<Invitation>;
  /** Writes down whether a link's e-mail went out. */
  markEmailed(linkId: string, emailed: boolean): Promise<void>;
  /**
   * Changes someone's role or e-mail, or switches them off or on. Switching
   * off ends their sessions and their open links at once; a new e-mail ends
   * their open links (each was made for the old one).
   */
  /** `byId` null: the server's access token, which may only switch an account off. */
  change(byId: string | null, accountId: string, input: { role?: AccountRole; disabled?: boolean; email?: string }): Promise<{ before: Account; after: Account }>;
  /** Removes someone: their sessions and open links end at once. */
  /**
   * Deletes an account. One that signs in through the identity provider is
   * remembered as removed (a tombstone), so its next sign-in doesn't make it
   * again. `byId` null: the server's access token, only for an account
   * already switched off.
   */
  remove(byId: string | null, accountId: string): Promise<Account>;
  /** Everyone, as the server's access token is shown them: no name, no e-mail; the subject only of an identity at `issuer`. */
  forOperator(issuer: string): OperatorAccount[];
  /** The account whose identity at `issuer` has this subject, as the server's access token is shown it; null: none. */
  byIdentity(issuer: string, subject: string): OperatorAccount | null;
  /**
   * A new-password link for someone. `byId` null: whoever runs the server
   * (`serve --reset-password`), which also switches the account back on.
   * Their older new-password link stops working; their password keeps
   * working until this one is used.
   */
  passwordLink(byId: string | null, accountId: string): Promise<{ account: Account; link: MadeLink }>;
  /** "I forgot my password": a new-password link for an enabled account with this e-mail, or null. */
  forgot(email: string): Promise<{ account: Account; link: MadeLink } | null>;
  /** What a code is for, before anyone types anything. Throws LINK_REFUSED for any code that can't be used. */
  checkLink(code: string): LinkPreview;
  /**
   * Uses a code: an invitation makes the account (a name is needed), a
   * new-password link sets the password and ends that person's other
   * sessions. Either way the link is spent.
   */
  useLink(code: string, input: { password?: string; name?: string }): Promise<{ kind: LinkPreview["kind"]; account: Account }>;

  /** Changes a person's own password. False: `current` isn't their password. Their other sessions end. */
  changePassword(accountId: string, current: string, next: string): Promise<boolean>;
  /**
   * A person's own name and e-mail. A different e-mail needs their current
   * password, and is theirs to change only as an owner or while their
   * account has none yet; everyone else's is changed by an owner (`change`).
   */
  updateProfile(accountId: string, input: { name?: string; email?: string; password?: string }): Promise<Account>;
  /** Signs one person out of every browser. */
  signOut(accountId: string): Promise<void>;
  /** Signs everyone out of every browser: the install's own "sign out everywhere", and each person's, so whatever is bound to a person's session (an open event stream) ends too. */
  signOutEveryone(): Promise<void>;
  /** The operator's way back in (`serve --reset-password`): a new-password link for the only owner, or the owner with this e-mail. Null: there is no owner yet. */
  rescue(target?: string | RescueTarget): Promise<{ account: Account; link: MadeLink } | null>;
}

export interface PeopleOptions {
  /** The clock, in ms (tests move it to see links run out). */
  now?: () => number;
  /**
   * An identity provider is set up: an account that signs in through it gets
   * no password by any link, so taking it away at the provider takes its
   * access away. (Without one — the provider taken away — such an account
   * can be given a password, as any other.)
   */
  providerConfigured?: boolean;
  /** GALLEY_OIDC_ONLY: passwords are off. No password is checked, set or invited; the one way in besides the provider is a `serve --reset-password` link. */
  passwordsOff?: boolean;
}

/** Said for anything passwords are needed for while they are off (GALLEY_OIDC_ONLY). */
export const PASSWORDS_OFF = "Passwords are off on this editor: people sign in through its identity provider.";

/** Which owner `serve --reset-password` is for: by e-mail, by account id, or by subject at the provider. */
export interface RescueTarget {
  email?: string;
  accountId?: string;
  subject?: string;
}

/** A password link for someone who signs in through the identity provider, while one is set up. */
export const NO_PASSWORD_FOR_PROVIDER_ACCOUNT = "This person signs in through the identity provider: a password would give them a way in that the provider can't take away.";

/** An account as the server's access token is shown it: no name, no e-mail. */
function operatorAccount(stored: StoredAccount, issuer: string): OperatorAccount {
  return { id: stored.id, role: stored.role, disabled: stored.disabled, subject: stored.identity?.issuer === issuer ? stored.identity.subject : null };
}

export function publicAccount(stored: StoredAccount): Account {
  return {
    id: stored.id,
    name: stored.name,
    email: stored.email,
    role: stored.role,
    createdAt: stored.createdAt,
    lastSeenAt: stored.lastSeenAt,
    disabled: stored.disabled,
    ...(stored.incomplete ? { incomplete: true } : {}),
  };
}

function publicInvitation(link: StoredLink): Invitation {
  return { id: link.id, email: link.email, role: link.role ?? "contributor", invitedBy: link.createdByName, createdAt: link.createdAt, expiresAt: link.expiresAt, emailed: link.emailed };
}

/** An e-mail address as it is kept and compared: trimmed and lower-case. Throws a plain refusal for one that can't be an address. */
export function normalizeEmail(raw: unknown): string {
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";

  if (!email) throw new GalleyError("invalid", "Add an e-mail address.");
  if (email.length > EMAIL_LIMIT || !EMAIL.test(email)) throw new GalleyError("invalid", "That doesn't look like an e-mail address. Check it and try again.");
  return email;
}

/**
 * A person's name as it is kept: single spaces, no line breaks or angle
 * brackets (it ends up in e-mails and in the repository's history), and
 * nothing in it that a reader can't see (names.ts).
 */
export function cleanName(raw: unknown): string {
  const tooLong = () => new GalleyError("invalid", `Keep the name under ${NAME_LIMIT} characters.`);

  // Far past the limit already: refused before any of it is read through.
  if (typeof raw === "string" && raw.length > NAME_LIMIT * 16) throw tooLong();
  const name = typeof raw === "string" ? tidyName(raw) : "";

  if (!name) throw new GalleyError("invalid", "Add a name. It's what this editor shows, and what your publishes carry.");
  if ([...name].length > NAME_LIMIT) throw tooLong();
  if (/[<>]/.test(name)) throw new GalleyError("invalid", "A name can't contain < or >.");
  return name;
}

/** Said when a name would read as another person's here. */
function nameTaken(name: string): GalleyError {
  return new GalleyError("conflict", `Someone here is already called “${name}”. Add something that tells the two apart, such as a middle initial.`);
}

/** Whether someone else here has a name a reader would take for this one (names.ts `nameKey`). */
function sharesName(state: InstallStateFile, name: string, exceptId: string | null): boolean {
  const key = nameKey(name);

  return key !== "" && state.accounts.some((account) => account.id !== exceptId && account.name !== "" && nameKey(account.name) === key);
}

/** A subject as the provider sends it: 1 to 255 printable ASCII characters. */
function validSubjectText(subject: unknown): subject is string {
  return typeof subject === "string" && /^[\x20-\x7e]{1,255}$/.test(subject);
}

/** Never starting with "-": an id is typed on the command line (`galley accounts link <account id>`), where it would read as an option. */
function newId(): string {
  for (;;) {
    const id = randomBytes(9).toString("base64url");

    if (!id.startsWith("-")) return id;
  }
}

function sameHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");

  return left.length === 32 && right.length === 32 && timingSafeEqual(left, right);
}

/** The open link a code belongs to. Every link is compared, in constant time, so how long this takes says nothing about a near miss. */
function linkFor(state: InstallStateFile, code: unknown, now: number): StoredLink | null {
  if (typeof code !== "string" || !CODE.test(code)) return null;
  const sha = sha256Hex(code);
  let found: StoredLink | null = null;

  for (const link of state.links) if (sameHex(link.codeSha256, sha) && !found) found = link;
  if (!found || Date.parse(found.expiresAt) <= now) return null;
  if (found.kind === "password") {
    const account = state.accounts.find((candidate) => candidate.id === found!.accountId);

    if (!account || account.disabled) return null;
  }
  return found;
}

function notHere(): GalleyError {
  return new GalleyError("not-found", "That person isn't on this editor any more. Reload the list.");
}

export function createPeople(store: InstallStore, options: PeopleOptions = {}): PeopleService {
  const now = options.now ?? Date.now;
  let standIn: Promise<string> | null = null;
  /** A hash nobody's password matches, checked when there's no such account, so an unknown e-mail costs as long as a wrong password. */
  const standInHash = () => (standIn ??= hashPassword(randomBytes(24).toString("base64url")));

  const iso = (ms: number) => new Date(ms).toISOString();
  const accountOf = (state: InstallStateFile, id: string): StoredAccount | undefined => (ID.test(id) ? state.accounts.find((account) => account.id === id) : undefined);
  const prune = (draft: InstallStateFile) => {
    const at = now();

    draft.links = draft.links.filter((link) => Date.parse(link.expiresAt) > at);
  };
  /** A moment after now and after every earlier sign-out of this person: cookies issued up to it stop counting. */
  const endSessions = (account: StoredAccount) => {
    account.sessionsValidAfter = Math.max(now(), account.sessionsValidAfter + 1);
  };
  const dropPasswordLinks = (draft: InstallStateFile, accountId: string) => {
    draft.links = draft.links.filter((link) => !(link.kind === "password" && link.accountId === accountId));
  };
  const enabledOwners = (state: InstallStateFile, except?: string) => state.accounts.filter((account) => account.role === "owner" && !account.disabled && account.id !== except).length;
  const mintLink = (input: Omit<StoredLink, "id" | "codeSha256" | "createdAt" | "expiresAt" | "emailed">, lifetimeMs: number): { stored: StoredLink; made: MadeLink } => {
    const code = randomBytes(32).toString("base64url");
    const at = now();
    const stored: StoredLink = { ...input, id: newId(), codeSha256: sha256Hex(code), createdAt: iso(at), expiresAt: iso(at + lifetimeMs), emailed: false };

    return { stored, made: { id: stored.id, code, expiresAt: stored.expiresAt } };
  };
  /** `server`: made by `serve --reset-password`, and marked so; "forgot my password" links are not. */
  const passwordLinkFor = (draft: InstallStateFile, target: StoredAccount, by: StoredAccount | null, server = false) => {
    dropPasswordLinks(draft, target.id);
    const { stored, made } = mintLink(
      { kind: "password", email: target.email, role: null, accountId: target.id, createdBy: by?.id ?? null, ...(server ? { madeBy: "server" as const } : {}), createdByName: by?.name ?? "" },
      PASSWORD_LINK_MINUTES * 60_000
    );

    draft.links.push(stored);
    return made;
  };
  /** A new-password link for `accountId`, made by `byId` (null: nobody in the app); `server` marks it as `serve --reset-password`'s. */
  const makePasswordLink = async (byId: string | null, accountId: string, server: boolean) => {
    let result: { account: Account; link: MadeLink } | null = null;

    await store.update((draft) => {
      prune(draft);
      const target = accountOf(draft, accountId);
      const by = byId === null ? null : accountOf(draft, byId);

      if (!target) throw notHere();
      if (byId !== null && !by) throw notHere();
      // The server's own link (`serve --reset-password`) is the one way in besides the provider, and is marked so; nobody else's.
      if (!server && options.passwordsOff) throw new GalleyError("forbidden", `${PASSWORDS_OFF} A new-password link can't be made.`);
      if (!server && target.identity && options.providerConfigured) throw new GalleyError("conflict", NO_PASSWORD_FOR_PROVIDER_ACCOUNT);
      if (target.disabled) {
        if (byId !== null) throw new GalleyError("conflict", "This account is switched off, so it can't sign in. Switch it on first.");
        target.disabled = false;
      }
      result = { account: publicAccount(target), link: passwordLinkFor(draft, target, by ?? null, server) };
    });
    return result!;
  };

  /**
   * What a link is for, as things stand: an invitation, a new password, or —
   * for the server's own link, where the account signs in through the
   * provider or passwords are off — a sign-in that asks for no password.
   * Null: no way in while passwords are off (only the server's link is).
   */
  const kindOf = (state: InstallStateFile, link: StoredLink): LinkPreview["kind"] | null => {
    if (link.kind === "invitation") return options.passwordsOff ? null : "invitation";
    const account = accountOf(state, link.accountId ?? "");

    if (link.madeBy === "server" && (options.passwordsOff || (account?.identity && options.providerConfigured))) return "sign-in";
    return options.passwordsOff ? null : "password";
  };
  /** The server's link used as a sign-in: spent, and nothing else changed (the owner was switched back on when it was made). */
  const signInByLink = async (code: string): Promise<{ kind: LinkPreview["kind"]; account: Account }> => {
    let result: { kind: LinkPreview["kind"]; account: Account } | null = null;

    await store.update((draft) => {
      prune(draft);
      const link = linkFor(draft, code, now());

      if (!link || kindOf(draft, link) !== "sign-in") throw new GalleyError("not-found", LINK_REFUSED);
      draft.links = draft.links.filter((candidate) => candidate !== link);
      result = { kind: "sign-in", account: publicAccount(accountOf(draft, link.accountId ?? "")!) };
    });
    return result!;
  };

  const people: PeopleService = {
    list() {
      const state = store.read();
      const at = now();

      return {
        // Owners see how each signs in: the subject at the provider, for those who sign in through it.
        accounts: state.accounts.map((account) => ({ ...publicAccount(account), ...(account.identity ? { subject: account.identity.subject } : {}) })),
        invitations: state.links
          .filter((link) => link.kind === "invitation" && Date.parse(link.expiresAt) > at)
          .map(publicInvitation)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      };
    },

    get(id) {
      const account = ID.test(id) ? store.account(id) : null;

      return account ? publicAccount(account) : null;
    },

    session(id) {
      const stored = ID.test(id) ? store.account(id) : null;

      // Whether they sign in through the provider is theirs to know (no password to change, a name the only thing to add); never which subject.
      return stored ? { ...publicAccount(stored), access: [...ROLE_ACCESS[stored.role]], ...(stored.identity ? { viaProvider: true as const } : {}) } : null;
    },

    signInWith() {
      if (options.passwordsOff) return "provider";
      const withPasswords = store.read().accounts.filter((account) => !account.disabled && signsInWithPassword(account));

      return withPasswords.length > 0 && withPasswords.every((account) => account.email === "") ? "password" : "email";
    },

    async verify(email, password) {
      const state = store.read();
      let account: StoredAccount | undefined;

      if (email === null) account = state.accounts.find((candidate) => candidate.email === "" && signsInWithPassword(candidate));
      else {
        const wanted = typeof email === "string" ? email.trim().toLowerCase() : "";

        account = wanted ? state.accounts.find((candidate) => candidate.email === wanted) : undefined;
      }
      const matches = await verifyPassword(password, account?.passwordHash ?? (await standInHash()));

      if (!account) return { ok: false, reason: "unknown", account: null };
      if (account.passwordHash === null) return { ok: false, reason: "no-password", account: publicAccount(account) };
      if (!matches) return { ok: false, reason: "wrong", account: publicAccount(account) };
      if (account.disabled) return { ok: false, reason: "disabled", account: publicAccount(account) };
      return { ok: true, account: publicAccount(account) };
    },

    async signInThroughProvider(input) {
      let result: ProviderSignInResult | null = null;
      let changedOthers = false;

      await store.update((draft) => {
        const at = now();
        const sameIdentity = (identity: { issuer: string; subject: string } | undefined) => identity?.issuer === input.issuer && identity.subject === input.subject;
        const account = draft.accounts.find((candidate) => sameIdentity(candidate.identity));

        if (draft.tombstones.some((one) => sameIdentity(one))) {
          result = { ok: false, reason: "removed", account: account ? publicAccount(account) : null };
          return;
        }
        // A sign-in begun before the provider signed this subject out can't finish after it (both times are the provider's).
        const logoutAt = account ? account.providerLogoutAt : draft.providerLogouts.filter((one) => sameIdentity(one)).reduce<number | undefined>((latest, one) => Math.max(latest ?? 0, one.at), undefined);

        if (logoutAt !== undefined && input.issuedAt <= logoutAt) {
          result = { ok: false, reason: "signed-out", account: account ? publicAccount(account) : null, signedOutAt: logoutAt };
          return;
        }
        if (account?.disabled) {
          result = { ok: false, reason: "switched-off", account: publicAccount(account) };
          return;
        }
        const notes: string[] = [];
        // A name nobody here shares and the editor's own check takes; else the part of the e-mail before the @; else none.
        const nameFrom = (raw: string | null, exceptId: string | null): string => {
          for (const candidate of [raw, input.email?.split("@")[0] ?? null]) {
            if (candidate === null) continue;
            try {
              const name = cleanName(candidate);

              if (!sharesName(draft, name, exceptId)) return name;
              notes.push("its name is taken here, so it was left without one");
              return "";
            } catch {
              notes.push("the name it was sent can't be used here");
            }
          }
          return "";
        };
        // The e-mail: verified at the provider, taken by the editor's own check, and nobody else's here.
        const emailFor = (exceptId: string | null): string => {
          if (input.email === null) return "";
          try {
            const email = normalizeEmail(input.email);

            if (draft.accounts.some((candidate) => candidate.email === email && candidate.id !== exceptId)) {
              notes.push("its e-mail is another account's here, so it has none");
              return "";
            }
            return email;
          } catch {
            notes.push("the e-mail it was sent can't be used here");
            return "";
          }
        };

        if (!account) {
          if (draft.accounts.length >= ACCOUNTS_KEPT) {
            result = { ok: false, reason: "full", account: null };
            return;
          }
          const name = nameFrom(input.name, null);
          const created: StoredAccount = {
            id: newId(),
            name,
            email: emailFor(null),
            role: input.role,
            passwordHash: null,
            passwordChangedAt: iso(at),
            createdAt: iso(at),
            lastSeenAt: iso(at),
            disabled: false,
            incomplete: !name,
            sessionsValidAfter: 0,
            identity: { issuer: input.issuer, subject: input.subject },
          };

          draft.accounts.push(created);
          result = { ok: true, account: publicAccount(created), created: true, notes };
          return;
        }
        // Every sign-in after the first brings the account up to date, by the same rules.
        if (input.name !== null) {
          let name = "";

          try {
            name = cleanName(input.name);
          } catch {
            notes.push("the name it was sent can't be used here, so it kept its own");
          }
          if (name && name !== account.name) {
            if (sharesName(draft, name, account.id)) notes.push("its new name is taken here, so it kept its own");
            else {
              account.name = name;
              changedOthers = true;
            }
          }
        }
        const email = emailFor(account.id);

        if (email !== account.email) {
          // Its open password links went to the old address.
          dropPasswordLinks(draft, account.id);
          account.email = email;
        }
        // The provider is authoritative for the role, except where that would leave no owner who can sign in.
        if (input.role !== account.role) {
          if (account.role === "owner" && enabledOwners(draft, account.id) === 0) notes.push(`the provider says ${input.role}, but it is the last owner here, so it stays an owner`);
          else {
            notes.push(`its role is now ${input.role}, as the provider says`);
            account.role = input.role;
            changedOthers = true;
          }
        }
        account.incomplete = !account.name;
        account.lastSeenAt = iso(at);
        result = { ok: true, account: publicAccount(account), created: false, notes };
      });
      // A changed role or name applies to whatever shows it at once.
      if (changedOthers) store.sessionsChanged();
      return result!;
    },

    async providerLogout({ issuer, subject, issuedAt }) {
      let result: { ok: true; account: Account | null } | { ok: false; reason: "full" } = { ok: true, account: null };

      await store.update((draft) => {
        const at = now();
        const same = (one: { issuer: string; subject: string } | undefined) => one?.issuer === issuer && one.subject === subject;
        const account = draft.accounts.find((candidate) => same(candidate.identity));

        // Only those an ID token from before them could still be taken against are kept.
        draft.providerLogouts = draft.providerLogouts.filter((one) => at - one.at < PROVIDER_LOGOUT_KEPT_MS);
        if (account) {
          // Never assigned, only raised: an older logout, or one sent again, takes nothing back.
          account.providerLogoutAt = Math.max(account.providerLogoutAt ?? 0, issuedAt);
          // Sessions made up to a minute after it end too (a provider clock behind ours), never one made after now.
          account.sessionsValidAfter = Math.max(account.sessionsValidAfter, Math.min(issuedAt + 60_000, at));
          result = { ok: true, account: publicAccount(account) };
          return;
        }
        const kept = draft.providerLogouts.find((one) => same(one));

        if (kept) kept.at = Math.max(kept.at, issuedAt);
        else if (draft.providerLogouts.length >= PROVIDER_LOGOUTS_KEPT) result = { ok: false, reason: "full" };
        else draft.providerLogouts.push({ issuer, subject, at: issuedAt });
      });
      if (result.ok && result.account) store.sessionsChanged();
      return result;
    },

    async linkIdentity(accountId, identity, linkOptions = {}) {
      if (!validSubjectText(identity.subject)) throw new GalleyError("invalid", "A subject is 1 to 255 printable characters, as the provider sends it in `sub`.");
      let result: { account: Account; replaced: { issuer: string; subject: string } | null } | null = null;

      await store.update((draft) => {
        const target = accountOf(draft, accountId);
        const same = (one: { issuer: string; subject: string } | undefined) => one?.issuer === identity.issuer && one.subject === identity.subject;

        if (!target) throw new GalleyError("not-found", "No account here has that id. `galley accounts list` shows them.");
        const other = draft.accounts.find((account) => account !== target && same(account.identity));

        if (other) throw new GalleyError("conflict", `That subject already has its own account here (${other.id}${other.name ? `, ${other.name}` : ""}). Two accounts are never merged: delete that one first, then take its subject off the list of removed accounts (\`${PRODUCT.slug} accounts unremove <subject>\`).`);
        if (draft.tombstones.some((removed) => same(removed))) throw new GalleyError("conflict", `That subject is on this editor's list of removed accounts, so it can't be linked. Take it off the list first, on the server with the server stopped: \`${PRODUCT.slug} accounts unremove <subject>\`.`);
        if (target.identity && !linkOptions.replace) {
          throw new GalleyError("conflict", `That account signs in through the provider already (subject ${target.identity.subject}). To bind another subject in its place, add --replace.`);
        }
        const replaced = target.identity && !same(target.identity) ? { ...target.identity } : null;

        target.identity = { issuer: identity.issuer, subject: identity.subject };
        // From now on the provider is its one way in: no password, no link to choose one, no session from before.
        target.passwordHash = null;
        dropPasswordLinks(draft, target.id);
        endSessions(target);
        target.incomplete = !target.name;
        result = { account: publicAccount(target), replaced };
      });
      store.sessionsChanged();
      return result!;
    },

    async passwordIs(accountId, password) {
      const account = accountOf(store.read(), accountId);
      const matches = await verifyPassword(password, account?.passwordHash ?? (await standInHash()));

      return Boolean(account && account.passwordHash !== null && matches);
    },

    async removeIdentity(accountId, newPassword) {
      if (options.passwordsOff) throw new GalleyError("forbidden", `${PASSWORDS_OFF} Signing in through it is the one way in here.`);
      const problem = passwordProblem(newPassword);

      if (problem) throw new GalleyError("invalid", problem);
      const hash = await hashPassword(newPassword);
      let result: { account: Account; removed: { issuer: string; subject: string } } | null = null;

      await store.update((draft) => {
        const target = accountOf(draft, accountId);

        if (!target) throw notHere();
        if (!target.identity) throw new GalleyError("conflict", "This account doesn't sign in through the identity provider.");
        const removed = { ...target.identity };

        delete target.identity;
        delete target.providerLogoutAt;
        target.passwordHash = hash;
        target.passwordChangedAt = iso(now());
        dropPasswordLinks(draft, target.id);
        endSessions(target);
        target.incomplete = !target.name || !target.email;
        result = { account: publicAccount(target), removed };
      });
      store.sessionsChanged();
      return result!;
    },

    async rekeyIssuer(from, to) {
      let moved = { accounts: 0, removed: 0 };

      await store.update((draft) => {
        if (from === to) throw new GalleyError("invalid", "--from and --to are the same issuer: nothing to move.");
        const under = (issuer: string) => new Set([...draft.accounts.flatMap((account) => (account.identity?.issuer === issuer ? [account.identity.subject] : [])), ...draft.tombstones.flatMap((removed) => (removed.issuer === issuer ? [removed.subject] : []))]);
        const there = under(to);
        const clashes = [...under(from)].filter((subject) => there.has(subject));

        if (clashes.length > 0) {
          throw new GalleyError("conflict", `${clashes.length === 1 ? "One subject is" : `${clashes.length} subjects are`} already under ${to} as well as under ${from}, so nothing was moved: two accounts are never merged. Delete whichever account shouldn't stay, or take a removed one off the list (\`${PRODUCT.slug} accounts unremove <subject>\`, under its issuer), then run this again.`);
        }
        for (const account of draft.accounts) {
          if (account.identity?.issuer !== from) continue;
          account.identity = { issuer: to, subject: account.identity.subject };
          moved.accounts += 1;
        }
        for (const removed of draft.tombstones) {
          if (removed.issuer !== from) continue;
          removed.issuer = to;
          moved.removed += 1;
        }
        for (const logout of draft.providerLogouts) if (logout.issuer === from) logout.issuer = to;
      });
      return moved;
    },

    removed() {
      return store.read().tombstones.map(removedIdentity);
    },

    async unremove(id) {
      let found: RemovedIdentity | null = null;

      await store.update((draft) => {
        const at = draft.tombstones.findIndex((removed) => removed.id === id);

        if (at < 0) throw new GalleyError("not-found", `No removed account has that id. \`${PRODUCT.slug} accounts removed\` lists them.`);
        found = removedIdentity(draft.tombstones.splice(at, 1)[0]!);
      });
      return found!;
    },

    async nameFirstOwner(issuer, subject) {
      let made: Account | null = null;

      await store.update((draft) => {
        if (hasOwner(draft)) return;
        const at = iso(now());
        const owner: StoredAccount = {
          id: newId(),
          name: "",
          email: "",
          role: "owner",
          passwordHash: null,
          passwordChangedAt: at,
          createdAt: at,
          lastSeenAt: null,
          disabled: false,
          incomplete: true,
          sessionsValidAfter: 0,
          identity: { issuer, subject },
        };

        draft.accounts.push(owner);
        spendSetupCode(draft);
        made = publicAccount(owner);
      });
      return made;
    },

    async noteSignIn(id) {
      await store.update((draft) => {
        const account = accountOf(draft, id);

        if (account) account.lastSeenAt = iso(now());
      });
    },

    async ownerPasswordIs(password) {
      for (const owner of store.read().accounts.filter((account) => account.role === "owner")) {
        if (owner.passwordHash !== null && (await verifyPassword(password, owner.passwordHash))) return true;
      }
      return false;
    },

    async createOwner(input) {
      const problem = passwordProblem(input.password);

      if (problem) throw new GalleyError("invalid", problem);
      const name = typeof input.name === "string" && input.name.trim() ? cleanName(input.name) : "";
      const email = typeof input.email === "string" && input.email.trim() ? normalizeEmail(input.email) : "";
      const hash = await hashPassword(input.password);
      let created: StoredAccount | null = null;

      await store.update((draft) => {
        if (hasOwner(draft)) throw new GalleyError("conflict", "This editor has an owner already. Sign in instead.");
        if (email && draft.accounts.some((account) => account.email === email)) throw new GalleyError("conflict", "Someone with that e-mail already has an account here.");
        if (name && sharesName(draft, name, null)) throw nameTaken(name);
        const at = iso(now());

        created = { id: newId(), name, email, role: "owner", passwordHash: hash, passwordChangedAt: at, createdAt: at, lastSeenAt: null, disabled: false, incomplete: !name || !email, sessionsValidAfter: 0 };
        draft.accounts.push(created);
        // The setup link works once: its code is remembered as used, so it can never be armed again.
        spendSetupCode(draft);
      });
      return publicAccount(created!);
    },

    async completeOwner(input) {
      const name = typeof input.name === "string" && input.name.trim() ? cleanName(input.name) : "";
      const email = typeof input.email === "string" && input.email.trim() ? normalizeEmail(input.email) : "";
      let changed = false;

      await store.update((draft) => {
        // Never an owner who signs in through the provider: their name and e-mail come from it.
        const owner = draft.accounts.find((account) => account.role === "owner" && account.incomplete && account.identity === undefined);

        if (!owner) return;
        // Like an e-mail that is taken: a name someone else here has is left for the owner to choose in the app.
        if (!owner.name && name && !sharesName(draft, name, owner.id)) {
          owner.name = name;
          changed = true;
        }
        if (!owner.email && email && !draft.accounts.some((account) => account.email === email)) {
          owner.email = email;
          changed = true;
        }
        owner.incomplete = !owner.name || !owner.email;
      });
      return changed;
    },

    async invite(byId, input) {
      if (options.passwordsOff) throw new GalleyError("forbidden", `${PASSWORDS_OFF} Nobody is invited with a link: whoever may sign in there comes in.`);
      const email = normalizeEmail(input.email);

      if (!ACCOUNT_ROLES.includes(input.role)) throw new GalleyError("invalid", "Choose a role: Owner, Editor or Contributor.");
      let result: { invitation: Invitation; link: MadeLink } | null = null;

      await store.update((draft) => {
        prune(draft);
        const by = accountOf(draft, byId);

        if (!by) throw notHere();
        // The invitation says who sent it.
        if (!by.name || !by.email) throw new GalleyError("conflict", "Add your name and e-mail to your account first: an invitation says who sent it.");
        if (draft.accounts.some((account) => account.email === email)) throw new GalleyError("conflict", "Someone with that e-mail already has an account here.");
        if (draft.links.some((link) => link.kind === "invitation" && link.email === email)) {
          throw new GalleyError("conflict", "That e-mail has an open invitation already. Take it back first to make a new one.");
        }
        const { stored, made } = mintLink({ kind: "invitation", email, role: input.role, accountId: null, createdBy: by.id, createdByName: by.name }, INVITATION_DAYS * 24 * 60 * 60_000);

        draft.links.push(stored);
        result = { invitation: publicInvitation(stored), link: made };
      });
      return result!;
    },

    async cancelInvitation(_byId, invitationId) {
      let removed: Invitation | null = null;

      await store.update((draft) => {
        prune(draft);
        const link = ID.test(invitationId) ? draft.links.find((candidate) => candidate.kind === "invitation" && candidate.id === invitationId) : undefined;

        if (!link) throw new GalleyError("not-found", "That invitation isn't open any more: it was used, taken back or it ran out.");
        draft.links = draft.links.filter((candidate) => candidate !== link);
        removed = publicInvitation(link);
      });
      return removed!;
    },

    async markEmailed(linkId, emailed) {
      await store.update((draft) => {
        const link = draft.links.find((candidate) => candidate.id === linkId);

        if (link) link.emailed = emailed;
      });
    },

    async change(byId, accountId, input) {
      if (input.role !== undefined && !ACCOUNT_ROLES.includes(input.role)) throw new GalleyError("invalid", "Choose a role: Owner, Editor or Contributor.");
      const email = input.email === undefined ? undefined : normalizeEmail(input.email);
      let before: Account | null = null;
      let after: Account | null = null;
      let ended = false;

      // The token ends access, never grants it: no role, no e-mail, never switching someone on.
      if (byId === null && (input.role !== undefined || input.email !== undefined || input.disabled !== true)) throw new GalleyError("forbidden", TOKEN_ONLY_SWITCHES_OFF);
      await store.update((draft) => {
        const target = accountOf(draft, accountId);

        if (!target) throw notHere();
        if (target.id === byId) throw new GalleyError("conflict", ASK_ANOTHER_OWNER);
        before = publicAccount(target);
        const role = input.role ?? target.role;
        const disabled = input.disabled ?? target.disabled;

        if (target.role === "owner" && !target.disabled && (role !== "owner" || disabled) && enabledOwners(draft, target.id) === 0) {
          throw new GalleyError("conflict", LAST_OWNER);
        }
        if (email !== undefined && email !== target.email) {
          if (draft.accounts.some((account) => account.email === email && account.id !== target.id)) throw new GalleyError("conflict", "Someone with that e-mail already has an account here.");
          // A link made for the old e-mail would still reach whoever reads that inbox.
          dropPasswordLinks(draft, target.id);
          target.email = email;
          target.incomplete = !target.name || !target.email;
        }
        if (disabled && !target.disabled) {
          endSessions(target);
          dropPasswordLinks(draft, target.id);
          ended = true;
        }
        target.role = role;
        target.disabled = disabled;
        after = publicAccount(target);
      });
      if (ended) store.sessionsChanged();
      return { before: before!, after: after! };
    },

    async remove(byId, accountId) {
      let removed: Account | null = null;

      await store.update((draft) => {
        const target = accountOf(draft, accountId);

        if (!target) throw notHere();
        if (target.id === byId) throw new GalleyError("conflict", ASK_ANOTHER_OWNER);
        if (byId === null && !target.disabled) throw new GalleyError("conflict", TOKEN_DELETES_ONLY_SWITCHED_OFF);
        if (target.role === "owner" && !target.disabled && enabledOwners(draft, target.id) === 0) throw new GalleyError("conflict", LAST_OWNER);
        const identity = target.identity;

        // Remembered as removed, so that subject's next sign-in at the provider is refused instead of making the account again.
        if (identity && !draft.tombstones.some((one) => one.issuer === identity.issuer && one.subject === identity.subject)) {
          if (draft.tombstones.length >= TOMBSTONES_KEPT) throw new GalleyError("conflict", REMOVED_LIST_FULL);
          draft.tombstones.push({ id: newId(), issuer: identity.issuer, subject: identity.subject, removedAt: iso(now()), removedBy: byId });
        }
        dropPasswordLinks(draft, target.id);
        draft.accounts = draft.accounts.filter((account) => account !== target);
        removed = publicAccount(target);
      });
      store.sessionsChanged();
      return removed!;
    },

    forOperator(issuer) {
      return store.read().accounts.map((account) => operatorAccount(account, issuer));
    },

    byIdentity(issuer, subject) {
      const found = store.read().accounts.find((account) => account.identity?.issuer === issuer && account.identity.subject === subject);

      return found ? operatorAccount(found, issuer) : null;
    },

    passwordLink(byId, accountId) {
      return makePasswordLink(byId, accountId, false);
    },

    async forgot(raw) {
      let email: string;

      try {
        email = normalizeEmail(raw);
      } catch {
        return null;
      }
      let result: { account: Account; link: MadeLink } | null = null;

      await store.update((draft) => {
        prune(draft);
        // Nothing for someone who signs in through the provider, or with passwords off: the same answer as for an e-mail nobody has.
        const target = options.passwordsOff ? undefined : draft.accounts.find((account) => account.email === email && !account.disabled && !(account.identity && options.providerConfigured));

        if (target) result = { account: publicAccount(target), link: passwordLinkFor(draft, target, null) };
      });
      return result;
    },

    checkLink(code) {
      const state = store.read();
      const link = linkFor(state, code, now());

      if (!link) throw new GalleyError("not-found", LINK_REFUSED);
      const kind = kindOf(state, link);

      // With passwords off, only the server's own link is a way in (the rest were dropped at start).
      if (kind === null) throw new GalleyError("not-found", LINK_REFUSED);
      if (kind === "invitation") return { kind: "invitation", email: link.email, role: link.role ?? "contributor", invitedBy: link.createdByName, expiresAt: link.expiresAt };
      return { kind, email: accountOf(state, link.accountId ?? "")?.email ?? link.email, expiresAt: link.expiresAt };
    },

    async useLink(code, input) {
      const found = linkFor(store.read(), code, now());

      if (!found) throw new GalleyError("not-found", LINK_REFUSED);
      const forProvider = (state: InstallStateFile, link: StoredLink) => link.kind === "password" && link.madeBy !== "server" && Boolean(options.providerConfigured && accountOf(state, link.accountId ?? "")?.identity);
      const kind = kindOf(store.read(), found);

      if (kind === null) throw new GalleyError("not-found", LINK_REFUSED);
      // Whoever made it: someone who signs in through the provider gets no password while one is set up.
      if (forProvider(store.read(), found)) throw new GalleyError("conflict", NO_PASSWORD_FOR_PROVIDER_ACCOUNT);
      // The server's link for them signs them in and changes nothing else: no password is asked for, or set.
      if (kind === "sign-in") return signInByLink(code);
      const name = found.kind === "invitation" ? cleanName(input.name) : null;
      const problem = passwordProblem(input.password);

      if (problem) throw new GalleyError("invalid", problem);
      const hash = await hashPassword(input.password!);
      let result: { kind: LinkPreview["kind"]; account: Account } | null = null;

      await store.update((draft) => {
        prune(draft);
        // Looked up again: it may have been used or taken back while the password was being hashed.
        const link = linkFor(draft, code, now());

        if (!link) throw new GalleyError("not-found", LINK_REFUSED);
        // A name someone here already has is not refused at the door: whoever holds a link would learn from it who is here.
        // They are let in without a name and choose one as a member, where a name that is taken is said to be.
        const nameless = link.kind === "invitation" && sharesName(draft, name!, null);

        draft.links = draft.links.filter((candidate) => candidate !== link);
        const at = iso(now());

        if (link.kind === "invitation") {
          if (draft.accounts.some((account) => account.email === link.email)) throw new GalleyError("conflict", "Someone with that e-mail already has an account here. Sign in instead.");
          const created: StoredAccount = {
            id: newId(),
            name: nameless ? "" : name!,
            email: link.email,
            role: link.role ?? "contributor",
            passwordHash: hash,
            passwordChangedAt: at,
            createdAt: at,
            lastSeenAt: null,
            disabled: false,
            incomplete: nameless,
            sessionsValidAfter: 0,
          };

          draft.accounts.push(created);
          result = { kind: "invitation", account: publicAccount(created) };
          return;
        }
        const currentKind = kindOf(draft, link);

        if (currentKind === null) throw new GalleyError("not-found", LINK_REFUSED);
        if (forProvider(draft, link) || currentKind !== link.kind) throw new GalleyError("conflict", NO_PASSWORD_FOR_PROVIDER_ACCOUNT);
        const account = accountOf(draft, link.accountId ?? "")!;

        account.passwordHash = hash;
        account.passwordChangedAt = at;
        endSessions(account);
        dropPasswordLinks(draft, account.id);
        result = { kind: "password", account: publicAccount(account) };
      });
      // A refusal inside the update still spent nothing: the store keeps the state from before a change that threw.
      if (result!.kind === "password") store.sessionsChanged();
      return result!;
    },

    async changePassword(accountId, current, next) {
      const account = accountOf(store.read(), accountId);

      if (!account) throw notHere();
      if (account.passwordHash === null) throw new GalleyError("invalid", NO_PASSWORD_TO_CHANGE);
      if (!(await verifyPassword(current, account.passwordHash))) return false;
      const problem = passwordProblem(next);

      if (problem) throw new GalleyError("invalid", problem);
      const hash = await hashPassword(next);

      await store.update((draft) => {
        const target = accountOf(draft, accountId);

        if (!target) throw notHere();
        // Checked again: it may have lost its password while the new one was being hashed.
        if (target.passwordHash === null) throw new GalleyError("invalid", NO_PASSWORD_TO_CHANGE);
        target.passwordHash = hash;
        target.passwordChangedAt = iso(now());
        endSessions(target);
        dropPasswordLinks(draft, target.id);
      });
      store.sessionsChanged();
      return true;
    },

    async updateProfile(accountId, input) {
      const current = accountOf(store.read(), accountId);

      if (!current) throw notHere();
      const name = input.name === undefined ? undefined : cleanName(input.name);
      const email = input.email === undefined ? undefined : normalizeEmail(input.email);

      if (email !== undefined && email !== current.email) {
        // Only an owner manages who signs in as whom; an account with no e-mail yet (the owner from before accounts, who signs in with a password) adds its own.
        if ((current.email !== "" || !signsInWithPassword(current)) && current.role !== "owner") throw new GalleyError("forbidden", OWN_EMAIL_REFUSAL);
        // The e-mail is where a new-password link goes: a browser left signed in mustn't be enough to change it. An account with no password has none to type.
        if (current.passwordHash === null) throw new GalleyError("invalid", NO_PASSWORD_FOR_EMAIL);
        if (typeof input.password !== "string" || input.password.length === 0) throw new GalleyError("invalid", "Type your current password to change your e-mail.");
        if (!(await verifyPassword(input.password, current.passwordHash))) throw new GalleyError("invalid", WRONG_CURRENT_PASSWORD);
      }
      let updated: Account | null = null;

      let renamed = false;
      await store.update((draft) => {
        const target = accountOf(draft, accountId);

        if (!target) throw notHere();
        if (email !== undefined && email !== target.email) {
          if (draft.accounts.some((account) => account.email === email && account.id !== target.id)) throw new GalleyError("conflict", "Someone with that e-mail already has an account here.");
          target.email = email;
        }
        if (name !== undefined) {
          // Keeping one's own name, however it is spelt, is never a clash: accounts alike from before stay as they are until one of them changes.
          if (nameKey(name) !== nameKey(target.name) && sharesName(draft, name, target.id)) throw nameTaken(name);
          renamed = name !== target.name;
          target.name = name;
        }
        // For an account with an identity, only a name is missing: its e-mail comes from the provider or not at all.
        target.incomplete = !target.name || (!target.email && target.identity === undefined);
        updated = publicAccount(target);
      });
      // Whatever shows this person's name looks again.
      if (renamed) store.sessionsChanged();
      return updated!;
    },

    async signOut(accountId) {
      await store.update((draft) => {
        const target = accountOf(draft, accountId);

        if (!target) throw notHere();
        endSessions(target);
      });
      store.sessionsChanged();
    },

    async signOutEveryone() {
      await store.update((draft) => {
        for (const account of draft.accounts) endSessions(account);
      });
      await store.signOutEverywhere();
    },

    async rescue(given) {
      const owners = store.read().accounts.filter((account) => account.role === "owner");
      const wanted: RescueTarget = typeof given === "string" ? { email: given } : (given ?? {});
      const email = wanted.email?.trim().toLowerCase() || undefined;
      const accountId = wanted.accountId?.trim() || undefined;
      const subject = wanted.subject?.trim() || undefined;

      if (owners.length === 0) return null;
      let target: StoredAccount | undefined;

      if (email !== undefined) {
        target = owners.find((owner) => owner.email === email);
        if (!target) throw new GalleyError("invalid", "No owner of this editor signs in with that e-mail. Check it, or leave --email out when there is only one owner.");
      } else if (accountId !== undefined) {
        target = owners.find((owner) => owner.id === accountId);
        if (!target) throw new GalleyError("invalid", "No owner of this editor has that account id. Check it, or leave --account out when there is only one owner.");
      } else if (subject !== undefined) {
        target = owners.find((owner) => owner.identity?.subject === subject);
        if (!target) throw new GalleyError("invalid", "No owner of this editor signs in through the identity provider with that subject. Check it, or leave --subject out when there is only one owner.");
      } else if (owners.length === 1) target = owners[0];
      else {
        // Printed on the server's console, which only someone with a shell there sees: enough to choose by.
        const listed = owners.map((owner) => `  ${owner.id}  ${owner.identity ? `subject ${owner.identity.subject}` : owner.email || "no e-mail"}  ${owner.name || "no name yet"}`).join("\n");

        throw new GalleyError("invalid", `This editor has ${owners.length} owners. Say which one to let back in, with --email <their e-mail>, --account <id> or --subject <subject>:\n${listed}`);
      }
      return makePasswordLink(null, target!.id, true);
    },
  };

  return people;
}
