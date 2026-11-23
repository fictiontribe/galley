/**
 * What the plugins' publish checks say about the pending changes — their
 * warnings (shown, never a stop) and whether one would stop the publish —
 * read ahead of publishing so Proof and the Publish dialog can say it first.
 * Keyed on the changes' shape, so an edit asks again and nothing else does.
 */
import type { ChangeSet, PublishCheck } from "@galley/core/types";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/query";

const NONE: PublishCheck = { warnings: [], refusal: null };

/** A short fingerprint of what is waiting: a path, its line counts. */
export function changesSignature(files: ChangeSet["files"]): string {
  return files.map((file) => `${file.path}:${file.additions}:${file.deletions}`).join("|");
}

/** The check for these files (every pending one when `paths` is absent). Answers "nothing to say" until the server has. */
export function usePublishCheck(siteId: string, files: ChangeSet["files"], paths?: string[]): PublishCheck {
  const signature = changesSignature(files);
  const scope = paths ? paths.join("\n") : "*";
  const check = useQuery(["site", siteId, "publish-check", signature, scope], () => api("POST /api/sites/:siteId/publish/check", { params: { siteId }, body: paths ? { paths } : {} }), {
    enabled: files.length > 0 && (!paths || paths.length > 0),
  });
  return check.data ?? NONE;
}
