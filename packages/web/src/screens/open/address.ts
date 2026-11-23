import type { EntrySummary } from "@galley/core/types";

/** Where a resolved link goes: the entry's form, or the page by address when no entry lives there. */
export function editorAddress(siteId: string, entry: Pick<EntrySummary, "path"> | null, url: string | null): string {
  if (entry) return `/sites/${encodeURIComponent(siteId)}/edit?path=${encodeURIComponent(entry.path)}`;
  return `/sites/${encodeURIComponent(siteId)}/edit?url=${encodeURIComponent(url || "/")}`;
}

