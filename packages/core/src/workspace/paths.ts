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
