/**
 * A lost session (401 / `unauthorized`) sends the person to the sign-in or
 * hand-off screen exactly once, keeping where they were going. Every other
 * request that fails meanwhile is quiet: no second redirect, no toasts.
 * `restored()` re-arms the guard once they are signed in again.
 *
 * `forbidden` (403) is not a lost session — it is shown in place like any
 * other refusal.
 */
import type { GalleyErrorShape } from "@galley/core/types";

export interface SessionGuard {
  /**
   * The session ended while the person was at `here` (path + search). Returns
   * the address to send them to the first time, and null on every later call
   * until `restored()` — and when they are already on the sign-in screen.
   */
  lost(here: string): string | null;
  /** Signed in again: the next loss redirects again. */
  restored(): void;
  /** Whether the session is currently known to be lost. */
  readonly isLost: boolean;
}

/** Only same-app paths are worth returning to; the sign-in screen never is. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/";
}

export function loginUrl(here: string): string {
  const next = safeNext(here);
  return next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}

export function createSessionGuard(): SessionGuard {
  let lost = false;
  return {
    lost(here) {
      if (lost) return null;
      lost = true;
      if (here.startsWith("/login")) return null;
      return loginUrl(here);
    },
    restored() {
      lost = false;
    },
    get isLost() {
      return lost;
    },
  };
}

/** Whether a failed request means "sign in again" (rather than "not allowed"). */
export function isUnauthorized(status: number, shape: Pick<GalleyErrorShape, "code"> | null | undefined): boolean {
  if (shape?.code === "unauthorized") return true;
  // Older servers answered a missing session with 401 + "forbidden".
  return status === 401;
}

/** The app-wide guard. */
export const session = createSessionGuard();
