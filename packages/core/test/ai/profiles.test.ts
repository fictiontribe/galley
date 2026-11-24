/**
 * The request profiles and the degradation ladder, through the real SDK
 * against a scripted fetch.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTEXT_FULL_MESSAGE } from "../../src/ai/loop";
import { renderPlainMessages, thinkingBoundary, type HistoryEntry } from "../../src/ai/profiles";
import { BUILD_TOOL_NAMES, toolsForMode } from "../../src/ai/tools/index";
import { summarizeUsage } from "../../src/ai/usage";
import type { ChatMessage, ServerEvent } from "../../src/types";
import { hashContent } from "../../src/workspace/files";
import { createFakeSite } from "./helpers/fake-site";
import { harness } from "./helpers/env";
import { TEST_KEY, apiError, scriptedFetch, stream, testClient, type MessageSpec, type RecordedRequest } from "./helpers/scripted-fetch";

/** The About page as every fake site starts with it: the version an edit says it was made from, as if an earlier reply had read it. */
const ABOUT_AS_READ = hashContent(createFakeSite().files.get("src/content/pages/about.md") as string);

const thinking = (signature: string) => ({ type: "thinking" as const, thinking: "", signature });
const say = (text: string, sig = `sig-${text.length}`) => stream({ content: [thinking(sig), { type: "text", text }], stop_reason: "end_turn" } satisfies MessageSpec);
const call = (id: string, name: string, input: unknown, sig = `sig-${id}`) => stream({ content: [thinking(sig), { type: "tool_use", id, name, input, chunks: 3 }], stop_reason: "tool_use" } satisfies MessageSpec);
const shapeRefused = () => apiError(400, "invalid_request_error", "Unexpected value(s) `compact-2026-01-12` for the `anthropic-beta` header.", { "request-id": "req_shape_1" });

async function setup(steps: Parameters<typeof scriptedFetch>[0], options: Partial<Parameters<typeof harness>[0]> = {}) {
  const script = scriptedFetch(steps);
  const site = createFakeSite();
  const h = harness({ client: testClient(script.fetch), site, ...options });
  const thread = await h.runtime.createThread(site.id);

  return { script, site, h, thread };
}

function finals(events: ServerEvent[]): ChatMessage[] {
  return events
    .filter((e): e is Extract<ServerEvent, { type: "chat.message" }> => e.type === "chat.message")
    .map((e) => e.message)
    .filter((m) => m.role === "assistant" && !m.pending);
}

function isFull(request: RecordedRequest): boolean {
  return Boolean(request.headers["anthropic-beta"]?.includes("thinking-binding-controls-2026-08-01"));
}

/** The plain shape, exactly: GA endpoint, the listed params and nothing else. */
function expectPlainShape(request: RecordedRequest, mode: "content" | "build"): void {
  const body = request.body;

  expect(request.url).toBe("https://api.anthropic.com/v1/messages");
  expect(request.headers["anthropic-beta"]).toBeUndefined();
  expect(Object.keys(body).sort()).toEqual(["max_tokens", "messages", "model", "output_config", "stream", "system", "thinking", "tools"]);
  expect(body.thinking).toEqual({ type: "adaptive" });
  expect(body.output_config).toEqual({ effort: "medium" });
  expect(body.system).toHaveLength(2);
  expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
  expect(body.system[1].cache_control).toEqual({ type: "ephemeral" });
  expect(body.tools.map((t: { name: string }) => t.name)).toEqual(toolsForMode(mode).map((t) => t.name));
  for (const tool of body.tools) {
    expect(tool.eager_input_streaming).toBe(true);
    expect(tool).not.toHaveProperty("defer_loading");
  }
  const text = JSON.stringify(body.messages);

  for (const marker of ['"role":"system"', "tool_addition", "tool_removal", '"fallback"', '"compaction"']) expect(text).not.toContain(marker);
}

describe("the ladder", () => {
  it("retries a refused full request once on plain, remembers plain, and doesn't fail again next turn", async () => {
    const { script, h, thread } = await setup([shapeRefused(), say("Hello from plain."), say("Still plain.")]);

    await h.turn(thread.id, "Hi");
    expect(script.requests).toHaveLength(2);
    expect(isFull(script.requests[0]!)).toBe(true);
    expectPlainShape(script.requests[1]!, "content");
    // Same step: the plain retry carries the same conversation.
    expect(script.requests[1]!.body.messages).toEqual(script.requests[0]!.body.messages);
    expect(finals(h.bus.events).at(-1)?.text).toBe("Hello from plain.");
    expect(h.bus.events.some((e) => e.type === "chat.error")).toBe(false);
    const line = h.logs.find((l) => l.startsWith("using the plain request profile"));

    expect(line).toContain("claude-opus-5-5");
    expect(line).toContain("req_shape_1");
    expect(line).toContain("invalid_request_error");
    expect(line).toContain("compact-2026-01-12");
    expect(h.logs.join("\n")).not.toContain(TEST_KEY);
    const first = finals(h.bus.events).at(-1)!;

    expect(h.runtime.turnProfile(first.turnId)).toBe("plain");

    await h.turn(thread.id, "Again");
    expect(script.requests).toHaveLength(3);
    expectPlainShape(script.requests[2]!, "content");
    expect(h.runtime.turnProfile(finals(h.bus.events).at(-1)!.turnId)).toBe("plain");
  });

  it("shows the original error once when plain is refused too, and doesn't remember plain", async () => {
    const { script, h, thread } = await setup([shapeRefused(), apiError(400, "invalid_request_error", "plain refused too"), say("Full works now.")]);

    await h.turn(thread.id, "Hi");
    expect(script.requests).toHaveLength(2);
    const errors = h.bus.events.filter((e) => e.type === "chat.error");

    expect(errors).toEqual([expect.objectContaining({ message: "The assistant couldn't accept that request. Try again; if it keeps happening, start a new conversation." })]);
    await h.turn(thread.id, "Again");
    expect(isFull(script.requests[2]!)).toBe(true);
  });

  it.each([
    [401, "authentication_error", "The assistant can't connect"],
    [429, "rate_limit_error", "too many requests"],
    [529, "overloaded_error", "overloaded"],
  ])("never ladders on %i", async (status, type, message) => {
    const { script, h, thread } = await setup([apiError(status, type, "nope")]);

    await h.turn(thread.id, "Hi");
    expect(script.requests).toHaveLength(1);
    expect(isFull(script.requests[0]!)).toBe(true);
    expect(h.bus.events.find((e) => e.type === "chat.error")).toMatchObject({ message: expect.stringContaining(message) });
  });

  it("doesn't ladder on a bad-request error that arrives inside an open stream", async () => {
    const { script, h, thread } = await setup([
      stream({ content: [{ type: "text", text: "Starting" }, { type: "text", text: "x" }], stop_reason: "end_turn", errorAfterBlocks: { blocks: 1, error: { type: "invalid_request_error", message: "late" } } }),
    ]);

    await h.turn(thread.id, "Hi");
    expect(script.requests).toHaveLength(1);
  });
});

describe("pinning the profile", () => {
  it("runs plain from the first request when pinned by option, and doesn't ladder", async () => {
    const { script, h, thread } = await setup([apiError(400, "invalid_request_error", "no")], { profile: "plain" });

    await h.turn(thread.id, "Hi");
    expect(script.requests).toHaveLength(1);
    expectPlainShape(script.requests[0]!, "content");
    expect(h.bus.events.some((e) => e.type === "chat.error")).toBe(true);
  });

  it("pins full from GALLEY_AI_PROFILE and doesn't ladder", async () => {
    const { script, h, thread } = await setup([shapeRefused()], { profileEnv: { GALLEY_AI_PROFILE: "full" } });

    await h.turn(thread.id, "Hi");
    expect(script.requests).toHaveLength(1);
    expect(isFull(script.requests[0]!)).toBe(true);
  });

  it("lets the option beat the environment", async () => {
    const { script, h, thread } = await setup([say("ok")], { profile: "plain", profileEnv: { GALLEY_AI_PROFILE: "full" } });

    await h.turn(thread.id, "Hi");
    expectPlainShape(script.requests[0]!, "content");
  });
});

describe("plain conversations", () => {
  it("round-trips a tool call and replays this turn's thinking unchanged", async () => {
    const { script, site, h, thread } = await setup(
      [
        call("toolu_p1", "update_entry", { path: "src/content/pages/about.md", baseHash: ABOUT_AS_READ, ops: [{ op: "body-replace", find: "We bake before dawn. We", replace: "We bake at four. We" }] }),
        say("Done — it's in Proof."),
        say("Second turn."),
      ],
      { profile: "plain" }
    );

    await h.turn(thread.id, "Say we bake at four");
    expect(site.files.get("src/content/pages/about.md")).toContain("We bake at four.");
    const second = script.requests[1]!;

    expectPlainShape(second, "content");
    expect(second.body.messages.slice(0, -2)).toEqual(script.requests[0]!.body.messages);
    expect(second.body.messages.at(-2)).toEqual({
      role: "assistant",
      content: [thinking("sig-toolu_p1"), { type: "tool_use", id: "toolu_p1", name: "update_entry", input: expect.any(Object) }],
    });
    expect(second.body.messages.at(-1).content[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_p1" });

    // Same mode, same profile: the previous turn's thinking is still a valid prefix and is kept.
    await h.turn(thread.id, "Thanks");
    const third = script.requests[2]!.body.messages;

    expect(third.slice(0, second.body.messages.length)).toEqual(second.body.messages);
  });

  it("changes the tool list on a mode switch, sends the note as user text, and drops thinking made with the other tool list", async () => {
    const { script, h, thread } = await setup([say("Content reply.", "sig-content"), say("Build reply.")], { profile: "plain" });

    await h.turn(thread.id, "Hi");
    await h.turn(thread.id, "Now the theme", { mode: "build" });
    const [first, second] = script.requests as [RecordedRequest, RecordedRequest];

    expectPlainShape(first, "content");
    expectPlainShape(second, "build");
    expect(second.body.tools.map((t: { name: string }) => t.name)).toEqual(expect.arrayContaining(BUILD_TOOL_NAMES));
    expect(JSON.stringify(second.body.messages)).not.toContain("sig-content");
    expect(second.body.messages[1]).toEqual({ role: "assistant", content: [{ type: "text", text: "Content reply." }] });
    const note = second.body.messages.at(-1);

    expect(note.role).toBe("user");
    expect(note.content[0].text).toContain("<app_note>");
    expect(note.content[0].text).toContain("switched this conversation to build mode");
  });

  it("renders a thread that began under full: notes as user text, tool changes and full-made thinking left out", async () => {
    const { script, h, thread } = await setup([say("Full reply.", "sig-full"), shapeRefused(), say("Plain reply.")]);

    await h.turn(thread.id, "Hi", { mode: "build" });
    expect(isFull(script.requests[0]!)).toBe(true);
    expect(script.requests[0]!.body.messages.at(-1).role).toBe("system");
    await h.turn(thread.id, "More");
    const plain = script.requests[2]!;

    expectPlainShape(plain, "build");
    expect(JSON.stringify(plain.body.messages)).not.toContain("sig-full");
    expect(plain.body.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "user"]);
    // Stored history is untouched: the system message and the thinking are still there for full.
    const stored = readFileSync(join(h.home, "state", "fake-site", "threads", `${thread.id}.json`), "utf8");

    expect(stored).toContain("tool_addition");
    expect(stored).toContain("sig-full");
  });

  it("strips all thinking once if plain is refused while replaying it, and keeps it stripped", async () => {
    const { script, h, thread } = await setup([say("One.", "sig-one"), apiError(400, "invalid_request_error", "Invalid `signature` in `thinking` block."), say("Two.", "sig-two"), say("Three.")], {
      profile: "plain",
    });

    await h.turn(thread.id, "First");
    await h.turn(thread.id, "Second");
    expect(JSON.stringify(script.requests[1]!.body.messages)).toContain("sig-one");
    expect(JSON.stringify(script.requests[2]!.body.messages)).not.toContain("sig-one");
    expect(finals(h.bus.events).at(-1)?.text).toBe("Two.");
    await h.turn(thread.id, "Third");
    const third = JSON.stringify(script.requests[3]!.body.messages);

    expect(third).not.toContain("sig-one");
    // Thinking made after the floor is replayed again.
    expect(third).toContain("sig-two");
  });

  it("ends the turn and asks for a new chat when the conversation nears the window", async () => {
    const { script, h, thread } = await setup([], { profile: "plain", contextWindow: 3_000 });

    await h.turn(thread.id, "word ".repeat(3_000));
    expect(script.requests).toHaveLength(0);
    expect(finals(h.bus.events).at(-1)?.error).toBe(CONTEXT_FULL_MESSAGE);
    expect(h.bus.events).toContainEqual(expect.objectContaining({ type: "chat.error", message: CONTEXT_FULL_MESSAGE }));
  });

  it("doesn't apply the size guard under full, which has server-side compaction", async () => {
    const { script, h, thread } = await setup([say("ok")], { profile: "full", contextWindow: 3_000 });

    await h.turn(thread.id, "word ".repeat(3_000));
    expect(script.requests).toHaveLength(1);
  });
});

describe("plain rendering", () => {
  const user = (text: string): HistoryEntry => ({ param: { role: "user", content: [{ type: "text", text }] } });
  const reply = (text: string, profile: "full" | "plain", mode: "content" | "build", sig: string): HistoryEntry => ({
    param: { role: "assistant", content: [{ type: "thinking", thinking: "", signature: sig }, { type: "text", text }] },
    meta: { profile, mode },
  });

  it("keeps thinking only in the trailing run made by plain in the current mode", () => {
    const entries = [user("a"), reply("1", "full", "content", "s1"), user("b"), reply("2", "plain", "build", "s2"), user("c"), reply("3", "plain", "content", "s3"), user("d"), reply("4", "plain", "content", "s4"), user("e")];

    expect(thinkingBoundary(entries, "content", 0)).toBe(5);
    expect(thinkingBoundary(entries, "content", 7)).toBe(7);
    const { messages, replaysThinking } = renderPlainMessages(entries, "content", 0);
    const text = JSON.stringify(messages);

    expect(replaysThinking).toBe(true);
    expect(text).not.toContain("s1");
    expect(text).not.toContain("s2");
    expect(text).toContain("s3");
    expect(text).toContain("s4");
    expect(JSON.stringify(renderPlainMessages(entries, "build", 0).messages)).not.toMatch(/"s\d"/);
  });

  it("replaces a compaction block with its summary and leaves out what it summarised", () => {
    const entries: HistoryEntry[] = [
      user("old question"),
      reply("old answer", "full", "content", "s-old"),
      user("newer"),
      {
        param: { role: "assistant", content: [{ type: "compaction", content: "They asked about opening hours.", encrypted_content: "enc" } as never, { type: "text", text: "Carrying on." }] },
        meta: { profile: "full", mode: "content" },
      },
      user("latest"),
    ];
    const { messages } = renderPlainMessages(entries, "content", 0);

    expect(messages).toEqual([
      { role: "user", content: [{ type: "text", text: "<conversation_summary>\nThey asked about opening hours.\n</conversation_summary>" }] },
      { role: "assistant", content: [{ type: "text", text: "Carrying on." }] },
      { role: "user", content: [{ type: "text", text: "latest" }] },
    ]);
  });
});

describe("publish summaries in usage", () => {
  it("count as requests, not turns", async () => {
    const now = Date.now();
    const summary = summarizeUsage(
      [
        { siteId: "s", at: now, model: "claude-haiku-5-5", requests: 1, inputTokens: 80, outputTokens: 9, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0.00001, kind: "summary" },
        { siteId: "s", at: now, model: "claude-opus-5-5", requests: 3, inputTokens: 300, outputTokens: 60, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0.002 },
      ],
      now
    );

    expect(summary.today).toMatchObject({ turns: 1, requests: 4 });
  });

  it("are recorded with kind summary by describeChanges", async () => {
    const script = scriptedFetch([
      () =>
        new Response(
          JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", content: [{ type: "text", text: "Update the About page" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 80, output_tokens: 9 } }),
          { status: 200, headers: { "content-type": "application/json" } }
        ),
    ]);
    const site = createFakeSite();
    const h = harness({ client: testClient(script.fetch), site });

    await h.runtime.describeChanges(site.id, { branch: "main", baseCommit: null, files: [{ path: "src/content/pages/about.md", status: "modified", kind: "content", binary: false, additions: 1, deletions: 1, summary: "Changed the text", title: "About" }], totals: { files: 1, additions: 1, deletions: 1 } });
    const line = JSON.parse(readFileSync(join(h.home, "usage.jsonl"), "utf8").trim());

    expect(line).toMatchObject({ kind: "summary", requests: 1, model: "claude-haiku-5-5" });
    expect((await h.settings.usage()).today).toMatchObject({ turns: 0, requests: 1 });
  });
});
