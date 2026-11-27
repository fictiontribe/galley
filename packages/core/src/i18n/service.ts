/**
 * The i18n service held by the server: overview & coverage matrix, language &
 * routing configuration (with optional 1-click astro.config.* sync),
 * side-by-side manual translation context, manual entry scaffolding with TM
 * auto-fill, Translation Memory & Glossary CRUD, and AI batch translation.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { ASTRO_CONFIG_FILES } from "../adapters/astro/site-config";
import { scrubSecrets } from "../ai/errors";
import { createApiClient } from "../ai/runtime";
import type { UsageLine } from "../ai/usage";
import { GalleyError } from "../errors";
import type { EventBus, I18nConfig, SettingsService, SiteService } from "../types";
import { applyTranslatedSegments, extractTranslatableSegments, fieldPathKey } from "./extract";
import { readGlossary, seedGlossaryIfEmpty, writeGlossary } from "./glossary";
import { findLocale, isDefaultLocale, normalizeI18nConfig, type NormalizedI18nConfig } from "./locales";
import { computeSourceHash, entryTranslationKey, readManifest, writeManifest } from "./manifest";
import { MemoryIndex, readMemory, writeMemory } from "./memory";
import { localizedEntryUrl, sanitizeLocalizedSlug, targetEntrySlug } from "./slugs";
import { buildLocaleUrlMap, createTranslationJobs, discoverSiteEntries, planTranslation, variantState, type TranslatorDeps } from "./translate";
import type {
  GlossaryFile,
  I18nConfigUpdate,
  I18nCounterpart,
  I18nCreateEntryInput,
  I18nCreateEntryResult,
  I18nEntryDetail,
  I18nLocaleSummary,
  I18nMemorySuggestion,
  I18nOverview,
  I18nPageRow,
  I18nPageVariant,
  TranslationJobStatus,
  TranslationMemoryFile,
  TranslationPlan,
  TranslationPlanRequest,
} from "./types";

export interface I18nService {
  overview(site: SiteService): Promise<I18nOverview>;
  saveConfig(site: SiteService, update: I18nConfigUpdate): Promise<I18nOverview>;
  entryDetail(site: SiteService, path: string): Promise<I18nEntryDetail>;
  createEntry(site: SiteService, input: I18nCreateEntryInput): Promise<I18nCreateEntryResult>;
  getGlossary(site: SiteService): Promise<GlossaryFile>;
  saveGlossary(site: SiteService, glossary: GlossaryFile): Promise<GlossaryFile>;
  getMemory(site: SiteService): Promise<TranslationMemoryFile>;
  saveMemory(site: SiteService, memory: TranslationMemoryFile): Promise<TranslationMemoryFile>;
  planTranslation(site: SiteService, request: TranslationPlanRequest): Promise<TranslationPlan>;
  startTranslation(site: SiteService, request: TranslationPlanRequest): Promise<TranslationJobStatus>;
  translationStatus(jobId: string): TranslationJobStatus | null;
  cancelTranslation(jobId: string): void;
  dispose(): void;
}

export interface I18nServiceOptions {
  settings: SettingsService;
  events: EventBus;
  /** Test seam: pre-built Anthropic client. */
  client?: Anthropic;
  env?: NodeJS.ProcessEnv;
  logger?: (line: string) => void;
}

async function findAstroConfigFile(site: SiteService): Promise<string | null> {
  for (const name of ASTRO_CONFIG_FILES) {
    const file = await site.readFile(name).catch(() => null);

    if (file && !file.binary) return name;
  }
  return null;
}

/**
 * Generates or updates the `i18n: { ... }` block inside `astro.config.*`
 * cleanly as a pending change in Proof.
 */
function buildAstroI18nSnippet(config: NormalizedI18nConfig): string {
  const localesList = config.locales.map((loc) =>
    loc.prefix !== loc.code.toLowerCase()
      ? `{ path: ${JSON.stringify(loc.prefix)}, codes: [${JSON.stringify(loc.code)}] }`
      : JSON.stringify(loc.code)
  );

  return [
    "  i18n: {",
    `    defaultLocale: ${JSON.stringify(config.defaultLocale)},`,
    `    locales: [${localesList.join(", ")}],`,
    "    routing: {",
    `      prefixDefaultLocale: ${config.prefixDefaultLocale ? "true" : "false"},`,
    "    },",
    "  },",
  ].join("\n");
}

function patchAstroConfigI18n(source: string, config: NormalizedI18nConfig): string | null {
  const snippet = buildAstroI18nSnippet(config);
  // Replace an existing top-level `i18n: { ... }` block if present.
  const startMatch = /^[ \t]*i18n\s*:\s*\{/m.exec(source);

  if (startMatch) {
    const startIdx = startMatch.index;
    const braceStart = source.indexOf("{", startIdx);
    let depth = 0;
    let endIdx = -1;

    for (let i = braceStart; i < source.length; i += 1) {
      const ch = source[i];

      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }
    if (endIdx !== -1) {
      const trailingComma = source[endIdx] === "," ? 1 : 0;

      return `${source.slice(0, startIdx)}${snippet}${source.slice(endIdx + trailingComma)}`;
    }
  }

  // Otherwise insert inside `defineConfig({` or `export default {`.
  const insertMatch = /(defineConfig\s*\(\s*\{|export\s+default\s*\{)/m.exec(source);

  if (!insertMatch) return null;
  const pos = insertMatch.index + insertMatch[0].length;

  return `${source.slice(0, pos)}\n${snippet}${source.slice(pos)}`;
}

export function createI18nService(options: I18nServiceOptions): I18nService {
  const env = options.env ?? process.env;
  const log = (line: string) => (options.logger ?? ((text: string) => process.stderr.write(`[i18n] ${text}\n`)))(scrubSecrets(line));
  const deps: TranslatorDeps = {
    async client() {
      const key = await options.settings.readSecret("anthropic").catch(() => null);

      if (!key) return null;
      return options.client ?? createApiClient(key, env, 2);
    },
    async model() {
      return (await options.settings.get()).ai.model;
    },
    async record(usage) {
      const line: UsageLine = { ...usage, requests: 1, at: Date.now(), kind: "summary" };

      await options.settings.recordUsage(line);
    },
    events: options.events,
    env,
    log,
  };
  const jobs = createTranslationJobs(deps);

  return {
    async overview(site) {
      const [manifest, memory, glossary, rawConfig, astroFile] = await Promise.all([
        readManifest(site),
        readMemory(site),
        readGlossary(site),
        site.readConfig().catch(() => null),
        findAstroConfigFile(site),
      ]);
      const discovered = await discoverSiteEntries(site, manifest);
      const { config, model } = discovered;
      const configured = Boolean(model.i18n && config.locales.length >= 2);
      const astroDetected = Boolean(!rawConfig?.i18n && model.i18n);

      const pages: I18nPageRow[] = [];
      const counts = new Map<string, { translated: number; outdated: number; missing: number }>();

      for (const locale of config.locales) {
        counts.set(locale.code.toLowerCase(), { translated: 0, outdated: 0, missing: 0 });
      }

      for (const src of discovered.sources) {
        const sourceEntry = await site.readEntry(src.summary.path).catch(() => null);
        const sourceUrl = localizedEntryUrl(src.collection.url, src.baseSlug, config.defaultLocale, config) ?? src.summary.url;
        const variants: Record<string, I18nPageVariant> = {};

        for (const locale of config.locales) {
          const key = locale.code.toLowerCase();
          const bucket = counts.get(key)!;

          if (isDefaultLocale(config, locale.code)) {
            bucket.translated += 1;
            variants[locale.code] = {
              locale: locale.code,
              state: "translated",
              path: src.summary.path,
              url: sourceUrl,
              localizedSlug: src.baseSlug,
              updatedAt: new Date(src.summary.modifiedAt).toISOString(),
            };
            continue;
          }

          const existing = discovered.variantsBySource.get(src.summary.path)?.get(key) ?? null;
          const state = sourceEntry ? variantState(sourceEntry, existing?.path ?? null, manifest) : existing ? "translated" : "missing";

          bucket[state] += 1;
          variants[locale.code] = {
            locale: locale.code,
            state,
            path: existing?.path ?? null,
            url: existing ? localizedEntryUrl(src.collection.url, existing.localizedSlug, locale.code, config) : null,
            localizedSlug: existing?.localizedSlug ?? null,
            updatedAt: existing?.updatedAt ?? null,
          };
        }

        pages.push({
          sourcePath: src.summary.path,
          collection: src.collection.id,
          collectionLabel: src.collection.label,
          title: src.summary.title,
          sourceSlug: src.baseSlug,
          sourceUrl,
          variants,
        });
      }

      const total = discovered.sources.length;
      const locales: I18nLocaleSummary[] = config.locales.map((locale) => {
        const isDef = isDefaultLocale(config, locale.code);
        const bucket = counts.get(locale.code.toLowerCase())!;
        const percent = total === 0 ? 100 : Math.round((bucket.translated / total) * 100);
        const urlPattern = isDef && !config.prefixDefaultLocale ? "/…" : `/${locale.prefix}/…`;

        return {
          code: locale.code,
          label: locale.label,
          prefix: locale.prefix,
          direction: locale.direction,
          isDefault: isDef,
          translated: bucket.translated,
          outdated: bucket.outdated,
          missing: bucket.missing,
          total,
          percent,
          urlPattern,
        };
      });

      const outConfig: I18nConfig = {
        defaultLocale: config.defaultLocale,
        locales: config.locales.map((loc) => ({
          code: loc.code,
          label: loc.label,
          ...(loc.prefix !== loc.code.toLowerCase() ? { prefix: loc.prefix } : {}),
          ...(loc.direction === "rtl" ? { direction: "rtl" as const } : {}),
        })),
        strategy: config.strategy,
        prefixDefaultLocale: config.prefixDefaultLocale,
        localizeSlugs: config.localizeSlugs,
      };

      return {
        configured,
        config: outConfig,
        astroDetected,
        hasAstroConfig: astroFile !== null,
        locales,
        pages,
        memoryCount: memory.entries.length,
        glossaryCount: glossary.terms.length,
        totalSourcePages: total,
      };
    },

    async saveConfig(site, update) {
      const normalized = normalizeI18nConfig(update);
      const nextI18n: I18nConfig = {
        defaultLocale: normalized.defaultLocale,
        locales: normalized.locales.map((loc) => ({
          code: loc.code,
          label: loc.label,
          ...(loc.prefix !== loc.code.toLowerCase() ? { prefix: loc.prefix } : {}),
          ...(loc.direction === "rtl" ? { direction: "rtl" as const } : {}),
        })),
        strategy: normalized.strategy,
        prefixDefaultLocale: normalized.prefixDefaultLocale,
        localizeSlugs: normalized.localizeSlugs,
      };

      const existing = (await site.readConfig().catch(() => null)) ?? {};

      await site.saveConfig({ ...existing, i18n: nextI18n });

      const model = await site.model();

      await seedGlossaryIfEmpty(site, model).catch(() => undefined);

      if (update.syncAstroConfig) {
        const astroFile = await findAstroConfigFile(site);

        if (astroFile) {
          const current = await site.readFile(astroFile).catch(() => null);

          if (current && !current.binary) {
            const patched = patchAstroConfigI18n(current.content, normalized);

            if (patched && patched !== current.content) {
              await site.writeFile(astroFile, patched, { origin: "user", mode: "build" });
            }
          }
        }
      }

      return this.overview(site);
    },

    async entryDetail(site, path) {
      const [manifest, memory] = await Promise.all([readManifest(site), readMemory(site)]);
      const discovered = await discoverSiteEntries(site, manifest);
      const { config, model } = discovered;
      const info = discovered.byPath.get(path);

      if (!info) {
        throw new GalleyError("not-found", "That entry isn't part of a translatable collection.");
      }

      // Resolve the default-locale source entry for this path.
      let sourcePath = path;
      let sourceSlug = info.baseSlug;

      if (!info.isDefault) {
        const link = manifest.links[path];

        if (link && discovered.byPath.has(link.sourcePath)) {
          sourcePath = link.sourcePath;
          sourceSlug = discovered.byPath.get(link.sourcePath)!.baseSlug;
        } else {
          // Find source matching collection + baseSlug.
          const match = discovered.sources.find(
            (s) => s.collection.id === info.collection.id && s.baseSlug.toLowerCase() === info.baseSlug.toLowerCase()
          );

          if (match) {
            sourcePath = match.summary.path;
            sourceSlug = match.baseSlug;
          }
        }
      }

      const sourceEntry = await site.readEntry(sourcePath).catch(() => null);
      const sourceInfo = discovered.byPath.get(sourcePath) ?? info;
      const defaultLoc = findLocale(config, config.defaultLocale) ?? config.locales[0]!;
      const currentLoc = findLocale(config, info.locale) ?? defaultLoc;
      const sourceUrl = localizedEntryUrl(sourceInfo.collection.url, sourceSlug, config.defaultLocale, config) ?? sourceInfo.summary.url;
      const currentUrl = localizedEntryUrl(info.collection.url, info.baseSlug, currentLoc.code, config) ?? info.summary.url;

      const variantsMap = discovered.variantsBySource.get(sourcePath) ?? new Map();
      const counterparts: I18nCounterpart[] = config.locales.map((locale) => {
        const isDef = isDefaultLocale(config, locale.code);

        if (isDef) {
          return {
            locale: locale.code,
            label: locale.label,
            prefix: locale.prefix,
            direction: locale.direction,
            isDefault: true,
            state: "translated",
            path: sourcePath,
            url: sourceUrl,
            localizedSlug: sourceSlug,
          };
        }
        const existing = variantsMap.get(locale.code.toLowerCase()) ?? null;
        const state = sourceEntry ? variantState(sourceEntry, existing?.path ?? null, manifest) : existing ? "translated" : "missing";

        return {
          locale: locale.code,
          label: locale.label,
          prefix: locale.prefix,
          direction: locale.direction,
          isDefault: false,
          state,
          path: existing?.path ?? null,
          url: existing ? localizedEntryUrl(sourceInfo.collection.url, existing.localizedSlug, locale.code, config) : null,
          localizedSlug: existing?.localizedSlug ?? null,
        };
      });

      const state = info.isDefault
        ? "translated"
        : sourceEntry
          ? variantState(sourceEntry, path, manifest)
          : "translated";

      // Build TM suggestions for every translatable field & body paragraph when editing a translation.
      const tmMatches: Record<string, I18nMemorySuggestion> = {};
      const bodyTmMatches: I18nMemorySuggestion[] = [];

      if (!info.isDefault && sourceEntry) {
        const tmIndex = new MemoryIndex(memory);
        const { segments } = extractTranslatableSegments(sourceEntry);

        for (const seg of segments) {
          const suggestion = tmIndex.suggest(config.defaultLocale, currentLoc.code, seg.text);

          if (!suggestion) continue;
          if (seg.kind === "field" && seg.fieldPath) {
            tmMatches[fieldPathKey(seg.fieldPath)] = suggestion;
          } else if (seg.kind === "body") {
            bodyTmMatches.push(suggestion);
          }
        }
      }

      return {
        configured: Boolean(model.i18n && config.locales.length >= 2),
        path,
        locale: currentLoc.code,
        localeLabel: currentLoc.label,
        defaultLocale: defaultLoc.code,
        defaultLocaleLabel: defaultLoc.label,
        isDefault: info.isDefault,
        sourcePath,
        sourceTitle: sourceEntry?.title ?? sourceInfo.summary.title,
        sourceUrl,
        currentUrl,
        localizedSlug: manifest.links[path]?.localizedSlug ?? info.baseSlug,
        state,
        outdated: state === "outdated",
        counterparts,
        sourceData: !info.isDefault && sourceEntry ? sourceEntry.data : null,
        sourceBody: !info.isDefault && sourceEntry ? sourceEntry.body : null,
        tmMatches,
        bodyTmMatches,
      };
    },

    async createEntry(site, input) {
      const [manifest, memory] = await Promise.all([readManifest(site), readMemory(site)]);
      const discovered = await discoverSiteEntries(site, manifest);
      const { config } = discovered;
      const targetLocale = findLocale(config, input.targetLocale);

      if (!targetLocale) {
        throw new GalleyError("invalid", `“${input.targetLocale}” isn't a configured language on this site.`);
      }
      if (isDefaultLocale(config, targetLocale.code)) {
        throw new GalleyError("invalid", "That's already the site's default language.");
      }

      const sourceInfo = discovered.byPath.get(input.sourcePath);

      if (!sourceInfo) {
        throw new GalleyError("not-found", "That source page doesn't exist.");
      }
      const sourceEntry = await site.readEntry(input.sourcePath);
      const existing = discovered.variantsBySource.get(input.sourcePath)?.get(targetLocale.code.toLowerCase());

      if (existing) {
        const entry = await site.readEntry(existing.path);

        return {
          path: entry.path,
          url: localizedEntryUrl(sourceInfo.collection.url, existing.localizedSlug, targetLocale.code, config) ?? entry.url,
          locale: targetLocale.code,
          localizedSlug: existing.localizedSlug,
          reusedSegments: 0,
          entry,
        };
      }

      const localizedSlug = sanitizeLocalizedSlug(input.localizedSlug, sourceInfo.baseSlug);
      const entrySlug = targetEntrySlug(localizedSlug, targetLocale.code, config);
      const urlMap = buildLocaleUrlMap(discovered, targetLocale.code);
      const translations = new Map<string, string>();
      let reusedSegments = 0;

      if (input.applyMemory !== false) {
        const tmIndex = new MemoryIndex(memory);
        const { segments } = extractTranslatableSegments(sourceEntry);

        for (const seg of segments) {
          const hit = tmIndex.exact(config.defaultLocale, targetLocale.code, seg.text);

          if (hit) {
            translations.set(seg.id, hit.target);
            reusedSegments += 1;
          }
        }
      }

      const { data, body } = applyTranslatedSegments(sourceEntry, translations, urlMap, localizedSlug);
      const created = await site.createEntry(
        {
          collection: sourceInfo.collection.id,
          slug: entrySlug,
          data,
          ...(body !== null ? { body } : {}),
        },
        { origin: "user", mode: "content" }
      );

      manifest.links[created.path] = {
        key: entryTranslationKey(sourceEntry) ?? input.sourcePath,
        sourcePath: input.sourcePath,
        locale: targetLocale.code,
        sourceHash: computeSourceHash(sourceEntry),
        sourceSlug: sourceInfo.baseSlug,
        localizedSlug,
        updatedAt: new Date().toISOString(),
      };
      await writeManifest(site, manifest);

      return {
        path: created.path,
        url: localizedEntryUrl(sourceInfo.collection.url, localizedSlug, targetLocale.code, config) ?? created.url,
        locale: targetLocale.code,
        localizedSlug,
        reusedSegments,
        entry: created,
      };
    },

    getGlossary: (site) => readGlossary(site),

    async saveGlossary(site, glossary) {
      await writeGlossary(site, glossary);
      return readGlossary(site);
    },

    getMemory: (site) => readMemory(site),

    async saveMemory(site, memory) {
      await writeMemory(site, memory);
      return readMemory(site);
    },

    planTranslation: (site, request) => planTranslation(site, request, deps),
    startTranslation: (site, request) => jobs.start(site, request),
    translationStatus: (jobId) => jobs.status(jobId),
    cancelTranslation: (jobId) => jobs.cancel(jobId),
    dispose: () => jobs.dispose(),
  };
}
