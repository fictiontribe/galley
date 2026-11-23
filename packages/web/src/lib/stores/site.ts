import { create } from "zustand";
import type { SiteDetail } from "@galley/core/types";
import { api } from "../api";
import { usePreview } from "./preview";

interface SiteStore {
  siteId: string | null;
  detail: SiteDetail | null;
  status: "idle" | "loading" | "ready" | "error";
  error: unknown;
  /** Make `siteId` the current site, loading it when it isn't already. */
  open: (siteId: string) => Promise<void>;
  /** Refetch the current site (after `site.updated`). */
  refresh: () => Promise<void>;
  close: () => void;
}

let ticket = 0;

/** The site being worked on: its detail and model. */
export const useSite = create<SiteStore>((set, get) => {
  async function fetchDetail(siteId: string): Promise<void> {
    const mine = ++ticket;
    try {
      const detail = await api("GET /api/sites/:siteId", { params: { siteId } });
      if (mine !== ticket) return;
      usePreview.getState().set(siteId, detail.preview);
      set({ detail, status: "ready", error: undefined });
    } catch (error) {
      if (mine !== ticket) return;
      set({ status: get().detail ? "ready" : "error", error });
    }
  }

  return {
    siteId: null,
    detail: null,
    status: "idle",
    error: undefined,
    async open(siteId) {
      if (get().siteId === siteId && get().status !== "error") return;
      set({ siteId, detail: null, status: "loading", error: undefined });
      await fetchDetail(siteId);
    },
    async refresh() {
      const { siteId } = get();
      if (siteId) await fetchDetail(siteId);
    },
    close() {
      ticket++;
      set({ siteId: null, detail: null, status: "idle", error: undefined });
    },
  };
});
