import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  /**
   * The tooltip repeats the control's accessible name (an icon button's
   * label), so it is hidden from screen readers instead of described-by.
   */
  decorative?: boolean;
}

const DELAY_MS = 450;
const GAP = 6;

/** A short label on hover or keyboard focus. Escape hides it. */
export function Tooltip({ content, children, side = "top", decorative = false }: TooltipProps) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const show = (immediate: boolean) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), immediate ? 0 : DELAY_MS);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !anchor.current || !tip.current) {
      setPos(null);
      return;
    }
    const a = anchor.current.getBoundingClientRect();
    const t = tip.current.getBoundingClientRect();
    let top = side === "bottom" ? a.bottom + GAP : side === "top" ? a.top - t.height - GAP : a.top + (a.height - t.height) / 2;
    let left = side === "right" ? a.right + GAP : side === "left" ? a.left - t.width - GAP : a.left + (a.width - t.width) / 2;
    if (top < 4) top = a.bottom + GAP;
    if (top + t.height > window.innerHeight - 4) top = a.top - t.height - GAP;
    left = Math.min(Math.max(4, left), window.innerWidth - t.width - 4);
    setPos({ top, left });
  }, [open, side]);

  return (
    <span
      ref={anchor}
      className="app-tooltip-anchor"
      onPointerEnter={() => show(false)}
      onPointerLeave={hide}
      onFocus={(event) => {
        if ((event.target as HTMLElement).matches(":focus-visible")) show(true);
      }}
      onBlur={hide}
      onPointerDown={hide}
      aria-describedby={!decorative && open ? id : undefined}
    >
      {children}
      {open
        ? createPortal(
            <div
              ref={tip}
              id={id}
              role={decorative ? undefined : "tooltip"}
              aria-hidden={decorative || undefined}
              className="app-tooltip"
              style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden", top: 0, left: 0 }}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
