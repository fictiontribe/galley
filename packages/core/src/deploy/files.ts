/**
 * The output folder as a host sees it: every file under it, with the hashes
 * each host's upload protocol asks for, checked against the host's limits
 * before a single byte leaves the machine.
 *
 * Only regular files inside the folder are taken. Symbolic links are not
 * followed (a link could point anywhere on the disk), and `.git`,
 * `node_modules` and `.env*` are never deployed even when a build copies them
 * into its output by mistake.
 */
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { DeployError } from "./errors";

export interface DeployFile {
  /** POSIX path relative to the output folder, no leading slash: "blog/index.html". */
  path: string;
  /** Absolute path on disk. */
  absolute: string;
  size: number;
  /** Lowercase hex SHA-1 of the bytes (Vercel's `x-vercel-digest`). */
  sha1: string;
  /**
   * Cloudflare's asset hash: SHA-256 over the base64 of the bytes followed by
   * the extension without its dot, first 32 hex characters — exactly what the
   * Direct Upload guide's sample computes.
   */
  cfHash: string;
  /** Content type the host should serve it with. */
  type: string;
  /** The bytes, when they don't come from `absolute` (a file made for the upload, like Vercel's routing-only vercel.json). */
  bytes?: Uint8Array;
}

export interface DeployLimits {
  maxFiles: number;
  maxFileBytes: number | null;
  maxTotalBytes: number | null;
}

const NEVER = new Set([".git", "node_modules"]);

function never(name: string): boolean {
  return NEVER.has(name) || name === ".env" || name.startsWith(".env.");
}

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  webmanifest: "application/manifest+json",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  rss: "application/rss+xml; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  wasm: "application/wasm",
};

export function contentTypeFor(path: string): string {
  return TYPES[extname(path).slice(1).toLowerCase()] ?? "application/octet-stream";
}

/** Cloudflare's 32-character asset hash of some bytes at a path (see DeployFile.cfHash). */
export function cloudflareHash(bytes: Uint8Array, path: string): string {
  const extension = extname(path).slice(1);

  return createHash("sha256").update(Buffer.from(bytes).toString("base64") + extension).digest("hex").slice(0, 32);
}

export function sha1(bytes: Uint8Array): string {
  return createHash("sha1").update(bytes).digest("hex");
}

/** "1.6 MB", "25 MB" — the same 1024 steps the UI uses. */
export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

async function walk(root: string, dir: string, out: Array<{ absolute: string; size: number }>, limit: number): Promise<void> {
  let entries;

  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (never(entry.name)) continue;
    const absolute = join(dir, entry.name);

    if (entry.isDirectory()) {
      await walk(root, absolute, out, limit);
    } else if (entry.isFile()) {
      const info = await lstat(absolute);

      out.push({ absolute, size: info.size });
    }
    // Symbolic links, sockets and the rest are skipped: only what is really in the folder goes.
    // Walking stops counting precisely past the limit; the error only needs to say "more than".
    if (out.length > limit + 1) return;
  }
}

/**
 * Lists the output folder, refusing — with the numbers — anything over the
 * host's limits, then reads and hashes each file. Throws DeployError
 * "no-output" when the folder is missing or empty.
 */
export async function collectFiles(dir: string, limits: DeployLimits, hostName: string, folderLabel: string): Promise<DeployFile[]> {
  const info = await lstat(dir).catch(() => null);

  if (!info?.isDirectory()) {
    throw new DeployError("no-output", `The build finished but there's no “${folderLabel}” folder to put online. Check the output folder in the site settings.`, dir);
  }
  const found: Array<{ absolute: string; size: number }> = [];

  await walk(dir, dir, found, limits.maxFiles);
  if (found.length === 0) {
    throw new DeployError("no-output", `The “${folderLabel}” folder is empty, so there's nothing to put online. Check that the site's build writes its pages there.`, dir);
  }
  if (found.length > limits.maxFiles) {
    throw new DeployError(
      "too-large",
      `The site has more than ${limits.maxFiles.toLocaleString("en-US")} files, and ${hostName} takes at most ${limits.maxFiles.toLocaleString("en-US")} in one go. Nothing was uploaded.`,
      `${found.length}+ files in ${dir}`
    );
  }
  if (limits.maxFileBytes !== null) {
    const big = found.filter((file) => file.size > limits.maxFileBytes!).sort((a, b) => b.size - a.size);

    if (big.length > 0) {
      const first = big[0]!;
      const name = relative(dir, first.absolute).split(sep).join("/");

      throw new DeployError(
        "too-large",
        `“${name}” is ${formatBytes(first.size)}, and ${hostName} takes files up to ${formatBytes(limits.maxFileBytes)}.${big.length > 1 ? ` ${big.length - 1} other ${big.length === 2 ? "file is" : "files are"} too big as well.` : ""} Make ${big.length > 1 ? "them" : "it"} smaller or move ${big.length > 1 ? "them" : "it"} elsewhere. Nothing was uploaded.`,
        big.map((file) => `${relative(dir, file.absolute)} ${file.size}`).join("\n")
      );
    }
  }
  const total = found.reduce((sum, file) => sum + file.size, 0);

  if (limits.maxTotalBytes !== null && total > limits.maxTotalBytes) {
    throw new DeployError(
      "too-large",
      `The site is ${formatBytes(total)}, and ${hostName} takes up to ${formatBytes(limits.maxTotalBytes)} in one go. Nothing was uploaded.`,
      `${total} bytes in ${dir}`
    );
  }
  const files: DeployFile[] = [];

  for (const file of found) {
    const bytes = await readFile(file.absolute);
    const path = relative(dir, file.absolute).split(sep).join("/");

    files.push({ path, absolute: file.absolute, size: bytes.byteLength, sha1: sha1(bytes), cfHash: cloudflareHash(bytes, path), type: contentTypeFor(path) });
  }
  return files;
}

/** Runs `task` over `items` with at most `limit` in flight; the first failure stops new work and is thrown. */
export async function eachLimited<T>(items: T[], limit: number, task: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  let failure: unknown = null;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (failure === null && next < items.length) {
      const index = next++;

      try {
        await task(items[index]!, index);
      } catch (error) {
        failure ??= error;
      }
    }
  });

  await Promise.all(workers);
  if (failure !== null) throw failure;
}
