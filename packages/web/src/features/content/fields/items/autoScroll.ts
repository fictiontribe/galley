/**
 * Scrolling the form while a section is dragged near its edge, so it can be
 * dragged past what's on screen.
 */
import { edgeScrollSpeed } from "./reorder";

/**
 * While `active`, scroll `container()` when a drag hovers near its top or
 * bottom edge. Returns the stop function.
 */
export function startEdgeAutoScroll(container: () => HTMLElement | null): () => void {
  let pointer: number | null = null;
  let frame = 0;
  const onDragOver = (event: DragEvent) => {
    pointer = event.clientY;
  };
  const tick = () => {
    const box = container();
    if (box && pointer !== null) {
      const rect = box.getBoundingClientRect();
      const speed = edgeScrollSpeed(pointer, rect.top, rect.bottom);
      if (speed !== 0) box.scrollTop += speed;
    }
    frame = requestAnimationFrame(tick);
  };
  document.addEventListener("dragover", onDragOver);
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
    document.removeEventListener("dragover", onDragOver);
  };
}
