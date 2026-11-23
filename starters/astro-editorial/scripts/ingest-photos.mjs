#!/usr/bin/env node
// Puts generated photographs into their slots.
//
//   node scripts/ingest-photos.mjs <folder> [--dry-run] [--no-thumbnails]
//
// The folder holds images named by shot id from galley/photography/shots.json
// — campaign-aw26.png, aw26-look-01.jpg, … — in any common format (JPEG, PNG,
// WebP, AVIF, TIFF) and any size. For each shot that has a file, this:
//
//   1. turns it upright (EXIF orientation) and converts it to sRGB;
//   2. scales it to cover the slot and crops it there, keeping the shot's
//      `focus` point (x, y from 0 to 1) as near the centre of the crop as the
//      picture allows;
//   3. encodes it at the slot's exact size and file name — WebP, quality
//      stepped down until it fits the budget (≤ 220 kB for 2400-pixel
//      campaign images, ≤ 120 kB for the rest), or JPEG for the share image;
//   4. writes it only if the result differs from what is there.
//
// Then it reports every slot still holding a placeholder (or nothing), and
// refreshes Galley's section and template pictures and the look previews by
// running scripts/make-thumbnails.mjs — when PLAYWRIGHT_MODULES is set; if it
// isn't, it prints the command instead. Running it twice changes nothing.
//
// The share image (`share`) is cropped from `campaign-aw26` when the folder
// has no share file of its own (its `derivedFrom`).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = join(ROOT, "galley/photography/shots.json");
const MANIFEST = join(ROOT, "galley/photography/placeholders.json");
const FORMATS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".tif", ".tiff"]);

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { "dry-run": { type: "boolean" }, "no-thumbnails": { type: "boolean" }, help: { type: "boolean", short: "h" } },
});

if (values.help || positionals.length !== 1) {
  console.log("Usage: node scripts/ingest-photos.mjs <folder> [--dry-run] [--no-thumbnails]");
  console.log("Files in <folder> are matched to shots by name: <shot id>.<jpg|png|webp|avif|tif>.");
  process.exit(values.help ? 0 : 1);
}

const folder = resolve(positionals[0]);
if (!existsSync(folder)) {
  console.error(`ingest-photos: there is no folder at ${folder}.`);
  process.exit(1);
}

const { shots } = JSON.parse(readFileSync(SHOTS, "utf8"));
const byId = new Map(shots.map((shot) => [shot.id, shot]));
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");

// ── Match files to shots ───────────────────────────────────────────────────

const inputs = new Map();
const strays = [];
for (const name of readdirSync(folder).sort()) {
  const ext = extname(name).toLowerCase();
  if (!FORMATS.has(ext)) continue;
  const id = name.slice(0, -ext.length);
  if (!byId.has(id)) strays.push(name);
  else if (inputs.has(id)) console.warn(`  ! ${name}: another file for ${id} was found first (${inputs.get(id)}); using that one.`);
  else inputs.set(id, join(folder, name));
}
for (const shot of shots) {
  if (!inputs.has(shot.id) && shot.derivedFrom && inputs.has(shot.derivedFrom)) inputs.set(shot.id, inputs.get(shot.derivedFrom));
}

// ── Crop and encode ────────────────────────────────────────────────────────

/** The crop window of a `width` × `height` slot in a source of `w` × `h`, centred on focus as far as it can be. */
function cropFor(w, h, shot) {
  const scale = Math.max(shot.width / w, shot.height / h);
  const scaledW = Math.round(w * scale);
  const scaledH = Math.round(h * scale);
  const fx = shot.focus?.x ?? 0.5;
  const fy = shot.focus?.y ?? 0.5;
  const left = Math.min(Math.max(0, Math.round(fx * scaledW - shot.width / 2)), scaledW - shot.width);
  const top = Math.min(Math.max(0, Math.round(fy * scaledH - shot.height / 2)), scaledH - shot.height);
  return { scaledW, scaledH, left, top, upscaled: scale > 1.05 };
}

function budget(shot) {
  if (shot.file.endsWith(".jpg")) return 160 * 1024;
  return shot.width >= 2400 ? 220 * 1024 : 120 * 1024;
}

async function encode(input, shot) {
  const meta = await sharp(input).rotate().metadata();
  const width = meta.autoOrient?.width ?? meta.width;
  const height = meta.autoOrient?.height ?? meta.height;
  const crop = cropFor(width, height, shot);
  const base = await sharp(input)
    .rotate()
    .toColourspace("srgb")
    .resize(crop.scaledW, crop.scaledH, { kernel: "lanczos3" })
    .extract({ left: crop.left, top: crop.top, width: shot.width, height: shot.height })
    .png()
    .toBuffer();

  const jpeg = shot.file.endsWith(".jpg");
  let quality = jpeg ? 84 : 82;
  let out;
  for (;;) {
    out = jpeg ? await sharp(base).jpeg({ quality, mozjpeg: true }).toBuffer() : await sharp(base).webp({ quality, effort: 6, smartSubsample: true }).toBuffer();
    if (out.length <= budget(shot) || quality <= 50) break;
    quality -= 4;
  }
  return { out, quality, crop, source: { width, height } };
}

const written = [];
const unchanged = [];
for (const [id, input] of inputs) {
  const shot = byId.get(id);
  const target = join(ROOT, shot.file);
  const { out, quality, crop, source } = await encode(input, shot);
  const note = `${source.width}×${source.height} → ${shot.width}×${shot.height}, q${quality}, ${(out.length / 1024).toFixed(0)} kB${crop.upscaled ? ", upscaled — generate larger if you can" : ""}${out.length > budget(shot) ? ", over budget" : ""}`;

  if (existsSync(target) && hash(readFileSync(target)) === hash(out)) {
    unchanged.push(id);
    continue;
  }
  if (!values["dry-run"]) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, out);
    delete manifest[shot.file]; // a photograph now, not a placeholder
  }
  written.push(id);
  console.log(`  ${values["dry-run"] ? "would write" : "wrote"} ${shot.file}  (${note})`);
}
if (!values["dry-run"]) writeFileSync(MANIFEST, `${JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 2)}\n`);

// ── Report ─────────────────────────────────────────────────────────────────

const placeholder = (shot) => {
  const path = join(ROOT, shot.file);
  return !existsSync(path) || manifest[shot.file] === hash(readFileSync(path));
};
const missing = shots.filter((shot) => !inputs.has(shot.id) && placeholder(shot));

console.log(`\n${written.length} photograph(s) ${values["dry-run"] ? "to write" : "written"}, ${unchanged.length} already in place.`);
if (strays.length) console.log(`Not in the shot list (ignored): ${strays.join(", ")}`);
if (missing.length) {
  console.log(`\nStill showing a placeholder — ${missing.length} of ${shots.length}:`);
  for (const shot of missing.sort((a, b) => a.priority - b.priority)) console.log(`  [${shot.priority}] ${shot.id.padEnd(22)} ${shot.ratio.padEnd(7)} ${shot.file}`);
} else {
  console.log("Every slot has its photograph.");
}

// ── Pictures for Galley ────────────────────────────────────────────────────

if (values["dry-run"] || values["no-thumbnails"] || written.length === 0) process.exit(0);
if (!process.env.PLAYWRIGHT_MODULES) {
  console.log("\nRefresh Galley's section, template and look pictures with:\n  PLAYWRIGHT_MODULES=/path/to/node_modules/ node scripts/make-thumbnails.mjs");
  process.exit(0);
}
console.log("\nRefreshing Galley's section, template and look pictures…");
const result = spawnSync(process.execPath, [join(ROOT, "scripts/make-thumbnails.mjs")], { cwd: ROOT, stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
