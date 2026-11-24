import { createContext, useContext, useId, type ReactNode } from "react";
import { ProofMark } from "./ProofMark";
import { cx } from "./cx";

interface FieldControl {
  /** Absent in a group: its legend names it, and the several controls inside need ids of their own. */
  id: string | undefined;
  describedBy: string | undefined;
  invalid: boolean;
}

const FieldContext = createContext<FieldControl | null>(null);

/** Inputs inside a <Field> pick up its id, description and invalid state from here. */
export function useFieldControl(): FieldControl | null {
  return useContext(FieldContext);
}

export interface FieldProps {
  label: ReactNode;
  /** The content key (`hero.heading`), shown small in mono for people who want it. */
  fieldKey?: string;
  /** One-line hint under the control (no full stop for fragments). */
  hint?: ReactNode;
  /** What's wrong and, when known, how to fix it. */
  error?: ReactNode;
  /** Show the "Edited" proof state beside the label. */
  edited?: boolean | string;
  /** Visually hide the label (it's still the accessible name). */
  hideLabel?: boolean;
  /** Use a group (fieldset/legend) instead of label-for, for radio sets and toggles. */
  group?: boolean;
  /** Extra content on the right of the label row. */
  aside?: ReactNode;
  /**
   * A control that belongs in the label row (a markdown field's Write/Preview
   * switch). It takes its own place there, after `aside`, and the row wraps
   * when it runs out of width, so it never lands on the save state.
   */
  tools?: ReactNode;
  id?: string;
  className?: string;
  children: ReactNode;
}

/** Label + hint + error around one control, wired for screen readers. */
export function Field({ label, fieldKey, hint, error, edited, hideLabel, group, aside, tools, id, className, children }: FieldProps) {
  const autoId = useId();
  const controlId = id ?? `f${autoId}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  const head = (
    <div className={cx("g-field__head", tools ? "app-field-head--tools" : null, hideLabel && "g-sr")}>
      {group ? (
        <legend className="g-label">{label}</legend>
      ) : (
        <label className="g-label" htmlFor={controlId}>
          {label}
        </label>
      )}
      {fieldKey ? <span className="g-field__key">{fieldKey}</span> : null}
      {edited ? (
        <span className="g-field__state">
          <ProofMark kind="caret" />
          {typeof edited === "string" ? edited : "Edited"}
        </span>
      ) : null}
      {aside ? <span className="app-field-aside">{aside}</span> : null}
      {tools ? <span className="app-field-tools">{tools}</span> : null}
    </div>
  );

  const body = (
    <FieldContext.Provider value={{ id: group ? undefined : controlId, describedBy, invalid: Boolean(error) }}>
      {head}
      {children}
      {error ? (
        <p className="g-error-text" id={errorId}>
          <ProofMark kind="bang" />
          <span>{error}</span>
        </p>
      ) : null}
      {hint ? (
        <p className="g-hint app-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </FieldContext.Provider>
  );

  return group ? (
    <fieldset className={cx("g-field app-fieldset", className)} aria-describedby={describedBy}>
      {body}
    </fieldset>
  ) : (
    <div className={cx("g-field", className)}>{body}</div>
  );
}
