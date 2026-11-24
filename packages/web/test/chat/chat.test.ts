import { describe, expect, it } from "vitest";
import type { ChatMessage, ChatThread } from "@galley/core/types";
import { checkAttachments, MAX_ATTACHMENTS } from "../../src/features/chat/attachments";
import { renderMarkdown, safeHref } from "../../src/features/chat/renderMarkdown";
import { activityKind, applyEvent, mergeThread, promptHistory, quickReplies, type ChatEvent } from "../../src/features/chat/threadState";
import { continueLine, lastConversation } from "../../src/features/chat/resume";

const S = "site-1";
const T = "thread-1";
const thread = (messages: ChatMessage[] = [], busy = false): ChatThread => ({ id: T, title: "New conversation", mode: "content", createdAt: 1, updatedAt: 1, messageCount: messages.length, busy, messages });
const user: ChatMessage = { id: "u1", role: "user", text: "Shorten the heading", at: 10, turnId: "t1" };
const pending: ChatMessage = { id: "a1", role: "assistant", text: "", at: 11, turnId: "t1", pending: true };

function play(start: ChatThread, events: ChatEvent[]): ChatThread {
  return events.reduce(applyEvent, start);
}

describe("the stream reducer", () => {
  const turn: ChatEvent[] = [
    { type: "chat.message", siteId: S, threadId: T, message: user },
    { type: "chat.message", siteId: S, threadId: T, message: pending },
    { type: "chat.tool", siteId: S, threadId: T, messageId: "a1", tool: { id: "x", name: "update_entry", label: "Editing Home › Hero › Heading", status: "running" } },
    { type: "chat.tool", siteId: S, threadId: T, messageId: "a1", tool: { id: "x", name: "update_entry", label: "Edited Home › Hero › Heading", status: "done" } },
    { type: "chat.delta", siteId: S, threadId: T, messageId: "a1", text: "The heading now reads " },
    { type: "chat.delta", siteId: S, threadId: T, messageId: "a1", text: "“Make more of it.”" },
  ];

  it("builds a turn from its events: messages, tool lines updated in place, streamed text", () => {
    const state = play(thread(), turn);
    expect(state.busy).toBe(true);
    expect(state.messages.map((message) => message.id)).toEqual(["u1", "a1"]);
    expect(state.messages[1]?.tools).toEqual([{ id: "x", name: "update_entry", label: "Edited Home › Hero › Heading", status: "done" }]);
    expect(state.messages[1]?.text).toBe("The heading now reads “Make more of it.”");
  });

  it("is idempotent for messages: a repeated or finalised message replaces, never duplicates", () => {
    const final: ChatMessage = { ...pending, pending: false, text: "The heading now reads “Make more of it.” It’s waiting in Proof.", changedPaths: ["index.md"] };
    const state = play(thread(), [...turn, { type: "chat.message", siteId: S, threadId: T, message: final }, { type: "chat.message", siteId: S, threadId: T, message: final }, { type: "chat.done", siteId: S, threadId: T, turnId: "t1" }]);
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]).toEqual(final);
    expect(state.busy).toBe(false);
  });

  it("keeps streamed text when the pending message is announced again", () => {
    const state = play(thread(), [...turn, { type: "chat.message", siteId: S, threadId: T, message: pending }]);
    expect(state.messages[1]?.text).toBe("The heading now reads “Make more of it.”");
  });

  it("ignores other threads and deltas for finished messages", () => {
    const start = thread([user, { ...pending, pending: false, text: "Done." }]);
    expect(applyEvent(start, { type: "chat.delta", siteId: S, threadId: "other", messageId: "a1", text: "x" })).toBe(start);
    expect(applyEvent(start, { type: "chat.delta", siteId: S, threadId: T, messageId: "a1", text: "x" })).toBe(start);
  });

  it("records an error on the turn's reply, or adds one when the reply never came", () => {
    const withReply = play(thread([user, pending], true), [{ type: "chat.error", siteId: S, threadId: T, turnId: "t1", message: "The assistant is overloaded right now. Try again in a minute." }]);
    expect(withReply.messages[1]).toMatchObject({ pending: false, error: "The assistant is overloaded right now. Try again in a minute." });
    expect(withReply.busy).toBe(false);
    const without = play(thread([user], true), [{ type: "chat.error", siteId: S, threadId: T, turnId: "t1", message: "Stopped." }]);
    expect(without.messages[1]).toMatchObject({ role: "assistant", error: "Stopped.", turnId: "t1" });
  });
});

describe("after a reconnect", () => {
  it("takes the server's thread without losing what arrived meanwhile or doubling it", () => {
    const streaming = { ...pending, text: "Half a reply" };
    const later: ChatMessage = { id: "u2", role: "user", text: "And the intro", at: 50, turnId: "t2" };
    const local = thread([user, streaming, later], true);
    const server = thread([user, { ...pending, text: "" }], true);
    const merged = mergeThread(local, server);
    expect(merged.messages.map((message) => message.id)).toEqual(["u1", "a1", "u2"]);
    expect(merged.messages[1]?.text).toBe("Half a reply");
  });

  it("prefers the server's finished messages", () => {
    const final = { ...pending, pending: false, text: "Finished." };
    expect(mergeThread(thread([user, { ...pending, text: "Fini" }]), thread([user, final])).messages[1]).toEqual(final);
    expect(mergeThread(null, thread([user])).messages).toEqual([user]);
  });
});

describe("what the panel shows", () => {
  it("offers quick replies only on the last finished question", () => {
    const question: ChatMessage = { ...pending, pending: false, text: "Which part?", options: [{ label: "Heading" }, { label: "Button" }] };
    expect(quickReplies(thread([user, question])).map((option) => option.label)).toEqual(["Heading", "Button"]);
    expect(quickReplies(thread([user, { ...question, pending: true }]))).toEqual([]);
    expect(quickReplies(thread([user, question, { ...user, id: "u2" }]))).toEqual([]);
    expect(quickReplies(null)).toEqual([]);
  });

  it("marks tool lines by what they did", () => {
    const tool = (name: string, status: "running" | "done" | "error" = "done") => ({ id: "1", name, label: "x", status });
    expect(activityKind(tool("read_entry"))).toBe("read");
    expect(activityKind(tool("search_content"))).toBe("read");
    expect(activityKind(tool("update_entry"))).toBe("edit");
    expect(activityKind(tool("write_file"))).toBe("edit");
    expect(activityKind(tool("delete_entry"))).toBe("remove");
    expect(activityKind(tool("update_entry", "running"))).toBe("running");
    expect(activityKind(tool("update_entry", "error"))).toBe("failed");
  });

  it("recalls earlier requests, newest last", () => {
    expect(promptHistory(thread([user, pending, { ...user, id: "u2", text: "Now the intro" }]))).toEqual(["Shorten the heading", "Now the intro"]);
  });
});

describe("attachments", () => {
  it("takes images within the limits and says plainly why others were refused", () => {
    const image = (name: string, size = 1000) => ({ name, type: "image/png", size });
    const { accepted, problems } = checkAttachments([image("a.png"), { name: "notes.pdf", type: "application/pdf", size: 10 }, image("huge.png", 50 * 1024 * 1024)], 0);
    expect(accepted.map((file) => file.name)).toEqual(["a.png"]);
    expect(problems).toEqual(["“notes.pdf” isn’t an image. Attach PNG, JPG, WebP, GIF, AVIF or SVG files.", "“huge.png” is 50 MB, larger than 10 MB. Make it smaller and attach it again."]);
    const many = checkAttachments([image("x.png"), image("y.png")], MAX_ATTACHMENTS - 1);
    expect(many.accepted).toHaveLength(1);
    expect(many.problems[0]).toBe(`Only ${MAX_ATTACHMENTS} images fit in one message, so “y.png” wasn’t added.`);
  });
});

describe("assistant markdown", () => {
  it("renders Markdown, escapes raw HTML and opens links in a new tab without a window reference", () => {
    const html = renderMarkdown("The heading now reads **“Hi”**. See [the guide](https://example.com/guide).\n\n<script>alert(1)</script>");
    expect(html).toContain("<strong>“Hi”</strong>");
    expect(html).toContain('<a href="https://example.com/guide" target="_blank" rel="noopener noreferrer">the guide</a>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("drops unsafe and site-relative links, keeping their words", () => {
    expect(renderMarkdown("[click](javascript:alert(1))")).not.toContain("<a");
    expect(renderMarkdown("[pricing](/pricing/)")).toContain("pricing");
    expect(renderMarkdown("[pricing](/pricing/)")).not.toContain("href");
    expect(renderMarkdown("![x](https://evil.example/t.png)")).not.toContain("<img");
    expect(safeHref("mailto:hello@example.com")).toBe("mailto:hello@example.com");
    expect(safeHref("data:text/html,x")).toBeNull();
  });
});

describe("picking up the last conversation", () => {
  const summary = (id: string, updatedAt: number, messageCount: number, title = "Shorten the heading") => ({ id, title, mode: "content" as const, createdAt: 1, updatedAt, messageCount, busy: false });

  it("offers the most recent conversation with something in it when the pane opens empty", () => {
    const threads = [summary("old", 100, 4), summary("recent", 300, 2), summary("blank", 400, 0)];

    expect(lastConversation(threads, null)?.id).toBe("recent");
    // A new, empty conversation is open: the earlier one is still offered.
    expect(lastConversation(threads, "blank")?.id).toBe("recent");
    expect(lastConversation(threads, "recent")?.id).toBe("old");
    expect(lastConversation([summary("blank", 400, 0)], null)).toBeNull();
    expect(lastConversation(undefined, null)).toBeNull();
  });

  it("says it in one line, with the conversation's title and when", () => {
    const now = Date.parse("2026-11-24T12:00:00Z");

    expect(continueLine(summary("recent", now - 5 * 60_000, 2), now)).toEqual({ label: "Continue your last conversation", detail: expect.stringMatching(/^“Shorten the heading” · 5 min/) });
    expect(continueLine(summary("x", now, 1, "  "), now).detail).toMatch(/^“Untitled”/);
  });
});
