import { create } from "zustand";
import { persist } from "zustand/middleware";
import { parseTheme, type AppliedTheme, type ThemeFile } from "@galley/core/themes";

/** Where "Save for me" keeps themes on a hosted install: this browser only. */
export const MY_THEMES_KEY = "galley.themes";
/** This browser's copy of the theme its person chose, read by public/theme.js before the first paint. */
export const LOOK_COPY_KEY = "galley.look";
/** At most this many themes saved for me, so a browser's storage stays small. */
export const MAX_MY_THEMES = 30;

interface MyThemesStore {
  mine: ThemeFile[];
  /** Whose themes these are (a hosted account's id); another person signing in on this browser never sees them. */
  account: string | null;
  saveMine: (theme: ThemeFile) => void;
  removeMine: (id: string) => void;
  /** The person signed in now: themes kept for someone else are forgotten. */
  adopt: (account: string | null) => void;
  /** Signing out: nothing of this person's stays for the next one. */
  forget: () => void;
}

/** What was stored, read back only as far as it is themes: anything else (a corrupt or hand-edited value) is dropped, never rendered. */
export function sanitizeMine(stored: unknown): { mine: ThemeFile[]; account: string | null } {
  const value = typeof stored === "object" && stored !== null ? (stored as { mine?: unknown; account?: unknown }) : {};
  const mine = Array.isArray(value.mine)
    ? value.mine
        .slice(0, MAX_MY_THEMES)
        .map((theme) => parseTheme(theme))
        .filter((parsed) => parsed.ok)
        .map((parsed) => (parsed as { ok: true; theme: ThemeFile }).theme)
    : [];
  const account = typeof value.account === "string" && value.account.length <= 200 ? value.account : null;
  return { mine, account };
}

/** Themes saved for me only (a hosted install): a few hundred bytes each, in this browser, for one account. */
export const useMyThemes = create<MyThemesStore>()(
  persist(
    (set, get) => ({
      mine: [],
      account: null,
      saveMine: (theme) => set({ mine: [theme, ...get().mine.filter((other) => other.id !== theme.id)].slice(0, MAX_MY_THEMES) }),
      removeMine: (id) => set({ mine: get().mine.filter((theme) => theme.id !== id) }),
      adopt: (account) => {
        const current = get();
        if (current.account === account) return;
        // Another person's themes (or ones kept before accounts were known) aren't this person's.
        set(current.account !== null && account !== null ? { account, mine: [] } : { account });
      },
      forget: () => set({ mine: [], account: null }),
    }),
    {
      name: MY_THEMES_KEY,
      version: 2,
      merge: (persisted, current) => ({ ...current, ...sanitizeMine(persisted) }),
      migrate: (persisted) => sanitizeMine(persisted) as unknown as MyThemesStore,
    },
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

/**
 * Signing out on a shared browser: the next person gets none of this
 * person's themes, their chosen theme, or the copy the start-up script reads.
 */
export function forgetPersonalThemes(): void {
  useMyThemes.getState().forget();
  try {
    localStorage.removeItem(LOOK_COPY_KEY);
  } catch {
    // Storage off: there is nothing to forget.
  }
}
