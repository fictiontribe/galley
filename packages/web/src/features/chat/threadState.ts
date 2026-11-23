/**
 * A conversation as the stream builds it. `applyEvent` turns one chat.*
 * event into the next thread state; replaying a message event is harmless
 * (messages are replaced by id), and `mergeThread` folds a re-fetched thread
 * back in after the event stream drops, without losing or doubling anything.
 */
import type { ChatMessage, ChatOption, ChatThread, ServerEvent, ToolActivity } from "@galley/core/types";

export type ChatEvent = Extract<ServerEvent, { type: "chat.delta" | "chat.tool" | "chat.message" | "chat.done" | "chat.error" }>;

function replaceMessage(thread: ChatThread, index: number, message: ChatMessage): ChatThread {
  const messages = [...thread.messages];
  messages[index] = message;
  return { ...thread, messages };
}

function upsertTool(tools: ToolActivity[] | undefined, tool: ToolActivity): ToolActivity[] {
  const list = tools ?? [];
  const at = list.findIndex((existing) => existing.id === tool.id);
  if (at === -1) return [...list, tool];
  const next = [...list];
  next[at] = tool;
  return next;
}

/** A message arrived or was finalised. A still-pending copy keeps the text already streamed. */
function receive(thread: ChatThread, message: ChatMessage): ChatThread {
  const at = thread.messages.findIndex((existing) => existing.id === message.id);
  const busy = message.pending ? true : thread.busy;
  if (at === -1) {
    return { ...thread, busy, messages: [...thread.messages, message], messageCount: thread.messages.length + 1, updatedAt: Math.max(thread.updatedAt, message.at) };
  }
  const existing = thread.messages[at] as ChatMessage;
  const merged: ChatMessage =
    message.pending && existing.pending
      ? { ...message, text: message.text.length >= existing.text.length ? message.text : existing.text, tools: message.tools?.length ? message.tools : existing.tools }
      : message;
  return { ...replaceMessage(thread, at, merged), busy };
}

export function applyEvent(thread: ChatThread, event: ChatEvent): ChatThread {
  if (event.threadId !== thread.id) return thread;
  switch (event.type) {
    case "chat.message":
      return receive(thread, event.message);
    case "chat.delta": {
      const at = thread.messages.findIndex((message) => message.id === event.messageId);
      const message = thread.messages[at];
      if (!message || !message.pending) return thread;
      return replaceMessage(thread, at, { ...message, text: message.text + event.text });
    }
    case "chat.tool": {
      const at = thread.messages.findIndex((message) => message.id === event.messageId);
      const message = thread.messages[at];
      if (!message) return thread;
      return replaceMessage(thread, at, { ...message, tools: upsertTool(message.tools, event.tool) });
    }
    case "chat.done": {
      const messages = thread.messages.map((message) => (message.turnId === event.turnId && message.pending ? { ...message, pending: false } : message));
      return { ...thread, busy: false, messages };
    }
    case "chat.error": {
      const at = thread.messages.findIndex((message) => message.turnId === event.turnId && message.role === "assistant");
      const message = thread.messages[at];
      if (!message) {
        const synthetic: ChatMessage = { id: `error-${event.turnId}`, role: "assistant", text: "", at: Date.now(), turnId: event.turnId, error: event.message };
        return { ...thread, busy: false, messages: [...thread.messages, synthetic] };
      }
      return { ...replaceMessage(thread, at, { ...message, pending: false, error: message.error ?? event.message }), busy: false };
    }
  }
}

/**
 * The server's copy after a reconnect, with anything that arrived meanwhile
 * kept: messages only we have (newer than the server's last) stay at the
 * end, and a reply still streaming keeps the longer text.
 */
export function mergeThread(local: ChatThread | null, server: ChatThread): ChatThread {
  if (!local || local.id !== server.id) return server;
  const known = new Map(local.messages.map((message) => [message.id, message]));
  const serverIds = new Set(server.messages.map((message) => message.id));
  const latest = server.messages.reduce((max, message) => Math.max(max, message.at), 0);
  const messages = server.messages.map((message) => {
    const mine = known.get(message.id);
    if (mine && message.pending && mine.pending && mine.text.length > message.text.length) return { ...message, text: mine.text, tools: mine.tools ?? message.tools };
    return message;
  });
  const extra = local.messages.filter((message) => !serverIds.has(message.id) && message.at >= latest);
  return { ...server, messages: [...messages, ...extra] };
}

/** Quick replies: the options of the last message, when it is the assistant's finished question. */
export function quickReplies(thread: ChatThread | null): ChatOption[] {
  const last = thread?.messages[thread.messages.length - 1];
  if (!last || last.role !== "assistant" || last.pending || last.undone) return [];
  return last.options ?? [];
}

export type ActivityKind = "running" | "read" | "edit" | "remove" | "failed";

/** How a tool line is marked: stet for reading, caret for edits, dele for removals, bang when it failed. */
export function activityKind(tool: ToolActivity): ActivityKind {
  if (tool.status === "running") return "running";
  if (tool.status === "error") return "failed";
  const name = tool.name.toLowerCase();
  if (/^(delete|remove)_/.test(name)) return "remove";
  if (/^(read|search|list|get|find|validate|run|ask)_|^validate$/.test(name)) return "read";
  return "edit";
}

/** What the person typed before, newest last, for ↑ recall. */
export function promptHistory(thread: ChatThread | null): string[] {
  return (thread?.messages ?? []).filter((message) => message.role === "user" && message.text.trim()).map((message) => message.text);
}
