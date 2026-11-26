/**
 * The app's half of Arrange mode. It tells the page's overlay what the
 * entry's sections are, and turns what the person does on the page — or in
 * the palette — into edits through the entry's own op queue (the form's
 * store), with the same list actions the form's cards use. The app is the
 * truth for the selection; the page only reports clicks, keys and drops.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import type { ArrangeDeclineCause, BlockType, Entry, Field, HostToOverlay, JsonValue, OverlayToHost } from "@galley/core/types";
import { listActions, onListChange, undoLastListAction, type ListActions } from "@/features/content/fields/items/listActions";
import { followIndex } from "@/features/content/fields/items/listPlan";
import { addSection } from "@/features/content/form/addSection";
import { blockLabel } from "@/features/content/form/summary";
import type { FormState, FormStore } from "@/features/content/form/store";
import { toOverlay } from "@/features/preview/frames";
import { declineKind, declineWords, type DeclineKind, type DeclineWords, type PageReport } from "./declined";
import { blocksFields, parseSectionKey, positionWords, sectionKey, sectionLists } from "./model";
import { followPaletteDrag } from "./placing";

/** What the editor hands the preview so it can arrange the page. */
export interface BuilderSource {
  entry: Entry | null;
  /** The entry's op queue; null until the form has opened the entry. */
  store: FormStore | null;
  /** Open a section's card in the form and scroll to it. */
  onEditSection: (field: string, index: number) => void;
}

export type MapStatus = "loading" | "waiting" | "mapped" | "declined";
export interface Target {
  field: string;
  index: number;
}

/** How long the chrome waits for the page to show an edit before it takes the page's word again. */
const AWAIT_MS = 6000;
const NO_FIELDS: Field[] = [];
const EMPTY: { [key: string]: JsonValue } = {};

function useSlice<T>(store: FormStore | null, select: (state: FormState) => T, fallback: T): T {
  const subscribe = useCallback((listener: () => void) => (store ? store.subscribe(listener) : () => undefined), [store]);
  return useSyncExternalStore(subscribe, () => (store ? select(store.getState()) : fallback));
}

export interface ArrangeOptions {
  source: BuilderSource | undefined;
  /** Arrange is the preview's tool and the proposed page is showing. */
  on: boolean;
  /** Post to the proposed page's overlay. */
  post: (message: HostToOverlay) => void;
  frame: RefObject<HTMLIFrameElement | null>;
  /** What the proposed page's overlay said about whether it was drawn (null until it says, or from an older overlay). */
  page?: PageReport | null;
}

/** Why the page can't be arranged, in one of four plain cases (declined.ts). */
export interface Decline {
  kind: DeclineKind;
  words: DeclineWords;
  /** The technical reason, for Technical details. */
  reason: string | null;
}

export function useArrange({ source, on, post, frame, page = null }: ArrangeOptions) {
  const entry = source?.entry ?? null;
  const store = source?.store ?? null;
  const fields = useMemo(() => blocksFields(entry?.fields ?? NO_FIELDS), [entry?.fields]);
  const available = fields.length > 0 && store !== null;
  const active = on && available;
  const editable = entry !== null && entry.status !== "deleted";
  const stored = useSlice(store, (state) => state.stored, EMPTY);
  const data = useSlice(store, (state) => state.data, EMPTY);
  const busy = useSlice(store, (state) => state.busy, false);

  // ── what the page is told
  const lists = useMemo(() => sectionLists(fields, stored), [fields, stored]);
  const revision = useRef({ signature: "", value: 0 });
  const signature = JSON.stringify(lists);
  if (signature !== revision.current.signature) revision.current = { signature, value: revision.current.value + 1 };
  const currentRevision = revision.current.value;

  const [selected, setSelectedState] = useState<string | null>(null);
  const reveal = useRef(false);
  const select = useCallback((key: string | null, show = false) => {
    reveal.current = show;
    setSelectedState(key);
  }, []);
  const [status, setStatus] = useState<{ status: MapStatus; how: "markers" | "evidence" | null; reason: string | null; cause?: ArrangeDeclineCause | null }>({ status: "loading", how: null, reason: null });
  const [awaitingUntil, setAwaitingUntil] = useState(0);
  const [target, setTarget] = useState<Target | null>(null);
  const [placing, setPlacing] = useState<{ block: BlockType; field: string } | null>(null);
  const [placingAt, setPlacingAt] = useState<number | null>(null);
  const [optionsToken, setOptionsToken] = useState(0);
  const [note, setNote] = useState("");
  const placingRef = useRef(placing);
  placingRef.current = placing;
  /** The section type of a drag that just ended over the page, until the page answers with where. */
  const dropping = useRef<{ block: BlockType; field: string } | null>(null);
  const stopDrag = useRef<(() => void) | null>(null);

  // A new entry starts with nothing selected or being placed.
  useEffect(() => {
    select(null);
    setTarget(null);
    setPlacing(null);
    setStatus({ status: "loading", how: null, reason: null });
  }, [entry?.path, select]);

  // A change to the sections means the page will re-render: the chrome waits until it has.
  const lastRevision = useRef(currentRevision);
  useEffect(() => {
    if (lastRevision.current === currentRevision) return;
    lastRevision.current = currentRevision;
    if (status.status === "mapped") setAwaitingUntil(Date.now() + AWAIT_MS);
  }, [currentRevision, status.status]);
  useEffect(() => {
    if (awaitingUntil <= Date.now()) return;
    const timer = setTimeout(() => setAwaitingUntil(0), awaitingUntil - Date.now() + 10);
    return () => clearTimeout(timer);
  }, [awaitingUntil]);
  const settling = busy || awaitingUntil > Date.now();

  // The selection can't outlive its section.
  const parsed = parseSectionKey(selected);
  const selectedField = parsed ? (fields.find((field) => field.key === parsed.field) ?? null) : null;
  const selectedList = selectedField ? data[selectedField.key] : undefined;
  const selectedItem = parsed && Array.isArray(selectedList) ? selectedList[parsed.index] : undefined;
  useEffect(() => {
    if (selected && selectedItem === undefined && !busy) select(null);
  }, [selected, selectedItem, busy, select]);

  // Reorders made in the form keep the same section selected on the page.
  useEffect(() => {
    if (!store) return;
    const stops = fields.map((field) =>
      onListChange(store, [field.key], (change) => {
        setSelectedState((current) => {
          const at = parseSectionKey(current);
          if (!at || at.field !== field.key) return current;
          const next = followIndex(at.index, change);
          return next === null ? null : sectionKey(field.key, next);
        });
      }),
    );
    return () => stops.forEach((stop) => stop());
  }, [store, fields]);

  const send = useCallback(() => {
    post(toOverlay({ type: "arrange", on: active, lists: active ? lists : [], editable, selected: active ? selected : null, settling, revision: currentRevision, reveal: reveal.current }));
    reveal.current = false;
  }, [post, active, lists, editable, selected, settling, currentRevision]);
  const wasOn = useRef(false);
  useEffect(() => {
    if (!active && !wasOn.current) return;
    wasOn.current = active;
    send();
  }, [send, active]);

  // ── acting on sections
  const actionsFor = useMemo(() => {
    const byField = new Map<string, { field: Field; actions: ListActions }>();
    if (store) for (const field of fields) byField.set(field.key, { field, actions: listActions({ store, path: [field.key], noun: "section", label: (item) => blockLabel(item, field) }) });
    return byField;
  }, [store, fields]);
  const labelsOf = useCallback(
    (fieldKey: string): string[] => {
      const entry = actionsFor.get(fieldKey);
      const list = data[fieldKey];
      return entry && Array.isArray(list) ? list.map((item) => blockLabel(item, entry.field)) : [];
    },
    [actionsFor, data],
  );

  const insertAt = useCallback(
    (block: BlockType, fieldKey: string, index: number) => {
      const target = actionsFor.get(fieldKey);
      if (!target || !editable || !store || !entry) return;
      const where = positionWords(labelsOf(fieldKey), index);
      // The form's "Add section" does exactly this: one rule for what a new section starts with.
      if (addSection({ store, field: target.field, path: [fieldKey], block, index, entryPath: entry.path })) {
        select(sectionKey(fieldKey, index), true);
        setNote(`${block.label} added ${where}. It’s waiting in Proof.`);
      }
    },
    [actionsFor, editable, labelsOf, select, store, entry],
  );

  const stopPlacing = useCallback(() => {
    if (placingRef.current) post(toOverlay({ type: "placing", field: null, label: null }));
    setPlacing(null);
    setPlacingAt(null);
  }, [post]);

  const handle = useCallback(
    (message: OverlayToHost) => {
      switch (message.type) {
        case "arrange-status":
          if (message.revision !== revision.current.value) return;
          setStatus({ status: message.status, how: message.how, reason: message.reason, cause: message.cause ?? null });
          if (message.status === "mapped") setAwaitingUntil(0);
          return;
        case "arrange-select":
          select(message.key);
          return;
        case "arrange-action": {
          const entry = actionsFor.get(message.field);
          if (!entry) return;
          const { actions } = entry;
          const list = data[message.field];
          const length = Array.isArray(list) ? list.length : 0;
          switch (message.action) {
            case "move":
              if (editable && actions.move(message.index, message.to)) select(sectionKey(message.field, message.to), true);
              return;
            case "step": {
              // The page may not show the last step yet; the app's selection is where the section is now.
              const at = parseSectionKey(selected);
              const index = at && at.field === message.field ? at.index : message.index;
              if (editable && actions.step(index, message.delta)) select(sectionKey(message.field, index + message.delta), true);
              return;
            }
            case "duplicate":
              if (editable && actions.duplicate(message.index)) select(sectionKey(message.field, message.index + 1), true);
              return;
            case "remove":
              if (!editable || !actions.remove(message.index)) return;
              select(length > 1 ? sectionKey(message.field, Math.min(message.index, length - 2)) : null, true);
              return;
            case "undo":
              if (store) undoLastListAction(store);
              return;
            case "edit":
              source?.onEditSection(message.field, message.index);
              return;
            case "options":
              select(sectionKey(message.field, message.index));
              setOptionsToken(Date.now());
              return;
            case "add":
              setTarget({ field: message.field, index: message.index });
              return;
          }
          return;
        }
        case "placing-at":
          setPlacingAt(message.index);
          return;
        case "place": {
          const placed = placingRef.current ?? dropping.current;
          dropping.current = null;
          if (placed) insertAt(placed.block, message.field, message.index);
          stopPlacing();
          return;
        }
      }
    },
    [actionsFor, data, editable, selected, select, source, store, insertAt, stopPlacing],
  );

  /** A section type picked in the palette (click or Enter). */
  const choose = useCallback(
    (block: BlockType) => {
      const field = fields[0];
      if (!field || !editable) return;
      if (target) {
        insertAt(block, target.field, target.index);
        setTarget(null);
        return;
      }
      const current = placingRef.current;
      if (current && current.block.type === block.type) {
        // Picked again: it goes at the end.
        insertAt(block, current.field, labelsOf(current.field).length);
        stopPlacing();
        return;
      }
      const fieldKey = parseSectionKey(selected)?.field ?? field.key;
      setPlacing({ block, field: fieldKey });
      post(toOverlay({ type: "placing", field: fieldKey, label: block.label }));
    },
    [fields, editable, target, selected, insertAt, labelsOf, stopPlacing, post],
  );

  /** A press on a palette card: becomes a drag onto the page once it moves. */
  const beginDrag = useCallback(
    (event: PointerEvent, block: BlockType) => {
      const field = parseSectionKey(selected)?.field ?? fields[0]?.key;
      if (!field || !editable || status.status !== "mapped") return;
      stopDrag.current?.();
      stopDrag.current = followPaletteDrag(event, {
        frame: () => frame.current,
        label: block.label,
        onStart: () => {
          setTarget(null);
          setPlacing({ block, field });
          placingRef.current = { block, field };
          post(toOverlay({ type: "placing", field, label: block.label }));
        },
        onPoint: (point) => post(toOverlay({ type: "placing-pointer", point })),
        onEnd: (overFrame) => {
          stopDrag.current = null;
          if (overFrame) {
            dropping.current = { block, field };
            post(toOverlay({ type: "placing-drop" }));
          } else post(toOverlay({ type: "placing-pointer", point: null }));
          post(toOverlay({ type: "placing", field: null, label: null }));
          setPlacing(null);
          placingRef.current = null;
          setPlacingAt(null);
          setTimeout(() => {
            dropping.current = null;
          }, 1500);
        },
      });
    },
    [selected, fields, editable, status.status, frame, post],
  );
  useEffect(() => () => stopDrag.current?.(), []);

  // Leaving Arrange ends any placing.
  useEffect(() => {
    if (!active) {
      setPlacing(null);
      setTarget(null);
    }
  }, [active]);

  // A page that wasn't drawn can't be arranged, whatever the overlay last said about its sections.
  const undrawn = page !== null && page.state !== "drawn";
  const decline: Decline | null =
    undrawn || status.status === "declined"
      ? (() => {
          const kind = declineKind(status.status === "declined" ? status.cause : null, page);
          return { kind, words: declineWords(kind, { cause: status.cause ?? null }), reason: undrawn ? page.message : status.reason };
        })()
      : null;

  return {
    available,
    active,
    decline,
    editable,
    entry,
    lists,
    fields,
    data,
    store,
    status,
    settling,
    selected: parsed && selectedField && selectedItem !== undefined ? { ...parsed, field: selectedField, item: selectedItem } : null,
    select,
    target,
    setTarget,
    placing,
    placingAt,
    choose,
    beginDrag,
    stopPlacing,
    insertAt,
    labelsOf,
    optionsToken,
    note,
    handle,
    /** The page's overlay (re)announced itself: tell it everything again. */
    resend: () => {
      setStatus((current) => (current.status === "mapped" ? current : { status: "loading", how: null, reason: null }));
      if (active) send();
    },
    editSection: (field: string, index: number) => source?.onEditSection(field, index),
  };
}

export type ArrangeController = ReturnType<typeof useArrange>;
