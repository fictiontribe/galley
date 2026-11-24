import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
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
 * How far the toasts rise so they never cover a bar that stays at the foot of
 * the screen with buttons in it (marked `data-keep-clear`, like the unsaved
 * crawler choices): the height of the tallest such bar on screen under the
 * toasts' corner. Measured only while there are toasts.
 */
function useKeepClear(active: boolean, region: RefObject<HTMLDivElement | null>): number {
  const [lift, setLift] = useState(0);

  useEffect(() => {
    if (!active) {
      setLift(0);
      return;
    }
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const left = region.current?.getBoundingClientRect().left ?? window.innerWidth;
        let next = 0;
        for (const bar of document.querySelectorAll<HTMLElement>("[data-keep-clear]")) {
          const box = bar.getBoundingClientRect();
          if (box.height === 0 || box.bottom <= 0 || box.top >= window.innerHeight || box.right <= left) continue;
          next = Math.max(next, window.innerHeight - box.top);
        }
        setLift(next);
      });
    };
    measure();
    const changes = new MutationObserver(measure);
    changes.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      changes.disconnect();
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [active, region]);
  return lift;
}

/** Bottom-right stack for toasts. Successes leave after 6 s (paused on hover/focus); errors and toasts with an action stay unless given a duration. */
export function ToastViewport({ children }: ToastViewportProps) {
  const toasts = useToasts((s) => s.toasts);
  const region = useRef<HTMLDivElement>(null);
  const lift = useKeepClear(toasts.length > 0, region);
  return (
    <div ref={region} className="g-toast-region app-toast-region" aria-label="Notifications" style={lift ? { insetBlockEnd: `calc(${lift}px + var(--space-2))` } : undefined}>
      {children}
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
