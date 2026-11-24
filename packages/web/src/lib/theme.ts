/**
 * The app's theme, decided in small pure steps so each can be tested without
 * a browser: what is showing, what one click on the switch does, whose
 * choice it is (the server's settings, or this browser), and what the
 * command palette offers.
 *
 * Local mode and the desktop app keep one theme for the computer, saved in
 * the server's settings so every window agrees. A hosted install is shared
 * by many people, so there the theme is each person's own, kept in their
 * browser (the `galley.ui` copy): one person choosing dark must not turn the
 * editor dark for everyone. The server's setting stays as the theme a
 * browser starts with until its person chooses.
 */
import type { MetaInfo } from "@galley/core/types";

export type ThemeSetting = "system" | "light" | "dark";
export type ShownTheme = "light" | "dark";

/** Where the theme is kept: the server's settings (one per computer) or this browser (one per person). */
export type ThemeKeeper = "server" | "browser";

/** What the screen shows for a setting, given whether the computer is set to dark. */
export function shownTheme(setting: ThemeSetting, systemDark: boolean): ShownTheme {
  if (setting === "system") return systemDark ? "dark" : "light";
  return setting;
}

/**
 * What one click on the switch chooses: the opposite of what is showing.
 * From "match my system" that is a fixed light or dark, so the click always
 * changes what the person sees.
 */
export function oneClickTheme(setting: ThemeSetting, systemDark: boolean): ShownTheme {
  return shownTheme(setting, systemDark) === "dark" ? "light" : "dark";
}

/**
 * The words for choosing a setting: the switch's accessible name, its
 * tooltip, the palette's rows. Light, dark or the system's is the
 * *appearance*; Quiet, Plate, Desk and the ones people make are *themes*
 * (lib/themes). The two words are never swapped.
 */
export const THEME_ACTION: Record<ThemeSetting, string> = {
  dark: "Switch to dark appearance",
  light: "Switch to light appearance",
  system: "Match my system’s appearance",
};

/** The three choices, in the order every control lists them. */
export const THEME_OPTIONS: ReadonlyArray<{ value: ThemeSetting; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match my system" },
];

/** Whose choice the theme is. A hosted install (with or without accounts) is shared, so the browser keeps it. */
export function themeKeeper(meta: Pick<MetaInfo, "mode"> | null | undefined): ThemeKeeper {
  return meta?.mode === "hosted" ? "browser" : "server";
}

/**
 * What to show once the server's settings arrive (at start, and each time
 * the window comes back into view). Where the server keeps the theme, its
 * setting wins, so a change made in another window shows here. Where the
 * browser keeps it, the server's setting is only the starting point: it
 * applies until this browser's person has chosen, and never after. Null
 * means "leave the theme as it is".
 */
export function themeFromSettings(keeper: ThemeKeeper, saved: ThemeSetting, local: { theme: ThemeSetting; chosen: boolean }): ThemeSetting | null {
  if (keeper === "browser" && local.chosen) return null;
  return saved === local.theme ? null : saved;
}

/** Whether a choice needs a request to the server: only where the server keeps the theme, once signed in, and when it changes what was showing. */
export function savesToServer(keeper: ThemeKeeper, signedIn: boolean, next: ThemeSetting, before: ThemeSetting): boolean {
  return keeper === "server" && signedIn && next !== before;
}

export interface ThemeCommand {
  id: string;
  label: string;
  theme: ThemeSetting;
}

/** The command palette's theme rows: every setting except the one in use, in the switch's order. */
export function themeCommands(setting: ThemeSetting): ThemeCommand[] {
  const order: ThemeSetting[] = ["dark", "light", "system"];
  return order.filter((theme) => theme !== setting).map((theme) => ({ id: `theme-${theme}`, label: THEME_ACTION[theme], theme }));
}

function isThemeSetting(value: unknown): value is ThemeSetting {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * The theme in another window's copy of the `galley.ui` storage, from a
 * `storage` event's new value: how a second window follows a change at
 * once, without asking the server. Null when the value holds no theme.
 */
export function themeFromStorage(raw: string | null): { theme: ThemeSetting; chosen: boolean } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { state?: { theme?: unknown; themeChosen?: unknown } } | null;
    const theme = parsed?.state?.theme;
    if (!isThemeSetting(theme)) return null;
    return { theme, chosen: parsed?.state?.themeChosen === true };
  } catch {
    return null;
  }
}
