/**
 * Matching a page's sections now to the sections it was built with, so the
 * built page can be put in the new order: moved sections keep their place on
 * the page with their own words, removed ones go, and added ones — which the
 * built page has nothing for — are marked as new.
 */
import type { JsonValue } from "@galley/core/types";

type Section = { [key: string]: JsonValue };

/**
 * For each section now, the index of the built section it is (or null: new).
 * Identical sections pair first; then, in order, sections of the same type
 * (a moved section that was also edited), each built section used once.
 */
export function matchSections(before: readonly JsonValue[], after: readonly JsonValue[]): Array<number | null> {
  const used = new Set<number>();
  const key = (value: JsonValue | undefined) => JSON.stringify(value);
  const typeOf = (value: JsonValue | undefined) => (value && typeof value === "object" && !Array.isArray(value) ? String((value as Section).type ?? "") : "");
  const out: Array<number | null> = after.map(() => null);
  after.forEach((section, index) => {
    // The same section at the same place first, so an edit doesn't make two identical sections trade places.
    if (key(before[index]) === key(section)) {
      out[index] = index;
      used.add(index);
    }
  });
  after.forEach((section, index) => {
    if (out[index] !== null) return;
    const exact = before.findIndex((candidate, at) => !used.has(at) && key(candidate) === key(section));
    if (exact >= 0) {
      out[index] = exact;
      used.add(exact);
    }
  });
  after.forEach((section, index) => {
    if (out[index] !== null) return;
    // Prefer the built section at this place when it is of the same type (an edited section that didn't move).
    const here = !used.has(index) && typeOf(before[index]) === typeOf(section) ? index : -1;
    const same = here >= 0 ? here : before.findIndex((candidate, at) => !used.has(at) && typeOf(candidate) === typeOf(section));
    if (same >= 0) {
      out[index] = same;
      used.add(same);
    }
  });
  return out;
}

/** True when the match is the built page as it is: every section where it was, none added or removed. */
export function isIdentity(match: ReadonlyArray<number | null>, builtCount: number): boolean {
  return match.length === builtCount && match.every((from, index) => from === index);
}
