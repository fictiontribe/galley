/**
 * Multilingual / i18n over HTTP: overview, language & routing configuration,
 * side-by-side manual editing context, Translation Memory, Glossary, and
 * automatic AI translation jobs with upfront cost & credit previews.
 */
import { z } from "zod";
import { createI18nService, type I18nService } from "@galley/core/i18n";
import type { SiteService } from "@galley/core/types";
import { notFound } from "./errors";
import type { RouteContext, RouteTable } from "./routes";
import type { Services } from "./types";
import * as v from "./validate";

type I18nRouteKey =
  | "GET /api/sites/:siteId/i18n"
  | "PUT /api/sites/:siteId/i18n/config"
  | "GET /api/sites/:siteId/i18n/entry"
  | "POST /api/sites/:siteId/i18n/entry/create"
  | "GET /api/sites/:siteId/i18n/glossary"
  | "PUT /api/sites/:siteId/i18n/glossary"
  | "GET /api/sites/:siteId/i18n/memory"
  | "PUT /api/sites/:siteId/i18n/memory"
  | "POST /api/sites/:siteId/i18n/translate/plan"
  | "POST /api/sites/:siteId/i18n/translate"
  | "GET /api/sites/:siteId/i18n/translate/:jobId"
  | "POST /api/sites/:siteId/i18n/translate/:jobId/cancel";

const LOCALE_CODE = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/;
const LOCALE_PREFIX = /^[a-z0-9][a-z0-9-]{0,31}$/;

const localeSchema = z
  .object({
    code: z.string().regex(LOCALE_CODE, "must be a BCP-47 language code like “en” or “es”"),
    label: z.string().trim().min(1).max(60),
    prefix: z.string().regex(LOCALE_PREFIX, "must be lowercase letters, digits and dashes").optional(),
    direction: z.enum(["ltr", "rtl"]).optional(),
  })
  .strict();

export const i18nConfigBody = z
  .object({
    defaultLocale: z.string().regex(LOCALE_CODE, "must be a BCP-47 language code like “en”"),
    locales: z.array(localeSchema).min(1).max(50),
    strategy: z.enum(["folder", "suffix"]).optional(),
    prefixDefaultLocale: z.boolean().optional(),
    localizeSlugs: z.boolean().optional(),
    syncAstroConfig: z.boolean().optional(),
  })
  .strict();

export const i18nEntryQuery = z.object({ path: z.string().min(1).max(1024) });

export const i18nCreateEntryBody = z
  .object({
    sourcePath: z.string().min(1).max(1024),
    targetLocale: z.string().regex(LOCALE_CODE, "must be a BCP-47 language code"),
    localizedSlug: z.string().trim().min(1).max(200).optional(),
    applyMemory: z.boolean().optional(),
  })
  .strict();

export const i18nGlossaryBody = z
  .object({
    version: z.literal(1),
    terms: z
      .array(
        z
          .object({
            id: z.string().max(100),
            term: z.string().trim().min(1).max(200),
            doNotTranslate: z.boolean().optional(),
            translations: z.record(z.string().min(1).max(20), z.string().max(400)).optional(),
            note: z.string().max(400).optional(),
          })
          .strict()
      )
      .max(2000),
  })
  .strict();

export const i18nMemoryBody = z
  .object({
    version: z.literal(1),
    entries: z
      .array(
        z
          .object({
            id: z.string().max(100),
            sourceLocale: z.string().min(1).max(20),
            targetLocale: z.string().min(1).max(20),
            source: z.string().min(1).max(20_000),
            target: z.string().min(1).max(20_000),
            updatedAt: z.string().max(64),
          })
          .strict()
      )
      .max(20_000),
  })
  .strict();

export const i18nTranslateBody = z
  .object({
    paths: z.array(z.string().min(1).max(1024)).max(500).optional(),
    collections: z.array(z.string().min(1).max(120)).max(50).optional(),
    targetLocales: z.array(z.string().regex(LOCALE_CODE)).min(1).max(50),
    mode: z.enum(["missing_and_outdated", "missing_only", "all"]).optional(),
    translateSlugs: z.boolean().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();

const fallback = new WeakMap<Services, I18nService>();

function i18nOf(ctx: RouteContext): I18nService {
  const own = ctx.services.i18n;

  if (own) return own;
  let made = fallback.get(ctx.services);

  if (!made) {
    made = createI18nService({ settings: ctx.services.settings, events: ctx.services.events, env: ctx.options.env });
    fallback.set(ctx.services, made);
  }
  return made;
}

async function siteOf(c: Parameters<RouteTable["GET /api/sites/:siteId"]>[0], ctx: RouteContext): Promise<SiteService> {
  const site = await ctx.services.registry.get(c.req.param("siteId") ?? "");

  if (!site) throw notFound("That site isn't open here. Open it again from the Sites screen.");
  return site;
}

function jobOf(ctx: RouteContext, jobId: string) {
  const status = i18nOf(ctx).translationStatus(jobId);

  if (!status) throw notFound("That translation run isn't known here. Finished pages are waiting in Proof.");
  return status;
}

export const i18nRoutes: Pick<RouteTable, I18nRouteKey> = {
  "GET /api/sites/:siteId/i18n": async (c, ctx) => i18nOf(ctx).overview(await siteOf(c, ctx)),
  "PUT /api/sites/:siteId/i18n/config": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const body = await v.body(c, i18nConfigBody);

    return i18nOf(ctx).saveConfig(site, body);
  },
  "GET /api/sites/:siteId/i18n/entry": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const { path } = v.query(c, i18nEntryQuery);

    return i18nOf(ctx).entryDetail(site, path);
  },
  "POST /api/sites/:siteId/i18n/entry/create": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const body = await v.body(c, i18nCreateEntryBody);

    return i18nOf(ctx).createEntry(site, body);
  },
  "GET /api/sites/:siteId/i18n/glossary": async (c, ctx) => i18nOf(ctx).getGlossary(await siteOf(c, ctx)),
  "PUT /api/sites/:siteId/i18n/glossary": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const body = await v.body(c, i18nGlossaryBody);

    return i18nOf(ctx).saveGlossary(site, body);
  },
  "GET /api/sites/:siteId/i18n/memory": async (c, ctx) => i18nOf(ctx).getMemory(await siteOf(c, ctx)),
  "PUT /api/sites/:siteId/i18n/memory": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const body = await v.body(c, i18nMemoryBody);

    return i18nOf(ctx).saveMemory(site, body);
  },
  "POST /api/sites/:siteId/i18n/translate/plan": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const body = await v.body(c, i18nTranslateBody);

    return i18nOf(ctx).planTranslation(site, body);
  },
  "POST /api/sites/:siteId/i18n/translate": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const body = await v.body(c, i18nTranslateBody);

    return i18nOf(ctx).startTranslation(site, body);
  },
  "GET /api/sites/:siteId/i18n/translate/:jobId": async (c, ctx) => {
    await siteOf(c, ctx);
    return jobOf(ctx, c.req.param("jobId") ?? "");
  },
  "POST /api/sites/:siteId/i18n/translate/:jobId/cancel": async (c, ctx) => {
    await siteOf(c, ctx);
    jobOf(ctx, c.req.param("jobId") ?? "");
    i18nOf(ctx).cancelTranslation(c.req.param("jobId") ?? "");
    return { ok: true as const };
  },
};
