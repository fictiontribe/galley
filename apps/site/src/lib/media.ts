/**
 * Pictures on the site, resolved at build time so every <img> carries its
 * real size (no layout shift), is never shown larger than its natural size,
 * and a missing file fails the build loudly.
 *
 * - screens: real captures of the app, public/screens (scripts/capture-screens.mjs)
 * - sites:   real captures of the example sites, public/sites (same script)
 *
 * Captures are made at 2× the size they are shown, with a 1× copy beside them
 * (<name>@1x.webp): `width`/`height` are the shown (CSS) size, the srcset
 * offers both.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PUBLIC = join(process.cwd(), "public");

export function webpSize(file: string): { width: number; height: number } {
  const b = readFileSync(file);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") throw new Error(`Not a WebP file: ${file}`);
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (chunk === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  throw new Error(`Unknown WebP chunk in ${file}`);
}

export interface Picture {
  src: string;
  srcset: string;
  /** Natural width of the largest file. */
  natural: number;
  /** Shown (CSS) size: half the 2× file. */
  width: number;
  height: number;
}

/**
 * A picture that isn't there. The build fails loudly, so a page never goes
 * live with a hole in it; the preview (`astro dev`) shows a marked stand-in
 * instead, because a section just added in the editor names no picture yet
 * and must not stop the whole page from drawing.
 */
function missingPicture(file: string, why: string, shape: { width: number; height: number } = { width: 800, height: 500 }): Picture {
  if (!import.meta.env.DEV) throw new Error(why);
  console.warn(`[site] ${why} — showing a stand-in in the preview.`);
  const { width, height } = shape;
  const label = file.endsWith("/.webp") || file.endsWith("/-poster.webp") ? "No picture yet. Choose one in the form." : `Missing ${file}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#ecebe6" stroke="#b9b6ab" stroke-dasharray="6 6"/><text x="50%" y="50%" text-anchor="middle" font-family="system-ui,sans-serif" font-size="16" fill="#5f5c55">${label.replace(/[<&]/g, "")}</text></svg>`;
  const src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  return { src, srcset: "", natural: width, width, height };
}

function picture(folder: string, name: string): Picture {
  const file = join(PUBLIC, folder, `${name}.webp`);
  if (!name || !existsSync(file)) return missingPicture(`public/${folder}/${name}.webp`, `Missing public/${folder}/${name}.webp (scripts/capture-screens.mjs)`);
  const { width, height } = webpSize(file);
  const oneFile = join(PUBLIC, folder, `${name}@1x.webp`);
  const one = existsSync(oneFile) ? webpSize(oneFile).width : 0;
  const srcset = [one ? `/${folder}/${name}@1x.webp ${one}w` : "", `/${folder}/${name}.webp ${width}w`].filter(Boolean).join(", ");
  return { src: `/${folder}/${name}.webp`, srcset, natural: width, width: Math.round(width / 2), height: Math.round(height / 2) };
}

export const screen = (name: string) => picture("screens", name);
export const siteShot = (name: string) => picture("sites", name);

/** A named slot: the capture when it exists, else the stand-in named in the content until it is captured. */
export function screenOr(name: string, fallback?: string): Picture {
  if (!fallback || existsSync(join(PUBLIC, "screens", `${name}.webp`))) return screen(name);
  const stand = findPicture(fallback);
  if (!stand) return screen(fallback);
  noteMissing(`screens/${name}`, `showing ${fallback} until it is captured`);
  return stand;
}

/**
 * A picture named by its place under public/, without extension: "docs/brand",
 * "howto/bulk-redirects-1", "screens/form" — or a bare name, which is a screen.
 */
function placeOf(ref: string): { folder: string; name: string } {
  const at = ref.lastIndexOf("/");
  return at === -1 ? { folder: "screens", name: ref } : { folder: ref.slice(0, at).replace(/^\/+/, ""), name: ref.slice(at + 1) };
}

export const pictureExists = (ref: string) => {
  const { folder, name } = placeOf(ref);
  return existsSync(join(PUBLIC, folder, `${name}.webp`));
};

/** The picture, or null when its file isn't there (never throws). */
export function findPicture(ref: string): Picture | null {
  const { folder, name } = placeOf(ref);
  return pictureExists(ref) ? picture(folder, name) : null;
}

const noted = new Set<string>();
/** Says once in the build log that a picture is missing, and what is shown instead. */
export function noteMissing(ref: string, instead: string): void {
  const { folder, name } = placeOf(ref);
  const key = `${folder}/${name}`;
  if (noted.has(key)) return;
  noted.add(key);
  console.warn(`[site] Missing picture public/${key}.webp — ${instead}.`);
}

/**
 * A capture for a slot that may not be captured yet: `src`, else `fallback`
 * (marked as such, so the caller can use the stand-in's own description), else
 * null. Missing files are listed in the build log; nothing throws.
 */
export function capture(src: string, fallback?: string): { pic: Picture; stand: boolean } | null {
  const pic = findPicture(src);
  if (pic) return { pic, stand: false };
  const stand = fallback ? findPicture(fallback) : null;
  noteMissing(src, stand ? `showing ${fallback} until it is captured` : fallback ? `and its stand-in ${fallback} is missing too; left out` : "left out until it is captured");
  return stand ? { pic: stand, stand: true } : null;
}

export interface Recording extends Picture {
  video: string;
}

export function recording(name: string): Recording {
  if (!name || !existsSync(join(PUBLIC, "screens", `${name}.webm`))) {
    // The stand-in is a still: nothing to play until the recording is there.
    return { ...missingPicture(`public/screens/${name}-poster.webp`, `Missing recording public/screens/${name}.webm`), video: "" };
  }
  return { ...screen(`${name}-poster`), video: `/screens/${name}.webm` };
}

/**
 * A portrait in public/team/<name>.webp (shown at most at its natural size)
 * with its half-size copy <name>@1x.webp. Unlike the captures, the big file
 * is not a 2× capture: width and height are its own, for the aspect ratio.
 */
export function portrait(name: string): Picture {
  const file = join(PUBLIC, "team", `${name}.webp`);
  if (!name || !existsSync(file)) return missingPicture(`public/team/${name}.webp`, `Missing public/team/${name}.webp`, { width: 480, height: 600 });
  const { width, height } = webpSize(file);
  const oneFile = join(PUBLIC, "team", `${name}@1x.webp`);
  const one = existsSync(oneFile) ? webpSize(oneFile).width : 0;
  const srcset = [one ? `/team/${name}@1x.webp ${one}w` : "", `/team/${name}.webp ${width}w`].filter(Boolean).join(", ");
  return { src: `/team/${name}.webp`, srcset, natural: width, width, height };
}
