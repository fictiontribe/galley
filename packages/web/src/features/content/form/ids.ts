/**
 * Stable keys for list items, so a section keeps its open state and focus
 * while the list around it is reordered here or changed by someone else.
 */
import type { JsonValue } from "@galley/core/types";
import { deepEqual } from "./paths";

let counter = 0;

export function newItemId(): string {
  counter += 1;
  return `i${counter}`;
}

/**
 * Keys for `next` given the keys `prevIds` of `prev`.
 * - Same length: keys stay by position (an item was edited, not added).
 * - Otherwise: an item equal to a previous one keeps that one's key; the
 *   rest get new keys.
 */
export function reconcileIds(prev: readonly JsonValue[], prevIds: readonly string[], next: readonly JsonValue[], makeId: () => string = newItemId): string[] {
  if (prev.length === next.length && prevIds.length === prev.length) return prevIds.slice();
  const used = new Set<number>();
  return next.map((item, index) => {
    if (prev[index] === item && prevIds[index] && !used.has(index)) {
      used.add(index);
      return prevIds[index] as string;
    }
    const match = prev.findIndex((candidate, at) => !used.has(at) && deepEqual(candidate, item));
    if (match !== -1 && prevIds[match]) {
      used.add(match);
      return prevIds[match] as string;
    }
    return makeId();
  });
}

/** Keys after a local insert / move / remove — the same permutation the list gets. */
export function insertId(ids: readonly string[], index: number, id: string = newItemId()): string[] {
  return [...ids.slice(0, index), id, ...ids.slice(index)];
}

export function moveId(ids: readonly string[], from: number, to: number): string[] {
  const copy = ids.slice();
  const [id] = copy.splice(from, 1);
  if (id !== undefined) copy.splice(to, 0, id);
  return copy;
}

export function removeId(ids: readonly string[], index: number): string[] {
  return ids.filter((_, at) => at !== index);
}
