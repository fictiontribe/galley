/**
 * What each list action is, as edits: the ops it sends, the ops that undo
 * it, and how it reorders the list's items (so cards and the page keep track
 * of which item is which). The form's section cards and the page builder
 * both act through these, so the two can never produce different edits.
 */
import type { FieldPath, JsonValue } from "@galley/core/types";
import { insertOp, moveOp, removeOp, type DataOp } from "../../form/ops";

/** How the list's items moved: the permutation item keys follow. */
export type ListChange = { kind: "move"; from: number; to: number } | { kind: "insert"; index: number } | { kind: "remove"; index: number };

export interface ListPlan {
  kind: "move" | "duplicate" | "remove" | "insert";
  ops: DataOp[];
  /** The ops that put the list back (used when the file can't be restored byte for byte). */
  undo: DataOp[];
  change: ListChange;
  undoChange: ListChange;
  /** Where the item the person acted on is afterwards (null once it's gone). */
  index: number | null;
}

export function planMove(path: FieldPath, length: number, from: number, to: number): ListPlan | null {
  if (from === to || from < 0 || to < 0 || from >= length || to >= length) return null;
  return { kind: "move", ops: [moveOp(path, from, to)], undo: [moveOp(path, to, from)], change: { kind: "move", from, to }, undoChange: { kind: "move", from: to, to: from }, index: to };
}

/** One place up (-1) or down (+1); null at the ends. */
export function planStep(path: FieldPath, length: number, index: number, delta: -1 | 1): ListPlan | null {
  return planMove(path, length, index, index + delta);
}

/** A copy right below the original. */
export function planDuplicate(path: FieldPath, list: readonly JsonValue[], index: number): ListPlan | null {
  const item = list[index];
  if (item === undefined) return null;
  return {
    kind: "duplicate",
    ops: [insertOp(path, index + 1, structuredClone(item))],
    undo: [removeOp(path, index + 1)],
    change: { kind: "insert", index: index + 1 },
    undoChange: { kind: "remove", index: index + 1 },
    index: index + 1,
  };
}

export function planRemove(path: FieldPath, list: readonly JsonValue[], index: number): ListPlan | null {
  const item = list[index];
  if (item === undefined) return null;
  return { kind: "remove", ops: [removeOp(path, index)], undo: [insertOp(path, index, item)], change: { kind: "remove", index }, undoChange: { kind: "insert", index }, index: null };
}

/** A new item at `index` (index === length appends). */
export function planInsert(path: FieldPath, length: number, index: number, value: JsonValue): ListPlan | null {
  if (index < 0 || index > length) return null;
  return { kind: "insert", ops: [insertOp(path, index, value)], undo: [removeOp(path, index)], change: { kind: "insert", index }, undoChange: { kind: "remove", index }, index };
}

/** Where an item at `index` is after `change` (null when it was the one removed). */
export function followIndex(index: number, change: ListChange): number | null {
  switch (change.kind) {
    case "move":
      if (index === change.from) return change.to;
      if (change.from < index && index <= change.to) return index - 1;
      if (change.to <= index && index < change.from) return index + 1;
      return index;
    case "insert":
      return index >= change.index ? index + 1 : index;
    case "remove":
      if (index === change.index) return null;
      return index > change.index ? index - 1 : index;
  }
}
