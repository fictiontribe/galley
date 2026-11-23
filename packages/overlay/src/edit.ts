/**
 * Retyping one element in place. Plain text only: formatting is stripped
 * from pastes and drops, Enter (and leaving the element) confirms, Escape
 * puts the original back. The element's markup is restored exactly when
 * nothing changed or the edit is cancelled.
 */
import { EDITING_CLASS } from "./styles";
import { visibleText } from "./text";

export interface EditOutcome {
  /** The text before editing. */
  text: string;
  /** The text after; equal to `text` when nothing changed or it was cancelled. */
  newText: string;
  /** Put the element's original markup back (after the host refused the save). */
  restore(): void;
}

export interface EditSession {
  readonly element: Element;
  /** Confirm (true) or cancel (false). Idempotent. */
  finish(confirm: boolean): void;
}

/** Put the caret where the person clicked, else select the whole text. */
function placeCaret(doc: Document, element: Element, point: { x: number; y: number } | null): void {
  const selection = doc.getSelection();
  if (!selection) return;
  let range: Range | null = null;
  if (point) {
    const fromPoint = (doc as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint;
    const candidate = typeof fromPoint === "function" ? fromPoint.call(doc, point.x, point.y) : null;
    if (candidate && element.contains(candidate.startContainer)) range = candidate;
  }
  if (!range) {
    range = doc.createRange();
    range.selectNodeContents(element);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Insert plain text at the caret, replacing the selection. */
function insertPlain(doc: Document, text: string): void {
  const exec = (doc as Document & { execCommand?: (command: string, ui: boolean, value: string) => boolean }).execCommand;
  if (typeof exec === "function" && exec.call(doc, "insertText", false, text)) return;
  const selection = doc.getSelection();
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  if (!range) return;
  range.deleteContents();
  const node = doc.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function beginEdit(element: HTMLElement, point: { x: number; y: number } | null, onDone: (outcome: EditOutcome) => void): EditSession {
  const doc = element.ownerDocument;
  const original = element.innerHTML;
  const text = visibleText(element);
  const hadAttribute = element.getAttribute("contenteditable");
  const hadSpellcheck = element.getAttribute("spellcheck");
  let finished = false;

  try {
    element.contentEditable = "plaintext-only";
  } catch {
    element.contentEditable = "true";
  }
  if (element.contentEditable !== "plaintext-only") element.contentEditable = "true";
  element.setAttribute("spellcheck", "true");
  element.classList.add(EDITING_CLASS);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      session.finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      session.finish(false);
    }
  };
  const onBeforeInput = (event: InputEvent) => {
    // One line of copy: no paragraphs, and only plain text arrives.
    if (event.inputType === "insertParagraph" || event.inputType === "insertLineBreak") event.preventDefault();
    if (event.inputType.startsWith("format")) event.preventDefault();
  };
  const onPaste = (event: ClipboardEvent) => {
    event.preventDefault();
    const pasted = event.clipboardData?.getData("text/plain") ?? "";
    insertPlain(doc, pasted.replace(/\s+/g, " "));
  };
  const onDrop = (event: DragEvent) => event.preventDefault();
  const onBlur = () => session.finish(true);
  // Clicks inside the element move the caret; they must not follow a link.
  const onClick = (event: MouseEvent) => event.preventDefault();

  element.addEventListener("keydown", onKeyDown);
  element.addEventListener("beforeinput", onBeforeInput);
  element.addEventListener("paste", onPaste);
  element.addEventListener("drop", onDrop);
  element.addEventListener("blur", onBlur);
  element.addEventListener("click", onClick);

  const session: EditSession = {
    element,
    finish(confirm) {
      if (finished) return;
      finished = true;
      element.removeEventListener("keydown", onKeyDown);
      element.removeEventListener("beforeinput", onBeforeInput);
      element.removeEventListener("paste", onPaste);
      element.removeEventListener("drop", onDrop);
      element.removeEventListener("blur", onBlur);
      element.removeEventListener("click", onClick);
      const newText = confirm ? visibleText(element) : text;
      if (hadAttribute === null) element.removeAttribute("contenteditable");
      else element.setAttribute("contenteditable", hadAttribute);
      if (hadSpellcheck === null) element.removeAttribute("spellcheck");
      else element.setAttribute("spellcheck", hadSpellcheck);
      element.classList.remove(EDITING_CLASS);
      if (newText === text || newText === "") element.innerHTML = original;
      doc.getSelection()?.removeAllRanges();
      if (doc.activeElement === element) element.blur();
      onDone({
        text,
        newText: newText === "" ? text : newText,
        restore: () => {
          element.innerHTML = original;
        },
      });
    },
  };

  element.focus({ preventScroll: true });
  placeCaret(doc, element, point);
  return session;
}
