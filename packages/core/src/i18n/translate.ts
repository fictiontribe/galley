/**
 * Upfront cost & AI credits estimation (`planTranslation`) and live batch /
 * single-page AI translation jobs (`createTranslationJobs`).
 *
 * Follows the same safety and metering guarantees as `seo/write.ts`:
 * - Uses `settings.ai` + `GALLEY_ANTHROPIC_BASE_URL` so Galley Cloud meters
 *   credits automatically and local/self-hosted installs use BYOK.
 * - Reuses exact Translation Memory matches for 0 tokens / $0 / 0 credits.
 * - Never publishes automatically: every new or updated translation file plus
 *   `galley/i18n/manifest.json` and `galley/i18n/memory.json` lands in Proof.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { creditsFromUsd, readManagedAiConfig } from "../ai/credits";
import { noKeyError, safeDetail } from "../ai/errors";
import { costFor } from "../ai/models";
import { contentWriteRefusal } from "../site/content-code";
import { createJobTracker } from "../site/jobs";
import type { Collection, Entry, EntrySummary, EventBus, JsonValue, SiteModel, SiteService } from "../types";
import { applyTranslatedSegments, countWords, estimateSegmentTokens, extractTranslatableSegments } from "./extract";
import { formatGlossaryPrompt, readGlossary, seedGlossaryIfEmpty } from "./glossary";
import { findLocale, isDefaultLocale, normalizeI18nConfig, type NormalizedI18nConfig } from "./locales";
import { computeSourceHash, entryTranslationKey, readManifest, writeManifest } from "./manifest";
import { MemoryIndex, mergeMemoryEntries, readMemory, writeMemory } from "./memory";
import { detectSlugLocale, localizedEntryUrl, normalizeUrlKey, sanitizeLocalizedSlug, targetEntryPath, targetEntrySlug } from "./slugs";
import type {
  I18nManifest,
  TranslationJobItem,
  TranslationJobStatus,
  TranslationMode,
  TranslationPlan,
  TranslationPlanItem,
  TranslationPlanRequest,
  TranslationState,
} from "./types";

export const TRANSLATE_MAX_BATCH = 200;
export const HIGH_CREDITS_CONFIRM_THRESHOLD = 600;
const PROMPT_OVERHEAD_TOKENS = 420;
const OUTPUT_EXPANSION_RATIO = 1.25;

export interface TranslatorDeps {
  client(): Promise<Anthropic | null>;
  model(): Promise<string>;
  record(usage: { model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; cost: number | null; siteId: string }): Promise<void>;
  events: EventBus;
  env?: NodeJS.ProcessEnv;
  log(line: string): void;
}

export interface DiscoveredSiteEntries {
  config: NormalizedI18nConfig;
  model: SiteModel;
  collectionsById: Map<string, Collection>;
  /** All default-locale source entries across entry collections. */
  sources: Array<{ summary: EntrySummary; collection: Collection; baseSlug: string }>;
  /** All entries indexed by repo path. */
  byPath: Map<string, { summary: EntrySummary; collection: Collection; locale: string; baseSlug: string; isDefault: boolean }>;
  /** For each source path -> targetLocale -> existing translated entry path. */
  variantsBySource: Map<string, Map<string, { path: string; slug: string; baseSlug: string; localizedSlug: string; updatedAt: string | null }>>;
}

/**
 * Scans every entry collection and maps default-locale entries to their
 * localized counterparts using `galley/i18n/manifest.json` + folder/suffix
 * file conventions.
 */
export async function discoverSiteEntries(site: SiteService, manifest: I18nManifest): Promise<DiscoveredSiteEntries> {
  const model = await site.model();
  const config = normalizeI18nConfig(model.i18n);
  const collectionsById = new Map(model.collections.map((c) => [c.id, c]));
  const entryCollections = model.collections.filter((c) => c.kind === "entries" && !c.kit && !c.hidden);

  const byPath = new Map<string, { summary: EntrySummary; collection: Collection; locale: string; baseSlug: string; isDefault: boolean }>();
  const sources: Array<{ summary: EntrySummary; collection: Collection; baseSlug: string }> = [];
  const sourceByCollectionSlug = new Map<string, string>();
  const variantsBySource = new Map<string, Map<string, { path: string; slug: string; baseSlug: string; localizedSlug: string; updatedAt: string | null }>>();

  const lists = await Promise.all(
    entryCollections.map(async (collection) => ({
      collection,
      list: await site.listEntries(collection.id, { limit: 1000 }).catch(() => ({ collection: collection.id, total: 0, items: [] as EntrySummary[] })),
    }))
  );

  // First pass: index every entry and determine its locale.
  for (const { collection, list } of lists) {
    for (const summary of list.items) {
      const link = manifest.links[summary.path];
      const detected = detectSlugLocale(summary.slug, config);
      const locale = link?.locale ?? detected.locale;
      const isDefault = link ? isDefaultLocale(config, link.locale) : detected.isDefault;
      const baseSlug = link?.localizedSlug || detected.baseSlug;

      byPath.set(summary.path, { summary, collection, locale, baseSlug, isDefault });
      if (isDefault) {
        sources.push({ summary, collection, baseSlug });
        sourceByCollectionSlug.set(`${collection.id}\u0000${baseSlug.toLowerCase()}`, summary.path);
        variantsBySource.set(summary.path, new Map());
      }
    }
  }

  // Second pass: attach manifest-linked variants first (supports translated slugs like /pricing/ ↔ /es/precios/).
  for (const [targetPath, link] of Object.entries(manifest.links)) {
    const targetInfo = byPath.get(targetPath);

    if (!targetInfo || targetInfo.isDefault) continue;
    const map = variantsBySource.get(link.sourcePath);

    if (!map) continue;
    map.set(link.locale.toLowerCase(), {
      path: targetPath,
      slug: targetInfo.summary.slug,
      baseSlug: targetInfo.baseSlug,
      localizedSlug: link.localizedSlug || targetInfo.baseSlug,
      updatedAt: link.updatedAt,
    });
  }

  // Third pass: discover unlinked localized files by matching collection + baseSlug convention.
  for (const [path, info] of byPath.entries()) {
    if (info.isDefault) continue;
    if (manifest.links[path]) continue;
    const matchedSource = sourceByCollectionSlug.get(`${info.collection.id}\u0000${info.baseSlug.toLowerCase()}`);

    if (!matchedSource) continue;
    const map = variantsBySource.get(matchedSource);

    if (!map) continue;
    const localeKey = info.locale.toLowerCase();

    if (!map.has(localeKey)) {
      map.set(localeKey, {
        path,
        slug: info.summary.slug,
        baseSlug: info.baseSlug,
        localizedSlug: info.baseSlug,
        updatedAt: new Date(info.summary.modifiedAt).toISOString(),
      });
    }
  }

  return { config, model, collectionsById, sources, byPath, variantsBySource };
}

/**
 * Builds a `normalizedSourceUrl -> targetUrl` map for rewriting internal links
 * when translating into `targetLocale`.
 */
export function buildLocaleUrlMap(discovered: DiscoveredSiteEntries, targetLocale: string): Map<string, string> {
  const map = new Map<string, string>();

  for (const src of discovered.sources) {
    if (!src.collection.url) continue;
    const sourceUrl = localizedEntryUrl(src.collection.url, src.baseSlug, discovered.config.defaultLocale, discovered.config);

    if (!sourceUrl) continue;
    const variant = discovered.variantsBySource.get(src.summary.path)?.get(targetLocale.toLowerCase());
    const targetSlug = variant?.localizedSlug ?? src.baseSlug;
    const targetUrl = localizedEntryUrl(src.collection.url, targetSlug, targetLocale, discovered.config);

    if (targetUrl) {
      map.set(normalizeUrlKey(sourceUrl), targetUrl);
      if (src.summary.url) map.set(normalizeUrlKey(src.summary.url), targetUrl);
    }
  }
  return map;
}

/**
 * Computes whether a translated variant is "missing", "outdated", or "translated".
 */
export function variantState(
  sourceEntry: Pick<Entry, "data" | "body">,
  variantPath: string | null,
  manifest: I18nManifest
): TranslationState {
  if (!variantPath) return "missing";
  const link = manifest.links[variantPath];

  if (!link || !link.sourceHash) return "translated";
  return link.sourceHash === computeSourceHash(sourceEntry) ? "translated" : "outdated";
}

function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const raw = costFor(model, { inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 });

  if (raw !== null) return Math.round(raw * 10_000) / 10_000;
  // Fallback rate card (Opus-like $4/$20 per MTok) if a custom model name is configured.
  const fallback = (inputTokens * 4 + outputTokens * 20) / 1_000_000;

  return Math.round(fallback * 10_000) / 10_000;
}

/**
 * Pre-flight planner: computes exact segment counts, TM hits, token counts,
 * USD cost, and AI credits before any AI call is sent.
 */
export async function planTranslation(
  site: SiteService,
  request: TranslationPlanRequest,
  deps: Pick<TranslatorDeps, "client" | "model" | "env">
): Promise<TranslationPlan> {
  const env = deps.env ?? process.env;
  const managedConfig = readManagedAiConfig(env);
  const creditMillicents = managedConfig.creditMillicents;
  const mode: TranslationMode = request.mode ?? "missing_and_outdated";
  const [manifest, memory, modelId, client] = await Promise.all([
    readManifest(site),
    readMemory(site),
    deps.model(),
    deps.client().catch(() => null),
  ]);
  const discovered = await discoverSiteEntries(site, manifest);
  const { config } = discovered;
  const translateSlugs = request.translateSlugs ?? config.localizeSlugs;
  const tmIndex = new MemoryIndex(memory);

  const requestedLocales = request.targetLocales
    .map((code) => findLocale(config, code))
    .filter((loc): loc is NonNullable<typeof loc> => loc !== undefined && !isDefaultLocale(config, loc.code));
  const wantedPaths = request.paths?.length ? new Set(request.paths) : null;
  const wantedCollections = request.collections?.length ? new Set(request.collections) : null;

  const items: TranslationPlanItem[] = [];
  let tmSavedTokens = 0;

  for (const src of discovered.sources) {
    if (wantedPaths && !wantedPaths.has(src.summary.path)) continue;
    if (wantedCollections && !wantedCollections.has(src.collection.id)) continue;

    const entry = await site.readEntry(src.summary.path).catch(() => null);

    if (!entry) continue;
    const { segments } = extractTranslatableSegments(entry);
    const words = segments.reduce((sum, seg) => sum + countWords(seg.text), 0);

    for (const targetLocale of requestedLocales) {
      const existing = discovered.variantsBySource.get(src.summary.path)?.get(targetLocale.code.toLowerCase()) ?? null;
      const state = variantState(entry, existing?.path ?? null, manifest);

      if (mode === "missing_only" && state !== "missing") continue;
      if (mode === "missing_and_outdated" && state === "translated") continue;

      let tmHits = 0;
      let missTokens = 0;
      let savedInTokens = 0;

      for (const seg of segments) {
        const hit = tmIndex.exact(config.defaultLocale, targetLocale.code, seg.text);
        const segTokens = estimateSegmentTokens(seg.text);

        if (hit) {
          tmHits += 1;
          savedInTokens += segTokens;
        } else {
          missTokens += segTokens;
        }
      }

      const segmentsToTranslate = segments.length - tmHits;
      const needsAi = segmentsToTranslate > 0;
      const estimatedInputTokens = needsAi ? PROMPT_OVERHEAD_TOKENS + missTokens : 0;
      const estimatedOutputTokens = needsAi ? Math.ceil(missTokens * OUTPUT_EXPANSION_RATIO) + 90 : 0;
      const estimatedUsd = needsAi ? estimateCostUsd(modelId, estimatedInputTokens, estimatedOutputTokens) : 0;
      const estimatedCredits = needsAi ? creditsFromUsd(estimatedUsd, creditMillicents) : 0;

      if (savedInTokens > 0) {
        tmSavedTokens += savedInTokens + Math.ceil(savedInTokens * OUTPUT_EXPANSION_RATIO);
      }

      const localizedSlug = existing?.localizedSlug ?? src.baseSlug;
      const computedEntrySlug = targetEntrySlug(localizedSlug, targetLocale.code, config);
      const targetPath = existing?.path ?? targetEntryPath(src.collection, src.summary.path, computedEntrySlug);

      items.push({
        sourcePath: src.summary.path,
        targetPath,
        collection: src.collection.id,
        title: entry.title,
        targetLocale: targetLocale.code,
        targetLabel: targetLocale.label,
        state,
        sourceSlug: src.baseSlug,
        localizedSlug,
        sourceWords: words,
        totalSegments: segments.length,
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

  const limit = Math.max(0, Math.min(request.limit ?? items.length, TRANSLATE_MAX_BATCH));
  const capped = items.slice(0, limit);
  const requests = capped.filter((item) => item.needsAi).length;
  const tmOnlyItems = capped.filter((item) => !item.needsAi).length;
  const sourceWords = capped.reduce((s, i) => s + i.sourceWords, 0);
  const totalSegments = capped.reduce((s, i) => s + i.totalSegments, 0);
  const tmHits = capped.reduce((s, i) => s + i.tmHits, 0);
  const segmentsToTranslate = capped.reduce((s, i) => s + i.segmentsToTranslate, 0);
  const estimatedInputTokens = capped.reduce((s, i) => s + i.estimatedInputTokens, 0);
  const estimatedOutputTokens = capped.reduce((s, i) => s + i.estimatedOutputTokens, 0);
  const estimatedUsd = Math.round(capped.reduce((s, i) => s + i.estimatedUsd, 0) * 10_000) / 10_000;
  const estimatedCredits = estimatedUsd > 0 ? creditsFromUsd(estimatedUsd, creditMillicents) : 0;

  // Saved cost from Translation Memory hits across capped items.
  const savedInputOnly = Math.round(tmSavedTokens / (1 + OUTPUT_EXPANSION_RATIO));
  const savedOutputOnly = Math.max(0, tmSavedTokens - savedInputOnly);
  const tmSavedUsd = tmSavedTokens > 0 ? estimateCostUsd(modelId, savedInputOnly, savedOutputOnly) : 0;
  const tmSavedCredits = tmSavedUsd > 0 ? creditsFromUsd(tmSavedUsd, creditMillicents) : 0;

  return {
    mode,
    model: modelId,
    connected: client !== null,
    creditMillicents,
    translateSlugs,
    items: capped,
    totalItems: capped.length,
    requests,
    tmOnlyItems,
    sourceWords,
    totalSegments,
    tmHits,
    segmentsToTranslate,
    tmSavedTokens,
    tmSavedUsd,
    tmSavedCredits,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedUsd,
    estimatedCredits,
    requiresConfirmation: estimatedCredits > HIGH_CREDITS_CONFIRM_THRESHOLD,
    note:
      requests === 0 && capped.length > 0
        ? "Every segment matched Translation Memory — 0 AI credits and $0.00. Translations land in Proof for review."
        : "One AI request per page and language needing new translations. Exact Translation Memory matches are applied free. Everything waits in Proof; nothing is published automatically.",
  };
}

const TRANSLATION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    localizedSlug: { type: ["string", "null"] },
    segments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          text: { type: "string" },
        },
        required: ["id", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["localizedSlug", "segments"],
  additionalProperties: false,
};

async function readBrandVoice(site: SiteService, model: SiteModel): Promise<string> {
  const candidates = ["galley/brand/guide.md", ...model.ai.instructions];

  for (const rel of candidates) {
    const file = await site.readFile(rel).catch(() => null);

    if (file && !file.binary && file.content.trim()) {
      return file.content.trim().slice(0, 1_500);
    }
  }
  return "";
}

async function writeTranslatedEntry(
  site: SiteService,
  collection: Collection,
  existingPath: string | null,
  entrySlug: string,
  data: Record<string, JsonValue>,
  body: string | null
): Promise<Entry> {
  if (existingPath) {
    const current = await site.readEntry(existingPath).catch(() => null);

    if (current) {
      const ops: Array<{ op: "set"; path: Array<string | number>; value: JsonValue } | { op: "body"; value: string }> = [];

      for (const [k, v] of Object.entries(data)) {
        ops.push({ op: "set", path: [k], value: v });
      }
      if (body !== null && body !== current.body) {
        ops.push({ op: "body", value: body });
      }
      if (ops.length > 0) {
        const result = await site.updateEntry(existingPath, ops, { origin: "agent", mode: "content", baseHash: current.hash });

        return result.entry;
      }
      return current;
    }
  }

  return site.createEntry(
    {
      collection: collection.id,
      slug: entrySlug,
      data,
      ...(body !== null ? { body } : {}),
    },
    { origin: "agent", mode: "content" }
  );
}

export interface TranslationJobs {
  start(site: SiteService, request: TranslationPlanRequest): Promise<TranslationJobStatus>;
  status(jobId: string): TranslationJobStatus | null;
  cancel(jobId: string): void;
  dispose(): void;
}

export function createTranslationJobs(deps: TranslatorDeps): TranslationJobs {
  const jobs = createJobTracker(deps.events);
  const runs = new Map<string, { status: TranslationJobStatus; controller: AbortController }>();

  return {
    async start(site, request) {
      const plan = await planTranslation(site, request, deps);

      // Only require an AI key when at least one page actually needs LLM translation!
      const client = plan.requests > 0 ? await deps.client() : null;

      if (plan.requests > 0 && !client) {
        throw noKeyError();
      }

      const items: TranslationJobItem[] = plan.items.map((item) => ({ ...item, jobState: "pending" }));
      const job = jobs.start("i18n", `Translating · ${items.length} ${items.length === 1 ? "page" : "pages"}`);
      const controller = new AbortController();
      const status: TranslationJobStatus = {
        job: { ...job.snapshot(), siteId: site.id },
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

      job.update({ siteId: site.id, progress: items.length === 0 ? 1 : 0, detail: `0 of ${items.length}` });
      runs.set(job.id, { status, controller });

      void (async () => {
        const model = await site.model();
        const [manifest, memoryStart, glossary, brandVoice] = await Promise.all([
          readManifest(site),
          readMemory(site),
          seedGlossaryIfEmpty(site, model).catch(() => readGlossary(site)),
          readBrandVoice(site, model),
        ]);
        let memory = memoryStart;
        let tmIndex = new MemoryIndex(memory);
        const discovered = await discoverSiteEntries(site, manifest);
        const { config } = discovered;
        const urlMapByLocale = new Map<string, Map<string, string>>();
        let manifestChanged = false;
        let memoryChanged = false;

        const getUrlMap = (localeCode: string): Map<string, string> => {
          const key = localeCode.toLowerCase();
          let map = urlMapByLocale.get(key);

          if (!map) {
            map = buildLocaleUrlMap(discovered, localeCode);
            urlMapByLocale.set(key, map);
          }
          return map;
        };

        let done = 0;

        for (const item of items) {
          if (controller.signal.aborted) {
            item.jobState = "skipped";
            item.reason = "Stopped before this page.";
            continue;
          }

          try {
            const collection = discovered.collectionsById.get(item.collection);

            if (!collection) throw new Error("Collection not found.");
            const held = contentWriteRefusal(item.sourcePath, model, { origin: "agent" });

            if (held) {
              item.jobState = "skipped";
              item.reason = held;
              done += 1;
              status.completed = done;
              job.update({ progress: done / Math.max(1, items.length), detail: `${done} of ${items.length}` });
              status.job = { ...job.snapshot(), siteId: site.id };
              continue;
            }

            const sourceEntry = await site.readEntry(item.sourcePath);
            const { segments } = extractTranslatableSegments(sourceEntry);
            const translatedMap = new Map<string, string>();
            const missingSegments: Array<{ id: string; text: string }> = [];
            let tmHitsHere = 0;

            for (const seg of segments) {
              const hit = tmIndex.exact(config.defaultLocale, item.targetLocale, seg.text);

              if (hit) {
                translatedMap.set(seg.id, hit.target);
                tmHitsHere += 1;
              } else {
                missingSegments.push({ id: seg.id, text: seg.text });
              }
            }

            let localizedSlug = item.localizedSlug;
            const newPairs: Array<{ source: string; target: string }> = [];

            if (missingSegments.length > 0 && client) {
              const haystack = missingSegments.map((s) => s.text).join("\n");
              const glossaryBlock = formatGlossaryPrompt(glossary, item.targetLocale, haystack);
              const askForSlug =
                plan.translateSlugs &&
                item.sourceSlug.split("/").pop()?.toLowerCase() !== "index" &&
                item.state === "missing";

              const promptLines = [
                `Translate the following website content segments from ${config.defaultLocale} into ${item.targetLabel} (${item.targetLocale}).`,
                `Site: ${model.name}`,
                `Page title: ${sourceEntry.title}`,
                askForSlug
                  ? `Source URL slug: "${item.sourceSlug}" — return a natural, lowercase, hyphenated ASCII URL slug in ${item.targetLabel} as "localizedSlug" (no leading/trailing slashes).`
                  : `Keep "localizedSlug" as null.`,
                glossaryBlock,
                brandVoice ? `Brand voice:\n${brandVoice}` : "",
                "",
                "Rules:",
                "- Preserve all Markdown formatting, inline links, HTML tags, placeholders ({count}, {{name}}), numbers, currencies, and brand names.",
                "- Return every requested segment id with its translated text.",
                "",
                "Segments JSON:",
                JSON.stringify(missingSegments, null, 2),
              ]
                .filter(Boolean)
                .join("\n");

              const response = await client.messages.create(
                {
                  model: plan.model,
                  max_tokens: Math.min(8_000, Math.max(1_500, item.estimatedOutputTokens + 800)),
                  system:
                    "You are a professional website localizer. Translate accurately into natural, idiomatic copy for the target language while strictly preserving Markdown structure, code spans, inline links, numbers, and glossary rules.",
                  output_config: { effort: "low", format: { type: "json_schema", schema: TRANSLATION_RESPONSE_SCHEMA } },
                  messages: [{ role: "user", content: promptLines }],
                },
                { signal: controller.signal }
              );

              const usage = {
                inputTokens: response.usage.input_tokens,
                outputTokens: response.usage.output_tokens,
                cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
                cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
              };
              const usd = costFor(plan.model, usage) ?? estimateCostUsd(plan.model, usage.inputTokens, usage.outputTokens);
              const credits = creditsFromUsd(usd, plan.creditMillicents);

              await deps.record({ model: plan.model, ...usage, cost: usd, siteId: site.id }).catch(() => undefined);
              item.actualInputTokens = usage.inputTokens;
              item.actualOutputTokens = usage.outputTokens;
              item.actualUsd = Math.round(usd * 10_000) / 10_000;
              item.actualCredits = credits;
              status.actualInputTokens += usage.inputTokens;
              status.actualOutputTokens += usage.outputTokens;
              status.actualUsd = Math.round((status.actualUsd + usd) * 10_000) / 10_000;
              status.actualCredits = status.actualUsd > 0 ? creditsFromUsd(status.actualUsd, plan.creditMillicents) : 0;

              const rawText = response.content
                .filter((block): block is Anthropic.TextBlock => block.type === "text")
                .map((block) => block.text)
                .join("");
              const parsed = JSON.parse(rawText) as { localizedSlug: string | null; segments: Array<{ id: string; text: string }> };

              if (askForSlug && parsed.localizedSlug) {
                localizedSlug = sanitizeLocalizedSlug(parsed.localizedSlug, item.sourceSlug);
              }
              const byId = new Map(parsed.segments.map((s) => [s.id, s.text]));

              for (const seg of missingSegments) {
                const translated = byId.get(seg.id);

                if (typeof translated === "string" && translated.trim()) {
                  translatedMap.set(seg.id, translated);
                  newPairs.push({ source: seg.text, target: translated });
                }
              }
            }

            const existingVariant = discovered.variantsBySource.get(item.sourcePath)?.get(item.targetLocale.toLowerCase()) ?? null;
            const entrySlug = targetEntrySlug(localizedSlug, item.targetLocale, config);
            const urlMap = getUrlMap(item.targetLocale);

            // Register this page's own localized URL so self-links and subsequent pages resolve to it.
            if (collection.url) {
              const srcUrl = localizedEntryUrl(collection.url, item.sourceSlug, config.defaultLocale, config);
              const dstUrl = localizedEntryUrl(collection.url, localizedSlug, item.targetLocale, config);

              if (srcUrl && dstUrl) urlMap.set(normalizeUrlKey(srcUrl), dstUrl);
            }

            const { data, body } = applyTranslatedSegments(sourceEntry, translatedMap, urlMap, localizedSlug);
            const written = await writeTranslatedEntry(site, collection, existingVariant?.path ?? null, entrySlug, data, body);
            const nowIso = new Date().toISOString();

            manifest.links[written.path] = {
              key: entryTranslationKey(sourceEntry) ?? item.sourcePath,
              sourcePath: item.sourcePath,
              locale: item.targetLocale,
              sourceHash: computeSourceHash(sourceEntry),
              sourceSlug: item.sourceSlug,
              localizedSlug,
              updatedAt: nowIso,
            };
            manifestChanged = true;

            if (newPairs.length > 0) {
              memory = mergeMemoryEntries(memory, config.defaultLocale, item.targetLocale, newPairs, nowIso);
              tmIndex = new MemoryIndex(memory);
              memoryChanged = true;
            }

            status.tmReusedSegments += tmHitsHere;
            item.localizedSlug = localizedSlug;
            item.writtenPath = written.path;
            item.writtenUrl = localizedEntryUrl(collection.url, localizedSlug, item.targetLocale, config) ?? written.url;
            item.jobState = missingSegments.length === 0 ? "reused_tm" : "translated";
          } catch (error) {
            item.jobState = "failed";
            item.reason = controller.signal.aborted
              ? "Stopped."
              : error instanceof Error && "status" in error
                ? "The assistant couldn't be reached."
                : safeDetail(error, 200);
            deps.log(`i18n translation failed for ${item.sourcePath} (${item.targetLocale}): ${safeDetail(error, 300)}`);
          }

          done += 1;
          status.completed = done;
          job.update({ progress: done / Math.max(1, items.length), detail: `${done} of ${items.length}` });
          status.job = { ...job.snapshot(), siteId: site.id };
        }

        if (manifestChanged) await writeManifest(site, manifest).catch(() => undefined);
        if (memoryChanged) await writeMemory(site, memory).catch(() => undefined);

        const okCount = items.filter((item) => item.jobState === "translated" || item.jobState === "reused_tm").length;

        job.finish(controller.signal.aborted ? "error" : "done", {
          progress: 1,
          siteId: site.id,
          detail: controller.signal.aborted
            ? `Stopped. ${okCount} translated; waiting in Proof.`
            : `${okCount} of ${items.length} translated. Ready to review in Proof.`,
        });
        status.job = { ...job.snapshot(), siteId: site.id };
      })();

      return status;
    },

    status(jobId) {
      const held = runs.get(jobId);

      if (!held) return null;
      return {
        ...held.status,
        job: jobs.get(jobId) ?? held.status.job,
        items: held.status.items.map((item) => ({ ...item })),
      };
    },

    cancel(jobId) {
      runs.get(jobId)?.controller.abort();
    },

    dispose() {
      for (const held of runs.values()) held.controller.abort();
      jobs.dispose();
    },
  };
}
