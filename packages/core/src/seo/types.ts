/**
 * Search & AI visibility: the shapes the audit engine, the HTTP routes, the
 * assistant's tools and the web UI share. Types only — no runtime code and no
 * Node or DOM imports, so any package can import it.
 *
 * Every finding states what kind of statement it is:
 *   measurable — a fact about the site anyone can check (a title is missing,
 *                a link points at no page);
 *   documented — a search engine or AI provider says so in its own
 *                documentation (the finding carries the link);
 *   judgement  — plausible advice the platforms do not document. The product
 *                never presents these as fact.
 */
import type { EditOp, FieldPath } from "../types";

export type FindingSeverity = "must" | "should" | "idea";
export type FindingKind = "measurable" | "documented" | "judgement";
export type FindingGroup = "titles" | "content" | "images" | "links" | "indexing" | "structured" | "ai";

/** What the assistant can write for a finding (needs a connected assistant). */
export type WriteKind = "description" | "alt" | "title" | "intro" | "faq";

export interface SourceRef {
  /** Who says it, in plain words: "Google Search Central — title links". */
  label: string;
  url: string;
  /** When the page was read for this product (ISO date). */
  checked: string;
}

export interface PageRef {
  path?: string;
  url: string | null;
  title?: string;
}

/** The numbers behind a length finding, with the reasoning shown, not just a verdict. */
export interface Measure {
  label: string;
  value: number;
  limit: number;
  unit: "px" | "characters" | "words" | "bytes" | "pixels wide";
  reasoning: string;
}

export interface Evidence {
  /** The offending value, exactly as stored or served. */
  value?: string;
  /** Several values (the duplicated titles, the blocked paths). */
  values?: string[];
  /** Other pages involved (the duplicates, the pages that link here). */
  pages?: PageRef[];
  measure?: Measure;
  /** One more plain sentence of evidence. */
  note?: string;
}

/** A change Galley can make by itself: ordinary edits through SiteService, one entry each. */
export interface FixEdit {
  path: string;
  ops: EditOp[];
  /** One line for the confirmation: "Set Title to “About us”". */
  summary: string;
}

export interface FixProposal {
  /** The button: "Remove the repeated name". */
  label: string;
  edits: FixEdit[];
  before?: string;
  after?: string;
}

export interface Finding {
  /** Stable across runs while the problem stays the same: code + where. */
  id: string;
  code: string;
  group: FindingGroup;
  severity: FindingSeverity;
  kind: FindingKind;
  /** One line: what is wrong or missing. */
  title: string;
  /** One line: why it matters. */
  why: string;
  source?: SourceRef;
  /** "page": about one page. "site": about the site as a whole. */
  scope: "page" | "site";
  path?: string;
  url?: string | null;
  pageTitle?: string;
  field?: FieldPath;
  fieldLabel?: string;
  evidence: Evidence;
  fix?: FixProposal;
  /** The assistant can write this (never offered when the page lacks a field to write into). */
  write?: WriteKind;
  /** Found on the rendered page rather than in the content files. */
  rendered: boolean;
}

/** Which rendered version of the site the rendered checks used. */
export interface RenderInfo {
  source: "preview" | "build" | "none";
  /** Plain words: "The running preview", "The last build (2 hours old)". */
  detail: string;
  /** Pages fetched or read. */
  sampled: number;
  /** Pages the site has. */
  total: number;
  cap: number;
  /** The build is older than the newest content change. */
  stale?: boolean;
}

export interface CheckInfo {
  code: string;
  group: FindingGroup;
  severity: FindingSeverity;
  kind: FindingKind;
  needsRender: boolean;
  /** Network requests to other sites: only when asked. */
  network?: boolean;
  title: string;
  why: string;
  source?: SourceRef;
}

export type CrawlerPurpose = "search" | "training" | "user" | "dataset";

export interface CrawlerInfo {
  /** The robots.txt user-agent token, e.g. "OAI-SearchBot". */
  token: string;
  vendor: string;
  /** "ChatGPT's search crawler". */
  label: string;
  purpose: CrawlerPurpose;
  /** False for a control token: the provider reads its rules but fetches nothing under that name. */
  crawls: boolean;
  /** What it does, from the vendor's own page. */
  what: string;
  /** What blocking it does, from the vendor's own page. */
  ifBlocked: string;
  /** Caveats the vendor itself states ("robots rules may not apply"). */
  caveat?: string;
  source: SourceRef;
}

export interface CrawlerStatus extends CrawlerInfo {
  allowed: boolean;
  /** "rule": a group names this token. "wildcard": the * group decides. "default": no rule at all. "fallback": Applebot following Googlebot rules. */
  decidedBy: "rule" | "wildcard" | "default" | "fallback";
}

export interface CrawlerReport {
  /**
   * Where the rules come from. "generated": the site writes robots.txt in
   * code. "kit": the site kit writes it from its data file (`path`), where
   * the crawler choices are kept.
   */
  where: { kind: "static"; path: string } | { kind: "generated"; path: string } | { kind: "kit"; path: string } | { kind: "none" };
  /** On a kit site: the policy in the kit's own words ("Blocks AI training (GPTBot); …"). */
  policy?: string;
  /** Whether the served robots.txt could be read (static file, preview or build). */
  readable: boolean;
  /** Where the text that was evaluated came from. */
  readFrom: "file" | "kit" | "preview" | "build" | null;
  /** The whole site blocked for every crawler. */
  blocksEverything: boolean;
  crawlers: CrawlerStatus[];
  /** One plain paragraph per vendor: "ChatGPT's search crawler is allowed; its training crawler is blocked." */
  summary: string[];
  /** Whether the app can change the rules itself (a static robots.txt it may write). */
  editable: boolean;
  /** Why not, when it can't. */
  editNote?: string;
  sitemaps: string[];
}

/** What the site kit is set to publish (from its data file), on a kit site. */
export interface KitPublishing {
  /** The data file. */
  file: string;
  llmsTxt: boolean;
  llmsFullTxt: boolean;
  markdownTwins: boolean;
  agentPage: boolean;
}

export interface AgentReadableReport {
  /** Set on a site that uses the kit. */
  kit?: KitPublishing;
  /** `/agent.md` and `/llms-full.txt` are served (when it could be checked). */
  agentPage?: boolean;
  fullText?: boolean;
  llmsTxt: { present: boolean; url?: string; valid?: boolean; problem?: string; links?: number };
  /** Pages (of those checked) advertising a markdown version with rel="alternate" type="text/markdown". */
  markdownTwins: { checked: number; advertised: number; reachable: number };
  /** Whether this could be judged at all (needs a preview or a build). */
  known: boolean;
  /** Plain sentence. */
  summary: string;
}

export interface SeverityCounts {
  must: number;
  should: number;
  idea: number;
}

export interface SiteAudit {
  generatedAt: string;
  durationMs: number;
  pages: { checked: number; reused: number };
  rendering: RenderInfo;
  counts: SeverityCounts;
  byGroup: Record<FindingGroup, SeverityCounts>;
  /** Two or three honest sentences. Never a score. */
  summary: string;
  findings: Finding[];
  /** Checks that couldn't run this time, and why. */
  skipped: Array<{ code: string; reason: string }>;
  crawlers: CrawlerReport;
  agentReadable: AgentReadableReport;
  checks: CheckInfo[];
}

/** The search-result preview for one page: a clearly labelled approximation. */
export interface ResultPreview {
  title: string;
  /** "rendered": the page's real <title>. "content": the title field (the site may add its name). */
  titleFrom: "rendered" | "content" | "none";
  /** What a desktop result would likely show, cut at the estimated width. */
  shownTitle: string;
  titleWidth: number;
  titleLimit: number;
  /** "example.com › about": the address as results show it. */
  address: string;
  description: string;
  descriptionFrom: "rendered" | "content" | "none";
  shownDescription: string;
  titleField?: FieldPath;
  descriptionField?: FieldPath;
}

export interface EntryAudit {
  path: string;
  url: string | null;
  title: string;
  findings: Finding[];
  preview: ResultPreview;
  /** schema.org types on the rendered page; null when it wasn't rendered. */
  structuredData: string[] | null;
  rendering: RenderInfo;
  counts: SeverityCounts;
}

export interface AuditOptions {
  /** "auto" (default): use a running preview or an existing build. "off": content files only. */
  render?: "auto" | "off";
  /** Most pages to render. Default 60. */
  renderCap?: number;
  /** Only these groups. */
  groups?: FindingGroup[];
  /** Today, for "upcoming" dates (tests). */
  now?: Date;
}

export interface FixResult {
  applied: Array<{ id: string; path: string }>;
  refused: Array<{ id: string; reason: string }>;
  /** Puts every file the fixes changed back, until the app restarts. */
  undoId: string | null;
}

export interface WritePlanItem {
  path: string;
  title: string;
  url: string | null;
  field: FieldPath;
  fieldLabel: string;
  /** For alt text: the image. */
  image?: string;
  /** The value when it was checked; the batch leaves it alone if it has changed since. */
  current?: string;
}

export interface WritePlan {
  kind: WriteKind;
  items: WritePlanItem[];
  /** One model request per page. */
  requests: number;
  model: string;
  /** Whether an assistant key is configured. */
  connected: boolean;
  /** Plain sentence about what the batch does and doesn't do. */
  note: string;
}

export interface WriteItemResult extends WritePlanItem {
  state: "pending" | "written" | "skipped" | "failed";
  value?: string;
  /** Why it was skipped or failed, in plain words. */
  reason?: string;
}

export interface WriteBatchStatus {
  job: import("../types").Job;
  kind: WriteKind;
  items: WriteItemResult[];
  requests: number;
}

/** What an AI agent receives for one page. */
export interface AgentView {
  url: string;
  /** "markdown": the page's own markdown version. "text": the page's text with scripts off. "content": from the content files (nothing rendered). */
  kind: "markdown" | "text" | "content";
  /** Where it was read. */
  from: string;
  text: string;
  truncated: boolean;
}

export type CrawlerChoice = "allow" | "block";

// ── search & AI intelligence (live search data) ──────────────────────────

export type SearchIntent = "informational" | "commercial" | "transactional" | "navigational";

export interface SearchDataStatus {
  /** True when live search data is ready (BYOK key set or managed mode on). */
  configured: boolean;
  /** True when included automatically through Galley Cloud managed search intelligence. */
  managed: boolean;
  /** True when managed search intelligence is switched off for this site. */
  disabled?: boolean;
  /** Where the credentials come from. */
  source: "env" | "stored" | "managed" | null;
}

export interface SearchIntelligenceConfig {
  /** Target domain being tracked (e.g. "example.com"). */
  domain: string;
  /** Numeric location code (default 2840 = United States, 2826 = United Kingdom). */
  locationCode: number;
  /** Up to 3 competitor domains to compare content gaps against. */
  competitors: string[];
}

export interface RankedKeywordItem {
  keyword: string;
  position: number;
  previousPosition?: number | null;
  searchVolume: number;
  keywordDifficulty: number | null;
  cpc: number | null;
  intent: SearchIntent | null;
  estimatedVisits: number;
  /** Full or path URL returned by search rankings. */
  url: string;
  /** Normalized pathname (e.g. "/pricing/"). */
  urlPath: string;
  /** Matched Galley content entry, when one owns this route. */
  entryPath: string | null;
  entryTitle: string | null;
  collection: string | null;
  /** Opportunity score for striking-distance prioritisation. */
  opportunityScore: number;
}

export interface CannibalizationAlert {
  keyword: string;
  searchVolume: number;
  pages: Array<{
    url: string;
    urlPath: string;
    position: number;
    entryPath: string | null;
    entryTitle: string | null;
  }>;
}

export interface CompetitorGapItem {
  keyword: string;
  searchVolume: number;
  keywordDifficulty: number | null;
  cpc: number | null;
  intent: SearchIntent | null;
  competitor: string;
  competitorPosition: number;
  competitorUrl: string | null;
  /** Suggested collection in this site's model where a new page fits best. */
  suggestedCollection: string | null;
  /** Suggested section types from that collection's blocks schema. */
  suggestedSections: string[];
}

export interface ReferringDomainItem {
  domain: string;
  rank: number | null;
  backlinks: number;
  firstSeen: string | null;
}

export interface BrokenBacklinkTarget {
  /** Broken URL on this site that still has live referring domains. */
  url: string;
  urlPath: string;
  statusCode: number | null;
  referringDomains: number;
  backlinks: number;
  /** Closest live route on the site to redirect visitors and link equity to. */
  suggestedTarget: string | null;
  suggestedTitle: string | null;
}

export interface AiCitationItem {
  prompt: string;
  platform: string;
  url: string | null;
  urlPath: string | null;
  entryPath: string | null;
  entryTitle: string | null;
  mentionedBrand: boolean;
  searchVolume: number | null;
}

export interface IntelligenceTallies {
  rankingKeywords: number;
  top3Count: number;
  estimatedMonthlyVisits: number;
  strikingDistanceCount: number;
  referringDomains: number;
  brokenBacklinkTargets: number;
  aiCitationsCount: number;
}

export interface SearchIntelligenceSnapshot {
  fetchedAt: string;
  domain: string;
  locationCode: number;
  competitors: string[];
  tallies: IntelligenceTallies;
  rankings: RankedKeywordItem[];
  strikingDistance: RankedKeywordItem[];
  cannibalization: CannibalizationAlert[];
  competitorGaps: CompetitorGapItem[];
  backlinks: {
    totalBacklinks: number;
    referringDomains: number;
    rank: number | null;
    topDomains: ReferringDomainItem[];
    brokenTargets: BrokenBacklinkTarget[];
  };
  aiCitations: {
    available: boolean;
    note?: string;
    items: AiCitationItem[];
  };
  /** Non-fatal partial notices (for example, an optional feed unavailable on this account). */
  warnings: string[];
}

export interface SearchIntelligenceState {
  status: SearchDataStatus;
  config: SearchIntelligenceConfig;
  snapshot: SearchIntelligenceSnapshot | null;
}

export interface IntelligenceRefreshRequest {
  domain?: string;
  locationCode?: number;
  competitors?: string[];
}

export interface KeywordSuggestionItem {
  keyword: string;
  searchVolume: number;
  keywordDifficulty: number | null;
  cpc: number | null;
  intent: SearchIntent | null;
  /** Whether the site already ranks for or has an entry matching this keyword. */
  coveredBy: { entryPath: string; entryTitle: string; url: string | null; position?: number } | null;
}

export interface SerpSnippet {
  position: number;
  title: string;
  url: string;
  domain: string;
  description: string;
}

export interface KeywordExploreResult {
  keyword: string;
  locationCode: number;
  suggestions: KeywordSuggestionItem[];
  serpTop: SerpSnippet[];
}

export interface TuneEntryResult {
  path: string;
  keyword: string;
  title: { before: string; after: string; changed: boolean } | null;
  description: { before: string; after: string; changed: boolean } | null;
  opening: { before: string; after: string; changed: boolean } | null;
  serpTop: SerpSnippet[];
  applied: number;
  summary: string;
}

export interface DraftGapResult {
  path: string;
  collection: string;
  slug: string;
  title: string;
  url: string | null;
  keyword: string;
  serpTop: SerpSnippet[];
  summary: string;
}
