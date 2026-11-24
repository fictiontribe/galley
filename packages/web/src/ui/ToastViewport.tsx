import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
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

/**
 * The room the stack takes at the foot of the screen, as a CSS length: its
 * height and a gap above and below. The screen gives up that much of its
 * height while notifications show (`.app-content`), so they sit in space of
 * their own. Floating over the screen they covered whatever was at its foot
 * — a confirm bar, a crawler's switch, a status-bar link — and lifting them
 * over the bars a screen marked only moved them onto the controls above.
 */
export function toastRoom(stackHeight: number): string {
  return stackHeight > 0 ? `calc(${Math.ceil(stackHeight)}px + var(--space-2) * 2)` : "0px";
}

/** Keeps `--toast-room` on the document in step with the stack's height. */
function useToastRoom(region: RefObject<HTMLDivElement | null>): void {
  useLayoutEffect(() => {
    const element = region.current;
    const root = document.documentElement;
    if (!element) return;
    const measure = () => root.style.setProperty("--toast-room", toastRoom(element.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver === "undefined") return () => root.style.removeProperty("--toast-room");
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--toast-room");
    };
  }, [region]);
}

/** Bottom-right stack for toasts, in room of its own at the foot of the screen (see `toastRoom`). Successes leave after 6 s (paused on hover/focus); errors and toasts with an action stay unless given a duration. */
export function ToastViewport({ children }: ToastViewportProps) {
  const toasts = useToasts((s) => s.toasts);
  const region = useRef<HTMLDivElement>(null);
  useToastRoom(region);
  return (
    <div ref={region} className="g-toast-region app-toast-region" aria-label="Notifications">
      {children}
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
