/**
 * Scheduled publishing over HTTP: list, create, reschedule, cancel (with
 * restore to Proof), publish now, and generate the static GitHub rebuild
 * workflow.
 */
import { z } from "zod";
import { createScheduleService, type ScheduleService } from "@galley/core/schedules";
import type { SiteService } from "@galley/core/types";
import { notFound } from "./errors";
import type { RouteContext, RouteTable } from "./routes";
import type { Services } from "./types";
import * as v from "./validate";

type ScheduleRouteKey =
  | "GET /api/sites/:siteId/schedules"
  | "POST /api/sites/:siteId/schedules"
  | "PATCH /api/sites/:siteId/schedules/:scheduleId"
  | "POST /api/sites/:siteId/schedules/:scheduleId/run"
  | "POST /api/sites/:siteId/schedules/:scheduleId/cancel"
  | "POST /api/sites/:siteId/schedules/workflow";

export const createScheduleBody = z
  .object({
    message: z.string().trim().max(500).optional(),
    paths: z.array(z.string().min(1).max(1024)).max(500).optional(),
    scheduledAt: z.string().trim().min(1).max(64),
    timezone: z.string().trim().max(100).optional(),
    deployAfterPublish: z.boolean().optional(),
    holdOutOfWorkingTree: z.boolean().optional(),
  })
  .strict();

export const updateScheduleBody = z
  .object({
    scheduledAt: z.string().trim().min(1).max(64).optional(),
    timezone: z.string().trim().max(100).optional(),
    message: z.string().trim().min(1).max(500).optional(),
    deployAfterPublish: z.boolean().optional(),
  })
  .strict();

export const cancelScheduleBody = z
  .object({
    restoreToProof: z.boolean().optional(),
  })
  .strict();

export const scheduleWorkflowBody = z
  .object({
    cron: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

const fallback = new WeakMap<Services, ScheduleService>();

function schedulesOf(ctx: RouteContext): ScheduleService {
  const own = ctx.services.schedules;

  if (own) return own;
  let made = fallback.get(ctx.services);

  if (!made) {
    made = createScheduleService({
      registry: ctx.services.registry,
      settings: ctx.services.settings,
      events: ctx.services.events,
    });
    fallback.set(ctx.services, made);
  }
  return made;
}

async function siteOf(c: Parameters<RouteTable["GET /api/sites/:siteId"]>[0], ctx: RouteContext): Promise<SiteService> {
  const site = await ctx.services.registry.get(c.req.param("siteId") ?? "");

  if (!site) throw notFound("That site isn't open here. Open it again from the Sites screen.");
  return site;
}

export const scheduleRoutes: Pick<RouteTable, ScheduleRouteKey> = {
  "GET /api/sites/:siteId/schedules": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    return { items: await schedulesOf(ctx).list(site) };
  },
  "POST /api/sites/:siteId/schedules": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const body = await v.body(c, createScheduleBody);

    return schedulesOf(ctx).create(site, body);
  },
  "PATCH /api/sites/:siteId/schedules/:scheduleId": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const body = await v.body(c, updateScheduleBody);

    return schedulesOf(ctx).update(site, c.req.param("scheduleId") ?? "", body);
  },
  "POST /api/sites/:siteId/schedules/:scheduleId/run": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    return schedulesOf(ctx).runNow(site, c.req.param("scheduleId") ?? "");
  },
  "POST /api/sites/:siteId/schedules/:scheduleId/cancel": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const body = await v.body(c, cancelScheduleBody);

    return schedulesOf(ctx).cancel(site, c.req.param("scheduleId") ?? "", body);
  },
  "POST /api/sites/:siteId/schedules/workflow": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const body = await v.body(c, scheduleWorkflowBody);

    return schedulesOf(ctx).setupWorkflow(site, body.cron);
  },
};
