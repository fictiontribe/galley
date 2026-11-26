/**
 * Accounts on a hosted install: who may sign in, and what each person may do.
 *
 * A hosted install has people, not one shared password. Each person signs in
 * with their own e-mail and password, their publishes carry their own name,
 * and an owner decides who is let in and as what.
 *
 * Contract only (types and the rules both sides agree on): it crosses the
 * HTTP boundary, so nothing here may carry a password, a hash, or a link's
 * code — a one-time link is told once, to the owner who made it.
 *
 * The desktop app and the local command line have no accounts: one person,
 * one computer, everything allowed.
 */

/**
 * owner       — everything: the people, the keys, backups, the Install page, the site's settings.
 * editor      — changes the site and publishes it; reads the inbox; no keys, people or Install page.
 * contributor — changes the site and sees Proof, but cannot publish, undo a publish or put the site online.
 */
export type AccountRole = "owner" | "editor" | "contributor";

export const ACCOUNT_ROLES: AccountRole[] = ["owner", "editor", "contributor"];

/** The roles as a person reads them (the People list, an invitation's e-mail). */
export const ROLE_NAMES: Record<AccountRole, string> = { owner: "Owner", editor: "Editor", contributor: "Contributor" };

/**
 * What a request needs. Every route has exactly one level (route-access.ts
 * keeps the table; adding a route without a level is a type error there).
 * The levels nest: whoever may publish may edit, whoever may manage may publish.
 *
 *  - "edit":    any signed-in person — reading the site, and anything that only
 *               changes the draft (the working copy): content, media, files, the
 *               assistant. Nothing here reaches the live site by itself.
 *  - "publish": what changes the live site or the repository — Publish, undo a
 *               publish, send, get the latest, put the site online — and reading
 *               what visitors sent through the site's forms (the inbox).
 *  - "manage":  the install itself — people, stored keys, the repository's
 *               access, backups and restore, the site's settings, plugins,
 *               where the site is hosted, app-wide settings.
 *
 * These levels keep people out of each other's way and out of trouble; they
 * are not a wall against someone who means harm. The preview runs the site's
 * own code on this server, so anyone who can change the draft can change what
 * runs here. An account is for a person the owner would trust with the
 * site's repository (docs/cloud-install.md says so too).
 */
export type AccessLevel = "edit" | "publish" | "manage";

/** The levels each role has. The one place this is decided. */
export const ROLE_ACCESS: Record<AccountRole, AccessLevel[]> = {
  owner: ["edit", "publish", "manage"],
  editor: ["edit", "publish"],
  contributor: ["edit"],
};

export function roleMay(role: AccountRole, level: AccessLevel): boolean {
  return ROLE_ACCESS[role].includes(level);
}

/**
 * Whether the account still has to choose a name: it has an e-mail and no
 * name (it accepted an invitation with a name someone here already has, or
 * its name held nothing a reader can see). Until it has one it can't
 * publish, and what it would record carries its e-mail in the name's place.
 * The owner of an install from before accounts, who has neither, is asked
 * for both in their own time and is not held up; that exception is only for
 * an account with a password and no identity at a provider. An account that
 * signs in through a provider is held without a name whatever its e-mail.
 */
export function needsName(account: { name: string; email: string; passwordHash?: string | null; identity?: unknown }): boolean {
  if (account.name) return false;
  return Boolean(account.email) || account.passwordHash === null || account.identity !== undefined;
}

/** A person who may sign in. */
export interface Account {
  id: string;
  name: string;
  /**
   * Lower-case. Empty only for the owner of an install that was set up
   * before accounts existed, until they add it (see `incomplete`).
   */
  email: string;
  role: AccountRole;
  createdAt: string;
  /** When they last signed in. */
  lastSeenAt: string | null;
  /** Switched off by an owner: can't sign in; what they published keeps their name. */
  disabled: boolean;
  /** No name or e-mail yet (an owner carried over from the single password): the app asks for them once. */
  incomplete?: boolean;
}

/** The signed-in person, as GET /api/meta tells the app. */
export interface AccountSession extends Account {
  /** What this person may do, worked out from the role. */
  access: AccessLevel[];
  /** They sign in through the identity provider: they have no password here, and their e-mail and role come from it. */
  viaProvider?: true;
  /** How this browser's session was started (GET /api/meta, for the signed-in person only). */
  sessionKind?: "password" | "provider" | "recovery";
}

/** An invitation that hasn't been taken up yet. */
export interface Invitation {
  id: string;
  email: string;
  role: AccountRole;
  /** The owner who made it, by name. */
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  /** Whether the server e-mailed the link (outgoing e-mail is set up). */
  emailed: boolean;
}

/**
 * A link that lets one person in once: an invitation, or choosing a new
 * password. Told only at the moment it is made, to the owner who made it;
 * the server keeps only its hash.
 */
export interface OneTimeLink {
  /**
   * The link, to copy and send. Null when it isn't shown: a new-password
   * link for someone else that the server has e-mailed to them. Only the
   * person it is for should hold a link that signs in as them.
   */
  url: string | null;
  expiresAt: string;
  /** The server also e-mailed it to the person. */
  emailed: boolean;
}

/**
 * An account as the server's access token is shown it, only where an
 * identity provider is set up: never a name or an e-mail.
 */
export interface OperatorAccount {
  id: string;
  role: AccountRole;
  /** Switched off: can't sign in. */
  disabled: boolean;
  /** Its subject at the install's identity provider; null when it signs in some other way. */
  subject: string | null;
}

/** A link to the identity provider waiting for the person to confirm it: whom the provider signed in. */
export interface PendingLinkView {
  /** The provider's name for the button and the page. */
  provider: string;
  /** Only an e-mail the provider confirmed; null otherwise (the page says so). */
  email: string | null;
  /** The provider's name for the person. */
  name: string | null;
  subject: string;
  /** The role the provider gives them, which Connect sets. */
  role: AccountRole;
  /** They are the last owner who can sign in here: Connect keeps them an owner whatever the provider says. */
  keepsOwner: boolean;
  /** When it can no longer be confirmed. */
  expiresAt: string;
}

/** GET /api/people with the server's access token, where an identity provider is set up. */
export interface OperatorPeople {
  accounts: OperatorAccount[];
}

/** Someone in the People list, as owners see them. */
export interface PeopleAccount extends Account {
  /** Their subject at the identity provider, when they sign in through it. Owners alone see it. */
  subject?: string;
}

/** Someone removed who signed in through the identity provider, as owners see them in People: their subject can't sign in again until an owner lets them back. */
export interface RemovedPerson {
  id: string;
  subject: string;
  removedAt: string;
  /** The owner who removed them, by name; null: the server's access token, the server, or an owner no longer here. */
  removedBy: string | null;
}

/** The People list on the Install page. */
export interface People {
  accounts: PeopleAccount[];
  /** Removed people who signed in through the identity provider, most recent first. */
  removed: RemovedPerson[];
  invitations: Invitation[];
  /**
   * This server e-mails links: outgoing e-mail is set up AND the editor's
   * public address is set (a link is only ever built from that address).
   * Invitations are then e-mailed and people can ask for a new password themselves.
   */
  emailAvailable: boolean;
}

/** What an invitation or a new-password link is for, shown before the person types anything. Nothing here identifies the install. */
export interface LinkPreview {
  /**
   * `sign-in`: a link `serve --reset-password` made, for someone who signs in
   * through the identity provider, or for anyone while passwords are off: it
   * asks for no password and sets none.
   */
  kind: "invitation" | "password" | "sign-in";
  email: string;
  /** Invitations only. */
  role?: AccountRole;
  invitedBy?: string;
  expiresAt: string;
}

/**
 * The pages a one-time link opens. The code rides in the address's fragment
 * (`/join#<code>`): a fragment never leaves the browser, so the code reaches
 * no server log and no proxy on the way. The page sends it in a request body.
 */
export const LINK_PATHS: Record<LinkPreview["kind"], string> = { invitation: "/join", password: "/new-password", "sign-in": "/new-password" };

/** How long an invitation stays good. */
export const INVITATION_DAYS = 7;
/** How long a new-password link stays good. */
export const PASSWORD_LINK_MINUTES = 60;
