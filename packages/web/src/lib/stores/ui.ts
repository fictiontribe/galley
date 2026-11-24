import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ThemeSetting } from "../theme";

export type { ThemeSetting } from "../theme";
export type PreviewMode = "proposed" | "live" | "split";

/** Where these preferences are kept; public/theme.js reads the theme from it before the app paints. */
export const UI_STORAGE_KEY = "galley.ui";

interface UiStore {
  theme: ThemeSetting;
  /**
   * The person chose the theme in this browser. On a hosted install that
   * makes it theirs: the install's own setting no longer replaces it (see
   * lib/theme.ts). Local mode keeps the theme in the server's settings and
   * ignores this.
   */
  themeChosen: boolean;
  /**
   * The theme (Quiet, Plate, Desk or another, by id) this browser shows.
   * In local mode and the desktop app a copy of the server's default (App
   * settings); on a hosted install the person's own once `lookChosen`
   * (lib/themes/choice.ts). Null: the install's default.
   */
  look: string | null;
  lookChosen: boolean;
  /** Sidebar shows icons only. Forced below 1024 px by CSS regardless. */
  sidebarCollapsed: boolean;
  /** Pixel widths of fixed panes, keyed "splitId.paneId". */
  paneSizes: Record<string, number>;
  /** Collapsed panes, keyed "splitId.paneId". */
  collapsed: Record<string, boolean>;
  previewMode: PreviewMode;
  /** The person chose a theme. */
  setTheme: (theme: ThemeSetting) => void;
  /** Show the theme the server's settings hold, without making it this browser's own choice. */
  followTheme: (theme: ThemeSetting) => void;
  /** The person chose a theme (null: go back to the install's default). */
  setLook: (look: string | null) => void;
  /** Show the install's default theme without making it this browser's own choice. */
  followLook: (look: string | null) => void;
  toggleSidebar: () => void;
  setPaneSize: (key: string, size: number) => void;
  setCollapsed: (key: string, collapsed: boolean) => void;
  setPreviewMode: (mode: PreviewMode) => void;
}

/** Local preferences, persisted to localStorage so the app opens the way it was left. */
export const useUi = create<UiStore>()(
  persist(
    (set, get) => ({
      theme: "system",
      themeChosen: false,
      look: null,
      lookChosen: false,
      sidebarCollapsed: false,
      paneSizes: {},
      collapsed: {},
      previewMode: "proposed",
      setTheme: (theme) => set({ theme, themeChosen: true }),
      followTheme: (theme) => set({ theme }),
      setLook: (look) => set({ look, lookChosen: look !== null }),
      followLook: (look) => set({ look }),
      toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
      setPaneSize: (key, size) => set({ paneSizes: { ...get().paneSizes, [key]: Math.round(size) } }),
      setCollapsed: (key, collapsed) => set({ collapsed: { ...get().collapsed, [key]: collapsed } }),
      setPreviewMode: (previewMode) => set({ previewMode }),
    }),
    {
      name: UI_STORAGE_KEY,
      version: 2,
      // Version 1 had no record of a choice. A theme other than the default
      // was somebody's choice (or the server's, which is the same thing to
      // the person), so it stays; the default keeps following the install.
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<UiStore>;
        if (version < 2) return { ...state, themeChosen: state.theme !== undefined && state.theme !== "system" } as UiStore;
        return state as UiStore;
      },
    },
  ),
);
