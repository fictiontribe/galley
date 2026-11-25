/**
 * The media library: images (and PDFs/videos) under the site's media roots,
 * and saving uploads with names that never overwrite anything.
 */
import { open, readdir } from "node:fs/promises";
import { imageSize } from "image-size";
import { GalleyError } from "../errors";
import type { ChangeOrigin, MediaConfig, MediaItem } from "../types";
import { normalizeRepoPath } from "./paths";
import type { Workspace } from "./workspace";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  mp4: "video/mp4",
};
/** Types whose pixel size we read. */
const MEASURED = new Set(["png", "jpg", "jpeg", "webp", "avif", "gif", "svg"]);
/** Raster types whose bytes must actually parse as that image before we save them. */
const VERIFIED = new Set(["png", "jpg", "jpeg", "webp", "avif", "gif"]);
const HEADER_BYTES = 128 * 1024;
/** JPEGs with large embedded thumbnails put the size marker late; read up to this much on a retry. */
const FULL_READ_LIMIT = 8 * 1024 * 1024;

export function mediaExtension(name: string): string {
  const dot = name.lastIndexOf(".");

  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * The media type for a lower-cased extension, or undefined. MIME is a plain
 * object, so an `in` test or a plain index would also answer for the names
 * every object inherits ("constructor", "__proto__"); only its own keys count.
 */
export function mimeOf(ext: string): string | undefined {
  return Object.hasOwn(MIME, ext) ? MIME[ext] : undefined;
}

export function isMediaFile(name: string): boolean {
  return mimeOf(mediaExtension(name)) !== undefined;
}

/**
 * What an image file is, for the proof: its type, size and — when the bytes
 * say — its pixel size. Null for anything that isn't an image.
 */
export function imageFacts(path: string, bytes: Uint8Array): { type: string; size: number; width?: number; height?: number } | null {
  const ext = mediaExtension(path);
  const type = mimeOf(ext);

  if (!type || !type.startsWith("image/")) return null;
  const facts: { type: string; size: number; width?: number; height?: number } = { type, size: bytes.byteLength };

  try {
    const measured = imageSize(bytes);

    if (measured.width && measured.height) {
      facts.width = measured.width;
      facts.height = measured.height;
    }
  } catch {
    // Unreadable or truncated: type and size are still true.
  }
  return facts;
}

function joinUrl(publicPath: string, rest: string): string {
  const base = publicPath.endsWith("/") ? publicPath.slice(0, -1) : publicPath;

  return `${base}/${rest.split("/").map(encodeURIComponent).join("/")}`;
}

interface CachedSize {
  mtimeMs: number;
  size: number;
  width?: number;
  height?: number;
}

/** Dimension cache per workspace, keyed by path, valid while mtime and size match. */
const sizeCache = new WeakMap<Workspace, Map<string, CachedSize>>();

async function readHead(absolute: string, bytes: number): Promise<Uint8Array> {
  const handle = await open(absolute, "r");

  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);

    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function measure(absolute: string, size: number): Promise<{ width?: number; height?: number }> {
  const attempt = (bytes: Uint8Array) => {
    try {
      const result = imageSize(bytes);

      return result.width && result.height ? { width: result.width, height: result.height } : null;
    } catch {
      return null;
    }
  };
  const head = await readHead(absolute, Math.min(size, HEADER_BYTES));
  const first = attempt(head);

  if (first || size <= HEADER_BYTES || size > FULL_READ_LIMIT) return first ?? {};
  return attempt(await readHead(absolute, size)) ?? {};
}

function rootsOf(media: MediaConfig): Array<{ dir: string; publicPath: string }> {
  const roots = [...media.roots];

  if (!roots.some((root) => normalizeRepoPath(root.dir) === normalizeRepoPath(media.dir))) {
    roots.unshift({ dir: media.dir, publicPath: media.publicPath });
  }
  return roots;
}

export async function listMedia(workspace: Workspace, media: MediaConfig): Promise<MediaItem[]> {
  let cache = sizeCache.get(workspace);

  if (!cache) {
    cache = new Map();
    sizeCache.set(workspace, cache);
  }
  const items = new Map<string, MediaItem>();

  for (const root of rootsOf(media)) {
    const rootPath = normalizeRepoPath(root.dir);
    let rootAbsolute: string;

    try {
      rootAbsolute = workspace.resolvePath(rootPath);
    } catch {
      continue; // A media root pointing outside the site is ignored, not followed.
    }
    const stack: string[] = [""];

    while (stack.length > 0) {
      const relative = stack.pop() ?? "";
      let entries;

      try {
        entries = await readdir(relative ? `${rootAbsolute}/${relative}` : rootAbsolute, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        // Symlinks are not followed: a link could lead out of the site.
        if (entry.name.startsWith(".") || entry.isSymbolicLink() || entry.name === "node_modules") continue;
        const childRelative = relative ? `${relative}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          stack.push(childRelative);
          continue;
        }
        if (!entry.isFile() || !isMediaFile(entry.name)) continue;
        const path = rootPath ? `${rootPath}/${childRelative}` : childRelative;

        if (items.has(path)) continue;
        const stat = await workspace.stat(path);

        if (!stat) continue;
        const ext = mediaExtension(entry.name);
        let dims = cache.get(path);

        if (!dims || dims.mtimeMs !== stat.mtimeMs || dims.size !== stat.size) {
          const measured = MEASURED.has(ext) ? await measure(workspace.resolvePath(path), stat.size).catch(() => ({})) : {};

          dims = { mtimeMs: stat.mtimeMs, size: stat.size, ...measured };
          cache.set(path, dims);
        }
        items.set(path, {
          path,
          url: joinUrl(root.publicPath, childRelative),
          name: entry.name,
          size: stat.size,
          type: mimeOf(ext) ?? "application/octet-stream",
          ...(dims.width ? { width: dims.width } : {}),
          ...(dims.height ? { height: dims.height } : {}),
          modifiedAt: stat.mtimeMs,
          status: workspace.statusOf(path),
        });
      }
    }
  }
  return [...items.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/** "My Photo (1).JPG" → "my-photo-1.jpg". */
export function sanitizeMediaName(filename: string): { base: string; ext: string } {
  const leaf = filename.split(/[\\/]/).pop() ?? "";
  const ext = mediaExtension(leaf);
  const stem = ext ? leaf.slice(0, -(ext.length + 1)) : leaf;
  const base =
    stem
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/g, "") || "image";

  return { base, ext };
}

/** What an upload is, once it passed the library's checks: its clean name, type and (for pictures) pixel size. */
export interface CheckedUpload {
  base: string;
  ext: string;
  type: string;
  width?: number;
  height?: number;
}

/** The library's checks for any upload, wherever it is kept: a known type, at most 25 MB, not empty, a real image. */
export function checkUpload(input: { filename: string; data: Uint8Array }): CheckedUpload {
  const { base, ext } = sanitizeMediaName(input.filename);

  if (mimeOf(ext) === undefined) {
    throw new GalleyError(
      "invalid",
      "That kind of file can't be added to the media library. Use an image (PNG, JPG, WebP, AVIF, GIF or SVG), a PDF or an MP4 video.",
      input.filename
    );
  }
  if (input.data.length > MAX_UPLOAD_BYTES) {
    throw new GalleyError("invalid", "That file is larger than 25 MB. Make it smaller and try again.", String(input.data.length));
  }
  if (input.data.length === 0) throw new GalleyError("invalid", "That file is empty.", input.filename);
  if (VERIFIED.has(ext)) {
    let ok = false;

    try {
      ok = Boolean(imageSize(input.data).width);
    } catch {
      ok = false;
    }
    if (!ok) throw new GalleyError("invalid", "That file doesn't look like a valid image.", input.filename);
  }
  let dims: { width?: number; height?: number } = {};

  if (MEASURED.has(ext)) {
    try {
      const result = imageSize(input.data);

      dims = result.width && result.height ? { width: result.width, height: result.height } : {};
    } catch {
      dims = {};
    }
  }
  return { base, ext, type: mimeOf(ext) ?? "application/octet-stream", ...dims };
}

/** The folder under the media root a file is asked for ("team/"), or "" for the root itself. Refuses folders outside the media roots. */
export function mediaSubfolder(media: MediaConfig, directory: string | undefined): { root: { dir: string; publicPath: string }; subfolder: string; directory: string } {
  const dir = normalizeRepoPath(directory ?? media.dir);
  const root = rootsOf(media).find((r) => {
    const rootDir = normalizeRepoPath(r.dir);

    return dir === rootDir || rootDir === "" || dir.startsWith(`${rootDir}/`);
  });

  if (!root) throw new GalleyError("forbidden", "Media can only be saved inside the site's media folders.", dir);
  const rootDir = normalizeRepoPath(root.dir);
  const rest = rootDir ? dir.slice(rootDir.length).replace(/^\/+/, "") : dir;

  return { root, subfolder: rest ? `${rest}/` : "", directory: dir };
}

export async function saveMedia(
  workspace: Workspace,
  media: MediaConfig,
  input: { filename: string; directory?: string; data: Uint8Array },
  options: { origin?: ChangeOrigin } = {}
): Promise<MediaItem> {
  const { base, ext, ...dims } = checkUpload(input);
  const directory = normalizeRepoPath(input.directory ?? media.dir);
  const root = rootsOf(media).find((r) => {
    const dir = normalizeRepoPath(r.dir);

    return directory === dir || dir === "" || directory.startsWith(`${dir}/`);
  });

  if (!root) {
    throw new GalleyError("forbidden", "Media can only be saved inside the site's media folders.", directory);
  }
  const rootDir = normalizeRepoPath(root.dir);

  for (let attempt = 1; attempt < 1000; attempt += 1) {
    const name = `${base}${attempt === 1 ? "" : `-${attempt}`}.${ext}`;
    const path = directory ? `${directory}/${name}` : name;

    if (await workspace.exists(path)) continue;
    try {
      await workspace.writeFile(path, input.data, { origin: options.origin ?? "user", mode: "content", createOnly: true });
    } catch (error) {
      // Someone took the name between the check and the write: try the next one.
      if (error instanceof GalleyError && error.code === "conflict") continue;
      throw error;
    }
    const stat = await workspace.stat(path);
    const within = rootDir ? path.slice(rootDir.length + 1) : path;
    const { type: _type, ...size } = dims;

    return {
      path,
      url: joinUrl(root.publicPath, within),
      name,
      size: input.data.length,
      type: mimeOf(ext) ?? "application/octet-stream",
      ...size,
      modifiedAt: stat?.mtimeMs ?? Date.now(),
      status: workspace.statusOf(path),
    };
  }
  throw new GalleyError("conflict", "Too many files already use that name. Pick a different name.", base);
}
