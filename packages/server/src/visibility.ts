/**
 * Search & AI visibility over HTTP: the audit, fixes, the AI-crawler policy,
 * the agent view and assistant-written batches. The engine's
 * VisibilityService does the work through SiteService; this file validates
 * input. Servers composed without the service (tests with fakes) get one
 * built from their own settings and events on first use.
 */
import { z } from "zod";
import { createVisibilityService, type VisibilityService } from "@galley/core/seo";
import type { SiteService } from "@galley/core/types";
import { notFound } from "./errors";
import type { RouteContext, RouteTable } from "./routes";
import type { Services } from "./types";
import * as v from "./validate";

type VisibilityRouteKey =
  | "GET /api/sites/:siteId/visibility"
  | "GET /api/sites/:siteId/visibility/entry"
  | "POST /api/sites/:siteId/visibility/fix"
  | "POST /api/sites/:siteId/visibility/undo"
  | "GET /api/sites/:siteId/visibility/crawlers"
  | "PUT /api/sites/:siteId/visibility/crawlers"
  | "GET /api/sites/:siteId/visibility/agent-view"
  | "POST /api/sites/:siteId/visibility/write/plan"
  | "POST /api/sites/:siteId/visibility/write"
  | "GET /api/sites/:siteId/visibility/write/:jobId"
  | "POST /api/sites/:siteId/visibility/write/:jobId/cancel"
  | "POST /api/sites/:siteId/visibility/external-links";

const writeKind = z.enum(["description", "alt", "title", "intro", "faq"]);
const paths = z.array(z.string().min(1).max(1024)).max(500).optional();

export const auditQuery = z.object({ render: z.enum(["auto", "off"]).optional() });
export const entryAuditQuery = z.object({ path: z.string().min(1).max(1024), render: z.enum(["auto", "off"]).optional() });
export const fixBody = z.object({ ids: z.array(z.string().min(1).max(2048)).min(1).max(500) }).strict();
export const undoFixBody = z.object({ undoId: z.string().min(1).max(100) }).strict();
export const crawlersBody = z.object({ choices: z.record(z.string().min(1).max(60), z.enum(["allow", "block"])) }).strict();
export const agentViewQuery = z.object({ url: z.string().min(1).max(2048).startsWith("/", "it must be an address on the site, starting with /") });
export const writePlanBody = z.object({ kind: writeKind, paths }).strict();
export const writeStartBody = z.object({ kind: writeKind, paths, limit: z.number().int().min(1).max(200).optional() }).strict();
export const externalBody = z.object({ limit: z.number().int().min(1).max(200).optional() }).strict();

const fallback = new WeakMap<Services, VisibilityService>();

function visibilityOf(ctx: RouteContext): VisibilityService {
  const own = (ctx.services as Services & { visibility?: VisibilityService }).visibility;

  if (own) return own;
  let made = fallback.get(ctx.services);

  if (!made) {
    made = createVisibilityService({ settings: ctx.services.settings, events: ctx.services.events });
    fallback.set(ctx.services, made);
  }
  return made;
}

async function siteOf(c: Parameters<RouteTable["GET /api/sites/:siteId"]>[0], ctx: RouteContext): Promise<SiteService> {
  const site = await ctx.services.registry.get(c.req.param("siteId") ?? "");

  if (!site) throw notFound("That site isn't open here. Open it again from the Sites screen.");
  return site;
}

function batchOf(ctx: RouteContext, jobId: string) {
  const status = visibilityOf(ctx).writeStatus(jobId);

  if (!status) throw notFound("That batch isn't known here. It may have finished before the app restarted; its results are in Proof.");
  return status;
}

export const visibilityRoutes: Pick<RouteTable, VisibilityRouteKey> = {
  "GET /api/sites/:siteId/visibility": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const { render } = v.query(c, auditQuery);

    return visibilityOf(ctx).audit(site, { render: render ?? "auto" });
  },
  "GET /api/sites/:siteId/visibility/entry": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const { path, render } = v.query(c, entryAuditQuery);

    return visibilityOf(ctx).entry(site, path, { render: render ?? "auto" });
  },
  "POST /api/sites/:siteId/visibility/fix": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    return visibilityOf(ctx).fix(site, (await v.body(c, fixBody)).ids);
  },
  "POST /api/sites/:siteId/visibility/undo": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    return visibilityOf(ctx).undo(site, (await v.body(c, undoFixBody)).undoId);
  },
  "GET /api/sites/:siteId/visibility/crawlers": async (c, ctx) => visibilityOf(ctx).crawlers(await siteOf(c, ctx)),
  "PUT /api/sites/:siteId/visibility/crawlers": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    return visibilityOf(ctx).setCrawlers(site, (await v.body(c, crawlersBody)).choices);
  },
  "GET /api/sites/:siteId/visibility/agent-view": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    return visibilityOf(ctx).agentView(site, v.query(c, agentViewQuery).url);
  },
  "POST /api/sites/:siteId/visibility/write/plan": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const body = await v.body(c, writePlanBody);

    return visibilityOf(ctx).planWrite(site, body.kind, body.paths);
  },
  "POST /api/sites/:siteId/visibility/write": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const body = await v.body(c, writeStartBody);

    return visibilityOf(ctx).startWrite(site, body.kind, { ...(body.paths ? { paths: body.paths } : {}), ...(body.limit ? { limit: body.limit } : {}) });
  },
  "GET /api/sites/:siteId/visibility/write/:jobId": async (c, ctx) => {
    await siteOf(c, ctx);
    return batchOf(ctx, c.req.param("jobId") ?? "");
  },
  "POST /api/sites/:siteId/visibility/write/:jobId/cancel": async (c, ctx) => {
    await siteOf(c, ctx);
    batchOf(ctx, c.req.param("jobId") ?? "");
    visibilityOf(ctx).cancelWrite(c.req.param("jobId") ?? "");
    return { ok: true as const };
  },
  "POST /api/sites/:siteId/visibility/external-links": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const { limit } = await v.body(c, externalBody);

    return visibilityOf(ctx).externalLinks(site, { ...(limit ? { limit } : {}) });
  },
};
