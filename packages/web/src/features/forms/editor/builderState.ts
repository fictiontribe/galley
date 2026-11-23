/**
 * The builder's own state (not in the file): which field is selected, which
 * step is showing, whether the form is being tried out, and which fields were
 * added in this session (their names still follow their labels).
 */
import { createContext, useContext } from "react";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";

export type BuilderTab = "fields" | "destinations" | "after";

export interface BuilderState {
  /** The selected field's item key (stable across moves), or null for the form's own settings. */
  selected: string | null;
  step: number;
  tab: BuilderTab;
  testing: boolean;
  /** Item keys of fields added here, this session. */
  fresh: ReadonlySet<string>;
  /** Bumped to move keyboard focus to the selected field on the canvas. */
  focus: number;
  select: (key: string | null, focus?: boolean) => void;
  setStep: (step: number) => void;
  setTab: (tab: BuilderTab) => void;
  setTesting: (testing: boolean) => void;
  markFresh: (key: string) => void;
}

export type BuilderStore = StoreApi<BuilderState>;

export function createBuilderStore(tab: BuilderTab = "fields"): BuilderStore {
  return createStore<BuilderState>((set, get) => ({
    selected: null,
    step: 0,
    tab,
    testing: false,
    fresh: new Set(),
    focus: 0,
    select: (selected, focus = false) => set({ selected, ...(focus ? { focus: get().focus + 1 } : {}) }),
    setStep: (step) => set({ step }),
    setTab: (next) => set({ tab: next }),
    setTesting: (testing) => set({ testing }),
    markFresh: (key) => set({ fresh: new Set(get().fresh).add(key) }),
  }));
}

export const BuilderContext = createContext<BuilderStore | null>(null);

export function useBuilder<T>(selector: (state: BuilderState) => T): T {
  const store = useContext(BuilderContext);
  if (!store) throw new Error("useBuilder must be used inside the form builder");
  return useStore(store, selector);
}

export function useBuilderStore(): BuilderStore {
  const store = useContext(BuilderContext);
  if (!store) throw new Error("useBuilderStore must be used inside the form builder");
  return store;
}
