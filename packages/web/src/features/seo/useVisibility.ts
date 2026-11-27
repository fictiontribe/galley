import { useCallback, useEffect, useRef, useState } from "react";
import type { Finding } from "@galley/core/seo/types";
import { api } from "@/lib/api";
import { useServerEvent } from "@/lib/events";
import { useQuery } from "@/lib/query";
import { notify } from "@/lib/stores/toasts";
import { count } from "./logic";
import { useWhoPublishes } from "@/lib/may";

export const visibilityKeys = {
  site: (siteId: string) => ["site", siteId, "visibility"] as const,
  entry: (siteId: string, path: string) => ["site", siteId, "visibility", "entry", path] as const,
  crawlers: (siteId: string) => ["site", siteId, "visibility", "crawlers"] as const,
  intelligence: (siteId: string) => ["site", siteId, "visibility", "intelligence"] as const,
};

/** Refetch after the site's content changes, once things have settled. */
export function useRefetchOnChange(siteId: string, refetch: () => unknown, delay = 900): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useServerEvent("changes.updated", (event) => {
    if (event.siteId !== siteId) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void refetch(), delay);
  });
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
}

export function useSiteAudit(siteId: string) {
  const query = useQuery(visibilityKeys.site(siteId), () => api("GET /api/sites/:siteId/visibility", { params: { siteId }, query: {} }), { enabled: Boolean(siteId) });

  useRefetchOnChange(siteId, query.refetch);
  return query;
}

export function useSearchIntelligence(siteId: string) {
  return useQuery(visibilityKeys.intelligence(siteId), () => api("GET /api/sites/:siteId/visibility/intelligence", { params: { siteId } }), {
    enabled: Boolean(siteId),
  });
}

/** Applies findings' fixes as ordinary edits, with an Undo in the toast. */
export function useFixes(siteId: string, after: () => unknown) {
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const publishes = useWhoPublishes();

  const fix = useCallback(
    async (findings: Finding[]) => {
      const ids = findings.map((item) => item.id);

      setBusy(new Set(ids));
      try {
        const result = await api("POST /api/sites/:siteId/visibility/fix", { params: { siteId }, body: { ids } });
        const applied = result.applied.length;

        if (applied) {
          notify({
            tone: "success",
            title: applied === 1 ? "Fixed" : `${count(applied, "fix", "fixes")} made`,
            body: `${applied === 1 ? "The change is" : "The changes are"} waiting in Proof. Nothing is live until ${publishes}.`,
            // Like the app's other Undo notices: it leaves by itself (held while pointed at), rather than staying over the panels until closed.
            duration: 10000,
            ...(result.undoId
              ? {
                  action: {
                    label: "Undo",
                    onClick: () => {
                      void api("POST /api/sites/:siteId/visibility/undo", { params: { siteId }, body: { undoId: result.undoId! } }).then((undone) => {
                        // A page changed again since the fix isn't put back whole: say so, rather than let "Undo" read as done.
                        if (undone.left.length) {
                          const one = undone.left.length === 1;
                          notify({
                            tone: "warning",
                            title: one ? "1 page was left as it is" : `${count(undone.left.length, "page")} were left as they are`,
                            body: `${one ? "It was" : "They were"} changed again after the fix, so the fix is still there. Check ${one ? "it" : "them"} in Proof.`,
                          });
                        }
                        return after();
                      });
                    },
                  },
                }
              : {}),
          });
        }
        if (result.refused.length) notify({ tone: "warning", title: result.refused.length === 1 ? "One couldn't be fixed" : `${result.refused.length} couldn't be fixed`, body: result.refused[0]!.reason });
        await after();
      } catch (error) {
        notify({ tone: "danger", title: "Couldn't make the fix", body: error instanceof Error ? error.message : String(error) });
      } finally {
        setBusy(new Set());
      }
    },
    [siteId, after, publishes],
  );
  return { fix, busy };
}
