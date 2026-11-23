import { fileURLToPath } from "node:url";

export const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));
export const ASTRO = `${FIXTURES}astro-site`;
export const HUGO = `${FIXTURES}hugo-site`;
export const PLAIN = `${FIXTURES}plain-notes`;

/**
 * The lines that differ between two texts, found by trimming the common
 * leading and trailing lines — exactly what a line diff would highlight for a
 * single local change.
 */
export function changedLines(before: string, after: string): { removed: string[]; added: string[] } {
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;

  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length - 1;
  let endB = b.length - 1;

  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA -= 1;
    endB -= 1;
  }
  return { removed: a.slice(start, endA + 1), added: b.slice(start, endB + 1) };
}
