import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon";
import { cx } from "./cx";

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** The element the popover hangs from. */
  anchor: RefObject<HTMLElement | null>;
  placement?: "bottom-start" | "bottom-end" | "top-start" | "top-end" | "right-start";
  children: ReactNode;
  className?: string;
  /** role and label for the surface (e.g. role="dialog" + aria-label). */
  role?: string;
  "aria-label"?: string;
  id?: string;
  /** Focus moves into the popover on open (default true). */
  autoFocus?: boolean;
}

const GAP = 4;

/** A floating surface tied to an anchor. Outside click and Escape close it; Escape returns focus to the anchor. */
export function Popover({ open, onClose, anchor, placement = "bottom-start", children, className, role, id, autoFocus = true, ...aria }: PopoverProps) {
  const surface = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const s = surface.current?.getBoundingClientRect();
      if (!a || !s) return;
      let top: number;
      let left: number;
      if (placement === "right-start") {
        top = a.top;
        left = a.right + GAP;
      } else {
        const below = placement.startsWith("bottom");
        top = below ? a.bottom + GAP : a.top - s.height - GAP;
        if (below && top + s.height > window.innerHeight - 8 && a.top - s.height - GAP > 8) top = a.top - s.height - GAP;
        if (!below && top < 8) top = a.bottom + GAP;
        left = placement.endsWith("end") ? a.right - s.width : a.left;
      }
      left = Math.min(Math.max(8, left), window.innerWidth - s.width - 8);
      top = Math.min(Math.max(8, top), window.innerHeight - s.height - 8);
      setPos({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, placement, anchor]);

  // Focus moves in once the surface is placed: it renders hidden until then, and a hidden element can't take focus.
  const placed = pos !== null;
  useEffect(() => {
    if (!open || !placed || !autoFocus) return;
    const first = surface.current?.querySelector<HTMLElement>("[data-autofocus], [role=menuitem], button, input, a[href], [tabindex='0']");
    (first ?? surface.current)?.focus();
  }, [open, placed, autoFocus]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (surface.current?.contains(target) || anchor.current?.contains(target)) return;
      onCloseRef.current();
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onCloseRef.current();
      anchor.current?.focus();
    };
    // A click inside an embedded page (the preview) never reaches this document: it only takes focus from it.
    const onBlur = () => {
      setTimeout(() => {
        if (document.activeElement instanceof HTMLIFrameElement && !surface.current?.contains(document.activeElement)) onCloseRef.current();
      });
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [open, anchor]);

  if (!open) return null;
  return createPortal(
    <div
      ref={surface}
      id={id}
      role={role}
      aria-label={aria["aria-label"]}
      tabIndex={-1}
      className={cx("app-popover", className)}
      style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
    >
      {children}
    </div>,
    document.body,
  );
}

export type MenuItem =
  | {
      kind?: "item";
      id: string;
      label: ReactNode;
      icon?: IconName;
      /** Secondary text on the right (a count, a shortcut). */
      hint?: ReactNode;
      /** A sentence under the label, for choices that need explaining; the menu then keeps to a readable width. */
      description?: ReactNode;
      onSelect: () => void;
      tone?: "danger";
      disabled?: boolean;
      /** Marks the current choice (e.g. the open site). */
      current?: boolean;
    }
  | { kind: "separator"; id: string }
  | { kind: "heading"; id: string; label: string };

export interface MenuTriggerProps {
  ref: RefObject<HTMLButtonElement | null>;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  "aria-controls": string | undefined;
}

export interface MenuProps {
  /** Render the button that opens the menu; spread the props onto a <button>. */
  trigger: (props: MenuTriggerProps) => ReactNode;
  items: MenuItem[];
  /** Accessible name of the menu. */
  label: string;
  placement?: PopoverProps["placement"];
  className?: string;
}

/** A menu button: arrow keys, Home/End, type-ahead, Enter/Space to choose, Escape to close. */
export function Menu({ trigger, items, label, placement = "bottom-start", className }: MenuProps) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const described = items.some((item) => (item.kind ?? "item") === "item" && "description" in item && item.description);

  const focusables = () => [...(list.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not([disabled])") ?? [])];

  const move = (delta: number | "first" | "last") => {
    const all = focusables();
    if (all.length === 0) return;
    const index = all.indexOf(document.activeElement as HTMLButtonElement);
    const next = delta === "first" ? 0 : delta === "last" ? all.length - 1 : (index + delta + all.length) % all.length;
    all[next]?.focus();
  };

  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") move(1);
    else if (event.key === "ArrowUp") move(-1);
    else if (event.key === "Home") move("first");
    else if (event.key === "End") move("last");
    else if (event.key === "Tab") setOpen(false);
    else if (event.key.length === 1 && /\S/.test(event.key)) {
      const match = focusables().find((el) => el.textContent?.trim().toLowerCase().startsWith(event.key.toLowerCase()));
      match?.focus();
    } else return;
    if (event.key !== "Tab") event.preventDefault();
  };

  const select = (item: Extract<MenuItem, { onSelect: () => void }>) => {
    setOpen(false);
    anchor.current?.focus();
    item.onSelect();
  };

  return (
    <>
      {trigger({
        ref: anchor,
        onClick: () => setOpen((value) => !value),
        onKeyDown: (event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            requestAnimationFrame(() => move(event.key === "ArrowDown" ? "first" : "last"));
          }
        },
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": open ? id : undefined,
      })}
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} placement={placement} className={cx("g-menu app-menu", described && "app-menu--described", className)}>
        <div ref={list} id={id} role="menu" aria-label={label} onKeyDown={onListKey}>
          {items.map((item) => {
            if (item.kind === "separator") return <div key={item.id} role="separator" className="app-menu__separator" />;
            if (item.kind === "heading")
              return (
                <div key={item.id} className="g-eyebrow app-menu__heading" role="presentation">
                  {item.label}
                </div>
              );
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={item.disabled}
                aria-current={item.current || undefined}
                className={cx("g-menu__item", item.tone === "danger" && "app-menu__item--danger", item.current && "app-menu__item--current", item.description ? "app-menu__item--described" : null)}
                onClick={() => select(item)}
              >
                {item.icon ? <Icon name={item.icon} /> : null}
                {item.description ? (
                  <span className="app-menu__text">
                    <span className="app-menu__label">{item.label}</span>
                    <span className="app-menu__description">{item.description}</span>
                  </span>
                ) : (
                  <span className="app-menu__label">{item.label}</span>
                )}
                {item.current ? <Icon name="check" className="app-menu__check" /> : null}
                {item.hint ? <span className="app-menu__hint">{item.hint}</span> : null}
              </button>
            );
          })}
        </div>
      </Popover>
    </>
  );
}
