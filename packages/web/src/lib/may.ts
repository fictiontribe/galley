/**
 * "May this person do that?" — answered from the one table the server
 * enforces (`@galley/core/install/route-access`), never from a list of our
 * own. Screens hide what the signed-in person can't use rather than offer it
 * and be refused.
 *
 * Local mode, the desktop app, and a hosted server from before accounts have
 * no `meta.account`: one person, everything allowed, every screen exactly as
 * before.
 */
import { useCallback } from "react";
import type { ApiRouteKey } from "@galley/core/api";
import type { MetaInfo } from "@galley/core/types";
import { ACCOUNT_ROLES, ROLE_NAMES, roleMay, type AccessLevel, type AccountRole, type AccountSession } from "@galley/core/install/accounts";
import { BUILD_MODE_LEVEL, SITE_SETTINGS_LEVEL, roleMayCall } from "@galley/core/install/route-access";
import { useMeta } from "./stores/meta";

/** The signed-in person on a hosted install with accounts; null everywhere else. */
export function accountOf(meta: MetaInfo | null | undefined): AccountSession | null {
  return meta?.mode === "hosted" && meta.account ? meta.account : null;
}

/** Whether the signed-in person may call `route`. Always true where there are no accounts. */
export function mayCall(meta: MetaInfo | null | undefined, route: ApiRouteKey): boolean {
  const account = accountOf(meta);
  return account ? roleMayCall(account.role, route) : true;
}

/** `may(route)` for the person signed in now; re-renders when who that is changes. */
export function useMay(): (route: ApiRouteKey) => boolean {
  const role = useMeta((s) => accountOf(s.meta)?.role ?? null);
  return useCallback((route: ApiRouteKey) => (role ? roleMayCall(role, route) : true), [role]);
}

/**
 * Whether the signed-in person has `level`. For what a route can't say by
 * itself — what a request asks for: build mode (`BUILD_MODE_LEVEL`), the
 * site's settings file whichever way it is written (`SITE_SETTINGS_LEVEL`).
 * Always true where there are no accounts.
 */
export function mayLevel(meta: MetaInfo | null | undefined, level: AccessLevel): boolean {
  const account = accountOf(meta);
  return account ? roleMay(account.role, level) : true;
}

/** `mayLevel(level)` for the person signed in now; re-renders when who that is changes. */
export function useMayLevel(): (level: AccessLevel) => boolean {
  const role = useMeta((s) => accountOf(s.meta)?.role ?? null);
  return useCallback((level: AccessLevel) => (role ? roleMay(role, level) : true), [role]);
}

/** Whether this person may have the assistant (or anything else) change the site's code and design. Whether the site allows it is the site's own setting, asked separately. */
export function useMayBuild(): boolean {
  return useMayLevel()(BUILD_MODE_LEVEL);
}

/** Whether this person may change the site's settings file, by any screen. */
export function useMaySiteSettings(): boolean {
  return useMayLevel()(SITE_SETTINGS_LEVEL);
}

/**
 * The roles that have `level`, for a sentence: "an editor or owner", "an
 * owner". Worked out from the roles' levels, so a sentence stays true if
 * the levels change.
 */
export function whoMay(level: AccessLevel): string {
  const roles = [...ACCOUNT_ROLES].reverse().filter((role) => roleMay(role, level));
  if (roles.length === ACCOUNT_ROLES.length) return "anyone signed in";
  const names = roles.map((role) => ROLE_NAMES[role].toLowerCase());
  const first = names[0] ?? "";
  return `${/^[aeiou]/.test(first) ? "an" : "a"} ${names.join(" or ")}`;
}

/** `whoMay` at the start of a sentence: "An editor or owner". */
export function whoMayFirst(level: AccessLevel): string {
  const words = whoMay(level);
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The one line shown where build-mode work would be offered to someone whose role doesn't include it. */
export const BUILD_BY_OTHERS = `${whoMayFirst(BUILD_MODE_LEVEL)} can do this.`;
/** The one line shown where a change to the site's settings would be offered to someone whose role doesn't include it. */
export const SETTINGS_BY_OTHERS = `${whoMayFirst(SITE_SETTINGS_LEVEL)} of this editor can change this.`;

/**
 * Who makes a change go live, in the words a sentence puts after "until",
 * "when" or "once": "you publish", or "an editor or owner publishes" for
 * someone whose role doesn't include publishing. Decided by what the role may
 * call (the same table the server enforces), never by the role's name.
 */
export function whoPublishes(mayPublish: boolean): string {
  return mayPublish ? "you publish" : "an editor or owner publishes";
}

/** `whoPublishes` for the person signed in now. Local mode and the desktop app: "you publish". */
export function useWhoPublishes(): string {
  return whoPublishes(useMay()("POST /api/sites/:siteId/publish"));
}

/** The signed-in person on a hosted install with accounts, or null. */
export function useAccount(): AccountSession | null {
  return useMeta((s) => accountOf(s.meta));
}

/** What each role is for, in one line — the People list, invitations, Your account. */
export const ROLE_LINES: Record<AccountRole, string> = {
  owner: "Everything, including the people who can sign in, stored keys, backups and the Install page.",
  editor: "Edits the site, checks changes in Proof, publishes, and reads the inbox.",
  contributor: "Edits the site and sees changes in Proof. An editor or owner publishes them.",
};

export function roleName(role: AccountRole): string {
  return ROLE_NAMES[role];
}
