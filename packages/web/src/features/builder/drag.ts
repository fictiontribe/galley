/** Pointer arithmetic for dragging a palette card onto the page (no DOM, so it is unit-tested). */

export interface FrameBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The pointer in the frame's coordinates, or null when it isn't over the frame. */
export function frameLocal(box: FrameBox, x: number, y: number): { x: number; y: number } | null {
  if (x < box.left || x >= box.right || y < box.top || y >= box.bottom) return null;
  return { x: x - box.left, y: y - box.top };
}

/**
 * Whether a press that moved (dx, dy) has become a drag. Touch only drags
 * sideways — towards the page — so the palette still scrolls with a finger.
 */
export function startsDrag(pointerType: string, dx: number, dy: number): boolean {
  if (pointerType === "touch") return Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2;
  return Math.hypot(dx, dy) > 5;
}
