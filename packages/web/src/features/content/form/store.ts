/**
 * The form's state and its saving model. There is no Save button: each edit
 * becomes ops, debounced per field (500 ms idle, or at once on blur and for
 * discrete controls), sent one batch at a time so ops never race, with the
 * entry's hash as `baseHash`.
 *
 * Fields subscribe to their own path (`useFormValue`), so a keystroke only
 * re-renders the field being typed in.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import type { ChangeOrigin, EditOp, EditResult, Entry, FieldPath, JsonValue, ValidationIssue } from "@galley/core/types";
import { isApiFailure } from "@/lib/api";
import type { StructureLoss } from "./labels";
import { mergeIntoForm, reapplyOps, typedEdits, type Draft, type TypedEdit } from "./merge";
import { applyOpsLocal, valueOps, type DataOp } from "./ops";
import { pathKey, share, type JsonObject } from "./paths";

export const BODY_KEY = "\u0000body";
const IDLE_MS = 500;
const SAVED_MS = 2400;

export type SaveState = "saving" | "saved";

export interface Conflict {
  edits: TypedEdit[];
  /** Sections or list items added, moved or removed — those aren't put back; each is listed for the person. */
  structure: StructureLoss[];
  /** Body text that didn't save, when there was some. */
  body: string | null;
  /** The lost save was marked as the previewed page's, so putting it back is marked too. */
  viaPreview?: boolean;
}

export interface FormState {
  path: string;
  hash: string;
  stored: JsonObject;
  storedBody: string | null;
  /** The file as the engine last stored it, byte for byte (for an exact Undo). */
  raw: string;
  /** What the form shows: stored + edits on their way + drafts. */
  data: JsonObject;
  body: string | null;
  issues: ValidationIssue[];
  saveState: Record<string, SaveState>;
  /** The engine's reason for refusing an edit, by field. */
  refusals: Record<string, string>;
  /** A save that failed for a reason other than a conflict. */
  saveError: unknown;
  conflict: Conflict | null;
  /** Set when a fresh copy worth announcing (the assistant's, or from outside the app) was folded in. */
  outside: { origin: ChangeOrigin; at: number } | null;
  /** A field the form should scroll to (from the issue summary). */
  reveal: { path: FieldPath; at: number } | null;
  busy: boolean;
}

interface Batch {
  ops: EditOp[];
  keys: string[];
  /** Sent marked as the previewed page's: the store was tainted by a page message when it went (see `fromPage`). */
  viaPreview?: boolean;
}

export interface FormDeps {
  send: (ops: EditOp[], baseHash: string, viaPreview?: boolean) => Promise<EditResult>;
  reload: () => Promise<Entry>;
  /** Called with each entry the engine returns, to keep the shared cache current. */
  onEntry: (entry: Entry) => void;
}

export type FormStoreEvent =
  | { type: "draft"; path: FieldPath; key: string }
  | { type: "commit"; path: FieldPath; key: string }
  | { type: "body-draft" }
  | { type: "body-commit" }
  | { type: "received"; entry: Entry };

export interface FormActions {
  /** A control's new value. `immediate` skips the idle wait (switches, pickers, chips). */
  edit: (path: FieldPath, value: JsonValue | undefined, options: { required: boolean; immediate?: boolean }) => void;
  /** The control lost focus: send what it holds now. */
  commit: (path: FieldPath) => void;
  editBody: (text: string) => void;
  commitBody: () => void;
  /** An op that changes shape (insert / move / remove) or puts a value back. Drafts are sent first. */
  apply: (...ops: DataOp[]) => void;
  /**
   * Apply remote edits directly onto the stored copy (preserving active drafts),
   * without refetching the entry. Used by incremental live-sync additions.
   */
  applyRemote: (ops: EditOp[], next: { hash: string; raw?: string; body?: string | null; issues?: ValidationIssue[]; modifiedAt?: number }) => void;
  /** Replace the form's send/reload transport dynamically (for compiled-in additions). */
  setTransport: (transport: Partial<Pick<FormDeps, "send" | "reload">>) => void;
  /** Subscribe to form draft/commit/receive lifecycle events. */
  onEvent: (listener: (event: FormStoreEvent) => void) => () => void;
  /** Suppress or re-enable refetch-on-receive while an incremental sync handles updates. */
  setSuppressReceive: (suppress: boolean) => void;
  /**
   * Run what a message from the previewed page asks for. Any change made while
   * it runs — and, when it returns a promise, until that settles — taints the
   * store until its next save, and a tainted save is sent marked: the server
   * holds it to the lowest level whoever is signed in (core content-code.ts),
   * because the page shares the overlay's origin and could otherwise save as
   * the person editing. Nothing lists message types: whatever a page message
   * changes is the page's. It over-marks rather than under-marks — a person's
   * own edit that goes in the same save is marked with it.
   */
  fromPage: <T>(run: () => T) => T;
  /** Whether a message from the previewed page is being handled now (an action that finishes later can stay in its window). */
  inPage: () => boolean;
  /** Send every draft now. Resolves when the queue is empty. */
  flush: () => Promise<void>;
  /** A fresh copy of the entry arrived from outside the form; `origin` when it should be announced. */
  receive: (entry: Entry, origin?: ChangeOrigin | null) => void;
  /** Replace the whole file (source view). Resolves with the engine's result. */
  saveRaw: (text: string) => Promise<EditResult>;
  /**
   * Put the file back exactly as `raw`, but only when nothing has changed
   * since the copy whose hash is `ifHash` (no other edit landed or is on its
   * way). Resolves true when it did; false leaves everything as it is.
   */
  restore: (raw: string, ifHash: string) => Promise<boolean>;
  /** Nothing typed, queued or on its way: the stored copy is the file. */
  idle: () => boolean;
  reapply: () => void;
  dismissConflict: () => void;
  retry: () => void;
  revealField: (path: FieldPath) => void;
  clearRefusal: (path: FieldPath) => void;
  dispose: () => void;
}

export type FormStore = StoreApi<FormState> & { actions: FormActions };

interface DraftSlot {
  draft: Draft;
  required: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

function keyOfOp(op: EditOp): string {
  return "path" in op ? pathKey(op.path) : BODY_KEY;
}

function dataOps(ops: readonly EditOp[]): DataOp[] {
  return ops.filter((op): op is DataOp => "path" in op);
}

function lastBody(ops: readonly EditOp[]): string | undefined {
  let body: string | undefined;
  for (const op of ops) if (op.op === "body") body = op.value;
  return body;
}

function isConflict(error: unknown): boolean {
  return isApiFailure(error) && (error.status === 409 || error.shape.code === "conflict");
}

export function createFormStore(entry: Entry, deps: FormDeps): FormStore {
  const store = createStore<FormState>(() => ({
    path: entry.path,
    hash: entry.hash,
    stored: entry.data,
    storedBody: entry.body,
    raw: entry.raw,
    data: entry.data,
    body: entry.body,
    issues: entry.issues,
    saveState: {},
    refusals: {},
    saveError: null,
    conflict: null,
    outside: null,
    reveal: null,
    busy: false,
  }));

  const drafts = new Map<string, DraftSlot>();
  let bodyDraft: { value: string; timer: ReturnType<typeof setTimeout> | null } | null = null;
  let queue: Batch[] = [];
  let inflight: Batch | null = null;
  let transportSend = deps.send;
  let transportReload = deps.reload;
  let suppressReceive = false;
  const listeners = new Set<(event: FormStoreEvent) => void>();
  const emitEvent = (event: FormStoreEvent) => {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        // An observer never breaks form state.
      }
    }
  };
  // How many messages from the previewed page are being handled now (see fromPage), and whether a change one of them
  // made is still waiting to be saved: the next save then goes marked.
  let pageDepth = 0;
  let tainted = false;
  /** A change to what the form will send: made while a page message runs, it taints the store. */
  const noteChange = (): void => {
    if (pageDepth > 0) tainted = true;
  };
  let idleWaiters: Array<() => void> = [];
  /** When the copy the form is built on was written (file mtime), to order copies that cross. */
  let lastModified = entry.modifiedAt;
  /** A fresh copy that arrived while a save was on its way; adopted afterwards if it's newer. */
  let deferred: { entry: Entry; origin: ChangeOrigin | null } | null = null;
  const savedTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const pendingOps = (): EditOp[] => [...(inflight?.ops ?? []), ...queue.flatMap((batch) => batch.ops)];

  function recompute(): void {
    const state = store.getState();
    const pending = pendingOps();
    const data = mergeIntoForm(
      state.data,
      state.stored,
      dataOps(pending),
      [...drafts.values()].map((slot) => slot.draft),
    );
    const body = bodyDraft?.value ?? lastBody(pending) ?? state.storedBody;
    store.setState({ data, body, busy: inflight !== null || queue.length > 0 });
  }

  function setSaveState(keys: readonly string[], value: SaveState | null): void {
    const next = { ...store.getState().saveState };
    for (const key of keys) {
      const timer = savedTimers.get(key);
      if (timer) clearTimeout(timer);
      savedTimers.delete(key);
      if (value === null) delete next[key];
      else next[key] = value;
      if (value === "saved") {
        savedTimers.set(
          key,
          setTimeout(() => {
            savedTimers.delete(key);
            const current = { ...store.getState().saveState };
            if (current[key] === "saved") delete current[key];
            store.setState({ saveState: current });
          }, SAVED_MS),
        );
      }
    }
    store.setState({ saveState: next });
  }

  function settleWaiters(force = false): void {
    if (!force && (inflight || queue.length > 0 || drafts.size > 0 || bodyDraft)) return;
    const waiting = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiting) resolve();
  }

  function enqueue(ops: EditOp[], keys: string[]): void {
    if (ops.length === 0) return;
    queue.push({ ops, keys });
    setSaveState(keys, "saving");
    const refusals = { ...store.getState().refusals };
    for (const key of keys) delete refusals[key];
    store.setState({ refusals });
  }

  function flushDraft(key: string): void {
    const slot = drafts.get(key);
    if (!slot) return;
    if (slot.timer) clearTimeout(slot.timer);
    drafts.delete(key);
    enqueue(draftOps(slot), [key]);
  }

  /** The ops for one draft, measured against the file as it will be once the queue lands. */
  function draftOps(slot: DraftSlot): DataOp[] {
    const expected = applyOpsLocal(store.getState().stored, dataOps(pendingOps()));
    return valueOps({ path: slot.draft.path, next: slot.draft.value, stored: expected, required: slot.required });
  }

  function flushBody(): void {
    if (!bodyDraft) return;
    if (bodyDraft.timer) clearTimeout(bodyDraft.timer);
    const value = bodyDraft.value;
    bodyDraft = null;
    const current = lastBody(pendingOps()) ?? store.getState().storedBody;
    if (value !== current) enqueue([{ op: "body", value }], [BODY_KEY]);
  }

  function flushAll(): void {
    for (const key of [...drafts.keys()]) flushDraft(key);
    flushBody();
  }

  async function pump(): Promise<void> {
    if (inflight || queue.length === 0 || store.getState().saveError) {
      // Nothing left to send: a page change that tainted the store has gone (or never needed sending), so the taint goes.
      // It stays through a failed save, which waits in the queue and is sent marked when retried.
      if (!inflight && queue.length === 0 && drafts.size === 0 && !bodyDraft && !store.getState().saveError) tainted = false;
      if (!inflight && queue.length === 0 && deferred) {
        const late = deferred;
        deferred = null;
        if (late.entry.modifiedAt > lastModified) adoptOutside(late.entry, late.origin);
      }
      settleWaiters(Boolean(store.getState().saveError));
      return;
    }
    const marked = tainted || queue.some((item) => item.viaPreview);
    const batch: Batch = { ops: queue.flatMap((item) => item.ops), keys: [...new Set(queue.flatMap((item) => item.keys))], ...(marked ? { viaPreview: true } : {}) };
    queue = [];
    inflight = batch;
    store.setState({ busy: true });
    try {
      const result = await transportSend(batch.ops, store.getState().hash, batch.viaPreview);
      inflight = null;
      received(result, batch);
    } catch (error) {
      inflight = null;
      if (isConflict(error)) await conflicted(batch);
      else {
        queue = [batch, ...queue];
        store.setState({ saveError: error });
      }
      recompute();
    }
    void pump();
  }

  function received(result: EditResult, batch: Batch): void {
    const refused = new Map<string, string>();
    for (const refusal of result.refused) {
      const op = batch.ops[refusal.index];
      if (op) refused.set(keyOfOp(op), refusal.reason);
    }
    const refusals = { ...store.getState().refusals };
    for (const [key, reason] of refused) refusals[key] = reason;
    lastModified = result.entry.modifiedAt;
    store.setState({
      hash: result.entry.hash,
      stored: share(store.getState().stored, result.entry.data),
      storedBody: result.entry.body,
      raw: result.entry.raw,
      issues: result.entry.issues,
      refusals,
      saveError: null,
    });
    setSaveState(
      batch.keys.filter((key) => !refused.has(key)),
      "saved",
    );
    setSaveState([...refused.keys()], null);
    deps.onEntry(result.entry);
    recompute();
  }

  async function conflicted(batch: Batch): Promise<void> {
    const lost: EditOp[] = [...batch.ops, ...queue.flatMap((item) => item.ops)];
    const expected = applyOpsLocal(store.getState().stored, dataOps(lost));
    for (const slot of drafts.values()) lost.push(...valueOps({ path: slot.draft.path, next: slot.draft.value, stored: expected, required: slot.required }));
    const lostBody = bodyDraft?.value ?? lastBody(lost) ?? null;
    for (const slot of drafts.values()) if (slot.timer) clearTimeout(slot.timer);
    drafts.clear();
    if (bodyDraft?.timer) clearTimeout(bodyDraft.timer);
    bodyDraft = null;
    queue = [];
    setSaveState(Object.keys(store.getState().saveState), null);
    // What was lost is put back (reapply) marked if it was going marked. Nothing is pending now, so the taint goes — before
    // the reload, so a page change made while it is on its way taints the store again and isn't sent unmarked.
    const lostMarked = Boolean(batch.viaPreview) || tainted;
    tainted = false;
    let fresh: Entry | null = null;
    try {
      fresh = await transportReload();
    } catch {
      fresh = null;
    }
    const lostData = dataOps(lost);
    // Each reorder, addition and removal, with the data it was made on, so the notice can name it.
    const structure: StructureLoss[] = [];
    let walk = store.getState().stored;
    for (const op of lostData) {
      if (op.op === "insert" || op.op === "move" || op.op === "remove") structure.push({ op, data: walk });
      walk = applyOpsLocal(walk, [op]);
    }
    store.setState({
      conflict: { edits: typedEdits(lostData), structure, body: lostBody, ...(lostMarked ? { viaPreview: true } : {}) },
      ...(fresh
        ? { hash: fresh.hash, stored: fresh.data, storedBody: fresh.body, raw: fresh.raw, issues: fresh.issues, refusals: {} }
        : {}),
    });
    if (fresh) {
      lastModified = fresh.modifiedAt;
      deps.onEntry(fresh);
    }
  }

  /**
   * Fold in a fresh copy from outside the form. `origin` is set only when the
   * copy should be announced (the assistant, an outside program); copies the
   * app wrote itself arrive with null and change the form silently.
   */
  function adoptOutside(fresh: Entry, origin: ChangeOrigin | null): void {
    const state = store.getState();
    lastModified = fresh.modifiedAt;
    store.setState({
      hash: fresh.hash,
      stored: share(state.stored, fresh.data),
      storedBody: fresh.body,
      raw: fresh.raw,
      issues: fresh.issues,
      ...(origin ? { outside: { origin, at: Date.now() } } : {}),
    });
    recompute();
  }

  const actions: FormActions = {
    edit(path, value, { required, immediate }) {
      const key = pathKey(path);
      const existing = drafts.get(key);
      if (existing?.timer) clearTimeout(existing.timer);
      const slot: DraftSlot = { draft: { path, value }, required, timer: null };
      drafts.set(key, slot);
      noteChange();
      if (store.getState().refusals[key]) actions.clearRefusal(path);
      if (immediate) {
        flushDraft(key);
        recompute();
        void pump();
        return;
      }
      slot.timer = setTimeout(() => {
        flushDraft(key);
        recompute();
        void pump();
      }, IDLE_MS);
      emitEvent({ type: "draft", path, key });
      recompute();
    },
    commit(path) {
      const key = pathKey(path);
      emitEvent({ type: "commit", path, key });
      if (!drafts.has(key)) return;
      flushDraft(key);
      recompute();
      void pump();
    },
    editBody(text) {
      if (bodyDraft?.timer) clearTimeout(bodyDraft.timer);
      noteChange();
      bodyDraft = {
        value: text,
        timer: setTimeout(() => {
          flushBody();
          recompute();
          void pump();
        }, IDLE_MS),
      };
      emitEvent({ type: "body-draft" });
      recompute();
    },
    commitBody() {
      emitEvent({ type: "body-commit" });
      if (!bodyDraft) return;
      flushBody();
      recompute();
      void pump();
    },
    apply(...ops) {
      noteChange();
      flushAll();
      enqueue(ops, [...new Set(ops.map(keyOfOp))]);
      recompute();
      void pump();
    },
    applyRemote(ops, next) {
      const state = store.getState();
      const nextStored = share(state.stored, applyOpsLocal(state.stored, dataOps(ops)));
      const bodyFromOps = lastBody(ops);
      const nextBody = next.body !== undefined ? next.body : bodyFromOps !== undefined ? bodyFromOps : state.storedBody;
      if (next.modifiedAt && next.modifiedAt > lastModified) lastModified = next.modifiedAt;
      store.setState({
        hash: next.hash,
        stored: nextStored,
        storedBody: nextBody,
        ...(next.raw !== undefined ? { raw: next.raw } : {}),
        ...(next.issues !== undefined ? { issues: next.issues } : {}),
      });
      recompute();
    },
    setTransport(transport) {
      if (transport.send) transportSend = transport.send;
      if (transport.reload) transportReload = transport.reload;
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    setSuppressReceive(suppress) {
      suppressReceive = suppress;
    },
    fromPage(run) {
      pageDepth += 1;
      let result;
      try {
        result = run();
      } catch (error) {
        pageDepth -= 1;
        throw error;
      }
      const settle = () => {
        pageDepth -= 1;
      };
      const pending = result as unknown;
      if (pending !== null && typeof pending === "object" && typeof (pending as { then?: unknown }).then === "function") {
        (pending as PromiseLike<unknown>).then(settle, settle);
      } else settle();
      return result;
    },
    inPage() {
      return pageDepth > 0;
    },
    flush() {
      flushAll();
      recompute();
      const done = new Promise<void>((resolve) => idleWaiters.push(resolve));
      void pump();
      return done;
    },
    receive(fresh, origin = null) {
      if (suppressReceive) return;
      const state = store.getState();
      if (fresh.path !== state.path || fresh.hash === state.hash) return;
      // While a save is on its way, wait for its reply, then keep whichever copy is newer.
      if (inflight || queue.length > 0) {
        deferred = { entry: fresh, origin };
        return;
      }
      adoptOutside(fresh, origin);
    },
    async saveRaw(text) {
      // Decided as it is asked, before waiting for the queue: a whole-file save a page message asks for (an Undo it
      // started) goes marked. The flush below sends any pending page change marked on its own; a person's source-view
      // text is theirs.
      const marked = pageDepth > 0;
      await actions.flush();
      const result = await transportSend([{ op: "raw", value: text }], store.getState().hash, marked || undefined);
      if (result.applied > 0 || result.refused.length === 0) {
        lastModified = result.entry.modifiedAt;
        store.setState({
          hash: result.entry.hash,
          stored: share(store.getState().stored, result.entry.data),
          storedBody: result.entry.body,
          raw: result.entry.raw,
          issues: result.entry.issues,
        });
        deps.onEntry(result.entry);
        recompute();
      }
      return result;
    },
    idle() {
      return !inflight && queue.length === 0 && drafts.size === 0 && !bodyDraft;
    },
    async restore(raw, ifHash) {
      if (!actions.idle() || store.getState().hash !== ifHash) return false;
      const result = await actions.saveRaw(raw);
      return result.applied > 0 && result.refused.length === 0;
    },
    reapply() {
      const conflict = store.getState().conflict;
      if (!conflict) return;
      store.setState({ conflict: null });
      // Putting back a save that was going marked keeps the mark.
      if (conflict.viaPreview) tainted = true;
      const ops = reapplyOps(conflict.edits, applyOpsLocal(store.getState().stored, dataOps(pendingOps())));
      enqueue(ops, [...new Set(ops.map(keyOfOp))]);
      if (conflict.body !== null && conflict.body !== store.getState().storedBody) enqueue([{ op: "body", value: conflict.body }], [BODY_KEY]);
      recompute();
      void pump();
    },
    dismissConflict() {
      store.setState({ conflict: null });
    },
    retry() {
      store.setState({ saveError: null });
      void pump();
    },
    revealField(path) {
      store.setState({ reveal: { path, at: Date.now() } });
    },
    clearRefusal(path) {
      const refusals = { ...store.getState().refusals };
      delete refusals[pathKey(path)];
      store.setState({ refusals });
    },
    dispose() {
      // Leaving the form never loses typing: what's left is sent, and the queue finishes on its own.
      for (const timer of savedTimers.values()) clearTimeout(timer);
      savedTimers.clear();
      flushAll();
      void pump();
    },
  };

  return Object.assign(store, { actions });
}
