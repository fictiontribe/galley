/**
 * Drag-to-reorder for a vertical list of cards (destinations, after-sending
 * steps, scripts), with the content form's drop arithmetic and edge
 * auto-scroll. Keyboard users move cards with Alt+↑/↓ or the move buttons.
 */
import { useCallback, useEffect, useRef, useState, type DragEvent, type RefObject } from "react";
import { startEdgeAutoScroll } from "@/features/content/fields/items/autoScroll";
import { dropTarget, isLowerHalf } from "@/features/content/fields/items/reorder";

const MIME = "application/x-galley-card";

export interface ListDrag {
  /** Props for the card at `index`. */
  card: (index: number) => {
    onDragOver: (event: DragEvent<HTMLElement>) => void;
    onDrop: (event: DragEvent) => void;
    "data-drop"?: "before" | "after";
    "data-dragging"?: true;
  };
  /** Props for the grip that starts the drag. */
  grip: (index: number, image?: () => HTMLElement | null) => { draggable: true; onDragStart: (event: DragEvent) => void; onDragEnd: () => void };
}

export function useListDrag(scroller: RefObject<HTMLElement | null>, onMove: (from: number, to: number) => void): ListDrag {
  const [state, setStateRaw] = useState<{ from: number; over: number; after: boolean } | null>(null);
  const ref = useRef(state);
  const setState = (next: typeof state) => {
    ref.current = next;
    setStateRaw(next);
  };
  const move = useRef(onMove);
  move.current = onMove;
  const dragging = state !== null;
  useEffect(() => {
    if (!dragging) return;
    return startEdgeAutoScroll(() => scroller.current);
  }, [dragging, scroller]);

  const card = useCallback(
    (index: number) => {
      const current = state;
      const edge: "before" | "after" | undefined = current && current.over === index && dropTarget(current.from, current.over, current.after) !== null ? (current.after ? "after" : "before") : undefined;
      return {
        onDragOver: (event: DragEvent<HTMLElement>) => {
          const live = ref.current;
          if (!live || !event.dataTransfer.types.includes(MIME)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          const after = isLowerHalf(event.clientY, event.currentTarget.getBoundingClientRect());
          if (live.over !== index || live.after !== after) setState({ ...live, over: index, after });
        },
        onDrop: (event: DragEvent) => {
          const live = ref.current;
          if (!live) return;
          event.preventDefault();
          setState(null);
          const to = dropTarget(live.from, live.over, live.after);
          if (to !== null) move.current(live.from, to);
        },
        ...(edge ? { "data-drop": edge } : {}),
        ...(current?.from === index ? { "data-dragging": true as const } : {}),
      };
    },
    [state],
  );

  const grip = useCallback(
    (index: number, image?: () => HTMLElement | null) => ({
      draggable: true as const,
      onDragStart: (event: DragEvent) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(MIME, String(index));
        event.dataTransfer.setData("text/plain", `Item ${index + 1}`);
        const element = image?.();
        if (element) event.dataTransfer.setDragImage(element, 24, 18);
        setState({ from: index, over: index, after: false });
      },
      onDragEnd: () => setState(null),
    }),
    [],
  );

  return { card, grip };
}
