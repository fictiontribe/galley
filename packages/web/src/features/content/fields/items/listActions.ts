/**
 * List actions on an entry — move, step, duplicate, remove, insert — bound to
 * the entry's op queue, with Undo. The form's cards and the page builder
 * both call these: one implementation of what each action sends, where Undo
 * puts things, and what the person is told.
 *
 * Undo restores the file byte for byte when nothing else has changed since
 * (an inserted section is rendered fresh by the engine, so re-inserting a
 * removed one would not give back its exact lines); otherwise it sends the
 * inverse ops.
 */
import type { FieldPath, JsonValue } from "@galley/core/types";
import { notify, useToasts } from "@/lib/stores/toasts";
import { getAt, pathKey } from "../../form/paths";
import type { FormStore } from "../../form/store";
import { planDuplicate, planInsert, planMove, planRemove, planStep, type ListChange, type ListPlan } from "./listPlan";

type Listener = (change: ListChange) => void;
const listeners = new WeakMap<FormStore, Map<string, Set<Listener>>>();
const lastUndo = new WeakMap<FormStore, () => Promise<void>>();
const undoToast = new WeakMap<FormStore, number>();

/**
 * The last list action made in an entry, in words, while its Undo is still
 * on offer: what a page that stopped drawing is blamed on ("after adding a
 * Film section") and what its Undo takes back. The same Undo as the toast's
 * and ⌘Z's — there is one history, of one step.
 */
export interface LastListAction {
  /** "adding a Film section", "moving “Hero”". */
  what: string;
  /** When it was asked for (Date.now()). */
  at: number;
  /** The list and, for an addition, where the new item is (to open it in the form). */
  path: FieldPath;
  index: number | null;
}
const lastAction = new WeakMap<FormStore, LastListAction>();
const actionListeners = new WeakMap<FormStore, Set<() => void>>();

function setLastAction(store: FormStore, action: LastListAction | null): void {
  if (action) lastAction.set(store, action);
  else lastAction.delete(store);
  for (const listener of actionListeners.get(store) ?? []) listener();
}

/** The last list action in this entry whose Undo is still on offer, or null. */
export function lastListAction(store: FormStore): LastListAction | null {
  return lastUndo.has(store) ? (lastAction.get(store) ?? null) : null;
}

/** Hear when the last undoable list action changes (made, undone, or no longer undoable). */
export function onLastListAction(store: FormStore, listener: () => void): () => void {
  let set = actionListeners.get(store);
  if (!set) actionListeners.set(store, (set = new Set()));
  set.add(listener);
  return () => set?.delete(listener);
}

/** Hear about every reorder, addition and removal of the list at `path`, whoever made it in this app. */
export function onListChange(store: FormStore, path: FieldPath, listener: Listener): () => void {
  let byList = listeners.get(store);
  if (!byList) listeners.set(store, (byList = new Map()));
  const key = pathKey(path);
  let set = byList.get(key);
  if (!set) byList.set(key, (set = new Set()));
  set.add(listener);
  return () => set?.delete(listener);
}

function emit(store: FormStore, path: FieldPath, change: ListChange): void {
  for (const listener of listeners.get(store)?.get(pathKey(path)) ?? []) listener(change);
}

/**
 * Undo the last list action made in this entry (⌘Z on the page, or the Undo
 * a page that stopped drawing offers). False when there is none; `then` runs
 * once the file is back.
 */
export function undoLastListAction(store: FormStore, then?: () => void): boolean {
  const undo = lastUndo.get(store);
  if (!undo) return false;
  lastUndo.delete(store);
  setLastAction(store, null);
  const toast = undoToast.get(store);
  if (toast !== undefined) useToasts.getState().dismiss(toast);
  void undo().then(then, then);
  return true;
}

export interface ListActionOptions {
  store: FormStore;
  path: FieldPath;
  /** "section" or "item". */
  noun: string;
  /** What the person calls the item: "Hero", "Item 2". */
  label: (item: JsonValue | undefined, index: number) => string;
}

export interface ListActionResult {
  plan: ListPlan;
  /** Resolves when the edit has landed: true when it was saved, false when it was refused or failed. */
  done: Promise<boolean>;
}

export interface Say {
  title: string;
  body: string;
}

/** "a Film", "an Image": by the first letter, which is right for nearly every label. */
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

function run({ store, path }: ListActionOptions, plan: ListPlan | null, say: Say | null, name: string, what: string): ListActionResult | null {
  if (!plan) return null;
  const listKey = pathKey(path);
  // The file as it is before this action, when nothing else is on its way: Undo can then put it back exactly.
  const exact = store.actions.idle() ? { raw: store.getState().raw, hash: store.getState().hash } : null;
  emit(store, path, plan.change);
  store.actions.apply(...plan.ops);
  let after: string | null = null;
  const undo = async () => {
    // Asked by a message from the previewed page (Arrange's undo), all of it is the page's: the exact restore goes marked
    // as it is asked, and the reverse ops, applied after the wait, are applied in the page's name too (form store fromPage).
    const page = store.actions.inPage();
    if (exact && after !== null && (await store.actions.restore(exact.raw, after))) return;
    const reverse = () => {
      emit(store, path, plan.undoChange);
      store.actions.apply(...plan.undo);
    };
    if (page) store.actions.fromPage(reverse);
    else reverse();
  };
  lastUndo.set(store, undo);
  setLastAction(store, { what, at: Date.now(), path, index: plan.change.kind === "insert" ? plan.change.index : null });
  const done = store.actions.flush().then(() => {
    const state = store.getState();
    const refusal = state.refusals[listKey];
    if (refusal || state.saveError || state.conflict) {
      if (lastUndo.get(store) === undo) {
        lastUndo.delete(store);
        setLastAction(store, null);
      }
      if (refusal) notify({ tone: "danger", title: `Couldn’t change ${name}`, body: refusal });
      return false;
    }
    after = state.hash;
    if (say) {
      const previous = undoToast.get(store);
      if (previous !== undefined) useToasts.getState().dismiss(previous);
      const id = notify({
        tone: "neutral",
        title: say.title,
        body: say.body,
        action: {
          label: "Undo",
          onClick: () => {
            if (lastUndo.get(store) === undo) {
              lastUndo.delete(store);
              setLastAction(store, null);
            }
            void undo();
          },
        },
        duration: 10000,
      });
      undoToast.set(store, id);
    }
    return true;
  });
  return { plan, done };
}

/** The actions for the list at `options.path` of the entry behind `options.store`. */
export function listActions(options: ListActionOptions) {
  const { store, path, noun, label } = options;
  const items = (): JsonValue[] => {
    const value = getAt(store.getState().data, path);
    return Array.isArray(value) ? value : [];
  };
  const nameOf = (index: number) => {
    const list = items();
    return `“${label(list[index], index)}”`;
  };
  return {
    /** Drag and drop: `to` is the item's final position. */
    move(from: number, to: number): ListActionResult | null {
      const list = items();
      const name = label(list[from], from);
      return run(options, planMove(path, list.length, from, to), { title: `${name} moved`, body: `It’s now ${to + 1} of ${list.length}. Undo puts it back where it was.` }, `“${name}”`, `moving “${name}”`);
    },
    /** One place up or down (keyboard, the move buttons): no toast, ⌘Z still undoes it. */
    step(index: number, delta: -1 | 1): ListActionResult | null {
      return run(options, planStep(path, items().length, index, delta), null, nameOf(index), `moving ${nameOf(index)}`);
    },
    duplicate(index: number): ListActionResult | null {
      const list = items();
      const name = label(list[index], index);
      return run(options, planDuplicate(path, list, index), { title: `${name} duplicated`, body: `The copy is right below the original. Undo takes it away.` }, `“${name}”`, `duplicating “${name}”`);
    },
    remove(index: number): ListActionResult | null {
      const list = items();
      const name = label(list[index], index);
      return run(options, planRemove(path, list, index), { title: `${name} removed`, body: `The ${noun} is gone from this page. Undo puts it back where it was.` }, `“${name}”`, `removing “${name}”`);
    },
    /**
     * `kind` names what was added ("Film") for the record a page that stops
     * drawing is blamed on; `say`, when given, is the toast (with Undo) that
     * tells the person something they should know about the new item.
     */
    insert(index: number, value: JsonValue, added?: { kind: string; say?: Say }): ListActionResult | null {
      const what = added ? `adding ${article(added.kind)} ${added.kind} ${noun}` : `adding a ${noun}`;
      return run(options, planInsert(path, items().length, index, value), added?.say ?? null, `the new ${noun}`, what);
    },
  };
}

export type ListActions = ReturnType<typeof listActions>;
