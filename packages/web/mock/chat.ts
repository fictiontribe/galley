/**
 * A scripted assistant. It streams the same event sequence the real one does
 * (chat.message → chat.tool → chat.delta … → chat.message → chat.done) and
 * makes real edits through the mock site, so Proof and Undo work end to end.
 *
 * Script: a request with quoted text (“…”) sets the page's first heading to
 * it — and, when it says "both", "every" or "all", the next page's too, so a
 * reply that changed two pages can be undone in part; "find"/"search" runs a
 * search; anything else gets one question with options, and answering with
 * an option makes that edit.
 */
import { randomUUID } from "node:crypto";
import type { ChatMessage, ChatThread, FieldPath, JsonValue, SendMessageRequest, ToolActivity, TurnUsage, UndoResult } from "@galley/core/types";
import type { MockBackend } from "./backend.ts";
import type { MockSite } from "./site.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const OPTIONS = [
  { label: "Heading", detail: "The big line at the top" },
  { label: "Introduction", detail: "The paragraph under it" },
  { label: "Button", detail: "The main button’s words" },
];

function usage(): TurnUsage {
  return { model: "claude-opus-5-5", requests: 3, inputTokens: 12_480, outputTokens: 412, cacheReadTokens: 38_000, cacheWriteTokens: 4_100, cost: 0.08 };
}

function targetEntry(site: MockSite, entryPath: string | undefined): string | null {
  if (entryPath && site.read(entryPath)) return entryPath;
  const home = site.entryForUrl("/");
  if (home) return home.path;
  const first = site.model().collections.find((c) => c.kind === "entries" && c.count > 0);
  return first ? (site.listEntries(first.id, { limit: 1 }).items[0]?.path ?? null) : null;
}

/** Where the first heading of an entry lives: a hero section's heading, or its title. */
function headingField(data: { [key: string]: JsonValue }, which: string): { path: FieldPath; label: string; value: string } | null {
  const sections = data.sections;
  const first = Array.isArray(sections) ? sections[0] : undefined;
  if (first && typeof first === "object" && !Array.isArray(first)) {
    const type = typeof first.type === "string" ? first.type : "section";
    const name = type.charAt(0).toUpperCase() + type.slice(1);
    if (which === "Introduction" && typeof first.text === "string") return { path: ["sections", 0, "text"], label: `${name} › Text`, value: first.text };
    if (which === "Button" && first.cta && typeof first.cta === "object" && !Array.isArray(first.cta) && typeof first.cta.label === "string")
      return { path: ["sections", 0, "cta", "label"], label: `${name} › CTA › Label`, value: first.cta.label };
    if (typeof first.heading === "string") return { path: ["sections", 0, "heading"], label: `${name} › Heading`, value: first.heading };
  }
  return typeof data.title === "string" ? { path: ["title"], label: "Title", value: data.title } : null;
}

function rewrite(which: string, current: string): string {
  if (which === "Introduction") return `${current.split(/(?<=\.)\s/)[0] ?? current}`;
  if (which === "Button") return "Book a visit";
  const words = current.replace(/[*_]/g, "").split(/\s+/);
  return `${words.slice(0, Math.min(6, words.length)).join(" ").replace(/[.,;:—-]+$/, "")}.`;
}

export function seedThread(site: MockSite): ChatThread {
  const turnId = randomUUID();
  const at = Date.now() - 25 * 60_000;
  const home = site.entryForUrl("/");
  const user: ChatMessage = { id: randomUUID(), role: "user", text: "Make the home page heading about houses people already love, and shorten the intro.", at, turnId };
  const tools: ToolActivity[] = [
    { id: randomUUID(), name: "read_entry", label: "Read Home page", status: "done" },
    { id: randomUUID(), name: "update_entry", label: "Edited Home › Hero › Heading", status: "done" },
    { id: randomUUID(), name: "update_entry", label: "Edited Home › Hero › Text", status: "done" },
  ];
  const reply: ChatMessage = {
    id: randomUUID(),
    role: "assistant",
    text: "The heading now reads “Make more of the house you already love.” and the introduction is down to two sentences. Both are waiting in Proof — nothing is published.",
    at: at + 9000,
    turnId,
    tools,
    changedPaths: home ? [home.path] : [],
    options: [{ label: "Show me the proof" }, { label: "Try a shorter heading" }],
    usage: usage(),
  };
  return { id: randomUUID(), title: "Home page heading", mode: "content", createdAt: at, updatedAt: at + 9000, messageCount: 2, busy: false, messages: [user, reply] };
}

export function runTurn(mock: MockBackend, site: MockSite, thread: ChatThread, request: SendMessageRequest): { turnId: string } {
  const turnId = randomUUID();
  const siteId = site.id;
  const threadId = thread.id;
  const user: ChatMessage = {
    id: randomUUID(),
    role: "user",
    text: request.text,
    at: Date.now(),
    turnId,
    attachments: request.attachments?.map(({ dataUrl: _dataUrl, ...rest }) => rest),
  };
  thread.messages.push(user);
  thread.busy = true;
  thread.updatedAt = Date.now();
  if (thread.messages.length === 1) thread.title = request.text.length > 48 ? `${request.text.slice(0, 47)}…` : request.text;
  mock.emit({ type: "chat.message", siteId, threadId, message: user });

  void (async () => {
    const assistant: ChatMessage = { id: randomUUID(), role: "assistant", text: "", at: Date.now(), turnId, pending: true, tools: [] };
    thread.messages.push(assistant);
    mock.emit({ type: "chat.message", siteId, threadId, message: { ...assistant } });

    const tool = async (name: string, running: string, done: string, work?: () => void) => {
      const activity: ToolActivity = { id: randomUUID(), name, label: running, status: "running" };
      assistant.tools = [...(assistant.tools ?? []), activity];
      mock.emit({ type: "chat.tool", siteId, threadId, messageId: assistant.id, tool: { ...activity } });
      await sleep(550);
      work?.();
      Object.assign(activity, { label: done, status: "done" });
      mock.emit({ type: "chat.tool", siteId, threadId, messageId: assistant.id, tool: { ...activity } });
    };
    const cancelled = () => !thread.busy;

    const path = targetEntry(site, request.context?.entryPath);
    const entry = path ? site.readEntry(path) : null;
    const quoted = /[“"]([^”"]+)[”"]/.exec(request.text)?.[1];
    const previous = [...thread.messages].reverse().find((m) => m.role === "assistant" && m.id !== assistant.id);
    const answered = previous?.options?.find((o) => o.label.toLowerCase() === request.text.trim().toLowerCase())?.label;
    let reply: string;

    if (entry) await tool("read_entry", `Reading ${entry.title}`, `Read ${entry.title}`);
    if (cancelled()) return finish("Stopped before changing anything.");

    if (entry && path && (quoted || (answered && OPTIONS.some((o) => o.label === answered)))) {
      const which = answered ?? "Heading";
      const field = headingField(entry.data, which);
      if (!field) reply = "I couldn’t find a heading on this page, so I didn’t change anything.";
      else {
        const next = quoted ?? rewrite(which, field.value);
        await tool("update_entry", `Editing ${entry.title} › ${field.label}`, `Edited ${entry.title} › ${field.label}`, () => {
          site.updateEntry(path, [{ op: "set", path: field.path, value: next }], turnId);
          assistant.changedPaths = [path];
          mock.changed(siteId, [path], "agent");
        });
        reply = `The ${field.label.split(" › ").pop()?.toLowerCase()} now reads “${next}”. It’s waiting in Proof.`;
        // A second page in the same reply, when asked for more than one.
        const other = quoted && /\b(both|every|all)\b/i.test(request.text) ? site.listEntries(entry.collection, { limit: 5 }).items.find((item) => item.path !== path) : undefined;
        const otherEntry = other ? site.readEntry(other.path) : null;
        const otherField = otherEntry ? headingField(otherEntry.data, "Heading") : null;

        if (other && otherEntry && otherField) {
          await tool("update_entry", `Editing ${otherEntry.title} › ${otherField.label}`, `Edited ${otherEntry.title} › ${otherField.label}`, () => {
            site.updateEntry(other.path, [{ op: "set", path: otherField.path, value: next }], turnId);
            assistant.changedPaths = [path, other.path];
            mock.changed(siteId, [other.path], "agent");
          });
          reply = `Both headings now read “${next}”. They’re waiting in Proof.`;
        }
      }
    } else if (/\b(find|search|where)\b/i.test(request.text)) {
      const term = request.text.replace(/.*\b(find|search|where)\b\s*(for|is|are)?\s*/i, "").replace(/[?.!]+$/, "").trim() || "home";
      const hits = site.search(term, undefined, 5);
      await tool("search_content", `Searching for “${term}”`, `Searched for “${term}” · ${hits.length} ${hits.length === 1 ? "place" : "places"}`);
      reply = hits.length
        ? `“${term}” appears on ${hits.map((h) => h.title).slice(0, 3).join(", ")}${hits.length > 3 ? " and more" : ""}. Nothing was changed.`
        : `No page mentions “${term}”. Try a shorter word. Nothing was changed.`;
    } else {
      assistant.options = OPTIONS;
      reply = `Which part of ${entry?.title ?? "the page"} should change?`;
    }

    if (cancelled()) return finish("Stopped before finishing. Nothing else was changed.");
    const words = reply.split(/(?<=\s)/);
    for (let i = 0; i < words.length; i += 3) {
      const chunk = words.slice(i, i + 3).join("");
      assistant.text += chunk;
      mock.emit({ type: "chat.delta", siteId, threadId, messageId: assistant.id, text: chunk });
      await sleep(45);
    }
    finish();

    function finish(stopped?: string) {
      if (stopped) {
        assistant.text = assistant.text || stopped;
        assistant.error = stopped;
      }
      assistant.pending = false;
      assistant.usage = usage();
      thread.busy = false;
      thread.updatedAt = Date.now();
      thread.messageCount = thread.messages.length;
      mock.emit({ type: "chat.message", siteId, threadId, message: { ...assistant } });
      if (stopped) mock.emit({ type: "chat.error", siteId, threadId, turnId, message: stopped });
      mock.emit({ type: "chat.done", siteId, threadId, turnId });
    }
  })();

  return { turnId };
}

/** As the engine does: a file goes back only while it still holds what the reply left there; one changed again since is left, and named. */
export function undoTurn(mock: MockBackend, site: MockSite, thread: ChatThread, turnId: string): UndoResult {
  const checkpoint = site.checkpoints.get(turnId);
  const wrote = site.wrote.get(turnId);
  const same = (a: Buffer | null, b: Buffer | null) => (a === null || b === null ? a === b : a.equals(b));
  const restored: string[] = [];
  const left: string[] = [];

  for (const [path, bytes] of checkpoint ?? []) {
    const now = site.read(path);

    if (same(now, bytes) || same(now, wrote?.get(path) ?? null)) {
      site.write(path, bytes);
      restored.push(path);
    } else left.push(path);
  }
  site.checkpoints.delete(turnId);
  site.wrote.delete(turnId);
  for (const message of thread.messages) {
    if (message.turnId === turnId && message.role === "assistant") {
      message.undone = true;
      if (left.length) message.undoLeft = left;
      mock.emit({ type: "chat.message", siteId: site.id, threadId: thread.id, message: { ...message } });
    }
  }
  if (restored.length) mock.changed(site.id, restored, "undo");
  return { restored, left };
}
