/**
 * What the assistant has read, and so may change.
 *
 * Every change the assistant makes to a file that is already there is made
 * from what it read of it, a moment ago or several replies back. So each
 * read is remembered by its version (the file's hash), for as long as the
 * conversation lasts, and a change goes to the site with the version it was
 * made from: a file that has changed since (newer versions came in, a person
 * discarded or saved, a reply was undone) is not replaced, and the assistant
 * is told to read it again.
 *
 * Nothing remembered means nothing read: an existing file or entry is then
 * not changed at all. Forgetting is therefore always safe, which is what
 * lets this be bounded and lost when the server restarts.
 */
import { normalizeRepoPath } from "../../workspace/paths";
import type { ToolContext } from "./types";

/** Files remembered per conversation; the oldest go first. */
export const READS_KEPT = 400;

/** A version no file can have: sent with a change to a file that was never read, so that it replaces nothing. */
export const NEVER_READ = "never-read";

/** The reads of the conversation this context belongs to (made on first use for a context that came without one). */
function readsOf(ctx: ToolContext): Map<string, string> {
  ctx.read ??= new Map();
  return ctx.read;
}

/**
 * What a file is remembered under: its site and its path as the site names
 * it (another harness's session can work on several sites). A path the site
 * would refuse is remembered under itself and refused by the change.
 */
function readKey(ctx: ToolContext, path: string): string {
  let normalized = path;

  try {
    normalized = normalizeRepoPath(path);
  } catch {
    // Left as it was given.
  }
  return `${ctx.siteId}\0${normalized}`;
}

/** The version of the file this conversation last read or wrote, if it has. */
export function versionRead(ctx: ToolContext, path: string): string | undefined {
  return readsOf(ctx).get(readKey(ctx, path));
}

/** Remembers the version just read, or just written by the assistant itself. */
export function rememberVersion(ctx: ToolContext, path: string, hash: string): void {
  const reads = readsOf(ctx);
  const key = readKey(ctx, path);

  // Set afresh, so the newest read is the last to be forgotten.
  reads.delete(key);
  reads.set(key, hash);
  for (const oldest of reads.keys()) {
    if (reads.size <= READS_KEPT) break;
    reads.delete(oldest);
  }
}

/** Forgets a file that is gone: one made later under the same name was never read. */
export function forgetVersion(ctx: ToolContext, path: string): void {
  readsOf(ctx).delete(readKey(ctx, path));
}

/** What the assistant is told when the file is no longer what it read. */
export const CHANGED_AFTER_READ = "changed after you read it";
