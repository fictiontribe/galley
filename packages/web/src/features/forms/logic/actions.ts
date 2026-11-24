/**
 * "After sending": the steps that run once a submission succeeds, in order.
 * A form shows at most one thank-you and goes to at most one page; custom
 * code is offered only where build mode is allowed. These rules decide what
 * the "Add a step" menu offers and what the list explains.
 */
import type { FormAction } from "@galley/core/kit";

export type ActionType = FormAction["type"];

export interface ActionKind {
  type: ActionType;
  label: string;
  description: string;
}

export const ACTION_KINDS: readonly ActionKind[] = [
  { type: "message", label: "Show a thank-you message", description: "Replaces the form with a short message" },
  { type: "redirect", label: "Go to a page", description: "Sends the visitor to another page" },
  { type: "download", label: "Offer a download", description: "A file to download, like a guide or a price list" },
  { type: "event", label: "Record a conversion", description: "Tells your analytics the form was sent" },
  { type: "webhook", label: "Notify another service", description: "Posts a copy of the answers to another address" },
  { type: "script", label: "Run custom code", description: "Code that runs with the answers" },
];

export function actionKind(type: ActionType): ActionKind {
  return ACTION_KINDS.find((kind) => kind.type === type) ?? (ACTION_KINDS[0] as ActionKind);
}

export interface Availability {
  ok: boolean;
  /** Why not, in a sentence. */
  reason?: string;
}

/** Why custom code can't be added where the site doesn't allow build mode. */
export const CODE_SITE_OFF = "Custom code is only offered on sites where build mode is allowed.";

/** Whether another step of this type may be added. `codeOff` says why custom code isn't offered when `allowBuild` is false. */
export function canAdd(actions: readonly FormAction[], type: ActionType, allowBuild: boolean, codeOff: string = CODE_SITE_OFF): Availability {
  if (type === "message" && actions.some((action) => action.type === "message")) return { ok: false, reason: "This form already shows a thank-you message. Edit that one instead." };
  if (type === "redirect" && actions.some((action) => action.type === "redirect")) return { ok: false, reason: "This form already goes to a page. A visitor can only go to one." };
  if (type === "script" && !allowBuild) return { ok: false, reason: codeOff };
  return { ok: true };
}

/** Seconds a page change waits when a thank-you is also shown. */
export const REDIRECT_DELAY_WITH_MESSAGE = 3;

/** A new step of this type, ready to edit. */
export function newAction(type: ActionType, actions: readonly FormAction[]): FormAction {
  switch (type) {
    case "message":
      return { type: "message", title: "Thank you", text: "We’ve got your message and will reply soon." };
    case "redirect":
      return actions.some((action) => action.type === "message") ? { type: "redirect", url: "/", delaySeconds: REDIRECT_DELAY_WITH_MESSAGE } : { type: "redirect", url: "/" };
    case "download":
      return { type: "download", url: "", label: "Download" };
    case "event":
      return { type: "event", name: "form_submitted", target: "dataLayer" };
    case "webhook":
      return { type: "webhook", url: "" };
    case "script":
      return { type: "script", code: "// Runs after the form is sent. `values` holds the answers.\n" };
  }
}

/** Where a new step goes: a thank-you before the rest, so it shows first; anything else at the end. */
export function insertIndex(actions: readonly FormAction[], type: ActionType): number {
  return type === "message" ? 0 : actions.length;
}

/** Plain notes about how the steps combine — shown under the list. */
export function actionNotes(actions: readonly FormAction[]): string[] {
  const notes: string[] = [];
  const message = actions.find((action) => action.type === "message");
  const redirect = actions.find((action): action is Extract<FormAction, { type: "redirect" }> => action.type === "redirect");
  if (message && redirect) {
    const delay = redirect.delaySeconds ?? 0;
    notes.push(
      delay > 0
        ? `The thank-you shows first, then the page changes after ${delay} ${delay === 1 ? "second" : "seconds"}.`
        : "The page changes straight away, so the thank-you won’t be seen. Give the page change a wait to show both.",
    );
  }
  if (redirect && actions.some((action) => action.type === "download" && action.auto)) {
    notes.push("A download that starts on its own may be cut short when the page changes. Offer it on the next page instead, or don’t start it on its own.");
  }
  if (actions.length === 0) notes.push("With no steps, the form shows a short “Sent.” in its place.");
  return notes;
}

/** The field ids a message or a page address uses as `{{id}}`. */
export function placeholdersIn(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g)].map((match) => match[1] as string);
}

/** A message with `{{id}}` filled from answers (missing answers become empty). */
export function fillAnswers(text: string, answers: Record<string, string | string[] | undefined>): string {
  return text.replace(/\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g, (_, id: string) => {
    const value = answers[id];
    return Array.isArray(value) ? value.join(", ") : (value ?? "");
  });
}
