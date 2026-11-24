import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AppliedTheme, ThemeFile } from "@galley/core/themes";

/** Where "Save for me" keeps themes on a hosted install: this browser only. */
export const MY_THEMES_KEY = "galley.themes";
/** This browser's copy of the theme last shown, read by public/theme.js before the first paint. */
export const LOOK_COPY_KEY = "galley.look";
/** At most this many themes saved for me, so a browser's storage stays small. */
export const MAX_MY_THEMES = 30;

interface MyThemesStore {
  mine: ThemeFile[];
  saveMine: (theme: ThemeFile) => void;
  removeMine: (id: string) => void;
}

/** Themes saved for me only (a hosted install): a few hundred bytes each, in this browser. */
export const useMyThemes = create<MyThemesStore>()(
  persist(
    (set, get) => ({
      mine: [],
      saveMine: (theme) => set({ mine: [theme, ...get().mine.filter((other) => other.id !== theme.id)].slice(0, MAX_MY_THEMES) }),
      removeMine: (id) => set({ mine: get().mine.filter((theme) => theme.id !== id) }),
    }),
    { name: MY_THEMES_KEY, version: 1 },
  ),
);

interface ThemeEditStore {
  /** The theme being edited, shown in this browser until it is saved or left. */
  preview: AppliedTheme | null;
  setPreview: (preview: AppliedTheme | null) => void;
}

export const useThemeEdit = create<ThemeEditStore>((set) => ({
  preview: null,
  setPreview: (preview) => set({ preview }),
}));
