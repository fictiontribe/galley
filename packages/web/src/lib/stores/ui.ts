import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeSetting = "system" | "light" | "dark";
export type PreviewMode = "proposed" | "live" | "split";

interface UiStore {
  theme: ThemeSetting;
  /** Sidebar shows icons only. Forced below 1024 px by CSS regardless. */
  sidebarCollapsed: boolean;
  /** Pixel widths of fixed panes, keyed "splitId.paneId". */
  paneSizes: Record<string, number>;
  /** Collapsed panes, keyed "splitId.paneId". */
  collapsed: Record<string, boolean>;
  previewMode: PreviewMode;
  setTheme: (theme: ThemeSetting) => void;
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
      sidebarCollapsed: false,
      paneSizes: {},
      collapsed: {},
      previewMode: "proposed",
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
      setPaneSize: (key, size) => set({ paneSizes: { ...get().paneSizes, [key]: Math.round(size) } }),
      setCollapsed: (key, collapsed) => set({ collapsed: { ...get().collapsed, [key]: collapsed } }),
      setPreviewMode: (previewMode) => set({ previewMode }),
    }),
    { name: "galley.ui", version: 1 },
  ),
);
