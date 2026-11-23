/**
 * Low-level file helpers: hashing, binary sniffing, line counting, atomic
 * writes and the file listing used when a folder is not a git repository.
 */
import { createHash, randomBytes } from "node:crypto";
import { chmod, link, lstat, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { glob } from "tinyglobby";
import { PRODUCT } from "../brand";

/**
 * sha-256, hex, first 16 characters. The content module's `hashContent` uses
 * the same scheme, so a hash handed out with an entry can come back as a
 * `baseHash` here.
 */
export function hashContent(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/** Git's own heuristic: a NUL byte in the first 8000 bytes means binary. */
export function isBinary(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, 8000);

  for (let i = 0; i < end; i += 1) if (bytes[i] === 0) return true;
  return false;
}

export function countLines(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  let lines = 0;

  for (const byte of bytes) if (byte === 10) lines += 1;
  return bytes[bytes.length - 1] === 10 ? lines : lines + 1;
}

export function toBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === "string" ? Buffer.from(content, "utf8") : content;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && Buffer.from(a.buffer, a.byteOffset, a.length).equals(b);
}

/** Temp files are dot-prefixed and tagged so the watcher and listings skip them. */
export const TEMP_MARKER = `.${PRODUCT.slug}-tmp-`;

export function isTempFile(path: string): boolean {
  return basename(path).includes(TEMP_MARKER);
}

export async function readIfExists(absolute: string): Promise<Buffer | null> {
  try {
    return await readFile(absolute);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}

/**
 * Write via a temp file in the same directory and a rename, so a reader (the
 * dev server's watcher, the user's editor) never sees half a file and a crash
 * never leaves one. Renaming also replaces a hard link instead of writing
 * through it. The existing file's permissions are kept (an executable script
 * stays executable).
 *
 * `createOnly` refuses to replace an existing file, atomically: the temp file
 * is hard-linked into place, which fails if the name is taken.
 */
export async function atomicWrite(
  absolute: string,
  bytes: Uint8Array,
  options: { createOnly?: boolean } = {}
): Promise<void> {
  const directory = dirname(absolute);

  await mkdir(directory, { recursive: true });
  const temp = join(directory, `${TEMP_MARKER}${randomBytes(6).toString("hex")}-${basename(absolute)}`.slice(0, 200));
  let mode: number | null = null;

  try {
    mode = (await stat(absolute)).mode & 0o7777;
  } catch {
    mode = null;
  }
  await writeFile(temp, bytes, { flag: "wx", mode: mode ?? 0o666 });
  try {
    if (mode !== null) await chmod(temp, mode);
    if (options.createOnly) {
      try {
        await link(temp, absolute);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;

        if (code === "EEXIST") throw error;
        // Filesystems without hard links (FAT, some network mounts): fall
        // back to check-then-rename, which is only racy against other writers.
        if (await exists(absolute)) throw Object.assign(new Error("exists"), { code: "EEXIST" });
        await rename(temp, absolute);
        return;
      }
      await unlink(temp);
      return;
    }
    await rename(temp, absolute);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

export async function exists(absolute: string): Promise<boolean> {
  try {
    await lstat(absolute);
    return true;
  } catch {
    return false;
  }
}

export async function isRegularFile(absolute: string): Promise<boolean> {
  try {
    return (await stat(absolute)).isFile();
  } catch {
    return false;
  }
}

/** Never listed when the folder is not a repository (and never written, see policy.ts). */
const DEFAULT_IGNORES = ["**/node_modules/**", "**/.git/**", "**/.DS_Store", `**/*${TEMP_MARKER}*`];

/**
 * Turns the root `.gitignore` into tinyglobby ignore patterns. Deliberately
 * partial — negations and nested .gitignore files are not interpreted — which
 * is fine for the one case it serves: a site folder that is not a repository.
 */
export function gitignoreToGlobs(text: string): string[] {
  const globs: string[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();

    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    let pattern = line.replace(/^\\/, "");
    const anchored = pattern.startsWith("/") || pattern.slice(0, -1).includes("/");
    const directoryOnly = pattern.endsWith("/");

    pattern = pattern.replace(/^\//, "").replace(/\/$/, "");
    const base = anchored ? pattern : `**/${pattern}`;

    globs.push(base, `${base}/**`);
    if (directoryOnly) globs.splice(globs.length - 2, 1);
  }
  return globs;
}

export async function listWithoutGit(root: string): Promise<string[]> {
  const gitignore = await readIfExists(join(root, ".gitignore"));
  const ignore = [...DEFAULT_IGNORES, ...(gitignore ? gitignoreToGlobs(gitignore.toString("utf8")) : [])];

  return glob("**/*", {
    cwd: root,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore,
    expandDirectories: false,
  });
}
