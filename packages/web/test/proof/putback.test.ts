/**
 * "Put back" against the real engine: every row's op, applied to the current
 * version, undoes exactly that row — and putting everything back, one row at
 * a time in any order, returns the published version exactly.
 */
import { describe, expect, it } from "vitest";
import { diffFields } from "@galley/core/content";
import type { FieldChange, JsonValue } from "@galley/core/types";
import { putBackOp } from "../../src/features/content/form/marks";
import { applyOpLocal, moveItem } from "../../src/features/content/form/ops";

type Json = { [key: string]: JsonValue };

const diff = (before: Json, after: Json) => diffFields(null, before, after);

/** Apply one row's put-back to the current version. */
function putBack(state: Json, row: FieldChange, rows: FieldChange[]): Json {
  const op = putBackOp(row, rows);
  expect(op, `no put-back for ${row.label} (${row.kind})`).not.toBeNull();
  const result = applyOpLocal(state, op!);
  expect(result.ok, `put-back of ${row.label} doesn't fit`).toBe(true);
  return (result as { ok: true; value: Json }).value;
}

/**
 * A row as a person reads it, without positions (which shift when an item
 * before them comes or goes): kind, the label's names, the values.
 */
const reading = (row: FieldChange) =>
  JSON.stringify([row.kind, row.label.replace(/\b\d+ \(/g, "(").replace(/› \d+\b/g, "› #"), row.before ?? null, row.after ?? null]);

function expectMinusOne(before: Json, state: Json, row: FieldChange, rows: FieldChange[]): FieldChange[] {
  const next = diff(before, putBack(state, row, rows));
  const expected = rows.filter((other) => other !== row).map(reading).sort();
  expect(next.map(reading).sort()).toEqual(expected);
  return next;
}

const page = (): Json => ({
  title: "Home",
  sections: [
    { type: "hero-split", heading: "Every inspection planned", text: "One schedule for every site" },
    { type: "logos", heading: "Trusted by teams", items: [{ name: "Ostrell" }, { name: "Linmore" }] },
    { type: "feature-tabs", heading: "From the plan to the proof", items: [{ label: "Plan", text: "Every task" }, { label: "Fix", text: "Every job" }] },
    { type: "metrics", tone: "inverse", heading: "What changes", text: "Figures from the survey" },
    { type: "use-cases", heading: "Who it is for", text: "Teams that keep buildings running" },
  ],
});

describe("putting back the home page case", () => {
  const before = page();
  const after = page();
  const sections = after.sections as Json[];
  sections.splice(1, 2, sections[2]!, sections[1]!);
  sections[3]!.tone = "muted";
  sections.splice(4, 0, { type: "faq", heading: "", items: [{ question: "", answer: "" }] });
  const rows = diff(before, after);

  it("offers the three true rows", () => {
    expect(rows.map((row) => [row.kind, row.field])).toEqual([
      ["moved", ["sections", 2]],
      ["changed", ["sections", 3, "tone"]],
      ["added", ["sections", 4]],
    ]);
  });

  it("moves only the logo row back", () => {
    expect(putBackOp(rows[0]!, rows)).toEqual({ op: "move", path: ["sections"], from: 2, to: 1 });
    expect(expectMinusOne(before, after, rows[0]!, rows).map((row) => row.kind)).toEqual(["changed", "added"]);
  });

  it("takes only the FAQ out", () => {
    expect(putBackOp(rows[2]!, rows)).toEqual({ op: "remove", path: ["sections"], index: 4 });
    expectMinusOne(before, after, rows[2]!, rows);
  });

  it("puts the tone back on the metrics, wherever they are now", () => {
    expect(putBackOp(rows[1]!, rows)).toEqual({ op: "set", path: ["sections", 3, "tone"], value: "inverse" });
    expectMinusOne(before, after, rows[1]!, rows);
  });
});

describe("putting back list items", () => {
  it("returns a removed section to where it was, after the section it used to follow", () => {
    const before = page();
    const after = page();
    (after.sections as Json[]).splice(1, 1);
    (after.sections as Json[]).splice(0, 0, { type: "cta", heading: "New first", text: "Go" });
    const rows = diff(before, after);
    const removed = rows.find((row) => row.kind === "removed")!;
    expect(putBackOp(removed, rows)).toMatchObject({ op: "insert", path: ["sections"], index: 2 });
    expectMinusOne(before, after, removed, rows);
  });

  it("moves an edited, moved section back by its current place", () => {
    const before = page();
    const after = page();
    const sections = after.sections as Json[];
    const [metrics] = sections.splice(3, 1);
    sections.unshift({ ...metrics!, heading: "What really changes" });
    const rows = diff(before, after);
    expect(rows.map((row) => [row.kind, row.field])).toEqual([
      ["moved", ["sections", 0]],
      ["changed", ["sections", 0, "heading"]],
    ]);
    expect(putBackOp(rows[1]!, rows)).toEqual({ op: "set", path: ["sections", 0, "heading"], value: "What changes" });
    expect(putBackOp(rows[0]!, rows)).toEqual({ op: "move", path: ["sections"], from: 0, to: 3 });
    expectMinusOne(before, after, rows[0]!, rows);
    expectMinusOne(before, after, rows[1]!, rows);
  });

  it("offers nothing for a list row without its list's other rows, or rows that don't belong together", () => {
    const before = page();
    const after = page();
    after.sections = moveItem(after.sections as Json[], 0, 2);
    const rows = diff(before, after);
    expect(putBackOp(rows[0]!)).toBeNull();
    expect(putBackOp(rows[0]!, [])).toBeNull();
    expect(putBackOp({ ...rows[0]!, to: 4 }, rows)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────── property test

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

const WORDS = "plan inspect fix prove site team audit safety boiler door roof lift water fire gas alarm check report contractor schedule asset estate depot school hotel kitchen floor window heating pump valve meter photo certificate expiry budget invoice ticket weekly monthly yearly owner engineer visit".split(" ");
const TYPES = ["hero", "logos", "features", "metrics", "faq", "cta"];

function section(next: () => number, id: number): Json {
  const words = (count: number) => Array.from({ length: count }, () => WORDS[Math.floor(next() * WORDS.length)]).join(" ");
  return {
    type: TYPES[Math.floor(next() * TYPES.length)]!,
    heading: `${words(3)} ${id}`,
    text: words(8),
    items: Array.from({ length: 1 + Math.floor(next() * 3) }, (_, index) => ({ label: `${words(2)} ${id}.${index}`, text: words(5) })),
  };
}

describe("random edits, put back in random order (property)", () => {
  it("undoes one row per put-back and ends exactly at the published version", () => {
    let rereadMoves = 0;
    for (let seed = 1; seed <= 900; seed += 1) {
      const next = random(seed);
      // Every third run may duplicate a section, where the reading of the copies may change.
      const copies = seed % 3 === 0;
      let id = 0;
      const before: Json = { title: "Page", sections: Array.from({ length: 3 + Math.floor(next() * 6) }, () => section(next, id++)) };
      const after = structuredClone(before);
      const sections = after.sections as Json[];
      const edits = 1 + Math.floor(next() * 5);
      for (let edit = 0; edit < edits; edit += 1) {
        const choice = next();
        const at = Math.floor(next() * sections.length);
        const target = sections[at];
        if (choice < 0.25 && sections.length > 1) sections.splice(0, sections.length, ...moveItem(sections, at, Math.floor(next() * sections.length)));
        else if (choice < 0.3 && copies && target) sections.splice(Math.floor(next() * (sections.length + 1)), 0, structuredClone(target));
        else if (choice < 0.45) sections.splice(Math.floor(next() * (sections.length + 1)), 0, section(next, id++));
        else if (choice < 0.6 && sections.length > 1) sections.splice(at, 1);
        else if (choice < 0.75 && target) target.heading = `${String(target.heading)} again`;
        else if (choice < 0.85 && target) target.eyebrow = "New eyebrow";
        else if (target) {
          const items = target.items as Json[];
          target.items = moveItem(items, 0, items.length - 1);
        }
      }
      let state: Json = after;
      let rows = diff(before, state);
      const total = rows.length;
      try {
        for (let step = 0; rows.length > 0; step += 1) {
          expect(step).toBeLessThan(total);
          const row = rows[Math.floor(next() * rows.length)]!;
          const nextState = putBack(state, row, rows);
          const nextRows = diff(before, nextState);
          // One row fewer every time; the rest read the same, unless a tie between equally short readings of a move flips.
          if (copies) {
            // Identical copies: putting one back can turn the other's "removed" + "added" into one "moved".
            expect(nextRows.length).toBeLessThan(rows.length);
          } else {
            expect(nextRows.length).toBe(rows.length - 1);
            const expected = rows.filter((other) => other !== row).map(reading).sort();
            const same = JSON.stringify(nextRows.map(reading).sort()) === JSON.stringify(expected);
            // Undoing one move can leave two neighbours swapped, and nothing says which of them the
            // editor dragged; every other put-back leaves the other rows exactly as they read.
            const otherMoves = rows.some((other) => other !== row && other.kind === "moved" && other.field.length === row.field.length);
            if (row.kind === "moved" && otherMoves) {
              if (!same) rereadMoves += 1;
            } else expect(nextRows.map(reading).sort()).toEqual(expected);
          }
          state = nextState;
          rows = nextRows;
        }
        expect(JSON.stringify(state)).toBe(JSON.stringify(before));
      } catch (error) {
        throw new Error(`seed ${seed}: ${String(error)}`);
      }
    }
    // Rare: a handful of put-backs among thousands.
    expect(rereadMoves).toBeLessThan(10);
  });
});
