/**
 * The site kit over HTTP: what a site has of it, "Set it up for me" (a job),
 * and the forms list in one answer. The engine's site-kit module does the
 * work through SiteService; this file finds the site and its capture address.
 */
import type { Context } from "hono";
import { createSiteKitJobs, listForms, planSiteKit, setInboxEndpoint, type SiteKitJobs } from "@galley/core/site-kit";
import { GalleyError } from "@galley/core";
import type { Job, SiteService } from "@galley/core/types";
import { notFound } from "./errors";
import type { RouteContext, RouteTable } from "./routes";
import type { Services } from "./types";

type SiteKitRouteKey = "GET /api/sites/:siteId/forms" | "GET /api/sites/:siteId/kit" | "POST /api/sites/:siteId/kit/setup" | "POST /api/sites/:siteId/kit/endpoint" | "POST /api/sites/:siteId/kit/visibility";

const jobs = new WeakMap<Services, SiteKitJobs>();

function jobsOf(services: Services): SiteKitJobs {
  let made = jobs.get(services);

  if (!made) {
    made = createSiteKitJobs(services.events);
    jobs.set(services, made);
  }
  return made;
}

/** A set-up job by id, for `GET /api/jobs/:jobId`. */
export function siteKitJob(services: Services, id: string): Job | null {
  return jobs.get(services)?.get(id) ?? null;
}

async function siteOf(c: Context, ctx: RouteContext): Promise<SiteService> {
  const site = await ctx.services.registry.get(c.req.param("siteId") ?? "");

  if (!site) throw notFound("That site isn't open here. Open it again from the Sites screen.");
  return site;
}

/** Where the site's forms post to this app's inbox, and whether visitors' browsers can reach it. Nothing when the server has no inbox. */
async function capture(ctx: RouteContext, site: SiteService): Promise<{ captureAddress: string | null; captureReachable: boolean }> {
  if (!ctx.services.forms) return { captureAddress: null, captureReachable: false };
  try {
    const settings = await ctx.services.forms.captureSettings(site.id);

    return { captureAddress: settings.captureAddress, captureReachable: settings.captureReachable };
  } catch {
    return { captureAddress: null, captureReachable: false };
  }
}

export const siteKitRoutes: Pick<RouteTable, SiteKitRouteKey> = {
  "GET /api/sites/:siteId/forms": async (c, ctx) => ({ forms: await listForms(await siteOf(c, ctx)) }),
  "GET /api/sites/:siteId/kit": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    return (await planSiteKit(site, await capture(ctx, site))).status;
  },
  "POST /api/sites/:siteId/kit/setup": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    return jobsOf(ctx.services).start(site, await capture(ctx, site));
  },
  "POST /api/sites/:siteId/kit/visibility": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    return jobsOf(ctx.services).start(site, { ...(await capture(ctx, site)), only: ["files", "visibility"] });
  },
  "POST /api/sites/:siteId/kit/endpoint": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const where = await capture(ctx, site);

    // The address comes from this server, never from the request: only one visitors can reach is written.
    if (!where.captureAddress || !where.captureReachable) {
      throw new GalleyError("invalid", "Visitors' browsers can't reach this app's inbox, so the live site can't send submissions to it. Run the app on a server with a public address, or send the form to another destination.");
    }
    await setInboxEndpoint(site, where.captureAddress);
    return (await planSiteKit(site, where)).status;
  },
};
