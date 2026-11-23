/**
 * Videos being made, remembered across navigation and reloads. A video
 * takes minutes, so the dialog hands the job to this list and can close;
 * the Media screen (and the activity tray) show where each stands, and the
 * finished ones wait here to be saved or discarded. The server keeps the
 * job and its videos; this only remembers which jobs to ask about.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { VideoJobStatus } from "@galley/core/types";
import { api, buildUrl } from "@/lib/api";
import { useQuery } from "@/lib/query";
import { useServerEvent } from "@/lib/events";
import { invalidate } from "@/lib/query";

export interface TrackedVideo {
  jobId: string;
  siteId: string;
  prompt: string;
  startedAt: number;
}

interface VideoJobsStore {
  tracked: TrackedVideo[];
  track: (video: TrackedVideo) => void;
  forget: (jobId: string) => void;
}

export const useVideoJobs = create<VideoJobsStore>()(
  persist(
    (set, get) => ({
      tracked: [],
      track: (video) => set({ tracked: [video, ...get().tracked.filter((item) => item.jobId !== video.jobId)] }),
      forget: (jobId) => set({ tracked: get().tracked.filter((item) => item.jobId !== jobId) }),
    }),
    {
      name: "galley.video-jobs",
      // Candidates last two hours on the server; older entries can't be saved any more.
      merge: (persisted, current) => {
        const stored = (persisted as Partial<VideoJobsStore> | undefined)?.tracked ?? [];
        const fresh = stored.filter((item) => Date.now() - item.startedAt < 3 * 60 * 60 * 1000);
        return { ...current, tracked: fresh };
      },
    },
  ),
);

export const videoJobKey = (jobId: string) => ["videos", "job", jobId] as const;

/** The job and, once done, its videos. Job events keep it current; a finished job is read once more for its videos. */
export function useVideoJob(jobId: string) {
  const status = useQuery<VideoJobStatus>(videoJobKey(jobId), () => api("GET /api/videos/jobs/:jobId", { params: { jobId } }));
  useServerEvent("job", (event) => {
    if (event.job.id === jobId && event.job.state !== "running") invalidate(videoJobKey(jobId));
  });
  return status;
}

/** Bytes of a made video that hasn't been saved yet. */
export function videoCandidateUrl(candidateId: string): string {
  return buildUrl("GET /api/videos/candidates/:candidateId", { candidateId });
}

/** Throw a made video away on the server (it would expire anyway). */
export function discardVideo(candidateId: string): Promise<unknown> {
  return api("DELETE /api/videos/candidates/:candidateId", { params: { candidateId } }).catch(() => undefined);
}
