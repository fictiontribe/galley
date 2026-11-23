/**
 * A site-kit file (a form, the scripts setup) open for editing. It is an
 * ordinary content entry, so it uses the content form's saving model as it
 * is: edits become ops through the per-entry queue with `baseHash`, typing is
 * debounced, refusals and conflicts are reported, and fresh copies from the
 * assistant or from outside the app are folded in — and briefly marked.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ChangeOrigin, Entry } from "@galley/core/types";
import { api } from "@/lib/api";
import { isOwnCopy, storeWrittenEntry } from "@/lib/entryWrites";
import { useServerEvent } from "@/lib/events";
import { useQuery } from "@/lib/query";
import { useSite } from "@/lib/stores/site";
import { keys } from "@/lib/sync";
import { FormContext, type FormContextValue } from "@/features/content/form/context";
import { outsideKind } from "@/features/content/form/outside";
import { createFormStore, type FormStore } from "@/features/content/form/store";
import { MediaPicker } from "@/features/media/MediaPicker";
import type { JsonObject } from "../logic/json";

const MARK_MS = 4500;

interface MarksValue {
  marks: ReadonlySet<string>;
}

const MarksContext = createContext<MarksValue>({ marks: new Set() });

/** Marks of what the assistant (or an outside edit) just changed; empty a few seconds later. */
export function useChangeMarks(): ReadonlySet<string> {
  return useContext(MarksContext).marks;
}

/** The entry behind a site-kit file, kept fresh by server events. */
export function useKitEntry(siteId: string, path: string | null) {
  return useQuery(keys.entry(siteId, path ?? ""), () => api("GET /api/sites/:siteId/entry", { params: { siteId }, query: { path: path ?? "" } }), { enabled: Boolean(path) });
}

export interface KitFileProps {
  siteId: string;
  entry: Entry;
  /** Turns a before/after pair into marks to flash. */
  marksFor: (before: JsonObject, after: JsonObject) => string[];
  children: ReactNode;
}

function useStore(siteId: string, entry: Entry): FormStore {
  const entryPath = entry.path;
  const [store] = useState(() =>
    createFormStore(entry, {
      send: (ops, baseHash) => api("PATCH /api/sites/:siteId/entry", { params: { siteId }, query: { path: entryPath }, body: { ops, baseHash } }),
      reload: () => api("GET /api/sites/:siteId/entry", { params: { siteId }, query: { path: entryPath } }),
      onEntry: (fresh) => storeWrittenEntry(siteId, fresh),
    }),
  );
  useEffect(() => () => store.actions.dispose(), [store]);
  return store;
}

/** Provides the content form's context over one file, so its field hooks (`useFormValue`, edit marks) work here too. Key it by path. */
export function KitFile({ siteId, entry, marksFor, children }: KitFileProps) {
  const store = useStore(siteId, entry);
  const origin = useRef<ChangeOrigin | null>(null);
  const [marks, setMarks] = useState<ReadonlySet<string>>(() => new Set());
  const marksForRef = useRef(marksFor);
  marksForRef.current = marksFor;
  const media = useSite((s) => s.detail?.model.media ?? null);

  useServerEvent("changes.updated", (event) => {
    if (event.siteId === siteId && event.paths.includes(entry.path)) origin.current = event.origin;
  });
  useEffect(() => {
    store.actions.receive(entry, outsideKind({ own: isOwnCopy(siteId, entry), origin: origin.current }));
    origin.current = null;
  }, [entry, store, siteId]);

  // When a copy worth announcing is folded in, flash what it changed.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = store.subscribe((state, previous) => {
      if (!state.outside || state.outside === previous.outside) return;
      const changed = marksForRef.current(previous.stored, state.stored);
      if (changed.length === 0) return;
      setMarks(new Set(changed));
      clearTimeout(timer);
      timer = setTimeout(() => setMarks(new Set()), MARK_MS);
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [store]);

  const [picker, setPicker] = useState(false);
  const resolver = useRef<((url: string | null) => void) | null>(null);
  const pickImage = useCallback(
    () =>
      new Promise<string | null>((resolve) => {
        resolver.current?.(null);
        resolver.current = resolve;
        setPicker(true);
      }),
    [],
  );
  const closePicker = (url: string | null) => {
    resolver.current?.(url);
    resolver.current = null;
    setPicker(false);
  };

  const context = useMemo<FormContextValue>(
    () => ({ store, siteId, entryPath: entry.path, media, select: () => undefined, pickImage, preview: () => undefined }),
    [store, siteId, entry.path, media, pickImage],
  );
  const markValue = useMemo(() => ({ marks }), [marks]);

  return (
    <FormContext.Provider value={context}>
      <MarksContext.Provider value={markValue}>{children}</MarksContext.Provider>
      <MediaPicker siteId={siteId} open={picker} onClose={() => closePicker(null)} onPick={(url) => closePicker(url)} />
    </FormContext.Provider>
  );
}
