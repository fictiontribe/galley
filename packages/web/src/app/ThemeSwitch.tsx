import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { create } from "zustand";
import { useUi } from "@/lib/stores/ui";
import { THEME_ACTION, THEME_OPTIONS, oneClickTheme, type ThemeSetting } from "@/lib/theme";
import { Icon, Menu, Tooltip, buttonClass, cx, type IconName, type MenuItem, type PopoverProps } from "@/ui";
import { chooseTheme, switchTheme, useSystemDark } from "./theme";

const THEME_ICON: Record<ThemeSetting, IconName> = { light: "sun", dark: "moon", system: "theme-system" };

/** How long a press is held before it opens the three choices instead of switching. */
const HOLD_MS = 500;

export interface ThemeSwitchProps {
  /** Where the three choices open from the button. */
  placement: PopoverProps["placement"];
  tooltipSide: "top" | "bottom" | "left" | "right";
  className?: string;
}

/**
 * The theme switch: one click goes light ↔ dark (from "match my system", to
 * the opposite of what is showing). Holding it, right-clicking it or pressing
 * the down arrow on it opens the three choices, Match my system among them.
 * Its name says what a click will do, and the mark is that theme's: the
 * moon to go dark, the sun to go light.
 */
export function ThemeSwitch({ placement, tooltipSide, className }: ThemeSwitchProps) {
  const theme = useUi((s) => s.theme);
  const systemDark = useSystemDark();
  const next = oneClickTheme(theme, systemDark);
  const label = THEME_ACTION[next];
  const descriptionId = useId();
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The press that opened the choices also ends in a click; that click must not switch as well.
  const held = useRef(false);
  const menuOpen = useRef(false);
  const openMenu = useRef<() => void>(() => undefined);

  const stopHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };
  useEffect(() => stopHold, []);

  const items: MenuItem[] = [
    { kind: "heading", id: "heading", label: "Theme" },
    ...THEME_OPTIONS.map((option) => ({ id: option.value, label: option.label, icon: THEME_ICON[option.value], current: theme === option.value, onSelect: () => chooseTheme(option.value) })),
  ];
  const now = theme === "system" ? "Matching your system now. " : "";

  return (
    <>
      <Menu
        label="Theme"
        placement={placement}
        items={items}
        trigger={(props) => {
          menuOpen.current = props["aria-expanded"];
          openMenu.current = () => {
            if (!menuOpen.current) props.onClick();
          };
          return (
            <Tooltip
              side={tooltipSide}
              decorative
              content={
                <span className="app-theme-switch__tip">
                  <span>{label}</span>
                  <span className="app-theme-switch__more">{now}Hold, right-click or press ↓ for more choices</span>
                </span>
              }
            >
              <button
                ref={props.ref}
                type="button"
                className={buttonClass("quiet", "sm", cx("g-btn--icon app-theme-switch", className))}
                aria-label={label}
                aria-describedby={descriptionId}
                onKeyDown={props.onKeyDown}
                onClick={() => {
                  if (held.current) {
                    held.current = false;
                    return;
                  }
                  // A click while the choices are open closes them, like any menu button.
                  if (menuOpen.current) props.onClick();
                  else switchTheme();
                }}
                onPointerDown={(event) => {
                  held.current = false;
                  if (event.button !== 0) return;
                  stopHold();
                  holdTimer.current = setTimeout(() => {
                    held.current = true;
                    openMenu.current();
                  }, HOLD_MS);
                }}
                onPointerUp={stopHold}
                onPointerLeave={stopHold}
                onPointerCancel={stopHold}
                onContextMenu={(event) => {
                  event.preventDefault();
                  stopHold();
                  openMenu.current();
                }}
              >
                <Icon name={next === "dark" ? "moon" : "sun"} />
              </button>
            </Tooltip>
          );
        }}
      />
      <span id={descriptionId} className="g-sr">
        {now}Press the down arrow, hold, or right-click for Light, Dark and Match my system.
      </span>
    </>
  );
}

// How many app frames (the shell with a sidebar) are on screen: the screens
// outside the shell (sign-in, first run, a one-time link, opening the app)
// show the switch in a corner instead.
const useFrames = create<{ count: number }>(() => ({ count: 0 }));

/** Called by each frame: while it is mounted, the frame's own switch is the one on screen. */
export function useFramePresence(): void {
  useLayoutEffect(() => {
    useFrames.setState((state) => ({ count: state.count + 1 }));
    return () => useFrames.setState((state) => ({ count: state.count - 1 }));
  }, []);
}

/** The switch in the top corner of the small screens outside the shell. */
export function CornerThemeSwitch() {
  const framed = useFrames((state) => state.count > 0);
  if (framed) return null;
  return (
    <div className="app-theme-corner">
      <ThemeSwitch placement="bottom-end" tooltipSide="left" />
    </div>
  );
}
