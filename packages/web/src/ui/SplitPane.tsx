import {
  Children,
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useUi } from "@/lib/stores/ui";
import { IconButton } from "./Button";
import { cx } from "./cx";

export interface PaneSpec {
  id: string;
  /** Names the pane for the collapsed rail and the resize handle. */
  label: string;
  /** Default width in px. Leave out on exactly one pane: it takes the remaining space. */
  size?: number;
  /** Minimum width in px (default 280, the brand's --pane-min-width). */
  min?: number;
  /** Maximum width in px for fixed panes. */
  max?: number;
  collapsible?: boolean;
}

export interface SplitPaneProps {
  /** Persists sizes and collapsed state under this id. */
  id: string;
  panes: PaneSpec[];
  /** One child per pane, in order. */
  children: ReactNode;
  className?: string;
}

interface PaneControls {
  collapsed: boolean;
  toggle: () => void;
  label: string;
}

const SplitContext = createContext<{ controls: (paneId: string) => PaneControls } | null>(null);

/** Collapse state and toggle for a pane, for its own header button. */
export function usePaneControls(paneId: string): PaneControls | null {
  return useContext(SplitContext)?.controls(paneId) ?? null;
}

const DEFAULT_MIN = 280;
const RAIL = 36;
const STEP = 16;
const BIG_STEP = 64;

/**
 * Horizontal panes with resizable, keyboard-operable dividers. Fixed panes
 * keep a pixel width (persisted); the one flexible pane takes what's left.
 * Collapsed panes become a slim rail that reopens them. Pane contents stay
 * mounted while collapsed, so a chat or an iframe keeps its state.
 */
export function SplitPane({ id, panes, children, className }: SplitPaneProps) {
  const container = useRef<HTMLDivElement>(null);
  const paneSizes = useUi((s) => s.paneSizes);
  const collapsedMap = useUi((s) => s.collapsed);
  const setPaneSize = useUi((s) => s.setPaneSize);
  const setCollapsed = useUi((s) => s.setCollapsed);
  const items = Children.toArray(children);

  const [available, setAvailable] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setAvailable(entry ? entry.contentRect.width : null));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const keyOf = useCallback((paneId: string) => `${id}.${paneId}`, [id]);
  const chosenCollapsed = useCallback((pane: PaneSpec) => Boolean(pane.collapsible && collapsedMap[keyOf(pane.id)]), [collapsedMap, keyOf]);
  const desiredWidth = useCallback((pane: PaneSpec) => paneSizes[keyOf(pane.id)] ?? pane.size ?? 0, [paneSizes, keyOf]);

  // Fit to the container without touching saved preferences: shrink fixed
  // panes toward their minimum, then fold the rightmost collapsible panes
  // into rails until the flexible pane keeps its minimum width.
  const fit = useMemo(() => {
    const folded = new Set<string>();
    const widths = new Map<string, number>();
    const flex = panes.find((pane) => pane.size === undefined);
    const flexOpen = flex && !chosenCollapsed(flex);
    for (;;) {
      const open = panes.filter((pane) => !chosenCollapsed(pane) && !folded.has(pane.id));
      const fixed = open.filter((pane) => pane.size !== undefined);
      const rails = (panes.length - open.length) * RAIL;
      const room = (available ?? Infinity) - rails - (flexOpen ? (flex?.min ?? DEFAULT_MIN) : 0);
      const want = fixed.reduce((sum, pane) => sum + desiredWidth(pane), 0);
      const floor = fixed.reduce((sum, pane) => sum + (pane.min ?? DEFAULT_MIN), 0);
      if (want <= room || !flexOpen) {
        fixed.forEach((pane) => widths.set(pane.id, desiredWidth(pane)));
        break;
      }
      if (floor <= room) {
        const factor = (want - room) / Math.max(1, want - floor);
        fixed.forEach((pane) => widths.set(pane.id, Math.floor(desiredWidth(pane) - (desiredWidth(pane) - (pane.min ?? DEFAULT_MIN)) * factor)));
        break;
      }
      const victim = [...fixed].reverse().find((pane) => pane.collapsible);
      if (!victim) {
        fixed.forEach((pane) => widths.set(pane.id, pane.min ?? DEFAULT_MIN));
        break;
      }
      folded.add(victim.id);
    }
    return { folded, widths };
  }, [panes, available, chosenCollapsed, desiredWidth]);

  const isCollapsed = useCallback((pane: PaneSpec) => chosenCollapsed(pane) || fit.folded.has(pane.id), [chosenCollapsed, fit]);
  const widthOf = useCallback((pane: PaneSpec) => fit.widths.get(pane.id) ?? desiredWidth(pane), [fit, desiredWidth]);

  // The pane that absorbs leftover space: the flexible one, or — when it is
  // collapsed — the last open pane.
  const flexId = useMemo(() => {
    const flex = panes.find((pane) => pane.size === undefined);
    if (flex && !isCollapsed(flex)) return flex.id;
    return [...panes].reverse().find((pane) => !isCollapsed(pane))?.id ?? null;
  }, [panes, isCollapsed]);

  const columns = panes
    .map((pane) => {
      if (isCollapsed(pane)) return `${RAIL}px`;
      const min = pane.min ?? DEFAULT_MIN;
      if (pane.id === flexId) return pane.size === undefined ? `minmax(${min}px, 1fr)` : `minmax(${widthOf(pane)}px, 1fr)`;
      return `${widthOf(pane)}px`;
    })
    .join(" 0px ");

  /** Largest width a fixed pane may take while every other pane keeps its minimum. */
  const maxFor = (target: PaneSpec): number => {
    const total = available ?? container.current?.clientWidth ?? window.innerWidth;
    const others = panes
      .filter((pane) => pane.id !== target.id)
      .reduce((sum, pane) => {
        if (isCollapsed(pane)) return sum + RAIL;
        if (pane.size === undefined || pane.id === flexId) return sum + (pane.min ?? DEFAULT_MIN);
        return sum + widthOf(pane);
      }, 0);
    return Math.max(target.min ?? DEFAULT_MIN, Math.min(target.max ?? Infinity, total - others));
  };

  const clampSize = (pane: PaneSpec, size: number) => Math.round(Math.min(maxFor(pane), Math.max(pane.min ?? DEFAULT_MIN, size)));

  /** The fixed pane a divider resizes, and which way dragging right moves it. */
  const targetOf = (index: number): { pane: PaneSpec; sign: 1 | -1 } | null => {
    const left = panes[index];
    const right = panes[index + 1];
    if (left && left.size !== undefined && !isCollapsed(left) && left.id !== flexId) return { pane: left, sign: 1 };
    if (right && right.size !== undefined && !isCollapsed(right) && right.id !== flexId) return { pane: right, sign: -1 };
    return null;
  };

  const toggle = (pane: PaneSpec) => {
    if (fit.folded.has(pane.id)) {
      // Folded for lack of room: make room by hiding the other side panes instead.
      for (const other of panes) if (other.id !== pane.id && other.collapsible && other.size !== undefined) setCollapsed(keyOf(other.id), true);
      setCollapsed(keyOf(pane.id), false);
      return;
    }
    setCollapsed(keyOf(pane.id), !chosenCollapsed(pane));
  };

  const onPointerDown = (index: number) => (event: PointerEvent<HTMLDivElement>) => {
    const target = targetOf(index);
    if (!target || event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startSize = widthOf(target.pane);
    document.documentElement.classList.add("app-resizing");
    const onMove = (move: globalThis.PointerEvent) => {
      setPaneSize(keyOf(target.pane.id), clampSize(target.pane, startSize + target.sign * (move.clientX - startX)));
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      document.documentElement.classList.remove("app-resizing");
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLDivElement>) => {
    const target = targetOf(index);
    if (!target) return;
    const step = event.shiftKey ? BIG_STEP : STEP;
    const current = widthOf(target.pane);
    let next: number | null = null;
    if (event.key === "ArrowRight") next = current + target.sign * step;
    else if (event.key === "ArrowLeft") next = current - target.sign * step;
    else if (event.key === "Home") next = target.pane.min ?? DEFAULT_MIN;
    else if (event.key === "End") next = maxFor(target.pane);
    else if (event.key === "Enter" && target.pane.collapsible) {
      event.preventDefault();
      toggle(target.pane);
      return;
    }
    if (next === null) return;
    event.preventDefault();
    setPaneSize(keyOf(target.pane.id), clampSize(target.pane, next));
  };

  const controls = (paneId: string): PaneControls => {
    const pane = panes.find((candidate) => candidate.id === paneId);
    return {
      collapsed: pane ? isCollapsed(pane) : false,
      toggle: () => pane && toggle(pane),
      label: pane?.label ?? paneId,
    };
  };

  return (
    <SplitContext.Provider value={{ controls }}>
      <div ref={container} className={cx("app-split", className)} style={{ gridTemplateColumns: columns }}>
        {panes.map((pane, index) => {
          const collapsed = isCollapsed(pane);
          const target = index < panes.length - 1 ? targetOf(index) : null;
          return [
            <div key={pane.id} className={cx("app-split__pane", collapsed && "app-split__pane--collapsed")} id={`${id}-${pane.id}`}>
              {collapsed ? (
                <div className="app-rail">
                  <IconButton icon={index === 0 ? "chevron-right" : "chevron-left"} label={`Show ${pane.label.toLowerCase()}`} onClick={() => toggle(pane)} tooltipSide={index === 0 ? "right" : "left"} />
                  <button type="button" className="app-rail__label" onClick={() => toggle(pane)} tabIndex={-1}>
                    {pane.label}
                  </button>
                </div>
              ) : null}
              <div className="app-split__content" hidden={collapsed}>
                {items[index]}
              </div>
            </div>,
            index < panes.length - 1 ? (
              <div
                key={`${pane.id}-divider`}
                className={cx("app-split__divider", !target && "app-split__divider--static")}
                role={target ? "separator" : undefined}
                aria-orientation={target ? "vertical" : undefined}
                aria-label={target ? `Resize ${target.pane.label.toLowerCase()}` : undefined}
                aria-controls={target ? `${id}-${target.pane.id}` : undefined}
                aria-valuenow={target ? widthOf(target.pane) : undefined}
                aria-valuemin={target ? (target.pane.min ?? DEFAULT_MIN) : undefined}
                aria-valuemax={target ? Math.round(maxFor(target.pane)) : undefined}
                tabIndex={target ? 0 : undefined}
                onPointerDown={onPointerDown(index)}
                onKeyDown={onKeyDown(index)}
                onDoubleClick={() => target?.pane.collapsible && toggle(target.pane)}
              />
            ) : null,
          ];
        })}
      </div>
    </SplitContext.Provider>
  );
}
