import { useEffect } from "react";
import { create } from "zustand";
import type { Job } from "@galley/core/types";

interface JobsStore {
  jobs: Job[];
  /** Ids the person closed in the activity tray. */
  dismissed: string[];
  /** Ids a dialog or screen is showing progress for right now; the tray leaves them out. */
  shown: string[];
  upsert: (job: Job) => void;
  dismiss: (jobId: string) => void;
  setShown: (jobId: string, shown: boolean) => void;
}

/** Long-running work — cloning, creating, installing — from `job` events. */
export const useJobs = create<JobsStore>((set, get) => ({
  jobs: [],
  dismissed: [],
  shown: [],
  upsert(job) {
    const jobs = get().jobs.filter((existing) => existing.id !== job.id);
    set({ jobs: [...jobs, job].sort((a, b) => a.startedAt - b.startedAt) });
  },
  dismiss(jobId) {
    set({ dismissed: [...get().dismissed, jobId] });
  },
  setShown(jobId, shown) {
    const rest = get().shown.filter((id) => id !== jobId);
    set({ shown: shown ? [...rest, jobId] : rest });
  },
}));

/** While mounted (and `when` holds), this job's progress is on screen here, so the tray doesn't repeat it. */
export function useShowingJob(jobId: string | null, when = true): void {
  useEffect(() => {
    if (!jobId || !when) return;
    useJobs.getState().setShown(jobId, true);
    return () => useJobs.getState().setShown(jobId, false);
  }, [jobId, when]);
}

export function useJob(jobId: string | null): Job | null {
  return useJobs((s) => (jobId ? (s.jobs.find((job) => job.id === jobId) ?? null) : null));
}
