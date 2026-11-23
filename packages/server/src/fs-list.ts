/**
 * The "open a folder" picker. The browser can't see the disk, so the server
 * lists directories — only directories, only under one allowed root, and
 * every candidate is checked again after resolving symlinks.
 */
import { existsSync, statSync } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { forbidden, notFound } from "./errors";

/** What makes a folder look like a site: one of these exists in it. */
export const SITE_MARKERS = [
  "package.json",
  ".git",
  "galley.config.json",
  "hugo.toml",
  "config.toml",
  "_config.yml",
  "content",
  "src/content",
] as const;

export function looksLikeSite(dir: string): boolean {
  return SITE_MARKERS.some((marker) => {
    try {
      const info = statSync(join(dir, marker));

      return marker === "content" || marker === "src/content" ? info.isDirectory() : true;
    } catch {
      return false;
    }
  });
}

export function isInside(root: string, path: string): boolean {
  if (path === root) return true;
  const rel = relative(root, path);

  return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
}

/** Expands `~`, resolves relative paths against `base`, and realpaths. Throws not-found when missing. */
export async function realDirectory(input: string, base: string): Promise<string> {
  const expanded = input === "~" ? homedir() : input.startsWith("~/") ? join(homedir(), input.slice(2)) : input;
  const absolute = isAbsolute(expanded) ? expanded : resolve(base, expanded);
  let real: string;

  try {
    real = await realpath(absolute);
  } catch {
    throw notFound("That folder doesn't exist.");
  }
  if (!(await stat(real)).isDirectory()) throw notFound("That isn't a folder.");
  return real;
}

/** Throws forbidden unless `path` (after realpath) is inside `root`. Missing paths are checked by their nearest existing parent. */
export async function assertInside(root: string, path: string, message: string): Promise<string> {
  const realRoot = await realpath(root);
  let probe = resolve(path);
  const rest: string[] = [];

  while (!existsSync(probe)) {
    const parent = dirname(probe);

    if (parent === probe) break;
    rest.unshift(probe.slice(parent.length + 1));
    probe = parent;
  }
  const real = join(await realpath(probe), ...rest);

  if (!isInside(realRoot, real)) throw forbidden(message);
  return real;
}

export interface FolderListing {
  path: string;
  parent: string | null;
  entries: Array<{ name: string; path: string; isSite: boolean }>;
}

const OUTSIDE = "That folder is outside the folders this app can open.";

export async function listFolders(root: string, requested: string | undefined): Promise<FolderListing> {
  const realRoot = await realpath(root);
  const target = requested ? await realDirectory(requested, realRoot) : realRoot;

  if (!isInside(realRoot, target)) throw forbidden(OUTSIDE);
  const dirents = await readdir(target, { withFileTypes: true }).catch(() => {
    throw forbidden("That folder can't be read.");
  });
  const entries: FolderListing["entries"] = [];

  await Promise.all(
    dirents.map(async (dirent) => {
      if (dirent.name.startsWith(".") || dirent.name === "node_modules") return;
      if (!dirent.isDirectory() && !dirent.isSymbolicLink()) return;
      const path = join(target, dirent.name);

      if (dirent.isSymbolicLink()) {
        // A link is listed only when it lands on a folder inside the root.
        const resolved = await realpath(path).catch(() => null);

        if (!resolved || !isInside(realRoot, resolved)) return;
        if (!(await stat(resolved).catch(() => null))?.isDirectory()) return;
      }
      entries.push({ name: dirent.name, path, isSite: looksLikeSite(path) });
    })
  );
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  return { path: target, parent: target === realRoot ? null : dirname(target), entries };
}
