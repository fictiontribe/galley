import { describe, expect, it } from "vitest";
import type { DiffHunk } from "@galley/core/types";
import { foldUnchanged, hasChanges, proofHunk, similarity, wordDiff, type ProofPart } from "../../src/ui/diff/wordDiff";

const text = (parts: ProofPart[], kinds: Array<ProofPart["kind"]>) => parts.map((part) => (part.kind !== "gap" && kinds.includes(part.kind) ? part.text : "")).join("");

describe("word diff → proof marks", () => {
  it("marks inserted and deleted words and keeps the rest", () => {
    const parts = wordDiff("We make brands for the web.", "We make brands for teams that ship.");
    expect(text(parts, ["same", "del"])).toBe("We make brands for the web.");
    expect(text(parts, ["same", "ins"])).toBe("We make brands for teams that ship.");
    expect(parts.find((part) => part.kind === "del")).toMatchObject({ text: expect.stringContaining("web") });
    expect(parts.find((part) => part.kind === "ins")).toMatchObject({ text: expect.stringContaining("teams that ship") });
    expect(hasChanges(parts)).toBe(true);
  });

  it("says nothing changed for identical text", () => {
    expect(wordDiff("Same.", "Same.")).toEqual([{ kind: "same", text: "Same." }]);
    expect(wordDiff("", "")).toEqual([]);
    expect(hasChanges(wordDiff("Same.", "Same."))).toBe(false);
  });

  it("measures how much survived, so a rewrite shows before and after instead", () => {
    expect(similarity(wordDiff("Identity, websites and campaigns, built carefully.", "Identity, websites and campaigns. Delivered on time."))).toBeGreaterThan(0.45);
    expect(similarity(wordDiff("We make brands for the web.", "Garden rooms, lofts and kitchens"))).toBeLessThan(0.45);
    expect(similarity([])).toBe(1);
  });

  it("folds long unchanged stretches, keeping context around each change", () => {
    const words = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(" ");
    const before = `${words(40, "a")} old ${words(40, "b")}`;
    const after = `${words(40, "a")} new ${words(40, "b")}`;
    const folded = foldUnchanged(wordDiff(before, after), 5);
    const gaps = folded.filter((part) => part.kind === "gap");
    expect(gaps).toHaveLength(2);
    expect(text(folded, ["same"]).trim().split(/\s+/).length).toBeLessThanOrEqual(12);
    expect(text(folded, ["ins"])).toContain("new");
    expect(text(folded, ["del"])).toContain("old");
    // Short texts are left alone.
    const short = wordDiff("One two three.", "One two four.");
    expect(foldUnchanged(short)).toBe(short);
  });
});

describe("source lines", () => {
  const hunk: DiffHunk = {
    oldStart: 4,
    oldLines: 3,
    newStart: 4,
    newLines: 3,
    lines: [
      { type: "context", text: "sections:", oldNumber: 4, newNumber: 4 },
      { type: "del", text: "  heading: Make more of the *home you already have*.", oldNumber: 5 },
      { type: "add", text: "  heading: Make more of the *house you already love*.", newNumber: 5 },
      { type: "add", text: "  eyebrow: New", newNumber: 6 },
    ],
  };

  it("pairs an edited line with its replacement and marks the words", () => {
    const edited: DiffHunk = { ...hunk, lines: hunk.lines.slice(0, 3) };
    const rows = proofHunk(edited);
    expect(rows.map((row) => row.line.type)).toEqual(["context", "del", "add"]);
    expect(rows[1]?.parts?.some((part) => part.kind === "del" && part.text.includes("home"))).toBe(true);
    expect(rows[2]?.parts?.some((part) => part.kind === "ins" && part.text.includes("house"))).toBe(true);
    expect(rows[1]?.parts?.some((part) => part.kind === "ins")).toBe(false);
  });

  it("leaves unequal runs as whole-line changes", () => {
    const rows = proofHunk(hunk);
    expect(rows.map((row) => [row.line.type, row.parts === undefined])).toEqual([
      ["context", true],
      ["del", true],
      ["add", true],
      ["add", true],
    ]);
  });
});
