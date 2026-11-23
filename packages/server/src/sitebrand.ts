/**
 * The site's brand over HTTP (core sitebrand/). Every body is checked with
 * zod before the service sees it; the measured summaries are checked again
 * by the service, because they come from a page the site controls.
 *
 * Files that leave through these routes — uploaded material, the picture
 * the model saw, the site's fonts, the exports — go out with the same
 * no-script policy as the raw file route, and as downloads where they are
 * downloads.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import type { Context } from "hono";
import { z } from "zod";
import { GalleyError } from "@galley/core";
import type { ApiRouteKey } from "@galley/core/api";
import type { SiteBrandService } from "@galley/core/sitebrand";
import { notFound } from "./errors";
import { FILE_CSP, type RouteContext, type RouteTable } from "./routes";
import * as v from "./validate";

type BrandRouteKey = Extract<
  ApiRouteKey,
  | "GET /api/sites/:siteId/brand"
  | "POST /api/sites/:siteId/brand/analyse"
  | "POST /api/sites/:siteId/brand/cancel"
  | "POST /api/sites/:siteId/brand/sources"
  | "POST /api/sites/:siteId/brand/website"
  | "PATCH /api/sites/:siteId/brand/sources/:sourceId"
  | "DELETE /api/sites/:siteId/brand/sources/:sourceId"
  | "GET /api/sites/:siteId/brand/sources/:sourceId/file"
  | "PUT /api/sites/:siteId/brand/proposal"
  | "DELETE /api/sites/:siteId/brand/proposal"
  | "POST /api/sites/:siteId/brand/ask"
  | "POST /api/sites/:siteId/brand/save"
  | "GET /api/sites/:siteId/brand/apply"
  | "POST /api/sites/:siteId/brand/apply"
  | "POST /api/sites/:siteId/brand/check"
  | "POST /api/sites/:siteId/brand/drift"
  | "GET /api/sites/:siteId/brand/export"
  | "POST /api/sites/:siteId/brand/import"
  | "GET /api/sites/:siteId/brand/fonts/:fontId"
>;

const ok = { ok: true } as const;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
/** The measured pages travel as data; their exact shape is the service's to check. */
const measurements = z.array(z.unknown()).max(8);
const analyseBody = z.object({ from: z.enum(["site", "material"]), measurements: measurements.optional(), sources: z.array(id).max(40).optional() }).strict();
const uploadBody = z
  .object({
    uploadId: id.optional(),
    name: z.string().trim().min(1, "it can't be empty").max(200),
    note: z.string().max(300).optional(),
    total: z.number().int().min(1),
    offset: z.number().int().min(0),
    // 8 MB of bytes is ~10.7 MB of base64.
    chunk: z.string().min(1).max(11_300_000),
    preview: z.string().max(8_500_000).optional(),
  })
  .strict();
const websiteBody = z.object({ url: z.string().trim().min(1).max(2000) }).strict();
const sourcePatch = z.object({ note: z.string().max(300).nullable().optional(), ignored: z.boolean().optional() }).strict();
const proposalBody = z.object({ brand: z.unknown().optional(), answers: z.record(z.string().max(80), z.string().max(200)).optional() }).strict();
const askBody = z.object({ text: z.string().max(2000) }).strict();
const checkBody = z.object({ paths: z.array(z.string().max(1000)).max(200).optional() }).strict();
const driftBody = z.object({ measurements }).strict();
const importBody = z.object({ bundle: z.unknown() }).strict();
const fileQuery = z.object({ kind: z.enum(["original", "picture"]).optional() });
const exportQuery = z.object({ format: z.enum(["brand", "tokens"]).optional() });

function brandOf(ctx: RouteContext): SiteBrandService {
  if (!ctx.services.siteBrand) throw new GalleyError("unconfigured", "Setting up a brand isn't available on this server.");
  return ctx.services.siteBrand;
}

async function siteId(c: Context, ctx: RouteContext): Promise<string> {
  const site = await ctx.services.registry.get(c.req.param("siteId") ?? "");

  if (!site) throw notFound("That site isn't open here. Open it again from the Sites screen.");
  return site.id;
}

const param = (c: Context, name: string) => c.req.param(name) ?? "";

function fileHeaders(type: string, length: number, download: string | null): Record<string, string> {
  return {
    "content-type": type,
    "content-length": String(length),
    "x-content-type-options": "nosniff",
    "content-security-policy": FILE_CSP,
    "cross-origin-resource-policy": "same-origin",
    "cache-control": "no-cache",
    ...(download ? { "content-disposition": `attachment; filename="${download.replace(/[^A-Za-z0-9._-]/g, "_")}"` } : {}),
  };
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "site";

/** Spread into `routes`. */
export const siteBrandRoutes: Pick<RouteTable, BrandRouteKey> = {
  "GET /api/sites/:siteId/brand": async (c, ctx) => brandOf(ctx).state(await siteId(c, ctx)),
  "POST /api/sites/:siteId/brand/analyse": async (c, ctx) => {
    const sid = await siteId(c, ctx);

    return brandOf(ctx).analyse(sid, await v.body(c, analyseBody));
  },
  "POST /api/sites/:siteId/brand/cancel": async (c, ctx) => {
    await brandOf(ctx).cancel(await siteId(c, ctx));
    return ok;
  },
  "POST /api/sites/:siteId/brand/sources": async (c, ctx) => {
    const sid = await siteId(c, ctx);

    return brandOf(ctx).upload(sid, await v.body(c, uploadBody));
  },
  "POST /api/sites/:siteId/brand/website": async (c, ctx) => {
    const sid = await siteId(c, ctx);

    return brandOf(ctx).addWebsite(sid, (await v.body(c, websiteBody)).url);
  },
  "PATCH /api/sites/:siteId/brand/sources/:sourceId": async (c, ctx) => {
    const sid = await siteId(c, ctx);

    return brandOf(ctx).updateSource(sid, id.parse(param(c, "sourceId")), await v.body(c, sourcePatch));
  },
  "DELETE /api/sites/:siteId/brand/sources/:sourceId": async (c, ctx) => {
    await brandOf(ctx).removeSource(await siteId(c, ctx), id.parse(param(c, "sourceId")));
    return ok;
  },
  "GET /api/sites/:siteId/brand/sources/:sourceId/file": async (c, ctx) => {
    const sid = await siteId(c, ctx);
    const { kind } = v.query(c, fileQuery);
    const file = await brandOf(ctx).sourceFile(sid, param(c, "sourceId"), kind ?? "original");

    if (!file) throw notFound("That file isn't available here.");
    // An SVG is shown as a picture only; the policy forbids anything in it from running.
    return new Response(file.data as unknown as ConstructorParameters<typeof Response>[0], { status: 200, headers: fileHeaders(file.type, file.data.byteLength, null) });
  },
  "PUT /api/sites/:siteId/brand/proposal": async (c, ctx) => {
    const sid = await siteId(c, ctx);

    return brandOf(ctx).updateProposal(sid, await v.body(c, proposalBody));
  },
  "DELETE /api/sites/:siteId/brand/proposal": async (c, ctx) => {
    await brandOf(ctx).discardProposal(await siteId(c, ctx));
    return ok;
  },
  "POST /api/sites/:siteId/brand/ask": async (c, ctx) => {
    const sid = await siteId(c, ctx);

    return brandOf(ctx).ask(sid, (await v.body(c, askBody)).text);
  },
  "POST /api/sites/:siteId/brand/save": async (c, ctx) => brandOf(ctx).save(await siteId(c, ctx)),
  "GET /api/sites/:siteId/brand/apply": async (c, ctx) => brandOf(ctx).applyPlan(await siteId(c, ctx)),
  "POST /api/sites/:siteId/brand/apply": async (c, ctx) => brandOf(ctx).apply(await siteId(c, ctx)),
  "POST /api/sites/:siteId/brand/check": async (c, ctx) => {
    const sid = await siteId(c, ctx);

    return { items: await brandOf(ctx).check(sid, (await v.body(c, checkBody)).paths) };
  },
  "POST /api/sites/:siteId/brand/drift": async (c, ctx) => {
    const sid = await siteId(c, ctx);

    return brandOf(ctx).drift(sid, (await v.body(c, driftBody)).measurements);
  },
  "GET /api/sites/:siteId/brand/export": async (c, ctx) => {
    const sid = await siteId(c, ctx);
    const { format } = v.query(c, exportQuery);
    const site = await ctx.services.registry.get(sid);
    const name = slug((await site?.model())?.name ?? "site");
    const service = brandOf(ctx);
    const value = format === "tokens" ? await service.exportTokens(sid) : await service.exportBundle(sid);
    const text = `${JSON.stringify(value, null, 2)}\n`;

    return new Response(text, { status: 200, headers: fileHeaders(format === "tokens" ? "application/design-tokens+json" : "application/json", Buffer.byteLength(text), format === "tokens" ? `${name}.tokens.json` : `${name}.brand.json`) });
  },
  "POST /api/sites/:siteId/brand/import": async (c, ctx) => {
    const sid = await siteId(c, ctx);

    return brandOf(ctx).importBundle(sid, (await v.body(c, importBody)).bundle);
  },
  "GET /api/sites/:siteId/brand/fonts/:fontId": async (c, ctx) => {
    const sid = await siteId(c, ctx);
    const font = await brandOf(ctx).fontFile(sid, param(c, "fontId"));

    if (!font) throw notFound("That font isn't one of the site's.");
    const info = await stat(font.path);

    return new Response(Readable.toWeb(createReadStream(font.path)) as unknown as ReadableStream<Uint8Array>, {
      status: 200,
      headers: { ...fileHeaders(font.type, info.size, null), "cache-control": "private, max-age=3600" },
    });
  },
};
