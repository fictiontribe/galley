import { describe, expect, it } from "vitest";
import { applyOpLocal, applyOpsLocal, moveItem, stepOp, valueOps } from "@/features/content/form/ops";
import { getAt, setAt, share, unsetAt, type JsonObject } from "@/features/content/form/paths";

const doc: { title: string; empty: string; sections: JsonObject[] } = {
  title: "Home",
  empty: "",
  sections: [
    { type: "hero", heading: "Hello", cta: { label: "Go", href: "/go/" } },
    { type: "faq", items: [{ q: "One" }, { q: "Two" }] },
  ],
};

describe("valueOps", () => {
  it("sets the leaf that changed and nothing else", () => {
    expect(valueOps({ path: ["sections", 0, "heading"], next: "Hi", stored: doc, required: true })).toEqual([
      { op: "set", path: ["sections", 0, "heading"], value: "Hi" },
    ]);
  });

  it("sends nothing when the value is what's stored", () => {
    expect(valueOps({ path: ["title"], next: "Home", stored: doc, required: true })).toEqual([]);
  });

  it("unsets a cleared optional field", () => {
    expect(valueOps({ path: ["sections", 0, "cta", "href"], next: "", stored: doc, required: false })).toEqual([
      { op: "unset", path: ["sections", 0, "cta", "href"] },
    ]);
    expect(valueOps({ path: ["sections", 0, "cta", "label"], next: undefined, stored: doc, required: false })).toEqual([
      { op: "unset", path: ["sections", 0, "cta", "label"] },
    ]);
  });

  it("keeps a required field as an empty string", () => {
    expect(valueOps({ path: ["title"], next: "", stored: doc, required: true })).toEqual([{ op: "set", path: ["title"], value: "" }]);
  });

  it("leaves a field that already held an empty string alone", () => {
    expect(valueOps({ path: ["empty"], next: "", stored: doc, required: false })).toEqual([]);
  });

  it("does nothing for a cleared optional field that was never there", () => {
    expect(valueOps({ path: ["subtitle"], next: "", stored: doc, required: false })).toEqual([]);
  });

  it("unsets a key inside a list item, but empties a list position instead of unsetting it", () => {
    expect(valueOps({ path: ["sections", 1, "items", 0, "q"], next: "", stored: doc, required: false })).toEqual([
      { op: "unset", path: ["sections", 1, "items", 0, "q"] },
    ]);
    const list = { tags: ["a", "b"] };
    expect(valueOps({ path: ["tags", 1], next: "", stored: list, required: false })).toEqual([{ op: "set", path: ["tags", 1], value: "" }]);
  });

  it("adds a nested field without rewriting its group", () => {
    expect(valueOps({ path: ["sections", 0, "secondary", "label"], next: "More", stored: doc, required: false })).toEqual([
      { op: "set", path: ["sections", 0, "secondary", "label"], value: "More" },
    ]);
  });
});

describe("applyOpLocal", () => {
  it("applies list ops the way the engine does", () => {
    const moved = applyOpLocal(doc, { op: "move", path: ["sections"], from: 0, to: 1 });
    expect(moved.ok && getAt(moved.value, ["sections", 1, "type"])).toBe("hero");
    const inserted = applyOpLocal(doc, { op: "insert", path: ["sections", 1, "items"], index: 2, value: { q: "Three" } });
    expect(inserted.ok && getAt(inserted.value, ["sections", 1, "items", 2, "q"])).toBe("Three");
    const removed = applyOpLocal(doc, { op: "remove", path: ["sections"], index: 0 });
    expect(removed.ok && getAt(removed.value, ["sections", 0, "type"])).toBe("faq");
  });

  it("refuses what the engine would refuse", () => {
    expect(applyOpLocal(doc, { op: "move", path: ["sections"], from: 0, to: 5 }).ok).toBe(false);
    expect(applyOpLocal(doc, { op: "remove", path: ["title"], index: 0 }).ok).toBe(false);
    expect(applyOpLocal(doc, { op: "set", path: ["sections", 9], value: 1 }).ok).toBe(false);
  });

  it("skips ops that no longer fit and keeps going", () => {
    const out = applyOpsLocal(doc, [
      { op: "remove", path: ["sections"], index: 7 },
      { op: "set", path: ["title"], value: "New" },
    ]);
    expect(out.title).toBe("New");
  });

  it("creates a list on insert into a missing one", () => {
    const out = applyOpsLocal(doc, [{ op: "insert", path: ["tags"], index: 0, value: "x" }]);
    expect(out.tags).toEqual(["x"]);
  });
});

describe("list helpers", () => {
  it("moves an item to its final position", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("steps up and down within bounds", () => {
    expect(stepOp(["s"], 0, 3, -1)).toBeNull();
    expect(stepOp(["s"], 2, 3, 1)).toBeNull();
    expect(stepOp(["s"], 1, 3, 1)).toEqual({ op: "move", path: ["s"], from: 1, to: 2 });
  });
});

describe("paths", () => {
  it("copies only the containers along the path", () => {
    const next = setAt(doc, ["sections", 0, "heading"], "Hi") as typeof doc;
    expect(next.sections[1]).toBe(doc.sections[1]);
    expect(next.sections[0]?.cta).toBe(doc.sections[0]?.cta);
    expect(next.sections[0]?.heading).toBe("Hi");
    expect(doc.sections[0]?.heading).toBe("Hello");
  });

  it("returns the same object when nothing changes", () => {
    expect(setAt(doc, ["title"], "Home")).toBe(doc);
    expect(unsetAt(doc, ["missing"])).toBe(doc);
  });

  it("shares equal subtrees of a fresh copy", () => {
    const fresh = JSON.parse(JSON.stringify(doc)) as typeof doc;
    fresh.sections[0]!.heading = "Changed";
    const shared = share(doc, fresh);
    expect(shared.sections[1]).toBe(doc.sections[1]);
    expect(shared.sections[0]?.cta).toBe(doc.sections[0]?.cta);
    expect(shared.sections[0]).not.toBe(doc.sections[0]);
    expect(share(doc, JSON.parse(JSON.stringify(doc)))).toBe(doc);
  });
});
