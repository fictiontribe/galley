/**
 * Multilingual / i18n mock handlers for the dev server and in-browser /demo/.
 *
 * Seeds realistic English / Español / Français data on the demo site with
 * localized URL slugs, outdated-page detection, Translation Memory hits,
 * Glossary rules, upfront cost/credit plans, and live simulated translation jobs.
 */
import type {
  GlossaryFile,
  I18nConfigUpdate,
  I18nCounterpart,
  I18nCreateEntryResult,
  I18nEntryDetail,
  I18nLocaleSummary,
  I18nOverview,
  I18nPageRow,
  I18nPageVariant,
  TranslationJobItem,
  TranslationJobStatus,
  TranslationMemoryFile,
  TranslationPlan,
  TranslationPlanItem,
  TranslationState,
} from "@galley/core/i18n/types";
import type { I18nConfig, Job, JsonValue } from "@galley/core/types";
import type { Handlers, MockBackend } from "./backend.ts";
import { MockError, type MockSite } from "./site.ts";

interface MockVariant {
  path: string;
  locale: string;
  localizedSlug: string;
  state: TranslationState;
  updatedAt: string;
}

interface MockI18nState {
  config: I18nConfig;
  /** sourcePath -> localeCode -> variant */
  variants: Map<string, Map<string, MockVariant>>;
  glossary: GlossaryFile;
  memory: TranslationMemoryFile;
  jobs: Map<string, TranslationJobStatus>;
}

const CREDIT_MILLICENTS = 250;

function usdToCredits(usd: number): number {
  if (usd <= 0) return 0;
  return Math.max(1, Math.ceil(Math.round(usd * 100_000) / CREDIT_MILLICENTS));
}

function slugUrl(collectionUrl: string | null, slug: string, locale: string, config: I18nConfig): string | null {
  if (!collectionUrl) return null;
  const trailing = collectionUrl.endsWith("/");
  const clean = slug.replace(/^\/+|\/+$/g, "");
  let base = collectionUrl.replace("{slug}", clean).replace(/(^|\/)index\/?$/i, "$1");

  if (!base.startsWith("/")) base = `/${base}`;
  base = base.replace(/\/{2,}/g, "/");
  const isDefault = locale.toLowerCase() === config.defaultLocale.toLowerCase();
  const loc = config.locales.find((item) => item.code.toLowerCase() === locale.toLowerCase());
  const prefix = (loc?.prefix ?? locale).toLowerCase();
  const usePrefix = !isDefault || Boolean(config.prefixDefaultLocale);
  let full = usePrefix ? `/${prefix}${base === "/" ? "/" : base}` : base;

  full = full.replace(/\/{2,}/g, "/");
  if (full !== "/") full = trailing ? (full.endsWith("/") ? full : `${full}/`) : full.replace(/\/+$/, "");
  return full;
}

function demoSlug(baseSlug: string, locale: string): string {
  const leaf = baseSlug.split("/").pop()?.toLowerCase() ?? "";

  if (leaf === "index") return baseSlug;
  const es: Record<string, string> = {
    about: "sobre-nosotros",
    pricing: "precios",
    contact: "contacto",
    work: "trabajo",
    services: "servicios",
    visit: "visita",
    journal: "diario",
  };
  const fr: Record<string, string> = {
    about: "a-propos",
    pricing: "tarifs",
    contact: "contact",
    work: "projets",
    services: "services",
    visit: "visiter",
    journal: "journal",
  };
  const map = locale.toLowerCase().startsWith("es") ? es : locale.toLowerCase().startsWith("fr") ? fr : null;

  return map?.[leaf] ?? baseSlug;
}

function seedState(site: MockSite): MockI18nState {
  const model = site.model();
  const config: I18nConfig = model.i18n ?? {
    defaultLocale: "en",
    locales: [
      { code: "en", label: "English", direction: "ltr" },
      { code: "es", label: "Español", direction: "ltr" },
      { code: "fr", label: "Français", direction: "ltr" },
    ],
    strategy: "folder",
    prefixDefaultLocale: false,
    localizeSlugs: true,
  };

  const variants = new Map<string, Map<string, MockVariant>>();
  const entryCollections = model.collections.filter((c) => c.kind === "entries" && !c.kit && !c.hidden);
  const now = new Date().toISOString();
  let idx = 0;

  for (const col of entryCollections) {
    const items = site.listEntries(col.id).items;

    for (const item of items) {
      const map = new Map<string, MockVariant>();

      // Seed realistic mixed coverage so the matrix, outdated badges, and cost estimator shine immediately!
      if (idx === 0 || idx === 1) {
        const esSlug = demoSlug(item.slug, "es");
        const esPath = `${col.path}/es/${esSlug}.md`;

        map.set("es", {
          path: esPath,
          locale: "es",
          localizedSlug: esSlug,
          state: idx === 1 ? "outdated" : "translated",
          updatedAt: now,
        });
      }
      if (idx === 0) {
        const frSlug = demoSlug(item.slug, "fr");
        const frPath = `${col.path}/fr/${frSlug}.md`;

        map.set("fr", {
          path: frPath,
          locale: "fr",
          localizedSlug: frSlug,
          state: "translated",
          updatedAt: now,
        });
      }
      variants.set(item.path, map);
      idx += 1;
    }
  }

  return {
    config,
    variants,
    glossary: {
      version: 1,
      terms: [
        { id: "brand-name", term: model.name, doNotTranslate: true, note: "Brand name — keep as written across languages." },
        { id: "proof", term: "Proof", doNotTranslate: false, translations: { es: "Prueba", fr: "Épreuve" }, note: "Editorial review stage." },
      ],
    },
    memory: {
      version: 1,
      entries: [
        { id: "tm-1", sourceLocale: "en", targetLocale: "es", source: "Get in touch", target: "Ponte en contacto", updatedAt: now },
        { id: "tm-2", sourceLocale: "en", targetLocale: "es", source: "Read more", target: "Leer más", updatedAt: now },
        { id: "tm-3", sourceLocale: "en", targetLocale: "fr", source: "Get in touch", target: "Nous contacter", updatedAt: now },
        { id: "tm-4", sourceLocale: "en", targetLocale: "fr", source: "Read more", target: "En savoir plus", updatedAt: now },
      ],
    },
    jobs: new Map(),
  };
}

export function createMockI18n(mock: MockBackend) {
  const states = new Map<string, MockI18nState>();

  const stateOf = (siteId: string): { site: MockSite; state: MockI18nState } => {
    const site = mock.site(siteId);
    let state = states.get(siteId);

    if (!state) {
      state = seedState(site);
      states.set(siteId, state);
    }
    return { site, state };
  };

  const sourceEntriesOf = (site: MockSite, state: MockI18nState) => {
    const model = site.model();
    const cols = model.collections.filter((c) => c.kind === "entries" && !c.kit && !c.hidden);
    const nonDefaultPrefixes = new Set(
      state.config.locales
        .filter((l) => l.code.toLowerCase() !== state.config.defaultLocale.toLowerCase())
        .map((l) => (l.prefix ?? l.code).toLowerCase())
    );
    const out: Array<{ path: string; collection: string; collectionLabel: string; collectionUrl: string | null; slug: string; title: string; modifiedAt: number }> = [];

    for (const col of cols) {
      for (const item of site.listEntries(col.id).items) {
        const firstSeg = item.slug.split("/")[0]?.toLowerCase() ?? "";

        if (item.slug.includes("/") && nonDefaultPrefixes.has(firstSeg)) continue;
        out.push({
          path: item.path,
          collection: col.id,
          collectionLabel: col.label,
          collectionUrl: col.url,
          slug: item.slug,
          title: item.title,
          modifiedAt: item.modifiedAt,
        });
      }
    }
    return out;
  };

  const buildOverview = (siteId: string): I18nOverview => {
    const { site, state } = stateOf(siteId);
    const sources = sourceEntriesOf(site, state);
    const counts = new Map<string, { translated: number; outdated: number; missing: number }>();

    for (const loc of state.config.locales) counts.set(loc.code.toLowerCase(), { translated: 0, outdated: 0, missing: 0 });

    const pages: I18nPageRow[] = sources.map((src) => {
      const sourceUrl = slugUrl(src.collectionUrl, src.slug, state.config.defaultLocale, state.config);
      const variants: Record<string, I18nPageVariant> = {};
      const varMap = state.variants.get(src.path) ?? new Map<string, MockVariant>();

      for (const loc of state.config.locales) {
        const key = loc.code.toLowerCase();
        const bucket = counts.get(key)!;

        if (key === state.config.defaultLocale.toLowerCase()) {
          bucket.translated += 1;
          variants[loc.code] = {
            locale: loc.code,
            state: "translated",
            path: src.path,
            url: sourceUrl,
            localizedSlug: src.slug,
            updatedAt: new Date(src.modifiedAt).toISOString(),
          };
          continue;
        }
        const existing = varMap.get(key);

        if (existing) {
          bucket[existing.state] += 1;
          variants[loc.code] = {
            locale: loc.code,
            state: existing.state,
            path: existing.path,
            url: slugUrl(src.collectionUrl, existing.localizedSlug, loc.code, state.config),
            localizedSlug: existing.localizedSlug,
            updatedAt: existing.updatedAt,
          };
        } else {
          bucket.missing += 1;
          variants[loc.code] = {
            locale: loc.code,
            state: "missing",
            path: null,
            url: null,
            localizedSlug: null,
            updatedAt: null,
          };
        }
      }
      return {
        sourcePath: src.path,
        collection: src.collection,
        collectionLabel: src.collectionLabel,
        title: src.title,
        sourceSlug: src.slug,
        sourceUrl,
        variants,
      };
    });

    const total = sources.length;
    const locales: I18nLocaleSummary[] = state.config.locales.map((loc) => {
      const isDefault = loc.code.toLowerCase() === state.config.defaultLocale.toLowerCase();
      const bucket = counts.get(loc.code.toLowerCase())!;
      const prefix = (loc.prefix ?? loc.code).toLowerCase();

      return {
        code: loc.code,
        label: loc.label,
        prefix,
        direction: loc.direction ?? "ltr",
        isDefault,
        translated: bucket.translated,
        outdated: bucket.outdated,
        missing: bucket.missing,
        total,
        percent: total === 0 ? 100 : Math.round((bucket.translated / total) * 100),
        urlPattern: isDefault && !state.config.prefixDefaultLocale ? "/…" : `/${prefix}/…`,
      };
    });

    return {
      configured: state.config.locales.length >= 2,
      config: state.config,
      astroDetected: false,
      hasAstroConfig: site.model().framework.id === "astro",
      locales,
      pages,
      memoryCount: state.memory.entries.length,
      glossaryCount: state.glossary.terms.length,
      totalSourcePages: total,
    };
  };

  const buildPlan = (siteId: string, body: Parameters<Handlers["POST /api/sites/:siteId/i18n/translate/plan"]>[0]["body"]): TranslationPlan => {
    const { site, state } = stateOf(siteId);
    const sources = sourceEntriesOf(site, state);
    const mode = body.mode ?? "missing_and_outdated";
    const translateSlugs = body.translateSlugs ?? (state.config.localizeSlugs !== false);
    const wantedPaths = body.paths?.length ? new Set(body.paths) : null;
    const wantedCols = body.collections?.length ? new Set(body.collections) : null;
    const targetLocales = body.targetLocales
      .map((code) => state.config.locales.find((l) => l.code.toLowerCase() === code.toLowerCase()))
      .filter((l): l is NonNullable<typeof l> => l !== undefined && l.code.toLowerCase() !== state.config.defaultLocale.toLowerCase());

    const items: TranslationPlanItem[] = [];

    for (const src of sources) {
      if (wantedPaths && !wantedPaths.has(src.path)) continue;
      if (wantedCols && !wantedCols.has(src.collection)) continue;
      const entry = site.readEntry(src.path);
      const rawWords = `${entry.title} ${entry.body ?? ""}`.trim().split(/\s+/).filter(Boolean).length;
      const sourceWords = Math.max(40, rawWords);
      const totalSegments = Math.max(4, Math.min(18, Math.round(sourceWords / 25) + 3));

      for (const loc of targetLocales) {
        const existing = state.variants.get(src.path)?.get(loc.code.toLowerCase());
        const st: TranslationState = existing ? existing.state : "missing";

        if (mode === "missing_only" && st !== "missing") continue;
        if (mode === "missing_and_outdated" && st === "translated") continue;
        const tmHits = Math.min(totalSegments - 1, Math.min(2, state.memory.entries.filter((e) => e.targetLocale.toLowerCase() === loc.code.toLowerCase()).length));
        const segmentsToTranslate = Math.max(0, totalSegments - tmHits);
        const needsAi = segmentsToTranslate > 0;
        const estimatedInputTokens = needsAi ? 420 + Math.round(sourceWords * 1.45) : 0;
        const estimatedOutputTokens = needsAi ? Math.round(sourceWords * 1.8) + 90 : 0;
        const estimatedUsd = needsAi ? Math.round(((estimatedInputTokens * 4 + estimatedOutputTokens * 20) / 1_000_000) * 10_000) / 10_000 : 0;
        const estimatedCredits = needsAi ? usdToCredits(estimatedUsd) : 0;
        const localizedSlug = existing?.localizedSlug ?? (translateSlugs ? demoSlug(src.slug, loc.code) : src.slug);
        const prefix = (loc.prefix ?? loc.code).toLowerCase();

        items.push({
          sourcePath: src.path,
          targetPath: existing?.path ?? `${src.path.replace(/\/[^/]+$/, "")}/${prefix}/${localizedSlug}.md`,
          collection: src.collection,
          title: src.title,
          targetLocale: loc.code,
          targetLabel: loc.label,
          state: st,
          sourceSlug: src.slug,
          localizedSlug,
          sourceWords,
          totalSegments,
          tmHits,
          segmentsToTranslate,
          estimatedInputTokens,
          estimatedOutputTokens,
          estimatedUsd,
          estimatedCredits,
          needsAi,
        });
      }
    }

    const capped = items.slice(0, body.limit ?? items.length);
    const requests = capped.filter((i) => i.needsAi).length;
    const tmOnlyItems = capped.filter((i) => !i.needsAi).length;
    const estimatedUsd = Math.round(capped.reduce((s, i) => s + i.estimatedUsd, 0) * 10_000) / 10_000;
    const estimatedCredits = estimatedUsd > 0 ? usdToCredits(estimatedUsd) : 0;
    const tmHits = capped.reduce((s, i) => s + i.tmHits, 0);
    const tmSavedTokens = tmHits * 48;
    const tmSavedUsd = tmSavedTokens > 0 ? Math.round(((tmSavedTokens * 12) / 1_000_000) * 10_000) / 10_000 : 0;
    const tmSavedCredits = tmSavedUsd > 0 ? usdToCredits(tmSavedUsd) : 0;

    return {
      mode,
      model: mock.settings.ai.model,
      connected: Boolean(mock.secrets.anthropic?.configured),
      creditMillicents: CREDIT_MILLICENTS,
      translateSlugs,
      items: capped,
      totalItems: capped.length,
      requests,
      tmOnlyItems,
      sourceWords: capped.reduce((s, i) => s + i.sourceWords, 0),
      totalSegments: capped.reduce((s, i) => s + i.totalSegments, 0),
      tmHits,
      segmentsToTranslate: capped.reduce((s, i) => s + i.segmentsToTranslate, 0),
      tmSavedTokens,
      tmSavedUsd,
      tmSavedCredits,
      estimatedInputTokens: capped.reduce((s, i) => s + i.estimatedInputTokens, 0),
      estimatedOutputTokens: capped.reduce((s, i) => s + i.estimatedOutputTokens, 0),
      estimatedUsd,
      estimatedCredits,
      requiresConfirmation: estimatedCredits > 600,
      note:
        requests === 0 && capped.length > 0
          ? "Every segment matched Translation Memory — 0 AI credits and $0.00. Translations land in Proof for review."
          : "One AI request per page and language needing new translations. Exact Translation Memory matches are applied free. Everything waits in Proof; nothing is published automatically.",
    };
  };

  const handlers: Pick<
    Handlers,
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
    | "POST /api/sites/:siteId/i18n/translate/:jobId/cancel"
  > = {
    "GET /api/sites/:siteId/i18n": ({ params }) => buildOverview(params.siteId),

    "PUT /api/sites/:siteId/i18n/config": ({ params, body }) => {
      const { state } = stateOf(params.siteId);
      const { syncAstroConfig: _sync, ...rest } = body as I18nConfigUpdate;

      state.config = {
        defaultLocale: rest.defaultLocale,
        locales: rest.locales,
        strategy: rest.strategy ?? state.config.strategy ?? "folder",
        prefixDefaultLocale: rest.prefixDefaultLocale ?? state.config.prefixDefaultLocale ?? false,
        localizeSlugs: rest.localizeSlugs ?? state.config.localizeSlugs ?? true,
      };
      return buildOverview(params.siteId);
    },

    "GET /api/sites/:siteId/i18n/entry": ({ params, query }) => {
      const { site, state } = stateOf(params.siteId);
      const path = query.path ?? "";
      const sources = sourceEntriesOf(site, state);
      let source = sources.find((s) => s.path === path);
      let currentLocale = state.config.defaultLocale;
      let localizedSlug = source?.slug ?? "";
      let currentState: TranslationState = "translated";

      if (!source) {
        for (const [srcPath, map] of state.variants.entries()) {
          for (const variant of map.values()) {
            if (variant.path === path) {
              source = sources.find((s) => s.path === srcPath);
              currentLocale = variant.locale;
              localizedSlug = variant.localizedSlug;
              currentState = variant.state;
              break;
            }
          }
          if (source) break;
        }
      }

      if (!source) {
        throw new MockError("not-found", "That entry isn't part of a translatable collection.");
      }

      const sourceEntry = site.readEntry(source.path);
      const defaultLoc = state.config.locales.find((l) => l.code.toLowerCase() === state.config.defaultLocale.toLowerCase()) ?? state.config.locales[0]!;
      const curLoc = state.config.locales.find((l) => l.code.toLowerCase() === currentLocale.toLowerCase()) ?? defaultLoc;
      const isDefault = curLoc.code.toLowerCase() === defaultLoc.code.toLowerCase();
      const varMap = state.variants.get(source.path) ?? new Map<string, MockVariant>();
      const sourceUrl = slugUrl(source.collectionUrl, source.slug, defaultLoc.code, state.config);

      const counterparts: I18nCounterpart[] = state.config.locales.map((loc) => {
        const isDef = loc.code.toLowerCase() === defaultLoc.code.toLowerCase();

        if (isDef) {
          return {
            locale: loc.code,
            label: loc.label,
            prefix: (loc.prefix ?? loc.code).toLowerCase(),
            direction: loc.direction ?? "ltr",
            isDefault: true,
            state: "translated",
            path: source!.path,
            url: sourceUrl,
            localizedSlug: source!.slug,
          };
        }
        const v = varMap.get(loc.code.toLowerCase());

        return {
          locale: loc.code,
          label: loc.label,
          prefix: (loc.prefix ?? loc.code).toLowerCase(),
          direction: loc.direction ?? "ltr",
          isDefault: false,
          state: v?.state ?? "missing",
          path: v?.path ?? null,
          url: v ? slugUrl(source!.collectionUrl, v.localizedSlug, loc.code, state.config) : null,
          localizedSlug: v?.localizedSlug ?? null,
        };
      });

      const tmMatches: I18nEntryDetail["tmMatches"] = {};

      if (!isDefault) {
        for (const [key, val] of Object.entries(sourceEntry.data)) {
          if (typeof val !== "string") continue;
          const hit = state.memory.entries.find(
            (e) => e.targetLocale.toLowerCase() === curLoc.code.toLowerCase() && e.source.toLowerCase() === val.trim().toLowerCase()
          );

          if (hit) tmMatches[key] = { source: hit.source, target: hit.target, exact: true };
        }
      }

      return {
        configured: state.config.locales.length >= 2,
        path,
        locale: curLoc.code,
        localeLabel: curLoc.label,
        defaultLocale: defaultLoc.code,
        defaultLocaleLabel: defaultLoc.label,
        isDefault,
        sourcePath: source.path,
        sourceTitle: sourceEntry.title,
        sourceUrl,
        currentUrl: slugUrl(source.collectionUrl, localizedSlug || source.slug, curLoc.code, state.config),
        localizedSlug: localizedSlug || source.slug,
        state: isDefault ? "translated" : currentState,
        outdated: !isDefault && currentState === "outdated",
        counterparts,
        sourceData: isDefault ? null : (sourceEntry.data as Record<string, JsonValue>),
        sourceBody: isDefault ? null : sourceEntry.body,
        tmMatches,
        bodyTmMatches: [],
      };
    },

    "POST /api/sites/:siteId/i18n/entry/create": ({ params, body }) => {
      const { site, state } = stateOf(params.siteId);
      const sourceEntry = site.readEntry(body.sourcePath);
      const col = site.model().collections.find((c) => c.id === sourceEntry.collection);

      if (!col) throw new MockError("not-found", "Collection not found.");
      const loc = state.config.locales.find((l) => l.code.toLowerCase() === body.targetLocale.toLowerCase());

      if (!loc) throw new MockError("invalid", "Unknown target language.");
      const prefix = (loc.prefix ?? loc.code).toLowerCase();
      const localizedSlug = body.localizedSlug?.trim() || demoSlug(sourceEntry.slug, loc.code);
      const entrySlug = state.config.strategy === "suffix" ? `${localizedSlug}.${prefix}` : `${prefix}/${localizedSlug}`;
      const existing = state.variants.get(body.sourcePath)?.get(loc.code.toLowerCase());

      if (existing) {
        try {
          const loaded = site.readEntry(existing.path);

          return {
            path: loaded.path,
            url: slugUrl(col.url, existing.localizedSlug, loc.code, state.config),
            locale: loc.code,
            localizedSlug: existing.localizedSlug,
            reusedSegments: 0,
            entry: loaded,
          } satisfies I18nCreateEntryResult;
        } catch {
          // Create below if seeded virtual path isn't materialized on mock site yet.
        }
      }

      const created = site.createEntry({
        collection: col.id,
        slug: entrySlug,
        data: { ...sourceEntry.data },
        ...(sourceEntry.body !== null ? { body: sourceEntry.body } : {}),
      });
      const map = state.variants.get(body.sourcePath) ?? new Map<string, MockVariant>();

      map.set(loc.code.toLowerCase(), {
        path: created.path,
        locale: loc.code,
        localizedSlug,
        state: "translated",
        updatedAt: new Date().toISOString(),
      });
      state.variants.set(body.sourcePath, map);
      mock.changed(params.siteId, [created.path], "user");

      return {
        path: created.path,
        url: slugUrl(col.url, localizedSlug, loc.code, state.config),
        locale: loc.code,
        localizedSlug,
        reusedSegments: 1,
        entry: created,
      };
    },

    "GET /api/sites/:siteId/i18n/glossary": ({ params }) => stateOf(params.siteId).state.glossary,
    "PUT /api/sites/:siteId/i18n/glossary": ({ params, body }) => {
      const { state } = stateOf(params.siteId);

      state.glossary = { version: 1, terms: body.terms };
      return state.glossary;
    },

    "GET /api/sites/:siteId/i18n/memory": ({ params }) => stateOf(params.siteId).state.memory,
    "PUT /api/sites/:siteId/i18n/memory": ({ params, body }) => {
      const { state } = stateOf(params.siteId);

      state.memory = { version: 1, entries: body.entries };
      return state.memory;
    },

    "POST /api/sites/:siteId/i18n/translate/plan": ({ params, body }) => buildPlan(params.siteId, body),

    "POST /api/sites/:siteId/i18n/translate": ({ params, body }) => {
      const { site, state } = stateOf(params.siteId);
      const plan = buildPlan(params.siteId, body);
      const id = `i18n-${Date.now().toString(36)}`;
      const items: TranslationJobItem[] = plan.items.map((item) => ({ ...item, jobState: "pending" }));
      const job: Job = {
        id,
        kind: "i18n",
        label: `Translating · ${items.length} ${items.length === 1 ? "page" : "pages"}`,
        state: "running",
        progress: 0,
        detail: `0 of ${items.length}`,
        siteId: params.siteId,
        startedAt: Date.now(),
      };
      const status: TranslationJobStatus = {
        job,
        model: plan.model,
        creditMillicents: plan.creditMillicents,
        completed: 0,
        total: items.length,
        requests: plan.requests,
        actualInputTokens: 0,
        actualOutputTokens: 0,
        actualUsd: 0,
        actualCredits: 0,
        tmReusedSegments: 0,
        items,
      };

      state.jobs.set(id, status);
      mock.emit({ type: "job", job });

      // Progress quickly in demo so users see live page-by-page translation & Proof handoff!
      let index = 0;
      const step = () => {
        if (status.job.state !== "running") return;
        if (index >= items.length) {
          status.job = {
            ...status.job,
            state: "done",
            progress: 1,
            finishedAt: Date.now(),
            detail: `${items.length} of ${items.length} translated. Ready to review in Proof.`,
          };
          mock.emit({ type: "job", job: status.job });
          return;
        }
        const item = items[index]!;

        item.jobState = item.needsAi ? "translated" : "reused_tm";
        item.actualInputTokens = item.estimatedInputTokens;
        item.actualOutputTokens = item.estimatedOutputTokens;
        item.actualUsd = item.estimatedUsd;
        item.actualCredits = item.estimatedCredits;
        item.writtenPath = item.targetPath;
        const col = site.model().collections.find((c) => c.id === item.collection);

        item.writtenUrl = slugUrl(col?.url ?? "/{slug}/", item.localizedSlug, item.targetLocale, state.config);
        const map = state.variants.get(item.sourcePath) ?? new Map<string, MockVariant>();

        map.set(item.targetLocale.toLowerCase(), {
          path: item.targetPath,
          locale: item.targetLocale,
          localizedSlug: item.localizedSlug,
          state: "translated",
          updatedAt: new Date().toISOString(),
        });
        state.variants.set(item.sourcePath, map);

        status.completed += 1;
        status.actualInputTokens += item.actualInputTokens;
        status.actualOutputTokens += item.actualOutputTokens;
        status.actualUsd = Math.round((status.actualUsd + item.actualUsd) * 10_000) / 10_000;
        status.actualCredits = status.actualUsd > 0 ? usdToCredits(status.actualUsd) : 0;
        status.tmReusedSegments += item.tmHits;
        status.job = { ...status.job, progress: status.completed / Math.max(1, items.length), detail: `${status.completed} of ${items.length}` };
        mock.emit({ type: "job", job: status.job });
        index += 1;
        setTimeout(step, 260);
      };
      setTimeout(step, 220);

      return status;
    },

    "GET /api/sites/:siteId/i18n/translate/:jobId": ({ params }) => {
      const { state } = stateOf(params.siteId);
      const found = state.jobs.get(params.jobId);

      if (!found) throw new MockError("not-found", "That translation run isn't known here.");
      return found;
    },

    "POST /api/sites/:siteId/i18n/translate/:jobId/cancel": ({ params }) => {
      const { state } = stateOf(params.siteId);
      const found = state.jobs.get(params.jobId);

      if (found && found.job.state === "running") {
        found.job = { ...found.job, state: "error", finishedAt: Date.now(), detail: `Stopped. ${found.completed} translated; waiting in Proof.` };
        mock.emit({ type: "job", job: found.job });
      }
      return { ok: true as const };
    },
  };

  return { handlers };
}
