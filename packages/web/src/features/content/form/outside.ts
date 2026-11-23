import type { ChangeOrigin } from "@galley/core/types";

/** The fresh copies the form announces: the assistant's edits, and edits made outside the app. */
export type OutsideKind = Extract<ChangeOrigin, "agent" | "external">;

/**
 * Whether a fresh copy of the entry folded into the form deserves a note.
 * Copies written in this app (the form itself, click-to-edit on the page,
 * Proof's "Put back") update the form silently — the person just made that
 * change. Only the assistant's edits and changes from outside the app are
 * announced; anything else (publishing, discarding, an unknown source) is
 * folded in quietly.
 */
export function outsideKind({ own, origin }: { own: boolean; origin: ChangeOrigin | null | undefined }): OutsideKind | null {
  if (own) return null;
  if (origin === "agent" || origin === "external") return origin;
  return null;
}
