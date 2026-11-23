/**
 * Redirects over HTTP: the redirects routes in `ApiRoutes`, behind the usual
 * session and Origin guards. The engine's RedirectsService does the work;
 * this file validates input and keeps the Cloudflare access key on the
 * server (it is only ever read inside the engine). A host refusing the key
 * comes back as 400 ("unconfigured"), never 401, which would tell the UI the
 * app's own session ended.
 */
import { z } from "zod";
import { GalleyError } from "@galley/core";
import type { RedirectsService } from "@galley/core/redirects";
import type { SiteService } from "@galley/core/types";
import { notFound } from "./errors";
import type { RouteContext, RouteTable } from "./routes";
import * as v from "./validate";

type RedirectsRouteKey =
  | "GET /api/sites/:siteId/redirects"
  | "PUT /api/sites/:siteId/redirects"
  | "POST /api/sites/:siteId/redirects/review"
  | "POST /api/sites/:siteId/redirects/import"
  | "POST /api/sites/:siteId/redirects/try"
  | "PUT /api/sites/:siteId/redirects/settings"
  | "POST /api/sites/:siteId/redirects/derived/replace"
  | "POST /api/sites/:siteId/redirects/leftover/remove"
  | "GET /api/sites/:siteId/redirects/export"
  | "GET /api/sites/:siteId/redirects/health"
  | "POST /api/sites/:siteId/redirects/cloudflare/plan"
  | "POST /api/sites/:siteId/redirects/cloudflare/apply"
  | "POST /api/sites/:siteId/redirects/cloudflare/check"
  | "POST /api/sites/:siteId/redirects/cloudflare/remove";

const status = z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]);
const redirect = z
  .object({
    from: z.string().min(1).max(4096),
    to: z.string().min(1).max(4096),
    status,
    note: z.string().max(500).optional(),
    source: z.string().max(100).optional(),
  })
  .strict();
const baseHash = z.string().max(200).nullable().optional();
const host = z.enum(["cloudflare", "netlify", "vercel", "other"]);

export const saveBody = z.object({ redirects: z.array(redirect).max(200_000), baseHash }).strict();
const resolutions = z
  .object({
    duplicates: z.literal("keep-first").optional(),
    conflicts: z.enum(["keep-first", "keep-last"]).optional(),
    chains: z.enum(["flatten", "keep"]).optional(),
    livePages: z.enum(["leave-out", "keep"]).optional(),
    missingStatus: status.optional(),
    brokenTargets: z.enum(["keep", "leave-out", "use-suggestion"]).optional(),
    loops: z.enum(["refuse", "leave-out"]).optional(),
  })
  .strict();
export const importBody = z
  .object({
    text: z.string().max(20 * 1024 * 1024).optional(),
    path: z.string().min(1).max(1000).optional(),
    filename: z.string().max(300).optional(),
    mode: z.enum(["add", "replace"]).optional(),
    resolutions: resolutions.optional(),
    siteHosts: z.array(z.string().trim().min(1).max(253)).max(20).optional(),
    baseHash,
  })
  .strict()
  .refine((body) => body.text !== undefined || body.path !== undefined, { message: "Paste a list of redirects, or choose a file." });
export const tryBody = z.object({ address: z.string().max(4096) }).strict();
export const settingsBody = z
  .object({
    host: host.nullable().optional(),
    cloudflare: z
      .object({ account: z.string().trim().max(100).nullable().optional(), hostnames: z.array(z.string().trim().min(1).max(253)).max(20).nullable().optional() })
      .strict()
      .optional(),
  })
  .strict();
export const leftoverBody = z.object({ path: z.string().min(1).max(1000) }).strict();
export const exportQuery = z.object({ format: z.enum(["csv", "redirects-file", "vercel-json", "cloudflare-csv", "nginx", "apache", "json"]), hostname: z.string().trim().max(253).optional() });
export const applyBody = z.object({ planId: z.string().min(1).max(100) }).strict();

function redirectsOf(ctx: RouteContext): RedirectsService {
  const service = ctx.services.redirects;

  if (!service) throw notFound("Redirects aren't available on this server.");
  return service;
}

async function siteOf(c: Parameters<RouteTable["GET /api/sites/:siteId"]>[0], ctx: RouteContext): Promise<SiteService> {
  const site = await ctx.services.registry.get(c.req.param("siteId") ?? "");

  if (!site) throw notFound("That site isn't open here. Open it again from the Sites screen.");
  return site;
}

/** A host refusing the key must not look like the app's own session ending. */
async function host401<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof GalleyError && error.code === "unauthorized") throw new GalleyError("unconfigured", error.message, error.detail);
    throw error;
  }
}

export const redirectsRoutes: Pick<RouteTable, RedirectsRouteKey> = {
  "GET /api/sites/:siteId/redirects": async (c, ctx) => redirectsOf(ctx).overview(await siteOf(c, ctx)),
  "PUT /api/sites/:siteId/redirects": async (c, ctx) => {
    const service = redirectsOf(ctx);
    const body = await v.body(c, saveBody);

    return service.save(await siteOf(c, ctx), { redirects: body.redirects, ...(body.baseHash !== undefined ? { baseHash: body.baseHash } : {}) });
  },
  "POST /api/sites/:siteId/redirects/review": async (c, ctx) => {
    const service = redirectsOf(ctx);
    const { baseHash: _ignored, ...body } = await v.body(c, importBody);

    return service.review(await siteOf(c, ctx), body);
  },
  "POST /api/sites/:siteId/redirects/import": async (c, ctx) => {
    const service = redirectsOf(ctx);
    const body = await v.body(c, importBody);

    return service.confirm(await siteOf(c, ctx), body);
  },
  "POST /api/sites/:siteId/redirects/try": async (c, ctx) => {
    const service = redirectsOf(ctx);
    const { address } = await v.body(c, tryBody);

    return service.trace(await siteOf(c, ctx), address);
  },
  "PUT /api/sites/:siteId/redirects/settings": async (c, ctx) => {
    const service = redirectsOf(ctx);
    const body = await v.body(c, settingsBody);

    return service.configure(await siteOf(c, ctx), body);
  },
  "POST /api/sites/:siteId/redirects/derived/replace": async (c, ctx) => redirectsOf(ctx).replaceDerived(await siteOf(c, ctx)),
  "POST /api/sites/:siteId/redirects/leftover/remove": async (c, ctx) => {
    const service = redirectsOf(ctx);
    const { path } = await v.body(c, leftoverBody);

    return service.removeLeftover(await siteOf(c, ctx), path);
  },
  "GET /api/sites/:siteId/redirects/export": async (c, ctx) => {
    const service = redirectsOf(ctx);
    const { format, hostname } = v.query(c, exportQuery);
    const file = await service.exportList(await siteOf(c, ctx), format, hostname ? { hostname } : {});

    return new Response(file.body, {
      status: 200,
      headers: {
        "content-type": `${file.type}; charset=utf-8`,
        "content-disposition": `attachment; filename="${file.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  },
  "GET /api/sites/:siteId/redirects/health": async (c, ctx) => redirectsOf(ctx).health(await siteOf(c, ctx)),
  "POST /api/sites/:siteId/redirects/cloudflare/plan": async (c, ctx) => {
    const service = redirectsOf(ctx);

    return host401(async () => service.cloudflarePlan(await siteOf(c, ctx)));
  },
  "POST /api/sites/:siteId/redirects/cloudflare/apply": async (c, ctx) => {
    const service = redirectsOf(ctx);
    const { planId } = await v.body(c, applyBody);

    return host401(async () => service.cloudflareApply(await siteOf(c, ctx), { planId }));
  },
  "POST /api/sites/:siteId/redirects/cloudflare/check": async (c, ctx) => {
    const service = redirectsOf(ctx);

    return host401(async () => service.cloudflareCheck(await siteOf(c, ctx)));
  },
  "POST /api/sites/:siteId/redirects/cloudflare/remove": async (c, ctx) => {
    const service = redirectsOf(ctx);

    return host401(async () => service.cloudflareRemove(await siteOf(c, ctx)));
  },
};
