/**
 * The two install routes that aren't JSON both ways: the backup download (a
 * sealed file comes back) and the backup upload (the file is the request
 * body). Errors and the lost-session hand-off are the same as `api()`.
 */
import { useEffect } from "react";
import type { Job } from "@galley/core/types";
import type { RestoreUpload } from "@galley/core/install/types";
import { ApiFailure, api, failureFrom, isApiFailure, setupCodeHeaders } from "@/lib/api";
import { useJob, useJobs } from "@/lib/stores/jobs";
import { backupFileName } from "./logic";

function offline(route: string, error: unknown): ApiFailure {
  return new ApiFailure(route, 0, {
    code: "internal",
    message: "Can’t reach the app’s server. Check that it’s still running, then try again.",
    detail: error instanceof Error ? error.message : String(error),
  });
}

/** Hands the browser a file to save, as a link click would. */
function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  // The click has handed the bytes over; the address can go once the browser has started saving.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** POST /api/install/backup: the sealed file, saved by the browser. Resolves with the file's name. */
export async function downloadBackup(passphrase: string, slug: string): Promise<string> {
  const route = "POST /api/install/backup" as const;
  let response: Response;
  try {
    response = await fetch("/api/install/backup", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/octet-stream" },
      body: JSON.stringify({ passphrase }),
    });
  } catch (error) {
    throw offline(route, error);
  }
  if (!response.ok) throw await failureFrom(route, response);
  const name = backupFileName(response.headers.get("content-disposition"), slug);
  save(await response.blob(), name);
  return name;
}

/** POST /api/install/restore/upload: the backup file as the raw body (with the setup code during first run). */
export async function uploadBackup(file: Blob): Promise<RestoreUpload> {
  const route = "POST /api/install/restore/upload" as const;
  const url = "/api/install/restore/upload";
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/octet-stream", accept: "application/json", ...setupCodeHeaders(url) },
      body: file,
    });
  } catch (error) {
    throw offline(route, error);
  }
  if (!response.ok) throw await failureFrom(route, response);
  return (await response.json()) as RestoreUpload;
}

const POLL_MS = 1000;

/**
 * A job's latest state: from the event stream when it's open, and asked for
 * every second meanwhile — first run starts before there is a session (and
 * so a stream), and a reload mid-way has to pick the job up again.
 * `onLost` runs when the server no longer knows the job (it restarted).
 */
export function useFollowJob(initial: Job | null, onLost?: (failure: ApiFailure) => void): Job | null {
  const jobId = initial?.id ?? null;
  const live = useJob(jobId);
  useEffect(() => {
    if (initial) useJobs.getState().upsert(initial);
  }, [initial]);
  const running = (live ?? initial)?.state === "running";
  useEffect(() => {
    if (!jobId || !running) return;
    let stopped = false;
    const timer = window.setInterval(() => {
      api("GET /api/jobs/:jobId", { params: { jobId } })
        .then((job) => {
          if (!stopped) useJobs.getState().upsert(job);
        })
        .catch((caught: unknown) => {
          if (stopped || !isApiFailure(caught) || caught.offline) return;
          stopped = true;
          window.clearInterval(timer);
          onLost?.(caught);
        });
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
    // onLost is read when it fires; a new function each render mustn't restart the polling.
  }, [jobId, running]);
  return live ?? initial;
}
