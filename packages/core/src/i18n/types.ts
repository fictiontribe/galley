/**
 * Multilingual / i18n domain contract shared by @galley/core, @galley/server,
 * and @galley/web. Kept free of Node/DOM imports so every package can import it.
 */
import type { Entry, I18nConfig, I18nLocaleConfig, I18nStrategy, Job, JsonValue } from "../types";

export type TranslationState = "translated" | "outdated" | "missing";

export interface I18nManifestLink {
  /** Stable logical group key shared across translations of the same page. */
  key: string;
  /** Repo-relative path of the default-locale source entry. */
  sourcePath: string;
  /** Locale code of this translated entry. */
  locale: string;
  /** Deterministic SHA-256 prefix of the source entry's translatable content when last translated. */
  sourceHash: string;
  /** Collection-relative slug of the source entry (e.g. "pricing" or "index"). */
  sourceSlug: string;
  /** Localized slug without locale folder/suffix (e.g. "precios" or "index"). */
  localizedSlug: string;
  /** ISO timestamp when this link was last updated. */
  updatedAt: string;
}

export interface I18nManifest {
  version: 1;
  /** Keyed by repo-relative path of the translated entry. */
  links: Record<string, I18nManifestLink>;
}

export interface TranslationMemoryEntry {
  /** Stable segment id (SHA-256 prefix of sourceLocale + targetLocale + normalized source). */
  id: string;
  sourceLocale: string;
  targetLocale: string;
  source: string;
  target: string;
  updatedAt: string;
}

export interface TranslationMemoryFile {
  version: 1;
  entries: TranslationMemoryEntry[];
}

export interface GlossaryTerm {
  id: string;
  term: string;
  doNotTranslate?: boolean;
  translations?: Record<string, string>;
  note?: string;
}

export interface GlossaryFile {
  version: 1;
  terms: GlossaryTerm[];
}

export interface I18nLocaleSummary {
  code: string;
  label: string;
  prefix: string;
  direction: "ltr" | "rtl";
  isDefault: boolean;
  translated: number;
  outdated: number;
  missing: number;
  total: number;
  percent: number;
  /** Example URL pattern for this locale, e.g. "/es/…" or "/…". */
  urlPattern: string;
}

export interface I18nPageVariant {
  locale: string;
  state: TranslationState;
  /** Repo-relative path of the translated file, or null when missing. */
  path: string | null;
  /** Public URL path (e.g. "/es/precios/"), or null when missing or unrouted. */
  url: string | null;
  /** Localized slug without locale prefix (e.g. "precios"), or null when missing. */
  localizedSlug: string | null;
  updatedAt: string | null;
}

export interface I18nPageRow {
  sourcePath: string;
  collection: string;
  collectionLabel: string;
  title: string;
  sourceSlug: string;
  sourceUrl: string | null;
  variants: Record<string, I18nPageVariant>;
}

export interface I18nOverview {
  /** True when 2+ locales are configured (or i18n is explicitly configured). */
  configured: boolean;
  config: I18nConfig;
  /** True when i18n came from astro.config.* detection rather than galley.config.json. */
  astroDetected: boolean;
  /** True when an astro.config.* file exists in the site root (so 1-click sync is available). */
  hasAstroConfig: boolean;
  locales: I18nLocaleSummary[];
  pages: I18nPageRow[];
  memoryCount: number;
  glossaryCount: number;
  totalSourcePages: number;
}

export interface I18nCounterpart {
  locale: string;
  label: string;
  prefix: string;
  direction: "ltr" | "rtl";
  isDefault: boolean;
  state: TranslationState;
  path: string | null;
  url: string | null;
  localizedSlug: string | null;
}

export interface I18nMemorySuggestion {
  source: string;
  target: string;
  exact: boolean;
}

export interface I18nEntryDetail {
  configured: boolean;
  path: string;
  locale: string;
  localeLabel: string;
  defaultLocale: string;
  defaultLocaleLabel: string;
  isDefault: boolean;
  sourcePath: string;
  sourceTitle: string;
  sourceUrl: string | null;
  currentUrl: string | null;
  localizedSlug: string;
  state: TranslationState;
  outdated: boolean;
  counterparts: I18nCounterpart[];
  /** Default-locale structured front matter for side-by-side manual translation (when viewing a translation). */
  sourceData: Record<string, JsonValue> | null;
  /** Default-locale Markdown body for side-by-side manual translation. */
  sourceBody: string | null;
  /** Dot-joined field path -> TM match for the current entry's target locale. */
  tmMatches: Record<string, I18nMemorySuggestion>;
  /** Body paragraph TM matches for the current entry's target locale. */
  bodyTmMatches: I18nMemorySuggestion[];
}

export interface I18nConfigUpdate {
  defaultLocale: string;
  locales: I18nLocaleConfig[];
  strategy?: I18nStrategy;
  prefixDefaultLocale?: boolean;
  localizeSlugs?: boolean;
  /** Also update astro.config.* `i18n` block as a pending change in Proof. */
  syncAstroConfig?: boolean;
}

export interface I18nCreateEntryInput {
  sourcePath: string;
  targetLocale: string;
  localizedSlug?: string;
  /** Apply exact Translation Memory matches automatically. Default true. */
  applyMemory?: boolean;
}

export interface I18nCreateEntryResult {
  path: string;
  url: string | null;
  locale: string;
  localizedSlug: string;
  reusedSegments: number;
  entry: Entry;
}

export type TranslationMode = "missing_and_outdated" | "missing_only" | "all";

export interface TranslationPlanRequest {
  /** Limit to specific source entry paths. Omit to consider the whole site. */
  paths?: string[];
  /** Limit to specific collection ids. */
  collections?: string[];
  /** Target locale codes to translate into. */
  targetLocales: string[];
  /** Which pages to include. Default "missing_and_outdated". */
  mode?: TranslationMode;
  /** Translate URL slugs per target language. Defaults to site's `i18n.localizeSlugs`. */
  translateSlugs?: boolean;
  /** Optional cap on total (page, locale) tasks. */
  limit?: number;
}

export interface TranslationPlanItem {
  sourcePath: string;
  targetPath: string;
  collection: string;
  title: string;
  targetLocale: string;
  targetLabel: string;
  state: TranslationState;
  sourceSlug: string;
  localizedSlug: string;
  sourceWords: number;
  totalSegments: number;
  tmHits: number;
  segmentsToTranslate: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedUsd: number;
  estimatedCredits: number;
  /** False when 100% of segments are already covered by Translation Memory (0 AI cost). */
  needsAi: boolean;
}

export interface TranslationPlan {
  mode: TranslationMode;
  model: string;
  connected: boolean;
  creditMillicents: number;
  translateSlugs: boolean;
  items: TranslationPlanItem[];
  totalItems: number;
  /** Number of AI model requests required (0 if 100% covered by Translation Memory). */
  requests: number;
  /** Pages that can be fulfilled purely from Translation Memory with 0 AI cost. */
  tmOnlyItems: number;
  sourceWords: number;
  totalSegments: number;
  tmHits: number;
  segmentsToTranslate: number;
  tmSavedTokens: number;
  tmSavedUsd: number;
  tmSavedCredits: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedUsd: number;
  estimatedCredits: number;
  /** True when estimatedCredits exceeds the high-spend confirmation threshold (> 600). */
  requiresConfirmation: boolean;
  note: string;
}

export type TranslationJobItemState = "pending" | "translated" | "reused_tm" | "skipped" | "failed";

export interface TranslationJobItem extends TranslationPlanItem {
  jobState: TranslationJobItemState;
  writtenPath?: string;
  writtenUrl?: string | null;
  reason?: string;
  actualInputTokens?: number;
  actualOutputTokens?: number;
  actualUsd?: number;
  actualCredits?: number;
}

export interface TranslationJobStatus {
  job: Job;
  model: string;
  creditMillicents: number;
  completed: number;
  total: number;
  requests: number;
  actualInputTokens: number;
  actualOutputTokens: number;
  actualUsd: number;
  actualCredits: number;
  tmReusedSegments: number;
  items: TranslationJobItem[];
}
