/**
 * "Host the editor online" over HTTP: the editor-host routes in `ApiRoutes`,
 * behind the usual session and Origin guards. The engine's HostingService
 * does the work; this file validates input, keeps every key on the server
 * (only `SecretStatus` ever goes back), and turns a host refusing a key into
 * a 400 — a 401 would tell the UI the *app* session ended.
 *
 * Local mode only — a hosted install never creates other installs, so there
 * (and wherever no hosting service was composed) every route answers 404.
 */
import { z } from "zod";
import type { ApiRouteKey } from "@galley/core/api";
import { HostingError, shapeForHttp, type HostingService } from "@galley/core/hosting";
import type { SiteService } from "@galley/core/types";
import { notFound } from "./errors";
import type { RouteContext, RouteTable } from "./routes";
import * as v from "./validate";

type HostingRouteKey = Extract<
  ApiRouteKey,
  | "GET /api/editor-hosts"
  | "POST /api/editor-hosts/:hostId/connect"
  | "GET /api/sites/:siteId/editor"
  | "POST /api/sites/:siteId/editor/plan"
  | "POST /api/sites/:siteId/editor"
  | "POST /api/sites/:siteId/editor/setup-link"
  | "POST /api/sites/:siteId/editor/check"
  | "POST /api/sites/:siteId/editor/upgrade"
  | "POST /api/sites/:siteId/editor/backup"
  | "GET /api/sites/:siteId/editor/removal"
  | "DELETE /api/sites/:siteId/editor"
>;

const hostId = z.string().trim().min(1, "it can't be empty").max(100);
const hostname = z.string().trim().min(1, "it can't be empty").max(253);

export const hostingConnectBody = z
  .object({ key: z.string().max(8192).optional(), secret: v.secretName.optional() })
  .strict()
  .optional()
  .transform((value) => value ?? {});

export const hostingPlanBody = z
  .object({
    host: hostId,
    account: z.string().trim().max(200).default(""),
    name: z.string().trim().min(1, "it can't be empty").max(100),
    address: hostname,
    previewAddress: hostname.optional(),
    liveAddress: hostname.optional(),
    options: z.record(z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/, "an option's name is a short lowercase word"), z.string().max(200)).optional(),
    handover: z
      .object({
        repository: z.boolean(),
        identity: z.boolean(),
        liveAddress: z.boolean(),
        keys: z.array(v.secretName).max(10).default([]),
      })
      .strict(),
  })
  .strict();

export const hostingCreateBody = z.object({ plan: z.string().trim().min(1).max(100), confirm: z.literal(true, { error: "nothing is created without a yes: send confirm: true" }) }).strict();
export const hostingRemoveBody = z.object({ confirm: z.literal(true, { error: "nothing is removed without a yes: send confirm: true" }) }).strict();

function notHere(): never {
  throw notFound("Hosting the editor online isn't available on this server.");
}

function hostingOf(ctx: RouteContext): HostingService {
  const hosting = ctx.services.hosting;

  if (ctx.options.mode !== "local" || !hosting) notHere();
  return hosting;
}

async function siteOf(c: Parameters<RouteTable["GET /api/sites/:siteId"]>[0], ctx: RouteContext): Promise<SiteService> {
  const site = await ctx.services.registry.get(c.req.param("siteId") ?? "");

  if (!site) throw notFound("That site isn't open here. Open it again from the Sites screen.");
  return site;
}

async function host<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw error instanceof HostingError ? shapeForHttp(error) : error;
  }
}

export const hostingRoutes: Pick<RouteTable, HostingRouteKey> = {
  "GET /api/editor-hosts": async (_c, ctx) => {
    const hosting = hostingOf(ctx);

    return { hosts: await host(() => hosting.hosts()), absent: hosting.absent() };
  },
  "POST /api/editor-hosts/:hostId/connect": async (c, ctx) => {
    const hosting = hostingOf(ctx);
    const { key, secret } = await v.body(c, hostingConnectBody);

    // The key is only ever handed to the engine; an error about it is scrubbed there.
    return host(() => hosting.connect(c.req.param("hostId") ?? "", { ...(key ? { key } : {}), ...(secret ? { secret } : {}) }));
  },
  "GET /api/sites/:siteId/editor": async (c, ctx) => {
    const hosting = hostingOf(ctx);
    const site = await siteOf(c, ctx);

    return host(() => hosting.status(site));
  },
  "POST /api/sites/:siteId/editor/plan": async (c, ctx) => {
    const hosting = hostingOf(ctx);
    const request = await v.body(c, hostingPlanBody);
    const site = await siteOf(c, ctx);

    return host(() => hosting.plan(site, request));
  },
  "POST /api/sites/:siteId/editor": async (c, ctx) => {
    const hosting = hostingOf(ctx);
    const { plan, confirm } = await v.body(c, hostingCreateBody);
    const site = await siteOf(c, ctx);

    return host(() => hosting.create(site, plan, confirm));
  },
  "POST /api/sites/:siteId/editor/setup-link": async (c, ctx) => {
    const hosting = hostingOf(ctx);
    const site = await siteOf(c, ctx);

    return host(() => hosting.setupLink(site));
  },
  "POST /api/sites/:siteId/editor/check": async (c, ctx) => {
    const hosting = hostingOf(ctx);
    const site = await siteOf(c, ctx);

    return host(() => hosting.check(site));
  },
  "POST /api/sites/:siteId/editor/upgrade": async (c, ctx) => {
    const hosting = hostingOf(ctx);
    const site = await siteOf(c, ctx);

    return host(() => hosting.upgrade(site));
  },
  "POST /api/sites/:siteId/editor/backup": async (c, ctx) => {
    const hosting = hostingOf(ctx);
    const site = await siteOf(c, ctx);

    return host(() => hosting.backup(site));
  },
  "GET /api/sites/:siteId/editor/removal": async (c, ctx) => {
    const hosting = hostingOf(ctx);
    const site = await siteOf(c, ctx);

    return host(() => hosting.removal(site));
  },
  "DELETE /api/sites/:siteId/editor": async (c, ctx) => {
    const hosting = hostingOf(ctx);
    const { confirm } = await v.body(c, hostingRemoveBody);
    const site = await siteOf(c, ctx);

    return host(() => hosting.remove(site, confirm));
  },
};
