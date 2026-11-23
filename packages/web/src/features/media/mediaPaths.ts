/**
 * Site URLs ⇄ repo paths for media, using the site's media roots
 * ("/images/team/ana.webp" ⇄ "public/images/team/ana.webp").
 */
import type { MediaConfig, MediaItem } from "@galley/core/types";

/** The repo path behind a site URL, or null for addresses outside the media folders (or other sites). */
export function mediaPathForUrl(url: string, media: MediaConfig | null | undefined): string | null {
  if (!media || !url || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//")) return null;
  const clean = decodeURI(url.split(/[?#]/)[0] ?? "");
  const roots = [...media.roots].sort((a, b) => b.publicPath.length - a.publicPath.length);
  for (const root of roots) {
    const prefix = root.publicPath.replace(/\/+$/, "");
    if (prefix === "" ? clean.startsWith("/") : clean === prefix || clean.startsWith(`${prefix}/`)) {
      const rest = clean.slice(prefix.length).replace(/^\/+/, "");
      if (!rest) return null;
      return `${root.dir.replace(/\/+$/, "")}/${rest}`;
    }
  }
  return null;
}

/** Where a thumbnail comes from: the working copy through the API, or the address itself when it's on the web. */
export function thumbnailSource(url: string, media: MediaConfig | null | undefined, raw: (path: string) => string): string | null {
  if (/^https?:\/\//i.test(url)) return url;
  const path = mediaPathForUrl(url, media);
  return path ? raw(path) : null;
}

export type MediaKind = "all" | "image" | "video" | "document";

export function kindOf(item: Pick<MediaItem, "type">): Exclude<MediaKind, "all"> {
  if (item.type.startsWith("image/")) return "image";
  if (item.type.startsWith("video/")) return "video";
  return "document";
}

/** Library search: name or path contains every word typed. */
export function filterMedia(items: readonly MediaItem[], query: string, kind: MediaKind): MediaItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    if (kind !== "all" && kindOf(item) !== kind) return false;
    const haystack = `${item.name} ${item.path}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** Newest first, then by name — changed images float up where people look for them. */
export function sortMedia(items: readonly MediaItem[]): MediaItem[] {
  const rank = (item: MediaItem) => (item.status === "added" ? 0 : item.status === "modified" ? 1 : 2);
  return [...items].sort((a, b) => rank(a) - rank(b) || b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name));
}

/** The folder part of a repo path, as people read it: "public/images/team". */
export function folderOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at === -1 ? "" : path.slice(0, at);
}
