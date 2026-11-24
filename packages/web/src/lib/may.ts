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
import { ROLE_NAMES, type AccountRole, type AccountSession } from "@galley/core/install/accounts";
import { roleMayCall } from "@galley/core/install/route-access";
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
