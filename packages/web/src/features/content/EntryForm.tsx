import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { ChangeOrigin, Collection, Entry, Field, MediaConfig } from "@galley/core/types";
import { useStore } from "zustand";
import "@/styles/content.css";
import { api } from "@/lib/api";
import { useServerEvent } from "@/lib/events";
import { isOwnCopy, storeWrittenEntry } from "@/lib/entryWrites";
import { useSite } from "@/lib/stores/site";
import { SegmentedControl, Skeleton } from "@/ui";
import { useEditor, type EditorSelection } from "@/features/editor/EditorContext";
import { MediaPicker } from "@/features/media/MediaPicker";
import { FieldList } from "./fields/FieldList";
import { FormContext, useFormState, type FormContextValue } from "./form/context";
import { ConflictNotice, OutsideNotice, SaveErrorNotice } from "./form/FormNotices";
import { IssueSummary } from "./form/IssueSummary";
import { pathKey } from "./form/paths";
import { outsideKind } from "./form/outside";
import { createFormStore, type FormStore } from "./form/store";
import { EntryPanel } from "@/features/seo/EntryPanel";

const BodyEditor = lazy(() => import("./body/BodyEditor").then((m) => ({ default: m.BodyEditor })));
const SourceView = lazy(() => import("./body/SourceView").then((m) => ({ default: m.SourceView })));

export interface EntryFormProps {
  siteId: string;
  /** Repo path of the entry. The entry itself is in `useEditor().entry`. */
  path: string;
}

type Mode = "form" | "source";
const MODES: Array<{ value: Mode; label: string; title: string }> = [
  { value: "form", label: "Form", title: "Edit with fields" },
  { value: "source", label: "Source", title: "Edit the whole file as text" },
];

interface FormRootProps {
  siteId: string;
  entry: Entry;
  collection: Collection | null;
  media: MediaConfig | null;
  setSelection: (selection: EditorSelection | null) => void;
  navigate: (urlPath: string) => void;
  refresh: () => Promise<Entry | undefined>;
  registerFormStore: (path: string, store: FormStore | null) => void;
}

/** Fields the collection declares (in the entry's order), and the extra keys this entry carries. */
function splitFields(fields: Field[], collection: Collection | null): { main: Field[]; extra: Field[] } {
  if (!collection) return { main: fields, extra: [] };
  const declared = new Set(collection.fields.map((field) => field.key));
  return { main: fields.filter((field) => declared.has(field.key)), extra: fields.filter((field) => !declared.has(field.key)) };
}

/**
 * The same field definitions object for as long as they're equal. Every save
 * returns a fresh entry; without this, every field would re-render after it.
 */
function useStableFields(fields: Field[]): Field[] {
  const kept = useRef<{ signature: string; fields: Field[] } | null>(null);
  const signature = JSON.stringify(fields);
  if (!kept.current || kept.current.signature !== signature) kept.current = { signature, fields };
  return kept.current.fields;
}

function SaveStatus() {
  const busy = useFormState((state) => state.busy);
  return (
    <span className="app-form__status" role="status">
      {busy ? "Saving…" : ""}
    </span>
  );
}

/** Scroll to a field the issue summary pointed at, once the cards around it have opened. */
function useReveal(store: FormStore, scroller: RefObject<HTMLDivElement | null>): void {
  const reveal = useStore(store, (state) => state.reveal);
  useEffect(() => {
    if (!reveal) return;
    let tries = 0;
    let frame = 0;
    const find = () => {
      const target = scroller.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(pathKey(reveal.path))}"]`);
      if (target) {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
        target.querySelector<HTMLElement>("input, textarea, select, button, [contenteditable=true]")?.focus({ preventScroll: true });
        return;
      }
      if (tries++ < 20) frame = requestAnimationFrame(find);
    };
    find();
    return () => cancelAnimationFrame(frame);
  }, [reveal, scroller]);
}

const FormRoot = memo(function FormRoot({ siteId, entry, collection, media, setSelection, navigate, refresh, registerFormStore }: FormRootProps) {
  const entryPath = entry.path;
  const origin = useRef<ChangeOrigin | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>("form");
  const [picker, setPicker] = useState(false);
  const pickerResolve = useRef<((url: string | null) => void) | null>(null);

  const [store] = useState(() =>
    createFormStore(entry, {
      send: (ops, baseHash) => api("PATCH /api/sites/:siteId/entry", { params: { siteId }, query: { path: entryPath }, body: { ops, baseHash } }),
      reload: () => api("GET /api/sites/:siteId/entry", { params: { siteId }, query: { path: entryPath } }),
      onEntry: (fresh) => storeWrittenEntry(siteId, fresh),
    }),
  );
  useEffect(() => () => store.actions.dispose(), [store]);
  // The page builder edits this entry through the same queue.
  useEffect(() => {
    registerFormStore(entryPath, store);
    return () => registerFormStore(entryPath, null);
  }, [registerFormStore, entryPath, store]);

  // Who changed the file last (the assistant, an outside editor), for the note when it's folded in.
  useServerEvent("changes.updated", (event) => {
    if (event.siteId === siteId && event.paths.includes(entryPath)) origin.current = event.origin;
  });
  useEffect(() => {
    // Copies written in this app fold in silently; the assistant's and outside edits are announced.
    store.actions.receive(entry, outsideKind({ own: isOwnCopy(siteId, entry), origin: origin.current }));
    origin.current = null;
  }, [entry, store, siteId]);

  useReveal(store, scroller);

  const pickImage = useCallback(
    () =>
      new Promise<string | null>((resolve) => {
        pickerResolve.current?.(null);
        pickerResolve.current = resolve;
        setPicker(true);
      }),
    [],
  );
  const closePicker = useCallback((url: string | null) => {
    pickerResolve.current?.(url);
    pickerResolve.current = null;
    setPicker(false);
  }, []);

  const context = useMemo<FormContextValue>(
    () => ({
      store,
      siteId,
      entryPath,
      media,
      select: (text) => setSelection({ text, sourcePath: entryPath }),
      pickImage,
      preview: navigate,
    }),
    [store, siteId, entryPath, media, setSelection, pickImage, navigate],
  );

  const fields = useStableFields(entry.fields);
  const { main, extra } = useMemo(() => splitFields(fields, collection), [fields, collection]);
  const switchMode = async (next: Mode) => {
    if (next === mode) return;
    if (next === "source") await store.actions.flush();
    setMode(next);
    if (next === "form") void refresh();
  };

  return (
    <FormContext.Provider value={context}>
      <div className="app-form" ref={scroller}>
        <div className="app-form__bar">
          <SegmentedControl label="Edit as" options={MODES} value={mode} onChange={(next) => void switchMode(next)} />
          <SaveStatus />
        </div>
        <ConflictNotice fields={fields} />
        <SaveErrorNotice />
        <OutsideNotice />
        {mode === "source" ? (
          <Suspense fallback={<Skeleton lines={8} />}>
            <SourceView raw={entry.raw} format={entry.format} />
          </Suspense>
        ) : (
          <>
            <IssueSummary fields={fields} />
            {entry.url ? <EntryPanel /> : null}
            <div className="app-form__fields">
              <FieldList fields={main} extraFields={extra} basePath={[]} showKeys />
            </div>
            {entry.body !== null ? (
              <Suspense fallback={<Skeleton height={220} />}>
                <BodyEditor />
              </Suspense>
            ) : null}
          </>
        )}
      </div>
      <MediaPicker siteId={siteId} open={picker} onClose={() => closePicker(null)} onPick={(url) => closePicker(url)} />
    </FormContext.Provider>
  );
});

/**
 * The form generated from the entry's fields. Each edit is saved as it is
 * made (no Save button); see form/store.ts for the saving model.
 */
export function EntryForm({ siteId, path }: EntryFormProps) {
  const { entry, collection, setSelection, navigate, refresh, registerFormStore } = useEditor();
  const media = useSite((s) => s.detail?.model.media ?? null);
  if (!entry || entry.path !== path) return null;
  return <FormRoot key={path} siteId={siteId} entry={entry} collection={collection} media={media} setSelection={setSelection} navigate={navigate} refresh={refresh} registerFormStore={registerFormStore} />;
}
