/**
 * The redirects screen's data: one overview per site, kept fresh by the
 * events stream (a change to the list or the host's file, a Cloudflare job),
 * and the save that every edit goes through — with Undo, because removing a
 * redirect is one click.
 */
import type { Redirect, RedirectExportFormat, RedirectsOverview } from "@galley/core/redirects-info";
import { api, buildUrl, errorShape } from "@/lib/api";
import { invalidate, setQueryData, useQuery } from "@/lib/query";
import { notify } from "@/lib/stores/toasts";

export const redirectKeys = {
  all: (siteId: string) => ["site", siteId, "redirects"] as const,
  overview: (siteId: string) => ["site", siteId, "redirects", "overview"] as const,
  health: (siteId: string) => ["site", siteId, "redirects", "health"] as const,
};

export function useRedirects(siteId: string) {
  return useQuery(redirectKeys.overview(siteId), () => api("GET /api/sites/:siteId/redirects", { params: { siteId } }));
}

export function useRedirectHealth(siteId: string, enabled: boolean) {
  return useQuery(redirectKeys.health(siteId), () => api("GET /api/sites/:siteId/redirects/health", { params: { siteId } }), { enabled });
}

export function setOverview(siteId: string, overview: RedirectsOverview): void {
  setQueryData(redirectKeys.overview(siteId), overview);
  invalidate(redirectKeys.health(siteId));
}

/** Saves the whole list on top of `base`. Returns the new overview, or null when it couldn't be saved (a toast says why). */
export async function saveList(siteId: string, base: RedirectsOverview, redirects: Redirect[], options: { undo?: { label: string; previous: Redirect[] } } = {}): Promise<RedirectsOverview | null> {
  try {
    const overview = await api("PUT /api/sites/:siteId/redirects", { params: { siteId }, body: { redirects, baseHash: base.hash } });

    setOverview(siteId, overview);
    if (options.undo) {
      const { label, previous } = options.undo;

      notify({
        tone: "success",
        title: label,
        body: "It's waiting in Proof.",
        action: {
          label: "Undo",
          onClick: () => {
            void saveList(siteId, overview, previous).then((restored) => {
              if (restored) notify({ tone: "success", title: "Put back" });
            });
          },
        },
      });
    }
    return overview;
  } catch (error) {
    const shape = errorShape(error);

    notify({ tone: "danger", title: "Couldn’t save the redirects", body: shape.message, detail: shape.detail });
    if (shape.code === "conflict") invalidate(redirectKeys.all(siteId));
    return null;
  }
}

/** The download address for an export (the server sends it as a file). */
export function exportUrl(siteId: string, format: RedirectExportFormat, hostname?: string): string {
  return buildUrl("GET /api/sites/:siteId/redirects/export", { siteId }, { format, ...(hostname ? { hostname } : {}) });
}
