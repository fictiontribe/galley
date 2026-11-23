/**
 * Drag-and-drop arithmetic. A drop lands before or after the card under the
 * pointer; the engine's `move` takes the item's final position.
 */

/** The final index of an item dragged from `from` and dropped before/after `over`; null when nothing moves. */
export function dropTarget(from: number, over: number, after: boolean): number | null {
  const insertAt = over + (after ? 1 : 0);
  const to = insertAt > from ? insertAt - 1 : insertAt;
  return to === from ? null : to;
}

/** Whether the pointer is in the lower half of a card. */
export function isLowerHalf(pointerY: number, rect: { top: number; height: number }): boolean {
  return pointerY > rect.top + rect.height / 2;
}

/** Pixels to scroll this frame for a pointer at `y` in a box from `top` to `bottom`: negative is up, 0 outside the edge zones. */
export function edgeScrollSpeed(y: number, top: number, bottom: number, zone = 56, max = 18): number {
  const height = bottom - top;
  const band = Math.min(zone, height / 3);
  if (band <= 0) return 0;
  if (y < top + band) return -Math.ceil(max * Math.min(1, (top + band - y) / band));
  if (y > bottom - band) return Math.ceil(max * Math.min(1, (y - (bottom - band)) / band));
  return 0;
}

