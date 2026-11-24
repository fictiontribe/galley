/**
 * A proposed page that couldn't be drawn, as the preview pane and the
 * Arrange panel both tell it: what happened, the change it began with (when
 * it began with one made here), and the way back — that change's own Undo,
 * after which the frame is reloaded so the page draws again without anyone
 * reloading by hand.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { lastListAction, onLastListAction, undoLastListAction, type LastListAction } from "@/features/content/fields/items/listActions";
import type { FormStore } from "@/features/content/form/store";
import { declineWords, failureCause, type DeclineWords, type PageReport } from "./declined";

export interface PageFailure {
  words: DeclineWords;
  /** The framework's own first line, for Technical details. */
  detail: string | null;
  /** The change the failure began with, when it began with one made here. */
  after: LastListAction | null;
  /** Undo that change (only when `after`). */
  undo: (() => void) | null;
  /** Open the form, at the new section when the change added one. */
  showForm: (() => void) | null;
  /** The Undo is on its way. */
  undoing: boolean;
}

const NOTHING = () => () => undefined;

/** The last undoable list action in the entry behind `store`, kept current. */
export function useLastListAction(store: FormStore | null): LastListAction | null {
  const subscribe = useCallback((listener: () => void) => (store ? onLastListAction(store, listener) : NOTHING()), [store]);
  return useSyncExternalStore(subscribe, () => (store ? lastListAction(store) : null));
}

export interface PageFailureOptions {
  page: PageReport | null;
  /** When the page was last seen drawn, or null. */
  drawnAt: number | null;
  store: FormStore | null;
  /** Reload the proposed page (after Undo puts the file back). */
  reload: () => void;
  onEditSection?: (field: string, index: number) => void;
  onShowForm?: () => void;
}

/** The failed page's words and actions, or null while the page is drawn. */
export function usePageFailure({ page, drawnAt, store, reload, onEditSection, onShowForm }: PageFailureOptions): PageFailure | null {
  const last = useLastListAction(store);
  // The change being undone: its words stay up until the page draws again.
  const [undoing, setUndoing] = useState<LastListAction | null>(null);
  const failed = page?.state === "failed";
  useEffect(() => {
    if (!failed) setUndoing(null);
  }, [failed]);
  if (!failed || !page) return null;
  const after = undoing ?? failureCause(last, drawnAt);
  const field = after ? String(after.path[0] ?? "") : "";
  return {
    words: declineWords("failed", { after }),
    detail: page.message,
    after,
    undoing: undoing !== null,
    undo:
      after && store && !undoing
        ? () => {
            setUndoing(after);
            if (!undoLastListAction(store, reload)) setUndoing(null);
          }
        : null,
    showForm: after && after.index !== null && onEditSection ? () => onEditSection(field, after.index as number) : (onShowForm ?? null),
  };
}
