import { useState } from "react";
import type { Field } from "@galley/core/types";
import { count } from "@/lib/format";
import { ProofMark, cx } from "@/ui";
import { useForm, useFormState } from "./context";
import { labelForPath } from "./labels";

/**
 * What the engine flagged in this entry, at the top of the form. Each item
 * jumps to its field (opening the section it's in).
 */
export function IssueSummary({ fields }: { fields: readonly Field[] }) {
  const { store } = useForm();
  const issues = useFormState((state) => state.issues);
  // Read, not subscribed: labels only need the section types, and typing shouldn't re-render this.
  const data = store.getState().data;
  const [open, setOpen] = useState(true);
  if (issues.length === 0) return null;
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.length - errors;
  const words = [errors ? count(errors, "thing to fix", "things to fix") : "", warnings ? count(warnings, "thing to check", "things to check") : ""].filter(Boolean).join(" · ");

  return (
    <section className={cx("app-issues", errors > 0 && "app-issues--error")} aria-label="Things to fix">
      <button type="button" className="app-issues__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ProofMark kind="bang" className="app-issues__mark" />
        <span className="app-issues__title">{words}</span>
        <ProofMark kind="chevron" className={cx("app-card__chevron", !open && "app-card__chevron--closed")} />
      </button>
      {open ? (
        <ul className="app-issues__list">
          {issues.map((issue, index) => (
            <li key={`${issue.code}-${index}`} className={`app-issues__item app-issues__item--${issue.severity}`}>
              {issue.field ? (
                <button type="button" className="app-link-button" onClick={() => issue.field && store.actions.revealField(issue.field)}>
                  {labelForPath(fields, data, issue.field)}
                </button>
              ) : null}
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
