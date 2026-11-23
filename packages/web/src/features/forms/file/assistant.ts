/**
 * The assistant beside a builder screen: whether it is connected, and the
 * open/close state of its panel, with the request to send when it opens.
 */
import { create } from "zustand";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/query";
import { useSite } from "@/lib/stores/site";
import { keys } from "@/lib/sync";

export interface AssistantRequest {
  /** Sent as soon as the panel opens… */
  send?: string;
  /** …or put in the box for the person to finish and send (e.g. when build mode must be chosen first). */
  draft?: string;
  /** The draft needs build mode: the panel switches to it (asking first, the first time). */
  mode?: "build";
  nonce: number;
}

interface AssistantPanelStore {
  open: boolean;
  request: AssistantRequest | null;
  show: (request?: Omit<AssistantRequest, "nonce">) => void;
  hide: () => void;
}

let nonce = 0;

export const useAssistantPanel = create<AssistantPanelStore>((set) => ({
  open: false,
  request: null,
  show: (request) => set({ open: true, request: request ? { ...request, nonce: ++nonce } : null }),
  hide: () => set({ open: false, request: null }),
}));

/** true / false once settings are known; null while loading. */
export function useAssistantReady(): boolean | null {
  const settings = useQuery(keys.settings(), () => api("GET /api/settings"));
  if (!settings.data) return null;
  return settings.data.secrets.some((secret) => secret.name === "anthropic" && secret.configured);
}

export function useAllowBuild(): boolean {
  return useSite((s) => s.detail?.model.ai.allowBuild ?? false);
}
