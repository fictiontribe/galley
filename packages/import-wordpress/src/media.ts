/**
 * Media addresses: from whatever the content points at to the original
 * file worth downloading.
 *
 * WordPress serves resized copies ("photo-300x200.jpg"), srcset candidates
 * and CDN-proxied addresses (i0.wp.com/…); the importer wants the original
 * upload. Known sizes resolve through the media library; anything else is
 * tried with the size suffix removed first and as written second, because a
 * file can genuinely be called "banner-1200x600.jpg".
 */
import type { WordPressMedia } from "./types";

/** Extensions the site's media library accepts (see saveMedia in the engine). */
export const SAVABLE = new Set(["png", "jpg", "jpeg", "webp", "avif", "gif", "svg", "pdf", "mp4"]);

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
};

export function sizeIndex(media: WordPressMedia[]): Map<string, WordPressMedia> {
  const index = new Map<string, WordPressMedia>();

  for (const item of media) {
    index.set(stripQuery(item.url), item);
    for (const size of item.sizes) index.set(stripQuery(size), item);
  }
  return index;
}

function stripQuery(url: string): string {
  return url.replace(/[?#].*$/, "");
}

/** Jetpack's image CDN: https://i0.wp.com/example.com/wp-content/… → https://example.com/wp-content/… */
function unproxy(url: string): string {
  const match = /^https?:\/\/i\d\.wp\.com\/(.+)$/.exec(url);

  return match ? `https://${stripQuery(match[1]!)}` : url;
}

export function originalCandidates(url: string, index: Map<string, WordPressMedia>): string[] {
  const direct = unproxy(stripQuery(url.trim()));
  const known = index.get(direct);

  if (known) return [stripQuery(known.url)];
  const unsized = direct.replace(/-\d+x\d+(?=\.[a-z0-9]+$)/i, "");

  return [...new Set([unsized, direct])];
}

export function mediaFor(url: string, index: Map<string, WordPressMedia>): WordPressMedia | undefined {
  return index.get(unproxy(stripQuery(url.trim())));
}

export function extensionOf(url: string): string {
  return /\.([a-z0-9]+)$/i.exec(stripQuery(url))?.[1]?.toLowerCase() ?? "";
}

/** The file name to save under, with an extension that matches what the server sent. */
export function fileNameFor(url: string, contentType: string): string {
  let leaf = stripQuery(url).split("/").pop() || "file";

  try {
    leaf = decodeURIComponent(leaf);
  } catch {
    // keep it as written
  }
  const ext = extensionOf(leaf);
  const typed = EXT_BY_TYPE[contentType.split(";")[0]!.trim().toLowerCase()];

  if (!ext && typed) return `${leaf}.${typed}`;
  return leaf;
}

/** "2024/05" from …/wp-content/uploads/2024/05/…, when WordPress filed it by month. */
export function datedFolder(url: string): string | null {
  const match = /(?:\/wp-content\/uploads\/(?:sites\/\d+\/)?|\/files\/)(\d{4})\/(\d{2})\//.exec(url);

  return match ? `${match[1]}/${match[2]}` : null;
}

export function usesDatedFolders(paths: string[], mediaDir: string): boolean {
  const prefix = mediaDir.replace(/\/+$/, "");

  return paths.some((path) => new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\d{4}/\\d{2}/`).test(path));
}
