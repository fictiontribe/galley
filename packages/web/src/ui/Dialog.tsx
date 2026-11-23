import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Button } from "./Button";
import { ErrorState } from "./ErrorState";
import { cx } from "./cx";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), iframe';

export interface DialogProps {
  open: boolean;
  /** Called on Escape, on a backdrop click (when dismissible) and by your own buttons. */
  onClose: () => void;
  /** The question or the job, in the display face. Sentence case, specific. */
  title: ReactNode;
  /** A sentence under the title. Becomes the accessible description. */
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons, right-aligned on the tinted footer. Put the safe action first. */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** Element to focus on open; defaults to the first focusable control. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Escape and backdrop close it (default true). Turn off while something irreversible runs. */
  dismissible?: boolean;
  className?: string;
  /** Hide the title visually (still announced). */
  hideTitle?: boolean;
}

/**
 * Modal dialog on the native <dialog>: the page behind is inert, focus is
 * trapped and returns to where it was when the dialog closes.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  initialFocus,
  dismissible = true,
  className,
  hideTitle,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  useLayoutEffect(() => {
    if (!open) return;
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    if (!dialog.open) dialog.showModal();
    const target = initialFocus?.current ?? dialog.querySelector<HTMLElement>("[data-autofocus]") ?? dialog.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();
    const onCancel = (event: Event) => {
      event.preventDefault();
      if (dismissibleRef.current) onCloseRef.current();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      if (dialog.open) dialog.close();
      // Back to where focus was; if that control is gone or now disabled (Publish, after publishing), to the screen itself.
      const returnTo = previous && document.contains(previous) && !previous.matches(":disabled") ? previous : document.getElementById("main");
      returnTo?.focus({ preventScroll: true });
    };
    // initialFocus is read once on open by design.
  }, [open]);

  if (!open) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab" || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={ref}
      className={cx("g-dialog app-dialog", `app-dialog--${size}`, className)}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onKeyDown={onKeyDown}
      onMouseDown={(event) => {
        if (event.target === ref.current && dismissibleRef.current) onClose();
      }}
    >
      <div className="g-dialog__inner app-dialog__inner">
        <h2 className={cx("g-dialog__title", hideTitle && "g-sr")} id={titleId}>
          {title}
        </h2>
        {description ? (
          <p className="g-dialog__body" id={descriptionId}>
            {description}
          </p>
        ) : null}
        {children}
      </div>
      {footer ? <div className="g-dialog__actions">{footer}</div> : null}
    </dialog>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  /** The question with its specifics: "Discard 3 changes?" */
  title: ReactNode;
  /** Exactly what goes and what stays. */
  body: ReactNode;
  /** Repeats the verb: "Discard 3 changes". */
  confirmLabel: string;
  /** Label while working: "Discarding…". */
  busyLabel?: string;
  /** The safe choice: what you keep doing. */
  cancelLabel?: string;
  tone?: "danger" | "primary";
  /** May be async; the dialog stays open and shows the error if it throws. */
  onConfirm: () => Promise<unknown> | void;
  /** What to call the failure: "Couldn't discard". */
  errorTitle?: string;
}

/** A confirmation for what can't be undone in one click. */
export function ConfirmDialog({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  busyLabel,
  cancelLabel = "Keep editing",
  tone = "danger",
  onConfirm,
  errorTitle,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      setBusy(false);
      setError(null);
    }
  }, [open]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={body}
      size="sm"
      initialFocus={cancel}
      dismissible={!busy}
      footer={
        <>
          <Button ref={cancel} variant="secondary" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone} onClick={confirm} busy={busy} busyLabel={busyLabel}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {error ? <ErrorState compact error={error} title={errorTitle ?? "That didn’t work"} /> : null}
    </Dialog>
  );
}
