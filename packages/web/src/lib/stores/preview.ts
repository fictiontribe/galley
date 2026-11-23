import { create } from "zustand";
import type { PreviewStatus } from "@galley/core/types";
import { api } from "../api";

type PreviewAction = "start" | "stop" | "restart";

interface PreviewStore {
  bySite: Record<string, PreviewStatus>;
  /** A start/stop/restart request is in flight for the site. */
  pending: Record<string, PreviewAction | undefined>;
  set: (siteId: string, status: PreviewStatus) => void;
  run: (siteId: string, action: PreviewAction) => Promise<void>;
}

const ROUTES = {
  start: "POST /api/sites/:siteId/preview/start",
  stop: "POST /api/sites/:siteId/preview/stop",
  restart: "POST /api/sites/:siteId/preview/restart",
} as const;

/** Each site's preview (dev server) status, from `preview.status` events. */
export const usePreview = create<PreviewStore>((set, get) => ({
  bySite: {},
  pending: {},
  set(siteId, status) {
    set({ bySite: { ...get().bySite, [siteId]: status } });
  },
  async run(siteId, action) {
    set({ pending: { ...get().pending, [siteId]: action } });
    try {
      const status = await api(ROUTES[action], { params: { siteId } });
      get().set(siteId, status);
    } finally {
      set({ pending: { ...get().pending, [siteId]: undefined } });
    }
  },
}));

export function usePreviewStatus(siteId: string | null | undefined): PreviewStatus | null {
  return usePreview((s) => (siteId ? (s.bySite[siteId] ?? null) : null));
}
