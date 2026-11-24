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
  url: string;
  expiresAt: string;
  /** The server also e-mailed it to the person. */
  emailed: boolean;
}

/** The People list on the Install page. */
export interface People {
  accounts: Account[];
  invitations: Invitation[];
  /** Outgoing e-mail is set up on this server: invitations are e-mailed and people can ask for a new password themselves. */
  emailAvailable: boolean;
}

/** What an invitation or a new-password link is for, shown before the person types anything. Nothing here identifies the install. */
export interface LinkPreview {
  kind: "invitation" | "password";
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
export const LINK_PATHS: Record<LinkPreview["kind"], string> = { invitation: "/join", password: "/new-password" };

/** How long an invitation stays good. */
export const INVITATION_DAYS = 7;
/** How long a new-password link stays good. */
export const PASSWORD_LINK_MINUTES = 60;
