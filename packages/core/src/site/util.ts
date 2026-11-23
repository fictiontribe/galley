/**
 * Small helpers the facade shares: site ids, per-key locks, display names.
 */
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, resolve } from "node:path";

/**
 * A stable short id for a site folder. Derived from the real path so the same
 * folder opened through a symlink (or macOS's /var → /private/var) gets the
 * same id, and the id survives restarts without being stored anywhere.
 */
export function siteIdFor(root: string): string {
  let real: string;

  try {
    real = realpathSync(resolve(root));
  } catch {
    real = resolve(root);
  }
  return createHash("sha256").update(real).digest("hex").slice(0, 12);
}

/**
 * Serialises tasks per key: two writes to one file run in order, writes to
 * different files never wait for each other.
 */
export function createKeyedLock() {
  const tails = new Map<string, Promise<unknown>>();

  return <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const previous = tails.get(key) ?? Promise.resolve();
    const run = previous.then(task, task);
    const tail = run.catch(() => undefined);

    tails.set(key, tail);
    void tail.then(() => {
      // Drop the entry once nothing is queued behind it, so the map stays small.
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  };
}

/** "galley-astro-starter" → "Galley astro starter" (sentence case, per the voice guide). */
export function prettifyName(raw: string): string {
  const words = raw
    .replace(/^@[^/]+\//, "")
    .replace(/[-_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return words ? words.charAt(0).toUpperCase() + words.slice(1) : raw;
}

/** The name the site shows when nothing better is known: its folder. */
export function folderName(root: string): string {
  return basename(resolve(root)) || root;
}

/** "a, b and c" — the list style the voice guide asks for. */
export function joinWords(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
