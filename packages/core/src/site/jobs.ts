/**
 * Long-running operations (clone, create, install) as `Job`s: returned
 * immediately, reported through `{ type: "job" }` events, kept for a while
 * after they finish so a page reload can still ask how one ended.
 */
import { randomUUID } from "node:crypto";
import type { EventBus, Job } from "../types";

/** Progress events per job are capped at five a second; git rewrites its progress line constantly. */
export const JOB_EMIT_INTERVAL_MS = 200;
/** Finished jobs stay queryable this long. */
export const JOB_RETENTION_MS = 10 * 60_000;

export interface JobHandle {
  readonly id: string;
  /** Merge progress into the job; emitted at most every JOB_EMIT_INTERVAL_MS. */
  update(patch: Partial<Pick<Job, "progress" | "detail" | "label" | "siteId">>): void;
  /** Finish the job and emit straight away. Later calls are ignored. */
  finish(state: "done" | "error", patch?: Partial<Pick<Job, "progress" | "detail" | "siteId" | "url" | "output">>): void;
  snapshot(): Job;
}

interface Tracked {
  job: Job;
  lastEmit: number;
  timer: NodeJS.Timeout | null;
}

export function createJobTracker(events: EventBus) {
  const jobs = new Map<string, Tracked>();

  const emit = (tracked: Tracked) => {
    if (tracked.timer) clearTimeout(tracked.timer);
    tracked.timer = null;
    tracked.lastEmit = Date.now();
    events.emit({ type: "job", job: { ...tracked.job } });
  };

  const prune = () => {
    const cutoff = Date.now() - JOB_RETENTION_MS;

    for (const [id, tracked] of jobs) if (tracked.job.finishedAt !== undefined && tracked.job.finishedAt < cutoff) jobs.delete(id);
  };

  return {
    start(kind: Job["kind"], label: string): JobHandle {
      prune();
      const tracked: Tracked = { job: { id: randomUUID(), kind, label, state: "running", startedAt: Date.now() }, lastEmit: 0, timer: null };

      jobs.set(tracked.job.id, tracked);
      emit(tracked);
      return {
        id: tracked.job.id,
        update(patch) {
          if (tracked.job.state !== "running") return;
          tracked.job = { ...tracked.job, ...patch };
          const wait = tracked.lastEmit + JOB_EMIT_INTERVAL_MS - Date.now();

          if (wait <= 0) emit(tracked);
          else if (!tracked.timer) {
            // A trailing emit, so the last progress before a quiet spell is still sent.
            tracked.timer = setTimeout(() => emit(tracked), wait);
            tracked.timer.unref?.();
          }
        },
        finish(state, patch = {}) {
          if (tracked.job.state !== "running") return;
          tracked.job = { ...tracked.job, ...patch, state, finishedAt: Date.now() };
          emit(tracked);
        },
        snapshot: () => ({ ...tracked.job }),
      };
    },

    get(id: string): Job | null {
      prune();
      const tracked = jobs.get(id);

      return tracked ? { ...tracked.job } : null;
    },

    dispose() {
      for (const tracked of jobs.values()) if (tracked.timer) clearTimeout(tracked.timer);
    },
  };
}
