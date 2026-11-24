/**
 * Media storage over HTTP: connecting a site to a bucket (and, for pictures,
 * Cloudflare Images), the check, the status. The engine's media storage
 * service does the work; this file validates input and makes sure only
 * status ever leaves — a pasted key goes in, and never comes back out in an
 * answer, an error or a log.
 */
import { z } from "zod";
import { GalleyError } from "@galley/core";
import type { MediaStorageService } from "@galley/core/media-storage";
import type { SiteService } from "@galley/core/types";
import { notFound } from "./errors";
import type { RouteContext, RouteTable } from "./routes";
import * as v from "./validate";

type MediaStorageRouteKey =
  | "GET /api/media-storage/connectors"
  | "GET /api/sites/:siteId/media/storage"
  | "POST /api/sites/:siteId/media/storage/check"
  | "PUT /api/sites/:siteId/media/storage"
  | "DELETE /api/sites/:siteId/media/storage"
  | "POST /api/sites/:siteId/media/images/check"
  | "PUT /api/sites/:siteId/media/images"
  | "DELETE /api/sites/:siteId/media/images"
  | "POST /api/sites/:siteId/media/storage/make-bucket"
  | "DELETE /api/sites/:siteId/media/storage/made-bucket"
  | "GET /api/sites/:siteId/media/usage"
  | "POST /api/sites/:siteId/media/storage/delete"
  | "POST /api/sites/:siteId/media/storage/move/plan"
  | "POST /api/sites/:siteId/media/storage/move";

const shortText = (max: number) => z.string().trim().max(max);

export const storageConfigBody = z
  .object({
    connector: z.string().trim().min(1, "choose where to keep the files").max(64),
    bucket: shortText(63),
    account: shortText(64).optional(),
    region: shortText(40).optional(),
    endpoint: shortText(500).optional(),
    pathStyle: z.boolean().optional(),
    prefix: shortText(200).optional(),
    publicUrl: shortText(500),
  })
  .strict();

const keyText = z.string().max(512);

export const imagesConfigBody = z
  .object({
    connector: z.literal("cloudflare-images"),
    account: shortText(64),
    accountHash: shortText(64),
    variant: shortText(99).optional(),
    deliveryUrl: shortText(500).optional(),
  })
  .strict();
export const imagesConnectBody = z.object({ config: imagesConfigBody, token: keyText.optional(), useDeployKey: z.boolean().optional() }).strict();
export const imagesCheckBody = z
  .object({ config: imagesConfigBody.optional(), token: keyText.optional(), useDeployKey: z.boolean().optional() })
  .strict()
  .optional()
  .transform((value) => value ?? {});

export const connectBody = z.object({ config: storageConfigBody, accessKeyId: keyText.optional(), secretAccessKey: keyText.optional() }).strict();
export const checkBody = z
  .object({ config: storageConfigBody.optional(), accessKeyId: keyText.optional(), secretAccessKey: keyText.optional() })
  .strict()
  .optional()
  .transform((value) => value ?? {});
export const disconnectQuery = z.object({ forgetKeys: z.enum(["true", "false"]).optional() });
export const makeBucketBody = z.object({ account: shortText(64), name: shortText(63) }).strict();
export const usageQuery = z.object({ url: z.string().trim().min(1, "it can't be empty").max(2048) });
const location = z.enum(["repository", "bucket", "images"]);
export const moveBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("move"), from: location, to: location, keepCopies: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal("address"), store: z.enum(["bucket", "images"]), publicUrl: z.string().trim().min(1, "it can't be empty").max(500) }).strict(),
]);
export const deleteStoredBody = z.object({ paths: z.array(z.string().min(1).max(1100)).min(1, "name at least one file").max(200) }).strict();

export function mediaStorageOf(ctx: RouteContext): MediaStorageService {
  const storage = ctx.services.mediaStorage;

  if (!storage) throw notFound("Keeping media outside the repository isn't available on this server.");
  return storage;
}

async function siteOf(c: Parameters<RouteTable["GET /api/sites/:siteId"]>[0], ctx: RouteContext): Promise<SiteService> {
  const site = await ctx.services.registry.get(c.req.param("siteId") ?? "");

  if (!site) throw notFound("That site isn't open here. Open it again from the Sites screen.");
  return site;
}

/** Drops undefined fields so the engine's optional settings stay absent. */
function definedOnly<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== "")) as T;
}

/** A pasted key that is the wrong shape is a 400 with the engine's own sentence, never the value. */
async function engine<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof GalleyError) throw new GalleyError(error.code, error.message);
    throw error;
  }
}

export const mediaStorageRoutes: Pick<RouteTable, MediaStorageRouteKey> = {
  "GET /api/media-storage/connectors": async (_c, ctx) => ({ connectors: mediaStorageOf(ctx).connectors() }),
  "GET /api/sites/:siteId/media/storage": async (c, ctx) => mediaStorageOf(ctx).status(await siteOf(c, ctx)),
  "POST /api/sites/:siteId/media/storage/check": async (c, ctx) => {
    const storage = mediaStorageOf(ctx);
    const request = await v.body(c, checkBody);
    const site = await siteOf(c, ctx);

    return engine(() =>
      storage.check(site, request.config ? { config: definedOnly(request.config), ...definedOnly({ accessKeyId: request.accessKeyId, secretAccessKey: request.secretAccessKey }) } : undefined)
    );
  },
  "PUT /api/sites/:siteId/media/storage": async (c, ctx) => {
    const storage = mediaStorageOf(ctx);
    const request = await v.body(c, connectBody);
    const site = await siteOf(c, ctx);

    return engine(() => storage.connect(site, { config: definedOnly(request.config), ...definedOnly({ accessKeyId: request.accessKeyId, secretAccessKey: request.secretAccessKey }) }));
  },
  "DELETE /api/sites/:siteId/media/storage": async (c, ctx) => {
    const storage = mediaStorageOf(ctx);
    const { forgetKeys } = v.query(c, disconnectQuery);

    return storage.disconnect(await siteOf(c, ctx), { forgetKeys: forgetKeys === "true" });
  },
  "POST /api/sites/:siteId/media/images/check": async (c, ctx) => {
    const storage = mediaStorageOf(ctx);
    const request = await v.body(c, imagesCheckBody);
    const site = await siteOf(c, ctx);

    return engine(() => storage.checkImages(site, request.config ? { config: definedOnly(request.config), ...definedOnly({ token: request.token, useDeployKey: request.useDeployKey }) } : undefined));
  },
  "PUT /api/sites/:siteId/media/images": async (c, ctx) => {
    const storage = mediaStorageOf(ctx);
    const request = await v.body(c, imagesConnectBody);
    const site = await siteOf(c, ctx);

    return engine(() => storage.connectImages(site, { config: definedOnly(request.config), ...definedOnly({ token: request.token, useDeployKey: request.useDeployKey }) }));
  },
  "DELETE /api/sites/:siteId/media/images": async (c, ctx) => {
    const storage = mediaStorageOf(ctx);
    const { forgetKeys } = v.query(c, disconnectQuery);

    return storage.disconnectImages(await siteOf(c, ctx), { forgetKeys: forgetKeys === "true" });
  },
  "POST /api/sites/:siteId/media/storage/make-bucket": async (c, ctx) => {
    const storage = mediaStorageOf(ctx);
    const request = await v.body(c, makeBucketBody);
    const site = await siteOf(c, ctx);

    return engine(() => storage.makeBucket(site, request));
  },
  "DELETE /api/sites/:siteId/media/storage/made-bucket": async (c, ctx) => {
    const storage = mediaStorageOf(ctx);
    const site = await siteOf(c, ctx);

    return engine(() => storage.removeMadeBucket(site));
  },
  "GET /api/sites/:siteId/media/usage": async (c, ctx) => {
    const storage = mediaStorageOf(ctx);
    const { url } = v.query(c, usageQuery);

    return storage.usage(await siteOf(c, ctx), url);
  },
  "POST /api/sites/:siteId/media/storage/delete": async (c, ctx) => {
    const storage = mediaStorageOf(ctx);
    const { paths } = await v.body(c, deleteStoredBody);
    const site = await siteOf(c, ctx);

    return engine(() => storage.deleteStored(site, paths));
  },
  "POST /api/sites/:siteId/media/storage/move/plan": async (c, ctx) => {
    const storage = mediaStorageOf(ctx);
    const request = await v.body(c, moveBody);
    const site = await siteOf(c, ctx);

    return engine(() => storage.planMove(site, request));
  },
  "POST /api/sites/:siteId/media/storage/move": async (c, ctx) => {
    const storage = mediaStorageOf(ctx);
    const request = await v.body(c, moveBody);
    const site = await siteOf(c, ctx);

    return engine(() => storage.startMove(site, request));
  },
};
