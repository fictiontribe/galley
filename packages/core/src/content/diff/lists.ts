/**
 * Aligning two versions of a list of objects (a page's sections, a section's
 * items) so that every row the Proof screen shows is true of the data.
 *
 * The rule, in order:
 *
 * 1. Same item, same data. Items that are deep-equal before and after are the
 *    same item. A longest common subsequence over the items' exact values
 *    finds the ones that kept their place; identical items left over on both
 *    sides are the same item somewhere else. Identical copies are matched in
 *    their order (any other matching gives the same data and only invents
 *    crossings); when the number of left-over copies differs between before
 *    and after, which copy went is unknowable, so those copies read as
 *    removed and added rather than as a guess.
 * 2. Edited items are paired only when they are plausibly the same thing:
 *    the same section type, and either an identity-like value in common
 *    (id, slug, key, name, title, heading, question), most of their values in
 *    common, or — for small items, where one edited field is already "half"
 *    — the same shape in the same place (between the same unmoved
 *    neighbours) with a single value different. Among candidates the most
 *    similar pair wins, never the nearest position. Anything left is removed
 *    or added.
 * 3. Moves are read with as few moved items as possible: the paired items
 *    that keep their relative order form the longest increasing run; every
 *    other pair moved. When several readings move equally few items, the one
 *    whose moved items travelled furthest wins — distance counted in items
 *    passed that exist in both versions, so additions and removals elsewhere
 *    (and putting them back) never change the reading — and when that ties
 *    too, as in dragging one section past its neighbour, the item that came
 *    first moved (it was dragged down).
 * 4. A moved item that was also edited is one "moved" row plus its real
 *    field changes, addressed at its new position.
 *
 * Everything here works on positions only; labels are fields.ts's job.
 */
import type { Field, JsonValue } from "../../types";
import { DISCRIMINATORS } from "../schema/infer";
import { deepEqual, isObject } from "../util/json";

type JsonObject = { [key: string]: JsonValue };

/** One item that exists in both versions: where it was, where it is, and how. */
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
  /** Before positions with no counterpart. */
  removed: number[];
  /** After positions with no counterpart. */
  added: number[];
}

/** Values that name an item rather than describe it. */
const IDENTITY_KEYS = ["id", "slug", "key", "name", "title", "heading", "question"];
/** "Most of their values in common." */
const SIMILAR_ENOUGH = 0.5;
/** Above this many table cells the exact alignment skips the subsequence step (moves still pair up). */
const LCS_CELLS = 4_000_000;
/** Above this many removed × added comparisons only identity values are compared. */
const SIMILARITY_BUDGET = 40_000;
/** Above this many pairs the move reading drops its tie-breaks for an n log n search. */
const WEIGHTED_LIMIT = 3_000;

/** An item's exact value as text, keys sorted, so key order never matters (as in deepEqual). */
function canonical(value: JsonValue | undefined): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The key that names an item's type, and its value: "type=hero". Null for untyped items. */
function typeKey(item: JsonObject, field: Field | undefined): { key: string; tag: string } | null {
  const key = field?.discriminator ?? DISCRIMINATORS.find((candidate) => typeof item[candidate] === "string");
  const value = key ? item[key] : undefined;

  return key && typeof value === "string" ? { key, tag: `${key}=${value}` } : null;
}

/** Every leaf value of an item by its path inside it; lists of plain values count as one leaf. */
function leavesOf(value: JsonValue, prefix: string, out: Map<string, JsonValue>, skip: string | null): Map<string, JsonValue> {
  if (isObject(value)) {
    for (const key of Object.keys(value)) {
      if (prefix === "" && key === skip) continue;
      leavesOf(value[key]!, prefix === "" ? key : `${prefix}.${key}`, out, null);
    }
  } else if (Array.isArray(value) && value.some((item) => isObject(item) || Array.isArray(item))) {
    value.forEach((item, index) => leavesOf(item, `${prefix}[${index}]`, out, null));
  } else out.set(prefix, value);
  return out;
}

const WORD = /[\p{L}\p{N}]+/gu;

interface Candidate {
  item: JsonObject;
  type: string | null;
  leaves: Map<string, JsonValue>;
  keys: string;
}

class Similarity {
  private words = new Map<string, Set<string>>();

  private wordsOf(text: string): Set<string> {
    let set = this.words.get(text);

    if (!set) {
      set = new Set(text.toLowerCase().match(WORD) ?? []);
      this.words.set(text, set);
    }
    return set;
  }

  /** How much of two texts' wording is shared (Dice over distinct words), 0–1. */
  private text(a: string, b: string): number {
    const x = this.wordsOf(a);
    const y = this.wordsOf(b);

    if (x.size + y.size === 0) return 0;
    let shared = 0;

    for (const word of x) if (y.has(word)) shared += 1;
    return (2 * shared) / (x.size + y.size);
  }

  /** Share of leaves that match, with partial credit for reworded text. */
  of(a: Map<string, JsonValue>, b: Map<string, JsonValue>): number {
    let union = a.size;
    let sum = 0;

    for (const [path, value] of b) {
      if (!a.has(path)) {
        union += 1;
        continue;
      }
      const other = a.get(path);

      if (deepEqual(other, value)) sum += 1;
      else if (typeof other === "string" && typeof value === "string") {
        // Reworded text counts only when most of its words survive; a few shared common words mean nothing.
        const shared = this.text(other, value);

        if (shared >= SIMILAR_ENOUGH) sum += shared;
      }
    }
    return union === 0 ? 1 : sum / union;
  }
}

/** Same leaves, one value different: a one-field item with that field edited. */
function oneLeafApart(a: Map<string, JsonValue>, b: Map<string, JsonValue>): boolean {
  if (a.size !== b.size) return false;
  let different = 0;

  for (const [path, value] of a) {
    if (!b.has(path)) return false;
    if (!deepEqual(value, b.get(path))) different += 1;
  }
  return different <= 1;
}

function sharesIdentity(a: JsonObject, b: JsonObject): boolean {
  return IDENTITY_KEYS.some((key) => {
    const value = a[key];
    const meaningful = typeof value === "string" ? value.trim() !== "" : typeof value === "number";

    return meaningful && value === b[key];
  });
}

function identityTokens(candidate: Candidate): string[] {
  return IDENTITY_KEYS.flatMap((key) => {
    const value = candidate.item[key];

    if (typeof value === "string" ? value.trim() === "" : typeof value !== "number") return [];
    return [`${candidate.type ?? ""}\u0000${key}\u0000${String(value)}`];
  });
}

/**
 * The longest chain of pairs whose after positions rise with their before
 * positions (pairs arrive sorted by `from`, so `k` is an item's rank before).
 * Ties go to the chain whose own items moved least — so the items reported as
 * moved are the ones that travelled furthest — and then to the chain built
 * from later items, so in a swap of neighbours the first one is the one that
 * moved.
 */
function stableChain(pairs: ListPair[]): Set<number> {
  const count = pairs.length;
  const keep = new Set<number>();

  if (count === 0) return keep;
  if (count > WEIGHTED_LIMIT) {
    // Patience search: same length, no displacement tie-break. Only for very long lists.
    const tops: number[] = [];
    const prev = new Int32Array(count).fill(-1);

    for (let k = 0; k < count; k += 1) {
      const to = pairs[k]!.to;
      let low = 0;
      let high = tops.length;

      while (low < high) {
        const mid = (low + high) >> 1;

        if (pairs[tops[mid]!]!.to < to) low = mid + 1;
        else high = mid;
      }
      if (low > 0) prev[k] = tops[low - 1]!;
      tops[low] = k;
    }
    for (let k = tops[tops.length - 1]!; k >= 0; k = prev[k]!) keep.add(k);
    return keep;
  }
  // How far each item travelled, counted in items it passed that exist in both
  // versions: additions and removals elsewhere don't change it, so putting one
  // of those back never changes which item reads as moved.
  const rankNow = new Int32Array(count);

  pairs
    .map((pair, k) => [pair.to, k] as const)
    .sort((x, y) => x[0] - y[0])
    .forEach(([, k], rank) => (rankNow[k] = rank));
  const length = new Int32Array(count);
  const cost = new Float64Array(count);
  const prev = new Int32Array(count).fill(-1);
  let best = 0;

  for (let k = 0; k < count; k += 1) {
    const pair = pairs[k]!;
    const own = Math.abs(k - rankNow[k]!);

    length[k] = 1;
    cost[k] = own;
    for (let j = 0; j < k; j += 1) {
      if (pairs[j]!.to >= pair.to) continue;
      const len = length[j]! + 1;
      const total = cost[j]! + own;

      // `>=` on a full tie keeps the later predecessor.
      if (len > length[k]! || (len === length[k]! && total <= cost[k]!)) {
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

/** How two lists of objects line up. See the rule at the top of this file. */
export function planList(before: JsonValue[], after: JsonValue[], field: Field | undefined): ListPlan {
  const ids = new Map<string, number>();
  const idOf = (value: JsonValue) => {
    const text = canonical(value);
    let id = ids.get(text);

    if (id === undefined) {
      id = ids.size;
      ids.set(text, id);
    }
    return id;
  };
  const b = before.map(idOf);
  const a = after.map(idOf);
  const n = b.length;
  const m = a.length;
  const toOf = new Int32Array(n).fill(-1);
  const fromOf = new Int32Array(m).fill(-1);
  const exactAt = new Uint8Array(n);
  // Anchors: exact items that kept their place. They define "the same place" for edited items.
  const anchorB = new Uint8Array(n);
  const anchorA = new Uint8Array(m);
  const link = (i: number, j: number, exact: boolean, anchor: boolean) => {
    toOf[i] = j;
    fromOf[j] = i;
    exactAt[i] = exact ? 1 : 0;
    if (anchor) {
      anchorB[i] = 1;
      anchorA[j] = 1;
    }
  };

  // Common head and tail never move; trimming them keeps the table small.
  let start = 0;

  while (start < n && start < m && b[start] === a[start]) {
    link(start, start, true, true);
    start += 1;
  }
  let endB = n;
  let endA = m;

  while (endB > start && endA > start && b[endB - 1] === a[endA - 1]) {
    endB -= 1;
    endA -= 1;
    link(endB, endA, true, true);
  }
  const rows = endB - start;
  const cols = endA - start;

  if (rows > 0 && cols > 0 && (rows + 1) * (cols + 1) <= LCS_CELLS) {
    const width = cols + 1;
    const table = new Int32Array((rows + 1) * width);

    for (let i = rows - 1; i >= 0; i -= 1) {
      for (let j = cols - 1; j >= 0; j -= 1) {
        table[i * width + j] = b[start + i] === a[start + j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;

    while (i < rows && j < cols) {
      if (b[start + i] === a[start + j]) {
        link(start + i, start + j, true, true);
        i += 1;
        j += 1;
      } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) i += 1;
      else j += 1;
    }
  }

  // Identical items left over on both sides: the same item, elsewhere.
  const leftover = new Map<number, { b: number[]; a: number[] }>();
  const slot = (id: number) => {
    let entry = leftover.get(id);

    if (!entry) {
      entry = { b: [], a: [] };
      leftover.set(id, entry);
    }
    return entry;
  };

  for (let i = 0; i < n; i += 1) if (toOf[i]! < 0) slot(b[i]!).b.push(i);
  for (let j = 0; j < m; j += 1) if (fromOf[j]! < 0) slot(a[j]!).a.push(j);
  const unsure = new Set<string>();

  for (const entry of leftover.values()) {
    if (entry.b.length > 0 && entry.b.length === entry.a.length) {
      entry.b.forEach((i, k) => link(i, entry.a[k]!, true, false));
      continue;
    }
    // Copies that can't be told apart are never paired by likeness either.
    if (entry.b.length > 1 || (entry.b.length > 0 && entry.a.length > 0)) for (const i of entry.b) unsure.add(`b${i}`);
    if (entry.a.length > 1 || (entry.b.length > 0 && entry.a.length > 0)) for (const j of entry.a) unsure.add(`a${j}`);
  }

  // Edited items: pair the plausibly-same, most similar first.
  const gapB = new Int32Array(n);
  const gapA = new Int32Array(m);

  for (let i = 0, seen = 0; i < n; i += 1) {
    gapB[i] = seen;
    seen += anchorB[i]!;
  }
  for (let j = 0, seen = 0; j < m; j += 1) {
    gapA[j] = seen;
    seen += anchorA[j]!;
  }
  const describe = (item: JsonValue): Candidate | null => {
    if (!isObject(item)) return null;
    const type = typeKey(item, field);

    return { item, type: type?.tag ?? null, leaves: leavesOf(item, "", new Map(), type?.key ?? null), keys: Object.keys(item).sort().join("\u0000") };
  };
  const removedLeft: Array<[number, Candidate]> = [];
  const addedLeft: Array<[number, Candidate]> = [];

  for (let i = 0; i < n; i += 1) {
    const candidate = toOf[i]! < 0 && !unsure.has(`b${i}`) ? describe(before[i]!) : null;

    if (candidate) removedLeft.push([i, candidate]);
  }
  for (let j = 0; j < m; j += 1) {
    const candidate = fromOf[j]! < 0 && !unsure.has(`a${j}`) ? describe(after[j]!) : null;

    if (candidate) addedLeft.push([j, candidate]);
  }
  if (removedLeft.length > 0 && addedLeft.length > 0) {
    const similarity = new Similarity();
    const options: Array<{ i: number; j: number; strong: boolean; score: number; same: boolean }> = [];
    const consider = (i: number, r: Candidate, j: number, c: Candidate) => {
      if (r.type !== c.type) return;
      const strong = sharesIdentity(r.item, c.item);
      const score = similarity.of(r.leaves, c.leaves);
      const same = gapB[i] === gapA[j];

      if (strong || score >= SIMILAR_ENOUGH || (same && r.keys === c.keys && oneLeafApart(r.leaves, c.leaves))) options.push({ i, j, strong, score, same });
    };

    if (removedLeft.length * addedLeft.length <= SIMILARITY_BUDGET) {
      for (const [i, r] of removedLeft) for (const [j, c] of addedLeft) consider(i, r, j, c);
    } else {
      const byToken = new Map<string, Array<[number, Candidate]>>();

      for (const entry of addedLeft) for (const token of identityTokens(entry[1])) byToken.set(token, [...(byToken.get(token) ?? []), entry]);
      for (const [i, r] of removedLeft) {
        const seen = new Set<number>();

        for (const token of identityTokens(r)) {
          for (const [j, c] of byToken.get(token) ?? []) {
            if (seen.has(j)) continue;
            seen.add(j);
            consider(i, r, j, c);
          }
        }
      }
    }
    options.sort(
      (x, y) =>
        Number(y.strong) - Number(x.strong) ||
        y.score - x.score ||
        Number(y.same) - Number(x.same) ||
        Math.abs(gapB[x.i]! - gapA[x.j]!) - Math.abs(gapB[y.i]! - gapA[y.j]!) ||
        Math.abs(x.i - x.j) - Math.abs(y.i - y.j) ||
        x.i - y.i ||
        x.j - y.j
    );
    for (const option of options) if (toOf[option.i]! < 0 && fromOf[option.j]! < 0) link(option.i, option.j, false, false);
  }

  // Which pairs moved: everything outside the longest in-order chain.
  const pairs: ListPair[] = [];

  for (let i = 0; i < n; i += 1) if (toOf[i]! >= 0) pairs.push({ from: i, to: toOf[i]!, exact: exactAt[i] === 1, moved: false });
  // The common head and tail are in every longest chain; leave them out of the search.
  const middle = pairs.filter((pair) => pair.from >= start && pair.from < endB);
  const keep = stableChain(middle);

  middle.forEach((pair, k) => {
    if (!keep.has(k)) pair.moved = true;
  });
  const removed: number[] = [];
  const added: number[] = [];

  for (let i = 0; i < n; i += 1) if (toOf[i]! < 0) removed.push(i);
  for (let j = 0; j < m; j += 1) if (fromOf[j]! < 0) added.push(j);
  return { pairs, removed, added };
}
