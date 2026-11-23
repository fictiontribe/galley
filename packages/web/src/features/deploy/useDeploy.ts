/**
 * The deploy feature's data: the site's deploy status (cached under the
 * site's key, so `site.updated` refreshes it), the live job from `job`
 * events, and the one global "open the setup" switch every entry point uses.
 */
import { create } from "zustand";
import type { DeployKind, Job } from "@galley/core/types";
import { api } from "@/lib/api";
import { useServerEvent } from "@/lib/events";
import { invalidate, setQueryData, useQuery } from "@/lib/query";
import { useJobs } from "@/lib/stores/jobs";
import { currentJob, type SetupIntent } from "./logic";

export const deployKeys = {
  status: (siteId: string) => ["site", siteId, "deploy"] as const,
  deployments: (siteId: string) => ["site", siteId, "deployments"] as const,
  targets: () => ["deploy", "targets"] as const,
};

interface DeployUi {
  setup: { open: boolean; intent: SetupIntent };
  share: boolean;
  openSetup: (intent?: SetupIntent) => void;
  closeSetup: () => void;
  setShare: (open: boolean) => void;
}

/** One setup dialog and one share dialog per site frame; any button can open them. */
export const useDeployUi = create<DeployUi>((set) => ({
  setup: { open: false, intent: "production" },
  share: false,
  openSetup: (intent = "production") => set({ setup: { open: true, intent } }),
  closeSetup: () => set((state) => ({ setup: { ...state.setup, open: false } })),
  setShare: (share) => set({ share }),
}));

/** The newest deploy job this browser has heard about for a site. */
export function useLatestDeployJob(siteId: string): Job | null {
  return useJobs((s) => {
    let latest: Job | null = null;
    for (const job of s.jobs) if (job.kind === "deploy" && job.siteId === siteId && (!latest || job.startedAt >= latest.startedAt)) latest = job;
    return latest;
  });
}

export function useDeployStatus(siteId: string) {
  const query = useQuery(deployKeys.status(siteId), () => api("GET /api/sites/:siteId/deploy", { params: { siteId } }));
  const live = useLatestDeployJob(siteId);

  // A deploy that finishes changes the status (a new deployment, a new address): read it again.
  useServerEvent("job", (event) => {
    if (event.job.kind !== "deploy" || event.job.siteId !== siteId || event.job.state === "running") return;
    invalidate(deployKeys.status(siteId));
    invalidate(deployKeys.deployments(siteId));
  });
  // The status carries the job too, so a reload mid-deploy still shows its progress.
  const fromStatus = query.data?.job ?? null;
  const job = currentJob(query.data, live && (!fromStatus || live.startedAt >= fromStatus.startedAt) ? live : fromStatus);

  return { ...query, job };
}

export function useDeployTargets() {
  return useQuery(deployKeys.targets(), async () => (await api("GET /api/deploy/targets")).targets);
}

/** Start a deploy; the job is put in the jobs store at once so progress shows before the first event. */
export async function startDeploy(siteId: string, kind: DeployKind, label?: string): Promise<Job> {
  const job = await api("POST /api/sites/:siteId/deploy", { params: { siteId }, body: { kind, ...(label ? { label } : {}) } });
  useJobs.getState().upsert(job);
  return job;
}

export async function setAutoDeploy(siteId: string, autoDeploy: boolean): Promise<void> {
  setQueryData(deployKeys.status(siteId), await api("PUT /api/sites/:siteId/deploy", { params: { siteId }, body: { autoDeploy } }));
}

export async function applyLiveAddress(siteId: string): Promise<void> {
  setQueryData(deployKeys.status(siteId), await api("POST /api/sites/:siteId/deploy/live-address", { params: { siteId } }));
  invalidate(["site", siteId, "config"]);
}
