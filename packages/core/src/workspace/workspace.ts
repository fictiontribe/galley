/**
 * The workspace: one site checkout, with every side effect on it going
 * through here — guarded reads and writes, the change set, publish and undo,
 * checkpoints, and the watcher.
 */
import { lstat, readFile, stat, unlink } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import picomatch from "picomatch";
import { GalleyError } from "../errors";
import type {
  AgentMode,
  ChangeOrigin,
  ChangeSet,
  ChangeStatus,
  FileDiff,
  GitStatus,
  HistoryEntry,
  PublishConfig,
  PublishRequest,
  PublishResult,
  WritableConfig,
  WriteOptions,
} from "../types";
import { buildChangeSet, buildDiff, readBaseBlob, readStatus, type ChangeContext, type ChangeEnricher, type PendingStatus } from "./changes";
import { CheckpointManager, type WorkspaceCheckpoint } from "./checkpoint";
import { atomicWrite, bytesEqual, hashContent, isTempFile, listWithoutGit, readIfExists, toBytes } from "./files";
import { git as createGit, splitNul, type Git, type RepoInfo } from "./git";
import { resolveContained, type ResolvedPath, normalizeRepoPath } from "./paths";
import { deniedReason, writeRefusal } from "./policy";
import * as publishing from "./publish";
import { chooseAuthor, currentAccountAuthor, type AuthorLayers, type ChosenAuthor } from "./author";
import { isSiteSettingsPath, requireBuildMode, requireSiteSettings } from "../install/caller";
import { watchTree, type TreeWatcher, type WatchBatch } from "./watch";
import { realpathSync, statSync } from "node:fs";

export interface WorkspaceOptions {
  /** Current writable globs — a function, because the site model can change. */
  writable: () => WritableConfig;
  /** Commit identity; falls back to the repo/global git config, then to a neutral default. */
  author?: () => { name: string; email: string } | null;
  /**
   * The site's own author and the app's, as saved. When given, the author is
   * chosen in the order author.ts describes — the repository's own git
   * settings between the two — and `author` is not used.
   */
  authorLayers?: () => AuthorLayers | null;
  /** Watch the tree for edits made outside the app. Default true. */
  watch?: boolean;
}

/** WriteOptions plus engine-internal flags. */
export interface WorkspaceWriteOptions extends WriteOptions {
  /** Refuse (conflict) instead of replacing an existing file. Atomic. */
  createOnly?: boolean;
  /**
   * Engine-internal: a file the app itself manages on the owner's behalf (the
   * site's config file). Skips the mode's writable globs — the config file is
   * in no content glob — but never containment or the hard deny-list.
   */
  system?: boolean;
}

export interface Workspace {
  readonly root: string;
  resolvePath(path: string): string;
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  stat(path: string): Promise<{ size: number; mtimeMs: number } | null>;
  listFiles(options?: { glob?: string; limit?: number }): Promise<string[]>;
  /**
   * Every match of an extended regular expression in the site's text files,
   * in the working copy or in the published version (the base commit): the
   * file and the matched text, one per match. Ignored files are never looked
   * at. Read-only.
   */
  grepText(pattern: string, options: { rev: "working" | "base" }): Promise<Array<{ path: string; match: string }>>;
  writeFile(path: string, content: string | Uint8Array, options: WorkspaceWriteOptions): Promise<void>;
  deleteFile(path: string, options: WriteOptions): Promise<void>;
  canWrite(path: string, mode: AgentMode): { ok: true } | { ok: false; reason: string };
  statusOf(path: string): ChangeStatus;
  /** Every path with a pending change, from the status cache (no git call). */
  pendingPaths(): string[];
  changes(enrich?: ChangeEnricher): Promise<ChangeSet>;
  diff(path: string): Promise<FileDiff>;
  readBase(path: string): Promise<Uint8Array | null>;
  discard(paths?: string[]): Promise<string[]>;
  publish(
    request: PublishRequest,
    config: PublishConfig,
    describe?: (files: string[]) => Promise<string> | string
  ): Promise<PublishResult>;
  history(limit?: number): Promise<HistoryEntry[]>;
  revert(commit: string, config: PublishConfig): Promise<PublishResult>;
  /** Push versions published here that the remote doesn't have yet. */
  send(config: PublishConfig): Promise<PublishResult>;
  gitStatus(): Promise<GitStatus>;
  pull(): Promise<GitStatus>;
  checkpoint(label: string): WorkspaceCheckpoint;
  onChange(listener: (paths: string[], origin: ChangeOrigin) => void): () => void;
  dispose(): Promise<void>;
}

/** Used when neither the app settings nor git config name the author. */
export const NEUTRAL_AUTHOR = { name: "Site editor", email: "site-editor@localhost" } as const;

/** How long after our own write an identical-looking filesystem event is treated as ours. */
const SELF_WRITE_WINDOW_MS = 5_000;
/** Git metadata events this soon after our own git command are ours. */
const GIT_QUIET_MS = 750;

/** A promise-chain mutex: one write or git mutation at a time. */
function createLock() {
  let tail: Promise<unknown> = Promise.resolve();

  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);

    tail = run.catch(() => undefined);
    return run;
  };
}

export async function createWorkspace(rootInput: string, options: WorkspaceOptions): Promise<Workspace> {
  const root = resolvePath(rootInput);
  let realRoot: string;

  try {
    if (!statSync(root).isDirectory()) throw new Error("not a directory");
    realRoot = realpathSync(root);
  } catch (error) {
    throw new GalleyError("not-found", "That site folder doesn't exist.", `${root}: ${(error as Error).message}`);
  }
  const repo: Git = createGit(root);
  const statusCache = new Map<string, PendingStatus>();
  const listeners = new Set<(paths: string[], origin: ChangeOrigin) => void>();
  const selfWrites = new Map<string, { hash: string | null; at: number }>();
  const lock = createLock();
  let gitBusy = 0;
  let gitQuietUntil = 0;
  let watcher: TreeWatcher | null = null;
  let disposed = false;

  const resolve = (path: string): ResolvedPath => resolveContained(root, realRoot, path);
  const absoluteOf = (path: string) => (path === "" ? root : join(root, ...path.split("/")));

  const emit = (paths: string[], origin: ChangeOrigin) => {
    if (paths.length === 0 || disposed) return;
    const unique = [...new Set(paths)].sort();

    for (const listener of listeners) {
      try {
        listener(unique, origin);
      } catch {
        // One broken listener must not stop the others or the write that triggered it.
      }
    }
  };

  const info = (): Promise<RepoInfo | null> => repo.info();

  /** Mutating git work: the watcher ignores git metadata churn while it runs. */
  async function quietGit<T>(task: () => Promise<T>): Promise<T> {
    gitBusy += 1;
    try {
      return await task();
    } finally {
      gitBusy -= 1;
      gitQuietUntil = Date.now() + GIT_QUIET_MS;
    }
  }

  async function refreshStatus(paths?: string[]): Promise<Map<string, PendingStatus>> {
    const repoInfo = await info();

    if (!repoInfo) {
      statusCache.clear();
      return statusCache;
    }
    if (paths && paths.length === 0) return statusCache;
    if (!paths || paths.length > 200) {
      const fresh = await readStatus(repo, repoInfo);

      statusCache.clear();
      for (const [path, status] of fresh) statusCache.set(path, status);
      return statusCache;
    }
    const fresh = await readStatus(repo, repoInfo, paths);

    for (const key of [...statusCache.keys()]) {
      if (paths.some((p) => key === p || key.startsWith(`${p}/`))) statusCache.delete(key);
    }
    for (const [path, status] of fresh) statusCache.set(path, status);
    return statusCache;
  }

  function markSelfWrite(path: string, bytes: Uint8Array | null) {
    const now = Date.now();

    for (const [key, mark] of selfWrites) if (now - mark.at > SELF_WRITE_WINDOW_MS) selfWrites.delete(key);
    selfWrites.set(path, { hash: bytes ? hashContent(bytes) : null, at: now });
  }

  async function changed(paths: string[], origin: ChangeOrigin) {
    await refreshStatus(paths.length > 0 ? paths : undefined);
    emit(paths, origin);
  }

  const checkpoints = new CheckpointManager({
    restoreFile: async (path, bytes) => {
      // Undo bypasses the mode (the turn may have run in build mode) but never
      // containment or the hard deny-list.
      const resolved = resolve(path);
      const denied = deniedReason(resolved.path, "build") ?? deniedReason(resolved.realPath, "build");

      if (denied) throw new GalleyError("forbidden", denied, path);
      // Putting the settings file back is changing it, whoever's turn changed it first.
      if (touchesSettings(resolved)) requireSiteSettings();
      await lock(() => applyWrite(resolved, bytes, {}));
    },
    emitUndo: async (paths) => {
      await refreshStatus(paths).catch(() => undefined);
      emit(paths, "undo");
    },
    allowRestore: (paths) => {
      const settings = (path: string) => {
        try {
          return touchesSettings(resolve(path));
        } catch {
          // A path that no longer resolves is refused by restoreFile itself; here only its name counts.
          return isSiteSettingsPath(path);
        }
      };

      if (paths.some(settings)) requireSiteSettings();
    },
  });

  /**
   * The single place bytes reach the disk. Records checkpoint pre-images,
   * writes atomically (or deletes), marks the write as ours for the watcher.
   */
  async function applyWrite(resolved: ResolvedPath, bytes: Uint8Array | null, flags: { createOnly?: boolean }) {
    const target = join(realRoot, ...resolved.realPath.split("/"));
    const current = await readIfExists(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "EISDIR") throw new GalleyError("invalid", "That's a folder, not a file.", resolved.path);
      throw error;
    });

    if (bytes !== null && current && bytesEqual(current, bytes)) return false;
    if (bytes === null && !current) return false;
    await checkpoints.record(resolved.path, current);
    if (bytes === null) {
      await unlink(resolved.absolute);
    } else {
      try {
        await atomicWrite(target, bytes, flags);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new GalleyError("conflict", "A file with that name already exists.", resolved.path);
        }
        throw error;
      }
    }
    markSelfWrite(resolved.path, bytes);
    return true;
  }

  function refusal(path: string, mode: AgentMode): { resolved: ResolvedPath | null; reason: string | null } {
    let resolved: ResolvedPath;

    try {
      resolved = resolve(path);
    } catch (error) {
      return { resolved: null, reason: (error as Error).message };
    }
    const config = options.writable();
    const reason =
      writeRefusal(resolved.path, config, mode) ??
      (resolved.realPath !== resolved.path ? writeRefusal(resolved.realPath, config, mode) : null);

    return { resolved, reason };
  }

  /** The site's settings file, by its own name or through a link to it. */
  function touchesSettings(resolved: ResolvedPath): boolean {
    return isSiteSettingsPath(resolved.path) || isSiteSettingsPath(resolved.realPath);
  }

  /**
   * Every write and delete by path. Who may is decided here, where the bytes
   * go, whatever asked: build mode needs its level, and the settings file
   * needs the settings level in any mode (only saveConfig's own checked
   * write goes round this, as a system write).
   */
  function guard(path: string, mode: AgentMode): ResolvedPath {
    if (mode === "build") requireBuildMode();
    const { resolved, reason } = refusal(path, mode);

    if (!resolved || reason) {
      if (!resolved) resolve(path); // rethrows the containment error with its detail
      throw new GalleyError("forbidden", reason ?? "That file can't be changed.", path);
    }
    if (touchesSettings(resolved)) requireSiteSettings();
    return resolved;
  }

  /** Containment and the hard deny-list only — for `system` writes. */
  function guardSystem(path: string): ResolvedPath {
    const resolved = resolve(path);
    const denied = deniedReason(resolved.path, "build") ?? deniedReason(resolved.realPath, "build");

    if (denied) throw new GalleyError("forbidden", denied, path);
    return resolved;
  }

  async function checkBaseHash(resolved: ResolvedPath, baseHash: string | undefined) {
    if (!baseHash) return;
    const current = await readIfExists(join(realRoot, ...resolved.realPath.split("/")));

    if (!current) {
      throw new GalleyError("conflict", "This file was removed since you opened it. Reopen it to see the latest version.", resolved.path);
    }
    if (hashContent(current) !== baseHash) {
      throw new GalleyError(
        "conflict",
        "This file changed since you opened it, so your edit wasn't saved. Reopen it to get the latest version, then make your change again.",
        resolved.path
      );
    }
  }

  async function gitIdentity(scope: "--local" | "--global"): Promise<publishing.Identity> {
    const [name = "", email = ""] = await Promise.all(
      ["user.name", "user.email"].map(async (key) =>
        (await repo.run(["config", scope, "--get", key], { allowFailure: true, readOnly: true })).text.trim()
      )
    );

    return { name, email };
  }

  async function identity(): Promise<ChosenAuthor> {
    const person = currentAccountAuthor();

    if (person) return { ...person, from: "account" };
    const layers = options.authorLayers?.();

    if (layers) {
      const [repository, machine] = await Promise.all([gitIdentity("--local"), gitIdentity("--global")]);

      return chooseAuthor({ site: layers.site ?? null, repository, app: layers.app ?? null, machine });
    }
    const configured = options.author?.();

    if (configured?.name?.trim() && configured.email?.trim()) return { ...configured, from: "app" };
    const [repository, machine] = await Promise.all([gitIdentity("--local"), gitIdentity("--global")]);

    return chooseAuthor({ repository, machine });
  }

  /** Which of these paths exist at HEAD — one `cat-file --batch-check` for all of them. */
  async function inHead(repoInfo: RepoInfo, paths: string[]): Promise<Set<string>> {
    const present = new Set<string>();

    if (!(await repo.head())) return present;
    const simple = paths.filter((p) => !p.includes("\n"));

    for (const path of paths.filter((p) => p.includes("\n"))) {
      if (await readBaseBlob(repo, repoInfo, path)) present.add(path);
    }
    if (simple.length === 0) return present;
    const result = await repo.run(["cat-file", "--batch-check"], {
      input: simple.map((p) => `HEAD:${repoInfo.prefix}${p}\n`).join(""),
      readOnly: true,
    });
    const lines = result.text.split("\n");

    simple.forEach((path, index) => {
      if (!/ missing$/.test(lines[index] ?? " missing")) present.add(path);
    });
    return present;
  }

  async function restoreToHead(paths: string[]): Promise<string[]> {
    const repoInfo = await info();

    if (!repoInfo || paths.length === 0) return [];
    return quietGit(async () => {
      const tracked = await inHead(repoInfo, paths);
      const restore = paths.filter((p) => tracked.has(p));
      const remove = paths.filter((p) => !tracked.has(p));

      for (let i = 0; i < restore.length; i += 200) {
        await repo.run(["restore", "--source=HEAD", "--staged", "--worktree", "--", ...restore.slice(i, i + 200)]);
      }
      for (let i = 0; i < remove.length; i += 200) {
        await repo.run(["rm", "--cached", "-r", "-q", "--ignore-unmatch", "--", ...remove.slice(i, i + 200)], {
          allowFailure: true,
        });
      }
      for (const path of remove) {
        const resolved = resolve(path);
        const kind = await lstat(resolved.absolute).catch(() => null);

        if (kind && !kind.isDirectory()) await unlink(resolved.absolute);
      }
      for (const path of paths) markSelfWrite(path, await readIfExists(absoluteOf(path)).catch(() => null));
      return paths;
    });
  }

  const host: publishing.RepoHost = {
    root,
    repo,
    info,
    statuses: () => refreshStatus(),
    identity,
    changed,
    restoreToHead,
  };

  async function onBatch(batch: WatchBatch) {
    if (disposed) return;
    const now = Date.now();
    const gitExternal = batch.git && gitBusy === 0 && now > gitQuietUntil;
    const external: string[] = [];

    for (const path of batch.paths) {
      const mark = selfWrites.get(path);
      const absolute = absoluteOf(path);
      const kind = await lstat(absolute).catch(() => null);

      if (kind?.isDirectory()) continue;
      if (mark && now - mark.at < SELF_WRITE_WINDOW_MS) {
        const current = kind ? await readIfExists(absolute).catch(() => null) : null;

        if ((current ? hashContent(current) : null) === mark.hash) continue;
      }
      external.push(path);
    }
    if (external.length === 0 && !gitExternal && !batch.unknown) return;
    const before = new Map(statusCache);

    try {
      await refreshStatus(gitExternal || batch.unknown ? undefined : external);
    } catch {
      return; // A transient git failure (an external index.lock) — the next event retries.
    }
    const paths = new Set(external);

    for (const key of new Set([...before.keys(), ...statusCache.keys()])) {
      if (before.get(key) !== statusCache.get(key)) paths.add(key);
    }
    emit([...paths], "external");
  }

  await refreshStatus().catch(() => undefined);
  if (options.watch !== false) {
    const repoInfo = await info();

    watcher = watchTree({ root, gitDir: repoInfo?.gitDir ?? null, onBatch: (batch) => void onBatch(batch) });
  }

  const workspace: Workspace = {
    root,

    resolvePath(path) {
      return resolve(path).absolute;
    },

    async exists(path) {
      const resolved = resolve(path);

      return (await lstat(resolved.absolute).catch(() => null)) !== null;
    },

    async readBytes(path) {
      const resolved = resolve(path);

      try {
        return new Uint8Array(await readFile(resolved.absolute));
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;

        if (code === "ENOENT" || code === "ENOTDIR") throw new GalleyError("not-found", "That file doesn't exist.", resolved.path);
        if (code === "EISDIR") throw new GalleyError("invalid", "That's a folder, not a file.", resolved.path);
        throw error;
      }
    },

    async readText(path) {
      return Buffer.from(await workspace.readBytes(path)).toString("utf8");
    },

    async stat(path) {
      const resolved = resolve(path);
      const result = await stat(resolved.absolute).catch(() => null);

      return result ? { size: result.size, mtimeMs: result.mtimeMs } : null;
    },

    async grepText(pattern, grepOptions) {
      const repoInfo = await info();

      if (!repoInfo) {
        if (grepOptions.rev === "base") return [];
        const expression = new RegExp(pattern, "g");
        const out: Array<{ path: string; match: string }> = [];

        for (const path of (await listWithoutGit(root)).filter((p) => !p.split("/").includes("node_modules"))) {
          const bytes = await readFile(join(root, path)).catch(() => null);

          if (!bytes || bytes.byteLength > 4 * 1024 * 1024 || bytes.includes(0)) continue;
          for (const match of bytes.toString("utf8").matchAll(expression)) out.push({ path, match: match[0] });
        }
        return out;
      }
      if (grepOptions.rev === "base" && !(await repo.head())) return [];
      const args = ["grep", "-I", "-o", "-z", "--no-color", "-E", "-e", pattern, ...(grepOptions.rev === "base" ? ["HEAD"] : ["--untracked"]), "--", "."];
      const result = await repo.run(args, { readOnly: true, allowFailure: true });
      const out: Array<{ path: string; match: string }> = [];

      // Exit 1 is "no match"; anything else is a real failure.
      if (result.code !== 0 && result.code !== 1) throw new GalleyError("internal", "Couldn't search the site's files.", result.stderr?.slice(0, 300));
      for (const line of result.text.split("\n")) {
        const at = line.indexOf("\0");

        if (at === -1) continue;
        const file = line.slice(0, at).replace(/^HEAD:/, "");
        const match = line.slice(at + 1);

        if (match && !file.split("/").includes("node_modules")) out.push({ path: file, match });
      }
      return out;
    },

    async listFiles(listOptions = {}) {
      const repoInfo = await info();
      let files: string[];

      if (repoInfo) {
        const [all, deleted] = await Promise.all([
          repo.run(["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "."], { readOnly: true }),
          repo.run(["ls-files", "-z", "--deleted", "--", "."], { readOnly: true }),
        ]);
        const gone = new Set(splitNul(deleted.text));

        files = [...new Set(splitNul(all.text))].filter((p) => !gone.has(p));
      } else {
        files = await listWithoutGit(root);
      }
      // A repo that forgot to ignore node_modules would otherwise list every installed file.
      files = files.filter((p) => !isTempFile(p) && !p.split("/").includes("node_modules"));
      if (listOptions.glob) {
        const match = picomatch(listOptions.glob, { dot: true });

        files = files.filter((p) => match(p));
      }
      files.sort();
      return listOptions.limit !== undefined ? files.slice(0, Math.max(0, listOptions.limit)) : files;
    },

    async writeFile(path, content, writeOptions) {
      const resolved = writeOptions.system ? guardSystem(path) : guard(path, writeOptions.mode);

      return lock(async () => {
        await checkBaseHash(resolved, writeOptions.baseHash);
        const wrote = await applyWrite(resolved, toBytes(content), { createOnly: writeOptions.createOnly });

        if (wrote) await changed([resolved.path], writeOptions.origin);
      });
    },

    async deleteFile(path, writeOptions) {
      const resolved = guard(path, writeOptions.mode);

      return lock(async () => {
        const kind = await lstat(resolved.absolute).catch(() => null);

        if (!kind) throw new GalleyError("not-found", "That file doesn't exist.", resolved.path);
        if (kind.isDirectory()) throw new GalleyError("invalid", "That's a folder, not a file.", resolved.path);
        await checkBaseHash(resolved, writeOptions.baseHash);
        await applyWrite(resolved, null, {});
        await changed([resolved.path], writeOptions.origin);
      });
    },

    canWrite(path, mode) {
      const { resolved, reason } = refusal(path, mode);

      if (!resolved || reason) return { ok: false, reason: reason ?? "That file can't be changed." };
      return { ok: true };
    },

    statusOf(path) {
      try {
        return statusCache.get(normalizeRepoPath(path)) ?? "clean";
      } catch {
        return "clean";
      }
    },

    pendingPaths() {
      return [...statusCache.keys()].sort();
    },

    async changes(enrich) {
      const repoInfo = await info();

      if (!repoInfo) return { branch: "", baseCommit: null, files: [], totals: { files: 0, additions: 0, deletions: 0 } };
      const statuses = await refreshStatus();
      const context = await changeContext(repoInfo);

      return buildChangeSet(context, new Map(statuses), enrich);
    },

    async diff(path) {
      const resolved = resolve(path);
      const repoInfo = await info();

      if (!repoInfo) {
        throw new GalleyError("invalid", "This folder isn't under version control, so there's no earlier version to compare with.");
      }
      return buildDiff(await changeContext(repoInfo), resolved.path);
    },

    async readBase(path) {
      const resolved = resolve(path);
      const repoInfo = await info();

      if (!repoInfo || !(await repo.head())) return null;
      const bytes = await readBaseBlob(repo, repoInfo, resolved.path);

      return bytes ? new Uint8Array(bytes) : null;
    },

    async discard(paths) {
      const repoInfo = await info();

      if (!repoInfo) {
        throw new GalleyError("invalid", "This folder isn't under version control, so there's no saved version to go back to. Nothing was changed.");
      }
      return lock(async () => {
        const statuses = await refreshStatus();
        const wanted = paths ? [...new Set(paths.map((p) => normalizeRepoPath(p)))] : [...statuses.keys()];
        // Secrets, installed packages and tool folders are never touched, even by discard.
        const targets = wanted.filter((p) => statuses.has(p) && deniedReason(p, "build") === null).sort();

        if (targets.length === 0) return [];
        // Discarding a pending change to the settings file changes the file back: the same level as changing it.
        if (targets.some(isSiteSettingsPath)) requireSiteSettings();
        await restoreToHead(targets);
        await changed(targets, "discard");
        return targets;
      });
    },

    publish(request, config, describe) {
      return lock(() => quietGit(() => publishing.publish(host, request, config, describe)));
    },

    history(limit) {
      return publishing.history(host, limit);
    },

    revert(commit, config) {
      return lock(() => quietGit(() => publishing.revert(host, commit, config)));
    },

    send(config) {
      return lock(() => quietGit(() => publishing.send(host, config)));
    },

    gitStatus() {
      return publishing.gitStatus(host);
    },

    pull() {
      return lock(() => quietGit(() => publishing.pull(host)));
    },

    checkpoint(label) {
      return checkpoints.open(label);
    },

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async dispose() {
      disposed = true;
      watcher?.close();
      watcher = null;
      listeners.clear();
      await checkpoints.dispose();
    },
  };

  async function changeContext(repoInfo: RepoInfo): Promise<ChangeContext> {
    const [branch, head] = await Promise.all([repo.currentBranch(), repo.head()]);

    return { root, repo, info: repoInfo, branch: branch ?? "HEAD", head };
  }

  return workspace;
}
