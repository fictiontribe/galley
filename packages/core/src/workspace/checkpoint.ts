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
 * `left()` names it: putting the whole file back would take their work with it.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRODUCT } from "../brand";
import type { Checkpoint } from "../types";
import { bytesEqual, hashContent } from "./files";

/** Pre-images above this size are kept in a temp file instead of memory. */
export const SPILL_BYTES = 5 * 1024 * 1024;

type PreImage = { kind: "absent" } | { kind: "memory"; bytes: Uint8Array } | { kind: "spilled"; file: string };

/** What a file holds, to compare by: its hash, or null when there is no file. */
type Mark = string | null;

const markOf = (bytes: Uint8Array | null): Mark => (bytes === null ? null : hashContent(bytes));

interface Recorded {
  before: PreImage;
  /** What this checkpoint's own work last wrote there. */
  wrote: Mark;
  /** Someone else changed the file between two of this checkpoint's own writes: their work is in it now. */
  mixed: boolean;
}

export interface CheckpointHost {
  /**
   * Put a file back (bytes) or remove it (null), bypassing mode checks but not
   * containment — only when `unchanged` says yes to what the file holds at
   * the moment of writing (null: no file). Resolves whether it was put back.
   */
  restoreFile(path: string, bytes: Uint8Array | null, unchanged: (current: Uint8Array | null) => boolean): Promise<boolean>;
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

class CheckpointImpl implements WorkspaceCheckpoint {
  readonly id = randomUUID();
  readonly records = new Map<string, Recorded>();
  open = true;
  released = false;
  private spillDir: string | null = null;
  private leftBehind: string[] = [];

  constructor(
    readonly label: string,
    private readonly manager: CheckpointManager
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
    // Recording stops; the pre-images stay so the turn can still be undone later.
    this.open = false;
  }

  async record(path: string, before: Uint8Array | null, after: Uint8Array | null): Promise<void> {
    if (!this.open) return;
    const known = this.records.get(path);

    if (known) {
      if (markOf(before) !== known.wrote) known.mixed = true;
      known.wrote = markOf(after);
      return;
    }
    this.records.set(path, { before: await this.keep(before), wrote: markOf(after), mixed: false });
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

  async restore(): Promise<string[]> {
    if (this.released) return [];
    this.close();
    const restored: string[] = [];
    const left: string[] = [];

    this.manager.host.allowRestore?.([...this.records.keys()]);
    for (const [path, { before, wrote, mixed }] of this.records) {
      const bytes = before.kind === "absent" ? null : before.kind === "memory" ? before.bytes : new Uint8Array(await readFile(before.file));
      // Already as it was counts as put back. Otherwise the file must hold exactly what this checkpoint's work left there.
      const unchanged = (current: Uint8Array | null) =>
        (current === null || bytes === null ? current === bytes : bytesEqual(current, bytes)) || (!mixed && markOf(current) === wrote);

      if (await this.manager.host.restoreFile(path, bytes, unchanged)) restored.push(path);
      else left.push(path);
    }
    this.leftBehind = left;
    if (restored.length > 0) await this.manager.host.emitUndo(restored);
    return restored;
  }

  async release(): Promise<void> {
    this.close();
    this.released = true;
    this.records.clear();
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

export class CheckpointManager {
  private readonly all = new Set<CheckpointImpl>();
  /**
   * Whose work a write is part of, carried through whatever that work starts
   * the way the caller's access and the publishing name are — so nothing has
   * to hand a checkpoint down to every write, and a write that is nobody's
   * turn is recorded by nobody.
   */
  private readonly scope = new AsyncLocalStorage<Inside>();

  constructor(readonly host: CheckpointHost) {}

  open(label: string): WorkspaceCheckpoint {
    const checkpoint = new CheckpointImpl(label, this);

    this.all.add(checkpoint);
    return checkpoint;
  }

  /** Does `work` as `checkpoint`'s own, inside whatever checkpoints the caller's work is already part of. */
  within<T>(checkpoint: CheckpointImpl, work: () => T): T {
    return this.scope.run({ checkpoint, outer: this.scope.getStore() }, work);
  }

  /** The open checkpoints the work in progress belongs to, innermost first. */
  private *own(): Generator<CheckpointImpl, undefined> {
    for (let at = this.scope.getStore(); at; at = at.outer) if (at.checkpoint.open) yield at.checkpoint;
    return undefined;
  }

  /** Whether a checkpoint of the work in progress would record a first pre-image for this path. */
  wants(path: string): boolean {
    for (const checkpoint of this.own()) if (!checkpoint.records.has(path)) return true;
    return false;
  }

  /**
   * Called before every write, with what the file holds and what it is about
   * to hold (null: no file). Only the checkpoints of the work doing the
   * write record it.
   */
  async record(path: string, before: Uint8Array | null, after: Uint8Array | null): Promise<void> {
    for (const checkpoint of this.own()) await checkpoint.record(path, before, after);
  }

  forget(checkpoint: CheckpointImpl): void {
    this.all.delete(checkpoint);
  }

  async dispose(): Promise<void> {
    for (const checkpoint of [...this.all]) await checkpoint.release();
  }
}
