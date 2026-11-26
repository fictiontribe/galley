import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditOp, EditResult, Entry, JsonValue } from "@galley/core/types";
import { ApiFailure } from "@/lib/api";
import { applyOpsLocal, type DataOp } from "@/features/content/form/ops";
import { createFormStore, type FormDeps } from "@/features/content/form/store";
import type { JsonObject } from "@/features/content/form/paths";

function entryOf(data: JsonObject, hash: string, body: string | null = null, modifiedAt = Number(hash.slice(1)) || 0): Entry {
  return {
    path: "src/content/pages/index.md",
    collection: "pages",
    slug: "index",
    title: "Home",
    titleSource: "field",
    url: "/",
    status: "modified",
    modifiedAt,
    format: "markdown",
    data,
    body,
    raw: "",
    hash,
    fields: [],
    issues: [],
  };
}

/** A pretend engine: applies data ops, answers after a tick, checks baseHash. */
function fakeEngine(initial: JsonObject) {
  let data: JsonValue = initial;
  let body: string | null = "Body";
  let version = 1;
  const sent: Array<{ ops: EditOp[]; baseHash: string }> = [];
  const refuse = new Set<string>();
  const deps: FormDeps = {
    async send(ops, baseHash) {
      sent.push({ ops, baseHash });
      await Promise.resolve();
      if (baseHash !== `h${version}`) throw new ApiFailure("PATCH", 409, { code: "conflict", message: "Changed" });
      const refused: EditResult["refused"] = [];
      ops.forEach((op, index) => {
        if ("path" in op && refuse.has(op.path.join("."))) {
          refused.push({ index, op, reason: "Not allowed" });
          return;
        }
        if (op.op === "body") body = op.value;
        else if ("path" in op) data = applyOpsLocal(data as JsonObject, [op as DataOp]);
      });
      version += 1;
      return { entry: entryOf(data as JsonObject, `h${version}`, body), applied: ops.length - refused.length, refused };
    },
    async reload() {
      return entryOf(data as JsonObject, `h${version}`, body);
    },
    onEntry: vi.fn(),
  };
  return {
    deps,
    sent,
    refuse,
    outside(next: JsonObject) {
      data = next;
      version += 1;
      return entryOf(next, `h${version}`, body);
    },
    get data() {
      return data as JsonObject;
    },
  };
}

const initial = { title: "Home", sections: [{ type: "hero", heading: "Hello" }, { type: "faq", heading: "Questions" }] };

describe("form store", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces typing into one set at the leaf", async () => {
    const engine = fakeEngine(initial);
    const store = createFormStore(entryOf(initial, "h1"), engine.deps);
    const path = ["sections", 0, "heading"];
    store.actions.edit(path, "H", { required: true });
    store.actions.edit(path, "Hi", { required: true });
    store.actions.edit(path, "Hi there", { required: true });
    expect(store.getState().data).toMatchObject({ sections: [{ heading: "Hi there" }, {}] });
    expect(engine.sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(engine.sent).toEqual([{ ops: [{ op: "set", path, value: "Hi there" }], baseHash: "h1" }]);
    expect(store.getState().hash).toBe("h2");
    expect(store.getState().saveState["sections.0.heading"]).toBe("saved");
  });

  it("sends on blur without waiting", async () => {
    const engine = fakeEngine(initial);
    const store = createFormStore(entryOf(initial, "h1"), engine.deps);
    store.actions.edit(["title"], "Welcome", { required: true });
    store.actions.commit(["title"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.sent).toHaveLength(1);
  });

  it("never races: later edits wait for the reply and use its hash", async () => {
    const engine = fakeEngine(initial);
    const store = createFormStore(entryOf(initial, "h1"), engine.deps);
    store.actions.edit(["title"], "One", { required: true, immediate: true });
    store.actions.edit(["sections", 1, "heading"], "Two", { required: true, immediate: true });
    store.actions.apply({ op: "move", path: ["sections"], from: 0, to: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.sent.map((call) => call.baseHash)).toEqual(["h1", "h2"]);
    expect(engine.sent[1]?.ops).toHaveLength(2);
    expect(engine.data).toMatchObject({ title: "One", sections: [{ type: "faq", heading: "Two" }, { type: "hero" }] });
    expect(store.getState().data).toEqual(engine.data);
  });

  it("sends the draft before a reorder so its path is still right", async () => {
    const engine = fakeEngine(initial);
    const store = createFormStore(entryOf(initial, "h1"), engine.deps);
    store.actions.edit(["sections", 0, "heading"], "Hero heading", { required: true });
    store.actions.apply({ op: "move", path: ["sections"], from: 0, to: 1 });
    await vi.advanceTimersByTimeAsync(600);
    expect(engine.sent[0]?.ops).toEqual([
      { op: "set", path: ["sections", 0, "heading"], value: "Hero heading" },
      { op: "move", path: ["sections"], from: 0, to: 1 },
    ]);
    expect(engine.data).toMatchObject({ sections: [{ type: "faq" }, { type: "hero", heading: "Hero heading" }] });
  });

  it("shows a refusal at the field and the stored value again", async () => {
    const engine = fakeEngine(initial);
    engine.refuse.add("title");
    const store = createFormStore(entryOf(initial, "h1"), engine.deps);
    store.actions.edit(["title"], "Nope", { required: true, immediate: true });
    expect(store.getState().data.title).toBe("Nope");
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().refusals.title).toBe("Not allowed");
    expect(store.getState().data.title).toBe("Home");
  });

  it("folds in an outside change without touching the field being typed in", async () => {
    const engine = fakeEngine(initial);
    const store = createFormStore(entryOf(initial, "h1"), engine.deps);
    store.actions.edit(["sections", 0, "heading"], "Still typ", { required: true });
    const fresh = engine.outside({ ...initial, title: "Assistant title" });
    store.actions.receive(fresh, "agent");
    expect(store.getState().data).toMatchObject({ title: "Assistant title", sections: [{ heading: "Still typ" }, {}] });
    expect(store.getState().outside?.origin).toBe("agent");
    await vi.advanceTimersByTimeAsync(500);
    expect(engine.sent[0]?.baseHash).toBe("h2");
    expect(engine.data).toMatchObject({ title: "Assistant title", sections: [{ heading: "Still typ" }, {}] });
  });

  it("folds in a copy written elsewhere in the app silently", () => {
    const engine = fakeEngine(initial);
    const store = createFormStore(entryOf(initial, "h1"), engine.deps);
    // Click-to-edit on the page saved the title; its copy reaches the form through the shared cache.
    store.actions.receive(engine.outside({ ...initial, title: "Typed on the page" }), null);
    expect(store.getState().data).toMatchObject({ title: "Typed on the page" });
    expect(store.getState().outside).toBeNull();
  });

  it("keeps the newer of a save reply and a copy that crossed it", async () => {
    const engine = fakeEngine(initial);
    const store = createFormStore(entryOf(initial, "h1"), engine.deps);
    store.actions.edit(["title"], "Mine", { required: true, immediate: true });
    // While the save is on its way, a copy written later (by the assistant) arrives.
    store.actions.receive(entryOf({ ...initial, title: "Mine", description: "Assistant" }, "h9", null, 9), "agent");
    expect(store.getState().data).not.toHaveProperty("description");
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().hash).toBe("h9");
    expect(store.getState().data).toMatchObject({ title: "Mine", description: "Assistant" });
    // An older copy arriving late is ignored.
    store.actions.edit(["title"], "Mine again", { required: true, immediate: true });
    store.actions.receive(entryOf(initial, "h0", null, 0), "external");
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().data.title).not.toBe("Home");
  });

  it("on a conflict, reloads and keeps what was typed to put back", async () => {
    const engine = fakeEngine(initial);
    const store = createFormStore(entryOf(initial, "h1"), engine.deps);
    engine.outside({ ...initial, title: "Changed on disk" });
    store.actions.edit(["sections", 1, "heading"], "My words", { required: true, immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    const state = store.getState();
    expect(state.conflict?.edits).toEqual([{ path: ["sections", 1, "heading"], value: "My words" }]);
    expect(state.data.title).toBe("Changed on disk");
    expect(state.data).toMatchObject({ sections: [{}, { heading: "Questions" }] });
    store.actions.reapply();
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.data).toMatchObject({ title: "Changed on disk", sections: [{}, { heading: "My words" }] });
    expect(store.getState().conflict).toBeNull();
  });

  it("on a conflict, keeps every reorder and removal it couldn't save, with the data each was made on", async () => {
    const engine = fakeEngine(initial);
    const store = createFormStore(entryOf(initial, "h1"), engine.deps);
    engine.outside({ ...initial, title: "Changed on disk" });
    store.actions.apply({ op: "move", path: ["sections"], from: 1, to: 0 }, { op: "remove", path: ["sections"], index: 1 });
    await vi.advanceTimersByTimeAsync(0);
    const structure = store.getState().conflict?.structure ?? [];
    expect(structure.map((loss) => loss.op.op)).toEqual(["move", "remove"]);
    // The removal is described against the order the move produced.
    expect((structure[1]?.data.sections as unknown[] | undefined)?.length).toBe(2);
    expect(structure[0]?.data).toMatchObject({ title: "Home" });
  });

  it("saves the body with the body op, debounced", async () => {
    const engine = fakeEngine(initial);
    const store = createFormStore(entryOf(initial, "h1", "Body"), engine.deps);
    store.actions.editBody("Body text");
    store.actions.editBody("Body text, more");
    await vi.advanceTimersByTimeAsync(500);
    expect(engine.sent[0]?.ops).toEqual([{ op: "body", value: "Body text, more" }]);
    expect(store.getState().body).toBe("Body text, more");
  });

  it("keeps a failed save queued until retried", async () => {
    const engine = fakeEngine(initial);
    let fail = true;
    const send = engine.deps.send;
    engine.deps.send = async (ops, hash) => {
      if (fail) throw new ApiFailure("PATCH", 0, { code: "internal", message: "Offline" });
      return send(ops, hash);
    };
    const store = createFormStore(entryOf(initial, "h1"), engine.deps);
    store.actions.edit(["title"], "Later", { required: true, immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().saveError).toBeTruthy();
    expect(store.getState().data.title).toBe("Later");
    fail = false;
    store.actions.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.data.title).toBe("Later");
    expect(store.getState().saveError).toBeNull();
  });
});

describe("form store events and transport, for an edition's additions", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("tells an immediate edit as a draft before it is sent", async () => {
    const engine = fakeEngine(initial);
    const store = createFormStore(entryOf(initial, "h1"), engine.deps);
    const events: Array<{ type: string; sentBefore: number }> = [];

    store.actions.onEvent((event) => events.push({ type: event.type, sentBefore: engine.sent.length }));
    store.actions.edit(["title"], "Home page", { required: true, immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(events[0]).toEqual({ type: "draft", sentBefore: 0 });
    expect(engine.sent).toHaveLength(1);
  });

  it("tells a newer copy once it is in place, and not the same copy again", () => {
    const engine = fakeEngine(initial);
    const store = createFormStore(entryOf(initial, "h1"), engine.deps);
    const received: string[] = [];

    store.actions.onEvent((event) => {
      if (event.type === "received") received.push(`${event.entry.hash}:${store.getState().hash}`);
    });
    const fresh = engine.outside({ ...initial, title: "From elsewhere" });

    store.actions.receive(fresh);
    store.actions.receive(fresh);
    expect(received).toEqual([`${fresh.hash}:${fresh.hash}`]);
  });

  it("takes its own send and reload back with setTransport(null)", async () => {
    const engine = fakeEngine(initial);
    const store = createFormStore(entryOf(initial, "h1"), engine.deps);
    const other = vi.fn(engine.deps.send);

    store.actions.setTransport({ send: other });
    store.actions.edit(["title"], "One", { required: true });
    store.actions.commit(["title"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(other).toHaveBeenCalledTimes(1);
    store.actions.setTransport(null);
    store.actions.edit(["title"], "Two", { required: true });
    store.actions.commit(["title"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(other).toHaveBeenCalledTimes(1);
    expect(engine.sent.map((one) => one.ops)).toEqual([[{ op: "set", path: ["title"], value: "One" }], [{ op: "set", path: ["title"], value: "Two" }]]);
  });
});
