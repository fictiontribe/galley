/**
 * A site as an extension is handed it.
 *
 * - Closing the site is withheld: it is everyone's.
 * - What a read answers with is a copy. The engine keeps one model of the
 *   site and reads its own rules from it (what content mode may write, how
 *   it publishes), so an extension that tidied the object it was given
 *   would otherwise change those rules for everyone, from a GET.
 * - Secrets and the version history's own files can't be read through it:
 *   by name, as the editor's file routes refuse them, and by where a link
 *   inside the site leads. The engine itself reads any path inside the site,
 *   so an extension that passed a person's path on would otherwise hand
 *   `.env` to a contributor.
 * - For a GET, whatever would change the site refuses: a GET changes nothing.
 *
 * Every member of the site service is on one of the lists below, and a test
 * fails when a new one isn't.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { realpathSync } from "node:fs";
import { relative } from "node:path";
import { GalleyError } from "@galley/core";
import type { SiteService } from "@galley/core/types";
import type { GuardedSite } from "./types";

/** Members that only read. */
export const SITE_READS = [
  "id", "root", "summary", "detail", "model", "detected", "readConfig", "listEntries", "readEntry", "search", "resolveText", "entryForUrl",
  "validate", "listFiles", "grepText", "readFile", "listMedia", "resolvePath", "changes", "pendingPaths", "diff", "readBase", "history", "gitStatus",
] as const satisfies ReadonlyArray<keyof SiteService>;

/** Members that change the site, its repository, its preview, or what is known of its code host. */
export const SITE_CHANGES = [
  "refresh", "saveConfig", "updateEntry", "createEntry", "deleteEntry", "writeFile", "deleteFile", "saveMedia", "discard", "publish", "send", "revert",
  "checkGit", "pull", "catchUp", "checkpoint", "preview", "build",
] as const satisfies ReadonlyArray<keyof SiteService>;

/** Members an extension is never handed. */
export const SITE_WITHHELD = ["dispose"] as const satisfies ReadonlyArray<keyof SiteService>;

/** What an open site carries for the engine's own use, beyond the site service. Never handed either. */
export const SITE_INTERNAL = ["snapshot", "previewHandle", "liveUrl"] as const;

/** Reads that name a file by their first argument. */
const BY_PATH = new Set<string>(["readFile", "readBase", "resolvePath", "diff", "readEntry"]);

export const UNREADABLE = "That file can't be shown here.";
export const GET_CHANGES_NOTHING = "A GET route can't change a site. Use POST, PUT, PATCH or DELETE for what changes something.";

/** Set while a GET's handler runs, and for whatever that handler starts: a site asked for meanwhile is read-only too. */
const getInProgress = new AsyncLocalStorage<true>();

/** Runs a GET's handler so that every site it reaches, however it reaches it, refuses to change. */
export function duringGet<T>(run: () => T): T {
  return getInProgress.run(true, run);
}

export function insideGet(): boolean {
  return getInProgress.getStore() === true;
}

/** Secrets and version-history internals by name, in any letter case and at any depth. */
export function unreadable(path: unknown): boolean {
  if (typeof path !== "string") return false;
  const parts = path.replace(/\\/g, "/").toLowerCase().split("/");
  const name = parts[parts.length - 1] ?? "";

  return parts.includes(".git") || name === ".env" || name.startsWith(".env.");
}

/** The same question of where the path really leads: a link inside the site named `notes.txt` that points at `.env` is `.env`. */
function leadsToUnreadable(site: SiteService, path: unknown): boolean {
  if (typeof path !== "string") return false;
  try {
    return unreadable(relative(realpathSync(site.root), realpathSync(site.resolvePath(path))));
  } catch {
    // Not there, or not a path the site has: the read itself will say so.
    return false;
  }
}

const thenable = (value: unknown): value is PromiseLike<unknown> => typeof (value as { then?: unknown } | null)?.then === "function";

/**
 * A copy of what a read answered with, so nothing done to it reaches the
 * engine's own. `structuredClone` first; where the value holds something it
 * can't copy (a function), a plain deep copy that keeps such things as they
 * are and copies everything around them.
 */
export function copyOf<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  try {
    return structuredClone(value);
  } catch {
    return deepCopy(value, new Map()) as T;
  }
}

function deepCopy(value: unknown, seen: Map<object, unknown>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof Date || value instanceof Map || value instanceof Set) {
    try {
      return structuredClone(value);
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];

    seen.set(value, out);
    for (const item of value) out.push(deepCopy(item, seen));
    return out;
  }
  const proto = Object.getPrototypeOf(value) as unknown;

  // Something with behaviour of its own: handed as it is.
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Record<string, unknown> = proto === null ? (Object.create(null) as Record<string, unknown>) : {};

  seen.set(value, out);
  for (const [key, item] of Object.entries(value)) out[key] = deepCopy(item, seen);
  return out;
}

export function guardSite(site: SiteService, options: { readOnly: boolean }): GuardedSite {
  const guarded: Record<string, unknown> = {};
  const source = site as unknown as Record<string, unknown>;
  const copied = (result: unknown) => (thenable(result) ? Promise.resolve(result).then(copyOf) : copyOf(result));

  for (const name of SITE_READS) {
    const value = source[name];

    if (typeof value !== "function") {
      Object.defineProperty(guarded, name, { enumerable: true, get: () => copyOf(source[name]) });
      continue;
    }
    if (name === "grepText") {
      // Lines of a file that can't be read are left out of what a search finds.
      guarded[name] = async (...args: unknown[]) => copyOf(((await (value as (...a: unknown[]) => Promise<Array<{ path: string }>>).apply(site, args)) ?? []).filter((hit) => !unreadable(hit.path) && !leadsToUnreadable(site, hit.path)));
      continue;
    }
    guarded[name] = BY_PATH.has(name)
      ? (...args: unknown[]) => {
          if (unreadable(args[0]) || leadsToUnreadable(site, args[0])) throw new GalleyError("forbidden", UNREADABLE);
          return copied((value as (...a: unknown[]) => unknown).apply(site, args));
        }
      : (...args: unknown[]) => copied((value as (...a: unknown[]) => unknown).apply(site, args));
  }
  for (const name of SITE_CHANGES) {
    const value = source[name];
    // Asked each time: a site handed out earlier and used inside a GET refuses too.
    const refuses = () => options.readOnly || insideGet();

    if (typeof value !== "function") {
      // A part of the site with actions of its own (the preview): withheld on a GET, handed as it is otherwise.
      Object.defineProperty(guarded, name, {
        enumerable: true,
        get: () => {
          if (refuses()) throw new GalleyError("forbidden", GET_CHANGES_NOTHING);
          return source[name];
        },
      });
      continue;
    }
    guarded[name] = (...args: unknown[]) => {
      if (refuses()) throw new GalleyError("forbidden", GET_CHANGES_NOTHING);
      return (value as (...a: unknown[]) => unknown).apply(site, args);
    };
  }
  return Object.freeze(guarded) as unknown as GuardedSite;
}
