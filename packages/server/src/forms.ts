/**
 * Form capture over HTTP: the public endpoint `/f/:siteId` and the inbox's
 * routes in `ApiRoutes`.
 *
 * The endpoint is the one place a page on another site is meant to post to,
 * so it is mounted in app.ts *before* the CSRF (Origin) guard and outside the
 * session guard — after the Host check and with its own 64 KB body limit.
 * Its own rules (core forms/capture.ts) decide who may post: the site's own
 * origins get CORS headers naming exactly that origin (never `*`, never
 * credentials); anyone else gets a bare 403. Nothing else is opened up: every
 * other route keeps both guards (see test/forms.test.ts).
 */
import type { Context } from "hono";
import { z } from "zod";
import { CAPTURE_ID_HEADER, CAPTURE_KEY_HEADER, CAPTURED_AT_HEADER, introspectForm, type CaptureResponse, type FormCaptureService } from "@galley/core/forms";
import type { FormSubmission } from "@galley/core/kit";
import type { JsonValue } from "@galley/core/types";
import { GalleyError } from "@galley/core";
import { clientKeyOf, requestProtocol } from "./auth";
import { notFound } from "./errors";
import type { RouteContext, RouteTable } from "./routes";
import type { AppOptions, Services } from "./types";
import * as v from "./validate";

export const CAPTURE_PATH = "/f/:siteId";
export const CAPTURE_BODY_LIMIT_BYTES = 64 * 1024;

/** The app's own origins, which may post test submissions. */
function ownOrigins(c: Context, options: AppOptions): string[] {
  const url = new URL(c.req.url);
  const list = [`${requestProtocol(c, Boolean(options.trustProxy))}://${url.host}`.toLowerCase()];

  if (options.publicOrigin) list.push(options.publicOrigin.toLowerCase());
  return list;
}

function send(c: Context, response: CaptureResponse): Response {
  const headers: Record<string, string> = { "cache-control": "no-store", vary: "Origin" };

  if (response.allowOrigin) {
    headers["access-control-allow-origin"] = response.allowOrigin;
    headers["access-control-allow-methods"] = "POST, OPTIONS";
    headers["access-control-allow-headers"] = "content-type";
    headers["access-control-max-age"] = "600";
    // Not a CORS-safelisted header: without this a page can't read how long to wait after a 429.
    headers["access-control-expose-headers"] = "Retry-After";
  }
  if (response.retryAfterSeconds) headers["retry-after"] = String(response.retryAfterSeconds);
  // A form posted without JavaScript: back to the page that sent it, or a small page of our own.
  if (response.redirect) return new Response(null, { status: 303, headers: { ...headers, location: response.redirect } });
  if (response.html !== undefined) {
    headers["content-type"] = "text/html; charset=utf-8";
    headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
    return new Response(response.html, { status: response.status, headers });
  }
  if (response.body === null) return new Response(null, { status: response.status, headers });
  headers["content-type"] = "application/json; charset=utf-8";
  return new Response(JSON.stringify(response.body), { status: response.status, headers });
}

/** POST and OPTIONS /f/:siteId. Without a capture service the address answers 404, like any unknown site. */
export function captureHandlers(services: Services, options: AppOptions) {
  const missing = (c: Context) => send(c, { status: 404, body: { ok: false, message: "No form here is taking submissions." }, allowOrigin: null });

  return {
    async preflight(c: Context): Promise<Response> {
      if (!services.forms) return missing(c);
      return send(c, await services.forms.preflight({ siteId: c.req.param("siteId") ?? "", origin: c.req.header("origin") ?? null, ownOrigins: ownOrigins(c, options) }));
    },
    async capture(c: Context): Promise<Response> {
      if (!services.forms) return missing(c);
      return send(
        c,
        await services.forms.capture({
          siteId: c.req.param("siteId") ?? "",
          method: c.req.method,
          origin: c.req.header("origin") ?? null,
          captureKey: c.req.header(CAPTURE_KEY_HEADER) ?? null,
          captureId: c.req.header(CAPTURE_ID_HEADER) ?? null,
          capturedAt: c.req.header(CAPTURED_AT_HEADER) ?? null,
          contentType: c.req.header("content-type") ?? null,
          client: clientKeyOf(c, Boolean(options.trustProxy)),
          body: await c.req.text(),
          ownOrigins: ownOrigins(c, options),
        })
      );
    },
    notAllowed(c: Context): Response {
      return send(c, { status: 405, body: { ok: false, message: "Forms post here; there's nothing to open." }, allowOrigin: null });
    },
  };
}

// ─────────────────────────────────────────────────────────────── inbox routes

const id = z.string().min(1).max(64);
const ids = z.array(id).min(1, "choose at least one submission").max(1000);
const filter = z.enum(["inbox", "unread", "spam", "all"]);
const intFromQuery = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

const inboxQuery = z.object({ filter: filter.optional(), q: z.string().max(200).optional(), offset: intFromQuery(0, 1_000_000).optional(), limit: intFromQuery(1, 200).optional() });
const exportQuery = z.object({ filter: filter.optional() });
const markBody = z
  .object({ ids, read: z.boolean().optional(), spam: z.boolean().optional() })
  .strict()
  .refine((body) => body.read !== undefined || body.spam !== undefined, "say what to mark: read or spam");
const deleteBody = z.object({ ids }).strict();
const answer = z.union([z.string().max(100_000), z.array(z.string().max(100_000)).max(200)]);
const submission: z.ZodType<FormSubmission> = z.object({
  id,
  siteId: z.string().max(64),
  form: z.string().max(100),
  at: z.string().max(40),
  values: z.record(z.string().max(100), answer),
  page: z.object({ url: z.string().max(2048).optional(), title: z.string().max(300).optional(), referrer: z.string().max(2048).optional() }).optional(),
  delivery: z
    .array(
      z.object({
        provider: z.string().max(64),
        ok: z.boolean(),
        detail: z.string().max(1000).optional(),
        destination: z.number().int().min(0).optional(),
        attempts: z.number().int().min(0).optional(),
        at: z.string().max(40).optional(),
      })
    )
    .max(50)
    .optional(),
  spam: z.boolean().optional(),
  spamReason: z.string().max(40).optional(),
  read: z.boolean().optional(),
  test: z.boolean().optional(),
});
const restoreBody = z.object({ submissions: z.array(submission).min(1).max(1000) }).strict();
const retryBody = z.object({ destination: z.union([z.number().int().min(0).max(100), z.literal("email")]) }).strict();
const captureBody = z
  .object({
    extraOrigins: z.array(z.string().max(300)).max(50).optional(),
    notify: z.record(z.string().max(100), z.array(z.string().max(320)).max(50)).optional(),
    rateLimits: z.object({ perIpPerMinute: z.number().int().optional(), perFormPerMinute: z.number().int().optional() }).strict().optional(),
    turnstileSecret: z.string().max(1000).nullable().optional(),
    forwardSecrets: z.record(z.string().max(60), z.string().max(5000).nullable()).optional(),
  })
  .strict();
const keyBody = z.object({ action: z.enum(["rotate", "remove"]) }).strict();
const introspectBody = z.object({ provider: z.string().min(1).max(64), settings: z.record(z.string(), v.jsonValue) }).strict();

function formsOf(ctx: RouteContext): FormCaptureService {
  if (!ctx.services.forms) throw new GalleyError("unconfigured", "The inbox isn't available on this server.");
  return ctx.services.forms;
}

async function siteId(c: Context, ctx: RouteContext): Promise<string> {
  const site = await ctx.services.registry.get(c.req.param("siteId") ?? "");

  if (!site) throw notFound("That site isn't open here. Open it again from the Sites screen.");
  return site.id;
}

const param = (c: Context, name: string) => c.req.param(name) ?? "";

type InboxRouteKey =
  | "POST /api/sites/:siteId/forms/introspect"
  | "GET /api/sites/:siteId/inbox"
  | "GET /api/sites/:siteId/inbox/:formId"
  | "GET /api/sites/:siteId/inbox/:formId/export"
  | "GET /api/sites/:siteId/inbox/:formId/:submissionId"
  | "PATCH /api/sites/:siteId/inbox/:formId"
  | "POST /api/sites/:siteId/inbox/:formId/delete"
  | "POST /api/sites/:siteId/inbox/:formId/restore"
  | "POST /api/sites/:siteId/inbox/:formId/:submissionId/retry"
  | "GET /api/sites/:siteId/capture"
  | "PATCH /api/sites/:siteId/capture"
  | "POST /api/sites/:siteId/capture/key";

/** Spread into `routes`. The export route comes before `/:submissionId` so the literal path wins. */
export const inboxRoutes: Pick<RouteTable, InboxRouteKey> = {
  "POST /api/sites/:siteId/forms/introspect": async (c, ctx) => {
    const id = await siteId(c, ctx);
    const { provider, settings } = await v.body(c, introspectBody);

    if (ctx.services.forms) return ctx.services.forms.introspect(id, provider, settings as { [key: string]: JsonValue });
    return introspectForm(provider, settings as { [key: string]: JsonValue });
  },
  "GET /api/sites/:siteId/inbox": async (c, ctx) => formsOf(ctx).forms(await siteId(c, ctx)),
  "GET /api/sites/:siteId/inbox/:formId/export": async (c, ctx) => {
    const id = await siteId(c, ctx);
    const { filter } = v.query(c, exportQuery);
    const { fileName, text } = await formsOf(ctx).exportCsv(id, param(c, "formId"), filter);

    return new Response(text, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${fileName.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  },
  "GET /api/sites/:siteId/inbox/:formId": async (c, ctx) => formsOf(ctx).list(await siteId(c, ctx), param(c, "formId"), v.query(c, inboxQuery)),
  "GET /api/sites/:siteId/inbox/:formId/:submissionId": async (c, ctx) => formsOf(ctx).get(await siteId(c, ctx), param(c, "formId"), param(c, "submissionId")),
  "PATCH /api/sites/:siteId/inbox/:formId": async (c, ctx) => {
    const id = await siteId(c, ctx);
    const body = await v.body(c, markBody);

    return { items: await formsOf(ctx).mark(id, param(c, "formId"), body.ids, { read: body.read, spam: body.spam }) };
  },
  "POST /api/sites/:siteId/inbox/:formId/delete": async (c, ctx) => {
    const id = await siteId(c, ctx);

    return { deleted: await formsOf(ctx).remove(id, param(c, "formId"), (await v.body(c, deleteBody)).ids) };
  },
  "POST /api/sites/:siteId/inbox/:formId/restore": async (c, ctx) => {
    const id = await siteId(c, ctx);

    return { restored: await formsOf(ctx).restore(id, param(c, "formId"), (await v.body(c, restoreBody)).submissions) };
  },
  "POST /api/sites/:siteId/inbox/:formId/:submissionId/retry": async (c, ctx) => {
    const id = await siteId(c, ctx);

    return formsOf(ctx).retry(id, param(c, "formId"), param(c, "submissionId"), (await v.body(c, retryBody)).destination);
  },
  "GET /api/sites/:siteId/capture": async (c, ctx) => formsOf(ctx).captureSettings(await siteId(c, ctx)),
  "PATCH /api/sites/:siteId/capture": async (c, ctx) => {
    const id = await siteId(c, ctx);

    return formsOf(ctx).patchCaptureSettings(id, await v.body(c, captureBody));
  },
  "POST /api/sites/:siteId/capture/key": async (c, ctx) => {
    const id = await siteId(c, ctx);

    return formsOf(ctx).captureKey(id, (await v.body(c, keyBody)).action);
  },
};
