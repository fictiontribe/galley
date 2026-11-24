/** Where the tour's card goes: beside the control it points at, inside the window, never over the control. */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const GAP = 14;
const MARGIN = 16;
/** Room for the demo band at the top of the window. */
const TOP = 44;

/**
 * `around`: what the card must stay clear of when that is more than the
 * control itself — the whole dialog a button sits in (or the card would
 * cover the dialog's other buttons), the whole change a "Put back" belongs
 * to. The card goes beside that instead, level with the control.
 */
export function placeCard(target: Rect | null, view: { width: number; height: number }, width: number, height: number, around: Rect | null = null): { x: number; y: number } {
  const clampX = (x: number) => Math.max(MARGIN, Math.min(view.width - width - MARGIN, x));
  const clampY = (y: number) => Math.max(TOP, Math.min(view.height - height - MARGIN, y));
  const clear = around ?? target;
  // Nothing to point at: the bottom right corner, out of the way.
  if (!clear) return { x: view.width - width - MARGIN, y: clampY(view.height - height - 48) };
  const level = target ?? clear;
  const right = clear.x + clear.width + GAP;
  if (right + width + MARGIN <= view.width) return { x: right, y: clampY(level.y) };
  const left = clear.x - GAP - width;
  if (left >= MARGIN) return { x: left, y: clampY(level.y) };
  const below = clear.y + clear.height + GAP;
  if (below + height + MARGIN <= view.height) return { x: clampX(level.x), y: below };
  const above = clear.y - GAP - height;
  if (above >= TOP) return { x: clampX(level.x), y: above };
  // A control as big as the window (the page itself): inside it, in the corner.
  return { x: clampX(clear.x + clear.width - width - MARGIN), y: clampY(clear.y + clear.height - height - MARGIN) };
}
