/**
 * The site's media storage: where new files go, the connectors, and the
 * calls the wizard and the library make. Status sits under the media key,
 * so anything that refreshes the library refreshes it too.
 */
import type { MediaStorageStatus, MediaStoreInfo } from "@galley/core/media-storage/contract";
import type { MediaItem } from "@galley/core/types";
import { api } from "@/lib/api";
import { invalidate, useQuery } from "@/lib/query";
import { keys } from "@/lib/sync";

export const storageKeys = {
  status: (siteId: string) => [...keys.media(siteId), "storage"] as const,
  connectors: () => ["media-storage", "connectors"] as const,
  usage: (siteId: string, url: string) => [...keys.media(siteId), "usage", url] as const,
};

export function useMediaStorage(siteId: string) {
  return useQuery<MediaStorageStatus>(storageKeys.status(siteId), () => api("GET /api/sites/:siteId/media/storage", { params: { siteId } }));
}

export function useConnectors() {
  return useQuery<{ connectors: MediaStoreInfo[] }>(storageKeys.connectors(), () => api("GET /api/media-storage/connectors"));
}

export function useUsage(siteId: string, item: MediaItem | null) {
  const url = item?.url ?? "";

  return useQuery(storageKeys.usage(siteId, url), () => api("GET /api/sites/:siteId/media/usage", { params: { siteId }, query: { url } }), { enabled: Boolean(item?.location && item.location !== "repository") });
}

/** "the bucket" / "Cloudflare Images": how a place is said in a sentence. */
export function placeWords(item: Pick<MediaItem, "location">, status?: MediaStorageStatus | null): string {
  if (item.location === "images") return "Cloudflare Images";
  if (item.location === "bucket") return status?.bucket.store ? `the bucket (${status.bucket.store.name})` : "the bucket";
  return "the repository";
}

export function isStored(item: Pick<MediaItem, "location"> | null | undefined): boolean {
  return Boolean(item?.location && item.location !== "repository");
}

export async function deleteStored(siteId: string, paths: string[]) {
  const result = await api("POST /api/sites/:siteId/media/storage/delete", { params: { siteId }, body: { paths } });

  invalidate(keys.media(siteId));
  return result;
}
