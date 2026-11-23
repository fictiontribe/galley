import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FieldPath, JsonValue } from "@galley/core/types";
import { useForm, useFormState, useFormValue } from "../../form/context";
import { insertId, moveId, removeId } from "../../form/ids";
import { pathKey, startsWith } from "../../form/paths";
import { startEdgeAutoScroll } from "./autoScroll";
import { ItemCard, type ItemController } from "./ItemCard";
import { listActions, onListChange } from "./listActions";
import type { ListChange } from "./listPlan";
import { dropTarget, isLowerHalf } from "./reorder";
import { useItemIds } from "./useItemIds";

export interface ItemCardsProps {
  /** Path of the list. */
  path: FieldPath;
  /** "section" or "item" — used in labels ("Move section up"). */
  noun: string;
  /** Type label, one-line summary and mono key for a card's head. Keep it stable (useCallback). */
  describe: (item: JsonValue | undefined, index: number) => { label: string; summary: string; key: string };
  renderBody: (itemPath: FieldPath, item: JsonValue | undefined) => ReactNode;
  /** Ask for a new item at `index` (blocks open the palette; lists insert straight away). */
  onAdd: (index: number) => void;
  /** Once an add lands at this index, open and focus it. Bump `token` for each add. */
  added?: { index: number; token: number } | null;
}

const EMPTY: JsonValue[] = [];

interface DragState {
  from: number;
  over: number;
  after: boolean;
}

/**
 * A reorderable list of folding cards: drag by the grip, or Alt+↑/↓ and the
 * move buttons from the keyboard; duplicate; remove with Undo.
 */
export function ItemCards({ path, noun, describe, renderBody, onAdd, added }: ItemCardsProps) {
  const { store, select } = useForm();
  const value = useFormValue(path);
  const items = Array.isArray(value) ? value : EMPTY;
  const { ids, expect } = useItemIds(items);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [focus, setFocus] = useState<{ id: string; token: number } | null>(null);
  const [drag, setDragState] = useState<DragState | null>(null);
  // Drag events arrive faster than renders; the ref is the truth, the state draws the indicator.
  const dragRef = useRef<DragState | null>(null);
  const setDrag = (next: DragState | null) => {
    dragRef.current = next;
    setDragState(next);
  };
  // While dragging, the form scrolls when the pointer nears its top or bottom edge.
  const cards = useRef<HTMLDivElement>(null);
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    return startEdgeAutoScroll(() => cards.current?.closest<HTMLElement>(".app-form") ?? null);
  }, [dragging]);
  const latest = useRef({ items, ids, path, onAdd, describe });
  latest.current = { items, ids, path, onAdd, describe };

  // Every reorder, addition and removal of this list made in the app — here, on the page, or Undo —
  // announces how the items moved, so each card keeps its own key (and its open state) through it.
  const listKey = pathKey(path);
  const lastAdded = useRef<string | null>(null);
  useEffect(
    () =>
      onListChange(store, latest.current.path, (change: ListChange) => {
        const current = latest.current.ids;
        if (change.kind === "move") expect(moveId(current, change.from, change.to));
        else if (change.kind === "insert") {
          const next = insertId(current, change.index);
          lastAdded.current = next[change.index] ?? null;
          expect(next);
        } else expect(removeId(current, change.index));
      }),
    [store, listKey, expect],
  );
  const actions = useMemo(
    () => listActions({ store, path, noun, label: (item, index) => latest.current.describe(item, index).label }),
    // The path is read through `latest` by label only; the list's identity is its key.
    [store, listKey, noun],
  );

  // An add from the palette (or "Add item") opens the new card and moves focus to it.
  useEffect(() => {
    if (!added) return;
    const id = ids[added.index];
    if (!id) return;
    setOpen((current) => new Set(current).add(id));
    setFocus({ id, token: added.token });
  }, [added?.token]);

  // The issue summary asked to show a field inside one of these cards.
  const reveal = useFormState((state) => state.reveal);
  useEffect(() => {
    if (!reveal || !startsWith(reveal.path, path) || reveal.path.length <= path.length) return;
    const index = reveal.path[path.length];
    const id = typeof index === "number" ? ids[index] : undefined;
    if (id) setOpen((current) => (current.has(id) ? current : new Set(current).add(id)));
  }, [reveal, listKey, ids]);

  const controller = useMemo<ItemController>(() => {
    const now = () => latest.current;
    return {
      noun,
      toggle: (id) =>
        setOpen((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      move: (from, to, id) => {
        const moved = Math.abs(to - from) === 1 ? actions.step(from, to > from ? 1 : -1) : actions.move(from, to);
        if (moved) setFocus({ id, token: Date.now() });
      },
      duplicate: (index) => {
        if (!actions.duplicate(index)) return;
        const id = lastAdded.current;
        if (!id) return;
        setOpen((current) => new Set(current).add(id));
        setFocus({ id, token: Date.now() });
      },
      remove: (index) => {
        actions.remove(index);
      },
      addAt: (index) => now().onAdd(index),
      select,
      dragStart: (index, event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", `${noun} ${index + 1}`);
        setDrag({ from: index, over: index, after: false });
      },
      dragOver: (index, event) => {
        const current = dragRef.current;
        if (!current) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const after = isLowerHalf(event.clientY, event.currentTarget.getBoundingClientRect());
        if (current.over !== index || current.after !== after) setDrag({ ...current, over: index, after });
      },
      drop: (event) => {
        const current = dragRef.current;
        if (!current) return;
        event.preventDefault();
        setDrag(null);
        const to = dropTarget(current.from, current.over, current.after);
        const id = now().ids[current.from];
        if (to !== null && id && actions.move(current.from, to)) setFocus({ id, token: Date.now() });
      },
      dragEnd: () => setDrag(null),
    };
  }, [select, noun, actions]);

  return (
    <div className="app-cards" data-path={listKey} ref={cards}>
      {items.map((_, index) => {
        const id = ids[index] ?? `${listKey}-${index}`;
        const showDrop = drag && drag.over === index && dropTarget(drag.from, drag.over, drag.after) !== null;
        return (
          <ItemCard
            key={id}
            id={id}
            index={index}
            total={items.length}
            listPath={path}
            open={open.has(id)}
            focusToken={focus?.id === id ? focus.token : 0}
            dropEdge={showDrop ? (drag.after ? "after" : "before") : null}
            dragging={drag?.from === index}
            controller={controller}
            describe={describe}
            renderBody={renderBody}
          />
        );
      })}
    </div>
  );
}
