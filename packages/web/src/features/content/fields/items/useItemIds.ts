import { useCallback, useRef } from "react";
import type { JsonValue } from "@galley/core/types";
import { newItemId, reconcileIds } from "../../form/ids";

export interface ItemIds {
  ids: string[];
  /** Announce the keys the list will have after a local insert / move / remove. */
  expect: (next: string[]) => void;
}

/**
 * Stable keys for a list's items. Local list ops announce their permutation;
 * anything else (a save reply, the assistant) is reconciled by position and
 * equality so cards keep their state.
 */
export function useItemIds(items: readonly JsonValue[]): ItemIds {
  const state = useRef<{ items: readonly JsonValue[]; ids: string[]; expected: string[] | null } | null>(null);
  if (!state.current) state.current = { items, ids: items.map(() => newItemId()), expected: null };
  const current = state.current;
  if (current.items !== items) {
    if (current.expected && current.expected.length === items.length) current.ids = current.expected;
    else current.ids = reconcileIds(current.items, current.ids, items);
    current.items = items;
    current.expected = null;
  }
  const expect = useCallback((next: string[]) => {
    if (state.current) state.current.expected = next;
  }, []);
  return { ids: current.ids, expect };
}
