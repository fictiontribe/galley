/**
 * Which fields differ from the published version (from the engine's
 * `fieldChanges`), and the op that puts one back.
 */
import type { FieldChange, FieldPath } from "@galley/core/types";
import { insertOp, moveOp, removeOp, type DataOp } from "./ops";
import { samePath, startsWith } from "./paths";

export type MarkKind = FieldChange["kind"];

/** Whether a change is about a whole list item (added, removed or moved) rather than one field. */
export function isItemChange(change: FieldChange): boolean {
  return change.kind !== "changed" && typeof change.field[change.field.length - 1] === "number";
}

/**
 * Where a change shows in the form, which holds the current version. A
 * removed list item has no place there — its path is the position it used to
 * have, where another item may sit now — so it counts toward its list.
 */
function formPath(change: FieldChange): FieldPath {
  return change.kind === "removed" && isItemChange(change) ? change.field.slice(0, -1) : change.field;
}

/** The change recorded for exactly this field, if any. */
export function changeAt(changes: readonly FieldChange[] | undefined, path: FieldPath): FieldChange | undefined {
  return changes?.find((change) => samePath(change.field, path) && samePath(formPath(change), path));
}

/**
 * How many recorded changes sit at or inside `path` — a section card shows
 * "2 edits". Fields inside a newly added section aren't marked one by one:
 * the section itself carries "New".
 */
export function editsWithin(changes: readonly FieldChange[] | undefined, path: FieldPath): number {
  if (!changes) return 0;
  return changes.filter((change) => startsWith(formPath(change), path)).length;
}

/**
 * Where, in the list as it is now, the published item at `from` belongs:
 * the current position of the nearest earlier item that stayed put (-1 when
 * none did). Items no row names kept their order, so the k-th of them before
 * is the k-th of them now — the rows of one list are enough to work it out.
 */
function anchorFor(siblings: readonly FieldChange[], from: number): number | null {
  const goneBefore = new Set<number>();
  const takenNow = new Set<number>();

  for (const sibling of siblings) {
    const at = sibling.field[sibling.field.length - 1] as number;
    if (sibling.kind === "removed") goneBefore.add(at);
    else if (sibling.kind === "added") takenNow.add(at);
    else if (sibling.kind === "moved") {
      if (sibling.from === undefined || sibling.to === undefined) return null;
      goneBefore.add(sibling.from);
      takenNow.add(sibling.to);
    }
  }
  let stable = 0;
  for (let index = 0; index < from; index += 1) if (!goneBefore.has(index)) stable += 1;
  let position = -1;
  for (let seen = 0; seen < stable; ) {
    position += 1;
    if (!takenNow.has(position)) seen += 1;
  }
  return position;
}

/** Put back one list item: take a new one out, return a removed one to its place, move a moved one back. */
function itemPutBack(change: FieldChange, changes: readonly FieldChange[]): DataOp | null {
  const list = change.field.slice(0, -1);
  const index = change.field[change.field.length - 1] as number;
  if (change.kind === "added") return removeOp(list, index);
  const siblings = changes.filter((other) => isItemChange(other) && other.field.length === change.field.length && startsWith(other.field, list));
  // The row has to be one of the list's own rows, or the positions mean nothing.
  if (!siblings.some((other) => other.kind === change.kind && samePath(other.field, change.field) && other.from === change.from)) return null;
  if (change.kind === "removed") {
    const anchor = anchorFor(siblings, index);
    return anchor === null || change.before === undefined ? null : insertOp(list, anchor + 1, change.before);
  }
  if (change.kind !== "moved" || change.from === undefined || change.to !== index) return null;
  const anchor = anchorFor(siblings, change.from);
  if (anchor === null) return null;
  // Taking the item out first shifts an anchor that sits after it.
  const target = anchor < index ? anchor + 1 : anchor;
  return target === index ? null : moveOp(list, index, target);
}

/**
 * The op that restores the published version of one change: a changed field
 * → its old value; an added field → removed again; a removed field → written
 * back. List items (paths ending in a position) need the other rows of their
 * list (`changes`) to know where things belong: an added item comes out, a
 * removed one goes back after the item it used to follow, a moved one moves
 * back there. Without `changes`, or when the rows don't add up, there is no
 * op — a guessed position would put the wrong thing in the wrong place.
 */
export function putBackOp(change: FieldChange, changes?: readonly FieldChange[]): DataOp | null {
  const last = change.field[change.field.length - 1];
  if (last === undefined) return null;
  if (typeof last === "number") return changes && change.kind !== "changed" ? itemPutBack(change, changes) : null;
  if (change.kind === "moved") return null;
  if (change.kind === "added") return { op: "unset", path: change.field };
  if (change.before === undefined) return null;
  return { op: "set", path: change.field, value: change.before };
}
