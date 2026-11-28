/**
 * Scheduled publishing HTTP route integration & role-based access tests.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROUTE_ACCESS, roleMayCall } from "@galley/core/install/route-access";
import type { ScheduledRelease, ScheduleWorkflowResult } from "@galley/core/schedules/types";
import type { SiteDetail } from "@galley/core/types";
import { startServer } from "../src/server";
import type { RunningServer } from "../src/types";

const starter = fileURLToPath(new URL("../../../starters/astro-starter", import.meta.url));

describe("scheduled publishing HTTP routes", () => {
  let tmp = "";
  let siteRoot = "";
  let server: RunningServer;
  let siteId = "";

  async function api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
    const response = await fetch(`${server.url}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${server.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();

    return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
  }

  beforeAll(async () => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), "galley-srv-sched-")));
    siteRoot = join(tmp, "site");

    cpSync(starter, siteRoot, { recursive: true, filter: (src) => !["node_modules", ".astro", "dist"].includes(basename(src)) });
    const git = (...args: string[]) => execFileSync("git", args, { cwd: siteRoot, encoding: "utf8" });

    git("init", "-q");
    git("symbolic-ref", "HEAD", "refs/heads/main");
    git("config", "user.name", "Schedule Server Test");
    git("config", "user.email", "sched@example.invalid");
    git("add", "-A");
    git("commit", "-q", "-m", "Initial");

    server = await startServer({
      port: 0,
      home: join(tmp, "home"),
      webDir: join(tmp, "no-ui"),
      env: { PATH: process.env.PATH, HOME: tmp },
      notice: () => {},
    });
    siteId = (await api<SiteDetail>("POST", "/api/sites/open", { path: siteRoot })).body.id;
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("enforces role access levels across all 6 schedule routes", () => {
    expect(ROUTE_ACCESS["GET /api/sites/:siteId/schedules"]).toBe("edit");
    expect(roleMayCall("contributor", "GET /api/sites/:siteId/schedules")).toBe(true);

    const publishRoutes = [
      "POST /api/sites/:siteId/schedules",
      "PATCH /api/sites/:siteId/schedules/:scheduleId",
      "POST /api/sites/:siteId/schedules/:scheduleId/run",
      "POST /api/sites/:siteId/schedules/:scheduleId/cancel",
    ] as const;

    for (const route of publishRoutes) {
      expect(ROUTE_ACCESS[route]).toBe("publish");
      expect(roleMayCall("contributor", route)).toBe(false);
      expect(roleMayCall("editor", route)).toBe(true);
      expect(roleMayCall("owner", route)).toBe(true);
    }

    expect(ROUTE_ACCESS["POST /api/sites/:siteId/schedules/workflow"]).toBe("manage");
    expect(roleMayCall("contributor", "POST /api/sites/:siteId/schedules/workflow")).toBe(false);
    expect(roleMayCall("editor", "POST /api/sites/:siteId/schedules/workflow")).toBe(false);
    expect(roleMayCall("owner", "POST /api/sites/:siteId/schedules/workflow")).toBe(true);
  });

  it("supports create, list, reschedule, cancel-and-restore, publish-now, and workflow setup", async () => {
    const empty = await api<{ items: ScheduledRelease[] }>("GET", `/api/sites/${siteId}/schedules`);

    expect(empty.status).toBe(200);
    expect(empty.body.items).toEqual([]);

    const target = "src/content/pages/about.md";
    const original = readFileSync(join(siteRoot, target), "utf8");

    writeFileSync(join(siteRoot, target), `${original}\nHTTP scheduled update.\n`, "utf8");

    const future1 = new Date(Date.now() + 86_400_000).toISOString();
    const created = await api<ScheduledRelease>("POST", `/api/sites/${siteId}/schedules`, {
      message: "Spring update",
      paths: [target],
      scheduledAt: future1,
      timezone: "America/Los_Angeles",
    });

    expect(created.status).toBe(200);
    expect(created.body.state).toBe("scheduled");

    const listed = await api<{ items: ScheduledRelease[] }>("GET", `/api/sites/${siteId}/schedules`);

    expect(listed.body.items.map((item) => item.id)).toContain(created.body.id);

    const future2 = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const patched = await api<ScheduledRelease>("PATCH", `/api/sites/${siteId}/schedules/${created.body.id}`, {
      scheduledAt: future2,
      message: "Spring update v2",
    });

    expect(patched.status).toBe(200);
    expect(patched.body.message).toBe("Spring update v2");

    const cancelled = await api<ScheduledRelease>("POST", `/api/sites/${siteId}/schedules/${created.body.id}/cancel`, {
      restoreToProof: true,
    });

    expect(cancelled.status).toBe(200);
    expect(cancelled.body.state).toBe("cancelled");
    expect(readFileSync(join(siteRoot, target), "utf8")).toContain("HTTP scheduled update.");

    // Schedule again and publish now
    const second = await api<ScheduledRelease>("POST", `/api/sites/${siteId}/schedules`, {
      message: "Immediate scheduled release",
      paths: [target],
      scheduledAt: future1,
    });
    const ran = await api<ScheduledRelease>("POST", `/api/sites/${siteId}/schedules/${second.body.id}/run`);

    expect(ran.status).toBe(200);
    expect(ran.body.state).toBe("published");
    expect(ran.body.commit).toBeTruthy();

    // Workflow generation
    const workflow = await api<ScheduleWorkflowResult>("POST", `/api/sites/${siteId}/schedules/workflow`, {
      cron: "0 * * * *",
    });

    expect(workflow.status).toBe(200);
    expect(workflow.body.path).toBe(".github/workflows/galley-schedule.yml");
    expect(workflow.body.created).toBe(true);
  });
});
