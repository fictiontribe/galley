/**
 * The data behind "Host the editor online": the site's editor status (under
 * the site's key, so `site.updated` refreshes it), the hosts, the newest
 * editor job, and the one switch every entry point uses to open the guided
 * flow. Local mode only — callers check `useHostedInstall()` before any of
 * this runs, because a hosted server answers these routes with "not here".
 */
import { create } from "zustand";
import type { Job } from "@galley/core/types";
import { api, errorShape } from "@/lib/api";
import { useServerEvent } from "@/lib/events";
import { invalidate, useQuery } from "@/lib/query";
import { useJobs } from "@/lib/stores/jobs";
import { notify } from "@/lib/stores/toasts";
import { keys } from "@/lib/sync";

interface HostingUi {
  /** The site whose guided flow should be open. */
  openFor: string | null;
  open: (siteId: string) => void;
  close: () => void;
}

/** Any button (the Online screen, the command palette, a new site's last screen) opens the flow with `open(siteId)`. */
export const useEditorHostingUi = create<HostingUi>((set) => ({
  openFor: null,
  open: (siteId) => set({ openFor: siteId }),
  close: () => set({ openFor: null }),
}));

export function useEditorStatus(siteId: string) {
  const query = useQuery(keys.editor(siteId), () => api("GET /api/sites/:siteId/editor", { params: { siteId } }));
  // A create, upgrade or removal that finishes changes what there is to show.
  useServerEvent("job", (event) => {
    if (event.job.kind === "editor-host" && event.job.siteId === siteId && event.job.state !== "running") invalidate(keys.editor(siteId));
  });
  return query;
}

export function useEditorHosts(enabled = true) {
  return useQuery(keys.editorHosts(), () => api("GET /api/editor-hosts"), { enabled });
}

/** The newest editor job this browser has heard of for a site. */
export function useLatestEditorJob(siteId: string): Job | null {
  return useJobs((s) => {
    let latest: Job | null = null;
    for (const job of s.jobs) if (job.kind === "editor-host" && job.siteId === siteId && (!latest || job.startedAt >= latest.startedAt)) latest = job;
    return latest;
  });
}

/**
 * Open a new tab inside the click (so it isn't taken for a pop-up), then send
 * it where `address` says once that is known. The address goes straight to
 * the tab: it is never put on the page, kept, or logged — a setup link opens
 * the install it belongs to.
 */
export function openInNewTab(address: () => Promise<string | null>, failure: { title: string }): void {
  const tab = window.open("", "_blank");
  if (!tab) {
    notify({ tone: "warning", title: "Couldn’t open a new tab", body: "The browser blocked it. Allow pop-ups for this app, then try again." });
    return;
  }
  tab.opener = null;
  address().then(
    (url) => (url ? tab.location.replace(url) : tab.close()),
    (caught: unknown) => {
      tab.close();
      const shape = errorShape(caught);
      notify({ tone: "danger", title: failure.title, body: shape.message, ...(shape.detail ? { detail: shape.detail } : {}) });
    },
  );
}

/** The install's first-run link, asked for at the moment of the click and opened in a new tab. */
export function openFirstRun(siteId: string): void {
  openInNewTab(async () => (await api("POST /api/sites/:siteId/editor/setup-link", { params: { siteId } })).url, { title: "Couldn’t open first run" });
}

/** Start an upgrade or removal; the job goes into the store at once so its progress shows before the first event. */
export function track(job: Job): Job {
  useJobs.getState().upsert(job);
  return job;
}

/** Remove the hosted editor. Nothing is removed without the yes the route's body carries. */
export async function removeEditor(siteId: string): Promise<Job> {
  return track(await api("DELETE /api/sites/:siteId/editor", { params: { siteId }, body: { confirm: true } }));
}
