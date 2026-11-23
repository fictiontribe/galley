/** Building findings from the catalogue, so every one carries its kind, severity, reason and source. */
import { spec, type CheckCode } from "./catalog";
import { SOURCES } from "./sources";
import type { Evidence, Finding, FixProposal, WriteKind } from "./types";
import type { FieldPath } from "../types";

export interface FindingInput {
  /** Distinguishes several findings of one code on one page (an image, a link). */
  key?: string;
  scope?: "page" | "site";
  path?: string;
  url?: string | null;
  pageTitle?: string;
  field?: FieldPath | null;
  fieldLabel?: string;
  evidence?: Evidence;
  fix?: FixProposal | null;
  write?: WriteKind | null;
  rendered?: boolean;
  /** Replaces the catalogue's one-line title with a more specific one. */
  title?: string;
  /** Replaces the catalogue's severity (a page that matters more). */
  severity?: Finding["severity"];
}

export function findingId(code: string, where: string, key?: string): string {
  return `${code}:${where}${key ? `:${key}` : ""}`;
}

export function finding(code: CheckCode, input: FindingInput): Finding {
  const entry = spec(code);
  const where = input.path ?? input.url ?? "site";

  return {
    id: findingId(code, where, input.key),
    code,
    group: entry.group,
    severity: input.severity ?? entry.severity,
    kind: entry.kind,
    title: input.title ?? entry.title,
    why: entry.why,
    ...("source" in entry && entry.source ? { source: SOURCES[entry.source] } : {}),
    scope: input.scope ?? (input.path || input.url ? "page" : "site"),
    ...(input.path ? { path: input.path } : {}),
    ...(input.url !== undefined ? { url: input.url } : {}),
    ...(input.pageTitle ? { pageTitle: input.pageTitle } : {}),
    ...(input.field ? { field: input.field } : {}),
    ...(input.fieldLabel ? { fieldLabel: input.fieldLabel } : {}),
    evidence: input.evidence ?? {},
    ...(input.fix ? { fix: input.fix } : {}),
    ...(input.write ? { write: input.write } : {}),
    rendered: input.rendered ?? false,
  };
}

const SEVERITY_RANK: Record<Finding["severity"], number> = { must: 0, should: 1, idea: 2 };

export function sortFindings(list: Finding[]): Finding[] {
  return [...list].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.group.localeCompare(b.group) || (a.url ?? a.path ?? "").localeCompare(b.url ?? b.path ?? "") || a.id.localeCompare(b.id));
}
