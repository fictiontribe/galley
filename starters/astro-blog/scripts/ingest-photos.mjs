#!/usr/bin/env node
// Puts photographs in place: `npm run photos -- ~/path/to/photographs`.
//
// Each file whose name (without extension) matches a slot below is cropped to
// the slot's ratio around its focus, written as WebP at the slot's width and
// at half that width (for small screens), and recorded in
// src/lib/images.json — the real size of every picture, so pages reserve its
// box before it loads and offer the smaller file to phones. Any common format
// and size goes in. Running it again with the same files changes nothing.
//
//   --dry-run   say what would be written
//
// Pictures added later by hand or through Galley need none of this: a path
// that isn't in images.json is shown as it is, at the box its component sets.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PUBLIC = join(ROOT, "public");
const MANIFEST = join(ROOT, "src/lib/images.json");

/** name → where it goes, its crop (w/h), its width, and the side to keep when cropping. */
const SLOTS = {
  "house-front": { path: "/images/blog/house-front.webp", ratio: 3 / 2, width: 1600, share: true },
  "heat-pump": { path: "/images/blog/heat-pump.webp", ratio: 3 / 2, width: 1600 },
  loft: { path: "/images/blog/loft.webp", ratio: 3 / 2, width: 1600 },
  thermal: { path: "/images/blog/thermal.webp", ratio: 3 / 2, width: 1600 },
  hallway: { path: "/images/blog/hallway.webp", ratio: 3 / 2, width: 1600 },
  "solar-roof": { path: "/images/blog/solar-roof.webp", ratio: 3 / 2, width: 1600 },
  bench: { path: "/images/blog/bench.webp", ratio: 3 / 2, width: 1600 },
  radiator: { path: "/images/blog/radiator.webp", ratio: 3 / 2, width: 1600 },
  window: { path: "/images/blog/window.webp", ratio: 3 / 2, width: 1600 },
  "wood-fibre": { path: "/images/blog/wood-fibre.webp", ratio: 3 / 2, width: 1600 },
  "meter-cupboard": { path: "/images/blog/meter-cupboard.webp", ratio: 3 / 2, width: 1600 },
  street: { path: "/images/blog/street.webp", ratio: 21 / 9, width: 2000, position: "centre" },
  author: { path: "/images/people/ines-calloway.webp", ratio: 4 / 5, width: 800, position: "north" },
  guest: { path: "/images/people/dougal-reay.webp", ratio: 4 / 5, width: 800, position: "north" },
};

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const from = args.find((arg) => !arg.startsWith("--"));
if (!from) {
  console.error("Usage: npm run photos -- <folder of photographs> [--dry-run]");
  process.exit(1);
}

const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
const inputs = readdirSync(resolve(from)).filter((name) => /\.(jpe?g|png|webp|avif|tiff?)$/i.test(name));
const filled = [];

for (const name of inputs) {
  const slot = SLOTS[basename(name, extname(name))];
  if (!slot) continue;
  const source = sharp(join(resolve(from), name)).rotate();
  const height = Math.round(slot.width / slot.ratio);
  const sizes = [slot.width, Math.round(slot.width / 2)];
  const out = join(PUBLIC, slot.path);

  for (const width of sizes) {
    const file = width === slot.width ? out : out.replace(/\.webp$/, `-${width}.webp`);
    if (dry) {
      console.log(`would write ${file.slice(ROOT.length)}`);
      continue;
    }
    mkdirSync(join(file, ".."), { recursive: true });
    await source
      .clone()
      .resize(width, Math.round(width / slot.ratio), { fit: "cover", position: slot.position ?? "attention" })
      .webp({ quality: width > 1000 ? 74 : 72, effort: 6 })
      .toFile(file);
  }
  if (slot.share && !dry) {
    await source.clone().resize(1200, 630, { fit: "cover", position: "attention" }).jpeg({ quality: 80, mozjpeg: true }).toFile(join(PUBLIC, "images/share.jpg"));
  }
  manifest[slot.path] = { width: slot.width, height, widths: sizes.slice().reverse() };
  filled.push(slot.path);
}

if (!dry) writeFileSync(MANIFEST, `${JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 2)}\n`);
console.log(`${filled.length} photographs ${dry ? "would be " : ""}placed.`);
const missing = Object.keys(SLOTS).filter((key) => !filled.includes(SLOTS[key].path));
if (missing.length) console.log(`Not in that folder: ${missing.join(", ")}`);
