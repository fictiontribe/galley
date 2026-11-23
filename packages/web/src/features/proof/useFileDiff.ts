import type { FileChange, FileDiff } from "@galley/core/types";
import { api } from "@/lib/api";
import { useQuery, type QueryResult } from "@/lib/query";

/**
 * GET …/diff for one pending file. Keyed by the change's own tally, so a new
 * edit to the same file fetches afresh; it also refreshes whenever entries or
 * media are invalidated by `changes.updated`.
 */
export function useFileDiff(siteId: string, change: FileChange, enabled = true): QueryResult<FileDiff> {
  return useQuery(
    ["site", siteId, "diff", change.path, `${change.status}:${change.additions}:${change.deletions}:${change.summary}`],
    () => api("GET /api/sites/:siteId/diff", { params: { siteId }, query: { path: change.path } }),
    { enabled, deps: [["site", siteId, "entry"], ["site", siteId, "media"]] },
  );
}
