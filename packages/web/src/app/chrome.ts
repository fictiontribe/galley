/**
 * Shared state of the app chrome: what the top bar shows, and the global
 * dialogs any screen may open (the command palette, the publish flow).
 */
import { useLayoutEffect } from "react";
import { create } from "zustand";
import type { BadgeTone } from "@/ui";

export interface TopBarCrumb {
  label: string;
  to?: string;
}

export interface TopBarTag {
  label: string;
  tone: BadgeTone;
}

export interface TopBarConfig {
  crumbs: TopBarCrumb[];
  /** Contextual status beside the breadcrumbs, e.g. "Edited". */
  tag?: TopBarTag;
}

interface ChromeStore {
  topBar: TopBarConfig;
  paletteOpen: boolean;
  publishOpen: boolean;
  discardOpen: boolean;
  setTopBar: (config: TopBarConfig) => void;
  setPaletteOpen: (open: boolean) => void;
  /** Open the publish flow for the current site (top bar, palette, Proof, chat). */
  setPublishOpen: (open: boolean) => void;
  /** Open the "Discard all changes?" confirmation. */
  setDiscardOpen: (open: boolean) => void;
}

export const useChrome = create<ChromeStore>((set) => ({
  topBar: { crumbs: [] },
  paletteOpen: false,
  publishOpen: false,
  discardOpen: false,
  setTopBar: (topBar) => set({ topBar }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setPublishOpen: (publishOpen) => set({ publishOpen }),
  setDiscardOpen: (discardOpen) => set({ discardOpen }),
}));

/**
 * Set the top bar's breadcrumbs and status tag for the current screen. The
 * last crumb also becomes the document title.
 */
export function useTopBar(config: TopBarConfig): void {
  const signature = JSON.stringify(config);
  useLayoutEffect(() => {
    useChrome.getState().setTopBar(JSON.parse(signature) as TopBarConfig);
  }, [signature]);
}
