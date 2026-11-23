/**
 * Search & AI visibility tools: read-only audits of the whole site or one
 * entry. Fixes are ordinary edits — the findings carry ready `update_entry`
 * operations for the deterministic ones, and say when the text must be
 * written from the page's own content instead. Shared by the assistant and
 * MCP through the registry.
 */
import { z } from "zod";
import { auditEntry, auditSite } from "../../seo/audit";
import type { Finding, FindingGroup } from "../../seo/types";
import { entryName, plural } from "./labels";
import { defineTool, ok, READ_ONLY, type AssistantTool } from "./types";

const GROUPS = ["titles", "content", "images", "links", "indexing", "structured", "ai"] as const satisfies readonly FindingGroup[];

const FIX_GUIDE =
  "Each finding says what kind of statement it is: \"measurable\" (a fact anyone can check), \"documented\" (the search engine or AI provider says so; `source` links its page) or \"judgement\" (plausible, not proven — say so if you mention it). Findings with `fix` list ready edits: apply each exactly as given with update_entry (its `path` and `ops`), after reading the entry. Findings with `write` need text: write it only from what the page (and the site) already says — never invent a fact, figure, name, price or date; if the page doesn't say it, leave it and tell the person what's missing. Never promise rankings or citations.";

function compact(item: Finding) {
  return {
    id: item.id,
    code: item.code,
    severity: item.severity,
    kind: item.kind,
    title: item.title,
    why: item.why,
    ...(item.source ? { source: item.source.url } : {}),
    ...(item.path ? { path: item.path } : {}),
    ...(item.url ? { url: item.url } : {}),
    ...(item.field ? { field: item.field.join(".") } : {}),
    evidence: {
      ...(item.evidence.value ? { value: item.evidence.value.slice(0, 300) } : {}),
      ...(item.evidence.values ? { values: item.evidence.values.slice(0, 8) } : {}),
      ...(item.evidence.pages ? { pages: item.evidence.pages.slice(0, 8).map((page) => page.url ?? page.path) } : {}),
      ...(item.evidence.measure ? { measure: `${item.evidence.measure.value} ${item.evidence.measure.unit} (flagged past ${item.evidence.measure.limit}): ${item.evidence.measure.reasoning}` } : {}),
      ...(item.evidence.note ? { note: item.evidence.note } : {}),
    },
    ...(item.fix ? { fix: item.fix.edits.map((edit) => ({ path: edit.path, ops: edit.ops, summary: edit.summary })) } : {}),
    ...(item.write ? { write: item.write } : {}),
  };
}

const auditSiteTool = defineTool({
  name: "audit_site",
  title: "Check search and AI visibility",
  description: `Check the whole site for what is wrong or missing for search engines and AI assistants: titles and descriptions shown in results, headings, images and alt text, links, indexing (robots rules, sitemap, preferred addresses), structured data, and AI visibility (AI crawler rules, an agent-readable version, plain openings). Reads the content files always, and the rendered pages when the preview is running or a build exists (it never starts either). Returns counts by severity, a summary, the AI crawler policy in plain words, and findings with evidence — filter with groups/severity, page with offset. ${FIX_GUIDE}`,
  input: z.object({
    groups: z.array(z.enum(GROUPS)).optional().describe("Only these kinds of finding."),
    severity: z.enum(["must", "should", "idea"]).optional().describe("Only this severity."),
    limit: z.number().int().min(1).max(100).optional().describe("Findings to return (default 30)."),
    offset: z.number().int().min(0).optional(),
    rendered: z.boolean().optional().describe("Use the running preview or existing build too (default true). False checks the content files only."),
  }),
  mode: "any",
  effect: READ_ONLY,
  label: () => "Checking how the site shows in search and AI answers",
  async run(input, ctx) {
    const audit = await auditSite(ctx.site, { render: input.rendered === false ? "off" : "auto", ...(input.groups ? { groups: [...input.groups] } : {}) });
    const filtered = input.severity ? audit.findings.filter((item) => item.severity === input.severity) : audit.findings;
    const offset = input.offset ?? 0;
    const page = filtered.slice(offset, offset + (input.limit ?? 30));

    return ok(
      {
        summary: audit.summary,
        counts: audit.counts,
        rendering: audit.rendering.detail,
        crawlers: audit.crawlers.summary,
        agentReadable: audit.agentReadable.summary,
        total: filtered.length,
        findings: page.map(compact),
        ...(filtered.length > offset + page.length ? { more: `pass offset ${offset + page.length} for more` } : {}),
      },
      `Checked search and AI visibility · ${plural(audit.counts.must + audit.counts.should, "thing")} to fix, ${plural(audit.counts.idea, "idea")}`
    );
  },
});

const auditEntryTool = defineTool({
  name: "audit_entry",
  title: "Check one page's search and AI visibility",
  description: `Check one entry: how it would likely show in search results (title, address, description — an approximation), and its findings with evidence, judged against the whole site (duplicates, links). Uses the rendered page when the preview is running or a build exists. ${FIX_GUIDE}`,
  input: z.object({ path: z.string().describe("The entry's path, as listed by list_entries or search_content.") }),
  mode: "any",
  effect: READ_ONLY,
  label: (input, ctx) => `Checking how ${entryName(input.path, ctx.model, ctx.titles)} shows in search results`,
  async run(input, ctx) {
    const audit = await auditEntry(ctx.site, input.path);

    ctx.titles.set(audit.path, audit.title);
    return ok(
      {
        path: audit.path,
        url: audit.url,
        result: { title: audit.preview.title, shownAs: audit.preview.shownTitle, description: audit.preview.description, from: audit.preview.titleFrom, note: "An approximation of a desktop result; search engines may show something else." },
        structuredData: audit.structuredData,
        rendering: audit.rendering.detail,
        counts: audit.counts,
        findings: audit.findings.slice(0, 40).map(compact),
      },
      `Checked ${entryName(audit.path, ctx.model, ctx.titles)} · ${plural(audit.findings.length, "finding")}`
    );
  },
});

export const SEO_TOOLS: AssistantTool[] = [auditSiteTool, auditEntryTool];
