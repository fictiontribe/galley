/**
 * Plugins and video over HTTP: the plugin list (with what each adds, its
 * problems and its settings — secrets as status only), enabling and
 * disabling, saving a plugin's settings, the merged catalogues the app
 * chooses from, and video generation as a job. Behind the usual session and
 * Origin guards like every API route.
 */
import { z } from "zod";
import type { PluginCatalog } from "@galley/core/api";
import { GalleyError } from "@galley/core";
import { BUILTIN_PLUGIN_NAME, ensureSitePlugins, type PluginRegistry } from "@galley/core/plugins";
import { FORM_PROVIDERS, SCRIPT_INTEGRATIONS } from "@galley/core/kit-catalog";
import type { SiteService } from "@galley/core/types";
import type { Context } from "hono";
import { notFound } from "./errors";
import type { RouteContext, RouteTable } from "./routes";
import * as v from "./validate";

type PluginRouteKey =
  | "GET /api/plugins"
  | "GET /api/sites/:siteId/plugins"
  | "POST /api/plugins/enabled"
  | "PUT /api/plugins/settings"
  | "GET /api/catalog"
  | "GET /api/sites/:siteId/catalog"
  | "GET /api/videos/providers"
  | "POST /api/sites/:siteId/videos/generate"
  | "GET /api/videos/jobs/:jobId"
  | "GET /api/videos/candidates/:candidateId"
  | "POST /api/sites/:siteId/videos/save"
  | "DELETE /api/videos/candidates/:candidateId";

/** Same policy as every file the API streams: nothing in it may run. */
const FILE_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
const name = z.string().trim().min(1, "it can't be empty").max(214);
const siteId = z.string().trim().min(1).max(200).optional();

export const pluginEnabledBody = z.object({ name, enabled: z.boolean(), siteId }).strict();
export const pluginSettingsBody = z
  .object({
    name,
    values: z.record(z.string().min(1).max(64), z.string().max(4000).nullable()).refine((values) => Object.keys(values).length <= 50, "too many settings at once"),
    siteId,
  })
  .strict();
export const videoGenBody = z
  .object({
    prompt: z.string().trim().min(1).max(4000),
    provider: z.string().max(100).optional(),
    model: z.string().max(200).optional(),
    aspect: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]).optional(),
    durationSeconds: z.number().int().min(1).max(60).optional(),
    resolution: z.string().max(20).optional(),
    firstFramePath: v.repoPath.optional(),
    audio: z.boolean().optional(),
    brandDirection: z.string().max(2000).optional(),
  })
  .strict();
export const videoSaveBody = z
  .object({ candidateId: z.string().trim().min(1).max(100), directory: v.repoPath.optional(), filename: z.string().trim().min(1).max(200).optional() })
  .strict();

const ok = { ok: true } as const;

async function siteOf(c: Context, ctx: RouteContext): Promise<SiteService> {
  const site = await ctx.services.registry.get(c.req.param("siteId") ?? "");

  if (!site) throw notFound("That site isn't open here. Open it again from the Sites screen.");
  return site;
}

function pluginsOf(ctx: RouteContext): PluginRegistry {
  if (!ctx.services.plugins) throw notFound("Plugins aren't available on this server.");
  return ctx.services.plugins;
}

function videosOf(ctx: RouteContext) {
  if (!ctx.services.videos) throw notFound("Video generation isn't available on this server.");
  return ctx.services.videos;
}

/** The site a request names (and its own plugins, loaded) — or none. */
async function scope(ctx: RouteContext, id: string | undefined): Promise<SiteService | null> {
  if (!id) return null;
  const site = await ctx.services.registry.get(id);

  if (!site) throw notFound("That site isn't open here. Open it again from the Sites screen.");
  if (ctx.services.plugins) await ensureSitePlugins(ctx.services.plugins, site);
  return site;
}

/** A value someone typed, cut out of anything an error could show or log. */
function redacted(error: unknown, values: Record<string, string | null>): unknown {
  const secrets = Object.values(values).filter((value): value is string => typeof value === "string" && value.length >= 4);
  const scrub = (text: string | undefined) => secrets.reduce((out, secret) => out?.split(secret).join("[redacted]"), text);

  if (error instanceof GalleyError) return new GalleyError(error.code, scrub(error.message)!, scrub(error.detail));
  return new Error(scrub(error instanceof Error ? error.message : String(error)));
}

async function catalog(ctx: RouteContext, site: SiteService | null): Promise<PluginCatalog> {
  const plugins = ctx.services.plugins;
  const root = site?.root ?? null;
  const builtin = <T extends object>(items: T[]) => items.map((item) => ({ ...item, plugin: BUILTIN_PLUGIN_NAME }));

  return {
    formProviders: plugins ? plugins.formProviders(root) : builtin(FORM_PROVIDERS),
    scriptIntegrations: plugins ? plugins.scriptIntegrations(root) : builtin(SCRIPT_INTEGRATIONS),
    imageProviders: await ctx.services.images.providers(),
    videoProviders: ctx.services.videos ? await ctx.services.videos.providers() : [],
    importers: plugins ? plugins.importers(root) : [],
    deployTargets: plugins ? plugins.deployTargets(root) : [],
    editorHosts: plugins ? plugins.editorHosts(root) : [],
    dataSources: plugins ? plugins.dataSources(root) : [],
  };
}

export const pluginRoutes: Pick<RouteTable, PluginRouteKey> = {
  "GET /api/plugins": async (_c, ctx) => {
    const plugins = ctx.services.plugins;

    return plugins ? { plugins: await plugins.list(null), conflicts: plugins.conflicts(null) } : { plugins: [], conflicts: [] };
  },
  "GET /api/sites/:siteId/plugins": async (c, ctx) => {
    const site = await scope(ctx, (await siteOf(c, ctx)).id);
    const plugins = pluginsOf(ctx);

    return { plugins: await plugins.list(site!.root), conflicts: plugins.conflicts(site!.root) };
  },
  "POST /api/plugins/enabled": async (c, ctx) => {
    const plugins = pluginsOf(ctx);
    const request = await v.body(c, pluginEnabledBody);
    const site = await scope(ctx, request.siteId);

    if (!(await plugins.setEnabled(request.name, request.enabled))) throw notFound(`There is no plugin called “${request.name.slice(0, 80)}” here.`);
    const info = await plugins.info(request.name, site?.root ?? null);

    if (!info) throw notFound(`There is no plugin called “${request.name.slice(0, 80)}” here.`);
    return info;
  },
  "PUT /api/plugins/settings": async (c, ctx) => {
    const plugins = pluginsOf(ctx);
    const request = await v.body(c, pluginSettingsBody);
    const site = await scope(ctx, request.siteId);

    try {
      return await plugins.saveSettings(request.name, request.values, site?.root ?? null);
    } catch (error) {
      throw redacted(error, request.values);
    }
  },
  "GET /api/catalog": async (_c, ctx) => catalog(ctx, null),
  "GET /api/sites/:siteId/catalog": async (c, ctx) => catalog(ctx, await scope(ctx, (await siteOf(c, ctx)).id)),

  "GET /api/videos/providers": async (_c, ctx) => ({ providers: ctx.services.videos ? await ctx.services.videos.providers() : [] }),
  "POST /api/sites/:siteId/videos/generate": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    return videosOf(ctx).generate(site, await v.body(c, videoGenBody));
  },
  "GET /api/videos/jobs/:jobId": async (c, ctx) => {
    const status = await videosOf(ctx).status(c.req.param("jobId") ?? "");

    if (!status) throw notFound("That video isn't known here. It may have finished before the app restarted.");
    return status;
  },
  "GET /api/videos/candidates/:candidateId": async (c, ctx) => {
    const candidate = await videosOf(ctx).read(c.req.param("candidateId") ?? "");

    if (!candidate) throw notFound("That video is no longer available. Make it again.");
    const type = /^video\/[a-z0-9.+-]+$/i.test(candidate.mime) ? candidate.mime : "application/octet-stream";

    return new Response(candidate.data as unknown as ConstructorParameters<typeof Response>[0], {
      status: 200,
      headers: {
        "content-type": type,
        "content-length": String(candidate.data.byteLength),
        "x-content-type-options": "nosniff",
        "content-security-policy": FILE_CSP,
        "cross-origin-resource-policy": "same-origin",
        "cache-control": "private, max-age=3600",
      },
    });
  },
  "POST /api/sites/:siteId/videos/save": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    return videosOf(ctx).save(site, await v.body(c, videoSaveBody), "user");
  },
  "DELETE /api/videos/candidates/:candidateId": async (c, ctx) => {
    await videosOf(ctx).discard(c.req.param("candidateId") ?? "");
    return ok;
  },
};
