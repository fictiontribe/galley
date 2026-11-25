/**
 * Checkpoints: undo for one assistant turn without touching anyone's other
 * pending edits.
 *
 * A checkpoint records only its own work: what runs inside `run()`, and
 * whatever that starts. The first of its own writes to each path records
 * what the file was before (its bytes, or that it did not exist). A write
 * made by anything else — another person's save, another turn — is never
 * recorded, even to a path the checkpoint already holds.
 *
 * `restore()` puts back only the files still as the checkpoint's own work
 * left them. A file someone else has changed since stays as it is, and
 * `left()` names it: putting the whole file back would take their work with
 * it. So does a file the checkpoint's own work wrote after it was closed (a
 * write that was still waiting its turn when the reply ended): nobody was
 * told the reply changed it, so it is named rather than quietly put back.
 *
 * A page the work moved — one file gone, another made that is the same or,
 * for a page long enough to tell, much the same — goes back as a pair or
 * stays as a pair, so an undo never leaves the page twice.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { PRODUCT } from "../brand";
import { GalleyError } from "../errors";
import type { Checkpoint } from "../types";
import { bytesEqual, hashContent, isBinary } from "./files";

/** Pre-images above this size are kept in a temp file instead of memory. */
export const SPILL_BYTES = 5 * 1024 * 1024;
/** Text above this size is never compared line by line to tell whether a page was moved. */
const PRINT_BYTES = 512 * 1024;
/** How alike two files must be (lines in common over lines in either) to be one page that moved. */
const MOVED_ALIKE = 0.6;
/**
 * And how many lines they must have in common at the least. Short pages
 * share most of their few lines with any other page of their kind (the
 * fences, a layout, a draft flag): likeness says nothing there, so they are
 * a pair only when they are the same byte for byte.
 */
const MOVED_SHARED_LINES = 8;

type PreImage = { kind: "absent" } | { kind: "memory"; bytes: Uint8Array } | { kind: "spilled"; file: string };

/** What a file holds, to compare by: its hash, or null when there is no file. */
type Mark = string | null;

const markOf = (bytes: Uint8Array | null): Mark => (bytes === null ? null : hashContent(bytes));

/** A text file's lines, to tell how alike two files are. Null: not text, too large, or nothing in it. */
type Print = Set<string> | null;

function printOf(bytes: Uint8Array | null): Print {
  if (bytes === null || bytes.length === 0 || bytes.length > PRINT_BYTES || isBinary(bytes)) return null;
  const lines = new Set<string>();

  for (const line of Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).toString("utf8").split("\n")) {
    const text = line.trim();

    if (text) lines.add(text);
  }
  return lines.size ? lines : null;
}

function alike(a: Print, b: Print): number {
  if (!a || !b) return 0;
  let shared = 0;

  for (const line of a) if (b.has(line)) shared += 1;
  return shared < MOVED_SHARED_LINES ? 0 : shared / (a.size + b.size - shared);
}

interface Recorded {
  before: PreImage;
  /** What this checkpoint's own work last wrote there. */
  wrote: Mark;
  /** Someone else changed the file between two of this checkpoint's own writes: their work is in it now. */
  mixed: boolean;
  /** For a file this work made: the lines it last wrote, to recognise a page that was moved. */
  made: Print;
}

/** One file to put back: its bytes (null: remove it), and whether what it holds now is still this work's. */
export interface RestoreFile {
  path: string;
  bytes: Uint8Array | null;
  unchanged(current: Uint8Array | null): boolean;
}

export interface CheckpointHost {
  /**
   * Put these files back together (bytes) or remove them (null), bypassing
   * mode checks but not containment — only when `unchanged` says yes for
   * every one of them, asked at the moment of writing. Resolves the paths
   * put back: all of them, none when one had changed, or the ones written
   * before a write failed.
   */
  restoreFiles(files: RestoreFile[]): Promise<string[]>;
  /** Tell listeners once, after a restore. */
  emitUndo(paths: string[]): Promise<void> | void;
  /** Refuses (throws) a restore of these paths before any of them is put back, so an undo is never left half done. */
  allowRestore?(paths: string[]): void;
}

/** A Checkpoint plus `release()`, which frees its pre-images once undo is no longer offered. */
export interface WorkspaceCheckpoint extends Checkpoint {
  readonly label: string;
  /** Free the recorded pre-images (and any temp files). Restore is no longer possible afterwards. */
  release(): Promise<void>;
}

/**
 * Said when something is asked to undo with a checkpoint whose site was
 * closed under it. What a checkpoint keeps is let go when its site is closed
 * (one nobody has used for a while, or one that was removed), so there is
 * nothing left to put back: answering "nothing was restored" as if the undo
 * had been done would be untrue.
 */
export const UNDO_LOST = "That can't be undone from here any more: the site was closed after a while without use, and what Undo keeps was let go with it. You can still discard the changes in Proof.";

class CheckpointImpl implements WorkspaceCheckpoint {
  readonly id = randomUUID();
  readonly records = new Map<string, Recorded>();
  open = true;
  released = false;
  /** Its site was closed under it: what it kept is gone, though whoever holds it never let it go. */
  lost = false;
  private spillDir: string | null = null;
  private leftBehind: string[] = [];
  /** Paths its own work wrote after it was closed. */
  private readonly late = new Set<string>();

  constructor(
    readonly label: string,
    readonly manager: CheckpointManager
  ) {}

  paths(): string[] {
    return [...this.records.keys()];
  }

  run<T>(work: () => T): T {
    return this.manager.within(this, work);
  }

  left(): string[] {
    return [...this.leftBehind];
  }

  close(): void {
    // No more pre-images are taken; the ones held stay so the turn can still be undone later.
    this.open = false;
  }

  async record(path: string, before: Uint8Array | null, after: Uint8Array | null): Promise<void> {
    if (this.released) return;
    if (!this.open) {
      this.late.add(path);
      return;
    }
    const known = this.records.get(path);

    if (known) {
      if (markOf(before) !== known.wrote) known.mixed = true;
      known.wrote = markOf(after);
      if (known.before.kind === "absent") known.made = printOf(after);
      return;
    }
    this.records.set(path, { before: await this.keep(before), wrote: markOf(after), mixed: false, made: before === null ? printOf(after) : null });
  }

  private async keep(before: Uint8Array | null): Promise<PreImage> {
    if (before === null) return { kind: "absent" };
    if (before.length <= SPILL_BYTES) return { kind: "memory", bytes: before };
    const file = join(await this.ensureSpillDir(), `${randomUUID()}.bin`);

    await writeFile(file, before);
    return { kind: "spilled", file };
  }

  private async ensureSpillDir(): Promise<string> {
    this.spillDir ??= await mkdtemp(join(tmpdir(), `${PRODUCT.slug}-checkpoint-`));
    return this.spillDir;
  }

  /**
   * The files this work removed, each with the file it made that is the same
   * page under another name: the same bytes, or text much the same where
   * there is enough of it to tell. One made file answers for one removed
   * file, the likeliest first. Not taken for a pair, the two are put back
   * each on its own: the removed one returns whatever became of the other.
   */
  private moved(files: Map<string, RestoreFile>): Map<string, string> {
    const pairs = new Map<string, string>();
    const made = [...this.records].filter(([path, record]) => files.has(path) && record.before.kind === "absent" && record.wrote !== null);
    const candidates: Array<{ gone: string; made: string; score: number }> = [];

    for (const [gone, record] of this.records) {
      const was = files.get(gone)?.bytes;

      if (!was || record.wrote !== null) continue;
      const mark = markOf(was);
      const print = printOf(was);

      for (const [path, other] of made) {
        if (extname(path) !== extname(gone)) continue;
        const score = other.wrote === mark ? 1 : alike(print, other.made);

        if (score >= MOVED_ALIKE) candidates.push({ gone, made: path, score });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    for (const { gone, made: path } of candidates) {
      if (pairs.has(gone) || pairs.has(path)) continue;
      pairs.set(gone, path);
      pairs.set(path, gone);
    }
    return pairs;
  }

  async restore(): Promise<string[]> {
    if (this.lost) throw new GalleyError("not-found", UNDO_LOST);
    if (this.released) return [];
    this.close();
    const restored: string[] = [];
    const left = new Set<string>();
    const files = new Map<string, RestoreFile>();

    this.manager.host.allowRestore?.([...this.records.keys()]);
    for (const [path, { before, wrote, mixed }] of this.records) {
      let bytes: Uint8Array | null;

      try {
        bytes = before.kind === "absent" ? null : before.kind === "memory" ? before.bytes : new Uint8Array(await readFile(before.file));
      } catch {
        // What the file was can't be read any more: it stays as it is, and is named.
        left.add(path);
        continue;
      }
      // Already as it was counts as put back. Otherwise the file must hold exactly what this checkpoint's work left there.
      const unchanged = (current: Uint8Array | null) =>
        (current === null || bytes === null ? current === bytes : bytesEqual(current, bytes)) || (!mixed && markOf(current) === wrote);

      files.set(path, { path, bytes, unchanged });
    }
    const pairs = this.moved(files);
    const taken = new Set<string>();

    for (const [path, file] of files) {
      if (taken.has(path)) continue;
      const other = pairs.get(path);
      const group = other ? [file, files.get(other)!] : [file];
      let put: string[] = [];

      for (const member of group) taken.add(member.path);
      try {
        put = await this.manager.host.restoreFiles(group);
      } catch {
        // Refused or failed before anything was written: these stay as they are.
      }
      for (const member of group) {
        if (put.includes(member.path)) restored.push(member.path);
        else left.add(member.path);
      }
    }
    // Written by this work after the reply ended: still there unless it was put back above.
    for (const path of this.late) if (!restored.includes(path)) left.add(path);
    this.leftBehind = [...left];
    if (restored.length > 0) await this.manager.host.emitUndo(restored);
    return restored;
  }

  async release(): Promise<void> {
    this.close();
    this.released = true;
    this.records.clear();
    this.late.clear();
    this.manager.forget(this);
    if (this.spillDir) await rm(this.spillDir, { recursive: true, force: true });
    this.spillDir = null;
  }
}

/** The checkpoints whose `run()` the work in progress is inside, innermost first. */
interface Inside {
  checkpoint: CheckpointImpl;
  outer: Inside | undefined;
}

/**
 * Whose work a write is part of, carried through whatever that work starts
 * the way the caller's access and the publishing name are — so nothing has
 * to hand a checkpoint down to every write, and a write that is nobody's
 * turn is recorded by nobody. One for every workspace: what leaves it
 * (`outsideAnyCheckpoint`) leaves it everywhere.
 */
const scope = new AsyncLocalStorage<Inside | undefined>();

/**
 * Runs `run` as no checkpoint's work. For what is made once during a turn
 * and serves everyone after — an open site and its watcher, the preview — so
 * what it writes later is never taken for that turn's (install/caller.ts
 * `outsideAnyPerson` leaves this scope with the rest).
 */
export function outsideAnyCheckpoint<T>(run: () => T): T {
  return scope.run(undefined, run);
}

export class CheckpointManager {
  private readonly all = new Set<CheckpointImpl>();

  constructor(readonly host: CheckpointHost) {}

  open(label: string): WorkspaceCheckpoint {
    const checkpoint = new CheckpointImpl(label, this);

    this.all.add(checkpoint);
    return checkpoint;
  }

  /** Does `work` as `checkpoint`'s own, inside whatever checkpoints the caller's work is already part of. */
  within<T>(checkpoint: CheckpointImpl, work: () => T): T {
    return scope.run({ checkpoint, outer: scope.getStore() }, work);
  }

  /** This workspace's checkpoints the work in progress belongs to, innermost first: the open ones, and closed ones still held for an undo. */
  private *own(): Generator<CheckpointImpl, undefined> {
    for (let at = scope.getStore(); at; at = at.outer) if (at.checkpoint.manager === this && !at.checkpoint.released) yield at.checkpoint;
    return undefined;
  }

  /** Whether a checkpoint of the work in progress would record a first pre-image for this path. */
  wants(path: string): boolean {
    for (const checkpoint of this.own()) if (checkpoint.open && !checkpoint.records.has(path)) return true;
    return false;
  }

  /**
   * Called before every write, with what the file holds and what it is about
   * to hold (null: no file). Only the checkpoints of the work doing the
   * write record it; one that is closed already only notes the path.
   */
  async record(path: string, before: Uint8Array | null, after: Uint8Array | null): Promise<void> {
    for (const checkpoint of this.own()) await checkpoint.record(path, before, after);
  }

  forget(checkpoint: CheckpointImpl): void {
    this.all.delete(checkpoint);
  }

  async dispose(): Promise<void> {
    for (const checkpoint of [...this.all]) {
      // Let go by the site closing, not by whoever holds it: an undo asked of it later says so.
      checkpoint.lost = true;
      await checkpoint.release();
    }
  }
}
