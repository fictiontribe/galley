import { create } from "zustand";
import { persist } from "zustand/middleware";

interface Draft {
  siteId: string;
  text: string;
  /** Changes every time, so the same text can be offered twice. */
  nonce: number;
  /** The request needs build mode (finishing a set-up in the site's code): the panel offers to switch. */
  mode?: "build";
}

interface ChatUiStore {
  /** The open conversation per site (remembered on this computer). */
  threadBySite: Record<string, string | null>;
  /** Sites where the person already agreed the assistant may change code. */
  buildConfirmed: Record<string, boolean>;
  /** Text another part of the editor wants in the composer ("Ask the assistant to change it"). */
  draft: Draft | null;
  setThread: (siteId: string, threadId: string | null) => void;
  confirmBuild: (siteId: string) => void;
  offerDraft: (siteId: string, text: string, mode?: "build") => void;
  clearDraft: () => void;
}

let nonce = 0;

/** Assistant state shared by the pane head (chat menu) and the panel. */
export const useChatUi = create<ChatUiStore>()(
  persist(
    (set, get) => ({
      threadBySite: {},
      buildConfirmed: {},
      draft: null,
      setThread: (siteId, threadId) => set({ threadBySite: { ...get().threadBySite, [siteId]: threadId } }),
      confirmBuild: (siteId) => set({ buildConfirmed: { ...get().buildConfirmed, [siteId]: true } }),
      offerDraft: (siteId, text, mode) => set({ draft: { siteId, text, nonce: ++nonce, ...(mode ? { mode } : {}) } }),
      clearDraft: () => set({ draft: null }),
    }),
    { name: "galley.chat", version: 1, partialize: (state) => ({ threadBySite: state.threadBySite, buildConfirmed: state.buildConfirmed }) },
  ),
);
