/** Line diff (LCS) for the mock's FileDiff and change tallies. Files here are small. */
import type { DiffHunk, DiffLine } from "@galley/core/types";

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before === "" ? [] : before.replace(/\n$/, "").split("\n");
  const b = after === "" ? [] : after.replace(/\n$/, "").split("\n");
  const m = a.length;
  const n = b.length;
  const table: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) {
      lines.push({ type: "context", text: a[i]!, oldNumber: i + 1, newNumber: j + 1 });
      i++;
      j++;
    } else if (j < n && (i >= m || table[i]![j + 1]! >= table[i + 1]![j]!)) {
      lines.push({ type: "add", text: b[j]!, newNumber: j + 1 });
      j++;
    } else {
      lines.push({ type: "del", text: a[i]!, oldNumber: i + 1 });
      i++;
    }
  }
  return lines;
}

export function tally(before: string, after: string): { additions: number; deletions: number } {
  const lines = diffLines(before, after);
  return {
    additions: lines.filter((line) => line.type === "add").length,
    deletions: lines.filter((line) => line.type === "del").length,
  };
}

/** Group changed lines into hunks with `context` lines around them. */
export function hunks(before: string, after: string, context = 3): DiffHunk[] {
  const lines = diffLines(before, after);
  const changed = lines.map((line, index) => (line.type === "context" ? -1 : index)).filter((index) => index >= 0);
  const out: DiffHunk[] = [];
  let start = -1;
  let end = -1;
  const flush = () => {
    if (start < 0) return;
    const slice = lines.slice(start, end + 1);
    const firstOld = slice.find((line) => line.oldNumber !== undefined)?.oldNumber ?? 0;
    const firstNew = slice.find((line) => line.newNumber !== undefined)?.newNumber ?? 0;
    out.push({
      oldStart: firstOld,
      oldLines: slice.filter((line) => line.type !== "add").length,
      newStart: firstNew,
      newLines: slice.filter((line) => line.type !== "del").length,
      lines: slice,
    });
  };
  for (const index of changed) {
    const from = Math.max(0, index - context);
    const to = Math.min(lines.length - 1, index + context);
    if (start >= 0 && from <= end + 1) end = Math.max(end, to);
    else {
      flush();
      start = from;
      end = to;
    }
  }
  flush();
  return out;
}
