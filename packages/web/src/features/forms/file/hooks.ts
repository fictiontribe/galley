/**
 * Small hooks over the open file's store: read a typed slice, and edit one
 * leaf (typing waits for a pause; switches and pickers send at once).
 */
import { useCallback, useMemo } from "react";
import type { FieldPath, JsonValue } from "@galley/core/types";
import { useForm, useFormState } from "@/features/content/form/context";
import type { DataOp } from "@/features/content/form/ops";
import { readForm, readScripts, type JsonObject } from "../logic/json";

/** The whole document as the editor shows it (stored + edits on their way + typing). */
export function useDocData(): JsonObject {
  return useFormState((state) => state.data);
}

export function useFormDoc() {
  const data = useDocData();
  return useMemo(() => readForm(data), [data]);
}

export function useScriptsDoc() {
  const data = useDocData();
  return useMemo(() => readScripts(data), [data]);
}

export interface Edits {
  /** A typed value: waits for a pause in typing (or `commit`). Cleared values are removed, unless `keep` (the format needs the key). */
  type: (path: FieldPath, value: JsonValue | undefined, keep?: boolean) => void;
  /** A chosen value (switch, menu, picker): sent at once. `undefined` removes it. */
  choose: (path: FieldPath, value: JsonValue | undefined) => void;
  commit: (path: FieldPath) => void;
  /** Structural ops (insert, move, remove) or several values at once. */
  apply: (...ops: DataOp[]) => void;
  /** The document as it will be once everything on its way lands. */
  read: () => JsonObject;
}

export function useEdits(): Edits {
  const { store } = useForm();
  const type = useCallback((path: FieldPath, value: JsonValue | undefined, keep = false) => store.actions.edit(path, value, { required: keep }), [store]);
  const choose = useCallback((path: FieldPath, value: JsonValue | undefined) => store.actions.edit(path, value, { required: false, immediate: true }), [store]);
  const commit = useCallback((path: FieldPath) => store.actions.commit(path), [store]);
  const apply = useCallback((...ops: DataOp[]) => {
    if (ops.length > 0) store.actions.apply(...ops);
  }, [store]);
  const read = useCallback(() => store.getState().data, [store]);
  return useMemo(() => ({ type, choose, commit, apply, read }), [type, choose, commit, apply, read]);
}
