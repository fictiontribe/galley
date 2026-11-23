/**
 * Entries this app wrote itself. Every in-app edit (the form, click-to-edit
 * on the page, Proof's "Put back") puts the engine's reply into the shared
 * entry cache through here, so the form can tell its own copies from ones
 * written by the assistant or by another program.
 */
import type { Entry } from "@galley/core/types";
import { setQueryData } from "./query";
import { keys } from "./sync";

const LIMIT = 200;
const own = new Set<string>();

const id = (siteId: string, path: string, hash: string) => `${siteId}\n${path}\n${hash}`;

/** Remember a copy as written here. */
export function noteOwnCopy(siteId: string, entry: Pick<Entry, "path" | "hash">): void {
  own.add(id(siteId, entry.path, entry.hash));
  if (own.size > LIMIT) {
    const oldest = own.values().next().value;
    if (oldest !== undefined) own.delete(oldest);
  }
}

/** Whether this copy came from an edit made in this app. */
export function isOwnCopy(siteId: string, entry: Pick<Entry, "path" | "hash">): boolean {
  return own.has(id(siteId, entry.path, entry.hash));
}

/** After an in-app edit: share the engine's new copy with every screen showing the entry. */
export function storeWrittenEntry(siteId: string, entry: Entry): void {
  noteOwnCopy(siteId, entry);
  setQueryData(keys.entry(siteId, entry.path), entry);
}
