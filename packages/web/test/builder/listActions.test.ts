import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditOp, EditResult, Entry, JsonValue } from "@galley/core/types";
import { listActions, onListChange, undoLastListAction } from "@/features/content/fields/items/listActions";
import { followIndex, planDuplicate, planInsert, planMove, planRemove, planStep } from "@/features/content/fields/items/listPlan";
import { applyOpsLocal, type DataOp } from "@/features/content/form/ops";
import type { JsonObject } from "@/features/content/form/paths";
import { createFormStore, type FormDeps } from "@/features/content/form/store";
import { useToasts } from "@/lib/stores/toasts";

/** A pretend engine whose file text is the data as JSON, so "byte for byte" can be checked. */
function engine(initial: JsonObject) {
  let data: JsonObject = initial;
  let version = 1;
  const sent: EditOp[][] = [];
  const refuse = new Set<string>();
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
    async send(ops, baseHash) {
      sent.push(ops);
      await Promise.resolve();
      if (baseHash !== `h${version}`) throw new Error("stale");
      const refused: EditResult["refused"] = [];
      ops.forEach((op, index) => {
        if (op.op === "raw") data = JSON.parse(op.value) as JsonObject;
        else if ("path" in op && refuse.has(op.op)) refused.push({ index, op, reason: "That move isn’t possible." });
        else if ("path" in op) data = applyOpsLocal(data, [op as DataOp]);
      });
      version += 1;
      return { entry: entry(), applied: ops.length - refused.length, refused };
    },
    reload: async () => entry(),
    onEntry: vi.fn(),
  };
  return { deps, sent, refuse, entry, get raw() { return JSON.stringify(data, null, 1); } };
}

const START = { sections: [{ type: "hero", heading: "Welcome" }, { type: "features", heading: "What we do" }, { type: "steps", heading: "How" }, { type: "cta", heading: "Call us" }] };
const label = (item: JsonValue | undefined) => (item && typeof item === "object" && !Array.isArray(item) ? String(item.type) : "Section");

describe("list plans", () => {
  it("each action is one op, with its inverse", () => {
    expect(planMove(["s"], 4, 0, 3)).toMatchObject({ ops: [{ op: "move", path: ["s"], from: 0, to: 3 }], undo: [{ op: "move", from: 3, to: 0 }], index: 3 });
    expect(planMove(["s"], 4, 1, 1)).toBeNull();
    expect(planStep(["s"], 4, 3, 1)).toBeNull();
    expect(planDuplicate(["s"], ["a", "b"], 0)).toMatchObject({ ops: [{ op: "insert", index: 1, value: "a" }], undo: [{ op: "remove", index: 1 }] });
    expect(planRemove(["s"], ["a", "b"], 1)).toMatchObject({ ops: [{ op: "remove", index: 1 }], undo: [{ op: "insert", index: 1, value: "b" }], index: null });
    expect(planInsert(["s"], 2, 3, "x")).toBeNull();
  });

  it("follows an item through a reorder", () => {
    expect(followIndex(0, { kind: "move", from: 0, to: 3 })).toBe(3);
    expect(followIndex(2, { kind: "move", from: 0, to: 3 })).toBe(1);
    expect(followIndex(1, { kind: "move", from: 3, to: 0 })).toBe(2);
    expect(followIndex(2, { kind: "insert", index: 1 })).toBe(3);
    expect(followIndex(2, { kind: "remove", index: 2 })).toBeNull();
    expect(followIndex(3, { kind: "remove", index: 2 })).toBe(2);
  });
});

describe("list actions on the entry's queue", () => {
  beforeEach(() => useToasts.setState({ toasts: [] }));
  afterEach(() => vi.useRealTimers());

  it("a drag sends one move with the entry's hash and offers Undo", async () => {
    const fake = engine(START);
    const store = createFormStore(fake.entry(), fake.deps);
    const changes: unknown[] = [];
    onListChange(store, ["sections"], (change) => changes.push(change));
    const result = listActions({ store, path: ["sections"], noun: "section", label }).move(0, 3);
    expect(store.getState().data.sections).toMatchObject([{ type: "features" }, { type: "steps" }, { type: "cta" }, { type: "hero" }]);
    expect(await result?.done).toBe(true);
    expect(fake.sent).toEqual([[{ op: "move", path: ["sections"], from: 0, to: 3 }]]);
    expect(changes).toEqual([{ kind: "move", from: 0, to: 3 }]);
    expect(useToasts.getState().toasts.at(-1)).toMatchObject({ title: "hero moved", action: { label: "Undo" } });
  });

  it("Undo after a removal puts the file back byte for byte", async () => {
    const fake = engine(START);
    const before = fake.raw;
    const store = createFormStore(fake.entry(), fake.deps);
    const result = listActions({ store, path: ["sections"], noun: "section", label }).remove(1);
    expect(await result?.done).toBe(true);
    expect(fake.raw).not.toBe(before);
    useToasts.getState().toasts.at(-1)?.action?.onClick();
    await store.actions.flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.sent.at(-1)?.[0]?.op).toBe("raw");
    expect(fake.raw).toBe(before);
  });

  it("Undo falls back to the inverse op when something else changed since", async () => {
    const fake = engine(START);
    const store = createFormStore(fake.entry(), fake.deps);
    await listActions({ store, path: ["sections"], noun: "section", label }).remove(0)?.done;
    store.actions.edit(["sections", 0, "heading"], "Changed", { required: true, immediate: true });
    await store.actions.flush();
    expect(undoLastListAction(store)).toBe(true);
    await store.actions.flush();
    expect(fake.sent.at(-1)).toEqual([{ op: "insert", path: ["sections"], index: 0, value: { type: "hero", heading: "Welcome" } }]);
  });

  it("a refused edit says why and leaves nothing to undo", async () => {
    const fake = engine(START);
    fake.refuse.add("move");
    const store = createFormStore(fake.entry(), fake.deps);
    expect(await listActions({ store, path: ["sections"], noun: "section", label }).move(0, 2)?.done).toBe(false);
    expect(useToasts.getState().toasts.at(-1)).toMatchObject({ tone: "danger", title: "Couldn’t change “hero”" });
    expect(undoLastListAction(store)).toBe(false);
  });

  it("keyboard steps don't raise a toast but ⌘Z still undoes them", async () => {
    const fake = engine(START);
    const store = createFormStore(fake.entry(), fake.deps);
    await listActions({ store, path: ["sections"], noun: "section", label }).step(0, 1)?.done;
    expect(useToasts.getState().toasts).toHaveLength(0);
    const after = fake.raw;
    expect(undoLastListAction(store)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await store.actions.flush();
    expect(fake.raw).not.toBe(after);
    expect((JSON.parse(fake.raw) as typeof START).sections[0]?.type).toBe("hero");
  });
});
