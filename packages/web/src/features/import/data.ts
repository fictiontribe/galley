/**
 * The import screen's talk with the server: the export upload (in chunks,
 * so a large file never has to fit in one request) and the cache keys.
 */
import type { ImportUpload } from "@galley/core/types";
import { api } from "@/lib/api";
import { CHUNK_BYTES, toBase64 } from "./logic";

export const importKeys = {
  report: (siteId: string) => ["site", siteId, "import", "report"] as const,
  rebuildPlan: (siteId: string) => ["site", siteId, "import", "rebuild-plan"] as const,
};

/** Sends the file a chunk at a time; `onProgress` gets 0–1. */
export async function uploadExport(siteId: string, file: File, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<ImportUpload> {
  let uploadId: string | undefined;
  for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
    if (signal?.aborted) throw new DOMException("The upload was stopped.", "AbortError");
    const bytes = new Uint8Array(await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
    const answer = await api("POST /api/sites/:siteId/import/upload", {
      params: { siteId },
      body: { ...(uploadId ? { uploadId } : {}), name: file.name, total: file.size, offset, chunk: toBase64(bytes) },
      ...(signal ? { signal } : {}),
    });
    uploadId = answer.uploadId;
    onProgress(answer.received / file.size);
    if (answer.upload) return answer.upload;
  }
  throw new Error("The upload ended without the server confirming the file.");
}
