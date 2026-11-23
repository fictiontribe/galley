import { create } from "zustand";
import type { MetaInfo } from "@galley/core/types";
import { api } from "../api";

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
