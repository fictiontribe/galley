/**
 * Where submissions are kept: `<home>/state/<siteId>/submissions/<formId>.jsonl`,
 * one `FormSubmission` per line, oldest first, in a folder only this user can
 * read. New submissions are appended (one write of one whole line, under a
 * per-file lock); marking read or spam, recording a forwarding result and
 * deleting rewrite the file atomically (temp file + rename), so a reader never
 * sees half a file and a deleted submission is really gone from disk.
 *
 * A line that can't be read (the machine stopped mid-write) is kept as it is
 * and skipped, never silently dropped by a later rewrite.
 */
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { GalleyError } from "../errors";
import type { FormSubmission } from "../kit";
import { createKeyedLock } from "../site/util";

/** Site ids are 12 hex digits; form ids are file names. Both are checked before they become paths. */
export const SITE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const FORM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

interface FileState {
  mtimeMs: number;
  size: number;
  items: FormSubmission[];
  /** Lines that couldn't be parsed, kept verbatim. */
  unreadable: string[];
}

export function checkSiteId(siteId: string): string {
  if (!SITE_ID_PATTERN.test(siteId)) throw new GalleyError("not-found", "That site isn't open here.", siteId);
  return siteId;
}

export function checkFormId(formId: string): string {
  if (!FORM_ID_PATTERN.test(formId)) throw new GalleyError("not-found", "There's no such form on this site.", formId);
  return formId;
}

export class SubmissionStore {
  private readonly lock = createKeyedLock();
  private readonly cache = new Map<string, FileState>();

  constructor(private readonly home: string) {}

  dir(siteId: string): string {
    return join(this.home, "state", checkSiteId(siteId), "submissions");
  }

  file(siteId: string, formId: string): string {
    return join(this.dir(siteId), `${checkFormId(formId)}.jsonl`);
  }

  /** Form ids that have a submissions file. */
  async formIds(siteId: string): Promise<string[]> {
    const names = await readdir(this.dir(siteId)).catch(() => [] as string[]);

    return names
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => name.slice(0, -".jsonl".length))
      .filter((id) => FORM_ID_PATTERN.test(id))
      .sort();
  }

  /** Every submission for a form, oldest first. */
  async list(siteId: string, formId: string): Promise<FormSubmission[]> {
    const file = this.file(siteId, formId);

    return this.lock(file, async () => (await this.load(file)).items.slice());
  }

  async get(siteId: string, formId: string, id: string): Promise<FormSubmission | null> {
    return (await this.list(siteId, formId)).find((item) => item.id === id) ?? null;
  }

  async append(submission: FormSubmission): Promise<void> {
    const file = this.file(submission.siteId, submission.form);

    await this.lock(file, async () => {
      const state = await this.load(file);

      await this.ensureDir(submission.siteId);
      await appendFile(file, `${JSON.stringify(submission)}\n`, { mode: 0o600 });
      state.items.push(submission);
      await this.remember(file, state);
    });
  }

  /** Change the named submissions with `change`; returns them as they are now. */
  async update(siteId: string, formId: string, ids: string[], change: (item: FormSubmission) => FormSubmission): Promise<FormSubmission[]> {
    const file = this.file(siteId, formId);
    const wanted = new Set(ids);

    return this.lock(file, async () => {
      const state = await this.load(file);
      const changed: FormSubmission[] = [];

      state.items = state.items.map((item) => {
        if (!wanted.has(item.id)) return item;
        const next = { ...change(item), id: item.id, siteId: item.siteId, form: item.form };

        changed.push(next);
        return next;
      });
      if (changed.length) await this.rewrite(file, state);
      return changed;
    });
  }

  /** Delete the named submissions for good; returns what was removed (for Undo). */
  async remove(siteId: string, formId: string, ids: string[]): Promise<FormSubmission[]> {
    const file = this.file(siteId, formId);
    const wanted = new Set(ids);

    return this.lock(file, async () => {
      const state = await this.load(file);
      const removed = state.items.filter((item) => wanted.has(item.id));

      if (!removed.length) return [];
      state.items = state.items.filter((item) => !wanted.has(item.id));
      await this.rewrite(file, state);
      return removed;
    });
  }

  /** Put back submissions removed a moment ago (Undo). Ones already present are left alone. */
  async restore(siteId: string, formId: string, items: FormSubmission[]): Promise<number> {
    const file = this.file(siteId, formId);

    return this.lock(file, async () => {
      const state = await this.load(file);
      const present = new Set(state.items.map((item) => item.id));
      const fresh = items.filter((item) => !present.has(item.id));

      if (!fresh.length) return 0;
      await this.ensureDir(siteId);
      state.items = [...state.items, ...fresh].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      await this.rewrite(file, state);
      return fresh.length;
    });
  }

  private async ensureDir(siteId: string): Promise<void> {
    const dir = this.dir(siteId);

    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700).catch(() => undefined);
  }

  private async load(file: string): Promise<FileState> {
    const info = await stat(file).catch(() => null);

    if (!info) {
      const empty = { mtimeMs: 0, size: 0, items: [], unreadable: [] };

      this.cache.set(file, empty);
      return empty;
    }
    const cached = this.cache.get(file);

    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached;
    const text = await readFile(file, "utf8");
    const state: FileState = { mtimeMs: info.mtimeMs, size: info.size, items: [], unreadable: [] };

    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      try {
        const parsed = JSON.parse(line) as FormSubmission;

        if (parsed && typeof parsed.id === "string" && typeof parsed.at === "string" && parsed.values && typeof parsed.values === "object") state.items.push(parsed);
        else state.unreadable.push(line);
      } catch {
        state.unreadable.push(line);
      }
    }
    this.cache.set(file, state);
    return state;
  }

  private async rewrite(file: string, state: FileState): Promise<void> {
    if (!state.items.length && !state.unreadable.length) {
      await rm(file, { force: true });
      this.cache.delete(file);
      return;
    }
    const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
    const lines = [...state.unreadable, ...state.items.map((item) => JSON.stringify(item))];

    await writeFile(temp, `${lines.join("\n")}\n`, { mode: 0o600 });
    await rename(temp, file);
    await this.remember(file, state);
  }

  private async remember(file: string, state: FileState): Promise<void> {
    const info = await stat(file).catch(() => null);

    if (!info) return;
    state.mtimeMs = info.mtimeMs;
    state.size = info.size;
    this.cache.set(file, state);
  }
}
