/**
 * The site kit's set-up, from the screens' side: what the site has of it
 * (GET …/kit, refreshed with the site), and starting "Set it up for me".
 */
import type { SiteKitStatus } from "@galley/core/api";
import type { Job } from "@galley/core/types";
import { api } from "@/lib/api";
import { invalidate, useQuery } from "@/lib/query";
import { useJobs } from "@/lib/stores/jobs";
import { useSite } from "@/lib/stores/site";

/** Under the site's key, so a site.updated event (the setup's last step) refreshes it. */
export const kitKey = (siteId: string) => ["site", siteId, "kit"] as const;

export function useKitStatus(siteId: string) {
  return useQuery(kitKey(siteId), () => api("GET /api/sites/:siteId/kit", { params: { siteId } }), { enabled: siteId !== "" });
}

/**
 * Starts the set-up; its progress arrives as job events, which the jobs
 * store already collects. Its end is followed here, not in the screen that
 * started it: the set-up's last step makes that screen give way to the
 * working Forms (or Scripts) screen, and the result must still be said.
 */
export async function startKitSetup(siteId: string, onEnd: (job: Job) => void, only?: "visibility"): Promise<Job> {
  const job = only === "visibility" ? await api("POST /api/sites/:siteId/kit/visibility", { params: { siteId } }) : await api("POST /api/sites/:siteId/kit/setup", { params: { siteId } });
  useJobs.getState().upsert(job);
  let ended = false;
  const finish = (current: Job) => {
    if (ended || current.state === "running") return;
    ended = true;
    stop();
    void useSite.getState().refresh();
    invalidate(kitKey(siteId));
    onEnd(current);
  };
  const stop = useJobs.subscribe((state) => {
    const current = state.jobs.find((candidate) => candidate.id === job.id);
    if (current) finish(current);
  });
  finish(job);
  return job;
}

/** The steps still to do, and those that set-up can't do. */
export function splitSteps(status: SiteKitStatus) {
  return {
    ready: status.steps.filter((step) => step.state === "ready"),
    left: status.steps.filter((step) => step.state === "left"),
  };
}

/** Points the live site's forms at this app's inbox (a pending change); the server refuses an address visitors can't reach. */
export async function setInboxAddress(siteId: string) {
  const status = await api("POST /api/sites/:siteId/kit/endpoint", { params: { siteId } });
  invalidate(kitKey(siteId));
  return status;
}
