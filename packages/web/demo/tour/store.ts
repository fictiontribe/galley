/**
 * Where the visitor is in the walkthrough, kept in sessionStorage so a
 * reload of the tab continues it (Start over clears it with the rest).
 */
import { create } from "zustand";
import type { TourState } from "./steps";

export const TOUR_KEY = "galley.demo.tour";

interface Stored {
  open: boolean;
  state: TourState | null;
  /** A text was retyped on the page and saved (the overlay said so; the server can't tell). */
  pageEdited: boolean;
}

interface TourStore extends Stored {
  setState(state: TourState): void;
  close(): void;
  resume(): void;
  restart(): void;
  markPageEdited(): void;
}

function load(): Stored {
  try {
    const saved = JSON.parse(sessionStorage.getItem(TOUR_KEY) ?? "null") as Stored | null;
    if (saved && typeof saved.open === "boolean") return saved;
  } catch {
    // Nothing kept: a first visit.
  }
  return { open: true, state: null, pageEdited: false };
}

function save(stored: Stored): void {
  try {
    sessionStorage.setItem(TOUR_KEY, JSON.stringify(stored));
  } catch {
    // Storage switched off: the tour still runs, a reload starts it again.
  }
}

export const useTour = create<TourStore>((set, get) => {
  const keep = (patch: Partial<Stored>) => {
    set(patch);
    const { open, state, pageEdited } = get();
    save({ open, state, pageEdited });
  };
  return {
    ...load(),
    setState: (state) => keep({ state }),
    close: () => keep({ open: false }),
    resume: () => keep({ open: true }),
    restart: () => keep({ open: true, state: null }),
    markPageEdited: () => keep({ pageEdited: true }),
  };
});
