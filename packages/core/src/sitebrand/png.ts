/**
 * PNG in and out with node:zlib only — enough to read the pixels of a logo or
 * screenshot, shrink them, and write a fresh PNG.
 *
 * Why not send the upload as it came: re-encoding from decoded pixels drops
 * every ancillary chunk (text, metadata, anything smuggled after IEND), so
 * what reaches the model is the picture and nothing else. The web app turns
 * every other raster format into a PNG in the person's browser before
 * upload; the engine decodes and re-encodes that PNG itself.
 *
 * Supported: bit depths 1–16, colour types 0/2/3/4/6, no interlacing (which
 * browsers never write). Anything else is refused in plain words.
 */
import { deflateSync, inflateSync } from "node:zlib";
import { GalleyError } from "../errors";

export interface RasterImage {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel. */
  data: Uint8Array;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Decoded pictures above this many pixels are refused: a 6000×6000 screenshot is 144 MB of RGBA. */
export const MAX_PIXELS = 40_000_000;

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && Buffer.from(bytes.subarray(0, 8)).equals(SIGNATURE);
}

const refuse = (detail: string) => new GalleyError("invalid", "That picture couldn't be read as a PNG image.", detail);

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);

  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(bytes: Uint8Array): RasterImage {
  if (!isPng(bytes)) throw refuse("missing PNG signature");
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;
  const idat: Buffer[] = [];

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const start = offset + 8;

    if (start + length > buffer.length) throw refuse("truncated chunk");
    const chunk = buffer.subarray(start, start + length);

    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      depth = chunk[8]!;
      colorType = chunk[9]!;
      if (chunk[12] !== 0) throw refuse("interlaced PNG");
    } else if (type === "PLTE") palette = chunk;
    else if (type === "tRNS") transparency = chunk;
    else if (type === "IDAT") idat.push(chunk);
    else if (type === "IEND") break;
    offset = start + length + 4;
  }
  if (!width || !height) throw refuse("no header");
  if (width * height > MAX_PIXELS) throw new GalleyError("invalid", "That picture is too large to read. Use one under 40 megapixels.", `${width}×${height}`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];

  if (!channels || ![1, 2, 4, 8, 16].includes(depth)) throw refuse(`colour type ${colorType}, depth ${depth}`);
  let raw: Buffer;

  try {
    raw = inflateSync(Buffer.concat(idat), { maxOutputLength: (width * channels * 2 + 1) * height + 1024 });
  } catch (error) {
    throw refuse(error instanceof Error ? error.message : String(error));
  }
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, Math.ceil(bitsPerPixel / 8));

  if (raw.length < (stride + 1) * height) throw refuse("short image data");
  const lines = Buffer.alloc(stride * height);
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = lines.subarray(y * stride, (y + 1) * stride);

    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? out[x - bpp]! : 0;
      const up = previous[x]!;
      const upLeft = x >= bpp ? previous[x - bpp]! : 0;
      const value = line[x]!;

      out[x] = (filter === 0 ? value : filter === 1 ? value + left : filter === 2 ? value + up : filter === 3 ? value + ((left + up) >> 1) : value + paeth(left, up, upLeft)) & 255;
    }
    previous = out;
  }
  const data = new Uint8Array(width * height * 4);
  const sample = (row: Buffer, index: number): number => {
    if (depth === 8) return row[index]!;
    if (depth === 16) return row[index * 2]!;
    const perByte = 8 / depth;
    const byte = row[Math.floor(index / perByte)]!;
    const shift = 8 - depth * ((index % perByte) + 1);
    const value = (byte >> shift) & ((1 << depth) - 1);

    return colorType === 3 ? value : Math.round((value * 255) / ((1 << depth) - 1));
  };

  for (let y = 0; y < height; y += 1) {
    const row = lines.subarray(y * stride, (y + 1) * stride);

    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;

      if (colorType === 3) {
        const index = sample(row, x);

        if (!palette || index * 3 + 2 >= palette.length) throw refuse("palette index out of range");
        data[o] = palette[index * 3]!;
        data[o + 1] = palette[index * 3 + 1]!;
        data[o + 2] = palette[index * 3 + 2]!;
        data[o + 3] = transparency && index < transparency.length ? transparency[index]! : 255;
      } else if (colorType === 0 || colorType === 4) {
        const grey = sample(row, x * channels);

        data[o] = data[o + 1] = data[o + 2] = grey;
        data[o + 3] = colorType === 4 ? sample(row, x * channels + 1) : 255;
      } else {
        data[o] = sample(row, x * channels);
        data[o + 1] = sample(row, x * channels + 1);
        data[o + 2] = sample(row, x * channels + 2);
        data[o + 3] = colorType === 6 ? sample(row, x * channels + 3) : 255;
      }
    }
  }
  return { width, height, data };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let n = 0; n < 256; n += 1) {
    let c = n;

    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;

  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);

  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);

  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** A plain RGBA PNG: IHDR, one IDAT, IEND — nothing else. */
export function encodePng(image: RasterImage): Uint8Array {
  const header = Buffer.alloc(13);

  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);

  for (let y = 0; y < image.height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(image.data.buffer, image.data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return new Uint8Array(Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]));
}

/** Box-filter shrink so the longer edge is at most `maxEdge` (never enlarges). */
export function downscale(image: RasterImage, maxEdge: number): RasterImage {
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));

  if (scale >= 1) return image;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor((y * image.height) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * image.height) / height));

    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor((x * image.width) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * image.width) / width));
      const sum = [0, 0, 0, 0];
      let n = 0;

      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const o = (sy * image.width + sx) * 4;

          for (let c = 0; c < 4; c += 1) sum[c]! += image.data[o + c]!;
          n += 1;
        }
      }
      const o = (y * width + x) * 4;

      for (let c = 0; c < 4; c += 1) data[o + c] = Math.round(sum[c]! / n);
    }
  }
  return { width, height, data };
}

export interface PaletteEntry {
  /** "#RRGGBB". */
  color: string;
  /** Share of the opaque pixels, 0–1. */
  share: number;
}

/**
 * The colours a picture is made of, by pixel share. Pixels are bucketed at 5
 * bits per channel, then neighbouring buckets within ΔE ~3 are merged into
 * the heavier one, so antialiasing doesn't produce a hundred near-copies.
 */
export function paletteOf(image: RasterImage, options: { max?: number; minShare?: number } = {}): PaletteEntry[] {
  const small = downscale(image, 256);
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  let opaque = 0;

  for (let i = 0; i < small.data.length; i += 4) {
    if (small.data[i + 3]! < 128) continue;
    const r = small.data[i]!;
    const g = small.data[i + 1]!;
    const b = small.data[i + 2]!;
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };

    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.n += 1;
    buckets.set(key, bucket);
    opaque += 1;
  }
  if (opaque === 0) return [];
  const sorted = [...buckets.values()].sort((a, b) => b.n - a.n);
  // Each merged entry keeps the colour of its heaviest bucket; lighter neighbours only add weight.
  const merged: Array<{ r: number; g: number; b: number; weight: number }> = [];

  for (const bucket of sorted) {
    const mean = { r: bucket.r / bucket.n, g: bucket.g / bucket.n, b: bucket.b / bucket.n };
    const near = merged.find((m) => Math.hypot(m.r - mean.r, m.g - mean.g, m.b - mean.b) < 12);

    if (near) {
      near.weight += bucket.n;
      continue;
    }
    merged.push({ ...mean, weight: bucket.n });
  }
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");

  return merged
    .map((m) => ({ color: `#${hex(m.r)}${hex(m.g)}${hex(m.b)}`.toUpperCase(), share: m.weight / opaque }))
    .filter((entry) => entry.share >= (options.minShare ?? 0.01))
    .sort((a, b) => b.share - a.share)
    .slice(0, options.max ?? 10);
}
