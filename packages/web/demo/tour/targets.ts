/**
 * The real control each step points at, found in the app's own page the way
 * a person would find it (labels, button words, links) — and what to do
 * there, when that depends on what's on screen (a section not open yet).
 * When nothing fits, the card sits in its corner with no spotlight.
 */
import type { StepId } from "./steps";

export interface Target {
  element: HTMLElement | null;
  /** What the card stays clear of, when that is more than the control: the whole change a button belongs to. */
  around?: HTMLElement | null;
  /** The next thing to do, in the card. */
  hint?: string;
}

const inApp = (element: Element) => !element.closest("#demo-layer");

const shown = (element: Element | null | undefined): HTMLElement | null =>
  element instanceof HTMLElement && inApp(element) && element.getClientRects().length > 0 ? element : null;

function byText(selector: string, text: RegExp, root: ParentNode = document): HTMLElement | null {
  for (const element of root.querySelectorAll<HTMLElement>(selector)) {
    if (text.test((element.textContent ?? "").replace(/\s+/g, " ").trim()) && shown(element)) return element;
  }
  return null;
}

/** The open modal dialog, if any: while it's up, it is where the step happens. */
export function openDialog(): HTMLDialogElement | null {
  return [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")].find((dialog) => inApp(dialog) && dialog.matches(":modal")) ?? null;
}

/** The field whose label reads exactly `label`. */
function fieldLabelled(label: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLLabelElement>("label.g-label")) {
    if ((element.firstChild?.textContent ?? "").trim() !== label || !inApp(element)) continue;
    const field = shown(element.closest(".g-field"));
    if (field) return field;
  }
  return null;
}

function formStep(): Target {
  const heading = fieldLabelled("Heading");
  if (heading) return { element: heading, hint: "Type a new heading" };
  // The section's card in the form, closed: its heading is inside.
  const toggle = byText("button.app-card__toggle", /^Campaign hero/);
  return { element: shown(toggle?.closest(".g-block")) ?? toggle, hint: "Open Campaign hero, then change its Heading" };
}

function proofLink(): HTMLElement | null {
  const links = [...document.querySelectorAll<HTMLElement>("a[href$='/proof']")].filter((link) => shown(link));
  // The top bar's Proof, beside Publish, rather than the sidebar's.
  return links.find((link) => !link.closest(".app-sidebar")) ?? links[0] ?? null;
}

export function targetFor(step: StepId): Target {
  const dialog = openDialog();
  switch (step) {
    case "form":
      return formStep();
    case "page":
      return { element: shown(document.querySelector("iframe[name='galley-preview']")?.closest(".preview-sheet")), hint: "Click a line of text on the page, type, then press Enter" };
    case "assistant":
      return { element: shown(document.querySelector(".chat-composer")) };
    case "proof":
      return { element: proofLink(), hint: "Open Proof" };
    case "putBack": {
      const button = byText("button", /^Put back$/);
      // Beside the whole change, not over the words it is about.
      return { element: button, around: shown(button?.closest(".proof-change")), hint: "Press Put back on one change" };
    }
    case "publish":
      if (dialog) return { element: byText("button", /^Publish \d/, dialog), hint: "Press Publish in the dialog" };
      return { element: byText("button", /^Publish$/), hint: "Press Publish" };
    case "history":
      if (dialog) return { element: byText("button, a", /^See version history$/, dialog), hint: "See version history" };
      return { element: byText("a", /^Version history$/), hint: "Open Version history" };
    default:
      return { element: null };
  }
}
