/**
 * The page's mark on the form store (content/form/store.ts `fromPage`): any
 * change a message from the previewed page applies taints the store until its
 * next save, and that save is sent marked (the server then holds it to what an
 * account below build-mode level may change). Nothing lists message types.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditOp, EditResult, Entry } from "@galley/core/types";
import { ApiFailure } from "@/lib/api";
import { listActions, undoLastListAction } from "@/features/content/fields/items/listActions";
import { applyOpsLocal, type DataOp } from "@/features/content/form/ops";
import type { JsonObject } from "@/features/content/form/paths";
import { createFormStore, type FormDeps } from "@/features/content/form/store";

/** A pretend engine that records whether each save came marked, and can refuse a whole-file save. */
function engine(initial: JsonObject) {
  let data: JsonObject = initial;
  let version = 1;
  const sent: Array<{ ops: EditOp[]; marked: boolean }> = [];
  const state: { refuseRaw: boolean; reloadGate: Promise<void>; reloading: boolean } = { refuseRaw: false, reloadGate: Promise.resolve(), reloading: false };
  const entry = (): Entry => ({
    path: "src/content/pages/index.md",
    collection: "pages",
    slug: "index",
    title: "Home",
    titleSource: "field",
    url: "/",
    status: "modified",
    modifiedAt: version,
    format: "markdown",
    data,
    body: null,
    raw: JSON.stringify(data, null, 1),
    hash: `h${version}`,
    fields: [],
    issues: [],
  });
  const deps: FormDeps = {
    async send(ops, baseHash, viaPreview) {
      sent.push({ ops, marked: viaPreview === true });
      await Promise.resolve();
      if (baseHash !== `h${version}`) throw new ApiFailure("PATCH", 409, { code: "conflict", message: "Changed" });
      if (state.refuseRaw && ops.some((op) => op.op === "raw")) return { entry: entry(), applied: 0, refused: ops.map((op, index) => ({ index, op, reason: "Not from the page." })) };
      for (const op of ops) {
        if (op.op === "raw") data = JSON.parse(op.value) as JsonObject;
        else if ("path" in op) data = applyOpsLocal(data, [op as DataOp]);
      }
      version += 1;
      return { entry: entry(), applied: ops.length, refused: [] } satisfies EditResult;
    },
    reload: async () => {
      state.reloading = true;
      await state.reloadGate;
      return entry();
    },
    onEntry: vi.fn(),
  };
  return {
    deps,
    sent,
    state,
    entry,
    /** Someone else saved meanwhile: the next save meets a newer version. */
    bump() {
      version += 1;
    },
  };
}

const START = { title: "Home", sections: [{ type: "hero" }, { type: "cta" }] };

afterEach(() => {
  vi.useRealTimers();
});

describe("the page's mark on the form", () => {
  it("sends a change a page message applies marked, and a person's own change unmarked", async () => {
    const fake = engine(START);
    const store = createFormStore(fake.entry(), fake.deps);

    store.actions.fromPage(() => store.actions.apply({ op: "set", path: ["title"], value: "From the page" }));
    await store.actions.flush();
    store.actions.apply({ op: "set", path: ["title"], value: "From the person" });
    await store.actions.flush();

    expect(fake.sent.map((save) => save.marked)).toEqual([true, false]);
  });

  it("keeps a page draft marked when its timer sends it later", async () => {
    vi.useFakeTimers();
    const fake = engine(START);
    const store = createFormStore(fake.entry(), fake.deps);

    store.actions.fromPage(() => store.actions.edit(["title"], "Typed by the page", { required: false }));
    await vi.advanceTimersByTimeAsync(2000);
    await store.actions.flush();

    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]!.marked).toBe(true);
  });

  it("marks what a page message starts and finishes later: a list action and its Undo, both the exact restore and the reverse ops", async () => {
    const fake = engine(START);
    const store = createFormStore(fake.entry(), fake.deps);
    const actions = listActions({ store, path: ["sections"], noun: "section", label: () => "Section" });

    store.actions.fromPage(() => actions.move(0, 1));
    await store.actions.flush();
    // The page asks to undo: the exact restore goes as a whole-file save, marked.
    await new Promise<void>((done) => store.actions.fromPage(() => undoLastListAction(store, done)));
    expect(fake.sent.map((save) => [save.ops[0]?.op, save.marked])).toEqual([
      ["move", true],
      ["raw", true],
    ]);

    // Again, with the exact restore refused: the reverse ops, applied after the wait, are marked too.
    fake.state.refuseRaw = true;
    store.actions.fromPage(() => actions.move(0, 1));
    await store.actions.flush();
    await new Promise<void>((done) => store.actions.fromPage(() => undoLastListAction(store, done)));
    await store.actions.flush();
    expect(fake.sent.slice(2).map((save) => [save.ops[0]?.op, save.marked])).toEqual([
      ["move", true],
      ["raw", true],
      ["move", true],
    ]);
  });

  it("leaves a person's own Undo unmarked", async () => {
    const fake = engine(START);
    const store = createFormStore(fake.entry(), fake.deps);
    const actions = listActions({ store, path: ["sections"], noun: "section", label: () => "Section" });

    actions.move(0, 1);
    await store.actions.flush();
    await new Promise<void>((done) => undoLastListAction(store, done));

    expect(fake.sent.every((save) => !save.marked)).toBe(true);
  });

  it("sends a whole-file save a page message asks for marked, and a person's unmarked", async () => {
    const fake = engine(START);
    const store = createFormStore(fake.entry(), fake.deps);

    await store.actions.fromPage(() => store.actions.saveRaw(JSON.stringify({ ...START, title: "Page" }, null, 1)));
    await store.actions.saveRaw(JSON.stringify({ ...START, title: "Person" }, null, 1));

    expect(fake.sent.map((save) => save.marked)).toEqual([true, false]);
  });

  it("puts back a marked save that met a conflict still marked", async () => {
    const fake = engine(START);
    const store = createFormStore(fake.entry(), fake.deps);

    fake.bump();
    store.actions.fromPage(() => store.actions.apply({ op: "set", path: ["title"], value: "From the page" }));
    await vi.waitFor(() => expect(store.getState().conflict).not.toBeNull());
    expect(store.getState().conflict?.viaPreview).toBe(true);
    store.actions.reapply();
    await store.actions.flush();

    expect(fake.sent.at(-1)!.marked).toBe(true);
  });

  it("keeps a page change made while a conflict reloads marked", async () => {
    const fake = engine(START);
    const store = createFormStore(fake.entry(), fake.deps);
    let open!: () => void;

    fake.state.reloadGate = new Promise<void>((resolve) => (open = resolve));
    fake.bump();
    // A person's own save meets a newer version: the store reloads.
    store.actions.apply({ op: "set", path: ["title"], value: "Person" });
    await vi.waitFor(() => expect(fake.state.reloading).toBe(true));
    // While the reload is on its way, the page moves a section.
    store.actions.fromPage(() => store.actions.apply({ op: "move", path: ["sections"], from: 0, to: 1 }));
    open();
    await vi.waitFor(() => expect(store.getState().conflict).not.toBeNull());
    await store.actions.flush();

    const pageSaves = fake.sent.filter((save) => save.ops.some((op) => op.op === "move"));

    expect(pageSaves.length).toBeGreaterThan(0);
    expect(pageSaves.every((save) => save.marked)).toBe(true);
  });
});
