#!/usr/bin/env node
// Paints a placeholder for every photograph in galley/photography/shots.json:
// a tonal field in the active look's palette, a hard edge of "late sun"
// across it, a little film grain, and the shot's short title and ratio set
// small in a corner. Each is written at the exact final size and file name,
// so replacing it with the real photograph changes nothing in the layout.
//
//   node scripts/make-placeholders.mjs            write every missing placeholder
//   node scripts/make-placeholders.mjs --force    rewrite them all (e.g. after switching looks)
//   node scripts/make-placeholders.mjs --check    only check the shot list against the content
//
// A slot that already holds a real photograph (anything this script did not
// write) is never touched, even with --force. Colours come from the
// --placeholder-* tokens in src/styles/tokens.css.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { oklchToRgb, readTokens } from "./lib/tokens.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = join(ROOT, "galley/photography/shots.json");
/** Which slots hold a placeholder this script wrote (by content hash), so a real photograph is never overwritten. */
const MANIFEST = join(ROOT, "galley/photography/placeholders.json");

const { values } = parseArgs({ options: { force: { type: "boolean" }, check: { type: "boolean" } } });
const { shots } = JSON.parse(readFileSync(SHOTS, "utf8"));
const tokens = readTokens(join(ROOT, "src/styles/tokens.css"));

// ── Check: every image the content names is in the shot list, and back ────

function check() {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(md|json)$/.test(name)) files.push(path);
    }
  };
  for (const dir of ["src/content", "src/data", "galley/templates", "scripts/gallery"]) if (existsSync(join(ROOT, dir))) walk(join(ROOT, dir));

  const used = new Map();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\/images\/[\w/.-]+\.(?:webp|jpg|png|svg)/g)) {
      if (!used.has(match[0])) used.set(match[0], new Set());
      used.get(match[0]).add(file);
    }
  }
  const problems = [];
  const bySrc = new Map(shots.map((shot) => [`/${shot.file.replace(/^public\//, "")}`, shot]));
  for (const [src, where] of used) {
    if (!bySrc.has(src)) problems.push(`${src} is used in ${[...where].map((f) => relative(ROOT, f)).join(", ")} but is not in the shot list.`);
  }
  for (const [src, shot] of bySrc) {
    if (!used.has(src)) {
      problems.push(`${shot.id} (${src}) is in the shot list but nothing uses it.`);
      continue;
    }
    // The alt text should travel with the picture: wherever content (not the
    // gallery fixture) uses the file, the shot's alt should be written there too.
    for (const file of used.get(src)) {
      if (file.includes("scripts/gallery")) continue;
      const text = readFileSync(file, "utf8");
      if (!text.includes(shot.alt) && !text.includes(JSON.stringify(shot.alt).slice(1, -1))) {
        problems.push(`${relative(ROOT, file)} uses ${src} without the shot list's alt text (“${shot.alt}”).`);
      }
    }
  }
  return problems;
}

const problems = check();
for (const problem of problems) console.warn(`  ! ${problem}`);
if (values.check) {
  console.log(problems.length ? `${problems.length} problem(s).` : `Shot list and content agree: ${shots.length} shots.`);
  process.exit(problems.length ? 1 : 0);
}

// ── Paint ──────────────────────────────────────────────────────────────────

const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
const rgb = (name) => oklchToRgb(tokens[`placeholder-${name}`] ?? tokens["placeholder-mid"]);
const mix = (a, b, t) => ({ r: Math.round(a.r + (b.r - a.r) * t), g: Math.round(a.g + (b.g - a.g) * t), b: Math.round(a.b + (b.b - a.b) * t) });
const css = ({ r, g, b }) => `rgb(${r},${g},${b})`;
const lum = ({ r, g, b }) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const escape = (text) => text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** A small deterministic random number generator, so the same shot always gets the same grain. */
function random(seed) {
  let state = [...seed].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 2166136261);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function svg(shot) {
  const { width: w, height: h } = shot;
  const base = rgb(shot.tone ?? "mid");
  const dark = lum(base) < 0.45;
  const lit = mix(base, { r: 255, g: 250, b: 240 }, dark ? 0.16 : 0.32);
  const shade = mix(base, rgb("dark"), dark ? 0.45 : 0.3);
  const ink = dark ? mix(base, { r: 255, g: 255, b: 255 }, 0.72) : mix(base, rgb("dark"), 0.78);
  const rand = random(shot.id);
  // The sun comes from the side the prompt names; its hard shadow edge falls across the frame.
  const fromLeft = /from (?:the window at )?frame left|windows on the left/.test(shot.prompt) || !/frame right|windows on the right/.test(shot.prompt);
  const edge = 0.36 + rand() * 0.22;
  const lean = (0.18 + rand() * 0.2) * w;
  const x1 = (fromLeft ? edge : 1 - edge) * w;
  const x2 = x1 + (fromLeft ? lean : -lean);
  const shadow = fromLeft ? `M ${x1} 0 L ${w} 0 L ${w} ${h} L ${x2} ${h} Z` : `M 0 0 L ${x1} 0 L ${x2} ${h} L 0 ${h} Z`;
  const band = Math.round(h * (0.62 + rand() * 0.18));
  const size = Math.max(12, Math.round(Math.min(w, h) * 0.018));
  const pad = Math.round(size * 2.2);
  const corner = shot.labelCorner ?? "bottom-right";
  const right = corner.endsWith("right");
  const bottom = corner.startsWith("bottom");
  const tx = right ? w - pad : pad;
  // "upper-right": below where a header would sit over the picture.
  const ty = corner.startsWith("upper") ? Math.round(h * 0.2) : bottom ? h - pad - size * 1.5 : pad + size;
  const anchor = right ? "end" : "start";
  const title = escape(shot.title.toUpperCase());
  const meta = escape(`${shot.ratio}  ·  ${w} × ${h}`);

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="sun" x1="${fromLeft ? 0 : 1}" y1="0" x2="${fromLeft ? 1 : 0}" y2="1">
      <stop offset="0" stop-color="${css(lit)}"/>
      <stop offset="1" stop-color="${css(base)}"/>
    </linearGradient>
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${css(shade)}" stop-opacity="0"/>
      <stop offset="1" stop-color="${css(shade)}" stop-opacity="0.35"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#sun)"/>
  <path d="${shadow}" fill="${css(shade)}" fill-opacity="0.55"/>
  <rect y="${band}" width="${w}" height="${h - band}" fill="url(#ground)"/>
  <line x1="0" y1="${band}" x2="${w}" y2="${band}" stroke="${css(shade)}" stroke-opacity="0.25" stroke-width="${Math.max(1, Math.round(h / 900))}"/>
  <g font-family="Menlo, 'DejaVu Sans Mono', monospace" font-size="${size}" letter-spacing="${size * 0.12}" fill="${css(ink)}" text-anchor="${anchor}">
    <text x="${tx}" y="${ty}">${title}</text>
    <text x="${tx}" y="${ty + size * 1.5}" fill-opacity="0.7">${meta}</text>
  </g>
</svg>`);
}

async function grain(shot) {
  // Grain at half resolution, scaled up: finer than it looks, and kinder to the encoder.
  const gw = Math.ceil(shot.width / 2);
  const gh = Math.ceil(shot.height / 2);
  const rand = random(`${shot.id}-grain`);
  const pixels = Buffer.alloc(gw * gh);
  for (let i = 0; i < pixels.length; i++) pixels[i] = 128 + Math.round((rand() + rand() - 1) * 22);
  return sharp(pixels, { raw: { width: gw, height: gh, channels: 1 } }).resize(shot.width, shot.height, { kernel: "cubic" }).toColourspace("b-w").png().toBuffer();
}

let written = 0;
let kept = 0;
for (const shot of shots) {
  const out = join(ROOT, shot.file);
  const exists = existsSync(out);
  const ours = exists && manifest[shot.file] === hash(readFileSync(out));
  if (exists && !ours) {
    kept++;
    continue; // a real photograph: never overwritten
  }
  if (exists && ours && !values.force) continue;

  const image = sharp(svg(shot)).composite([{ input: await grain(shot), blend: "soft-light" }]);
  const buffer = shot.file.endsWith(".jpg") ? await image.jpeg({ quality: 78, mozjpeg: true }).toBuffer() : await image.webp({ quality: 58, effort: 6 }).toBuffer();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buffer);
  manifest[shot.file] = hash(buffer);
  written++;
  console.log(`  ${shot.file.padEnd(52)} ${String(shot.width).padStart(4)}×${String(shot.height).padEnd(4)} ${(buffer.length / 1024).toFixed(0).padStart(4)} kB`);
}

writeFileSync(MANIFEST, `${JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 2)}\n`);
console.log(`${written} placeholder(s) written, ${kept} real photograph(s) left alone, ${shots.length - written - kept} unchanged.`);
