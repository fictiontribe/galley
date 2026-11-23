/**
 * Putting a site online over HTTP: the deploy routes in `ApiRoutes`, all
 * behind the usual session and Origin guards. The engine's DeployService does
 * the work; this file validates input, keeps the host's access key on the
 * server (it is only ever read inside the engine), and turns a host refusing
 * the key into a 400 — a 401 would tell the UI the *app* session ended.
 */
import { z } from "zod";
import { DeployError, shapeForHttp, type DeployService } from "@galley/core/deploy";
import type { SiteService } from "@galley/core/types";
import { notFound } from "./errors";
import type { RouteContext, RouteTable } from "./routes";
import * as v from "./validate";

type DeployRouteKey =
  | "GET /api/deploy/targets"
  | "POST /api/deploy/targets/:targetId/connect"
  | "POST /api/sites/:siteId/deploy/check"
  | "GET /api/sites/:siteId/deploy"
  | "PUT /api/sites/:siteId/deploy"
  | "POST /api/sites/:siteId/deploy/live-address"
  | "POST /api/sites/:siteId/deploy"
  | "GET /api/sites/:siteId/deployments"
  | "POST /api/sites/:siteId/deploy/domain/plan"
  | "POST /api/sites/:siteId/deploy/domain"
  | "POST /api/sites/:siteId/deploy/domain/check"
  | "DELETE /api/sites/:siteId/deploy/domain";

const id = z.string().trim().min(1, "it can't be empty").max(100);

export const deployConnectBody = z
  .object({ key: z.string().max(4096).optional() })
  .strict()
  .optional()
  .transform((value) => value ?? {});
export const deployCheckBody = z.object({ target: id, account: z.string().trim().max(100), project: z.string().trim().max(100) });
export const deploySettingsBody = z
  .object({
    target: id.optional(),
    account: id.optional(),
    project: z.string().trim().min(1).max(100).optional(),
    autoDeploy: z.boolean().optional(),
    previewOnShare: z.boolean().optional(),
  })
  .strict();
export const deployStartBody = z.object({ kind: z.enum(["production", "preview"]), label: z.string().trim().max(200).optional() }).strict();
export const domainBody = z.object({ hostname: z.string().trim().min(1, "it can't be empty").max(300) }).strict();
export const deploymentsQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() });

function deployOf(ctx: RouteContext): DeployService {
  const deploy = ctx.services.deploy;

  if (!deploy) throw notFound("Putting sites online isn't available on this server.");
  return deploy;
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
    throw error instanceof DeployError ? shapeForHttp(error) : error;
  }
}

export const deployRoutes: Pick<RouteTable, DeployRouteKey> = {
  "GET /api/deploy/targets": async (_c, ctx) => ({ targets: await deployOf(ctx).targets() }),
  "POST /api/deploy/targets/:targetId/connect": async (c, ctx) => {
    const deploy = deployOf(ctx);
    const { key } = await v.body(c, deployConnectBody);

    // The key is only ever handed to the engine; an error about it is scrubbed there.
    return host(() => deploy.connect(c.req.param("targetId") ?? "", key ? { key } : {}));
  },
  "POST /api/sites/:siteId/deploy/check": async (c, ctx) => {
    const deploy = deployOf(ctx);
    const { target, account, project } = await v.body(c, deployCheckBody);

    const site = await siteOf(c, ctx);

    return host(() => deploy.checkProject({ target, account, name: project, site }));
  },
  "GET /api/sites/:siteId/deploy": async (c, ctx) => deployOf(ctx).status(await siteOf(c, ctx)),
  "PUT /api/sites/:siteId/deploy": async (c, ctx) => {
    const deploy = deployOf(ctx);
    const patch = await v.body(c, deploySettingsBody);
    const site = await siteOf(c, ctx);

    return host(() => deploy.configure(site, patch));
  },
  "POST /api/sites/:siteId/deploy/live-address": async (c, ctx) => {
    const deploy = deployOf(ctx);

    return host(async () => deploy.useLiveAddress(await siteOf(c, ctx)));
  },
  "POST /api/sites/:siteId/deploy": async (c, ctx) => {
    const deploy = deployOf(ctx);
    const { kind, label } = await v.body(c, deployStartBody);
    const site = await siteOf(c, ctx);

    return host(() => deploy.start(site, { kind, ...(label ? { label } : {}) }));
  },
  "POST /api/sites/:siteId/deploy/domain/plan": async (c, ctx) => {
    const deploy = deployOf(ctx);
    const { hostname } = await v.body(c, domainBody);
    const site = await siteOf(c, ctx);

    return host(() => deploy.planDomain(site, hostname));
  },
  "POST /api/sites/:siteId/deploy/domain": async (c, ctx) => {
    const deploy = deployOf(ctx);
    const { hostname } = await v.body(c, domainBody);
    const site = await siteOf(c, ctx);

    return host(() => deploy.attachDomain(site, hostname));
  },
  "POST /api/sites/:siteId/deploy/domain/check": async (c, ctx) => {
    const deploy = deployOf(ctx);

    return host(async () => deploy.checkDomain(await siteOf(c, ctx)));
  },
  "DELETE /api/sites/:siteId/deploy/domain": async (c, ctx) => {
    const deploy = deployOf(ctx);

    return host(async () => deploy.detachDomain(await siteOf(c, ctx)));
  },
  "GET /api/sites/:siteId/deployments": async (c, ctx) => {
    const deploy = deployOf(ctx);
    const { limit } = v.query(c, deploymentsQuery);

    return { items: await deploy.deployments(await siteOf(c, ctx), limit) };
  },
};
