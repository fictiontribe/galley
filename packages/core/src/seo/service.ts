/**
 * The visibility service the server holds: one per app, shared by every
 * site. It wires the audit, fixes, the AI-crawler policy and assistant-written
 * batches to the app's settings (for the API key and model), usage records
 * and job events. Everything acts through SiteService.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { createApiClient } from "../ai/runtime";
import { scrubSecrets } from "../ai/errors";
import type { UsageLine } from "../ai/usage";
import type { EventBus, SettingsService, SiteService } from "../types";
import { auditEntry, auditSite } from "./audit";
import { agentView, checkExternalLinks, type ExternalOptions } from "./external";
import { applyFixes, undoFixes } from "./fixes";
import { applyCrawlerPolicy, crawlerReport, readRobots } from "./policy";
import { findRenderSource } from "./render";
import type { AgentView, AuditOptions, CrawlerChoice, CrawlerReport, EntryAudit, Finding, FixResult, SiteAudit, WriteBatchStatus, WriteKind, WritePlan } from "./types";
import { createWriteBatches, planWrite, type WriterDeps } from "./write";

export interface VisibilityService {
  audit(site: SiteService, options?: AuditOptions): Promise<SiteAudit>;
  entry(site: SiteService, path: string, options?: AuditOptions): Promise<EntryAudit>;
  fix(site: SiteService, ids: string[]): Promise<FixResult>;
  undo(site: SiteService, undoId: string): Promise<string[]>;
  crawlers(site: SiteService): Promise<CrawlerReport>;
  setCrawlers(site: SiteService, choices: Record<string, CrawlerChoice>): Promise<CrawlerReport>;
  agentView(site: SiteService, urlPath: string): Promise<AgentView>;
  planWrite(site: SiteService, kind: WriteKind, paths?: string[]): Promise<WritePlan>;
  startWrite(site: SiteService, kind: WriteKind, options?: { paths?: string[]; limit?: number }): Promise<WriteBatchStatus>;
  writeStatus(jobId: string): WriteBatchStatus | null;
  cancelWrite(jobId: string): void;
  externalLinks(site: SiteService, options?: ExternalOptions): Promise<{ checked: number; total: number; findings: Finding[] }>;
  dispose(): void;
}

export interface VisibilityServiceOptions {
  settings: SettingsService;
  events: EventBus;
  /** Test seam: a pre-built client (one constructed with a scripted fetch). */
  client?: Anthropic;
  env?: NodeJS.ProcessEnv;
  logger?: (line: string) => void;
}

export function createVisibilityService(options: VisibilityServiceOptions): VisibilityService {
  const env = options.env ?? process.env;
  const log = (line: string) => (options.logger ?? ((text: string) => process.stderr.write(`[visibility] ${text}\n`)))(scrubSecrets(line));
  const deps: WriterDeps = {
    async client() {
      const key = await options.settings.readSecret("anthropic").catch(() => null);

      if (!key) return null;
      return options.client ?? createApiClient(key, env, 2);
    },
    async model() {
      return (await options.settings.get()).ai.model;
    },
    async record(usage) {
      // A batch request is a request, not a conversation turn.
      const line: UsageLine = { ...usage, requests: 1, at: Date.now(), kind: "summary" };

      await options.settings.recordUsage(line);
    },
    events: options.events,
    log,
  };
  const batches = createWriteBatches(deps);

  return {
    audit: (site, auditOptions) => auditSite(site, auditOptions),
    entry: (site, path, auditOptions) => auditEntry(site, path, auditOptions),
    fix: (site, ids) => applyFixes(site, ids),
    undo: (site, undoId) => undoFixes(site, undoId),
    async crawlers(site) {
      const model = await site.model();

      return crawlerReport(await readRobots(site, await findRenderSource(site, model, 0)), model.ai.allowBuild);
    },
    async setCrawlers(site, choices) {
      await applyCrawlerPolicy(site, choices);
      return this.crawlers(site);
    },
    agentView: (site, urlPath) => agentView(site, urlPath),
    planWrite: (site, kind, paths) => planWrite(site, kind, deps, paths),
    startWrite: (site, kind, writeOptions) => batches.start(site, kind, writeOptions),
    writeStatus: (jobId) => batches.status(jobId),
    cancelWrite: (jobId) => batches.cancel(jobId),
    externalLinks: (site, externalOptions) => checkExternalLinks(site, externalOptions),
    dispose: () => batches.dispose(),
  };
}
