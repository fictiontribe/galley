/**
 * Words and small decisions the Search & AI screens share: how severity and
 * the kind of statement are named, what a batch button says, and which
 * findings a batch would act on. Copy follows brand/voice.md: "search
 * results", "AI assistants", "description shown in results".
 */
import type { Finding, FindingKind, FindingSeverity, WriteKind } from "@galley/core/seo/types";
import { plural } from "@/lib/format";

/** A Badge tone (kept local so this file stays free of UI imports, for tests run without JSX). */
type SeverityTone = "danger" | "warning" | "info";

export const SEVERITY: Record<FindingSeverity, { label: string; tone: SeverityTone }> = {
  must: { label: "Must fix", tone: "danger" },
  should: { label: "Should fix", tone: "warning" },
  idea: { label: "Idea", tone: "info" },
};

/** Who says so, from the source's own label ("Google Search Central — title links" → "Google"). */
export function sourceOwner(finding: Finding): string | null {
  const label = finding.source?.label;

  if (!label) return null;
  return label.split(/\s+[—-]\s+/)[0]!.replace(/ Search Central| Webmaster Blog/, "").replace(/^W3C WCAG 2\.2|^W3C WAI/, "W3C");
}

export function kindLabel(finding: Finding): string {
  const owner = sourceOwner(finding);
  const labels: Record<FindingKind, string> = {
    measurable: "Measured",
    documented: owner ? `Documented by ${owner}` : "Documented",
    judgement: "A judgement, not proven",
  };

  return labels[finding.kind];
}

export const WRITE_LABEL: Record<WriteKind, { one: string; many: (n: number) => string; noun: string }> = {
  description: { one: "Write it for me", many: (n) => `Write the ${n} missing ${n === 1 ? "description" : "descriptions"}`, noun: "description" },
  alt: { one: "Write it for me", many: (n) => `Write alt text for ${n} ${n === 1 ? "image" : "images"}`, noun: "alt text" },
  title: { one: "Suggest a title", many: (n) => `Suggest ${n} clearer ${n === 1 ? "title" : "titles"}`, noun: "title" },
  intro: { one: "Rewrite the opening", many: () => "Rewrite the opening", noun: "opening" },
  faq: { one: "Draft questions and answers", many: (n) => `Draft questions and answers for ${n} ${n === 1 ? "page" : "pages"}`, noun: "questions and answers" },
};

/** What a group's batch button can do: the write kind with the most pages, and the deterministic fixes. */
export function batchesFor(findings: Finding[]): { writes: Array<{ kind: WriteKind; count: number }>; fixes: Finding[] } {
  const writes = new Map<WriteKind, Set<string>>();

  for (const item of findings) {
    if (!item.write || !item.path) continue;
    const set = writes.get(item.write) ?? new Set<string>();

    set.add(`${item.path}:${item.field?.join(".") ?? ""}`);
    writes.set(item.write, set);
  }
  return {
    writes: [...writes.entries()].filter(([, set]) => set.size > 1).map(([kind, set]) => ({ kind, count: set.size })),
    fixes: findings.filter((item) => item.fix),
  };
}

export function count(n: number, one: string, many = plural(one)): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The page a finding is about, as a person names it. */
export function pageName(finding: Finding): string | null {
  if (finding.scope === "site" && !finding.url) return null;
  return finding.pageTitle ?? finding.url ?? finding.path ?? null;
}

export function editorLink(siteId: string, path: string): string {
  return `/sites/${encodeURIComponent(siteId)}/edit?path=${encodeURIComponent(path)}`;
}
