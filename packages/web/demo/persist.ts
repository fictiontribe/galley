/**
 * Keeps the visitor's place across a reload of the tab — their changes, what
 * they published and their conversations — in sessionStorage, which the
 * browser forgets when the tab closes. Nothing goes anywhere else. "Start
 * over" clears it (demo/layer/startOver.ts).
 *
 * The mock keeps each file as a published and a current version; only files
 * where either differs from the sample site as shipped are kept here.
 */
import type { ChatThread, HistoryEntry } from "@galley/core/types";
import type { MockServer } from "../mock/server.ts";
import type { MockSite } from "../mock/site.ts";
import { bufferFrom, StaticFile, type DemoBuffer } from "./shim/buffer";

export const SESSION_KEY = "galley.demo.session";
const VERSION = 1;
const MAX_BYTES = 400_000;

type Stored = { kind: "seed" } | { kind: "none" } | { kind: "text"; text: string } | { kind: "bytes"; base64: string } | { kind: "static"; url: string; size: number };

interface Saved {
  version: number;
  siteId: string;
  files: Array<{ path: string; base: Stored; current: Stored }>;
  history: HistoryEntry[];
  unsent: number;
  threads: ChatThread[];
}

/** The mock site's own record of a file. It is private to mock/site.ts; this module is the one place outside it that reads it. */
type FileRecord = { base: Buffer | null; current: Buffer | null; modifiedAt: number };
const recordsOf = (site: MockSite) => (site as unknown as { files: Map<string, FileRecord> }).files;

const isText = (bytes: Uint8Array) => {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
};

function store(bytes: Buffer | null, seed: Buffer | undefined): Stored | null {
  if (bytes === null) return { kind: "none" };
  if (seed && (bytes === seed || (bytes as unknown as DemoBuffer).equals(seed))) return { kind: "seed" };
  if (bytes instanceof StaticFile) return { kind: "static", url: bytes.url, size: bytes.length };
  if (bytes.length > MAX_BYTES) return null;
  return isText(bytes) ? { kind: "text", text: bytes.toString("utf8") } : { kind: "bytes", base64: bytes.toString("base64") };
}

function load(stored: Stored, seed: Buffer | undefined): Buffer | null {
  switch (stored.kind) {
    case "seed":
      return seed ?? null;
    case "none":
      return null;
    case "text":
      return bufferFrom(stored.text) as unknown as Buffer;
    case "bytes":
      return bufferFrom(stored.base64, "base64") as unknown as Buffer;
    case "static":
      return StaticFile.at(stored.url, stored.size) as unknown as Buffer;
  }
}

export function snapshot(server: MockServer): Saved | null {
  const site = [...server.backend.sites.values()][0];
  if (!site) return null;
  const seed = site.seed.files;
  const files: Saved["files"] = [];
  for (const [path, record] of recordsOf(site)) {
    const original = seed.get(path);
    const base = store(record.base, original);
    const current = store(record.current, original);
    if (!base || !current) continue;
    if (base.kind === "seed" && current.kind === "seed") continue;
    files.push({ path, base, current });
  }
  return { version: VERSION, siteId: site.id, files, history: site.history, unsent: site.unsent, threads: server.backend.threads.get(site.id) ?? [] };
}

export function restoreSession(server: MockServer, storage: Storage = sessionStorage): boolean {
  let saved: Saved;
  try {
    const text = storage.getItem(SESSION_KEY);
    if (!text) return false;
    saved = JSON.parse(text) as Saved;
  } catch {
    return false;
  }
  const site = server.backend.sites.get(saved.siteId);
  if (saved.version !== VERSION || !site) return false;
  const records = recordsOf(site);
  for (const file of saved.files) {
    const seed = site.seed.files.get(file.path);
    const base = load(file.base, seed);
    const current = load(file.current, seed);
    if (base === null && current === null) records.delete(file.path);
    else records.set(file.path, { base, current, modifiedAt: Date.now() });
  }
  site.history = saved.history;
  site.unsent = saved.unsent;
  // A turn that was running when the tab reloaded has stopped.
  server.backend.threads.set(site.id, saved.threads.map((thread) => ({ ...thread, busy: false, messages: thread.messages.map((message) => ({ ...message, pending: false })) })));
  return true;
}

export function startSaving(server: MockServer, storage: Storage = sessionStorage): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    timer = null;
    try {
      const state = snapshot(server);
      if (state) storage.setItem(SESSION_KEY, JSON.stringify(state));
    } catch {
      // Storage full or switched off: the demo still works, a reload starts it again.
    }
  };
  server.onEvent((event) => {
    if (event.type !== "changes.updated" && event.type !== "site.updated" && event.type !== "chat.done" && event.type !== "chat.message") return;
    if (!timer) timer = setTimeout(save, 150);
  });
}
