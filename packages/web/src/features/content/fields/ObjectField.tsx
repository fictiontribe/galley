import { useEffect, useState } from "react";
import type { Field } from "@galley/core/types";
import { count } from "@/lib/format";
import { ProofMark, cx } from "@/ui";
import { useEditCount, useFormState, useIssues } from "../form/context";
import { pathKey, startsWith } from "../form/paths";
import { type FieldProps } from "./common";
import { FieldList } from "./FieldList";
import { RequiredMark } from "./FieldShell";
import { PutBack } from "./PutBack";

/** Groups this size or smaller start open. */
const OPEN_UP_TO = 4;
const NO_FIELDS: Field[] = [];

/** `object`: a group of fields, folded when it's large. */
export function ObjectField({ field, path, showKey }: FieldProps) {
  const fields = field.fields ?? NO_FIELDS;
  const [open, setOpen] = useState(fields.length <= OPEN_UP_TO);
  const edits = useEditCount(path);
  const issues = useIssues(path);
  const key = pathKey(path);
  const bodyId = `group-${key}`;

  const reveal = useFormState((state) => state.reveal);
  useEffect(() => {
    if (reveal && reveal.path.length > path.length && startsWith(reveal.path, path)) setOpen(true);
  }, [reveal, key]); // path is identified by its key

  return (
    <section className={cx("app-group", open && "app-group--open")} data-path={key}>
      <div className="app-group__head">
        <button type="button" className="app-group__toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
          <ProofMark kind="chevron" className={cx("app-card__chevron", !open && "app-card__chevron--closed")} />
          <span className="g-label">
            {field.label}
            {field.required ? <RequiredMark /> : null}
          </span>
          {showKey ? <span className="g-field__key">{field.key}</span> : null}
          {!open ? <span className="g-hint">{count(fields.length, "field")}</span> : null}
        </button>
        {edits > 0 ? (
          <span className="g-field__state">
            <ProofMark kind="caret" />
            {edits === 1 ? "Edited" : count(edits, "edit")}
          </span>
        ) : null}
        {edits > 0 ? <PutBack path={path} label={field.label} /> : null}
      </div>
      {issues.map((issue) => (
        <p key={issue.code + issue.message} className={issue.severity === "error" ? "g-error-text" : "g-hint app-field-warning"}>
          <ProofMark kind="bang" />
          <span>{issue.message}</span>
        </p>
      ))}
      {open ? (
        <div className="app-group__body" id={bodyId}>
          <FieldList fields={fields} basePath={path} />
        </div>
      ) : null}
    </section>
  );
}
