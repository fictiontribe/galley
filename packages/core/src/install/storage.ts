/**
 * "What is stored where" for the Install page: one line per kind of thing
 * the data folder keeps, with its size on disk.
 *
 * Sizes are measured in the background and kept for a while: a checkout
 * with its history can hold hundreds of thousands of files, and a page load
 * never waits for a walk over them. Until the first measurement lands, a
 * size is null.
 *
 * The walk never goes into `node_modules` (tens of thousands of small files
 * a backup doesn't carry anyway), stops when the server closes, and has a
 * time budget: a line it couldn't finish in time stays null and is measured
 * again on a later request. Installed packages aren't counted at all: the
 * caches line is null while the site has them, rather than a number that
 * leaves them out.
 */
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { InstallStorageLine } from "./types";

/** How long a measurement is good for before the next request starts another. */
export const STORAGE_MAX_AGE_MS = 5 * 60_000;
/** How long the walk for one line may take before that line is left null (and measured again later). */
export const STORAGE_BUDGET_MS = 5_000;
/** Never walked into: installed packages (rebuilt, never backed up). */
const NOT_WALKED = new Set(["node_modules"]);

interface LineSpec {
  id: InstallStorageLine["id"];
  label: string;
  /** Shown, relative to the data folder. */
  path: string;
  /** Measured, relative to the data folder (several for one line). */
  measure: string[];
  inBackup: boolean;
  /** Folders whose presence means the line can't be measured cheaply (its size stays null). */
  unmeasuredWhen?: string[];
}

function specs(siteRoot: string, siteId: string | null): LineSpec[] {
  const state = siteId ? `state/${siteId}` : "state";

  return [
    { id: "site", label: "The site, its version history and unpublished changes", path: siteRoot, measure: [siteRoot], inBackup: true },
    { id: "settings", label: "Settings", path: "settings.json", measure: ["settings.json", "plugin-settings.json"], inBackup: true },
    { id: "keys", label: "Keys: this editor's own key, the repository's access key and stored service keys", path: "keys", measure: ["keys", "secrets.json"], inBackup: true },
    { id: "inbox", label: "Form submissions", path: `${state}/submissions`, measure: siteId ? [`${state}/submissions`] : [], inBackup: true },
    { id: "history", label: "When the site went online", path: `${state}/deployments.jsonl`, measure: siteId ? [`${state}/deployments.jsonl`, `${state}/redirects.json`] : [], inBackup: true },
    { id: "brand", label: "Brand material", path: `${state}/brand`, measure: siteId ? [`${state}/brand`] : [], inBackup: true },
    { id: "assistant", label: "Assistant conversations", path: `${state}/threads`, measure: siteId ? [`${state}/threads`] : [], inBackup: true },
    // A backup skips installed packages (node_modules) everywhere, plugins' included.
    { id: "plugins", label: "Plugins: a backup carries their settings; their packages are added again after a restore", path: "plugins", measure: ["plugins", "plugin-state.json"], inBackup: true },
    { id: "sessions", label: "Sign-in: the password's hash, sessions and the key cookies are signed with", path: "install.json", measure: ["install.json", "session.key"], inBackup: true },
    { id: "cache", label: "Caches and installed packages (rebuilt when needed)", path: "home", measure: ["home", "tmp"], inBackup: false, unmeasuredWhen: [`${siteRoot}/node_modules`] },
  ];
}

/** Why a walk stopped before it was done. */
class Stopped extends Error {}

/** Bytes on disk under `path` (not following links, never into node_modules). Missing: 0. Throws Stopped when `keepGoing` says so. */
async function sizeOf(path: string, keepGoing: () => boolean): Promise<number> {
  if (!keepGoing()) throw new Stopped();
  const info = await lstat(path).catch(() => null);

  if (!info) return 0;
  if (!info.isDirectory()) return info.size;
  let total = 0;
  const names = await readdir(path).catch(() => [] as string[]);

  for (const name of names) {
    if (NOT_WALKED.has(name)) continue;
    total += await sizeOf(join(path, name), keepGoing);
  }
  return total;
}

export interface StorageMeter {
  /** The lines as last measured (sizes null until then); starts a measurement when the last is stale or didn't finish. */
  lines(siteRoot: string, siteId: string | null): InstallStorageLine[];
  /** Resolves when the measurement in progress (if any) is done (tests). */
  settled(): Promise<void>;
  /** Stops a measurement in progress and starts no more (the server is closing). Resolves once the walk has let go. */
  close(): Promise<void>;
}

export function createStorageMeter(home: string, options: { maxAgeMs?: number; budgetMs?: number; now?: () => number } = {}): StorageMeter {
  const now = options.now ?? Date.now;
  const maxAge = options.maxAgeMs ?? STORAGE_MAX_AGE_MS;
  const budget = options.budgetMs ?? STORAGE_BUDGET_MS;
  /** Per line: its size, as last measured (null: it couldn't be measured cheaply or in time). */
  let sizes = new Map<string, number | null>();
  let measuredAt = -Infinity;
  let measuredFor = "";
  /** A line ran out of time: measure again on the next request, whatever the age. */
  let unfinished = false;
  let running: Promise<void> | null = null;
  let closed = false;
  const abs = (relative: string) => join(home, ...relative.split("/"));
  const present = (relative: string) => lstat(abs(relative)).then(() => true, () => false);

  function refresh(all: LineSpec[], key: string): void {
    if (running || closed) return;
    running = (async () => {
      const next = new Map<string, number | null>();
      let short = false;

      for (const spec of all) {
        if (closed) return;
        // Each line its own budget: a huge checkout doesn't leave the small lines unmeasured.
        const deadline = Date.now() + budget;
        const keepGoing = () => !closed && Date.now() < deadline;

        if (spec.unmeasuredWhen && (await Promise.all(spec.unmeasuredWhen.map(present))).some(Boolean)) {
          next.set(spec.id, null);
          continue;
        }
        try {
          let total = 0;

          for (const part of spec.measure) total += await sizeOf(abs(part), keepGoing);
          next.set(spec.id, total);
        } catch (error) {
          if (!(error instanceof Stopped)) throw error;
          if (closed) return;
          next.set(spec.id, null);
          short = true;
        }
      }
      sizes = next;
      measuredAt = now();
      measuredFor = key;
      unfinished = short;
    })()
      .catch(() => undefined)
      .finally(() => {
        running = null;
      });
  }

  return {
    lines(siteRoot, siteId) {
      const all = specs(siteRoot, siteId);
      const key = `${siteRoot}|${siteId ?? ""}`;

      if (unfinished || now() - measuredAt > maxAge || key !== measuredFor) refresh(all, key);
      const fresh = key === measuredFor;

      return all.map((spec) => ({ id: spec.id, label: spec.label, path: spec.path, bytes: fresh ? (sizes.get(spec.id) ?? null) : null, inBackup: spec.inBackup }));
    },
    async settled() {
      while (running) await running;
    },
    async close() {
      closed = true;
      while (running) await running;
    },
  };
}
