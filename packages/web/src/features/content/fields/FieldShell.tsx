import type { ReactNode } from "react";
import type { Field as FieldDef, FieldPath } from "@galley/core/types";
import { Field, ProofMark } from "@/ui";
import { useChangeKind, useEditCount, useIssues, useRefusal, useSaveState } from "../form/context";
import { pathKey } from "../form/paths";
import { PutBack } from "./PutBack";

export interface FieldShellProps {
  field: FieldDef;
  path: FieldPath;
  children: ReactNode;
  /** Show the field's key in mono beside the label (top-level fields, like the specimen). */
  showKey?: boolean;
  /** fieldset/legend instead of label-for (toggles, chip sets). */
  group?: boolean;
  id?: string;
  /** Extra note under the control (e.g. "This isn’t a number yet."). */
  note?: ReactNode;
  className?: string;
}

/** A required marker people can see and screen readers say. */
export function RequiredMark() {
  return (
    <>
      <span className="app-required" aria-hidden="true">
        *
      </span>
      <span className="g-sr"> (required)</span>
    </>
  );
}

function SaveNote({ path }: { path: FieldPath }) {
  const state = useSaveState(path);
  if (!state) return null;
  return (
    <span className={`app-save-note app-save-note--${state}`} aria-hidden="true">
      {state === "saving" ? "Saving…" : "Saved"}
    </span>
  );
}

/**
 * Label, edited mark, save state, errors and hints around one control. The
 * engine's refusal wins over validation errors; warnings sit with the hint.
 */
export function FieldShell({ field, path, children, showKey, group, id, note, className }: FieldShellProps) {
  const refusal = useRefusal(path);
  const issues = useIssues(path);
  const edits = useEditCount(path);
  const kind = useChangeKind(path);
  const error = refusal ?? issues.find((issue) => issue.severity === "error")?.message;
  const warnings = issues.filter((issue) => issue.severity === "warning");

  const hint =
    warnings.length > 0 || field.description || note ? (
      <>
        {note ? <span className="app-field-note">{note}</span> : null}
        {warnings.map((warning) => (
          <span key={warning.code + warning.message} className="app-field-warning">
            <ProofMark kind="bang" />
            {warning.message}
          </span>
        ))}
        {field.description ? <span>{field.description}</span> : null}
      </>
    ) : undefined;

  return (
    <Field
      id={id}
      group={group}
      className={className}
      label={
        <>
          {field.label}
          {field.required ? <RequiredMark /> : null}
        </>
      }
      fieldKey={showKey ? field.key : undefined}
      edited={edits > 0 ? (kind === "added" ? "New" : "Edited") : undefined}
      error={error}
      hint={hint}
      aside={
        <>
          <SaveNote path={path} />
          {edits > 0 ? <PutBack path={path} label={field.label} /> : null}
        </>
      }
    >
      <div className="app-field-control" data-path={pathKey(path)}>
        {children}
      </div>
    </Field>
  );
}
