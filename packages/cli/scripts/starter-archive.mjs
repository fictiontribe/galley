// A starter that is downloaded each time a site is made from it, instead of travelling
// inside galley-cms: its archive, and what the bundle keeps of it.
//
// The archive is a plain ustar tar, gzipped, written here rather than by a
// tar program so that the same files always give the same bytes (no times,
// owners or order of the machine that built it). The bundle records its
// SHA-256, and a release run again from its tag must make the very archive
// the published bundle names.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { gzipSync } from "node:zlib";

/** A starter's own record, beside what the bundle keeps of it (core: site/starter-download.ts reads it). */
export const STARTER_DOWNLOAD = "starter-download.json";

/** The release asset's name for a starter. */
export function starterAssetName(id) {
  return `starters-${id}.tgz`;
}

/** Every file under `dir`, as sorted POSIX paths relative to it. */
export function filesUnder(dir, prefix = "") {
  const out = [];

  for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) out.push(...filesUnder(dir, rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function octal(value, width) {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

/** name ≤ 100 bytes, or split at a "/" into prefix ≤ 155 and name ≤ 100. */
function splitPath(path) {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: "" };
  for (let at = path.indexOf("/"); at !== -1; at = path.indexOf("/", at + 1)) {
    const prefix = path.slice(0, at);
    const name = path.slice(at + 1);

    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix };
  }
  throw new Error(`${path} is too long for a starter archive.`);
}

function header(path, size, mode) {
  const block = Buffer.alloc(512);
  const { name, prefix } = splitPath(path);

  block.write(name, 0, "utf8");
  block.write(octal(mode, 8), 100, "ascii");
  block.write(octal(0, 8), 108, "ascii");
  block.write(octal(0, 8), 116, "ascii");
  block.write(octal(size, 12), 124, "ascii");
  block.write(octal(0, 12), 136, "ascii");
  block.write("        ", 148, "ascii");
  block.write("0", 156, "ascii");
  block.write("ustar\0", 257, "ascii");
  block.write("00", 263, "ascii");
  block.write(prefix, 345, "utf8");
  let sum = 0;

  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  return block;
}

/**
 * The gzipped tar of every file under `dir` (paths relative to it), the same bytes every time for the same files.
 * `runnable(rel)`, when given, says which files are programs — from git, which keeps that on every system (Windows'
 * own files don't) — so an archive built on any computer is the same.
 */
export function starterArchive(dir, runnable) {
  const parts = [];

  for (const rel of filesUnder(dir)) {
    const path = join(dir, ...rel.split("/"));
    const data = readFileSync(path);
    const mode = (runnable ? runnable(rel) : (statSync(path).mode & 0o111) !== 0) ? 0o755 : 0o644;

    parts.push(header(rel, data.length, mode), data);
    const pad = (512 - (data.length % 512)) % 512;

    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts), { level: 9 });
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A path a starter.json names, kept only when it stays inside the starter (as core's reader does). */
function inside(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const clean = posix.normalize(value.trim().replace(/\\/g, "/")).replace(/^\.\//, "");

  return clean === ".." || clean.startsWith("../") || posix.isAbsolute(clean) || clean.includes("\0") ? null : clean;
}

/**
 * What the bundle keeps of a starter that is downloaded: what the wizard and `galley starters` read to show it —
 * package.json, starter.json, galley.config.json, and the preview pictures starter.json names.
 */
export function keptFiles(manifest) {
  const kept = new Set(["package.json", "starter.json", "galley.config.json"]);

  for (const path of [manifest.preview, ...(Array.isArray(manifest.looks) ? manifest.looks.map((look) => look?.preview) : [])]) {
    const clean = inside(path);

    if (clean) kept.add(clean);
  }
  return kept;
}
