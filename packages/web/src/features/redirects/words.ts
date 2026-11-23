/**
 * The words the redirects screens use, in one place: an address as an
 * editor reads it ("Everything under /blog/"), permanent or temporary, where
 * a redirect came from, and the problem filters. Pure, so it is tested
 * without a browser. Copy follows brand/voice.md: old address, new address,
 * permanent, temporary — never rule, regex or splat.
 */
import type { RedirectIssue, RedirectIssueCode, RedirectStatus } from "@galley/core/redirects-info";

export function isWildcard(from: string): boolean {
  return from.endsWith("*");
}

/** The parts of an old address for display: "Everything under" + "/blog/", or just the path. */
export function oldAddressParts(from: string): { lead: string | null; path: string } {
  return isWildcard(from) ? { lead: "Everything under", path: from.slice(0, -1) } : { lead: null, path: from };
}

/** The parts of a new address: "/journal/" + "and the rest of the address" when it carries what the wildcard matched. */
export function newAddressParts(to: string): { path: string; tail: string | null } {
  return to.endsWith(":splat") ? { path: to.slice(0, -":splat".length), tail: "+ the rest of the address" } : { path: to, tail: null };
}

export function kindWord(status: RedirectStatus): "Permanent" | "Temporary" {
  return status === 301 || status === 308 ? "Permanent" : "Temporary";
}

export const KIND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "301", label: "Permanent (301)" },
  { value: "308", label: "Permanent, keeps the method (308)" },
  { value: "302", label: "Temporary (302)" },
  { value: "307", label: "Temporary, keeps the method (307)" },
];

/** "import:wordpress" → "WordPress import". */
export function sourceLabel(source: string | undefined): string {
  if (!source || source === "manual") return "Added here";
  const kind = source.replace(/^import:/, "");
  const names: Record<string, string> = {
    wordpress: "WordPress import",
    list: "Pasted list",
    apache: "Apache file",
    nginx: "nginx file",
    "redirects-file": "_redirects file",
    "cloudflare-csv": "Cloudflare list",
    "vercel-json": "Vercel settings",
  };

  return names[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** Problem filters, in the order they're offered, with the words for each. */
export const PROBLEM_LABELS: Partial<Record<RedirectIssueCode, { one: string; many: string }>> = {
  loop: { one: "Goes round in a circle", many: "Go round in a circle" },
  conflict: { one: "Sent to two places", many: "Sent to two places" },
  self: { one: "Points at itself", many: "Point at themselves" },
  "live-page": { one: "Hides a live page", many: "Hide live pages" },
  "broken-target": { one: "Leads nowhere", many: "Lead nowhere" },
  chain: { one: "Takes more than one step", many: "Take more than one step" },
  duplicate: { one: "Listed twice", many: "Listed twice" },
  "from-query": { one: "Old address has a query", many: "Old addresses with a query" },
  "case-twin": { one: "Differs only in capitals", many: "Differ only in capitals" },
  "host-unsupported": { one: "Changed for the host", many: "Changed for the host" },
  "host-limit": { one: "Too long for the host", many: "Too long for the host" },
  "splat-without-wildcard": { one: "Can't work as written", many: "Can't work as written" },
};

/** Issues by the position they're about, for marking rows. The first index of each issue is its own row. */
export function issuesByRow(issues: RedirectIssue[]): Map<number, RedirectIssue[]> {
  const out = new Map<number, RedirectIssue[]>();

  for (const issue of issues) {
    if (issue.code === "shadowed") continue;
    const rows = issue.code === "loop" || issue.code === "conflict" || issue.code === "duplicate" ? issue.indices : issue.indices.slice(0, 1);

    for (const row of rows) out.set(row, [...(out.get(row) ?? []), issue]);
  }
  return out;
}

/** Filter choices with counts, only those that occur. */
export function problemFilters(issues: RedirectIssue[]): Array<{ code: RedirectIssueCode; label: string; count: number }> {
  const rows = new Map<RedirectIssueCode, Set<number>>();

  for (const [row, list] of issuesByRow(issues)) {
    for (const issue of list) {
      if (!PROBLEM_LABELS[issue.code]) continue;
      if (!rows.has(issue.code)) rows.set(issue.code, new Set());
      rows.get(issue.code)!.add(row);
    }
  }
  return (Object.keys(PROBLEM_LABELS) as RedirectIssueCode[]).filter((code) => rows.has(code)).map((code) => ({ code, label: PROBLEM_LABELS[code]!.many, count: rows.get(code)!.size }));
}

/** Search: old address, new address and note, ignoring capitals. */
export function matchesSearch(redirect: { from: string; to: string; note?: string }, query: string): boolean {
  const needle = query.trim().toLowerCase();

  if (!needle) return true;
  return redirect.from.toLowerCase().includes(needle) || redirect.to.toLowerCase().includes(needle) || (redirect.note ?? "").toLowerCase().includes(needle);
}

/** Rows to render for a virtual list: the visible window plus a margin, by fixed row height. */
export function visibleWindow(scrollTop: number, viewport: number, rowHeight: number, total: number, overscan = 8): { start: number; end: number } {
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(total, Math.ceil((scrollTop + viewport) / rowHeight) + overscan);

  return { start, end };
}

/** "412 redirects", "1 redirect". */
export function redirectsCount(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "redirect" : "redirects"}`;
}

/** Usage as a share of a limit, for the meters (0–1, capped). */
export function share(used: number, limit: number | null): number | null {
  return limit ? Math.min(1, used / limit) : null;
}

/** The query value the WordPress import's report links with: /sites/:id/redirects?add=wordpress-import. */
export const WORDPRESS_IMPORT = "wordpress-import";

/** The import a link asks to open (`?add=`), by its folder or its exact path; null when it isn't there. */
export function importToOpen<T extends { path: string }>(imports: T[], wanted: string | null): T | null {
  if (!wanted) return null;
  return imports.find((source) => source.path === wanted || source.path.startsWith(`${wanted}/`)) ?? null;
}

/** Imports with redirects still to bring in, for the offer above a list that isn't empty. */
export function waitingImports<T extends { count: number; waiting?: number }>(imports: T[]): T[] {
  return imports.filter((source) => (source.waiting ?? source.count) > 0);
}
