/**
 * Dragging a section type from the palette onto the previewed page.
 *
 * The page is another origin in a frame, so a drag can't simply cross into
 * it. The app keeps the pointer the whole way: while a palette card is
 * dragged, every frame on the screen stops taking pointer events (the same
 * trick the pane dividers use), so the app's own document sees each move —
 * mouse, pen and touch alike. When the pointer is over the proposed page,
 * the app sends its position in the frame's own coordinates
 * (`placing-pointer`); the overlay, which knows where the sections are,
 * draws the drop line, scrolls near the edges and answers with the gap
 * (`placing-at`). Releasing over the page sends `placing-drop`; the overlay
 * replies `place` with the gap it showed, and the app inserts there.
 */

import { frameLocal, startsDrag } from "./drag";

export interface PaletteDragOptions {
  /** The proposed page's frame. */
  frame: () => HTMLIFrameElement | null;
  /** What the ghost under the pointer says. */
  label: string;
  /** The drag began (the overlay should start placing). */
  onStart: () => void;
  /** The pointer is over the frame at this point, or left it (null). */
  onPoint: (point: { x: number; y: number } | null) => void;
  /** Released over the frame (true) or anywhere else / Escape (false). */
  onEnd: (overFrame: boolean) => void;
}

const PLACING_CLASS = "app-placing";

/**
 * Follows a press on a palette card. Returns a function that stops
 * following (for unmounting mid-drag). A press that never becomes a drag
 * stays a click.
 */
export function followPaletteDrag(start: PointerEvent, options: PaletteDragOptions): () => void {
  const doc = start.target instanceof Node ? (start.target.ownerDocument ?? document) : document;
  const origin = { x: start.clientX, y: start.clientY };
  let dragging = false;
  let over: { x: number; y: number } | null = null;
  let ghost: HTMLDivElement | null = null;

  const place = (x: number, y: number) => {
    if (ghost) ghost.style.transform = `translate(${Math.round(x + 12)}px, ${Math.round(y + 10)}px)`;
  };
  const begin = () => {
    dragging = true;
    doc.documentElement.classList.add(PLACING_CLASS);
    ghost = doc.createElement("div");
    ghost.className = "builder-ghost";
    ghost.setAttribute("aria-hidden", "true");
    ghost.textContent = options.label;
    doc.body.append(ghost);
    options.onStart();
  };
  const onMove = (event: PointerEvent) => {
    if (event.pointerId !== start.pointerId) return;
    if (!dragging) {
      if (!startsDrag(event.pointerType, event.clientX - origin.x, event.clientY - origin.y)) return;
      begin();
    }
    event.preventDefault();
    place(event.clientX, event.clientY);
    const frame = options.frame();
    const point = frame ? frameLocal(frame.getBoundingClientRect(), event.clientX, event.clientY) : null;
    ghost?.classList.toggle("builder-ghost--over", point !== null);
    if (point || over) options.onPoint(point);
    over = point;
  };
  const stop = (dropped: boolean) => {
    doc.removeEventListener("pointermove", onMove, true);
    doc.removeEventListener("pointerup", onUp, true);
    doc.removeEventListener("pointercancel", onCancel, true);
    doc.removeEventListener("keydown", onKey, true);
    if (!dragging) return;
    doc.documentElement.classList.remove(PLACING_CLASS);
    ghost?.remove();
    ghost = null;
    options.onEnd(dropped && over !== null);
  };
  const onUp = (event: PointerEvent) => {
    if (event.pointerId === start.pointerId) stop(true);
  };
  const onCancel = (event: PointerEvent) => {
    if (event.pointerId === start.pointerId) stop(false);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !dragging) return;
    event.preventDefault();
    event.stopPropagation();
    over = null;
    stop(false);
  };
  doc.addEventListener("pointermove", onMove, true);
  doc.addEventListener("pointerup", onUp, true);
  doc.addEventListener("pointercancel", onCancel, true);
  doc.addEventListener("keydown", onKey, true);
  return () => {
    over = null;
    stop(false);
  };
}
