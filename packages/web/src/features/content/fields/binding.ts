import { useCallback, useRef } from "react";
import type { Field, FieldPath, JsonValue } from "@galley/core/types";
import { useForm, useFormValue } from "../form/context";
import { getAt } from "../form/paths";
import { plainLine } from "../form/summary";

export interface Binding {
  value: JsonValue | undefined;
  /** The control's new value; `undefined` = cleared. */
  change: (next: JsonValue | undefined) => void;
  /** Send now (blur). */
  commit: () => void;
  /** The person is looking at this field. */
  focus: () => void;
}

/**
 * Wire one control to its path. Typing waits for 500 ms of quiet (or blur);
 * `immediate` controls (switches, pickers, menus) send at once.
 */
export function useBinding(field: Field, path: FieldPath, immediate = false): Binding {
  const { store, select } = useForm();
  const value = useFormValue(path);
  // The path array is rebuilt every render; the ref keeps callbacks stable.
  const pathRef = useRef(path);
  pathRef.current = path;
  const required = field.required;
  const label = field.label;

  const change = useCallback(
    (next: JsonValue | undefined) => store.actions.edit(pathRef.current, next, { required, immediate }),
    [store, required, immediate],
  );
  const commit = useCallback(() => store.actions.commit(pathRef.current), [store]);
  const focus = useCallback(() => {
    const shown = getAt(store.getState().data, pathRef.current);
    select(typeof shown === "string" && shown.trim() ? plainLine(shown, 400) : label);
  }, [store, select, label]);

  return { value, change, commit, focus };
}

/** A string to put in a text control. */
export function asText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
