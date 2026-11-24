/**
 * Conversation storage: `<home>/state/<siteId>/threads/<threadId>.json` holds
 * both what the UI shows (`ChatThread`) and the exact API history — every
 * content block as the API returned it, thinking blocks and signatures
 * included — so each request replays an append-only history byte for byte.
 *
 * Attached images are referenced, not inlined: the JSON keeps the image
 * block with empty data plus a reference to a copy stored beside the thread
 * under its content hash, and the bytes are put back at request time. The
 * copy (rather than the file in the site's media) is what makes the rebuilt
 * block identical forever: the person may edit or delete the media file, and
 * an earlier turn whose bytes changed would invalidate the prompt cache and
 * every later thinking block.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GalleyError } from "../errors";
import type { AgentMode, ChatThread, ChatThreadSummary } from "../types";
import type { MessageMeta } from "./profiles";

export interface StoredImageRef {
  /** Index of the image block inside `message.content`. */
  block: number;
  /** File name inside the thread's attachment folder. */
  file: string;
}

export interface StoredMessage {
  message: Anthropic.Beta.BetaMessageParam;
  images?: StoredImageRef[];
  /** Assistant messages: which request profile produced it, in which mode (see profiles.ts). */
  meta?: MessageMeta;
}

export interface TurnRecord {
  turnId: string;
  userMessageId: string;
  assistantMessageId: string;
  /** What the person asked, for the undo note. */
  request: string;
  at: number;
  undone?: boolean;
}

export interface ApiState {
  messages: StoredMessage[];
  /** The site card frozen into this conversation's system prompt at its first request. */
  systemCard: string | null;
  /** Hash of the site card the model was last given (system prompt or a later note). */
  cardHash: string | null;
  /** The mode the model was last told about; null before the first request. */
  mode: AgentMode | null;
  /** Whether the build-only tools are currently surfaced (tool_addition sent, no removal since). */
  buildTools: boolean;
  /**
   * Which build-only tools are surfaced, by name. Absent in threads from
   * before it was kept: then `buildTools` means every one of them.
   */
  surfacedTools?: string[];
  /** Notes for the model that haven't been delivered yet (an undo, say). */
  pendingNotes: string[];
  /** Under the plain profile, thinking in messages before this index is never replayed again. */
  plainThinkingFloor?: number;
}

export interface ThreadRecord {
  version: 1;
  siteId: string;
  thread: Omit<ChatThread, "busy">;
  api: ApiState;
  turns: TurnRecord[];
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

function check(id: string, what: string): string {
  if (!SAFE_ID.test(id)) throw new GalleyError("not-found", `That ${what} doesn't exist.`, id);
  return id;
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

/** Site ids are the first 12 hex digits of a hash of the site's real path (site/util.ts). */
const SITE_ID = /^[0-9a-f]{12}$/;
/** What a conversation folder holds: threads, their attachment folders, and temp files mid-write. */
const THREAD_ENTRY = /\.(json|files|tmp)$/;

/**
 * Per-site state used to live in `<home>/sites/<siteId>/`, beside the folder
 * where new and cloned sites are put by default — so a conversation folder
 * could be offered as a site. It now lives in `<home>/state/<siteId>/`. This
 * moves what an earlier version left behind, once: only folders named like a
 * site id whose `threads` folder holds nothing but conversation files are
 * touched, and the emptied `<home>/sites/<siteId>` is removed only when
 * nothing else is in it.
 */
export async function migrateLegacyThreads(home: string): Promise<string[]> {
  const legacyRoot = join(home, "sites");
  let names: string[];

  try {
    names = await readdir(legacyRoot);
  } catch {
    return [];
  }
  const moved: string[] = [];

  for (const id of names) {
    if (!SITE_ID.test(id)) continue;
    const from = join(legacyRoot, id, "threads");
    const entries = await readdir(from).catch(() => null);

    if (!entries || !entries.every((name) => THREAD_ENTRY.test(name))) continue;
    const to = join(home, "state", id, "threads");

    await mkdir(to, { recursive: true });
    for (const name of entries) {
      const target = join(to, name);

      // A conversation already in the new place wins; the old copy is left where it was.
      if (await stat(target).then(() => true, () => false)) continue;
      await rename(join(from, name), target);
    }
    await rmdir(from).catch(() => undefined);
    await rmdir(join(legacyRoot, id)).catch(() => undefined);
    moved.push(id);
  }
  return moved;
}

export class ThreadStore {
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly imageCache = new Map<string, string>();
  /** The one-time move of conversations from the old location; every read and write waits for it. */
  private readonly ready: Promise<unknown>;

  constructor(private readonly home: string) {
    this.ready = migrateLegacyThreads(home).catch(() => undefined);
  }

  dir(siteId: string): string {
    return join(this.home, "state", check(siteId, "site"), "threads");
  }

  private file(siteId: string, threadId: string): string {
    return join(this.dir(siteId), `${check(threadId, "conversation")}.json`);
  }

  attachmentsDir(siteId: string, threadId: string): string {
    return join(this.dir(siteId), `${check(threadId, "conversation")}.files`);
  }

  /** One read-modify-write at a time per thread. */
  async update<T>(siteId: string, threadId: string, change: (record: ThreadRecord) => T | Promise<T>): Promise<T> {
    const key = `${siteId}/${threadId}`;
    const task = async () => {
      await this.ready;
      const record = await this.load(siteId, threadId);

      if (!record) throw new GalleyError("not-found", "That conversation doesn't exist any more.", key);
      const result = await change(record);

      await this.write(record);
      return result;
    };
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.then(task, task);

    this.locks.set(
      key,
      run.catch(() => undefined)
    );
    return run;
  }

  async create(siteId: string, input: { title?: string; mode?: AgentMode }, now: number): Promise<ThreadRecord> {
    await this.ready;
    const record: ThreadRecord = {
      version: 1,
      siteId,
      thread: {
        id: randomUUID(),
        title: input.title?.trim() || "New conversation",
        mode: input.mode ?? "content",
        createdAt: now,
        updatedAt: now,
        messageCount: 0,
        messages: [],
      },
      api: { messages: [], systemCard: null, cardHash: null, mode: null, buildTools: false, pendingNotes: [] },
      turns: [],
    };

    await this.write(record);
    return record;
  }

  async load(siteId: string, threadId: string): Promise<ThreadRecord | null> {
    await this.ready;
    try {
      const record = JSON.parse(await readFile(this.file(siteId, threadId), "utf8")) as ThreadRecord;

      return record.version === 1 ? record : null;
    } catch (error) {
      if (error instanceof GalleyError) throw error;
      return null;
    }
  }

  async write(record: ThreadRecord): Promise<void> {
    await this.ready;
    const dir = this.dir(record.siteId);

    await mkdir(dir, { recursive: true });
    const temp = join(dir, `.${record.thread.id}-${randomUUID()}.tmp`);

    record.thread.messageCount = record.thread.messages.length;
    await writeFile(temp, JSON.stringify(record));
    await rename(temp, this.file(record.siteId, record.thread.id));
  }

  async list(siteId: string): Promise<ThreadRecord[]> {
    await this.ready;
    let names: string[];

    try {
      names = await readdir(this.dir(siteId));
    } catch {
      return [];
    }
    const records: ThreadRecord[] = [];

    for (const name of names) {
      if (!name.endsWith(".json") || name.startsWith(".")) continue;
      const record = await this.load(siteId, name.slice(0, -5)).catch(() => null);

      if (record) records.push(record);
    }
    return records.sort((a, b) => b.thread.updatedAt - a.thread.updatedAt);
  }

  async remove(siteId: string, threadId: string): Promise<void> {
    await this.ready;
    await rm(this.file(siteId, threadId), { force: true });
    await rm(this.attachmentsDir(siteId, threadId), { recursive: true, force: true });
  }

  /** Stores attachment bytes under their hash; returns the file name. */
  async storeAttachment(siteId: string, threadId: string, data: Uint8Array, ext: string): Promise<string> {
    await this.ready;
    const dir = this.attachmentsDir(siteId, threadId);
    const name = `${createHash("sha256").update(data).digest("hex")}.${ext}`;

    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), data);
    return name;
  }

  /** The API messages with every referenced image's bytes put back. */
  async hydrate(siteId: string, threadId: string, messages: StoredMessage[]): Promise<Anthropic.Beta.BetaMessageParam[]> {
    const out: Anthropic.Beta.BetaMessageParam[] = [];

    for (const stored of messages) {
      if (!stored.images?.length || typeof stored.message.content === "string") {
        out.push(stored.message);
        continue;
      }
      const content = [...(stored.message.content as Anthropic.Beta.BetaContentBlockParam[])];

      for (const ref of stored.images) {
        const block = content[ref.block];

        if (!block || block.type !== "image" || block.source.type !== "base64") continue;
        const key = `${siteId}/${threadId}/${ref.file}`;
        let data = this.imageCache.get(key);

        if (data === undefined) {
          try {
            data = (await readFile(join(this.attachmentsDir(siteId, threadId), ref.file))).toString("base64");
          } catch {
            // The copy is gone (the folder was cleaned by hand): say so in place,
            // rather than fail every later turn of the conversation.
            content[ref.block] = { type: "text", text: "[An image was attached here but is no longer available.]" };
            continue;
          }
          if (this.imageCache.size > 64) this.imageCache.clear();
          this.imageCache.set(key, data);
        }
        content[ref.block] = { ...block, source: { ...block.source, data } };
      }
      out.push({ ...stored.message, content } as Anthropic.Beta.BetaMessageParam);
    }
    return out;
  }
}

export function summaryOf(record: ThreadRecord, busy: boolean): ChatThreadSummary {
  const { thread } = record;

  return { id: thread.id, title: thread.title, mode: thread.mode, createdAt: thread.createdAt, updatedAt: thread.updatedAt, messageCount: thread.messages.length, busy };
}

/** First user message, shortened at a word boundary. */
export function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();

  if (clean.length <= 60) return clean || "New conversation";
  const cut = clean.slice(0, 60);
  const space = cut.lastIndexOf(" ");

  return `${(space > 30 ? cut.slice(0, space) : cut).replace(/[,.;:–—-]+$/, "")}…`;
}
