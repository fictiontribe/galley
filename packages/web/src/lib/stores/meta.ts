import { create } from "zustand";
import type { MetaInfo } from "@galley/core/types";
import { api } from "../api";
import { hostedInstall, isHostedInstall } from "../hosted";

interface MetaStore {
  meta: MetaInfo | null;
  status: "loading" | "ready" | "error";
  error: unknown;
  load: () => Promise<MetaInfo | null>;
}

/** Product info and the white-label brand, from GET /api/meta. Loaded once at boot. */
export const useMeta = create<MetaStore>((set) => ({
  meta: null,
  status: "loading",
  error: undefined,
  async load() {
    try {
      const meta = await api("GET /api/meta");
      set({ meta, status: "ready", error: undefined });
      return meta;
    } catch (error) {
      set({ status: "error", error });
      return null;
    }
  },
}));

/** Whether the app is a hosted install: one site, no Sites screen (see lib/hosted.ts). */
export function useHostedInstall(): boolean {
  return useMeta((s) => isHostedInstall(s.meta));
}

/** The one site's id on a hosted install, once signed in. */
export function useInstallSiteId(): string | null {
  return useMeta((s) => hostedInstall(s.meta)?.siteId ?? null);
}
