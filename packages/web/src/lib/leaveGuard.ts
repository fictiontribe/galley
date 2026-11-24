/**
 * A screen with unsaved work (the theme editor) can ask before the app
 * navigates away by itself — the command palette, a site shortcut — the way
 * it asks before a link is followed. One guard at a time: the screen on
 * show. Without one, navigation simply happens.
 */
type Guard = (proceed: () => void) => void;

let guard: Guard | null = null;

/** Set while there is unsaved work; returns the function that takes it off again. */
export function setLeaveGuard(next: Guard): () => void {
  guard = next;
  return () => {
    if (guard === next) guard = null;
  };
}

/** Navigate now, or once the screen with unsaved work has agreed to it. */
export function requestLeave(proceed: () => void): void {
  if (guard) guard(proceed);
  else proceed();
}
