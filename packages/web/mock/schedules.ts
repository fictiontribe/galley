/**
 * In-memory scheduled publishing for the mock server and live /demo/.
 * Seeds one realistic upcoming scheduled release on the first site so visitors
 * immediately see scheduled publishing in action.
 */
import type { ScheduledFileSnapshot, ScheduledRelease } from "@galley/core/schedules/types";
import type { Handlers, MockBackend } from "./backend.ts";
import { MockError } from "./site.ts";

type ScheduleRouteKey =
  | "GET /api/sites/:siteId/schedules"
  | "POST /api/sites/:siteId/schedules"
  | "PATCH /api/sites/:siteId/schedules/:scheduleId"
  | "POST /api/sites/:siteId/schedules/:scheduleId/run"
  | "POST /api/sites/:siteId/schedules/:scheduleId/cancel"
  | "POST /api/sites/:siteId/schedules/workflow";

function tomorrowMorningIso(daysAhead = 2): string {
  const date = new Date(Date.now() + daysAhead * 86_400_000);
  date.setHours(9, 0, 0, 0);
  return date.toISOString();
}

export function createMockSchedules(mock: MockBackend): { handlers: Pick<Handlers, ScheduleRouteKey> } {
  const bySite = new Map<string, ScheduledRelease[]>();
  const firstSite = [...mock.sites.values()][0];

  if (firstSite) {
    const samplePath = firstSite.allPaths().find((p) => p.endsWith(".md")) ?? "src/content/journal/spring-issue.md";
    const existing = firstSite.read(samplePath);
    const sampleContent = existing
      ? existing.toString("utf8")
      : "---\ntitle: Spring Issue Launch\n---\n\nOur spring issue arrives this week.\n";
    const seeded: ScheduledRelease = {
      id: "sched-spring01",
      siteId: firstSite.id,
      createdAt: new Date(Date.now() - 3_600_000).toISOString(),
      scheduledAt: tomorrowMorningIso(2),
      timezone: "America/Los_Angeles",
      message: "Publish spring issue announcement",
      author: mock.settings.author,
      deployAfterPublish: true,
      state: "scheduled",
      files: [
        {
          path: samplePath,
          status: existing ? "modified" : "added",
          summary: "Update Spring Issue announcement",
          contentBase64: Buffer.from(sampleContent, "utf8").toString("base64"),
        },
      ],
    };
    bySite.set(firstSite.id, [seeded]);
  }

  function listOf(siteId: string): ScheduledRelease[] {
    return (bySite.get(siteId) ?? []).slice().sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
  }

  function upsert(siteId: string, item: ScheduledRelease): ScheduledRelease {
    const list = bySite.get(siteId) ?? [];
    const index = list.findIndex((existing) => existing.id === item.id);
    if (index >= 0) list[index] = item;
    else list.push(item);
    bySite.set(siteId, list);
    return item;
  }

  const handlers: Pick<Handlers, ScheduleRouteKey> = {
    "GET /api/sites/:siteId/schedules": ({ params }) => {
      mock.site(params.siteId);
      return { items: listOf(params.siteId) };
    },

    "POST /api/sites/:siteId/schedules": ({ params, body }) => {
      const site = mock.site(params.siteId);
      const ms = Date.parse(body.scheduledAt);
      if (!Number.isFinite(ms) || ms <= Date.now() + 30_000) {
        throw new MockError("invalid", "Choose a publish time in the future.");
      }
      const changes = site.changes();
      const wanted = body.paths?.length ? new Set(body.paths) : null;
      const selected = changes.files.filter((file) => !wanted || wanted.has(file.path));
      if (selected.length === 0) {
        throw new MockError("invalid", "There are no pending changes selected to schedule.");
      }
      const files: ScheduledFileSnapshot[] = selected.map((file) => {
        if (file.status === "deleted") return { path: file.path, status: "deleted", summary: file.summary };
        const bytes = site.read(file.path) ?? Buffer.alloc(0);
        return {
          path: file.path,
          status: file.status === "added" ? "added" : "modified",
          summary: file.summary,
          contentBase64: bytes.toString("base64"),
        };
      });
      const schedule: ScheduledRelease = {
        id: `sched-${Math.random().toString(36).slice(2, 10)}`,
        siteId: site.id,
        createdAt: new Date().toISOString(),
        scheduledAt: new Date(ms).toISOString(),
        ...(body.timezone ? { timezone: body.timezone } : {}),
        message: body.message?.trim() || (selected.length === 1 ? selected[0]!.summary || `Update ${selected[0]!.path}` : `Scheduled update (${selected.length} files)`),
        author: mock.settings.author,
        deployAfterPublish: body.deployAfterPublish ?? true,
        state: "scheduled",
        files,
      };
      upsert(site.id, schedule);
      if (body.holdOutOfWorkingTree !== false) {
        const paths = files.map((file) => file.path);
        site.discard(paths);
        mock.changed(site.id, paths, "discard");
      }
      return schedule;
    },

    "PATCH /api/sites/:siteId/schedules/:scheduleId": ({ params, body }) => {
      mock.site(params.siteId);
      const existing = (bySite.get(params.siteId) ?? []).find((item) => item.id === params.scheduleId);
      if (!existing) throw new MockError("not-found", "That scheduled release doesn’t exist.");
      if (existing.state !== "scheduled" && existing.state !== "failed") {
        throw new MockError("invalid", "Only upcoming or failed scheduled releases can be rescheduled.");
      }
      let nextScheduledAt = existing.scheduledAt;
      if (body.scheduledAt !== undefined) {
        const ms = Date.parse(body.scheduledAt);
        if (!Number.isFinite(ms) || ms <= Date.now() + 30_000) {
          throw new MockError("invalid", "Choose a publish time in the future.");
        }
        nextScheduledAt = new Date(ms).toISOString();
      }
      const next: ScheduledRelease = {
        ...existing,
        scheduledAt: nextScheduledAt,
        ...(body.timezone !== undefined ? { timezone: body.timezone || undefined } : {}),
        ...(body.message?.trim() ? { message: body.message.trim() } : {}),
        ...(body.deployAfterPublish !== undefined ? { deployAfterPublish: body.deployAfterPublish } : {}),
        state: "scheduled",
        error: undefined,
      };
      return upsert(params.siteId, next);
    },

    "POST /api/sites/:siteId/schedules/:scheduleId/run": ({ params }) => {
      const site = mock.site(params.siteId);
      const existing = (bySite.get(params.siteId) ?? []).find((item) => item.id === params.scheduleId);
      if (!existing) throw new MockError("not-found", "That scheduled release doesn’t exist.");
      if (existing.state === "published") return existing;
      if (existing.state === "cancelled") throw new MockError("invalid", "That scheduled release was cancelled.");
      for (const file of existing.files) {
        if (file.status === "deleted") site.write(file.path, null);
        else site.write(file.path, Buffer.from(file.contentBase64 ?? "", "base64"));
      }
      const paths = existing.files.map((file) => file.path);
      const result = site.publish({ message: existing.message, paths }, existing.author);
      const done: ScheduledRelease = {
        ...existing,
        state: "published",
        publishedAt: new Date().toISOString(),
        ...(result.commit ? { commit: result.commit } : {}),
      };
      upsert(site.id, done);
      mock.changed(site.id, paths, "publish");
      mock.emit({ type: "site.updated", siteId: site.id });
      return done;
    },

    "POST /api/sites/:siteId/schedules/:scheduleId/cancel": ({ params, body }) => {
      const site = mock.site(params.siteId);
      const existing = (bySite.get(params.siteId) ?? []).find((item) => item.id === params.scheduleId);
      if (!existing) throw new MockError("not-found", "That scheduled release doesn’t exist.");
      if (existing.state === "published") throw new MockError("invalid", "That scheduled release has already been published.");
      const cancelled: ScheduledRelease = { ...existing, state: "cancelled" };
      upsert(site.id, cancelled);
      if (body.restoreToProof !== false && existing.files.length > 0) {
        for (const file of existing.files) {
          if (file.status === "deleted") site.write(file.path, null);
          else site.write(file.path, Buffer.from(file.contentBase64 ?? "", "base64"));
        }
        mock.changed(site.id, existing.files.map((file) => file.path), "undo");
      }
      return cancelled;
    },

    "POST /api/sites/:siteId/schedules/workflow": ({ params, body }) => {
      const site = mock.site(params.siteId);
      const path = ".github/workflows/galley-schedule.yml";
      const cron = body.cron?.trim() || "0 * * * *";
      const existed = site.read(path) !== null;
      site.write(
        path,
        Buffer.from(`name: Scheduled publish\n\non:\n  schedule:\n    - cron: '${cron}'\n  workflow_dispatch:\n`, "utf8"),
      );
      mock.changed(site.id, [path], "user");
      return { path, cron, created: !existed };
    },
  };

  return { handlers };
}
