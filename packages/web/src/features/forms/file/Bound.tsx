/**
 * Controls bound to one leaf of the open file. Text waits for a pause in
 * typing (or blur) and sends one `set`; switches and menus send at once.
 * Clearing an optional value removes its key, so the file stays as lean as
 * a hand-written one.
 */
import { useState, type ReactNode, type Ref } from "react";
import type { FieldPath, JsonValue } from "@galley/core/types";
import { useFormValue, useRefusal } from "@/features/content/form/context";
import { Field, Input, Select, SegmentedControl, Textarea, Toggle, type SelectOption } from "@/ui";
import { settingText } from "../logic/json";
import { useEdits } from "./hooks";

interface Common {
  path: FieldPath;
  label: ReactNode;
  hint?: ReactNode;
  /** A problem to show under the control (from validation). */
  error?: string | null;
  hideLabel?: boolean;
  /** Beside the label, e.g. "Required". */
  aside?: ReactNode;
}

function useRefused(path: FieldPath): string | undefined {
  return useRefusal(path);
}

export interface BoundTextProps extends Common {
  placeholder?: string;
  /** The format needs the key: keep an empty string rather than removing it. */
  keep?: boolean;
  mono?: boolean;
  multiline?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  /** Called with each typed value (after it is queued). */
  onTyped?: (value: string) => void;
  autoComplete?: string;
  list?: string;
}

export function BoundText({ path, label, hint, error, hideLabel, aside, placeholder, keep, mono, multiline, inputRef, onTyped, autoComplete = "off", list }: BoundTextProps) {
  const edits = useEdits();
  const value = settingText(useFormValue(path));
  const refused = useRefused(path);
  const change = (next: string) => {
    edits.type(path, next === "" ? undefined : next, keep);
    onTyped?.(next);
  };
  return (
    <Field label={label} hint={hint} error={error ?? refused} hideLabel={hideLabel} aside={aside}>
      {multiline ? (
        <Textarea value={value} placeholder={placeholder} mono={mono} maxRows={10} onChange={(event) => change(event.target.value)} onBlur={() => edits.commit(path)} />
      ) : (
        <Input ref={inputRef} value={value} placeholder={placeholder} mono={mono} autoComplete={autoComplete} list={list} spellCheck={!mono} onChange={(event) => change(event.target.value)} onBlur={() => edits.commit(path)} />
      )}
    </Field>
  );
}

export interface BoundNumberProps extends Common {
  placeholder?: string;
  min?: number;
}

/** A number typed as text, so half-typed numbers don't jump; only real numbers are sent. */
export function BoundNumber({ path, label, hint, error, placeholder, min }: BoundNumberProps) {
  const edits = useEdits();
  const stored = useFormValue(path);
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? (typeof stored === "number" ? String(stored) : "");
  const invalid = typed !== null && typed.trim() !== "" && !Number.isFinite(Number(typed));
  return (
    <Field label={label} hint={hint} error={invalid ? "Type a number." : error}>
      <Input
        inputMode="decimal"
        value={shown}
        placeholder={placeholder}
        onChange={(event) => {
          const text = event.target.value;
          setTyped(text);
          if (text.trim() === "") edits.type(path, undefined);
          else if (Number.isFinite(Number(text)) && (min === undefined || Number(text) >= min)) edits.type(path, Number(text));
        }}
        onBlur={() => {
          setTyped(null);
          edits.commit(path);
        }}
      />
    </Field>
  );
}

export interface BoundToggleProps {
  path: FieldPath;
  label: ReactNode;
  description?: ReactNode;
  /** What an absent key means (default false). Turning it back to that removes the key. */
  absent?: boolean;
}

export function BoundToggle({ path, label, description, absent = false }: BoundToggleProps) {
  const edits = useEdits();
  const stored = useFormValue(path);
  const checked = typeof stored === "boolean" ? stored : absent;
  return <Toggle checked={checked} label={label} description={description} onChange={(next) => edits.choose(path, next === absent ? undefined : next)} />;
}

export interface BoundChoiceProps<T extends string> extends Common {
  options: Array<{ value: T; label: string; title?: string }>;
  /** What an absent key means; choosing it removes the key. */
  absent: T;
  as?: "segmented" | "select";
}

export function BoundChoice<T extends string>({ path, label, hint, options, absent, as = "segmented" }: BoundChoiceProps<T>) {
  const edits = useEdits();
  const stored = useFormValue(path);
  const value = (typeof stored === "string" && options.some((option) => option.value === stored) ? stored : absent) as T;
  const choose = (next: T) => edits.choose(path, next === absent ? undefined : (next as JsonValue));
  if (as === "select") {
    return (
      <Field label={label} hint={hint}>
        <Select value={value} options={options as SelectOption[]} onChange={(next) => choose(next as T)} />
      </Field>
    );
  }
  return (
    <Field label={label} hint={hint} group>
      <SegmentedControl label={typeof label === "string" ? label : "Choose"} options={options} value={value} onChange={choose} />
    </Field>
  );
}
