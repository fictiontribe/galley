/**
 * Dragging on the canvas: fields by their grip (to reorder) and palette
 * tiles (to insert). The arithmetic and the edge auto-scroll are the content
 * form's own (`fields/items`), so a drop lands where it does in a page's
 * sections.
 */
import { useCallback, useEffect, useRef, useState, type DragEvent, type RefObject } from "react";
import { startEdgeAutoScroll } from "@/features/content/fields/items/autoScroll";
import { dropTarget, isLowerHalf } from "@/features/content/fields/items/reorder";
import type { PaletteKind } from "../logic/fieldTypes";

export const PALETTE_MIME = "application/x-galley-form-field";
const FIELD_MIME = "application/x-galley-form-move";

export interface DropState {
  /** Field being moved (global index), or null for a palette tile. */
  from: number | null;
  over: number;
  after: boolean;
}

export interface CanvasDrag {
  drop: DropState | null;
  dragging: number | null;
  startField: (index: number, event: DragEvent) => void;
  overField: (index: number, half: boolean, event: DragEvent<HTMLElement>) => void;
  overEnd: (lastIndex: number, event: DragEvent) => void;
  dropHere: (event: DragEvent) => void;
  end: () => void;
}

export interface DragHandlers {
  move: (from: number, to: number) => void;
  insert: (kind: PaletteKind, index: number) => void;
}

/** Whether the pointer is past the middle: lower half for full-width fields, right half for half-width ones. */
function isAfter(event: DragEvent<HTMLElement>, half: boolean): boolean {
  const rect = event.currentTarget.getBoundingClientRect();
  if (half) return event.clientX > rect.left + rect.width / 2;
  return isLowerHalf(event.clientY, rect);
}

const fromPalette = (event: DragEvent) => event.dataTransfer.types.includes(PALETTE_MIME);

export function useCanvasDrag(scroller: RefObject<HTMLElement | null>, handlers: DragHandlers): CanvasDrag {
  const [drop, setDropState] = useState<DropState | null>(null);
  const ref = useRef<DropState | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const setDrop = (next: DropState | null) => {
    const current = ref.current;
    if (current && next && current.over === next.over && current.after === next.after && current.from === next.from) return;
    ref.current = next;
    setDropState(next);
  };

  // While anything is dragged over the canvas, it scrolls near its edges.
  const active = drop !== null || dragging !== null;
  useEffect(() => {
    if (!active) return;
    const stop = startEdgeAutoScroll(() => scroller.current);
    const finish = () => {
      ref.current = null;
      setDropState(null);
      setDragging(null);
    };
    document.addEventListener("dragend", finish);
    document.addEventListener("drop", finish);
    return () => {
      stop();
      document.removeEventListener("dragend", finish);
      document.removeEventListener("drop", finish);
    };
  }, [active, scroller]);

  const startField = useCallback((index: number, event: DragEvent) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(FIELD_MIME, String(index));
    event.dataTransfer.setData("text/plain", `Field ${index + 1}`);
    setDragging(index);
  }, []);

  const overField = useCallback(
    (index: number, half: boolean, event: DragEvent<HTMLElement>) => {
      const palette = fromPalette(event);
      if (!palette && dragging === null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = palette ? "copy" : "move";
      setDrop({ from: palette ? null : dragging, over: index, after: isAfter(event, half) });
    },
    [dragging],
  );

  const overEnd = useCallback(
    (lastIndex: number, event: DragEvent) => {
      const palette = fromPalette(event);
      if (!palette && dragging === null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = palette ? "copy" : "move";
      setDrop({ from: palette ? null : dragging, over: lastIndex, after: true });
    },
    [dragging],
  );

  const dropHere = useCallback((event: DragEvent) => {
    const current = ref.current;
    if (!current) return;
    event.preventDefault();
    const kind = event.dataTransfer.getData(PALETTE_MIME);
    ref.current = null;
    setDropState(null);
    setDragging(null);
    if (kind) {
      handlersRef.current.insert(kind as PaletteKind, current.over < 0 ? 0 : current.over + (current.after ? 1 : 0));
      return;
    }
    if (current.from === null) return;
    const to = dropTarget(current.from, current.over, current.after);
    if (to !== null) handlersRef.current.move(current.from, to);
  }, []);

  const end = useCallback(() => {
    ref.current = null;
    setDropState(null);
    setDragging(null);
  }, []);

  return { drop, dragging, startField, overField, overEnd, dropHere, end };
}

/** Which edge of a field shows the drop line, or null. */
export function dropEdge(drop: DropState | null, index: number): "before" | "after" | null {
  if (!drop || drop.over !== index) return null;
  if (drop.from !== null && dropTarget(drop.from, drop.over, drop.after) === null) return null;
  return drop.after ? "after" : "before";
}
