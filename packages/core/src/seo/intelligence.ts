/**
 * Built-in Search & AI Intelligence: live organic rankings, striking-distance
 * quick wins, keyword explorer, competitor content gaps, backlinks & 404 link
 * recovery, and AI answer citations — mapped directly to this site's content
 * entries, schemas, and redirects, with 1-click actions that land in Proof.
 *
 * Dual mode:
 *   - Self-hosted / local (BYOK): reads the "search_data" secret (env
 *     GALLEY_SEARCH_DATA_KEY / SEARCH_DATA_API_KEY or App settings) and sends
 *     HTTP Basic auth to GALLEY_SEARCH_DATA_BASE_URL (or the default endpoint).
 *   - Galley Cloud managed (GALLEY_SEARCH_DATA_MANAGED=1): sends Bearer auth
 *     to the managed proxy URL with zero key setup required.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { noKeyError, rememberSecret, scrubSecrets } from "../ai/errors";
import { safeAiUrl } from "../ai/credits";
import { costFor } from "../ai/models";
import { envSecret } from "../ai/secrets";
import { GalleyError } from "../errors";
import { isSiteId } from "../site/scope";
import { contentWriteRefusal } from "../site/content-code";
import type { Collection, EditOp, Entry, EntrySummary, Field, JsonValue, SearchDataMetaInfo, SettingsService, SiteModel, SiteService } from "../types";
import { readContentPage } from "./content";
import { parseRedirects, pathKey } from "./files";
import { collapse, cut, jaccard, shingles } from "./text";
import type {
  AiCitationItem,
  BrokenBacklinkTarget,
  CannibalizationAlert,
  CompetitorGapItem,
  DraftGapResult,
  IntelligenceRefreshRequest,
  KeywordExploreResult,
  KeywordSuggestionItem,
  RankedKeywordItem,
  ReferringDomainItem,
  SearchDataStatus,
  SearchIntelligenceConfig,
  SearchIntelligenceSnapshot,
  SearchIntelligenceState,
  SearchIntent,
  SerpSnippet,
  TuneEntryResult,
} from "./types";
import { inventedFacts, type WriterDeps } from "./write";

const DEFAULT_SEARCH_DATA_BASE_URL = "https://api.dataforseo.com/v3";
const DEFAULT_LOCATION_CODE = 2840;
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_COMPETITORS = 3;
const MAX_STORED_RANKINGS = 200;

export interface SearchDataRuntimeConfig {
  managed: boolean;
  disabled: boolean;
  baseUrl: string;
}

function truthy(value: string | undefined): boolean {
  if (!value) return false;
  const clean = value.trim().toLowerCase();

  return clean === "1" || clean === "true";
}

/** Reads live search data configuration dynamically from `env`. */
export function readSearchDataConfig(env: NodeJS.ProcessEnv = process.env): SearchDataRuntimeConfig {
  const managed = truthy(env.GALLEY_SEARCH_DATA_MANAGED);
  const disabled = managed && truthy(env.GALLEY_SEARCH_DATA_OFF);
  const customUrl = safeAiUrl(env.GALLEY_SEARCH_DATA_BASE_URL);
  const baseUrl = (customUrl ?? DEFAULT_SEARCH_DATA_BASE_URL).replace(/\/+$/, "");

  return { managed, disabled, baseUrl };
}

/** Public metadata exposed on `GET /api/meta`. Undefined when self-hosted / BYOK. */
export function searchDataMetaFromEnv(env: NodeJS.ProcessEnv = process.env): SearchDataMetaInfo | undefined {
  const config = readSearchDataConfig(env);

  if (!config.managed) return undefined;
  return {
    managed: true,
    ...(config.disabled ? { disabled: true } : {}),
  };
}

/** Builds the Authorization header for managed (Bearer) or BYOK (Basic) credentials. */
export function buildSearchAuthHeader(key: string, managed: boolean): string {
  const trimmed = key.trim();

  if (managed) {
    const bare = trimmed.replace(/^Bearer\s+/i, "").trim();

    return `Bearer ${bare}`;
  }
  const clean = trimmed.replace(/^Basic\s+/i, "").trim();

  if (clean.includes(":")) {
    return `Basic ${Buffer.from(clean, "utf8").toString("base64")}`;
  }
  return `Basic ${clean}`;
}

/** Strips secrets, upstream URLs, and vendor identifiers so internal details never surface. */
export function scrubSearchError(text: string, baseUrl?: string): string {
  let out = scrubSecrets(text);

  if (baseUrl) {
    out = out.split(baseUrl).join("[search-endpoint]");
    try {
      const host = new URL(baseUrl).host;

      if (host) out = out.replace(new RegExp(host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[search-endpoint]");
    } catch {
      // ignore invalid base URL
    }
  }
  out = out.replace(/https?:\/\/[^\s"'<>]+/gi, "[endpoint]");
  out = out.replace(/dataforseo/gi, "live search data");
  return out.trim();
}

/** Normalizes a domain or URL to a bare lowercase hostname (no protocol, www., or path). */
export function normalizeDomain(raw: string | undefined | null): string {
  const trimmed = (raw ?? "").trim();

  if (!trimmed) return "";
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const host = new URL(withProto).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");

    if (!host || !host.includes(".") || !/^[a-z0-9.-]+$/.test(host)) return "";
    return host;
  } catch {
    return "";
  }
}

function defaultDomainOf(model: SiteModel): string {
  return normalizeDomain(model.urls.production) || normalizeDomain(model.urls.staging) || "";
}

function pathnameOf(rawUrl: string | undefined | null): string {
  if (!rawUrl) return "/";
  const trimmed = rawUrl.trim();

  if (!trimmed) return "/";
  if (trimmed.startsWith("/")) return trimmed.split(/[?#]/)[0] || "/";
  try {
    return new URL(trimmed).pathname || "/";
  } catch {
    return "/";
  }
}

function normalizeIntent(value: unknown): SearchIntent | null {
  if (typeof value !== "string") return null;
  const lower = value.trim().toLowerCase();

  if (lower === "informational" || lower === "commercial" || lower === "transactional" || lower === "navigational") return lower;
  return null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function opportunityWeight(position: number): number {
  if (position <= 6) return 1.0;
  if (position <= 10) return 0.75;
  if (position <= 15) return 0.5;
  return 0.3;
}

function positionCtr(position: number): number {
  const table = [0, 0.28, 0.15, 0.11, 0.08, 0.06, 0.05, 0.04, 0.03, 0.025, 0.02];

  if (position >= 1 && position < table.length) return table[Math.round(position)] ?? 0.01;
  if (position <= 20) return 0.01;
  return 0.004;
}

// ── Upstream HTTP client ─────────────────────────────────────────────────

class UpstreamError extends Error {
  constructor(
    readonly status: number,
    readonly taskCode: number | null,
    message: string
  ) {
    super(message);
  }
}

interface SearchCredentials {
  key: string;
  managed: boolean;
  baseUrl: string;
}

async function postSearchEndpoint(
  creds: SearchCredentials,
  endpoint: string,
  payload: unknown[],
  fetchImpl: typeof fetch
): Promise<{ task: Record<string, unknown>; result: Record<string, unknown>[] }> {
  const url = `${creds.baseUrl}/${endpoint.replace(/^\/+/, "")}`;
  const auth = buildSearchAuthHeader(creds.key, creds.managed);

  rememberSecret(creds.key);
  let response: Response;

  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: auth,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(payload),
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new UpstreamError(0, null, scrubSearchError(error instanceof Error ? error.message : String(error), creds.baseUrl));
  }

  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok) {
    const rawMsg = str(rec(body?.error).message) || str(body?.status_message) || `HTTP ${response.status}`;

    throw new UpstreamError(response.status, num(body?.status_code), scrubSearchError(rawMsg, creds.baseUrl));
  }
  const tasks = Array.isArray(body?.tasks) ? (body.tasks as Record<string, unknown>[]) : [];
  const task = rec(tasks[0]);
  const taskCode = num(task.status_code);

  if (taskCode !== null && taskCode >= 40000) {
    const rawMsg = str(task.status_message) || `status ${taskCode}`;

    throw new UpstreamError(Math.floor(taskCode / 100), taskCode, scrubSearchError(rawMsg, creds.baseUrl));
  }
  const result = Array.isArray(task.result) ? (task.result as Record<string, unknown>[]) : [];

  return { task, result };
}

function toUserError(error: unknown, managed: boolean, baseUrl: string): GalleyError {
  if (error instanceof GalleyError) return error;
  if (error instanceof UpstreamError) {
    if (error.status === 401 || error.status === 403 || error.taskCode === 40100 || error.taskCode === 40101) {
      return new GalleyError(
        "unauthorized",
        managed
          ? "Live search data couldn't be reached with this workspace's credentials. Try again shortly."
          : "Live search data credentials were rejected. Check your search data key in App settings."
      );
    }
    if (error.status === 402 || error.taskCode === 40200 || error.taskCode === 40202) {
      return new GalleyError(
        "forbidden",
        managed
          ? "Live search data is temporarily paused for this workspace."
          : "Your live search data account has insufficient balance to run this query."
      );
    }
    if (error.status === 429 || error.taskCode === 40203) {
      return new GalleyError("invalid", "Live search data rate limit reached. Wait a moment and try again.");
    }
    return new GalleyError("internal", "Live search data couldn't be fetched just now. Try again shortly.", scrubSearchError(error.message, baseUrl));
  }
  return new GalleyError(
    "internal",
    "Live search data couldn't be fetched just now. Try again shortly.",
    scrubSearchError(error instanceof Error ? error.message : String(error), baseUrl)
  );
}

function isPlanUnavailable(error: unknown): boolean {
  if (!(error instanceof UpstreamError)) return false;
  if (error.status === 402 || error.status === 403 || error.status === 404 || error.status === 405) return true;
  if (error.taskCode !== null && [40200, 40201, 40202, 40300, 40400, 40501, 40502].includes(error.taskCode)) return true;
  return false;
}

// ── Site route, redirect & schema indexing ───────────────────────────────

interface SiteRouteIndex {
  byPathKey: Map<string, EntrySummary>;
  entries: EntrySummary[];
  redirectSources: Set<string>;
}

async function buildSiteRouteIndex(site: SiteService, model: SiteModel): Promise<SiteRouteIndex> {
  const byPathKey = new Map<string, EntrySummary>();
  const entries: EntrySummary[] = [];

  for (const collection of model.collections) {
    if (collection.kind !== "entries" || collection.url === null) continue;
    const list = await site.listEntries(collection.id, { limit: 1000 }).catch(() => ({ items: [] as EntrySummary[] }));

    for (const item of list.items) {
      if (!item.url) continue;
      entries.push(item);
      byPathKey.set(pathKey(item.url), item);
    }
  }

  const redirectSources = new Set<string>();
  const redirectFiles = [
    model.redirects?.file,
    "src/data/redirects.json",
    "public/_redirects",
    "static/_redirects",
    "_redirects",
    "netlify.toml",
    "vercel.json",
  ].filter((value): value is string => Boolean(value));

  for (const rel of new Set(redirectFiles)) {
    const file = await site.readFile(rel).catch(() => null);

    if (!file || file.binary) continue;
    if (rel.endsWith(".json") && !rel.endsWith("vercel.json")) {
      try {
        const parsed = JSON.parse(file.content) as { redirects?: Array<{ from?: unknown }> } | Array<{ from?: unknown }>;
        const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed.redirects) ? parsed.redirects : [];

        for (const rule of list) {
          if (typeof rule.from === "string" && rule.from.trim()) redirectSources.add(pathKey(rule.from));
        }
      } catch {
        // ignore invalid json
      }
    } else {
      for (const rule of parseRedirects(rel, file.content)) {
        redirectSources.add(pathKey(rule.from));
      }
    }
  }

  return { byPathKey, entries, redirectSources };
}

function tokenizeRoute(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1)
  );
}

/** Suggests the closest live route on the site for a broken backlink URL path. */
export function suggestClosestRoute(brokenPath: string, entries: EntrySummary[]): { url: string; title: string } | null {
  const live = entries.filter((entry) => entry.url && !entry.draft);

  if (!live.length) return null;
  const brokenTokens = tokenizeRoute(brokenPath);
  const brokenShingles = shingles(brokenPath.replace(/[^a-z0-9]+/gi, " "));
  let best: { entry: EntrySummary; score: number } | null = null;

  for (const entry of live) {
    const routeTokens = tokenizeRoute(`${entry.url} ${entry.title}`);
    let overlap = 0;

    for (const token of brokenTokens) {
      if (routeTokens.has(token)) overlap += 1;
    }
    const union = brokenTokens.size + routeTokens.size - overlap;
    const tokenScore = union > 0 ? overlap / union : 0;
    const shingleScore = jaccard(brokenShingles, shingles(`${entry.url} ${entry.title}`));
    const score = tokenScore * 0.7 + shingleScore * 0.3;

    if (!best || score > best.score) best = { entry, score };
  }

  if (best && best.score >= 0.08) {
    return { url: best.entry.url!, title: best.entry.title };
  }
  const home = live.find((entry) => pathKey(entry.url!) === "/");

  return home ? { url: home.url!, title: home.title } : { url: live[0]!.url!, title: live[0]!.title };
}

/** Picks the best collection and block types for a new competitor-gap page. */
export function suggestCollectionAndSections(model: SiteModel, keyword: string, intent: SearchIntent | null): { collection: string | null; sections: string[] } {
  const writable = model.collections.filter((col) => col.kind === "entries" && col.create && col.url !== null && !col.kit);

  if (!writable.length) return { collection: null, sections: [] };
  const blogLike = writable.find((col) => /blog|post|journal|article|news|writing|guide/i.test(`${col.id} ${col.label}`));
  const pageLike = writable.find((col) => /page|solution|landing|service|feature/i.test(`${col.id} ${col.label}`));
  const isInformational = intent === "informational" || /\b(how|what|why|guide|checklist|tutorial|example|vs|compare)\b/i.test(keyword);
  const chosen = (isInformational ? (blogLike ?? pageLike) : (pageLike ?? blogLike)) ?? writable[0]!;
  const blocksField = chosen.fields.find((field) => field.type === "blocks" && field.blocks?.length);
  const sections = blocksField?.blocks
    ? blocksField.blocks
        .map((block) => block.type)
        .filter((type) => /hero|intro|feature|comparison|compare|faq|steps|rich-text|text|cta|checklist|metrics|stats/i.test(type))
        .slice(0, 4)
    : [];

  return {
    collection: chosen.id,
    sections: sections.length ? sections : (blocksField?.blocks?.slice(0, 3).map((b) => b.type) ?? []),
  };
}

// ── Upstream response parsers ────────────────────────────────────────────

function parseRankedKeywords(result: Record<string, unknown>[], domain: string, routeIndex: SiteRouteIndex): RankedKeywordItem[] {
  const items = Array.isArray(rec(result[0]).items) ? (rec(result[0]).items as Record<string, unknown>[]) : [];
  const out: RankedKeywordItem[] = [];

  for (const raw of items) {
    const kwData = rec(raw.keyword_data);
    const kwInfo = rec(kwData.keyword_info);
    const kwProps = rec(kwData.keyword_properties);
    const kwIntent = rec(kwData.search_intent_info);
    const serpElem = rec(raw.ranked_serp_element);
    const serpItem = rec(serpElem.serp_item);
    const changes = rec(serpItem.rank_changes);
    const keyword = str(kwData.keyword) || str(raw.keyword);

    if (!keyword) continue;
    const position = num(serpItem.rank_group) ?? num(serpItem.rank_absolute) ?? num(raw.position);

    if (position === null || position <= 0) continue;
    const searchVolume = Math.max(0, Math.round(num(kwInfo.search_volume) ?? num(raw.search_volume) ?? 0));
    const kd = num(kwProps.keyword_difficulty) ?? num(raw.keyword_difficulty);
    const cpc = num(kwInfo.cpc) ?? num(raw.cpc);
    const intent = normalizeIntent(kwIntent.main_intent ?? raw.intent);
    const rawUrl = str(serpItem.url) || str(serpItem.relative_url) || str(raw.url) || `https://${domain}/`;
    const urlPath = pathnameOf(rawUrl);
    const matched = routeIndex.byPathKey.get(pathKey(urlPath)) ?? null;
    const etv = num(serpItem.etv) ?? num(raw.etv);
    const estimatedVisits = Math.max(0, Math.round(etv ?? searchVolume * positionCtr(position)));
    const prev = num(changes.previous_rank_absolute) ?? num(changes.previous_rank_group) ?? num(raw.previous_position);
    const opportunityScore = position >= 4 && position <= 20 ? Math.round(searchVolume * opportunityWeight(position)) : 0;

    out.push({
      keyword,
      position,
      previousPosition: prev,
      searchVolume,
      keywordDifficulty: kd !== null ? Math.round(kd) : null,
      cpc: cpc !== null ? Math.round(cpc * 100) / 100 : null,
      intent,
      estimatedVisits,
      url: rawUrl,
      urlPath,
      entryPath: matched?.path ?? null,
      entryTitle: matched?.title ?? null,
      collection: matched?.collection ?? null,
      opportunityScore,
    });
  }

  return out.slice(0, MAX_STORED_RANKINGS);
}

function computeCannibalization(rankings: RankedKeywordItem[]): CannibalizationAlert[] {
  const byKw = new Map<string, RankedKeywordItem[]>();

  for (const item of rankings) {
    const key = item.keyword.toLowerCase();
    const list = byKw.get(key) ?? [];

    list.push(item);
    byKw.set(key, list);
  }
  const alerts: CannibalizationAlert[] = [];

  for (const list of byKw.values()) {
    const uniqueByPath = new Map<string, RankedKeywordItem>();

    for (const item of list) {
      const pk = pathKey(item.urlPath);
      const existing = uniqueByPath.get(pk);

      if (!existing || item.position < existing.position) uniqueByPath.set(pk, item);
    }
    if (uniqueByPath.size < 2) continue;
    const pages = [...uniqueByPath.values()]
      .sort((a, b) => a.position - b.position)
      .map((item) => ({
        url: item.url,
        urlPath: item.urlPath,
        position: item.position,
        entryPath: item.entryPath,
        entryTitle: item.entryTitle,
      }));

    alerts.push({
      keyword: list[0]!.keyword,
      searchVolume: Math.max(...list.map((i) => i.searchVolume)),
      pages,
    });
  }
  return alerts.sort((a, b) => b.searchVolume - a.searchVolume).slice(0, 20);
}

function parseCompetitorGaps(
  result: Record<string, unknown>[],
  competitor: string,
  ownKeywords: Set<string>,
  model: SiteModel
): CompetitorGapItem[] {
  const items = Array.isArray(rec(result[0]).items) ? (rec(result[0]).items as Record<string, unknown>[]) : [];
  const gaps: CompetitorGapItem[] = [];

  for (const raw of items) {
    const kwData = rec(raw.keyword_data);
    const kwInfo = rec(kwData.keyword_info);
    const kwProps = rec(kwData.keyword_properties);
    const kwIntent = rec(kwData.search_intent_info);
    const first = rec(raw.first_domain_serp_element);
    const keyword = str(kwData.keyword) || str(raw.keyword);

    if (!keyword || ownKeywords.has(keyword.toLowerCase())) continue;
    const compPos = num(first.rank_group) ?? num(first.rank_absolute) ?? num(raw.competitor_position);

    if (compPos === null || compPos <= 0 || compPos > 10) continue;
    const searchVolume = Math.max(0, Math.round(num(kwInfo.search_volume) ?? num(raw.search_volume) ?? 0));
    const kd = num(kwProps.keyword_difficulty) ?? num(raw.keyword_difficulty);
    const cpc = num(kwInfo.cpc) ?? num(raw.cpc);
    const intent = normalizeIntent(kwIntent.main_intent ?? raw.intent);
    const suggestion = suggestCollectionAndSections(model, keyword, intent);

    gaps.push({
      keyword,
      searchVolume,
      keywordDifficulty: kd !== null ? Math.round(kd) : null,
      cpc: cpc !== null ? Math.round(cpc * 100) / 100 : null,
      intent,
      competitor,
      competitorPosition: compPos,
      competitorUrl: str(first.url) || str(raw.competitor_url) || null,
      suggestedCollection: suggestion.collection,
      suggestedSections: suggestion.sections,
    });
  }
  return gaps;
}

function parseSerpOrganic(result: Record<string, unknown>[], limit = 5): SerpSnippet[] {
  const items = Array.isArray(rec(result[0]).items) ? (rec(result[0]).items as Record<string, unknown>[]) : [];
  const out: SerpSnippet[] = [];

  for (const raw of items) {
    const type = str(raw.type);

    if (type && type !== "organic") continue;
    const title = str(raw.title);
    const url = str(raw.url);

    if (!title || !url) continue;
    const domain = str(raw.domain) || normalizeDomain(url);
    const position = num(raw.rank_group) ?? num(raw.rank_absolute) ?? out.length + 1;

    out.push({
      position,
      title,
      url,
      domain,
      description: str(raw.description),
    });
    if (out.length >= limit) break;
  }
  return out;
}

function parseReferringDomains(result: Record<string, unknown>[]): ReferringDomainItem[] {
  const items = Array.isArray(rec(result[0]).items) ? (rec(result[0]).items as Record<string, unknown>[]) : [];
  const out: ReferringDomainItem[] = [];

  for (const raw of items) {
    const domain = normalizeDomain(str(raw.domain));

    if (!domain) continue;
    out.push({
      domain,
      rank: num(raw.rank) !== null ? Math.round(num(raw.rank)!) : null,
      backlinks: Math.max(0, Math.round(num(raw.backlinks) ?? 0)),
      firstSeen: str(raw.first_seen) || null,
    });
  }
  return out.sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0) || b.backlinks - a.backlinks).slice(0, 50);
}

function parseBrokenBacklinks(result: Record<string, unknown>[], routeIndex: SiteRouteIndex): BrokenBacklinkTarget[] {
  const items = Array.isArray(rec(result[0]).items) ? (rec(result[0]).items as Record<string, unknown>[]) : [];
  const hasKnownRoutes = routeIndex.byPathKey.size > 0;
  const out: BrokenBacklinkTarget[] = [];
  const seen = new Set<string>();

  for (const raw of items) {
    const pageUrl = str(raw.page) || str(raw.url);

    if (!pageUrl) continue;
    const referringDomains = Math.max(0, Math.round(num(raw.referring_domains) ?? 0));

    if (referringDomains <= 0) continue;
    const backlinks = Math.max(0, Math.round(num(raw.backlinks) ?? referringDomains));
    const meta = rec(raw.meta);
    const statusCode = num(raw.status_code) ?? num(meta.status_code);
    const urlPath = pathnameOf(pageUrl);
    const pk = pathKey(urlPath);

    if (seen.has(pk) || routeIndex.redirectSources.has(pk)) continue;
    const isHttpBroken = statusCode !== null && statusCode >= 400;
    const isMissingRoute = hasKnownRoutes && !routeIndex.byPathKey.has(pk) && pk !== "/";

    if (!isHttpBroken && !isMissingRoute) continue;
    seen.add(pk);
    const suggestion = suggestClosestRoute(urlPath, routeIndex.entries);

    out.push({
      url: pageUrl,
      urlPath,
      statusCode,
      referringDomains,
      backlinks,
      suggestedTarget: suggestion?.url ?? null,
      suggestedTitle: suggestion?.title ?? null,
    });
  }
  return out.sort((a, b) => b.referringDomains - a.referringDomains || b.backlinks - a.backlinks).slice(0, 30);
}

function parseAiCitations(result: Record<string, unknown>[], domain: string, routeIndex: SiteRouteIndex): AiCitationItem[] {
  const items = Array.isArray(rec(result[0]).items) ? (rec(result[0]).items as Record<string, unknown>[]) : [];
  const out: AiCitationItem[] = [];

  for (const raw of items) {
    const prompt = str(raw.question) || str(raw.prompt) || str(raw.keyword);

    if (!prompt) continue;
    const platform = str(raw.platform) || str(raw.ai_platform) || str(raw.source_name) || "AI answer";
    const sources = Array.isArray(raw.sources) ? (raw.sources as Record<string, unknown>[]) : [];
    const ownSource =
      sources.find((s) => normalizeDomain(str(s.domain) || str(s.url)) === domain) ??
      sources[0] ??
      null;
    const url = str(raw.url) || (ownSource ? str(ownSource.url) : "") || null;
    const urlPath = url ? pathnameOf(url) : null;
    const matched = urlPath ? (routeIndex.byPathKey.get(pathKey(urlPath)) ?? null) : null;
    const volume = num(raw.ai_search_volume) ?? num(raw.search_volume);
    const mentionedBrand = raw.brand_mentioned === true || raw.mentioned === true || Boolean(url && normalizeDomain(url) === domain);

    out.push({
      prompt,
      platform,
      url,
      urlPath,
      entryPath: matched?.path ?? null,
      entryTitle: matched?.title ?? null,
      mentionedBrand,
      searchVolume: volume !== null ? Math.round(volume) : null,
    });
  }
  return out.slice(0, 30);
}

// ── Persistence (<home>/state/<siteId>/seo-intelligence.json) ────────────

interface StoredIntelligence {
  config: SearchIntelligenceConfig;
  snapshot: SearchIntelligenceSnapshot | null;
}

function createIntelligenceStore(home?: string) {
  const memory = new Map<string, StoredIntelligence>();

  const filePath = (siteId: string): string | null => {
    if (!home || !isSiteId(siteId)) return null;
    return join(home, "state", siteId, "seo-intelligence.json");
  };

  return {
    async read(siteId: string): Promise<StoredIntelligence | null> {
      const path = filePath(siteId);

      if (!path) return memory.get(siteId) ?? null;
      try {
        const parsed = JSON.parse(await readFile(path, "utf8")) as StoredIntelligence;

        if (!parsed || typeof parsed !== "object" || !parsed.config) return null;
        return parsed;
      } catch {
        return null;
      }
    },
    async write(siteId: string, data: StoredIntelligence): Promise<void> {
      const path = filePath(siteId);

      if (!path) {
        memory.set(siteId, data);
        return;
      }
      const dir = join(home!, "state", siteId);

      await mkdir(dir, { recursive: true, mode: 0o700 });
      const tmp = join(dir, `.seo-intelligence-${randomUUID()}.tmp`);

      await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
      await rename(tmp, path);
    },
  };
}

// ── Brand voice reader & Proof action helpers ────────────────────────────

async function readBrandVoice(site: SiteService, model: SiteModel): Promise<string> {
  const candidates = ["galley/brand/guide.md", ...model.ai.instructions];

  for (const rel of candidates) {
    const file = await site.readFile(rel).catch(() => null);

    if (file && !file.binary && file.content.trim()) {
      return cut(file.content.trim(), 2_500);
    }
  }
  return "";
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "new-page"
  );
}

function fillRequiredDefaults(fields: Field[], data: Record<string, JsonValue>, title: string, description: string): Record<string, JsonValue> {
  const next: Record<string, JsonValue> = { ...data };
  const today = new Date().toISOString().slice(0, 10);

  for (const field of fields) {
    if (next[field.key] !== undefined) continue;
    if (field.key === "title") {
      next[field.key] = title;
      continue;
    }
    if (field.key === "description" || field.key === "summary") {
      next[field.key] = description;
      continue;
    }
    if (!field.required) continue;
    if (field.default !== undefined) {
      next[field.key] = field.default;
    } else if (field.type === "date" || field.type === "datetime") {
      next[field.key] = today;
    } else if (field.type === "boolean") {
      next[field.key] = false;
    } else if (field.type === "number") {
      next[field.key] = field.min ?? 0;
    } else if (field.type === "select" && field.options?.length) {
      next[field.key] = field.options[0]!;
    } else if (field.type === "tags" || field.type === "list") {
      next[field.key] = [];
    } else if (field.type === "blocks") {
      const hero = field.blocks?.find((b) => /hero|intro/i.test(b.type)) ?? field.blocks?.[0];
      const textBlock = field.blocks?.find((b) => /rich-text|text|prose|content/i.test(b.type));
      const disc = field.discriminator ?? "type";
      const seeded: JsonValue[] = [];

      if (hero) {
        seeded.push({
          ...(hero.example ?? {}),
          [disc]: hero.type,
          ...(hero.fields.some((f) => f.key === "heading") ? { heading: title } : {}),
          ...(hero.fields.some((f) => f.key === "text") ? { text: description } : {}),
        });
      }
      if (textBlock && textBlock.type !== hero?.type) {
        seeded.push({
          ...(textBlock.example ?? {}),
          [disc]: textBlock.type,
          ...(textBlock.fields.some((f) => f.key === "heading") ? { heading: title } : {}),
          ...(textBlock.fields.some((f) => f.key === "text") ? { text: description } : {}),
        });
      }
      next[field.key] = seeded;
    } else if (field.type === "string" || field.type === "text" || field.type === "markdown") {
      next[field.key] = field.examples?.[0] ?? title;
    }
  }
  return next;
}

const TUNE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    opening: { type: ["string", "null"] },
    summary: { type: "string" },
  },
  required: ["title", "description", "opening", "summary"],
  additionalProperties: false,
};

const DRAFT_GAP_SCHEMA = {
  type: "object",
  properties: {
    slug: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    body: { type: "string" },
    summary: { type: "string" },
  },
  required: ["slug", "title", "description", "body", "summary"],
  additionalProperties: false,
};

// ── Public Intelligence Controller ───────────────────────────────────────

export interface SearchIntelligenceDeps {
  home?: string;
  settings: SettingsService;
  writer: WriterDeps;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  now?: () => Date;
}

export interface SearchIntelligenceController {
  getState(site: SiteService): Promise<SearchIntelligenceState>;
  refresh(site: SiteService, request?: IntelligenceRefreshRequest): Promise<SearchIntelligenceState>;
  explore(site: SiteService, request: { keyword: string; locationCode?: number }): Promise<KeywordExploreResult>;
  tuneEntry(site: SiteService, request: { path: string; keyword: string; locationCode?: number }): Promise<TuneEntryResult>;
  draftGapPage(site: SiteService, request: { keyword: string; collection?: string; locationCode?: number }): Promise<DraftGapResult>;
}

export function createSearchIntelligence(deps: SearchIntelligenceDeps): SearchIntelligenceController {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());
  const store = createIntelligenceStore(deps.home);

  async function resolveStatusAndCreds(site: SiteService): Promise<{ status: SearchDataStatus; creds: SearchCredentials | null }> {
    const runtime = readSearchDataConfig(env);
    const key = await deps.settings.readSecret("search_data", { siteId: site.id }).catch(() => null);

    if (runtime.managed) {
      if (runtime.disabled) {
        return {
          status: { configured: false, managed: true, disabled: true, source: "managed" },
          creds: null,
        };
      }
      const effectiveKey = key ?? envSecret(env, "search_data");

      return {
        status: { configured: Boolean(effectiveKey), managed: true, source: effectiveKey ? "managed" : null },
        creds: effectiveKey ? { key: effectiveKey, managed: true, baseUrl: runtime.baseUrl } : null,
      };
    }

    if (!key) {
      return {
        status: { configured: false, managed: false, source: null },
        creds: null,
      };
    }
    const fromEnv = Boolean(envSecret(env, "search_data"));

    return {
      status: { configured: true, managed: false, source: fromEnv ? "env" : "stored" },
      creds: { key, managed: false, baseUrl: runtime.baseUrl },
    };
  }

  async function loadConfig(site: SiteService, model: SiteModel, override?: IntelligenceRefreshRequest): Promise<{ stored: StoredIntelligence | null; config: SearchIntelligenceConfig }> {
    const stored = await store.read(site.id);
    const domain =
      normalizeDomain(override?.domain) ||
      normalizeDomain(stored?.config.domain) ||
      defaultDomainOf(model);
    const locationCode = override?.locationCode ?? stored?.config.locationCode ?? DEFAULT_LOCATION_CODE;
    const rawCompetitors = override?.competitors ?? stored?.config.competitors ?? [];
    const competitors = [...new Set(rawCompetitors.map((c) => normalizeDomain(c)).filter((c) => Boolean(c) && c !== domain))].slice(0, MAX_COMPETITORS);

    return { stored, config: { domain, locationCode, competitors } };
  }

  async function fetchTopSerp(creds: SearchCredentials | null, keyword: string, locationCode: number, limit = 3): Promise<SerpSnippet[]> {
    if (!creds) return [];
    try {
      const { result } = await postSearchEndpoint(
        creds,
        "serp/google/organic/live/advanced",
        [{ keyword, location_code: locationCode, language_code: "en", depth: 10 }],
        fetchImpl
      );

      return parseSerpOrganic(result, limit);
    } catch {
      return [];
    }
  }

  return {
    async getState(site) {
      const [model, { status }] = await Promise.all([site.model(), resolveStatusAndCreds(site)]);
      const { stored, config } = await loadConfig(site, model);

      return { status, config, snapshot: stored?.snapshot ?? null };
    },

    async refresh(site, request = {}) {
      const [model, { status, creds }] = await Promise.all([site.model(), resolveStatusAndCreds(site)]);

      if (!creds) {
        throw new GalleyError(
          "unconfigured",
          status.managed
            ? status.disabled
              ? "Live search intelligence is switched off for this site."
              : "Live search data isn't connected on this workspace yet."
            : "Connect a live search data key in App settings to fetch rankings, competitor gaps, and backlinks."
        );
      }
      const { config } = await loadConfig(site, model, request);

      if (!config.domain) {
        throw new GalleyError("invalid", "Enter your site's live domain (for example, example.com) to fetch search intelligence.");
      }

      const routeIndex = await buildSiteRouteIndex(site, model);
      const warnings: string[] = [];

      // 1. Primary call: live organic ranked keywords (fatal if credentials/network fail).
      let rankings: RankedKeywordItem[];

      try {
        const rankedRes = await postSearchEndpoint(
          creds,
          "dataforseo_labs/google/ranked_keywords/live",
          [{ target: config.domain, location_code: config.locationCode, language_code: "en", limit: MAX_STORED_RANKINGS }],
          fetchImpl
        );

        rankings = parseRankedKeywords(rankedRes.result, config.domain, routeIndex);
      } catch (error) {
        throw toUserError(error, creds.managed, creds.baseUrl);
      }

      const ownKeywords = new Set(rankings.map((item) => item.keyword.toLowerCase()));
      const strikingDistance = rankings
        .filter((item) => item.position >= 4 && item.position <= 20)
        .sort((a, b) => b.opportunityScore - a.opportunityScore || b.searchVolume - a.searchVolume);
      const cannibalization = computeCannibalization(rankings);

      // 2. Parallel secondary calls: competitor gaps, backlinks, and optional AI citations.
      const [gapResults, backlinkSummary, refDomains, pageSummary, llmMentions] = await Promise.all([
        Promise.all(
          config.competitors.map(async (competitor) => {
            try {
              const res = await postSearchEndpoint(
                creds,
                "dataforseo_labs/google/domain_intersection/live",
                [
                  {
                    target1: competitor,
                    target2: config.domain,
                    target1_intersection: true,
                    target2_intersection: false,
                    location_code: config.locationCode,
                    language_code: "en",
                    limit: 60,
                  },
                ],
                fetchImpl
              );

              return parseCompetitorGaps(res.result, competitor, ownKeywords, model);
            } catch (error) {
              warnings.push(`Competitor gap data for ${competitor} couldn't be loaded (${scrubSearchError(error instanceof Error ? error.message : String(error), creds.baseUrl)}).`);
              return [] as CompetitorGapItem[];
            }
          })
        ),
        postSearchEndpoint(creds, "backlinks/summary/live", [{ target: config.domain, include_subdomains: true }], fetchImpl).catch((error) => {
          if (!isPlanUnavailable(error)) warnings.push("Backlink summary couldn't be loaded just now.");
          return null;
        }),
        postSearchEndpoint(creds, "backlinks/referring_domains/live", [{ target: config.domain, limit: 50 }], fetchImpl).catch(() => null),
        postSearchEndpoint(creds, "backlinks/domain_pages_summary/live", [{ target: config.domain, limit: 50 }], fetchImpl).catch(() => null),
        postSearchEndpoint(
          creds,
          "ai_optimization/llm_mentions/search/live",
          [{ target: [{ domain: config.domain }], location_code: config.locationCode, language_code: "en", limit: 30 }],
          fetchImpl
        )
          .then((res) => ({ available: true as const, items: parseAiCitations(res.result, config.domain, routeIndex) }))
          .catch((error) => {
            if (isPlanUnavailable(error)) {
              return { available: false as const, note: "AI answer citations aren't enabled on this search data account.", items: [] as AiCitationItem[] };
            }
            warnings.push("AI answer citations couldn't be loaded just now.");
            return { available: false as const, note: "AI answer citations couldn't be loaded just now.", items: [] as AiCitationItem[] };
          }),
      ]);

      // Deduplicate competitor gaps by keyword, keeping highest-opportunity entries.
      const gapByKeyword = new Map<string, CompetitorGapItem>();

      for (const list of gapResults) {
        for (const item of list) {
          const key = item.keyword.toLowerCase();
          const existing = gapByKeyword.get(key);

          if (!existing || item.competitorPosition < existing.competitorPosition) gapByKeyword.set(key, item);
        }
      }
      const competitorGaps = [...gapByKeyword.values()]
        .sort((a, b) => b.searchVolume / Math.max(10, b.keywordDifficulty ?? 30) - a.searchVolume / Math.max(10, a.keywordDifficulty ?? 30))
        .slice(0, 60);

      const summaryRec = rec(backlinkSummary?.result[0]);
      const topDomains = refDomains ? parseReferringDomains(refDomains.result) : [];
      const brokenTargets = pageSummary ? parseBrokenBacklinks(pageSummary.result, routeIndex) : [];
      const referringDomainsCount = Math.max(0, Math.round(num(summaryRec.referring_domains) ?? topDomains.length));
      const totalBacklinks = Math.max(0, Math.round(num(summaryRec.backlinks) ?? topDomains.reduce((sum, d) => sum + d.backlinks, 0)));
      const backlinkRank = num(summaryRec.rank) !== null ? Math.round(num(summaryRec.rank)!) : null;

      const snapshot: SearchIntelligenceSnapshot = {
        fetchedAt: now().toISOString(),
        domain: config.domain,
        locationCode: config.locationCode,
        competitors: config.competitors,
        tallies: {
          rankingKeywords: rankings.length,
          top3Count: rankings.filter((r) => r.position <= 3).length,
          estimatedMonthlyVisits: rankings.reduce((sum, r) => sum + r.estimatedVisits, 0),
          strikingDistanceCount: strikingDistance.length,
          referringDomains: referringDomainsCount,
          brokenBacklinkTargets: brokenTargets.length,
          aiCitationsCount: llmMentions.items.length,
        },
        rankings,
        strikingDistance,
        cannibalization,
        competitorGaps,
        backlinks: {
          totalBacklinks,
          referringDomains: referringDomainsCount,
          rank: backlinkRank,
          topDomains,
          brokenTargets,
        },
        aiCitations: llmMentions,
        warnings,
      };

      await store.write(site.id, { config, snapshot });
      return { status, config, snapshot };
    },

    async explore(site, request) {
      const keyword = request.keyword.trim();

      if (!keyword) throw new GalleyError("invalid", "Enter a keyword or topic to explore.");
      const [model, { status, creds }] = await Promise.all([site.model(), resolveStatusAndCreds(site)]);

      if (!creds) {
        throw new GalleyError(
          "unconfigured",
          status.managed
            ? "Live search intelligence isn't active on this workspace."
            : "Connect a live search data key in App settings to explore keywords."
        );
      }
      const { stored, config } = await loadConfig(site, model);
      const locationCode = request.locationCode ?? config.locationCode ?? DEFAULT_LOCATION_CODE;
      const routeIndex = await buildSiteRouteIndex(site, model);
      const rankedByKw = new Map<string, RankedKeywordItem>();

      for (const item of stored?.snapshot?.rankings ?? []) {
        rankedByKw.set(item.keyword.toLowerCase(), item);
      }

      let rawSuggestions: Record<string, unknown>[] = [];

      try {
        const res = await postSearchEndpoint(
          creds,
          "dataforseo_labs/google/keyword_suggestions/live",
          [{ keyword, location_code: locationCode, language_code: "en", limit: 25 }],
          fetchImpl
        );

        rawSuggestions = Array.isArray(rec(res.result[0]).items) ? (rec(res.result[0]).items as Record<string, unknown>[]) : [];
      } catch (error) {
        throw toUserError(error, creds.managed, creds.baseUrl);
      }

      const parsed = rawSuggestions
        .map((raw) => {
          const info = rec(raw.keyword_info);
          const props = rec(raw.keyword_properties);
          const intentInfo = rec(raw.search_intent_info);
          const kw = str(raw.keyword);

          return {
            keyword: kw,
            searchVolume: Math.max(0, Math.round(num(info.search_volume) ?? num(raw.search_volume) ?? 0)),
            keywordDifficulty: num(props.keyword_difficulty) !== null ? Math.round(num(props.keyword_difficulty)!) : null,
            cpc: num(info.cpc) !== null ? Math.round(num(info.cpc)! * 100) / 100 : null,
            intent: normalizeIntent(intentInfo.main_intent ?? raw.intent),
          };
        })
        .filter((item) => item.keyword);

      const missingIntent = parsed.filter((item) => !item.intent).map((item) => item.keyword);
      const [intentRes, serpTop] = await Promise.all([
        missingIntent.length
          ? postSearchEndpoint(creds, "dataforseo_labs/google/search_intent/live", [{ keywords: missingIntent.slice(0, 25), language_code: "en" }], fetchImpl).catch(() => null)
          : Promise.resolve(null),
        fetchTopSerp(creds, keyword, locationCode, 5),
      ]);

      const intentMap = new Map<string, SearchIntent>();

      for (const raw of Array.isArray(rec(intentRes?.result[0]).items) ? (rec(intentRes?.result[0]).items as Record<string, unknown>[]) : []) {
        const kw = str(raw.keyword).toLowerCase();
        const intent = normalizeIntent(rec(raw.keyword_intent).label ?? raw.intent);

        if (kw && intent) intentMap.set(kw, intent);
      }

      const suggestions: KeywordSuggestionItem[] = parsed.map((item) => {
        const lower = item.keyword.toLowerCase();
        const ranked = rankedByKw.get(lower);
        let coveredBy: KeywordSuggestionItem["coveredBy"] = null;

        if (ranked && ranked.entryPath) {
          coveredBy = { entryPath: ranked.entryPath, entryTitle: ranked.entryTitle ?? ranked.entryPath, url: ranked.urlPath, position: ranked.position };
        } else {
          const hit = routeIndex.entries.find(
            (entry) => entry.title.toLowerCase().includes(lower) || (entry.url && entry.url.toLowerCase().includes(slugify(item.keyword)))
          );

          if (hit) coveredBy = { entryPath: hit.path, entryTitle: hit.title, url: hit.url };
        }

        return {
          ...item,
          intent: item.intent ?? intentMap.get(lower) ?? null,
          coveredBy,
        };
      });

      return { keyword, locationCode, suggestions, serpTop };
    },

    async tuneEntry(site, request) {
      const keyword = request.keyword.trim();

      if (!keyword) throw new GalleyError("invalid", "Name the keyword you want to tune this page for.");
      const client = await deps.writer.client();

      if (!client) throw noKeyError();
      const [model, entry, { creds }] = await Promise.all([site.model(), site.readEntry(request.path), resolveStatusAndCreds(site)]);
      const held = contentWriteRefusal(entry.path, model, { origin: "agent" });

      if (held) throw new GalleyError("forbidden", held);
      const collection = model.collections.find((c) => c.id === entry.collection);

      if (!collection) throw new GalleyError("invalid", "That file isn't part of a content collection.");
      const page = readContentPage(entry, collection);
      const { config } = await loadConfig(site, model);
      const locationCode = request.locationCode ?? config.locationCode ?? DEFAULT_LOCATION_CODE;
      const [serpTop, brandVoice] = await Promise.all([fetchTopSerp(creds, keyword, locationCode, 3), readBrandVoice(site, model)]);
      const modelId = await deps.writer.model();
      const serpLines = serpTop.length
        ? serpTop.map((s) => `#${s.position} ${s.title}\n   ${s.description}`).join("\n")
        : "(no live search results fetched)";
      const prompt = [
        `Site: ${model.name}`,
        `Target query: ${keyword}`,
        `Page path: ${entry.path}${page.url ? ` (${page.url})` : ""}`,
        `Current title: ${page.title?.value ?? "(none)"}`,
        `Current description: ${page.description?.value ?? "(none)"}`,
        page.opening ? `Current opening paragraph: ${page.opening.value}` : "Current opening paragraph: (none)",
        "",
        `Top organic search results for "${keyword}":`,
        serpLines,
        brandVoice ? `\nBrand voice:\n${brandVoice}` : "",
        `\nPage text (only facts from here may be used):\n${cut(page.text, 5_000)}`,
      ]
        .filter(Boolean)
        .join("\n");

      const response = await client.messages.create({
        model: modelId,
        max_tokens: 1_500,
        system:
          "You improve a web page's search title (under 60 characters), meta description (110-155 characters), and optionally its opening paragraph so it earns higher clicks for the target query. Use ONLY facts already on the page — never invent figures, prices, guarantees, or claims. Keep the brand's voice. Return null for any field that is already strong or cannot be improved honestly.",
        output_config: { effort: "low", format: { type: "json_schema", schema: TUNE_SCHEMA } },
        messages: [{ role: "user", content: prompt }],
      });

      const usage = {
        model: modelId,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
        cost: costFor(modelId, {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
        }),
        siteId: site.id,
      };

      await deps.writer.record(usage);
      const rawText = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");
      const parsed = JSON.parse(rawText) as { title: string | null; description: string | null; opening: string | null; summary: string };
      const facts = `${model.name}\n${keyword}\n${page.title?.value ?? ""}\n${page.description?.value ?? ""}\n${page.text}`;
      const ops: EditOp[] = [];
      let titleOut: TuneEntryResult["title"] = null;
      let descOut: TuneEntryResult["description"] = null;
      let openingOut: TuneEntryResult["opening"] = null;

      if (parsed.title && page.title?.field && collapse(parsed.title) !== (page.title.value ?? "")) {
        const next = collapse(parsed.title);

        if (next.length <= 75 && inventedFacts(next, facts).length === 0) {
          ops.push({ op: "set", path: page.title.field, value: next });
          titleOut = { before: page.title.value ?? "", after: next, changed: true };
        }
      }
      if (parsed.description && page.description?.field && collapse(parsed.description) !== (page.description.value ?? "")) {
        const next = collapse(parsed.description);

        if (next.length >= 40 && next.length <= 320 && inventedFacts(next, facts).length === 0) {
          ops.push({ op: "set", path: page.description.field, value: next });
          descOut = { before: page.description.value ?? "", after: next, changed: true };
        }
      }
      if (parsed.opening && page.opening && collapse(parsed.opening) !== page.opening.value) {
        const next = collapse(parsed.opening);

        if (next.length <= page.opening.value.length * 1.4 + 60 && inventedFacts(next, facts).length === 0) {
          if (page.opening.field) ops.push({ op: "set", path: page.opening.field, value: next });
          else ops.push({ op: "body-replace", find: page.opening.value, replace: next });
          openingOut = { before: page.opening.value, after: next, changed: true };
        }
      }

      let applied = 0;

      if (ops.length) {
        const edit = await site.updateEntry(entry.path, ops, { origin: "agent", mode: "content" });

        applied = edit.applied;
      }

      return {
        path: entry.path,
        keyword,
        title: titleOut,
        description: descOut,
        opening: openingOut,
        serpTop,
        applied,
        summary: parsed.summary || (applied ? `Updated ${applied} field${applied === 1 ? "" : "s"} in Proof.` : "No changes needed."),
      };
    },

    async draftGapPage(site, request) {
      const keyword = request.keyword.trim();

      if (!keyword) throw new GalleyError("invalid", "Name the topic or keyword you want to draft a page for.");
      const client = await deps.writer.client();

      if (!client) throw noKeyError();
      const [model, { creds }] = await Promise.all([site.model(), resolveStatusAndCreds(site)]);
      const suggested = suggestCollectionAndSections(model, keyword, null);
      const collectionId = request.collection ?? suggested.collection;
      const collection = model.collections.find((c) => c.id === collectionId && c.kind === "entries" && c.create);

      if (!collection) throw new GalleyError("invalid", "No writable collection is available to draft a new page in.");
      const { config } = await loadConfig(site, model);
      const locationCode = request.locationCode ?? config.locationCode ?? DEFAULT_LOCATION_CODE;
      const [serpTop, brandVoice, existingList] = await Promise.all([
        fetchTopSerp(creds, keyword, locationCode, 3),
        readBrandVoice(site, model),
        site.listEntries(collection.id, { limit: 500 }).catch(() => ({ items: [] as EntrySummary[] })),
      ]);
      const modelId = await deps.writer.model();
      const serpLines = serpTop.length
        ? serpTop.map((s) => `#${s.position} ${s.title}\n   ${s.description}`).join("\n")
        : "(no live search results fetched)";
      const prompt = [
        `Site: ${model.name}`,
        `Target keyword / topic: ${keyword}`,
        `Collection: ${collection.label} (${collection.id})`,
        suggested.sections.length ? `Available page sections: ${suggested.sections.join(", ")}` : "",
        "",
        `Top organic search results for "${keyword}":`,
        serpLines,
        brandVoice ? `\nBrand voice:\n${brandVoice}` : "",
        "",
        "Write a clear, helpful draft outline and opening sections in plain Markdown so an editor can review, flesh out site-specific facts, and publish from Proof. Mark any placeholder facts clearly with [TBD] rather than inventing figures or customer claims.",
      ]
        .filter(Boolean)
        .join("\n");

      const response = await client.messages.create({
        model: modelId,
        max_tokens: 2_500,
        system:
          "You draft a well-structured initial page in plain Markdown for a content editor to review in Proof. Keep the title under 60 characters, description 110-155 characters, and slug short and lowercase hyphenated. Never invent customer quotes, certifications, or fabricated pricing; use clear [TBD] notes where team input is needed.",
        output_config: { effort: "low", format: { type: "json_schema", schema: DRAFT_GAP_SCHEMA } },
        messages: [{ role: "user", content: prompt }],
      });

      await deps.writer.record({
        model: modelId,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
        cost: costFor(modelId, {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
        }),
        siteId: site.id,
      });

      const rawText = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");
      const parsed = JSON.parse(rawText) as { slug: string; title: string; description: string; body: string; summary: string };
      const existingSlugs = new Set(existingList.items.map((item) => item.slug.toLowerCase()));
      const baseSlug = slugify(parsed.slug || keyword);
      let slug = baseSlug;
      let suffix = 2;

      while (existingSlugs.has(slug)) {
        slug = `${baseSlug}-${suffix}`;
        suffix += 1;
      }

      const title = collapse(parsed.title) || keyword;
      const description = collapse(parsed.description) || `Overview of ${keyword}.`;
      const initialData: Record<string, JsonValue> = {};

      if (collection.titleField) initialData[collection.titleField] = title;
      else initialData.title = title;
      if (collection.fields.some((f) => f.key === "description")) initialData.description = description;
      if (collection.draftField) initialData[collection.draftField] = true;
      const data = fillRequiredDefaults(collection.fields, initialData, title, description);
      const created: Entry = await site.createEntry(
        {
          collection: collection.id,
          slug,
          data,
          ...(collection.body ? { body: parsed.body.trim() } : {}),
        },
        { origin: "agent", mode: "content" }
      );

      return {
        path: created.path,
        collection: collection.id,
        slug: created.slug,
        title: created.title,
        url: created.url,
        keyword,
        serpTop,
        summary: parsed.summary || `Drafted ${created.path} in Proof.`,
      };
    },
  };
}
