/**
 * A site as an extension is handed it.
 *
 * - Closing the site is withheld: it is everyone's.
 * - Secrets and the version history's own files can't be read through it.
 *   The file routes refuse those for a browser; the engine itself reads any
 *   path inside the site, so an extension that passed a person's path on
 *   would otherwise hand `.env` to a contributor.
 * - For a GET, whatever would change the site refuses: a GET changes nothing.
 *
 * Every member of the site service is on one of the three lists below, and
 * a test fails when a new one isn't.
 */
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

/** Secrets and version-history internals, in any letter case and at any depth. */
export function unreadable(path: unknown): boolean {
  if (typeof path !== "string") return false;
  const parts = path.replace(/\\/g, "/").toLowerCase().split("/");
  const name = parts[parts.length - 1] ?? "";

  return parts.includes(".git") || name === ".env" || name.startsWith(".env.");
}

export function guardSite(site: SiteService, options: { readOnly: boolean }): GuardedSite {
  const guarded: Record<string, unknown> = {};
  const source = site as unknown as Record<string, unknown>;

  for (const name of SITE_READS) {
    const value = source[name];

    if (typeof value !== "function") {
      Object.defineProperty(guarded, name, { enumerable: true, get: () => source[name] });
      continue;
    }
    if (name === "grepText") {
      // Lines of a file that can't be read are left out of what a search finds.
      guarded[name] = async (...args: unknown[]) => ((await (value as (...a: unknown[]) => Promise<Array<{ path: string }>>).apply(site, args)) ?? []).filter((hit) => !unreadable(hit.path));
      continue;
    }
    guarded[name] = BY_PATH.has(name)
      ? (...args: unknown[]) => {
          if (unreadable(args[0])) throw new GalleyError("forbidden", UNREADABLE);
          return (value as (...a: unknown[]) => unknown).apply(site, args);
        }
      : (value as (...a: unknown[]) => unknown).bind(site);
  }
  for (const name of SITE_CHANGES) {
    const value = source[name];

    if (typeof value !== "function") {
      // A part of the site with actions of its own (the preview): withheld on a GET, handed as it is otherwise.
      Object.defineProperty(guarded, name, {
        enumerable: true,
        get: () => {
          if (options.readOnly) throw new GalleyError("forbidden", GET_CHANGES_NOTHING);
          return source[name];
        },
      });
      continue;
    }
    guarded[name] = options.readOnly
      ? () => {
          throw new GalleyError("forbidden", GET_CHANGES_NOTHING);
        }
      : (value as (...a: unknown[]) => unknown).bind(site);
  }
  return Object.freeze(guarded) as unknown as GuardedSite;
}
