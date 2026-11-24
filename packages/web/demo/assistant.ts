/**
 * The demo's assistant. The demo has no AI key, so it never calls a model:
 * one request, suggested to the visitor, gets an exchange recorded in
 * advance, and its change is made through the same path the real
 * assistant's tools use (an entry edit, a checkpoint for Undo), so it lands
 * in Proof like any other. Anything else is answered with what is true: the
 * demo can't run the assistant.
 *
 * The event sequence is the real server's (chat.message → chat.tool …
 * chat.delta … → chat.message → chat.done), as the mock's own scripted
 * assistant (mock/chat.ts) sends it.
 */
import type { ChatMessage, ChatThread, SendMessageRequest, ToolActivity } from "@galley/core/types";
import type { MockBackend } from "../mock/backend.ts";
import type { MockSite } from "../mock/site.ts";

/** The request the tour suggests, word for word. */
export const SUGGESTED_REQUEST = "Make the line under the home page heading shorter.";

/** The page, the field and the new words of the recorded answer. */
export const RECORDED_EDIT = {
  path: "src/content/pages/index.md",
  field: ["sections", 0, "text"] as const,
  value: "Eight coats and the knits that go under them, shot in the last light.",
};

export const RECORDED_LINE = "Recorded answer · the demo has no AI key";

export const CANT_RUN =
  "The demo can’t run the assistant: it has no AI key, so it only replays one recorded answer. On your own site the assistant uses your own AI key and can make any change you ask for. Try the suggested request below.";

/** True when the visitor sent the suggested request (spacing, case and the full stop don't matter). */
export function isSuggested(text: string): boolean {
  const plain = (value: string) => value.toLowerCase().replace(/[\s.,!?’'"“”]+/g, " ").trim();
  return plain(text) === plain(SUGGESTED_REQUEST);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One turn: the recorded exchange for the suggested request, or the honest refusal. */
export function runDemoTurn(mock: MockBackend, site: MockSite, thread: ChatThread, request: SendMessageRequest): { turnId: string } {
  const turnId = crypto.randomUUID();
  const siteId = site.id;
  const threadId = thread.id;
  const user: ChatMessage = { id: crypto.randomUUID(), role: "user", text: request.text, at: Date.now(), turnId };
  thread.messages.push(user);
  thread.busy = true;
  thread.updatedAt = Date.now();
  if (thread.messages.length === 1) thread.title = request.text.length > 48 ? `${request.text.slice(0, 47)}…` : request.text;
  mock.emit({ type: "chat.message", siteId, threadId, message: user });

  void (async () => {
    const assistant: ChatMessage = { id: crypto.randomUUID(), role: "assistant", text: "", at: Date.now(), turnId, pending: true, tools: [] };
    thread.messages.push(assistant);
    mock.emit({ type: "chat.message", siteId, threadId, message: { ...assistant } });

    const tool = async (name: string, running: string, done: string, work?: () => void) => {
      const activity: ToolActivity = { id: crypto.randomUUID(), name, label: running, status: "running" };
      assistant.tools = [...(assistant.tools ?? []), activity];
      mock.emit({ type: "chat.tool", siteId, threadId, messageId: assistant.id, tool: { ...activity } });
      await sleep(600);
      work?.();
      Object.assign(activity, { label: done, status: "done" });
      mock.emit({ type: "chat.tool", siteId, threadId, messageId: assistant.id, tool: { ...activity } });
    };

    let reply = CANT_RUN;
    if (isSuggested(request.text) && site.read(RECORDED_EDIT.path)) {
      const entry = site.readEntry(RECORDED_EDIT.path);
      await tool("demo", RECORDED_LINE, RECORDED_LINE);
      await tool("read_entry", `Reading ${entry.title}`, "Read Home page");
      await tool("update_entry", "Editing Home › Campaign hero › Text", "Edited Home › Campaign hero › Text", () => {
        site.updateEntry(RECORDED_EDIT.path, [{ op: "set", path: [...RECORDED_EDIT.field], value: RECORDED_EDIT.value }], turnId);
        assistant.changedPaths = [RECORDED_EDIT.path];
        mock.changed(siteId, [RECORDED_EDIT.path], "agent");
      });
      reply = `The line under the heading now reads “${RECORDED_EDIT.value}” It’s waiting in Proof.`;
    } else {
      assistant.options = [{ label: SUGGESTED_REQUEST }];
    }

    if (!thread.busy) reply = "Stopped before changing anything.";
    const words = reply.split(/(?<=\s)/);
    for (let i = 0; i < words.length; i += 3) {
      const chunk = words.slice(i, i + 3).join("");
      assistant.text += chunk;
      mock.emit({ type: "chat.delta", siteId, threadId, messageId: assistant.id, text: chunk });
      await sleep(40);
    }
    assistant.pending = false;
    thread.busy = false;
    thread.updatedAt = Date.now();
    thread.messageCount = thread.messages.length;
    mock.emit({ type: "chat.message", siteId, threadId, message: { ...assistant } });
    mock.emit({ type: "chat.done", siteId, threadId, turnId });
  })();

  return { turnId };
}
