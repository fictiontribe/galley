import { create } from "zustand";
import type { ChangeSet } from "@galley/core/types";
import { api, errorShape } from "../api";
import { notify } from "./toasts";
import { coalesceBy } from "../coalesce";

interface ChangesStore {
  siteId: string | null;
  changes: ChangeSet | null;
  status: "idle" | "loading" | "ready" | "error";
  error: unknown;
  load: (siteId: string) => Promise<void>;
  /** Fetch again. Calls during a request share one follow-up request, so a burst of events costs two requests, not one each. */
  refresh: () => Promise<void>;
  /** Discard pending changes — all of them when `paths` is absent. */
  discard: (paths?: string[]) => Promise<ChangeSet | null>;
  clear: () => void;
}

/** Bumped whenever the list is set from elsewhere (discard, clear), so an answer already on its way can't overwrite it. */
let ticket = 0;

/** Pending (unpublished) changes of the current site. Refetched on `changes.updated`. */
export const useChanges = create<ChangesStore>((set, get) => {
  // One request in flight per site and at most one queued behind it: the queued one sees every write that came before it.
  const fetchChanges = coalesceBy(async (siteId: string) => {
    const mine = ticket;
    try {
      const changes = await api("GET /api/sites/:siteId/changes", { params: { siteId } });
      if (mine === ticket && get().siteId === siteId) set({ changes, status: "ready", error: undefined });
    } catch (error) {
      if (mine === ticket && get().siteId === siteId) set({ status: get().changes ? "ready" : "error", error });
    }
  });

  return {
    siteId: null,
    changes: null,
    status: "idle",
    error: undefined,
    async load(siteId) {
      if (get().siteId !== siteId) set({ siteId, changes: null, status: "loading" });
      await fetchChanges(siteId);
    },
    async refresh() {
      const { siteId } = get();
      if (siteId) await fetchChanges(siteId);
    },
    async discard(paths) {
      const { siteId } = get();
      if (!siteId) return null;
      ticket++;
      const before = new Set((get().changes?.storeUploads ?? []).filter((item) => item.used).map((item) => item.path));
      const changes = await api("POST /api/sites/:siteId/discard", { params: { siteId }, body: paths ? { paths } : {} });
      set({ changes, status: "ready" });
      // Uploads to the bucket aren't discarded with the pages that used them: offer to remove the ones nothing uses now.
      const orphaned = (changes.storeUploads ?? []).filter((item) => !item.used && before.has(item.path));
      if (orphaned.length) {
        notify({
          tone: "neutral",
          title: orphaned.length === 1 ? `${orphaned[0]!.name} isn’t used any more` : `${orphaned.length} uploads aren’t used any more`,
          body: "They stay in the bucket, public at their addresses, until you remove them.",
          action: {
            label: orphaned.length === 1 ? "Remove it" : "Remove them",
            onClick: () =>
              void api("POST /api/sites/:siteId/media/storage/delete", { params: { siteId }, body: { paths: orphaned.map((item) => item.path) } }).then(
                async (result) => {
                  notify({ tone: "neutral", title: result.deleted.length === 1 ? "Removed from the bucket" : `${result.deleted.length} removed from the bucket` });
                  await get().refresh();
                },
                (error: unknown) => notify({ tone: "danger", title: "Couldn’t remove them", body: errorShape(error).message })
              ),
          },
        });
      }
      return changes;
    },
    clear() {
      ticket++;
      set({ siteId: null, changes: null, status: "idle", error: undefined });
    },
  };
});

/** Number of files with pending changes (0 while loading). */
export function usePendingCount(): number {
  return useChanges((s) => s.changes?.totals.files ?? 0);
}
