/**
 * The pure parts of the data-source picker (DataSourceField.tsx): where an
 * item's picture is read from, how a gone value is described, and keyboard
 * movement through the results. Kept apart so they can be tested without a
 * browser.
 */
import type { MediaConfig } from "@galley/core/types";
import { thumbnailSource } from "@/features/media/mediaPaths";

/** How many results a search asks for. */
export const PICK_LIMIT = 12;
/** Quiet time after typing before a search is sent. */
export const PICK_DELAY_MS = 250;

/**
 * Where to load an item's picture from. Plugins give an https address or a
 * path from the site's root ("/images/coat.webp", the demo catalogue's
 * pictures): a root path is read from the running preview, which serves the
 * site exactly as visitors get it, or else from the site's media folders.
 */
export function pickImageSrc(image: string | undefined, previewUrl: string | null | undefined, media: MediaConfig | null | undefined, raw: (path: string) => string): string | null {
  if (!image) return null;
  if (/^https:\/\//i.test(image)) return image;
  if (!image.startsWith("/") || image.startsWith("//")) return null;
  if (previewUrl) return `${previewUrl.replace(/\/+$/, "")}${image}`;
  return thumbnailSource(image, media, raw);
}

/**
 * The line shown when a saved value is gone from its source. Sources are
 * labelled as what they hold and where ("Products in the shop"), so the
 * place is the part after " in ": "No longer in the shop". A label without
 * a place falls back to naming the source.
 */
export function goneLine(sourceLabel: string): string {
  const place = /\sin\s(.+)$/i.exec(sourceLabel.trim())?.[1];
  return place ? `No longer in ${place}` : `No longer offered by ${sourceLabel.trim()}`;
}

/** The highlighted result after an arrow key, or null for any other key (Home and End stay with the text box's caret). */
export function moveActive(key: string, active: number, total: number): number | null {
  if (total === 0) return null;
  if (key === "ArrowDown") return active < 0 ? 0 : (active + 1) % total;
  if (key === "ArrowUp") return active <= 0 ? total - 1 : active - 1;
  return null;
}
