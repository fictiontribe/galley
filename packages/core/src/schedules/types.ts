/**
 * Scheduled publishing domain contract shared by @galley/core, @galley/server,
 * @galley/cli, and @galley/web. Kept free of Node/DOM imports.
 */

export type ScheduledReleaseState = "scheduled" | "publishing" | "published" | "failed" | "cancelled";

export interface ScheduledFileSnapshot {
  path: string;
  status: "added" | "modified" | "deleted";
  summary?: string;
  /** Base64 file bytes to write when publishing (omitted when status === "deleted"). */
  contentBase64?: string;
}

export interface ScheduledRelease {
  id: string;
  siteId: string;
  createdAt: string;
  /** ISO-8601 UTC timestamp when this release should publish. */
  scheduledAt: string;
  /** Optional IANA timezone used when scheduling (e.g. "America/Los_Angeles"). */
  timezone?: string;
  message: string;
  author: { name: string; email: string };
  deployAfterPublish: boolean;
  state: ScheduledReleaseState;
  files: ScheduledFileSnapshot[];
  publishedAt?: string;
  commit?: string;
  deployUrl?: string;
  error?: string;
}

export interface CreateScheduleInput {
  message?: string;
  /** Paths from Proof to include. Omit to schedule every pending file. */
  paths?: string[];
  /** Target publish time (ISO-8601 date-time string, must be in the future). */
  scheduledAt: string;
  timezone?: string;
  deployAfterPublish?: boolean;
  /** Restore scheduled files in the working tree back to HEAD so editors can keep publishing other changes. Default true. */
  holdOutOfWorkingTree?: boolean;
}

export interface UpdateScheduleInput {
  scheduledAt?: string;
  timezone?: string;
  message?: string;
  deployAfterPublish?: boolean;
}

export interface CancelScheduleInput {
  /** Write the sealed files back into the working tree so they reappear in Proof. Default true. */
  restoreToProof?: boolean;
}

export interface ScheduleWorkflowResult {
  path: string;
  cron: string;
  created: boolean;
}
