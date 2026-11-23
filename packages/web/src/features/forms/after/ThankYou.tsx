import type { FormAction, FormField } from "@galley/core/kit";
import { cx } from "@/ui";
import { fillAnswers } from "../logic/actions";
import { InlineText } from "../canvas/InlineText";
import type { Answers } from "../logic/conditions";

/** Sample answers for the preview: each field's label in brackets, so `{{name}}` reads as “[Name]”. */
export function sampleAnswers(fields: readonly FormField[]): Answers {
  return Object.fromEntries(fields.map((field) => [field.id, `[${field.label?.trim() || field.id}]`]));
}

export interface ThankYouProps {
  actions: readonly FormAction[];
  answers: Answers;
  /** In the test run: "redirect announced" instead of followed. */
  className?: string;
}

/** What replaces the form once it is sent: the thank-you, a download button, and a note of where the page goes next. */
export function ThankYou({ actions, answers, className }: ThankYouProps) {
  const message = actions.find((action): action is Extract<FormAction, { type: "message" }> => action.type === "message");
  const download = actions.find((action): action is Extract<FormAction, { type: "download" }> => action.type === "download");
  const redirect = actions.find((action): action is Extract<FormAction, { type: "redirect" }> => action.type === "redirect");
  return (
    <div className={cx("kit-sheet kit-thanks", className)} role="status">
      {message ? (
        <>
          {message.title ? <h3 className="kit-thanks__title">{fillAnswers(message.title, answers)}</h3> : null}
          <InlineText as="p" className="kit-thanks__text" text={fillAnswers(message.text, answers)} />
        </>
      ) : redirect && !download ? null : (
        <p className="kit-thanks__text">Sent.</p>
      )}
      {download ? (
        <span className="kit-pv__button" aria-hidden="true">
          {download.label || "Download"}
        </span>
      ) : null}
      {redirect ? (
        <p className="kit-thanks__redirect">
          {message && redirect.delaySeconds ? `After ${redirect.delaySeconds} s, the visitor goes to ` : "The visitor goes to "}
          <span className="g-mono">{redirect.url || "(no page chosen yet)"}</span>
          {redirect.passFields?.length ? ` with ${redirect.passFields.join(", ")} in the address` : ""}.
        </p>
      ) : null}
    </div>
  );
}
