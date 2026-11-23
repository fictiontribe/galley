/**
 * Folding a fresh copy of the entry (after a save, or after the assistant or
 * another editor changed the file) into what the form shows, without losing
 * what the person is still typing.
 */
import type { FieldPath, JsonValue } from "@galley/core/types";
import { applyOpsLocal, type DataOp } from "./ops";
import { deepEqual, getAt, hasAt, pathKey, setAt, share, unsetAt, type JsonObject } from "./paths";

/** A value typed into a control that hasn't been sent yet. `undefined` = cleared. */
export interface Draft {
  path: FieldPath;
  value: JsonValue | undefined;
}

/**
 * What the form shows: the stored entry, plus edits on their way to the
 * engine, plus drafts still being typed (those always win, so a field in use
 * is never overwritten). Unchanged parts keep their previous references.
 */
export function mergeIntoForm(shown: JsonObject, stored: JsonObject, pending: readonly DataOp[], drafts: readonly Draft[]): JsonObject {
  let next: JsonValue = applyOpsLocal(stored, pending);
  for (const draft of drafts) {
    next = draft.value === undefined ? unsetAt(next, draft.path) : setAt(next, draft.path, draft.value);
  }
  return share(shown, next as JsonObject);
}

/** One edit the person made that didn't reach the file, ready to be put back. */
export interface TypedEdit {
  path: FieldPath;
  /** `undefined` when they cleared the field. */
  value: JsonValue | undefined;
}

/**
 * The value edits lost to a conflict, last one per field. Reorders and
 * removals aren't included: their positions belonged to the old version.
 */
export function typedEdits(ops: readonly DataOp[]): TypedEdit[] {
  const byPath = new Map<string, TypedEdit>();
  for (const op of ops) {
    if (op.op === "set") byPath.set(pathKey(op.path), { path: op.path, value: op.value });
    else if (op.op === "unset") byPath.set(pathKey(op.path), { path: op.path, value: undefined });
  }
  return [...byPath.values()];
}

/** The ops that put lost edits back onto a fresh copy, skipping any the fresh copy already has. */
export function reapplyOps(edits: readonly TypedEdit[], fresh: JsonObject): DataOp[] {
  return edits.flatMap((edit): DataOp[] => {
    if (edit.value === undefined) return hasAt(fresh, edit.path) ? [{ op: "unset", path: edit.path }] : [];
    return hasAt(fresh, edit.path) && deepEqual(getAt(fresh, edit.path), edit.value) ? [] : [{ op: "set", path: edit.path, value: edit.value }];
  });
}

/** Whether any of the lost edits were reorders, additions or removals. */
export function lostStructure(ops: readonly DataOp[]): boolean {
  return ops.some((op) => op.op === "insert" || op.op === "move" || op.op === "remove");
}
