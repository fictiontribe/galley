/**
 * Line diff (LCS) for the mock's FileDiff and change tallies, and lists of
 * sections lined up item by item for its field changes. Files here are small.
 */
import type { DiffHunk, DiffLine, JsonValue } from "@galley/core/types";

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

/** One item that exists in both versions of a list: where it was, where it is, and how. */
export interface ListPair {
  from: number;
  to: number;
  /** Deep-equal before and after. */
  exact: boolean;
  /** Out of order relative to the items that stayed put. */
  moved: boolean;
}

export interface ListPlan {
  pairs: ListPair[];
  removed: number[];
  added: number[];
}

type JsonObject = { [key: string]: JsonValue };
const isObject = (value: JsonValue | undefined): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);
const IDENTITY_KEYS = ["id", "slug", "key", "name", "title", "heading", "question"];

/** An item's value as text, keys sorted, so key order never matters. */
function canonical(value: JsonValue | undefined): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

function typeOf(item: JsonValue | undefined, discriminator: string): string | null {
  return isObject(item) && typeof item[discriminator] === "string" ? (item[discriminator] as string) : null;
}

/**
 * The items kept in place: the longest run whose positions rise together.
 * Ties go to the run whose items travelled least, then to later items, so
 * dragging a section past its neighbour reads as that one section moving
 * (the engine's rule, core/src/content/diff/lists.ts).
 */
function stableChain(pairs: ListPair[]): Set<number> {
  const keep = new Set<number>();
  if (pairs.length === 0) return keep;
  const rankNow = new Array<number>(pairs.length);
  pairs.map((pair, k) => [pair.to, k] as const).sort((x, y) => x[0] - y[0]).forEach(([, k], rank) => (rankNow[k] = rank));
  const length = pairs.map(() => 1);
  const cost = pairs.map((_, k) => Math.abs(k - rankNow[k]!));
  const prev = pairs.map(() => -1);
  let best = 0;
  for (let k = 0; k < pairs.length; k++) {
    const own = Math.abs(k - rankNow[k]!);
    for (let j = 0; j < k; j++) {
      if (pairs[j]!.to >= pairs[k]!.to) continue;
      const len = length[j]! + 1;
      const total = cost[j]! + own;
      if (len > length[k]! || (len === length[k] && total <= cost[k]!)) {
        length[k] = len;
        cost[k] = total;
        prev[k] = j;
      }
    }
    if (length[k]! > length[best]! || (length[k] === length[best] && cost[k]! <= cost[best]!)) best = k;
  }
  for (let k = best; k >= 0; k = prev[k]!) keep.add(k);
  return keep;
}

/**
 * How two versions of a list of objects line up, as the engine reads them
 * in short: identical items are the same item (wherever they went); an
 * edited item pairs with one of the same type that shares a naming value
 * (a heading, a name) or held the same place; the rest were added or
 * removed. So moving one section is one move, not an edit to every field
 * of every section it passed.
 */
export function planList(before: JsonValue[], after: JsonValue[], discriminator = "type"): ListPlan {
  const b = before.map(canonical);
  const a = after.map(canonical);
  const toOf = before.map(() => -1);
  const fromOf = after.map(() => -1);
  const exact = before.map(() => false);
  const link = (i: number, j: number, same: boolean) => {
    toOf[i] = j;
    fromOf[j] = i;
    exact[i] = same;
  };

  // Identical items: the same item, copies matched in their order.
  for (let j = 0; j < a.length; j++) {
    const i = b.findIndex((text, index) => toOf[index] === -1 && text === a[j]);
    if (i >= 0) link(i, j, true);
  }
  const sameType = (i: number, j: number) => toOf[i] === -1 && fromOf[j] === -1 && typeOf(before[i], discriminator) === typeOf(after[j], discriminator) && isObject(before[i]) && isObject(after[j]);
  // Edited items: same type and a naming value in common…
  for (let j = 0; j < a.length; j++) {
    const i = before.findIndex((item, index) => sameType(index, j) && IDENTITY_KEYS.some((key) => {
      const value = (item as JsonObject)[key];
      return (typeof value === "string" ? value.trim() !== "" : typeof value === "number") && value === (after[j] as JsonObject)[key];
    }));
    if (i >= 0) link(i, j, false);
  }
  // …or the same type in the same place.
  for (let j = 0; j < a.length; j++) if (j < before.length && sameType(j, j)) link(j, j, false);

  const pairs: ListPair[] = [];
  for (let i = 0; i < before.length; i++) if (toOf[i]! >= 0) pairs.push({ from: i, to: toOf[i]!, exact: exact[i]!, moved: false });
  const kept = stableChain(pairs);
  pairs.forEach((pair, k) => (pair.moved = !kept.has(k)));
  return {
    pairs,
    removed: before.map((_, i) => i).filter((i) => toOf[i] === -1),
    added: after.map((_, j) => j).filter((j) => fromOf[j] === -1),
  };
}
