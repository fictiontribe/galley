/**
 * Checkpoints: undo for one assistant turn without touching the user's other
 * pending edits. While a checkpoint is open, the first write to each path
 * records what the file was before (its bytes, or that it did not exist);
 * `restore()` puts exactly those files back.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRODUCT } from "../brand";
import type { Checkpoint } from "../types";

/** Pre-images above this size are kept in a temp file instead of memory. */
export const SPILL_BYTES = 5 * 1024 * 1024;

type PreImage = { kind: "absent" } | { kind: "memory"; bytes: Uint8Array } | { kind: "spilled"; file: string };

export interface CheckpointHost {
  /** Put a file back (bytes) or remove it (null), bypassing mode checks but not containment. */
  restoreFile(path: string, bytes: Uint8Array | null): Promise<void>;
  /** Tell listeners once, after a restore. */
  emitUndo(paths: string[]): Promise<void> | void;
}

/** A Checkpoint plus `release()`, which frees its pre-images once undo is no longer offered. */
export interface WorkspaceCheckpoint extends Checkpoint {
  readonly label: string;
  /** Free the recorded pre-images (and any temp files). Restore is no longer possible afterwards. */
  release(): Promise<void>;
}

class CheckpointImpl implements WorkspaceCheckpoint {
  readonly id = randomUUID();
  readonly records = new Map<string, PreImage>();
  open = true;
  released = false;
  private spillDir: string | null = null;

  constructor(
    readonly label: string,
    private readonly manager: CheckpointManager
  ) {}

  paths(): string[] {
    return [...this.records.keys()];
  }

  close(): void {
    // Recording stops; the pre-images stay so the turn can still be undone later.
    this.open = false;
  }

  async record(path: string, before: Uint8Array | null): Promise<void> {
    if (!this.open || this.records.has(path)) return;
    if (before === null) {
      this.records.set(path, { kind: "absent" });
      return;
    }
    if (before.length <= SPILL_BYTES) {
      this.records.set(path, { kind: "memory", bytes: before });
      return;
    }
    const file = join(await this.ensureSpillDir(), `${randomUUID()}.bin`);

    await writeFile(file, before);
    this.records.set(path, { kind: "spilled", file });
  }

  private async ensureSpillDir(): Promise<string> {
    this.spillDir ??= await mkdtemp(join(tmpdir(), `${PRODUCT.slug}-checkpoint-`));
    return this.spillDir;
  }

  async restore(): Promise<string[]> {
    if (this.released) return [];
    this.close();
    const restored: string[] = [];

    for (const [path, image] of this.records) {
      const bytes =
        image.kind === "absent" ? null : image.kind === "memory" ? image.bytes : new Uint8Array(await readFile(image.file));

      await this.manager.host.restoreFile(path, bytes);
      restored.push(path);
    }
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

export class CheckpointManager {
  private readonly all = new Set<CheckpointImpl>();

  constructor(readonly host: CheckpointHost) {}

  open(label: string): WorkspaceCheckpoint {
    const checkpoint = new CheckpointImpl(label, this);

    this.all.add(checkpoint);
    return checkpoint;
  }

  /** Whether any checkpoint would record a write to this path. */
  wants(path: string): boolean {
    for (const checkpoint of this.all) if (checkpoint.open && !checkpoint.records.has(path)) return true;
    return false;
  }

  /** Called before every write; each open checkpoint keeps its own first pre-image. */
  async record(path: string, before: Uint8Array | null): Promise<void> {
    for (const checkpoint of this.all) await checkpoint.record(path, before);
  }

  forget(checkpoint: CheckpointImpl): void {
    this.all.delete(checkpoint);
  }

  async dispose(): Promise<void> {
    for (const checkpoint of [...this.all]) await checkpoint.release();
  }
}
