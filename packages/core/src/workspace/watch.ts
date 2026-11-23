/**
 * Notices edits made outside the app — an editor, a terminal `git pull`.
 *
 * macOS and Windows have native recursive watching. Linux's recursive mode in
 * Node walks the entire tree, node_modules included, so there the watcher
 * adds one non-recursive watch per directory, skipping ignored ones, and
 * follows new directories as they appear.
 *
 * This module only reports raw events, debounced; deciding which of them the
 * workspace caused itself is the workspace's job.
 */
import { watch, type FSWatcher } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { isTempFile } from "./files";

export const WATCH_DEBOUNCE_MS = 150;

/** Directories whose churn is never a content change. */
const IGNORED_DIRS = new Set([
  ".git", "node_modules", "dist", ".astro", "_site", ".next", ".cache", ".svelte-kit", ".nuxt",
  ".output", ".vercel", ".netlify", ".turbo", ".docusaurus", ".parcel-cache", ".vite",
]);
const IGNORED_PREFIXES = ["public/build/", "resources/_gen/"];
const MAX_LINUX_DIRS = 4000;

export function isIgnoredForWatch(path: string): boolean {
  if (!path || isTempFile(path) || path.endsWith(".DS_Store")) return true;
  if (path.split("/").some((segment) => IGNORED_DIRS.has(segment))) return true;
  return IGNORED_PREFIXES.some((prefix) => path.startsWith(prefix) || `${path}/` === prefix);
}

/** Git metadata whose change means "someone committed, pulled or switched branch". */
function isInterestingGitPath(path: string): boolean {
  return path === "HEAD" || path === "index" || path === "packed-refs" || path.startsWith("refs/heads/");
}

export interface WatchBatch {
  /** Repo-relative paths reported by the filesystem (may no longer exist). */
  paths: string[];
  /** The filesystem reported an event without a name; rescan everything. */
  unknown: boolean;
  /** HEAD, the index or a branch ref changed. */
  git: boolean;
}

export interface TreeWatcher {
  close(): void;
}

const RECURSIVE = process.platform === "darwin" || process.platform === "win32";

export function watchTree(options: {
  root: string;
  /** Absolute git directory, or null when the folder is not a repository. */
  gitDir: string | null;
  onBatch: (batch: WatchBatch) => void;
  onError?: (error: Error) => void;
}): TreeWatcher {
  const { root } = options;
  const watchers = new Map<string, FSWatcher>();
  let pending: WatchBatch = { paths: [], unknown: false, git: false };
  let timer: NodeJS.Timeout | null = null;
  let closed = false;

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const batch = { ...pending, paths: [...new Set(pending.paths)] };

      pending = { paths: [], unknown: false, git: false };
      if (!closed) options.onBatch(batch);
    }, WATCH_DEBOUNCE_MS);
  };

  const fileEvent = (directory: string, filename: string | Buffer | null) => {
    if (closed) return;
    if (filename === null) {
      pending.unknown = true;
      schedule();
      return;
    }
    const absolute = join(directory, filename.toString());
    const path = relative(root, absolute).split(sep).join("/");

    if (path.startsWith("..") || isIgnoredForWatch(path)) return;
    pending.paths.push(path);
    schedule();
    if (!RECURSIVE) void addDirectory(absolute, 0);
  };

  const add = (directory: string, recursive: boolean, listener: (name: string | Buffer | null) => void) => {
    if (watchers.has(directory) || closed) return;
    try {
      const watcher = watch(directory, { recursive, persistent: false }, (_event, name) => listener(name));

      watcher.on("error", (error) => {
        watcher.close();
        watchers.delete(directory);
        options.onError?.(error);
      });
      watchers.set(directory, watcher);
    } catch (error) {
      // ENOENT for a directory that vanished between the event and now; not worth surfacing.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") options.onError?.(error as Error);
    }
  };

  async function addDirectory(absolute: string, depth: number): Promise<void> {
    if (closed || watchers.size >= MAX_LINUX_DIRS || depth > 32) return;
    const path = relative(root, absolute).split(sep).join("/");

    if (path && isIgnoredForWatch(path)) return;
    let entries;

    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch {
      return; // A file, or gone.
    }
    add(absolute, false, (name) => fileEvent(absolute, name));
    for (const entry of entries) {
      if (entry.isDirectory()) await addDirectory(join(absolute, entry.name), depth + 1);
    }
  }

  if (RECURSIVE) add(root, true, (name) => fileEvent(root, name));
  else void addDirectory(root, 0);

  if (options.gitDir) {
    const gitDir = options.gitDir;
    const gitListener = (base: string) => (name: string | Buffer | null) => {
      if (closed) return;
      const path = name === null ? "HEAD" : relative(gitDir, join(base, name.toString())).split(sep).join("/");

      if (!isInterestingGitPath(path)) return;
      pending.git = true;
      schedule();
    };

    if (RECURSIVE) add(gitDir, true, gitListener(gitDir));
    else {
      add(gitDir, false, gitListener(gitDir));
      add(join(gitDir, "refs", "heads"), false, gitListener(join(gitDir, "refs", "heads")));
    }
  }

  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    },
  };
}
