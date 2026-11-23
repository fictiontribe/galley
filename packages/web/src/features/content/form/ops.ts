/**
 * Edits → `EditOp`s. Every control edits one leaf path, so a one-field change
 * is one `set` (or `unset`) at that leaf — never a whole-object `set`. List
 * changes are `insert` / `move` / `remove` at the list's path.
 */
import type { EditOp, FieldPath, JsonValue } from "@galley/core/types";
import { deepEqual, getAt, hasAt, isObject, setAt, unsetAt, updateList, type JsonObject } from "./paths";

export type DataOp = Extract<EditOp, { path: FieldPath }>;

/** What a control holds when it is cleared. */
export function isEmptyValue(value: JsonValue | undefined): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

export interface ValueChange {
  path: FieldPath;
  /** The control's new value; `undefined` means cleared. */
  next: JsonValue | undefined;
  /** The document as the engine last stored it. */
  stored: JsonValue;
  /** Required fields keep an empty value so the missing-field warning can show. */
  required: boolean;
}

/**
 * The ops for one control's new value:
 * - unchanged → nothing;
 * - cleared → `unset`, unless the field is required, is a list item (lists
 *   lose items by position, not by unsetting), or already holds an empty
 *   string (then it stays an empty string);
 * - anything else → one `set` at the leaf.
 */
export function valueOps({ path, next, stored, required }: ValueChange): DataOp[] {
  const exists = hasAt(stored, path);
  const before = getAt(stored, path);
  if (exists && next !== undefined && deepEqual(before, next)) return [];
  if (isEmptyValue(next)) {
    const inList = typeof path[path.length - 1] === "number";
    if (!exists && !required && !inList) return [];
    if (exists && isEmptyValue(before) && before === (next ?? "")) return [];
    if (required || inList || before === "") {
      const empty = next ?? "";
      return exists && deepEqual(before, empty) ? [] : [{ op: "set", path, value: empty }];
    }
    return exists ? [{ op: "unset", path }] : [];
  }
  return [{ op: "set", path, value: next as JsonValue }];
}

export function insertOp(path: FieldPath, index: number, value: JsonValue): DataOp {
  return { op: "insert", path, index, value };
}

export function moveOp(path: FieldPath, from: number, to: number): DataOp {
  return { op: "move", path, from, to };
}

export function removeOp(path: FieldPath, index: number): DataOp {
  return { op: "remove", path, index };
}

/** Move an item one place up or down; null when it is already at that end. */
export function stepOp(path: FieldPath, index: number, length: number, delta: -1 | 1): DataOp | null {
  const to = index + delta;
  if (to < 0 || to >= length) return null;
  return moveOp(path, index, to);
}

/** Reorder a list by moving `from` to `to` (the item's final position), like the engine does. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const copy = list.slice();
  const [item] = copy.splice(from, 1);
  if (item === undefined) return copy;
  copy.splice(to, 0, item);
  return copy;
}

export type LocalResult = { ok: true; value: JsonValue } | { ok: false };

/** Apply one data op to plain JSON the way the engine means it (used to show queued edits). */
export function applyOpLocal(root: JsonValue, op: DataOp): LocalResult {
  switch (op.op) {
    case "set": {
      const parent = getAt(root, op.path.slice(0, -1));
      const last = op.path[op.path.length - 1];
      if (op.path.length === 0) return { ok: false };
      if (Array.isArray(parent) && (typeof last !== "number" || last < 0 || last > parent.length)) return { ok: false };
      if (parent !== undefined && parent !== null && !Array.isArray(parent) && !isObject(parent)) return { ok: false };
      return { ok: true, value: setAt(root, op.path, op.value) };
    }
    case "unset":
      return { ok: true, value: unsetAt(root, op.path) };
    case "insert": {
      const list = getAt(root, op.path);
      const length = Array.isArray(list) ? list.length : 0;
      if (list !== undefined && list !== null && !Array.isArray(list)) return { ok: false };
      if (op.index < 0 || op.index > length) return { ok: false };
      return { ok: true, value: updateList(root, op.path, (items) => [...items.slice(0, op.index), op.value, ...items.slice(op.index)]) };
    }
    case "move": {
      const list = getAt(root, op.path);
      if (!Array.isArray(list) || op.from < 0 || op.to < 0 || op.from >= list.length || op.to >= list.length) return { ok: false };
      return { ok: true, value: setAt(root, op.path, moveItem(list, op.from, op.to)) };
    }
    case "remove": {
      const list = getAt(root, op.path);
      if (!Array.isArray(list) || op.index < 0 || op.index >= list.length) return { ok: false };
      return { ok: true, value: setAt(root, op.path, list.filter((_, index) => index !== op.index)) };
    }
  }
}

/** Apply ops in order, skipping any that no longer fit (the engine will refuse those too). */
export function applyOpsLocal(root: JsonObject, ops: readonly DataOp[]): JsonObject {
  let current: JsonValue = root;
  for (const op of ops) {
    const result = applyOpLocal(current, op);
    if (result.ok) current = result.value;
  }
  return isObject(current) ? current : root;
}

/** Whether an op changes the shape of a list (and so shifts the paths after it). */
export function isStructural(op: EditOp): boolean {
  return op.op === "insert" || op.op === "move" || op.op === "remove";
}
