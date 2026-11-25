/**
 * A site as an extension is handed it.
 *
 * - Closing the site is withheld: it is everyone's.
 * - What it answers with is a copy, from a change as from a read (`refresh`
 *   and `saveConfig` answer with the model too). The engine keeps one model
 *   of the site and reads its own rules from it (what content mode may
 *   write, how it publishes), so an extension that tidied the object it was
 *   given would otherwise change those rules for everyone. Plain data is
 *   copied; a thing with behaviour of its own (the preview's controller) is
 *   handed as it is.
 * - It stops with the extension. Once the extension has been stopped, every
 *   member of every site it was handed refuses: the data folder may be
 *   another server's the next moment.
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
import { realpath } from "node:fs/promises";
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

/** Changes that answer with a thing to drive (the preview, an assistant turn's undo), not with data: handed as they are. */
const CONTROLLERS = new Set<string>(["preview", "checkpoint"]);

/** Reads that name a file by their first argument. */
const BY_PATH = new Set<string>(["readFile", "readBase", "resolvePath", "diff", "readEntry"]);

export const UNREADABLE = "That file can't be shown here.";
export const GET_CHANGES_NOTHING = "A GET route can't change a site. Use POST, PUT, PATCH or DELETE for what changes something.";
export const STOPPED = "This extension has been stopped, so it can no longer use the site.";

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

/**
 * The same question of where a path really leads: a link inside the site
 * named `notes.txt` that points at `.env` is `.env`. Asked for reads that
 * name a file and for what a search finds; a hard link can't be told from
 * the file itself. The site's own real path is worked out once.
 */
function linkChecker(site: SiteService) {
  let root: string | null | undefined;
  const rootPath = (): string | null => {
    if (root === undefined) {
      try {
        root = realpathSync(site.root);
      } catch {
        root = null;
      }
    }
    return root;
  };

  return {
    now(path: unknown): boolean {
      const from = typeof path === "string" ? rootPath() : null;

      if (from === null) return false;
      try {
        return unreadable(relative(from, realpathSync(site.resolvePath(path as string))));
      } catch {
        // Not there, or not a path the site has: the read itself will say so.
        return false;
      }
    },
    /** For many paths at once (a search's hits): each file looked at once, without holding the server up. */
    async among(paths: Iterable<string>): Promise<Set<string>> {
      const from = rootPath();
      const leading = new Set<string>();

      if (from === null) return leading;
      await Promise.all(
        [...new Set(paths)].map(async (path) => {
          try {
            if (unreadable(relative(from, await realpath(site.resolvePath(path))))) leading.add(path);
          } catch {
            // As above.
          }
        })
      );
      return leading;
    },
  };
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
  // A file's bytes stay what they were (a Buffer reads as text; a plain array of bytes doesn't), and only the bytes handed are copied.
  if (Buffer.isBuffer(value)) return Buffer.from(value) as unknown as T;
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) return (value as unknown as Uint8Array).slice() as unknown as T;
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

export function guardSite(site: SiteService, options: { readOnly: boolean; alive?: () => boolean }): GuardedSite {
  const guarded: Record<string, unknown> = {};
  const source = site as unknown as Record<string, unknown>;
  const links = linkChecker(site);
  const copied = (result: unknown) => (thenable(result) ? Promise.resolve(result).then(copyOf) : copyOf(result));
  /** Refuses once the extension this site was handed to has been stopped. */
  const live = () => {
    if (options.alive && !options.alive()) throw new GalleyError("forbidden", STOPPED);
  };

  for (const name of SITE_READS) {
    const value = source[name];

    if (typeof value !== "function") {
      Object.defineProperty(guarded, name, {
        enumerable: true,
        get: () => {
          live();
          return copyOf(source[name]);
        },
      });
      continue;
    }
    if (name === "grepText") {
      // Lines of a file that can't be read are left out of what a search finds.
      guarded[name] = async (...args: unknown[]) => {
        live();
        const hits = ((await (value as (...a: unknown[]) => Promise<Array<{ path: string }>>).apply(site, args)) ?? []).filter((hit) => !unreadable(hit.path));
        const leading = await links.among(hits.map((hit) => hit.path));

        return copyOf(hits.filter((hit) => !leading.has(hit.path)));
      };
      continue;
    }
    guarded[name] = BY_PATH.has(name)
      ? (...args: unknown[]) => {
          live();
          if (unreadable(args[0]) || links.now(args[0])) throw new GalleyError("forbidden", UNREADABLE);
          return copied((value as (...a: unknown[]) => unknown).apply(site, args));
        }
      : (...args: unknown[]) => {
          live();
          return copied((value as (...a: unknown[]) => unknown).apply(site, args));
        };
  }
  for (const name of SITE_CHANGES) {
    const value = source[name];
    // Asked each time: a site handed out earlier and used inside a GET refuses too.
    const mayChange = () => {
      live();
      if (options.readOnly || insideGet()) throw new GalleyError("forbidden", GET_CHANGES_NOTHING);
    };

    if (typeof value !== "function") {
      // A part of the site with actions of its own: withheld on a GET, handed as it is otherwise.
      Object.defineProperty(guarded, name, {
        enumerable: true,
        get: () => {
          mayChange();
          return source[name];
        },
      });
      continue;
    }
    guarded[name] = (...args: unknown[]) => {
      mayChange();
      const result = (value as (...a: unknown[]) => unknown).apply(site, args);

      // What a change answers with is the engine's own too (`refresh` and `saveConfig` answer with the model).
      return CONTROLLERS.has(name) ? result : copied(result);
    };
  }
  return Object.freeze(guarded) as unknown as GuardedSite;
}
