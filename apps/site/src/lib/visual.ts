/**
 * A content `visual` resolved for the tour and the how-to pages: the capture,
 * or its stand-in (with the stand-in's own description) until it is captured,
 * or null — never an exception, so a capture still to come can't break the
 * build. Missing files are listed in the build log (lib/media.ts).
 */
import { capture, recording, type Picture, type Recording } from "./media";

export interface Visual {
  kind?: string;
  src: string;
  alt: string;
  fallback?: string;
  fallbackAlt?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

export interface Resolved {
  pic: Picture;
  alt: string;
  rec?: Recording;
  style?: string;
  /** The part to show, for an inset (only when the capture itself is shown). */
  crop?: { w?: number; h?: number };
}

export function resolveVisual(v: Visual | undefined): Resolved | null {
  if (!v) return null;
  const style = [v.x !== undefined ? `--dx:${v.x}px` : "", v.y !== undefined ? `--dy:${v.y}px` : ""].filter(Boolean).join(";") || undefined;
  if (v.kind === "recording") {
    const rec = recording(v.src);
    return { pic: rec, alt: v.alt, rec, style };
  }
  const folder = v.kind === "site" ? "sites/" : "";
  const found = capture(`${folder}${v.src}`, v.fallback);
  if (!found) return null;
  // Offsets and crops are set for the capture itself; a stand-in is shown as it is.
  if (found.stand) return { pic: found.pic, alt: v.fallbackAlt ?? v.alt };
  return { pic: found.pic, alt: v.alt, style, crop: v.w || v.h ? { w: v.w, h: v.h } : undefined };
}

/** What the lightbox needs to show a picture large. */
export function zoomOf(r: Resolved) {
  return { src: r.pic.src, w: r.pic.width, h: r.pic.height, alt: r.alt };
}
