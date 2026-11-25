/**
 * Path containment (Principle 6). Every repo-relative path that reaches the
 * filesystem passes through here first.
 *
 * Normalisation is deliberately strict rather than clever: a path containing
 * `..` is refused, not resolved, so there is no arithmetic to get wrong.
 * Containment is then re-checked against the *real* location on disk, so a
 * symlink inside the site that points elsewhere cannot be used to escape.
 */
import { lstatSync, realpathSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { GalleyError } from "../errors";
import { mayBeShown } from "./policy";

const OUTSIDE = "That file is outside the site folder, so it can't be opened or changed here.";

/**
 * Turns user/agent input into a canonical repo-relative POSIX path, or throws
 * `forbidden`. "" means the site root itself.
 */
export function normalizeRepoPath(input: string): string {
  if (typeof input !== "string") throw new GalleyError("forbidden", OUTSIDE, "path is not a string");
  if (input.includes("\0")) throw new GalleyError("forbidden", OUTSIDE, "path contains a NUL byte");
  // Backslashes are separators on Windows and legal-but-confusing filename
  // characters elsewhere; refusing them keeps one meaning on every platform.
  if (input.includes("\\")) throw new GalleyError("forbidden", OUTSIDE, "path contains a backslash");
  if (input.startsWith("/") || /^[a-zA-Z]:/.test(input) || input.startsWith("~")) {
    throw new GalleyError("forbidden", OUTSIDE, `absolute path: ${input}`);
  }
  const segments: string[] = [];

  for (const segment of input.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") throw new GalleyError("forbidden", OUTSIDE, `path climbs out: ${input}`);
    segments.push(segment);
  }

  return segments.join("/");
}

/** Converts a filesystem path relative to a root into repo-relative POSIX form. */
export function toPosixRelative(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join("/");
}

function isInside(realRoot: string, candidate: string): boolean {
  return candidate === realRoot || candidate.startsWith(realRoot.endsWith(sep) ? realRoot : realRoot + sep);
}

export interface ResolvedPath {
  /** Canonical repo-relative path as requested. */
  path: string;
  /** Absolute path under the (logical) root — what callers read and write. */
  absolute: string;
  /**
   * The path relative to the real root after resolving symlinks in the
   * deepest existing ancestor. Equals `path` unless a symlink is involved;
   * write policy is checked against both.
   */
  realPath: string;
}

/**
 * Resolve and containment-check a repo-relative path. `realRoot` must be the
 * realpath of `root` (macOS temp dirs live behind the /var → /private/var link).
 */
export function resolveContained(root: string, realRoot: string, input: string): ResolvedPath {
  const path = normalizeRepoPath(input);
  const absolute = path === "" ? root : join(root, ...path.split("/"));

  // Walk up to the deepest component that exists and resolve it for real; the
  // components below it do not exist yet, so they cannot be links.
  let probe = absolute;
  let suffix = "";

  for (;;) {
    let exists = false;

    try {
      const stat = lstatSync(probe);

      exists = true;
      if (stat.isSymbolicLink()) {
        let target: string;

        try {
          target = realpathSync(probe);
        } catch {
          // A dangling link cannot be verified, so it is not followed.
          throw new GalleyError("forbidden", OUTSIDE, `dangling symlink: ${toPosixRelative(root, probe)}`);
        }
        return finish(target);
      }
    } catch (error) {
      if (error instanceof GalleyError) throw error;
      const code = (error as NodeJS.ErrnoException).code;

      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    }
    if (exists) return finish(realpathSync(probe));
    const parent = dirname(probe);

    if (parent === probe) throw new GalleyError("forbidden", OUTSIDE, "no existing ancestor");
    suffix = suffix ? join(probe.slice(parent.length + 1), suffix) : probe.slice(parent.length + 1);
    probe = parent;
  }

  function finish(realAncestor: string): ResolvedPath {
    const real = suffix ? join(realAncestor, suffix) : realAncestor;

    if (!isInside(realRoot, real)) {
      throw new GalleyError("forbidden", OUTSIDE, `resolves outside the site: ${path}`);
    }
    return { path, absolute, realPath: toPosixRelative(realRoot, real) };
  }
}

/** Site folders as they really are on disk, kept so a pass over many files resolves each site once. */
const realRoots = new Map<string, string>();

/**
 * For one pass over many files of a site: which of them may be shown where
 * they really are.
 *
 * A read by path asks this of the path it resolves (`resolveContained`, and
 * the engine's reads). Whatever reads many files without going through
 * that, a listing of a collection's entries, the search index, the list of
 * changes, opens each file itself and would follow a link named like an
 * entry to wherever it leads. So those ask here: a file that is a link, or
 * lies in a linked folder, is one of the site's only when its real place is
 * inside the site and may be shown.
 *
 * It is meant to cost little: one look at each file and one at each folder
 * (kept for the pass), and the real place is worked out only for the few
 * that are links or lie under one. A file that isn't there is let through:
 * there is nothing of it to show, and whoever reads it says so.
 */
export function shownWhereTheyAre(root: string): (path: string) => boolean {
  let realRoot = realRoots.get(root);
  const linkedFolders = new Map<string, boolean>();
  /** Whether a folder is a link, or lies under one, short of the site folder itself. */
  const underLink = (folder: string): boolean => {
    if (folder === root || folder.length <= root.length) return false;
    const known = linkedFolders.get(folder);

    if (known !== undefined) return known;
    let linked = false;

    try {
      linked = lstatSync(folder).isSymbolicLink() || underLink(dirname(folder));
    } catch {
      linked = underLink(dirname(folder));
    }
    linkedFolders.set(folder, linked);
    return linked;
  };

  return (path) => {
    const absolute = join(root, ...path.split("/"));
    let link: boolean;

    try {
      link = lstatSync(absolute).isSymbolicLink();
    } catch {
      return true;
    }
    if (!link && !underLink(dirname(absolute))) return true;
    try {
      if (realRoot === undefined) realRoots.set(root, (realRoot = realpathSync(root)));
      const real = realpathSync(absolute);

      return isInside(realRoot, real) && mayBeShown(toPosixRelative(realRoot, real));
    } catch {
      // A link that leads nowhere, or one that can't be followed: not a file of the site.
      return false;
    }
  };
}
