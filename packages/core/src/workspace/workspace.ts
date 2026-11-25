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
  CatchUpResult,
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
import { SITE_CLOSED } from "./closed";
import { CheckpointManager, type WorkspaceCheckpoint } from "./checkpoint";
import { atomicWrite, bytesEqual, hashContent, isTempFile, listWithoutGit, readIfExists, toBytes } from "./files";
import { git as createGit, splitNul, type Git, type RepoInfo } from "./git";
import { resolveContained, type ResolvedPath, normalizeRepoPath } from "./paths";
import { deniedReason, mayBeShown, writeRefusal } from "./policy";
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
  /**
   * The repo-relative path the bytes of a write to `path` would reach, through
   * any link on the way (for a file not there yet, its folder's real place).
   * Throws, as a write would, for a path that leaves the site.
   */
  realPathOf(path: string): string;
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
  /**
   * Ask the code host what is new, changing no file (publishing.look). Saves
   * never wait for it: it runs outside the save lock, and everyone who asks
   * while a look is going shares that one.
   */
  check(): Promise<GitStatus>;
  pull(): Promise<GitStatus>;
  /** Get latest, saying what came in. `around` runs on either side of files changing, and only when something is to come in. */
  getLatest(around?: publishing.AroundBringIn): Promise<CatchUpResult>;
  /**
   * Look, and bring newer versions in when nothing is in the way
   * (publishing.catchUp). null when a write, a publish or Get latest is in
   * progress or waiting, before the look or after it: it never queues
   * behind them, and it holds the save lock only while files change.
   */
  catchUp(around?: publishing.AroundBringIn): Promise<CatchUpResult | null>;
  checkpoint(label: string): WorkspaceCheckpoint;
  /** Whether a checkpoint here is an Undo its holder still offers, so the site isn't closed for lack of use (checkpoint.ts `offer`). */
  undoOffered(): boolean;
  /** Lets go of checkpoints nobody offers as an Undo, closed longer ago than `maxAgeMs`. */
  letGoOfStaleCheckpoints(maxAgeMs: number, now?: number): Promise<void>;
  onChange(listener: (paths: string[], origin: ChangeOrigin) => void): () => void;
  /**
   * Closes it for writing at once (SITE_CLOSED): no file write of its own
   * reaches the disk from now on, no checkpoint is opened or put back, and
   * work still waiting for the save lock or its turn among git work doesn't
   * start. Git work already running ends (`dispose` waits for it).
   * Synchronous, so a site can close it before anything else it awaits while
   * closing.
   */
  close(): void;
  /** Closes it (`close`), waits for the work already running to end, then lets go of its watcher and checkpoints. */
  dispose(): Promise<void>;
}

/** Said when a write carries the hash of the text it was made from and the file is no longer that text. */
export const CHANGED_SINCE_OPENED =
  "This file changed since you opened it, so your edit wasn't saved. Reopen it to get the latest version, then make your change again.";

/** Used when neither the app settings nor git config name the author. */
export const NEUTRAL_AUTHOR = { name: "Site editor", email: "site-editor@localhost" } as const;

/** How long after our own write an identical-looking filesystem event is treated as ours. */
const SELF_WRITE_WINDOW_MS = 5_000;
/** Git metadata events this soon after our own git command are ours. */
const GIT_QUIET_MS = 750;

/** A promise-chain mutex: one write or git mutation at a time. `busy()`: something holds it or waits for it. */
function createLock() {
  let tail: Promise<unknown> = Promise.resolve();
  let held = 0;
  const lock = <T>(task: () => Promise<T>): Promise<T> => {
    held += 1;
    const run = tail.then(task, task).finally(() => {
      held -= 1;
    });

    tail = run.catch(() => undefined);
    return run;
  };

  return Object.assign(lock, { busy: () => held > 0 });
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
  const saveLock = createLock();
  /** Closed for writing (`close`): set at the first moment of closing, before anything is awaited. */
  let closedForWrites = false;
  /** Work that was waiting its turn when the site closed doesn't start: the site open now is another, with its own locks. */
  const refusingOnceClosed = (inner: ReturnType<typeof createLock>) =>
    Object.assign(<T>(task: () => Promise<T>): Promise<T> => inner(() => (closedForWrites ? Promise.reject(new GalleyError("forbidden", SITE_CLOSED)) : task())), { busy: inner.busy });
  const lock = refusingOnceClosed(saveLock);
  /**
   * Everything that talks to the code host or moves this copy between
   * versions, one at a time: a look, a publish, an undo, a send, Get latest,
   * a round. They share git's record of what the code host has, so two at
   * once could leave it older than it is. Taken before the save lock, never
   * after it. A look takes this one only, so a look never holds up a save,
   * however slow the code host is to answer. Publishing, undoing a publish
   * and sending are another matter: they hold the save lock from start to
   * finish, sending to the code host included (GIT_NETWORK_TIMEOUT_MS at
   * most), because what is published and what is still pending have to
   * change together.
   */
  const turnLock = createLock();
  const turn = refusingOnceClosed(turnLock);
  /** Publishing, undoing, sending and Get latest that are in progress or waiting for their turn: a round never runs beside them. */
  let wanted = 0;
  /** The look in progress, shared by everyone who asks while it is going. */
  let looking: Promise<publishing.Look | null> | null = null;
  let gitBusy = 0;
  let gitQuietUntil = 0;
  /** When the code host last answered a look, and why the newest look failed (null: it didn't). Kept for this run of the app only. */
  const looks: { at: string | null; problem: string | null } = { at: null, problem: null };
  let watcher: TreeWatcher | null = null;
  let disposed = false;

  const resolve = (path: string): ResolvedPath => resolveContained(root, realRoot, path);
  /**
   * For a read. Whether a file may be shown by its name is asked at each way out of the engine, which reads any
   * file of the site for itself. Where a link leads can't be asked there: nobody who looks at the name asked for
   * can see it. So it is asked here, once: a path that only reaches a secrets file, or the version history's own
   * folder, through a link is refused, whatever the link is called.
   */
  const resolveRead = (path: string): ResolvedPath => {
    const resolved = resolve(path);

    if (resolved.realPath !== resolved.path && !mayBeShown(resolved.realPath)) throw new GalleyError("forbidden", "That file can't be shown here.", resolved.path);
    return resolved;
  };
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

  const heard = (look: publishing.Look) => {
    if (look.ok) {
      looks.at = new Date().toISOString();
      looks.problem = null;
    } else looks.problem = look.problem;
  };

  /** The status with what is known about the last look: when it worked, and why the newest one didn't. Nothing to say without a remote. */
  const withLooks = (status: GitStatus): GitStatus =>
    status.hasRemote ? { ...status, checkedAt: looks.at, ...(looks.problem ? { checkProblem: looks.problem } : {}) } : status;

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

  /** A person's git action: its turn among the others, then the save lock for as long as it runs. */
  function gitAction<T>(task: () => Promise<T>): Promise<T> {
    wanted += 1;
    return turn(task).finally(() => {
      wanted -= 1;
    });
  }

  /** One look at the code host, with no save lock held. Whoever asks while it is going gets the same look. */
  function sharedLook(): Promise<publishing.Look | null> {
    looking ??= turn(() => quietGit(() => publishing.look(host)))
      .then((look) => {
        if (look) heard(look);
        return look;
      })
      .finally(() => {
        looking = null;
      });
    return looking;
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
    restoreFiles: async (files) => {
      const targets = files.map((file) => {
        // Undo bypasses the mode (the turn may have run in build mode) but never
        // containment or the hard deny-list.
        const resolved = resolve(file.path);
        const denied = deniedReason(resolved.path, "build") ?? deniedReason(resolved.realPath, "build");

        if (denied) throw new GalleyError("forbidden", denied, file.path);
        // Putting the settings file back is changing it, whoever's turn changed it first.
        if (touchesSettings(resolved)) requireSiteSettings();
        return { ...file, resolved, absolute: join(realRoot, ...resolved.realPath.split("/")) };
      });

      return lock(async () => {
        const held: Array<{ target: (typeof targets)[number]; current: Uint8Array | null }> = [];

        // Asked here, with the writes: a save that was waiting its turn ahead of this undo has landed by now.
        for (const target of targets) {
          const current = await readIfExists(target.absolute);

          if (!target.unchanged(current)) return [];
          held.push({ target, current });
        }
        // A file put back before one taken away: when the second step fails, a moved page is there twice for a moment, never gone.
        held.sort((a, b) => Number(a.target.bytes === null) - Number(b.target.bytes === null));
        const done: typeof held = [];

        try {
          for (const step of held) {
            await applyWrite(step.target.resolved, step.target.bytes, {});
            done.push(step);
          }
        } catch {
          // Together or not at all: what was already put back goes to what it held a moment ago. Whatever can't is reported as put back, because it is.
          const stuck: string[] = [];

          for (const step of done.reverse()) await applyWrite(step.target.resolved, step.current, {}).catch(() => stuck.push(step.target.path));
          return stuck;
        }
        return held.map((step) => step.target.path);
      });
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
          // A path that no longer resolves is refused when it is put back; here only its name counts.
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
    // A write still on its way when the site closed (or asked of one somebody kept) lands nowhere: the site open next is
    // another, with its own locks, and two writers of one file would each answer "saved" while one edit disappeared.
    if (closedForWrites) throw new GalleyError("forbidden", SITE_CLOSED, resolved.path);
    const target = join(realRoot, ...resolved.realPath.split("/"));
    const current = await readIfExists(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "EISDIR") throw new GalleyError("invalid", "That's a folder, not a file.", resolved.path);
      throw error;
    });

    if (bytes !== null && current && bytesEqual(current, bytes)) return false;
    if (bytes === null && !current) return false;
    await checkpoints.record(resolved.path, current, bytes);
    // Asked again with the bytes in hand: the site may have closed while this write read the file.
    if (closedForWrites) throw new GalleyError("forbidden", SITE_CLOSED, resolved.path);
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
    if (hashContent(current) !== baseHash) throw new GalleyError("conflict", CHANGED_SINCE_OPENED, resolved.path);
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
      return resolveRead(path).absolute;
    },

    realPathOf(path) {
      return resolve(path).realPath;
    },

    async exists(path) {
      const resolved = resolve(path);

      return (await lstat(resolved.absolute).catch(() => null)) !== null;
    },

    async readBytes(path) {
      const resolved = resolveRead(path);

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
      const resolved = resolveRead(path);
      const repoInfo = await info();

      if (!repoInfo) {
        throw new GalleyError("invalid", "This folder isn't under version control, so there's no earlier version to compare with.");
      }
      return buildDiff(await changeContext(repoInfo), resolved.path);
    },

    async readBase(path) {
      const resolved = resolveRead(path);
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
      return gitAction(() => lock(() => quietGit(() => publishing.publish(host, request, config, describe))));
    },

    history(limit) {
      return publishing.history(host, limit);
    },

    revert(commit, config) {
      return gitAction(() => lock(() => quietGit(() => publishing.revert(host, commit, config))));
    },

    send(config) {
      return gitAction(() => lock(() => quietGit(() => publishing.send(host, config))));
    },

    async gitStatus() {
      return withLooks(await publishing.gitStatus(host));
    },

    async check() {
      await sharedLook();
      // What the look found is read under the save lock, as it always was: reading the files' state is quick, and no save is then half-counted.
      return withLooks(await lock(() => publishing.gitStatus(host)));
    },

    async pull() {
      return (await workspace.getLatest()).status;
    },

    getLatest(around) {
      return gitAction(async () => {
        // What can be refused without the code host is refused before it is asked.
        await publishing.bringInSource(host);
        // A look of its own, begun after the person asked: one already going may have asked the code host before the newest version was there.
        const looked = await quietGit(() => publishing.look(host));

        if (looked) heard(looked);
        return lock(() =>
          quietGit(async () => {
            const result = await publishing.pull(host, looked, around ? { around } : {});

            return { ...result, status: withLooks(result.status) };
          })
        );
      });
    },

    async catchUp(around) {
      const inTheWay = () => lock.busy() || wanted > 0;
      /** The files' state, read under the save lock like a look's — or null when a save or a publish has begun by then. */
      const statusNow = async (): Promise<GitStatus | null> => (inTheWay() ? null : lock(() => publishing.gitStatus(host)));
      const nothing = (status: GitStatus | null): CatchUpResult | null => (status ? { brought: 0, paths: [], status: withLooks(status) } : null);

      if (inTheWay()) return null;
      if (!(await publishing.canKeepUp(host))) return nothing(await statusNow());
      const looked = await sharedLook();
      const status = await statusNow();

      // Nothing to bring in, or it can't come in: said from here, with no turn taken and nothing held.
      if (!status || !looked?.ok || status.behind === 0 || status.inTheWay) return nothing(status);
      return turn(async () => {
        // Its turn may have come after another look; a save or a publish that began meanwhile goes first, and the next round tries again.
        if (inTheWay()) return null;
        return lock(() =>
          quietGit(async () => {
            const result = await publishing.catchUp(host, around ? { around } : {});

            return { ...result, status: withLooks(result.status) };
          })
        );
      });
    },

    checkpoint(label) {
      if (closedForWrites) throw new GalleyError("forbidden", SITE_CLOSED);
      return checkpoints.open(label);
    },

    undoOffered() {
      return !closedForWrites && checkpoints.undoOffered();
    },

    letGoOfStaleCheckpoints(maxAgeMs, now) {
      return checkpoints.letGoOfStale(maxAgeMs, now);
    },

    close() {
      closedForWrites = true;
      // Undo refuses from this moment, as it will once the site has gone: nothing it would put back could land now.
      checkpoints.close();
    },

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async dispose() {
      closedForWrites = true;
      // What was already running ends first (what was waiting is refused): once this resolves, nothing more lands.
      await Promise.all([saveLock(async () => undefined), turnLock(async () => undefined)]);
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
