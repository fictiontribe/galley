import { create } from "zustand";
import type { SiteSummary } from "@galley/core/types";
import { api } from "../api";
import { coalesce } from "../coalesce";

interface SitesStore {
  sites: SiteSummary[] | null;
  status: "idle" | "loading" | "ready" | "error";
  error: unknown;
  load: () => Promise<void>;
  /** Forget a site. Its files stay on disk. */
  forget: (siteId: string) => Promise<void>;
}

/** Known sites, most recently opened first. Refetched on `sites.updated`. */
export const useSites = create<SitesStore>((set, get) => {
  // Every change event asks for the list again; while one request is out, the rest share a single follow-up.
  const fetchSites = coalesce(async () => {
    if (get().sites === null) set({ status: "loading" });
    try {
      const sites = await api("GET /api/sites");
      sites.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
      set({ sites, status: "ready", error: undefined });
    } catch (error) {
      set({ status: get().sites ? "ready" : "error", error });
    }
  });

  return {
    sites: null,
    status: "idle",
    error: undefined,
    load: () => fetchSites(),
    async forget(siteId) {
      await api("DELETE /api/sites/:siteId", { params: { siteId } });
      set({ sites: (get().sites ?? []).filter((site) => site.id !== siteId) });
    },
  };
});
