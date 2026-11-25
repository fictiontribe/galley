/**
 * What an extension may ask about the people signed in: a name, and whether
 * a sign-in still counts. Nothing else about an account is handed out.
 *
 * A sign-in is named to an extension by a `SessionRef`: a keyed hash of it,
 * made with a key generated for this purpose when the server starts (never
 * the key that signs cookies). The cookie's own nonce can't be worked back
 * from it and it is no use for making a cookie. It is a stable name for one
 * sign-in while the server runs, so `counts` also tells an extension when
 * someone else signs out: that is what it is for.
 */
import { createHmac, randomBytes } from "node:crypto";
import type { Install } from "@galley/core/install";
import { SESSION_MAX_AGE_S, type RevocationList, type SessionInfo } from "../auth";
import type { ExtensionPeople, SessionRef } from "./types";

/** The most sign-ins remembered at once. Past it, the ones that no longer count go first, then the oldest. */
export const MAX_SESSION_REFS = 4096;

export interface PeopleDesk {
  people: ExtensionPeople;
  /** The name an extension knows this sign-in by. */
  refOf(session: SessionInfo): SessionRef;
  /** Whether a sign-in counts now, by the same test a request and an open stream are held to. */
  stillCounts(session: SessionInfo, now?: number): boolean;
}

export function createPeopleDesk(install: Install, revoked: Pick<RevocationList, "has">, run: (what: string, listener: () => unknown) => void): PeopleDesk {
  const key = randomBytes(32);
  const known = new Map<string, SessionInfo>();

  function stillCounts(stamp: SessionInfo, now = Date.now()): boolean {
    if (stamp.accountId === undefined || revoked.has(stamp.id)) return false;
    if (now - stamp.issuedAt > SESSION_MAX_AGE_S * 1000 || !install.store.sessionValid(stamp, now)) return false;
    const account = install.store.account(stamp.accountId);

    return Boolean(account && !account.disabled && stamp.issuedAt > account.sessionsValidAfter);
  }

  function prune(): void {
    for (const [ref, stamp] of known) if (!stillCounts(stamp)) known.delete(ref);
    // Still too many (thousands of live sign-ins): the oldest are forgotten, and simply stop counting for extensions.
    for (const ref of known.keys()) {
      if (known.size <= MAX_SESSION_REFS) break;
      known.delete(ref);
    }
  }

  install.store.onSessionsChanged(prune);
  return {
    stillCounts,
    refOf(stamp) {
      const ref = `s${createHmac("sha256", key).update(`${stamp.id}\n${stamp.issuedAt}\n${stamp.accountId ?? ""}`, "utf8").digest("base64url").slice(0, 32)}`;

      if (!known.has(ref)) {
        known.set(ref, { id: stamp.id, issuedAt: stamp.issuedAt, ...(stamp.accountId === undefined ? {} : { accountId: stamp.accountId }) });
        if (known.size > MAX_SESSION_REFS) prune();
      }
      return ref as SessionRef;
    },
    people: Object.freeze({
      name(account: string) {
        const found = typeof account === "string" ? install.store.account(account) : null;

        return found && !found.disabled ? found.name : null;
      },
      counts(ref: SessionRef) {
        const stamp = typeof ref === "string" ? known.get(ref) : undefined;

        return stamp !== undefined && stillCounts(stamp);
      },
      onChange(listener: () => void) {
        return install.store.onSessionsChanged(() => run("a people listener", listener));
      },
    }),
  };
}
