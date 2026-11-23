import { useMemo, useState } from "react";
import type { FormAction, FormDefinition } from "@galley/core/kit";
import { Badge, Button, ProofMark, cx } from "@/ui";
import { shownIds, type Answers } from "../logic/conditions";
import { stepOf, stepTitles } from "../logic/fieldOps";
import { isLayout } from "../logic/fieldTypes";
import { payloads } from "../logic/payload";
import { providerName } from "../logic/providers";
import { checkAnswer, type Answer } from "../logic/validation";
import { fillAnswers } from "../logic/actions";
import { FieldPreview, type Labels } from "../canvas/FieldPreview";
import { ThankYou } from "../after/ThankYou";
import { Mark, providerMark } from "../file/Mark";

function describeStep(action: FormAction, answers: Answers): string | null {
  switch (action.type) {
    case "redirect":
      return `Would go to ${action.url || "(no page chosen)"}${action.delaySeconds ? ` after ${action.delaySeconds} seconds` : ""} — not followed in a test.`;
    case "event":
      return `Would record “${action.name}” ${action.target === "gtag" ? "with the Google tag" : action.target === "dom" ? "as a page event" : "in the Tag Manager data layer"}${action.params && Object.keys(action.params).length ? ` with ${Object.entries(action.params).map(([key, value]) => `${key}: ${fillAnswers(value, answers)}`).join(", ")}` : ""}.`;
    case "webhook":
      return `Would post a copy of the answers to ${action.url || "(no address yet)"}.`;
    case "download":
      return action.auto ? `Would start downloading ${action.url || "(no file chosen)"}.` : `Would offer ${action.url || "(no file chosen)"} to download.`;
    case "script":
      return "Would run the custom code. It isn’t run in a test.";
    case "message":
      return null;
  }
}

/** Fill in and "send" the form without sending anything: checks the answers, shows what each destination would receive, then plays the after-sending steps. */
export function TestRun({ form, labels, onDone }: { form: FormDefinition; labels: Labels; onDone: () => void }) {
  const [answers, setAnswers] = useState<Answers>({});
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);
  const titles = stepTitles(form);
  const last = step >= titles.length - 1;

  const shown = useMemo(() => shownIds(form.fields, answers), [form.fields, answers]);
  const visible = useMemo(() => form.fields.filter((field) => stepOf(field) === step && shown.has(field.id)), [form.fields, step, shown]);
  const check = (onlyStep: boolean) => {
    const found: Record<string, string> = {};
    for (const field of form.fields) {
      if (onlyStep && stepOf(field) !== step) continue;
      if (!shown.has(field.id)) continue;
      const problem = checkAnswer(field, answers[field.id]);
      if (problem) found[field.id] = problem;
    }
    setErrors(found);
    return Object.keys(found).length === 0;
  };
  const next = () => {
    if (!check(true)) return;
    if (!last) setStep(step + 1);
    else if (check(false)) setSent(true);
  };
  const reset = () => {
    setAnswers({});
    setErrors({});
    setStep(0);
    setSent(false);
  };

  if (sent) {
    const tables = payloads(form, answers);
    return (
      <div className="kit-test">
        <p className="g-margin-note kit-note" role="status">
          <ProofMark kind="stet" />
          <span>Test only — nothing was sent. This is what each destination would receive, and what the visitor would see.</span>
        </p>
        <ThankYou actions={form.afterSubmit} answers={answers} />
        {form.afterSubmit.map((action, index) => {
          const line = describeStep(action, answers);
          return line ? (
            <p key={index} className="kit-test__step">
              <span className="kit-action__number">{index + 1}</span>
              {line}
            </p>
          ) : null;
        })}
        <h3 className="kit-test__heading">What would be sent</h3>
        {tables.length === 0 ? <p className="g-error-text">This form has no destination, so the answers wouldn’t go anywhere. Add one under “Where it goes”.</p> : null}
        {tables.map((table) => {
          const name = providerName(table.provider);
          return (
            <section key={table.index} className="kit-test__table">
              <header className="kit-test__table-head">
                <Mark text={providerMark(table.provider)} size="sm" />
                <span className="kit-dest__name">{name}</span>
                {table.index === 0 ? <Badge tone="accent" mark={null}>Main</Badge> : null}
                {!table.sent ? <Badge tone="neutral">Not sent for these answers</Badge> : null}
                {table.sent && form.destinations[table.index]?.settings.serverSide === true ? <Badge tone="info" mark={null}>Sent after the inbox stores it</Badge> : null}
              </header>
              <table className={cx("app-table", !table.sent && "kit-test__skipped")}>
                <thead>
                  <tr>
                    <th scope="col">Sent as</th>
                    <th scope="col">Value</th>
                    <th scope="col">From</th>
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, index) => (
                    <tr key={`${row.name}-${index}`}>
                      <th scope="row" className="g-mono">
                        {row.name}
                      </th>
                      <td>{row.filledOnPage ? <span className="g-faint">{row.value || "Filled in on the page"}</span> : row.value || <span className="g-faint">(empty)</span>}</td>
                      <td className="g-muted">{row.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
        <div className="kit-test__actions">
          <Button size="sm" variant="secondary" onClick={reset}>
            Try again
          </Button>
          <Button size="sm" variant="quiet" onClick={onDone}>
            Back to editing
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="kit-test">
      <p className="g-margin-note kit-note" role="status">
        <ProofMark kind="stet" />
        <span>Testing. Fill it in as a visitor would — nothing is sent anywhere.</span>
      </p>
      {titles.length > 1 ? (
        <p className="kit-test__progress">
          Step {step + 1} of {titles.length}: {titles[step]}
        </p>
      ) : null}
      <form
        className="kit-sheet"
        noValidate
        aria-label={form.name || "Form"}
        onSubmit={(event) => {
          event.preventDefault();
          next();
        }}
      >
        <div className="kit-grid">
          {visible.map((field) =>
            field.type === "hidden" ? null : (
              <div key={field.id} className={cx("kit-cfield kit-cfield--test", field.width === "half" && !isLayout(field) ? "kit-cfield--half" : "kit-cfield--full")}>
                <FieldPreview field={field} labels={labels} mode="test" value={answers[field.id]} error={errors[field.id]} onChange={(value: Answer) => setAnswers((current) => ({ ...current, [field.id]: value }))} />
              </div>
            ),
          )}
        </div>
        {Object.keys(errors).length > 0 ? (
          <p className="g-error-text" role="alert">
            <ProofMark kind="bang" />
            <span>{Object.keys(errors).length === 1 ? "1 answer needs checking." : `${Object.keys(errors).length} answers need checking.`} The visitor would see these messages.</span>
          </p>
        ) : null}
        <div className="kit-sheet__actions">
          {step > 0 ? (
            <button type="button" className="kit-pv__button kit-pv__button--back" onClick={() => setStep(step - 1)}>
              Back
            </button>
          ) : null}
          <button type="submit" className="kit-pv__button">
            {last ? form.submitLabel || "Send" : form.steps?.[step]?.nextLabel || "Next"}
          </button>
        </div>
      </form>
    </div>
  );
}
