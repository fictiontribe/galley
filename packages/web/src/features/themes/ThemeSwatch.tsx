import type { CSSProperties } from "react";
import { checkTheme, fullSwitches, type ThemeCheck, type ThemeFile, type ThemeMode } from "@galley/core/themes";
import { cx } from "@/ui";
import "./themes.css";

const checks = new WeakMap<ThemeFile, ThemeCheck>();

/** A theme's check, once per theme object (the picker draws many, often). */
export function checked(theme: ThemeFile): ThemeCheck {
  let check = checks.get(theme);
  if (!check) {
    check = checkTheme(theme);
    checks.set(theme, check);
  }
  return check;
}

/**
 * A theme drawn small, from its own colours and switches: the sidebar in its
 * material (paper, a toned desk or the plate) with the current place, the
 * paper, a sheet with two lines of ink, the assistant's field and the one
 * button in the pencil. Decorative: the name beside it says which theme it is.
 * Every colour comes from the check, so it is exactly `#RRGGBB`.
 */
export function ThemeSwatch({ theme, mode, size = "md", className }: { theme: ThemeFile; mode: ThemeMode; size?: "sm" | "md" | "lg"; className?: string }) {
  const check = checked(theme);
  const c = check.colours?.[mode];
  if (!c) return <span className={cx("theme-swatch", `theme-swatch--${size}`, "theme-swatch--refused", className)} aria-hidden="true" />;
  const switches = fullSwitches(theme.switches);
  const style = {
    "--sw-paper": c.paper,
    "--sw-sheet": c.sheet,
    "--sw-desk": c.desk,
    "--sw-plate": c.plate,
    "--sw-plate-current": c.plateCurrent,
    "--sw-pencil-on-plate": c.pencilOnPlate,
    "--sw-on-plate": c.onPlate3,
    "--sw-ink": c.ink,
    "--sw-ink-3": c.ink3,
    "--sw-edge": c.edge,
    "--sw-fill": c.accentFill,
    "--sw-pencil-50": c.pencil50,
    "--sw-pencil-200": c.pencil200,
    "--sw-pencil-300": c.pencil300,
    "--sw-pencil-400": c.pencil400,
  } as CSSProperties;
  return (
    <span
      className={cx("theme-swatch", `theme-swatch--${size}`, className)}
      data-sidebar={switches.sidebar}
      data-assist={switches.assist}
      data-icons={switches.icons}
      data-depth={switches.depth}
      style={style}
      aria-hidden="true"
    >
      <span className="theme-swatch__side">
        <span className="theme-swatch__item theme-swatch__item--current" />
        <span className="theme-swatch__item" />
        <span className="theme-swatch__item" />
      </span>
      <span className="theme-swatch__page">
        <span className="theme-swatch__sheet">
          <span className="theme-swatch__line" />
          <span className="theme-swatch__line theme-swatch__line--quiet" />
          <span className="theme-swatch__field" />
        </span>
        <span className="theme-swatch__button" />
      </span>
    </span>
  );
}
