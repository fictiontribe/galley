import { useEffect, useRef, useState, type ReactNode } from "react";
import { useToasts, type Toast } from "@/lib/stores/toasts";
import { Button, IconButton } from "./Button";
import { ProofMark, type MarkKind } from "./ProofMark";
import { cx } from "./cx";

const MARK: Record<Toast["tone"], MarkKind> = { neutral: "stet", success: "reg", warning: "bang", danger: "bang" };

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToasts((s) => s.dismiss);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.duration ?? (toast.action || toast.tone === "danger" ? 0 : 6000));

  useEffect(() => {
    if (paused || remaining.current <= 0) return;
    const started = Date.now();
    const timer = setTimeout(() => dismiss(toast.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [paused, dismiss, toast.id]);

  const urgent = toast.tone === "danger";
  return (
    <div
      className={cx("g-toast", toast.tone !== "neutral" && `g-toast--${toast.tone}`, "app-toast")}
      role={urgent ? "alert" : "status"}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <ProofMark kind={MARK[toast.tone]} />
      <span className="g-toast__title">{toast.title}</span>
      <div className="g-toast__actions">
        {toast.action ? (
          <Button
            size="sm"
            variant={urgent ? "secondary" : "quiet"}
            onClick={() => {
              toast.action?.onClick();
              dismiss(toast.id);
            }}
          >
            {toast.action.label}
          </Button>
        ) : null}
        <IconButton icon="close" label="Dismiss" onClick={() => dismiss(toast.id)} tooltip={false} />
      </div>
      {toast.body ? <span className="g-toast__body">{toast.body}</span> : null}
      {toast.detail ? (
        <details className="g-toast__body app-details">
          <summary>Technical details</summary>
          <pre className="app-error__detail">{toast.detail}</pre>
        </details>
      ) : null}
    </div>
  );
}

export interface ToastViewportProps {
  /** Rendered above the toasts in the same corner (the activity tray). */
  children?: ReactNode;
}

/** Bottom-right stack for toasts. Successes leave after 6 s (paused on hover/focus); errors and toasts with an action stay. */
export function ToastViewport({ children }: ToastViewportProps) {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div className="g-toast-region app-toast-region" aria-label="Notifications">
      {children}
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
