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

function picture(folder: string, name: string): Picture {
  const file = join(PUBLIC, folder, `${name}.webp`);
  if (!existsSync(file)) throw new Error(`Missing public/${folder}/${name}.webp (scripts/capture-screens.mjs)`);
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
  return fallback && !existsSync(join(PUBLIC, "screens", `${name}.webp`)) ? screen(fallback) : screen(name);
}

export interface Recording extends Picture {
  video: string;
}

export function recording(name: string): Recording {
  if (!existsSync(join(PUBLIC, "screens", `${name}.webm`))) throw new Error(`Missing recording public/screens/${name}.webm`);
  return { ...screen(`${name}-poster`), video: `/screens/${name}.webm` };
}

/**
 * A portrait in public/team/<name>.webp (shown at most at its natural size)
 * with its half-size copy <name>@1x.webp. Unlike the captures, the big file
 * is not a 2× capture: width and height are its own, for the aspect ratio.
 */
export function portrait(name: string): Picture {
  const file = join(PUBLIC, "team", `${name}.webp`);
  if (!existsSync(file)) throw new Error(`Missing public/team/${name}.webp`);
  const { width, height } = webpSize(file);
  const oneFile = join(PUBLIC, "team", `${name}@1x.webp`);
  const one = existsSync(oneFile) ? webpSize(oneFile).width : 0;
  const srcset = [one ? `/team/${name}@1x.webp ${one}w` : "", `/team/${name}.webp ${width}w`].filter(Boolean).join(", ");
  return { src: `/team/${name}.webp`, srcset, natural: width, width, height };
}
