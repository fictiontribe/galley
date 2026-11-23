import { describe, expect, it } from "vitest";
import type { BlockType, Field, FieldChange } from "@galley/core/types";
import { cleanSlugInput, slugProblem, suggestSlug, urlForSlug } from "@/features/content/collection/slug";
import { fromDateInput, fromDateTimeInput, isPickable, toDateInput, toDateTimeInput } from "@/features/content/form/dates";
import { insertId, moveId, reconcileIds, removeId } from "@/features/content/form/ids";
import { changeAt, editsWithin, putBackOp } from "@/features/content/form/marks";
import { lostStructure, mergeIntoForm, reapplyOps, typedEdits } from "@/features/content/form/merge";
import { blockScaffold, newListItem } from "@/features/content/form/scaffold";
import { blockLabel, itemSummary, plainLine } from "@/features/content/form/summary";

const str = (key: string, required = false): Field => ({ key, label: key, type: "string", required, source: "inferred" });

describe("suggestSlug", () => {
  it("turns a title into lowercase words joined by hyphens", () => {
    expect(suggestSlug("Five questions — before you extend!")).toBe("five-questions-before-you-extend");
    expect(suggestSlug("Café & Bar: what’s new")).toBe("cafe-and-bar-whats-new");
    expect(suggestSlug("   ")).toBe("");
  });

  it("cuts long titles at a word", () => {
    const slug = suggestSlug("word ".repeat(40));
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("tidies typed addresses and explains bad ones", () => {
    expect(cleanSlugInput("My New Page!")).toBe("my-new-page");
    expect(slugProblem("")).toMatch(/address/);
    expect(slugProblem("ok-slug")).toBeNull();
    expect(urlForSlug("/blog/{slug}/", "spring")).toBe("/blog/spring/");
    expect(urlForSlug("/{slug}/", "index")).toBe("/");
    expect(urlForSlug(null, "x")).toBeNull();
  });
});

describe("dates keep the stored format", () => {
  it("reads and writes plain dates", () => {
    expect(toDateInput("2026-10-14")).toBe("2026-10-14");
    expect(fromDateInput("2026-11-02", "2026-10-14")).toBe("2026-11-02");
    expect(fromDateInput("2026-11-02", "2026/10/14")).toBe("2026/11/02");
  });

  it("keeps the time and zone of a stored date-time when only the day changes", () => {
    expect(toDateInput("2026-10-14T09:30:00Z")).toBe("2026-10-14");
    expect(fromDateInput("2026-11-02", "2026-10-14T09:30:00Z")).toBe("2026-11-02T09:30:00Z");
  });

  it("reads and writes date-times without converting zones", () => {
    expect(toDateTimeInput("2026-10-14 09:30:15+01:00")).toBe("2026-10-14T09:30");
    expect(fromDateTimeInput("2026-10-15T10:45", "2026-10-14 09:30:15+01:00")).toBe("2026-10-15 10:45:15+01:00");
    expect(fromDateTimeInput("2026-10-15T10:45", undefined)).toBe("2026-10-15T10:45");
  });

  it("knows what the picker can't show", () => {
    expect(isPickable("14 October 2026", "date")).toBe(false);
    expect(isPickable("", "date")).toBe(true);
    expect(isPickable(undefined, "datetime")).toBe(true);
  });
});

describe("section summaries", () => {
  const fields = [str("eyebrow"), str("heading", true), str("text")];
  it("prefers the heading-like field over the first one", () => {
    expect(itemSummary({ type: "hero", eyebrow: "Studio", heading: "Make more of the *home*." }, fields)).toBe("Make more of the home.");
  });

  it("falls back to the first text, then nothing", () => {
    expect(itemSummary({ eyebrow: "Only this" }, fields)).toBe("Only this");
    expect(itemSummary({ type: "posts", limit: 3 }, fields)).toBe("");
    expect(itemSummary("A plain item", undefined)).toBe("A plain item");
  });

  it("makes one plain line", () => {
    expect(plainLine("A [link](/x/) and\n\n**bold**")).toBe("A link and bold");
    expect(plainLine("word ".repeat(40), 20).endsWith("…")).toBe(true);
  });

  it("labels a section by its type", () => {
    const field: Field = { key: "sections", label: "Sections", type: "blocks", required: false, source: "inferred", discriminator: "type", blocks: [{ type: "hero", label: "Hero", fields, count: 1 }] };
    expect(blockLabel({ type: "hero" }, field)).toBe("Hero");
    expect(blockLabel({ type: "mystery" }, field)).toBe("mystery");
  });
});

describe("new sections", () => {
  const block: BlockType = {
    type: "features",
    label: "Features",
    count: 2,
    fields: [
      str("heading", true),
      str("eyebrow"),
      { key: "columns", label: "Columns", type: "number", required: false, source: "inferred" },
      { key: "tone", label: "Tone", type: "select", required: false, source: "inferred", options: ["muted", "accent"] },
      { key: "items", label: "Items", type: "list", required: true, source: "inferred", of: { key: "item", label: "Item", type: "object", required: false, source: "inferred", fields: [str("heading", true), str("text")] } },
    ],
    example: { type: "features", tone: "muted", eyebrow: "What we do", heading: "Four ways", columns: 4, items: [{ heading: "A", text: "a" }, { heading: "B", text: "b" }] },
  };

  it("keeps the shape and settings, blanks the words", () => {
    expect(blockScaffold(block, "type")).toEqual({ type: "features", tone: "muted", heading: "", columns: 4, items: [{ heading: "" }] });
  });

  it("starts list items from the item's fields", () => {
    expect(newListItem(block.fields[4]?.of)).toEqual({ heading: "" });
    expect(newListItem(str("x"))).toBe("");
  });
});

describe("list keys", () => {
  let n = 0;
  const make = () => `n${++n}`;
  it("keeps keys by position when the length is the same", () => {
    expect(reconcileIds(["a", "b"], ["k1", "k2"], ["a", "B"], make)).toEqual(["k1", "k2"]);
  });

  it("follows equal items when something was added elsewhere", () => {
    const ids = reconcileIds([{ x: 1 }, { x: 2 }], ["k1", "k2"], [{ x: 0 }, { x: 1 }, { x: 2 }], make);
    expect(ids.slice(1)).toEqual(["k1", "k2"]);
    expect(ids[0]).toMatch(/^n/);
  });

  it("permutes with local list ops", () => {
    expect(moveId(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(insertId(["a", "b"], 1, "z")).toEqual(["a", "z", "b"]);
    expect(removeId(["a", "b", "c"], 1)).toEqual(["a", "c"]);
  });
});

describe("edited marks", () => {
  const changes: FieldChange[] = [
    { field: ["sections", 0, "heading"], label: "Sections › 1 (Hero) › Heading", kind: "changed", before: "Old", after: "New" },
    { field: ["sections", 0, "cta"], label: "CTA", kind: "added", after: { label: "Go" } },
    { field: ["sections", 2], label: "Sections › 3", kind: "added", after: { type: "faq" } },
  ];

  it("finds changes at and inside a path", () => {
    expect(changeAt(changes, ["sections", 0, "heading"])?.before).toBe("Old");
    expect(editsWithin(changes, ["sections", 0])).toBe(2);
    expect(editsWithin(changes, ["sections", 0, "cta", "label"])).toBe(0);
    expect(editsWithin(changes, ["sections", 2])).toBe(1);
    expect(editsWithin(changes, ["sections", 1])).toBe(0);
  });

  it("puts named fields back, not list positions", () => {
    expect(putBackOp(changes[0]!)).toEqual({ op: "set", path: ["sections", 0, "heading"], value: "Old" });
    expect(putBackOp(changes[1]!)).toEqual({ op: "unset", path: ["sections", 0, "cta"] });
    expect(putBackOp(changes[2]!)).toBeNull();
  });
});

describe("edited marks for list items", () => {
  // The logo row dragged below the feature tabs, the metrics' tone switched, an FAQ added, the old CTA removed.
  const changes: FieldChange[] = [
    { field: ["sections", 2], label: "Sections › 3 (Logo row)", kind: "moved", from: 1, to: 2 },
    { field: ["sections", 3, "tone"], label: "Sections › 4 (Metrics) › Tone", kind: "changed", before: "inverse", after: "muted" },
    { field: ["sections", 4], label: "Sections › 5 (FAQ)", kind: "added", after: { type: "faq" } },
    { field: ["sections", 5], label: "Sections › 6 (Call to action)", kind: "removed", before: { type: "cta", heading: "Go" } },
  ];

  it("marks a moved section where it is now, and a removed one only on its list", () => {
    expect(changeAt(changes, ["sections", 2])?.kind).toBe("moved");
    expect(editsWithin(changes, ["sections", 2])).toBe(1);
    // Whatever sits at the removed section's old position now isn't marked by it.
    expect(changeAt(changes, ["sections", 5])).toBeUndefined();
    expect(editsWithin(changes, ["sections", 5])).toBe(0);
    expect(editsWithin(changes, ["sections"])).toBe(4);
  });

  it("puts each list row back from the rows of its list", () => {
    expect(putBackOp(changes[0]!, changes)).toEqual({ op: "move", path: ["sections"], from: 2, to: 1 });
    expect(putBackOp(changes[1]!, changes)).toEqual({ op: "set", path: ["sections", 3, "tone"], value: "inverse" });
    expect(putBackOp(changes[2]!, changes)).toEqual({ op: "remove", path: ["sections"], index: 4 });
    // Published order: hero, logos, tabs, metrics, use cases, CTA, … → it goes back after the use cases (now at 5).
    expect(putBackOp(changes[3]!, changes)).toEqual({ op: "insert", path: ["sections"], index: 6, value: { type: "cta", heading: "Go" } });
  });

  it("offers no list op without the list's rows (the field's own button stays away)", () => {
    expect(putBackOp(changes[0]!)).toBeNull();
    expect(putBackOp(changes[3]!)).toBeNull();
    expect(putBackOp(changes[0]!, [changes[1]!])).toBeNull();
  });
});

describe("outside changes", () => {
  const stored = { title: "Home", sections: [{ heading: "A" }, { heading: "B" }] };

  it("keeps what is being typed and what is on its way", () => {
    const shown = { title: "Home", sections: [{ heading: "A" }, { heading: "B" }] };
    const fresh = { title: "Home (assistant)", sections: [{ heading: "A" }, { heading: "B" }], description: "New" };
    const merged = mergeIntoForm(shown, fresh, [{ op: "set", path: ["sections", 1, "heading"], value: "B2" }], [{ path: ["sections", 0, "heading"], value: "A typing" }]);
    expect(merged.title).toBe("Home (assistant)");
    expect(merged.description).toBe("New");
    expect(merged).toMatchObject({ sections: [{ heading: "A typing" }, { heading: "B2" }] });
  });

  it("reuses unchanged parts of what was shown", () => {
    const shown = stored;
    const fresh = JSON.parse(JSON.stringify(stored)) as typeof stored;
    fresh.title = "Changed";
    const merged = mergeIntoForm(shown, fresh, [], []);
    expect(merged.sections).toBe(stored.sections);
  });

  it("collects lost edits for a conflict and puts back only what's missing", () => {
    const lost = typedEdits([
      { op: "set", path: ["title"], value: "One" },
      { op: "set", path: ["title"], value: "Two" },
      { op: "unset", path: ["subtitle"] },
      { op: "move", path: ["sections"], from: 0, to: 1 },
    ]);
    expect(lost).toEqual([
      { path: ["title"], value: "Two" },
      { path: ["subtitle"], value: undefined },
    ]);
    expect(lostStructure([{ op: "move", path: ["sections"], from: 0, to: 1 }])).toBe(true);
    expect(reapplyOps(lost, { title: "Two" })).toEqual([]);
    expect(reapplyOps(lost, { title: "Other", subtitle: "x" })).toEqual([
      { op: "set", path: ["title"], value: "Two" },
      { op: "unset", path: ["subtitle"] },
    ]);
  });
});

describe("naming reorders and removals a conflict kept from saving", () => {
  const inner = [str("heading")];
  const sections: Field = {
    key: "sections",
    label: "Sections",
    type: "blocks",
    required: false,
    source: "inferred",
    discriminator: "type",
    blocks: [
      { type: "hero", label: "Hero", fields: inner, count: 1 },
      { type: "steps", label: "Steps", fields: inner, count: 1 },
    ],
  };
  const data = { sections: [{ type: "hero", heading: "A" }, { type: "steps", heading: "B" }] };

  it("says what moved, was added or was removed, by its section name", async () => {
    const { describeStructureLoss } = await import("@/features/content/form/labels");
    expect(describeStructureLoss([sections], { op: { op: "move", path: ["sections"], from: 1, to: 0 }, data })).toBe("Moved “Steps” in Sections (to position 1)");
    expect(describeStructureLoss([sections], { op: { op: "remove", path: ["sections"], index: 0 }, data })).toBe("Removed “Hero” from Sections");
    expect(describeStructureLoss([sections], { op: { op: "insert", path: ["sections"], index: 2, value: { type: "steps" } }, data })).toBe("Added “Steps” to Sections");
  });
});

describe("scrolling the form while dragging near its edge", () => {
  it("scrolls up near the top, down near the bottom, faster closer to the edge, and not in between", async () => {
    const { edgeScrollSpeed } = await import("@/features/content/fields/items/reorder");
    expect(edgeScrollSpeed(300, 100, 700)).toBe(0);
    expect(edgeScrollSpeed(110, 100, 700)).toBeLessThan(0);
    expect(edgeScrollSpeed(101, 100, 700)).toBeLessThan(edgeScrollSpeed(140, 100, 700));
    expect(edgeScrollSpeed(690, 100, 700)).toBeGreaterThan(0);
    expect(edgeScrollSpeed(60, 100, 700)).toBe(-18);
    expect(edgeScrollSpeed(400, 100, 100)).toBe(0);
  });
});
