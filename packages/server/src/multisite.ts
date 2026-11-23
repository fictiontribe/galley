/**
 * Multi-site routes: groups, filing a site, adding many sites from a folder,
 * thumbnails, presence, a site's own connections and usage.
 *
 * None of them opens a site — they work from the list in the Galley home —
 * so the Sites screen can ask about forty sites without starting forty
 * watchers. Keys go one way only: a key can be sent in, and what comes back
 * is `SiteConnections` (whether each key is set, where the one in use comes
 * from, its last four characters), passed through `publicConnections` so
 * nothing the settings service might add can leak.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { Readable } from "node:stream";
import type { Context } from "hono";
import { z } from "zod";
import { GalleyError } from "@galley/core";
import { SECRET_NAMES, type ApiRouteKey } from "@galley/core/api";
import type { AddSitesResult, SecretName, SiteConnections, SiteGroupColor } from "@galley/core/types";
import { invalid, notFound } from "./errors";
import { assertInside, realDirectory } from "./fs-list";
import type { RouteContext, RouteTable } from "./routes";
import * as v from "./validate";

type MultiSiteRouteKey = Extract<
  ApiRouteKey,
  | "GET /api/groups"
  | "POST /api/groups"
  | "PATCH /api/groups/:groupId"
  | "DELETE /api/groups/:groupId"
  | "PUT /api/groups/order"
  | "PATCH /api/sites/:siteId/listing"
  | "POST /api/sites/scan"
  | "POST /api/sites/scan/cancel"
  | "POST /api/sites/add"
  | "GET /api/sites/:siteId/thumbnail"
  | "POST /api/sites/:siteId/presence"
  | "GET /api/sites/:siteId/connections"
  | "PUT /api/sites/:siteId/secrets/:name"
  | "PUT /api/sites/:siteId/author"
  | "GET /api/sites/:siteId/usage"
  | "GET /api/usage/sites"
>;

const ok = { ok: true } as const;
const GROUP_COLORS: [SiteGroupColor, ...SiteGroupColor[]] = ["ink", "pencil", "green", "ochre", "rose", "sky", "plum"];
/** At most this many scans at once; a scan is cheap but walks the disk. */
const MAX_SCANS = 4;
const scans = new Map<string, AbortController>();

const groupBody = z.object({ name: z.string().max(200).optional(), color: z.enum(GROUP_COLORS).optional(), collapsed: z.boolean().optional() });
const orderBody = z.object({ ids: z.array(z.string().min(1).max(64)).max(500) });
const listingBody = z.object({ group: z.string().max(64).nullable().optional(), pinned: z.boolean().optional(), note: z.string().max(2000).nullable().optional() });
const scanBody = z.object({ path: z.string().trim().min(1, "it can't be empty").max(4096), depth: z.number().int().min(1).max(2).optional(), id: z.string().min(8).max(64).optional() });
const cancelBody = z.object({ id: z.string().min(1).max(64) });
const addBody = z.object({ paths: z.array(z.string().min(1).max(4096)).min(1, "choose at least one site").max(500), group: z.string().max(64).optional() });
const authorBody = z.object({ author: z.object({ name: z.string().max(200), email: z.string().max(320) }).nullable() });

function unsupported(): never {
  throw notFound("This server doesn't keep groups or per-site settings.");
}

/** The site id in the path, when it is a site in the list. Never opens the site. */
async function knownSite(c: Context, ctx: RouteContext): Promise<string> {
  const id = c.req.param("siteId") ?? "";

  if (!(await ctx.services.registry.list()).some((site) => site.id === id)) throw notFound("That site isn't in the list any more.");
  return id;
}

/** Only status, source and last four characters ever leave — whatever the settings service returns. */
export function publicConnections(value: SiteConnections): SiteConnections {
  const hint = (text: unknown) => (typeof text === "string" ? { hint: text.slice(-4) } : {});

  return {
    siteId: value.siteId,
    secrets: value.secrets.map((secret) => ({
      name: secret.name,
      inUse: secret.inUse ?? null,
      ...hint(secret.hint),
      site: { configured: Boolean(secret.site.configured), ...hint(secret.site.hint) },
      shared: { configured: Boolean(secret.shared.configured), source: secret.shared.source ?? null, ...hint(secret.shared.hint) },
    })),
    author: {
      name: value.author.name,
      email: value.author.email,
      inUse: value.author.inUse === "site" ? "site" : "shared",
      site: value.author.site ? { name: value.author.site.name, email: value.author.site.email } : null,
    },
  };
}

/** An error about a key, with the key cut out of everything that could be shown or logged. */
function redacted(error: unknown, secret: string): unknown {
  const scrub = (text: string | undefined) => text?.split(secret).join("[redacted]");

  if (error instanceof GalleyError) return new GalleyError(error.code, scrub(error.message)!, scrub(error.detail));
  return new Error(scrub(error instanceof Error ? error.message : String(error)));
}

/** A path from the page, made real and kept inside the sites folder in hosted mode — what POST /api/sites/open does. */
async function realFolder(ctx: RouteContext, path: string): Promise<string> {
  const real = await realDirectory(path, ctx.options.confineSitesTo ?? homedir());

  if (ctx.options.confineSitesTo) {
    await assertInside(ctx.options.confineSitesTo, isAbsolute(real) ? real : join(ctx.options.confineSitesTo, real), "Sites can only be kept in this server's sites folder.");
  }
  return real;
}

export const multiSiteRoutes: Pick<RouteTable, MultiSiteRouteKey> = {
  "GET /api/groups": async (_c, ctx) => (ctx.services.registry.groups ? ctx.services.registry.groups() : []),
  "POST /api/groups": async (c, ctx) => {
    const body = await v.body(c, groupBody);

    return ctx.services.registry.createGroup ? ctx.services.registry.createGroup(body) : unsupported();
  },
  "PATCH /api/groups/:groupId": async (c, ctx) => {
    const body = await v.body(c, groupBody);

    return ctx.services.registry.updateGroup ? ctx.services.registry.updateGroup(c.req.param("groupId") ?? "", body) : unsupported();
  },
  "DELETE /api/groups/:groupId": async (c, ctx) => {
    if (!ctx.services.registry.removeGroup) unsupported();
    await ctx.services.registry.removeGroup(c.req.param("groupId") ?? "");
    return ok;
  },
  "PUT /api/groups/order": async (c, ctx) => {
    const { ids } = await v.body(c, orderBody);

    return ctx.services.registry.orderGroups ? ctx.services.registry.orderGroups(ids) : unsupported();
  },
  "PATCH /api/sites/:siteId/listing": async (c, ctx) => {
    const body = await v.body(c, listingBody);

    return ctx.services.registry.update ? ctx.services.registry.update(c.req.param("siteId") ?? "", body) : unsupported();
  },

  "POST /api/sites/scan": async (c, ctx) => {
    if (!ctx.services.registry.scan) unsupported();
    const request = await v.body(c, scanBody);
    const path = await realFolder(ctx, request.path);

    if (scans.size >= MAX_SCANS) throw new GalleyError("busy", "Other folders are being searched right now. Wait for them to finish, then try again.");
    const controller = new AbortController();
    const id = request.id ?? `scan-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // The page going away (a closed dialog, a reload) cancels it too.
    const onAbort = () => controller.abort();

    c.req.raw.signal?.addEventListener("abort", onAbort);
    scans.set(id, controller);
    try {
      return await ctx.services.registry.scan({ path, ...(request.depth ? { depth: request.depth } : {}) }, controller.signal);
    } finally {
      scans.delete(id);
      c.req.raw.signal?.removeEventListener("abort", onAbort);
    }
  },
  "POST /api/sites/scan/cancel": async (c) => {
    const { id } = await v.body(c, cancelBody);

    scans.get(id)?.abort();
    return ok;
  },
  "POST /api/sites/add": async (c, ctx) => {
    if (!ctx.services.registry.addMany) unsupported();
    const request = await v.body(c, addBody);
    const real: string[] = [];
    const skipped: AddSitesResult["skipped"] = [];

    for (const path of request.paths) {
      try {
        real.push(await realFolder(ctx, path));
      } catch (error) {
        skipped.push({ path, reason: error instanceof GalleyError ? error.message : "That folder can't be added." });
      }
    }
    if (real.length === 0) return { added: [], skipped };
    const result = await ctx.services.registry.addMany({ paths: real, ...(request.group ? { group: request.group } : {}) });

    return { added: result.added, skipped: [...skipped, ...result.skipped] };
  },
  "GET /api/sites/:siteId/thumbnail": async (c, ctx) => {
    const file = ctx.services.registry.thumbnail ? await ctx.services.registry.thumbnail(c.req.param("siteId") ?? "") : null;

    if (!file) throw notFound("This site has no picture to show.");
    const info = await stat(file.path);

    return new Response(Readable.toWeb(createReadStream(file.path)) as ReadableStream<Uint8Array>, {
      status: 200,
      headers: {
        "content-type": file.type,
        "content-length": String(info.size),
        "x-content-type-options": "nosniff",
        // Same as every file the API streams: nothing in it may run (an SVG included).
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "cross-origin-resource-policy": "same-origin",
        "cache-control": "private, max-age=300",
      },
    });
  },
  "POST /api/sites/:siteId/presence": async (c, ctx) => {
    ctx.services.registry.touch?.(c.req.param("siteId") ?? "");
    return ok;
  },

  "GET /api/sites/:siteId/connections": async (c, ctx) => {
    const id = await knownSite(c, ctx);

    return ctx.services.settings.siteConnections ? publicConnections(await ctx.services.settings.siteConnections(id)) : unsupported();
  },
  "PUT /api/sites/:siteId/secrets/:name": async (c, ctx) => {
    const id = await knownSite(c, ctx);
    const name = c.req.param("name") ?? "";

    if (!SECRET_NAMES.includes(name as SecretName)) throw invalid(`“${name.slice(0, 40)}” isn't a key this app stores.`);
    if (!ctx.services.settings.setSiteSecret) unsupported();
    const { value } = await v.body(c, v.secretBody);

    try {
      return publicConnections(await ctx.services.settings.setSiteSecret(id, name as SecretName, value));
    } catch (error) {
      throw value ? redacted(error, value) : error;
    }
  },
  "PUT /api/sites/:siteId/author": async (c, ctx) => {
    const id = await knownSite(c, ctx);
    const { author } = await v.body(c, authorBody);

    return ctx.services.settings.setSiteAuthor ? publicConnections(await ctx.services.settings.setSiteAuthor(id, author)) : unsupported();
  },
  "GET /api/sites/:siteId/usage": async (c, ctx) => ctx.services.settings.usage({ siteId: await knownSite(c, ctx) }),
  "GET /api/usage/sites": async (_c, ctx) => ({ sites: ctx.services.settings.usageBySite ? await ctx.services.settings.usageBySite() : [] }),
};
