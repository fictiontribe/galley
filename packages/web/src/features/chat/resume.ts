/**
 * Picking up where the person left off. The pane remembers the open
 * conversation per site; once that is none (a new conversation was started
 * and left empty, or the open one was deleted), reopening the editor showed
 * an empty pane while the earlier conversation sat under Chats, as if lost.
 * The empty pane now offers the most recent conversation in one line.
 */
import type { ChatThreadSummary } from "@galley/core/types";
import { relativeTime } from "@/lib/format";

/** The conversation to offer: the most recently active one with something in it, other than the one open. */
export function lastConversation(threads: readonly ChatThreadSummary[] | undefined, openId: string | null): ChatThreadSummary | null {
  let best: ChatThreadSummary | null = null;
  for (const thread of threads ?? []) {
    if (thread.id === openId || thread.messageCount === 0) continue;
    if (!best || thread.updatedAt > best.updatedAt) best = thread;
  }
  return best;
}

/** "Continue your last conversation: “Shorten the heading” · 5 min ago". */
export function continueLine(thread: ChatThreadSummary, now: number = Date.now()): { label: string; detail: string } {
  const when = relativeTime(thread.updatedAt, now);
  return { label: "Continue your last conversation", detail: `“${thread.title.trim() || "Untitled"}”${when ? ` · ${when}` : ""}` };
}
