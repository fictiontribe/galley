/**
 * What the site service asks of media storage (SiteDeps.media), and the one
 * question it answers on its own from the site's settings: whether an address
 * is one of the site's stores' (for validation, which can't wait on a call).
 * Type-light on purpose: site/service.ts imports it.
 */
import type { MediaConfig, MediaItem, SiteService } from "../types";
import { keyUnder } from "./bucket-store";
import { imageIdOf } from "./cloudflare-images";
import { normalizePrefix } from "./info";

export interface SiteMediaRouter {
  save(site: SiteService, upload: { filename: string; directory?: string; data: Uint8Array }, toRepository: () => Promise<MediaItem>): Promise<MediaItem>;
  list(site: SiteService, repository: MediaItem[]): Promise<MediaItem[]>;
  pending(site: SiteService): Promise<MediaItem[]>;
}

/** Whether a reference is a full address of a file in the site's bucket (inside its folder) or one of its Cloudflare Images pictures (any variant). */
export function isStoreAddress(media: MediaConfig, url: string): boolean {
  const storage = media.storage;

  if (media.images && imageIdOf(media.images.accountHash, url) !== null) return true;
  if (!storage?.publicUrl) return false;
  return keyUnder(storage.publicUrl, normalizePrefix(storage.prefix), url) !== null;
}
