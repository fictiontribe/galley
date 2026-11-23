/**
 * seo/ — search and AI visibility: the audit (content checks always,
 * rendered checks when a preview or build exists), deterministic fixes as
 * ordinary edits, the AI-crawler policy as a file of the site's own, and
 * assistant-written fixes in batches. See docs/seo-and-ai-visibility.md.
 */
export * from "./types";
export { auditSite, auditEntry, auditEntries, forgetAudit, lastFinding, lastFindings, resultPreview } from "./audit";
export { checkCatalogue, GROUP_LABELS, GROUP_ORDER, type CheckCode } from "./catalog";
export { finding } from "./finding";
export { SOURCES } from "./sources";
export { applyFixes, undoFixes } from "./fixes";
export { applyCrawlerPolicy, crawlerReport, locateRobots, readRobots } from "./policy";
export { CRAWLERS, crawlerStatus, isAllowed, parseRobots, planRobotsPolicy, summarizeCrawlers, POLICY_START, POLICY_END } from "./robots";
export { parseLlmsTxt, parseRedirects, parseSitemap, pathKey } from "./files";
export { parsePage } from "./html";
export { DISPLAY, fitWidth, jaccard, shingles, similarPairs, textWidth } from "./text";
export { agentView, checkExternalLinks } from "./external";
export { answerToOps, createWriteBatches, inventedFacts, planWrite, WRITE_INSTRUCTIONS, WRITE_MAX_BATCH } from "./write";
export { createVisibilityService } from "./service";
export type { VisibilityService, VisibilityServiceOptions } from "./service";
