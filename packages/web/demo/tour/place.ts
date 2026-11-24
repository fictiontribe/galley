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

export function placeCard(target: Rect | null, view: { width: number; height: number }, width: number, height: number): { x: number; y: number } {
  const clampX = (x: number) => Math.max(MARGIN, Math.min(view.width - width - MARGIN, x));
  const clampY = (y: number) => Math.max(TOP, Math.min(view.height - height - MARGIN, y));
  // Nothing to point at: the bottom right corner, out of the way.
  if (!target) return { x: view.width - width - MARGIN, y: clampY(view.height - height - 48) };
  const right = target.x + target.width + GAP;
  if (right + width + MARGIN <= view.width) return { x: right, y: clampY(target.y) };
  const left = target.x - GAP - width;
  if (left >= MARGIN) return { x: left, y: clampY(target.y) };
  const below = target.y + target.height + GAP;
  if (below + height + MARGIN <= view.height) return { x: clampX(target.x), y: below };
  const above = target.y - GAP - height;
  if (above >= TOP) return { x: clampX(target.x), y: above };
  // A control as big as the window (the page itself): inside it, in the corner.
  return { x: clampX(target.x + target.width - width - MARGIN), y: clampY(target.y + target.height - height - MARGIN) };
}
