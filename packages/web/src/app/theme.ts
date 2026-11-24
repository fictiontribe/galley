/**
 * Choosing the theme and keeping it in step, for every control that offers
 * it (the switch in the frame, the command palette, App settings, Your
 * account). The decisions are lib/theme.ts; this is where they meet the
 * store, the server and the other windows.
 */
import { useEffect, useState } from "react";
import type { Settings } from "@galley/core/types";
import { api, errorShape } from "@/lib/api";
import { setQueryData } from "@/lib/query";
import { useMeta } from "@/lib/stores/meta";
import { notify } from "@/lib/stores/toasts";
import { useUi } from "@/lib/stores/ui";
import { keys } from "@/lib/sync";
import { oneClickTheme, savesToServer, themeFromSettings, themeFromStorage, themeKeeper, type ThemeSetting } from "@/lib/theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function systemIsDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
}

/** Whether the computer is set to dark, following a change made while the app is open. */
export function useSystemDark(): boolean {
  const [dark, setDark] = useState(systemIsDark);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => setDark(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return dark;
}

// Saves go one after another, and a choice overtaken by a newer one is not
// sent at all: the server ends up holding the last thing the person chose,
// however fast they click.
let saving: Promise<void> = Promise.resolve();
let latest = 0;

/**
 * The person chose a theme. It shows at once; where the server keeps the
 * theme (local mode, the desktop app) it is saved there too, so every window
 * agrees, and put back if the server refuses. On a hosted install it stays
 * in this browser and nothing is sent, so it is anyone's to change,
 * Contributors included.
 */
export function chooseTheme(next: ThemeSetting): void {
  const ui = useUi.getState();
  const before = ui.theme;
  ui.setTheme(next);
  const meta = useMeta.getState().meta;
  const keeper = themeKeeper(meta);
  const ticket = ++latest;
  saving = saving.then(async () => {
    if (ticket !== latest) return;
    // Compared with what was showing, not with this window's copy of the
    // settings: another window may have changed the theme since that copy
    // was read, and then the server holds something else.
    if (!savesToServer(keeper, Boolean(meta?.authenticated), next, before)) return;
    try {
      const settings = await api("PATCH /api/settings", { body: { appearance: { theme: next } } });
      setQueryData(keys.settings(), settings);
    } catch (caught) {
      // Only undo what is still showing: a later choice has its own save.
      if (ticket === latest && useUi.getState().theme === next) useUi.getState().followTheme(before);
      notify({ tone: "danger", title: "Couldn’t save the theme", body: errorShape(caught).message });
    }
  });
}

/** One click on the switch: the opposite of what is showing. */
export function switchTheme(): void {
  chooseTheme(oneClickTheme(useUi.getState().theme, systemIsDark()));
}

/** The server's settings arrived: show their theme where it is the one to follow (lib/theme.ts `themeFromSettings`). */
export function followSettingsTheme(settings: Settings): void {
  const ui = useUi.getState();
  const next = themeFromSettings(themeKeeper(useMeta.getState().meta), settings.appearance.theme, { theme: ui.theme, chosen: ui.themeChosen });
  if (next) ui.followTheme(next);
}

/**
 * Another window of this app, in this browser, changed the theme: show the
 * same here at once. The windows share one copy of the preferences, so this
 * needs no request (and makes none). A change made in another browser shows
 * when this window comes back into view (BrandEffects asks the server then).
 */
export function useThemeFromOtherWindows(storageKey: string): void {
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      const other = themeFromStorage(event.newValue);
      if (!other) return;
      const ui = useUi.getState();
      if (other.theme !== ui.theme || other.chosen !== ui.themeChosen) useUi.setState({ theme: other.theme, themeChosen: other.chosen });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storageKey]);
}

/**
 * Printing is on paper whatever the theme: the browser leaves backgrounds
 * out, so a dark theme's pale ink would print nearly invisible. The light
 * theme is put on just for the print and taken off after.
 */
export function usePrintOnPaper(): void {
  useEffect(() => {
    const root = document.documentElement;
    const before = () => {
      root.dataset.theme = "light";
    };
    const after = () => {
      root.dataset.theme = useUi.getState().theme;
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);
}
