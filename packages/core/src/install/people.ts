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
import { randomBytes, timingSafeEqual } from "node:crypto";
import { GalleyError } from "../errors";
import { ACCOUNT_ROLES, INVITATION_DAYS, PASSWORD_LINK_MINUTES, ROLE_ACCESS, type Account, type AccountRole, type AccountSession, type Invitation, type LinkPreview } from "./accounts";
import { hashPassword, passwordProblem, verifyPassword } from "./password";
import { hasOwner, sha256Hex, spendSetupCode, type InstallStateFile, type InstallStore, type StoredAccount, type StoredLink } from "./state";

/** One refusal for every code that can't be used — unknown, used, taken back, expired — so a guesser learns nothing. */
export const LINK_REFUSED = "This link doesn't work any more: it was used already, taken back, or it ran out. Ask an owner of this editor for a new one.";
export const ASK_ANOTHER_OWNER = "Ask another owner to change your own account.";
export const LAST_OWNER = "This is the last owner who can sign in, so they stay an owner and stay switched on. Make someone else an owner first.";
export const NAME_LIMIT = 100;
/** The longest e-mail address there can be (RFC 5321's path limit). */
export const EMAIL_LIMIT = 254;

const CODE = /^[A-Za-z0-9_-]{43}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const EMAIL = /^[^@\s,;:<>"()[\]\\]+@[^@\s,;:<>"()[\]\\]+\.[^@\s,;:<>"()[\]\\]+$/;

/** What a sign-in attempt came to. The reason is for the log only: the person is told the same thing whatever it is. */
export type SignInResult = { ok: true; account: Account } | { ok: false; reason: "unknown" | "wrong" | "disabled"; account: Account | null };

/** A one-time link just made: its code goes into the link, once, and nowhere else. */
export interface MadeLink {
  id: string;
  code: string;
  expiresAt: string;
}

export interface PeopleService {
  /** Everyone, and the open invitations (newest first). */
  list(): { accounts: Account[]; invitations: Invitation[] };
  get(id: string): Account | null;
  /** The signed-in person as GET /api/meta tells the app: their account and what their role may do. */
  session(id: string): AccountSession | null;
  /** What the sign-in page asks for: the password alone only while the one person here is an owner with no e-mail yet. */
  signInWith(): "email" | "password";

  /**
   * Checks an e-mail and password. Without an e-mail, the password is tried
   * against the account that has none yet (an owner carried over from the
   * single password). Takes as long for an unknown e-mail as for a wrong
   * password: a stand-in hash is checked when there is no such account.
   */
  verify(email: string | null, password: string): Promise<SignInResult>;
  /** Writes down when this person signed in. */
  noteSignIn(id: string): Promise<void>;
  /** Whether `password` is the password of one of the owners (GALLEY_PASSWORD, at start-up). */
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
  /** Changes someone's role, or switches them off or on. Switching off ends their sessions and their open links at once. */
  change(byId: string, accountId: string, input: { role?: AccountRole; disabled?: boolean }): Promise<{ before: Account; after: Account }>;
  /** Removes someone: their sessions and open links end at once. */
  remove(byId: string, accountId: string): Promise<Account>;
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
  useLink(code: string, input: { password: string; name?: string }): Promise<{ kind: LinkPreview["kind"]; account: Account }>;

  /** Changes a person's own password. False: `current` isn't their password. Their other sessions end. */
  changePassword(accountId: string, current: string, next: string): Promise<boolean>;
  /** A person's own name and e-mail. A different e-mail needs their current password. */
  updateProfile(accountId: string, input: { name?: string; email?: string; password?: string }): Promise<Account>;
  /** Signs one person out of every browser. */
  signOut(accountId: string): Promise<void>;
  /** Signs everyone out of every browser: the install's own "sign out everywhere", and each person's, so whatever is bound to a person's session (an open event stream) ends too. */
  signOutEveryone(): Promise<void>;
  /** The operator's way back in (`serve --reset-password`): a new-password link for the only owner, or the owner with this e-mail. Null: there is no owner yet. */
  rescue(email?: string): Promise<{ account: Account; link: MadeLink } | null>;
}

export interface PeopleOptions {
  /** The clock, in ms (tests move it to see links run out). */
  now?: () => number;
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

/** A person's name as it is kept: single spaces, no line breaks or angle brackets (it ends up in e-mails and in the repository's history). */
export function cleanName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim() : "";

  if (!name) throw new GalleyError("invalid", "Add a name. It's what this editor shows, and what your publishes carry.");
  if ([...name].length > NAME_LIMIT) throw new GalleyError("invalid", `Keep the name under ${NAME_LIMIT} characters.`);
  if (/[<>]/.test(name)) throw new GalleyError("invalid", "A name can't contain < or >.");
  return name;
}

function newId(): string {
  return randomBytes(9).toString("base64url");
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
  const passwordLinkFor = (draft: InstallStateFile, target: StoredAccount, by: StoredAccount | null) => {
    dropPasswordLinks(draft, target.id);
    const { stored, made } = mintLink(
      { kind: "password", email: target.email, role: null, accountId: target.id, createdBy: by?.id ?? null, createdByName: by?.name ?? "" },
      PASSWORD_LINK_MINUTES * 60_000
    );

    draft.links.push(stored);
    return made;
  };

  const people: PeopleService = {
    list() {
      const state = store.read();
      const at = now();

      return {
        accounts: state.accounts.map(publicAccount),
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
      const account = people.get(id);

      return account ? { ...account, access: [...ROLE_ACCESS[account.role]] } : null;
    },

    signInWith() {
      const enabled = store.read().accounts.filter((account) => !account.disabled);

      return enabled.length > 0 && enabled.every((account) => account.email === "") ? "password" : "email";
    },

    async verify(email, password) {
      const state = store.read();
      let account: StoredAccount | undefined;

      if (email === null) account = state.accounts.find((candidate) => candidate.email === "");
      else {
        const wanted = typeof email === "string" ? email.trim().toLowerCase() : "";

        account = wanted ? state.accounts.find((candidate) => candidate.email === wanted) : undefined;
      }
      const matches = await verifyPassword(password, account?.passwordHash ?? (await standInHash()));

      if (!account) return { ok: false, reason: "unknown", account: null };
      if (!matches) return { ok: false, reason: "wrong", account: publicAccount(account) };
      if (account.disabled) return { ok: false, reason: "disabled", account: publicAccount(account) };
      return { ok: true, account: publicAccount(account) };
    },

    async noteSignIn(id) {
      await store.update((draft) => {
        const account = accountOf(draft, id);

        if (account) account.lastSeenAt = iso(now());
      });
    },

    async ownerPasswordIs(password) {
      for (const owner of store.read().accounts.filter((account) => account.role === "owner")) {
        if (await verifyPassword(password, owner.passwordHash)) return true;
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
        const owner = draft.accounts.find((account) => account.role === "owner" && account.incomplete);

        if (!owner) return;
        if (!owner.name && name) {
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
      let before: Account | null = null;
      let after: Account | null = null;
      let ended = false;

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
        if (target.role === "owner" && !target.disabled && enabledOwners(draft, target.id) === 0) throw new GalleyError("conflict", LAST_OWNER);
        dropPasswordLinks(draft, target.id);
        draft.accounts = draft.accounts.filter((account) => account !== target);
        removed = publicAccount(target);
      });
      store.sessionsChanged();
      return removed!;
    },

    async passwordLink(byId, accountId) {
      let result: { account: Account; link: MadeLink } | null = null;

      await store.update((draft) => {
        prune(draft);
        const target = accountOf(draft, accountId);
        const by = byId === null ? null : accountOf(draft, byId);

        if (!target) throw notHere();
        if (byId !== null && !by) throw notHere();
        if (target.disabled) {
          if (byId !== null) throw new GalleyError("conflict", "This account is switched off, so it can't sign in. Switch it on first.");
          target.disabled = false;
        }
        result = { account: publicAccount(target), link: passwordLinkFor(draft, target, by ?? null) };
      });
      return result!;
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
        const target = draft.accounts.find((account) => account.email === email && !account.disabled);

        if (target) result = { account: publicAccount(target), link: passwordLinkFor(draft, target, null) };
      });
      return result;
    },

    checkLink(code) {
      const state = store.read();
      const link = linkFor(state, code, now());

      if (!link) throw new GalleyError("not-found", LINK_REFUSED);
      if (link.kind === "invitation") return { kind: "invitation", email: link.email, role: link.role ?? "contributor", invitedBy: link.createdByName, expiresAt: link.expiresAt };
      return { kind: "password", email: accountOf(state, link.accountId ?? "")?.email ?? link.email, expiresAt: link.expiresAt };
    },

    async useLink(code, input) {
      const found = linkFor(store.read(), code, now());

      if (!found) throw new GalleyError("not-found", LINK_REFUSED);
      const name = found.kind === "invitation" ? cleanName(input.name) : null;
      const problem = passwordProblem(input.password);

      if (problem) throw new GalleyError("invalid", problem);
      const hash = await hashPassword(input.password);
      let result: { kind: LinkPreview["kind"]; account: Account } | null = null;

      await store.update((draft) => {
        prune(draft);
        // Looked up again: it may have been used or taken back while the password was being hashed.
        const link = linkFor(draft, code, now());

        if (!link) throw new GalleyError("not-found", LINK_REFUSED);
        draft.links = draft.links.filter((candidate) => candidate !== link);
        const at = iso(now());

        if (link.kind === "invitation") {
          if (draft.accounts.some((account) => account.email === link.email)) throw new GalleyError("conflict", "Someone with that e-mail already has an account here. Sign in instead.");
          const created: StoredAccount = {
            id: newId(),
            name: name!,
            email: link.email,
            role: link.role ?? "contributor",
            passwordHash: hash,
            passwordChangedAt: at,
            createdAt: at,
            lastSeenAt: null,
            disabled: false,
            incomplete: false,
            sessionsValidAfter: 0,
          };

          draft.accounts.push(created);
          result = { kind: "invitation", account: publicAccount(created) };
          return;
        }
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
      if (!(await verifyPassword(current, account.passwordHash))) return false;
      const problem = passwordProblem(next);

      if (problem) throw new GalleyError("invalid", problem);
      const hash = await hashPassword(next);

      await store.update((draft) => {
        const target = accountOf(draft, accountId);

        if (!target) throw notHere();
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
        // The e-mail is where a new-password link goes: a browser left signed in mustn't be enough to change it.
        if (typeof input.password !== "string" || input.password.length === 0) throw new GalleyError("invalid", "Type your current password to change your e-mail.");
        if (!(await verifyPassword(input.password, current.passwordHash))) throw new GalleyError("invalid", "That isn't your current password.");
      }
      let updated: Account | null = null;

      await store.update((draft) => {
        const target = accountOf(draft, accountId);

        if (!target) throw notHere();
        if (email !== undefined && email !== target.email) {
          if (draft.accounts.some((account) => account.email === email && account.id !== target.id)) throw new GalleyError("conflict", "Someone with that e-mail already has an account here.");
          target.email = email;
        }
        if (name !== undefined) target.name = name;
        target.incomplete = !target.name || !target.email;
        updated = publicAccount(target);
      });
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

    async rescue(email) {
      const owners = store.read().accounts.filter((account) => account.role === "owner");

      if (owners.length === 0) return null;
      let target: StoredAccount | undefined;

      if (email !== undefined && email.trim() !== "") {
        const wanted = email.trim().toLowerCase();

        target = owners.find((owner) => owner.email === wanted);
        if (!target) throw new GalleyError("invalid", "No owner of this editor signs in with that e-mail. Check it, or leave --email out when there is only one owner.");
      } else if (owners.length === 1) target = owners[0];
      else throw new GalleyError("invalid", `This editor has ${owners.length} owners. Say whose password to reset with --email <their e-mail>.`);
      return people.passwordLink(null, target!.id);
    },
  };

  return people;
}
