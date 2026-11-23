/**
 * What every field component can reach: the form store, the entry's identity,
 * and per-path hooks that subscribe narrowly so typing re-renders one field.
 */
import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { FieldChange, FieldPath, JsonValue, MediaConfig, ValidationIssue } from "@galley/core/types";
import { useChanges } from "@/lib/stores/changes";
import { changeAt, editsWithin } from "./marks";
import { getAt, pathKey, samePath } from "./paths";
import type { FormState, FormStore, SaveState } from "./store";

export interface FormContextValue {
  store: FormStore;
  siteId: string;
  /** Repo path of the entry. */
  entryPath: string;
  media: MediaConfig | null;
  /** Tell the editor what the person is looking at (assistant context). */
  select: (text: string) => void;
  /** Open the image picker; resolves with the chosen site URL, or null. */
  pickImage: () => Promise<string | null>;
  /** Show a page of this site in the preview. */
  preview: (urlPath: string) => void;
}

export const FormContext = createContext<FormContextValue | null>(null);

export function useForm(): FormContextValue {
  const value = useContext(FormContext);
  if (!value) throw new Error("Field components must be inside <EntryForm>");
  return value;
}

export function useFormState<T>(selector: (state: FormState) => T): T {
  return useStore(useForm().store, selector);
}

/** The value shown at `path`. */
export function useFormValue(path: FieldPath): JsonValue | undefined {
  return useFormState((state) => getAt(state.data, path));
}

export function useSaveState(path: FieldPath): SaveState | undefined {
  const key = pathKey(path);
  return useFormState((state) => state.saveState[key]);
}

export function useRefusal(path: FieldPath): string | undefined {
  const key = pathKey(path);
  return useFormState((state) => state.refusals[key]);
}

/** Validation issues recorded exactly at this field. */
export function useIssues(path: FieldPath): ValidationIssue[] {
  return useFormState(useShallow((state) => state.issues.filter((issue) => issue.field && samePath(issue.field, path))));
}

/** Field changes of this entry; none for a brand-new entry, where every field is new and nothing can be put back. */
function fieldChangesOf(entryPath: string): (state: ReturnType<typeof useChanges.getState>) => FieldChange[] | undefined {
  return (state) => {
    const file = state.changes?.files.find((candidate) => candidate.path === entryPath);
    return file?.status === "added" ? undefined : file?.fieldChanges;
  };
}

/** How many recorded changes are at or inside `path` (0 = matches the live site). */
export function useEditCount(path: FieldPath): number {
  const { entryPath } = useForm();
  const select = fieldChangesOf(entryPath);
  return useChanges((state) => editsWithin(select(state), path));
}

/** The kind of change recorded exactly at `path`, if any. */
export function useChangeKind(path: FieldPath): FieldChange["kind"] | null {
  const { entryPath } = useForm();
  const select = fieldChangesOf(entryPath);
  return useChanges((state) => changeAt(select(state), path)?.kind ?? null);
}

/** Read the recorded change at `path` on demand (for "Put back"). */
export function readChange(entryPath: string, path: FieldPath): FieldChange | undefined {
  return changeAt(fieldChangesOf(entryPath)(useChanges.getState()), path);
}

/** Whether the body differs from the live site. */
export function useBodyChanged(): boolean {
  const { entryPath } = useForm();
  return useChanges((state) => {
    const file = state.changes?.files.find((candidate) => candidate.path === entryPath);
    return file?.status === "modified" && Boolean(file.bodyChanged);
  });
}
