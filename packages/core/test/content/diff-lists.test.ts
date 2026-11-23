/**
 * Lists in the Proof's "what changed": moves, adds, removes and edits of
 * sections and items must each be one true row, never a field-by-field
 * comparison of two different sections.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildEntry, diffFields, loadSiteModel, summarizeChange } from "../../src/content/index";
import type { Collection, FieldChange, FieldPath, JsonValue } from "../../src/types";

// Speed limits are for a quiet laptop; a shared CI runner or a busy machine gets room, and the test still fails if the work stops scaling.
const SLACK = process.env.CI ? 10 : 3;

type Json = { [key: string]: JsonValue };

const STARTER = fileURLToPath(new URL("../../../../starters/astro-saas", import.meta.url));
const model = await loadSiteModel(STARTER);
const pages: Collection = model.collections.find((collection) => collection.id === "pages")!;
const home = buildEntry(model, "src/content/pages/index.md", await readFile(`${STARTER}/src/content/pages/index.md`, "utf8"), { mtimeMs: 0 }).data as Json;
const sectionsOf = (data: Json) => data.sections as Json[];

/** Rows without their (bulky) values, for readable expectations. */
const brief = (changes: FieldChange[]) =>
  changes.map((change) => [change.label, change.kind, ...(change.kind === "moved" ? [change.from, change.to] : [])]);
const summary = (changes: FieldChange[]) => summarizeChange({ status: "modified", fieldChanges: changes, bodyChanged: false });

function moveItem<T>(list: T[], from: number, to: number): void {
  const [item] = list.splice(from, 1);

  list.splice(to, 0, item!);
}

describe("the home page case from the page builder", () => {
  it("reads a dragged logo row, a tone switch and a new FAQ as three true rows", () => {
    const after = structuredClone(home);
    const sections = sectionsOf(after);

    expect(sections.slice(0, 4).map((section) => section.type)).toEqual(["hero-split", "logos", "feature-tabs", "metrics"]);
    moveItem(sections, 1, 2);
    sections[3]!.tone = "muted";
    sections.splice(4, 0, { type: "faq", heading: "", items: [{ question: "", answer: "" }] });
    const changes = diffFields(pages, home, after);

    expect(brief(changes)).toEqual([
      ["Sections › 3 (Logo row)", "moved", 1, 2],
      ["Sections › 4 (Metrics) › Tone", "changed"],
      ["Sections › 5 (FAQ)", "added"],
    ]);
    expect(changes[0]).toEqual({ field: ["sections", 2], label: "Sections › 3 (Logo row)", kind: "moved", from: 1, to: 2 });
    expect(changes[1]).toMatchObject({ field: ["sections", 3, "tone"], before: "inverse", after: "muted" });
    expect(summary(changes)).toBe("Moved the logo row, added an FAQ section and changed 1 other field.");
  });
});

describe("moves", () => {
  const sections = (): Json[] => [
    { type: "hero", heading: "One", text: "First words" },
    { type: "logos", heading: "Two", text: "Second words" },
    { type: "features", heading: "Three", text: "Third words" },
    { type: "metrics", heading: "Four", text: "Fourth words" },
    { type: "cta", heading: "Five", text: "Fifth words" },
  ];
  const diff = (after: Json[]) => diffFields(pages, { sections: sections() }, { sections: after });

  it("reads one section moved down as one move", () => {
    const after = sections();

    moveItem(after, 0, 3);
    expect(brief(diff(after))).toEqual([["Sections › 4 (Hero)", "moved", 0, 3]]);
  });

  it("reads one section moved up as one move, of the one that moved", () => {
    const after = sections();

    moveItem(after, 4, 1);
    expect(brief(diff(after))).toEqual([["Sections › 2 (Call to action)", "moved", 4, 1]]);
    expect(summary(diff(after))).toBe("Moved the call to action.");
  });

  it("reads a swap of neighbours as one move of the first", () => {
    const after = sections();

    moveItem(after, 1, 2);
    expect(brief(diff(after))).toEqual([["Sections › 3 (Logo row)", "moved", 1, 2]]);
  });

  it("reports a moved and edited section as a move plus its edits at the new place", () => {
    const after = sections();

    moveItem(after, 1, 3);
    after[3]!.heading = "Two, renamed";
    after[3]!.tone = "muted";
    expect(diff(after)).toEqual([
      { field: ["sections", 3], label: "Sections › 4 (Logo row)", kind: "moved", from: 1, to: 3 },
      { field: ["sections", 3, "tone"], label: "Sections › 4 (Logo row) › Tone", kind: "added", after: "muted" },
      { field: ["sections", 3, "heading"], label: "Sections › 4 (Logo row) › Heading", kind: "changed", before: "Two", after: "Two, renamed" },
    ]);
  });

  it("prefers the items that travelled furthest when two readings move as few", () => {
    // [1,2,3,4,5] → [4,1,2,5,3]: either 4 and 3 moved, or 4 and 5 did. 3 passed two items, 5 only one.
    const after = sections();
    const order = [3, 0, 1, 4, 2].map((index) => sections()[index]!);

    after.splice(0, after.length, ...order);
    expect(brief(diff(after))).toEqual([
      ["Sections › 1 (Metrics)", "moved", 3, 0],
      ["Sections › 5 (Feature grid)", "moved", 2, 4],
    ]);
  });

  it("counts distance in items passed, so a removal elsewhere doesn't change the reading", () => {
    const before = [{ type: "hero", heading: "a" }, { type: "cta", heading: "gone" }, { type: "features", heading: "b" }, { type: "metrics", heading: "c" }];
    const swapped = [before[0]!, before[3]!, before[2]!];

    // b and c traded places; with or without the removal, b (the first) is the one that moved.
    expect(brief(diffFields(pages, { sections: before }, { sections: swapped }))).toEqual([
      ["Sections › 2 (Call to action)", "removed"],
      ["Sections › 3 (Feature grid)", "moved", 2, 2],
    ]);
    expect(brief(diffFields(pages, { sections: before }, { sections: [before[0]!, before[1]!, before[3]!, before[2]!] }))).toEqual([["Sections › 4 (Feature grid)", "moved", 2, 3]]);
  });
});

describe("adds, removes and replacements", () => {
  const before: Json[] = [
    { type: "hero", heading: "Welcome", text: "Hello there" },
    { type: "features", heading: "What we do", text: "Three things" },
    { type: "cta", heading: "Get going", text: "Today" },
  ];
  const diff = (after: Json[]) => diffFields(pages, { sections: before }, { sections: after });

  it("reads an insert in the middle as one added section", () => {
    const faq = { type: "faq", heading: "Questions" };

    expect(diff([before[0]!, faq, before[1]!, before[2]!])).toEqual([{ field: ["sections", 1], label: "Sections › 2 (FAQ)", kind: "added", after: faq }]);
  });

  it("reads a removal in the middle as one removed section", () => {
    expect(diff([before[0]!, before[2]!])).toEqual([{ field: ["sections", 1], label: "Sections › 2 (Feature grid)", kind: "removed", before: before[1] }]);
    expect(summary(diff([before[0]!, before[2]!]))).toBe("Removed the feature grid.");
  });

  it("never pairs a removed section with an added one of another type", () => {
    const metrics = { type: "metrics", heading: "What we do", text: "Three things" };
    const rows = diff([before[0]!, metrics, before[2]!]);

    expect(brief(rows)).toEqual([
      ["Sections › 2 (Feature grid)", "removed"],
      ["Sections › 2 (Metrics)", "added"],
    ]);
    expect(summary(rows)).toBe("Added a metrics section and removed the feature grid.");
  });

  it("pairs a same-type replacement that keeps most of its values", () => {
    const edited = { type: "features", heading: "What we really do", text: "Three things" };

    expect(brief(diff([before[0]!, edited, before[2]!]))).toEqual([["Sections › 2 (Feature grid) › Heading", "changed"]]);
  });

  it("pairs by likeness, not by position", () => {
    // Two edited items of one type, reordered: each is paired with its own earlier self.
    const items = [
      { label: "Plan", text: "Every recurring task on one calendar" },
      { label: "Inspect", text: "Checklists on the phone, even in the plant room" },
    ];
    const afterItems = [
      { label: "Inspect", text: "Checklists on the phone, even underground" },
      { label: "Plan", text: "Every recurring task on one shared calendar" },
    ];
    const rows = diffFields(pages, { sections: [{ type: "features", heading: "H", items }] }, { sections: [{ type: "features", heading: "H", items: afterItems }] });

    // A swap of neighbours: the first one is the one that moved.
    expect(brief(rows)).toEqual([
      ["Sections › 1 (Feature grid) › Items › 1 › Text", "changed"],
      ["Sections › 1 (Feature grid) › Items › 2", "moved", 0, 1],
      ["Sections › 1 (Feature grid) › Items › 2 › Text", "changed"],
    ]);
    expect(rows[0]).toMatchObject({ before: "Checklists on the phone, even in the plant room", after: "Checklists on the phone, even underground" });
  });

  it("keeps a one-field item edit in place as a field change", () => {
    const rows = diffFields(pages, { sections: [{ type: "features", items: [{ label: "Plan" }, { label: "Fix" }] }] }, { sections: [{ type: "features", items: [{ label: "Schedule" }, { label: "Fix" }] }] });

    expect(brief(rows)).toEqual([["Sections › 1 (Feature grid) › Items › 1 › Label", "changed"]]);
  });
});

describe("identical items", () => {
  const card = { type: "cta", heading: "Same" };
  const other = { type: "hero", heading: "Other" };

  it("moves one of two identical copies without guessing which is which", () => {
    const rows = diffFields(pages, { sections: [card, other, card] }, { sections: [other, card, card] });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("moved");
  });

  it("reads a dropped copy as removed, at the place that keeps everything else still", () => {
    expect(brief(diffFields(pages, { sections: [card, other, card] }, { sections: [other, card] }))).toEqual([["Sections › 1 (Call to action)", "removed"]]);
  });

  it("falls back to removed and added when copies can't be told apart", () => {
    const rows = diffFields(pages, { sections: [card, card, other] }, { sections: [other, card, { ...card, heading: "Edited" }] });

    // Two copies before, one copy plus an edited one after: which copy was edited is unknowable.
    expect(brief(rows)).toEqual([
      ["Sections › 1 (Call to action)", "removed"],
      ["Sections › 2 (Call to action)", "removed"],
      ["Sections › 2 (Call to action)", "added"],
      ["Sections › 3 (Call to action)", "added"],
    ]);
  });
});

describe("nested lists", () => {
  it("reads a reordered item inside a section as one move inside that section", () => {
    const before = structuredClone(home);
    const after = structuredClone(home);
    const tabs = sectionsOf(after)[2]!.items as Json[];

    moveItem(tabs, 3, 0);
    expect(brief(diffFields(pages, before, after))).toEqual([["Sections › 3 (Feature tabs) › Items › 1", "moved", 3, 0]]);
  });

  it("addresses an item moved inside a moved section at both new places", () => {
    const after = structuredClone(home);
    const sections = sectionsOf(after);

    moveItem(sections[2]!.items as Json[], 0, 2);
    moveItem(sections, 2, 0);
    expect(brief(diffFields(pages, home, after))).toEqual([
      ["Sections › 1 (Feature tabs)", "moved", 2, 0],
      ["Sections › 1 (Feature tabs) › Items › 3", "moved", 0, 2],
    ]);
  });
});

describe("lists of plain values", () => {
  it("still change as one value", () => {
    const rows = diffFields(pages, { tags: ["a", "b", "c"] }, { tags: ["c", "a", "b"] });

    expect(rows).toEqual([{ field: ["tags"], label: "Tags", kind: "changed", before: ["a", "b", "c"], after: ["c", "a", "b"] }]);
  });
});

describe("speed", () => {
  it("diffs 200 sections with moves, inserts, removes and edits in a few milliseconds", () => {
    const types = ["hero", "logos", "features", "metrics", "faq", "cta"];
    const before = Array.from({ length: 200 }, (_, index) => ({
      type: types[index % types.length]!,
      heading: `Section ${index}`,
      text: `Text for section ${index} with a few more words`,
      items: Array.from({ length: 4 }, (_, item) => ({ label: `Item ${item} of ${index}`, text: "Words" })),
    })) as Json[];
    const after = structuredClone(before);

    moveItem(after, 10, 150);
    moveItem(after, 190, 3);
    after.splice(80, 1);
    after.splice(40, 0, { type: "faq", heading: "New" });
    (after[120]! as Json).heading = "Renamed";
    moveItem(after[60]!.items as Json[], 0, 3);
    // The best of a few runs, so a busy machine running other suites doesn't decide the result.
    const fastest = (run: () => void) =>
      Math.min(
        ...Array.from({ length: 5 }, () => {
          const started = performance.now();

          run();
          return performance.now() - started;
        })
      );
    const rows = diffFields(pages, { sections: before }, { sections: after });

    expect(rows.length).toBeLessThanOrEqual(6);
    expect(fastest(() => diffFields(pages, { sections: before }, { sections: after }))).toBeLessThan(10 * SLACK);

    // A wholesale rewrite (nothing in common, all reversed) stays quick too.
    const rewritten = before.map((section, index) => ({ ...section, heading: `Other ${index}`, text: `Other ${index}` })).reverse();

    expect(fastest(() => diffFields(pages, { sections: before }, { sections: rewritten }))).toBeLessThan(150 * SLACK);
  });
});

describe("the one-line summary", () => {
  const row = (label: string, kind: FieldChange["kind"], field: FieldPath): FieldChange => ({ field, label, kind, ...(kind === "moved" ? { from: 0, to: 1 } : {}) });
  const say = (rows: FieldChange[], bodyChanged = false) => summarizeChange({ status: "modified", fieldChanges: rows, bodyChanged });

  it("names whole sections and counts the rest, in the editor's words", () => {
    expect(say([row("Sections › 3 (Feature grid)", "added", ["sections", 2])])).toBe("Added a feature grid section.");
    expect(say([row("Sections › 2 (Metrics)", "removed", ["sections", 1])])).toBe("Removed the metrics.");
    expect(say([row("Sections › 1 (Hero)", "moved", ["sections", 0]), row("Sections › 4 (Logo row)", "moved", ["sections", 3])])).toBe("Moved 2 sections.");
    expect(say([row("Sections › 1 (Hero)", "moved", ["sections", 0]), row("Title", "changed", ["title"]), row("SEO title", "changed", ["seoTitle"])], true)).toBe(
      "Moved the hero, changed 2 other fields and edited the main text."
    );
    expect(say([row("Sections › 3 (Feature tabs) › Items › 2", "added", ["sections", 2, "items", 1])])).toBe("Added an item to the feature tabs.");
    expect(say([row("Sections › 3 (Feature tabs) › Items › 2", "moved", ["sections", 2, "items", 1])])).toBe("Moved an item in the feature tabs.");
    expect(say([row("Sections › 7 (Call to action)", "added", ["sections", 6]), row("Sections › 2 (Use cases)", "added", ["sections", 1])])).toBe("Added 2 sections.");
  });

  it("keeps field-only changes as they were", () => {
    expect(say([row("Hero › Heading", "changed", ["hero", "heading"]), row("Title", "changed", ["title"])])).toBe("Changed the heading and 1 other field.");
  });
});

// ─────────────────────────────────────────────────────────── property test

/** A small seeded generator, so a failure can be replayed. */
function random(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = "plan inspect fix prove site team audit safety boiler door roof lift water fire gas alarm check report contractor schedule asset estate depot school hotel kitchen floor window heating cooling filter pump valve meter reading photo sign certificate expiry renewal budget cost invoice quote order ticket priority urgent weekly monthly yearly quarterly owner manager engineer visit route".split(" ");
const TYPES = ["hero", "logos", "features", "metrics", "faq", "cta"];

function makeSection(next: () => number, id: number): Json {
  const words = (count: number) => Array.from({ length: count }, () => WORDS[Math.floor(next() * WORDS.length)]).join(" ");

  return {
    type: TYPES[Math.floor(next() * TYPES.length)]!,
    heading: `${words(3)} ${id}`,
    text: words(8),
    tone: next() < 0.5 ? "muted" : "plain",
    items: Array.from({ length: 1 + Math.floor(next() * 3) }, (_, index) => ({ label: `${words(2)} ${id}.${index}`, text: words(5) })),
  };
}

/**
 * Where each item of a list went, rebuilt from the rows alone: items not
 * named by an added, removed or moved row kept their order, so the k-th
 * such item before is the k-th such item after.
 */
function mapping(rows: FieldChange[], list: FieldPath, before: number, after: number): Map<number, number> {
  const depth = list.length + 1;
  const own = rows.filter((row) => row.field.length === depth && list.every((segment, index) => row.field[index] === segment) && row.kind !== "changed");
  const goneBefore = new Set(own.filter((row) => row.kind === "removed").map((row) => row.field[depth - 1] as number));
  const takenAfter = new Set(own.filter((row) => row.kind === "added").map((row) => row.field[depth - 1] as number));
  const map = new Map<number, number>();

  for (const row of own.filter((candidate) => candidate.kind === "moved")) {
    goneBefore.add(row.from!);
    takenAfter.add(row.to!);
    map.set(row.from!, row.to!);
  }
  const stableBefore = Array.from({ length: before }, (_, index) => index).filter((index) => !goneBefore.has(index));
  const stableAfter = Array.from({ length: after }, (_, index) => index).filter((index) => !takenAfter.has(index));

  expect(stableBefore.length).toBe(stableAfter.length);
  stableBefore.forEach((from, k) => map.set(from, stableAfter[k]!));
  return map;
}

function valueAt(root: JsonValue | undefined, path: FieldPath): JsonValue | undefined {
  let value = root;

  for (const segment of path) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Json & JsonValue[])[segment as never];
  }
  return value;
}

/** Every row is true of the two versions (checked for the sections list and the items in each section). */
function expectTrue(rows: FieldChange[], before: Json, after: Json): void {
  const b = sectionsOf(before);
  const a = sectionsOf(after);
  const map = mapping(rows, ["sections"], b.length, a.length);
  const back = new Map([...map].map(([from, to]) => [to, from]));

  for (const row of rows) {
    const [, index, key, inner, ...rest] = row.field as [string, number, string?, number?, ...Array<string | number>];
    const from = back.get(index);

    if (row.field.length === 2) {
      if (row.kind === "added") expect(back.has(index)).toBe(false);
      if (row.kind === "added") expect(row.after).toEqual(a[index]);
      if (row.kind === "removed") expect(row.before).toEqual(b[index]);
      if (row.kind === "removed") expect(map.has(index)).toBe(false);
      if (row.kind === "moved") {
        expect(row.to).toBe(index);
        expect(b[row.from!]!.type).toBe(a[index]!.type);
        // Out of order with at least one item that stayed put.
        const stable = [...map].filter(([source]) => !rows.some((other) => other.kind === "moved" && other.field.length === 2 && other.from === source));

        expect(stable.some(([source, target]) => Math.sign(source - row.from!) !== Math.sign(target - row.to!))).toBe(true);
      }
      expect(row.kind).not.toBe("changed");
      continue;
    }
    // Inside a paired section: never two different sections compared.
    expect(from).toBeDefined();
    expect(b[from!]!.type).toBe(a[index]!.type);
    if (key === "items" && typeof inner === "number") {
      const itemMap = mapping(rows, ["sections", index, "items"], (b[from!]!.items as Json[]).length, (a[index]!.items as Json[]).length);
      const itemBack = new Map([...itemMap].map(([source, target]) => [target, source]));

      if (rest.length === 0) {
        if (row.kind === "added") expect(row.after).toEqual((a[index]!.items as Json[])[inner]);
        if (row.kind === "removed") expect(row.before).toEqual((b[from!]!.items as Json[])[inner]);
        continue;
      }
      expect(itemBack.has(inner)).toBe(true);
      expect(row.before).toEqual(valueAt((b[from!]!.items as Json[])[itemBack.get(inner)!], rest));
      expect(row.after).toEqual(valueAt((a[index]!.items as Json[])[inner], rest));
      continue;
    }
    expect(row.before).toEqual(valueAt(b[from!], row.field.slice(2)));
    expect(row.after).toEqual(valueAt(a[index], row.field.slice(2)));
  }
}

describe("random edits (property)", () => {
  it("reports only true rows, and no more rows than edits made", () => {
    for (let seed = 1; seed <= 400; seed += 1) {
      const next = random(seed);
      let id = 0;
      const before: Json = { sections: Array.from({ length: 3 + Math.floor(next() * 6) }, () => makeSection(next, id++)) };
      const after = structuredClone(before);
      const sections = sectionsOf(after);
      const edits = 1 + Math.floor(next() * 5);

      for (let edit = 0; edit < edits; edit += 1) {
        const choice = next();
        const at = Math.floor(next() * sections.length);

        if (choice < 0.3 && sections.length > 1) moveItem(sections, at, Math.floor(next() * sections.length));
        else if (choice < 0.5) sections.splice(Math.floor(next() * (sections.length + 1)), 0, makeSection(next, id++));
        else if (choice < 0.65 && sections.length > 1) sections.splice(at, 1);
        else if (choice < 0.85 && sections[at]) sections[at]!.heading = `${String(sections[at]!.heading)} again`;
        else if (sections[at]) moveItem(sections[at]!.items as Json[], 0, (sections[at]!.items as Json[]).length - 1);
      }
      const rows = diffFields(pages, before, after);

      try {
        expectTrue(rows, before, after);
        expect(rows.length).toBeLessThanOrEqual(edits + 2);
      } catch (error) {
        throw new Error(`seed ${seed}: ${String(error)}\n${JSON.stringify(brief(rows))}`);
      }
    }
  });
});
