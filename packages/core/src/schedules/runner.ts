/**
 * Scheduled publishing engine: seals chosen Proof changes into immutable
 * scheduled releases, holds them out of the working tree so editors can keep
 * publishing immediate edits, restores them cleanly on cancel, and publishes
 * due releases (even alongside unrelated dirty files in Proof).
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { GalleyError } from "../errors";
import type { EventBus, SettingsService, SiteRegistry, SiteService } from "../types";
import { normalizeFutureSchedule } from "./dates";
import { createScheduleStore, type ScheduleStore } from "./store";
import type {
  CancelScheduleInput,
  CreateScheduleInput,
  ScheduledFileSnapshot,
  ScheduledRelease,
  ScheduleWorkflowResult,
  UpdateScheduleInput,
} from "./types";
import { setupScheduleWorkflow } from "./workflow";

export interface ScheduleService {
  list(site: SiteService): Promise<ScheduledRelease[]>;
  create(site: SiteService, input: CreateScheduleInput): Promise<ScheduledRelease>;
  update(site: SiteService, scheduleId: string, input: UpdateScheduleInput): Promise<ScheduledRelease>;
  cancel(site: SiteService, scheduleId: string, input?: CancelScheduleInput): Promise<ScheduledRelease>;
  runNow(site: SiteService, scheduleId: string): Promise<ScheduledRelease>;
  runDueForSite(site: SiteService, now?: Date): Promise<ScheduledRelease[]>;
  runDueAll(now?: Date): Promise<ScheduledRelease[]>;
  setupWorkflow(site: SiteService, cron?: string): Promise<ScheduleWorkflowResult>;
  dispose(): void;
}

export interface ScheduleServiceOptions {
  home?: string;
  registry?: SiteRegistry;
  settings?: Pick<SettingsService, "get">;
  events?: EventBus;
  /** Optional hook invoked after a scheduled publish succeeds when `deployAfterPublish` is true. */
  deploySite?: (site: SiteService) => Promise<{ url?: string } | void>;
  now?: () => Date;
  logger?: (line: string) => void;
}

async function resolveAuthor(site: SiteService, settings?: Pick<SettingsService, "get">): Promise<{ name: string; email: string }> {
  const git = await site.gitStatus().catch(() => null);

  if (git?.author?.name && git.author.email) return { name: git.author.name, email: git.author.email };
  const saved = await settings?.get().catch(() => null);

  if (saved?.author?.name && saved.author.email) return { name: saved.author.name, email: saved.author.email };
  return { name: "Galley", email: "galley@localhost" };
}

async function writeSnapshotsToWorkingTree(site: SiteService, files: ScheduledFileSnapshot[]): Promise<void> {
  for (const file of files) {
    const abs = site.resolvePath(file.path);

    if (file.status === "deleted") {
      await rm(abs, { force: true });
    } else {
      await mkdir(dirname(abs), { recursive: true });
      const bytes = Buffer.from(file.contentBase64 ?? "", "base64");

      await writeFile(abs, bytes);
    }
  }
}

export function createScheduleService(options: ScheduleServiceOptions = {}): ScheduleService {
  const store: ScheduleStore = createScheduleStore(options.home);
  const now = options.now ?? (() => new Date());
  const log = options.logger ?? ((line: string) => process.stderr.write(`[schedules] ${line}\n`));
  const inFlight = new Set<string>();

  async function executeRelease(site: SiteService, schedule: ScheduledRelease): Promise<ScheduledRelease> {
    const lockKey = `${site.id}:${schedule.id}`;

    if (inFlight.has(lockKey)) {
      throw new GalleyError("busy", "That scheduled release is already publishing.");
    }
    inFlight.add(lockKey);
    const publishing: ScheduledRelease = { ...schedule, state: "publishing", error: undefined };

    await store.upsert(site.id, publishing);

    // Snapshot any overlapping working-tree files so we can restore them on failure without losing edits.
    const backup = new Map<string, Buffer | null>();

    try {
      for (const file of schedule.files) {
        const abs = site.resolvePath(file.path);

        try {
          backup.set(file.path, await readFile(abs));
        } catch {
          backup.set(file.path, null);
        }
      }

      await writeSnapshotsToWorkingTree(site, schedule.files);
      const paths = schedule.files.map((file) => file.path);
      const result = await site.publish({ message: schedule.message, paths });

      if (!result.ok) {
        throw new Error(result.error ?? "Publish was refused.");
      }

      let deployUrl: string | undefined;

      if (schedule.deployAfterPublish && options.deploySite) {
        try {
          const deployed = await options.deploySite(site);

          if (deployed?.url) deployUrl = deployed.url;
        } catch (deployError) {
          log(`scheduled deploy failed for ${site.id}/${schedule.id}: ${deployError instanceof Error ? deployError.message : String(deployError)}`);
        }
      }

      const done: ScheduledRelease = {
        ...publishing,
        state: "published",
        publishedAt: now().toISOString(),
        ...(result.commit ? { commit: result.commit } : {}),
        ...(deployUrl ? { deployUrl } : {}),
      };

      await store.upsert(site.id, done);
      options.events?.emit({ type: "changes.updated", siteId: site.id, paths, origin: "publish" });
      return done;
    } catch (error) {
      // Restore overlapping working-tree files on failure so nothing is corrupted.
      for (const [relPath, bytes] of backup.entries()) {
        const abs = site.resolvePath(relPath);

        if (bytes === null) {
          await rm(abs, { force: true }).catch(() => undefined);
        } else {
          await mkdir(dirname(abs), { recursive: true }).catch(() => undefined);
          await writeFile(abs, bytes).catch(() => undefined);
        }
      }
      const failed: ScheduledRelease = {
        ...publishing,
        state: "failed",
        error: error instanceof Error ? error.message : String(error),
      };

      await store.upsert(site.id, failed);
      return failed;
    } finally {
      inFlight.delete(lockKey);
    }
  }

  return {
    list: (site) => store.list(site.id),

    async create(site, input) {
      const checkedTime = normalizeFutureSchedule(input.scheduledAt, now());

      if (!checkedTime.ok) throw new GalleyError("invalid", checkedTime.message);
      const changes = await site.changes();
      const wanted = input.paths?.length ? new Set(input.paths) : null;
      const selected = changes.files.filter((file) => !wanted || wanted.has(file.path));

      if (selected.length === 0) {
        throw new GalleyError("invalid", "There are no pending changes selected to schedule.");
      }

      const files: ScheduledFileSnapshot[] = [];

      for (const file of selected) {
        if (file.status === "deleted") {
          files.push({ path: file.path, status: "deleted", summary: file.summary });
        } else {
          const bytes = await readFile(site.resolvePath(file.path));

          files.push({
            path: file.path,
            status: file.status === "added" ? "added" : "modified",
            summary: file.summary,
            contentBase64: bytes.toString("base64"),
          });
        }
      }

      const [author, model] = await Promise.all([resolveAuthor(site, options.settings), site.model()]);
      const defaultMessage =
        selected.length === 1
          ? selected[0]!.summary || `Update ${selected[0]!.path}`
          : `Scheduled update (${selected.length} files)`;
      const schedule: ScheduledRelease = {
        id: `sched-${randomUUID().slice(0, 8)}`,
        siteId: site.id,
        createdAt: now().toISOString(),
        scheduledAt: checkedTime.iso,
        ...(input.timezone?.trim() ? { timezone: input.timezone.trim() } : {}),
        message: input.message?.trim() || defaultMessage,
        author,
        deployAfterPublish: input.deployAfterPublish ?? Boolean(model.deploy?.autoDeploy ?? model.deploy),
        state: "scheduled",
        files,
      };

      await store.upsert(site.id, schedule);

      if (input.holdOutOfWorkingTree !== false) {
        await site.discard(files.map((f) => f.path));
      }

      return schedule;
    },

    async update(site, scheduleId, input) {
      const existing = await store.get(site.id, scheduleId);

      if (!existing) throw new GalleyError("not-found", "That scheduled release doesn't exist.");
      if (existing.state !== "scheduled" && existing.state !== "failed") {
        throw new GalleyError("invalid", "Only upcoming or failed scheduled releases can be rescheduled.");
      }
      let nextScheduledAt = existing.scheduledAt;

      if (input.scheduledAt !== undefined) {
        const checked = normalizeFutureSchedule(input.scheduledAt, now());

        if (!checked.ok) throw new GalleyError("invalid", checked.message);
        nextScheduledAt = checked.iso;
      }
      const next: ScheduledRelease = {
        ...existing,
        scheduledAt: nextScheduledAt,
        ...(input.timezone !== undefined ? { timezone: input.timezone.trim() || undefined } : {}),
        ...(input.message !== undefined && input.message.trim() ? { message: input.message.trim() } : {}),
        ...(input.deployAfterPublish !== undefined ? { deployAfterPublish: input.deployAfterPublish } : {}),
        state: "scheduled",
        error: undefined,
      };

      return store.upsert(site.id, next);
    },

    async cancel(site, scheduleId, input = {}) {
      const existing = await store.get(site.id, scheduleId);

      if (!existing) throw new GalleyError("not-found", "That scheduled release doesn't exist.");
      if (existing.state === "published") {
        throw new GalleyError("invalid", "That scheduled release has already been published.");
      }
      if (existing.state === "publishing") {
        throw new GalleyError("busy", "That scheduled release is currently publishing.");
      }
      const cancelled: ScheduledRelease = { ...existing, state: "cancelled" };

      await store.upsert(site.id, cancelled);

      if (input.restoreToProof !== false && existing.files.length > 0) {
        await writeSnapshotsToWorkingTree(site, existing.files);
        const paths = existing.files.map((f) => f.path);

        await site.changes().catch(() => undefined);
        options.events?.emit({ type: "changes.updated", siteId: site.id, paths, origin: "undo" });
      }

      return cancelled;
    },

    async runNow(site, scheduleId) {
      const existing = await store.get(site.id, scheduleId);

      if (!existing) throw new GalleyError("not-found", "That scheduled release doesn't exist.");
      if (existing.state === "published") return existing;
      if (existing.state === "cancelled") {
        throw new GalleyError("invalid", "That scheduled release was cancelled.");
      }
      return executeRelease(site, existing);
    },

    async runDueForSite(site, at = now()) {
      const list = await store.list(site.id);
      const nowMs = at.getTime();
      const due = list.filter((item) => item.state === "scheduled" && Date.parse(item.scheduledAt) <= nowMs);
      const results: ScheduledRelease[] = [];

      for (const item of due) {
        results.push(await executeRelease(site, item));
      }
      return results;
    },

    async runDueAll(at = now()) {
      if (!options.registry) return [];
      const siteIds = await store.listAllSiteIds();
      const results: ScheduledRelease[] = [];

      for (const siteId of siteIds) {
        const site = await options.registry.get(siteId).catch(() => null);

        if (!site) continue;
        const ran = await this.runDueForSite(site, at).catch(() => []);

        results.push(...ran);
      }
      return results;
    },

    setupWorkflow: (site, cron) => setupScheduleWorkflow(site, cron),

    dispose() {
      inFlight.clear();
    },
  };
}
