/**
 * The real loop, driven through the real SDK by a scripted fetch that plays
 * back authored SSE streams. Asserts both behaviour and the exact requests.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { REFUSAL_MESSAGE, STEP_LIMIT_MESSAGE, TOO_LONG_MESSAGE } from "../../src/ai/loop";
import { BUILD_TOOL_NAMES } from "../../src/ai/tools/index";
import { GalleyError } from "../../src/errors";
import type { ChatMessage, ServerEvent } from "../../src/types";
import { hashContent } from "../../src/workspace/files";
import { createFakeSite } from "./helpers/fake-site";
import { harness } from "./helpers/env";
import { TEST_KEY, apiError, scriptedFetch, stream, testClient, type MessageSpec, type RecordedRequest } from "./helpers/scripted-fetch";

/** The About page as every fake site starts with it: the version an edit says it was made from, as if an earlier reply had read it. */
const ABOUT_AS_READ = hashContent(createFakeSite().files.get("src/content/pages/about.md") as string);

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const thinking = (signature: string) => ({ type: "thinking" as const, thinking: "", signature });
const text = (value: string): MessageSpec => ({ content: [thinking(`sig-${value.length}`), { type: "text", text: value }], stop_reason: "end_turn" });
const toolStep = (calls: Array<{ id: string; name: string; input: unknown }>, sig = "sig-tool"): MessageSpec => ({
  content: [thinking(sig), ...calls.map((call) => ({ type: "tool_use" as const, ...call, chunks: 4 }))],
  stop_reason: "tool_use",
});

function lastAssistant(events: ServerEvent[]): ChatMessage {
  const messages = events.filter((e): e is Extract<ServerEvent, { type: "chat.message" }> => e.type === "chat.message").map((e) => e.message);
  const last = messages.filter((m) => m.role === "assistant" && !m.pending).pop();

  if (!last) throw new Error("no final assistant message");
  return last;
}

/** Every request's messages must start with the previous request's messages, unchanged. */
function expectAppendOnly(requests: RecordedRequest[]): void {
  for (let i = 1; i < requests.length; i += 1) {
    const before = requests[i - 1]!.body.messages;
    const after = requests[i]!.body.messages;

    expect(after.length).toBeGreaterThanOrEqual(before.length);
    expect(after.slice(0, before.length)).toEqual(before);
  }
}

async function setup(steps: Parameters<typeof scriptedFetch>[0], options: { withKey?: boolean; maxSteps?: number } = {}) {
  const script = scriptedFetch(steps);
  const site = createFakeSite();
  const h = harness({ client: testClient(script.fetch), site, ...options });
  const thread = await h.runtime.createThread(site.id);

  return { script, site, h, thread };
}

describe("a turn", () => {
  it("streams, runs tools, edits one line and sends exactly the request the skill prescribes", async () => {
    const { script, site, h, thread } = await setup([
      stream(toolStep([{ id: "toolu_1", name: "read_entry", input: { path: "src/content/pages/index.md" } }], "sig-a")),
      stream(toolStep([{ id: "toolu_2", name: "update_entry", input: { path: "src/content/pages/index.md", ops: [{ op: "set", path: "sections.0.heading", value: "Fresh bread from the harbour" }] } }], "sig-b")),
      stream(text("The heading now reads “Fresh bread from the harbour”. It's waiting in Proof.")),
    ]);
    const before = site.files.get("src/content/pages/index.md") as string;

    await h.turn(thread.id, "Make the hero heading say Fresh bread from the harbour", { context: { urlPath: "/" } });

    // The file: exactly one line differs.
    const after = site.files.get("src/content/pages/index.md") as string;
    const changed = after.split("\n").filter((line, i) => line !== before.split("\n")[i]);

    expect(changed).toEqual(["    heading: Fresh bread from the harbour"]);

    // The requests.
    expect(script.requests).toHaveLength(3);
    const [first, second] = script.requests as [RecordedRequest, RecordedRequest];
    const body = first.body;

    expect(first.url).toContain("/v1/messages");
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(8_000);
    expect(body.thinking).toEqual({ type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } });
    expect(body.output_config).toEqual({ effort: "medium" });
    expect(body.fallbacks).toBe("default");
    expect(body.cache_control).toEqual({ type: "ephemeral" });
    expect(body.context_management).toEqual({ edits: [{ type: "compact_20260112" }] });
    for (const forbidden of ["temperature", "top_p", "top_k", "tool_choice", "betas"]) expect(body).not.toHaveProperty(forbidden);
    expect(JSON.stringify(body)).not.toContain("budget_tokens");
    expect(JSON.stringify(body)).not.toContain('"disabled"');
    const betas = first.headers["anthropic-beta"]!.split(",").map((b) => b.trim());

    expect(betas).toEqual(
      expect.arrayContaining(["thinking-binding-controls-2026-08-01", "mid-conversation-tool-changes-2026-07-01", "compact-2026-01-12", "server-side-fallback-2026-07-01"])
    );
    // Stable, cached system prefix: product prompt, then the site card.
    expect(body.system).toHaveLength(2);
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(body.system[1].cache_control).toEqual({ type: "ephemeral" });
    expect(body.system[1].text).toContain("# The site: Harbour Bakery");
    expect(body.system[1].text).toContain('<instructions file="CONTENT-GUIDE.md">');
    // Tools: one fixed, name-sorted list; build tools deferred; eager input streaming everywhere.
    const names = body.tools.map((t: { name: string }) => t.name);

    expect(names).toEqual([...names].sort());
    for (const tool of body.tools) {
      expect(tool.eager_input_streaming).toBe(true);
      expect(Boolean(tool.defer_loading)).toBe(BUILD_TOOL_NAMES.includes(tool.name));
    }
    // Volatile context in the user turn, not the system prompt.
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].content[0].text).toContain("Mode: content");
    expect(body.messages[0].content[0].text).toContain("Viewing the page / — the pages entry “Harbour Bakery”");
    expect(body.messages[0].content.at(-1).text).toBe("Make the hero heading say Fresh bread from the harbour");
    expect(body.system[0].text).not.toContain("Viewing the page");

    // Step 2 replays step 1 verbatim, thinking signature included, then one user message of results.
    expect(second.body.messages[1]).toEqual({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "", signature: "sig-a" },
        { type: "tool_use", id: "toolu_1", name: "read_entry", input: { path: "src/content/pages/index.md" } },
      ],
    });
    expect(second.body.messages[2].role).toBe("user");
    expect(second.body.messages[2].content).toHaveLength(1);
    expect(second.body.messages[2].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_1" });
    expectAppendOnly(script.requests);
    expect(JSON.stringify(second.body.tools)).toBe(JSON.stringify(body.tools));

    // Events: deltas, plain-language tool lines, the final message.
    const deltas = h.bus.events.filter((e) => e.type === "chat.delta").map((e) => (e as { text: string }).text).join("");

    expect(deltas).toContain("Fresh bread from the harbour");
    const tools = h.bus.events.filter((e): e is Extract<ServerEvent, { type: "chat.tool" }> => e.type === "chat.tool").map((e) => e.tool);

    expect(tools.map((t) => `${t.status}:${t.label}`)).toEqual([
      "running:Reading the home page",
      "done:Read the home page",
      "running:Updating the home page",
      "done:Edited the home page",
    ]);
    for (const tool of tools) {
      expect(tool.label).not.toMatch(/src\/|\.md|_entry|update_|read_/);
    }
    const reply = lastAssistant(h.bus.events);

    expect(reply.text).toBe("The heading now reads “Fresh bread from the harbour”. It's waiting in Proof.");
    expect(reply.changedPaths).toEqual(["src/content/pages/index.md"]);
    expect(reply.usage).toMatchObject({ model: "claude-opus-5-5", requests: 3, inputTokens: 300, outputTokens: 60 });
    expect(reply.usage?.cost).toBeCloseTo((300 * 4 + 60 * 20) / 1e6, 10);
    expect(h.bus.events.at(-1)).toMatchObject({ type: "chat.done" });
    const usage = readFileSync(join(h.home, "usage.jsonl"), "utf8").trim().split("\n");

    expect(usage).toHaveLength(1);
    expect(JSON.parse(usage[0]!)).toMatchObject({ siteId: site.id, requests: 3, model: "claude-opus-5-5" });
    const thread2 = await h.runtime.getThread(site.id, thread.id);

    expect(thread2?.title).toBe("Make the hero heading say Fresh bread from the harbour");
    expect(thread2?.busy).toBe(false);
  });

  it("replays the first turn's exact blocks at the start of the second turn", async () => {
    const { script, h, thread } = await setup([
      stream(toolStep([{ id: "toolu_1", name: "read_entry", input: { path: "src/content/pages/about.md" } }], "sig-1")),
      stream(text("The About page says you bake before dawn.")),
      stream(text("Yes, twice on Sundays.")),
    ]);

    await h.turn(thread.id, "What does the About page say?");
    await h.turn(thread.id, "And on Sundays?");
    const firstTurnEnd = script.requests[1]!.body.messages;
    const secondTurn = script.requests[2]!.body.messages;
    // turn 1 = request 2's messages + the final assistant reply
    const expectedPrefix = [...firstTurnEnd, { role: "assistant", content: [{ type: "thinking", thinking: "", signature: `sig-${"The About page says you bake before dawn.".length}` }, { type: "text", text: "The About page says you bake before dawn." }] }];

    expect(secondTurn.slice(0, expectedPrefix.length)).toEqual(expectedPrefix);
    expect(secondTurn).toHaveLength(expectedPrefix.length + 1);
    expect(secondTurn.at(-1).content.at(-1).text).toBe("And on Sundays?");
    expectAppendOnly(script.requests);
  });

  it("returns every result of a parallel step in one user message", async () => {
    const { script, h, thread } = await setup([
      stream(
        toolStep([
          { id: "toolu_a", name: "read_entry", input: { path: "src/content/pages/index.md" } },
          { id: "toolu_b", name: "read_entry", input: { path: "src/content/pages/about.md" } },
        ])
      ),
      stream(text("Both pages read.")),
    ]);

    await h.turn(thread.id, "Read both pages");
    const results = script.requests[1]!.body.messages.at(-1);

    expect(results.role).toBe("user");
    expect(results.content.map((block: { tool_use_id: string }) => block.tool_use_id)).toEqual(["toolu_a", "toolu_b"]);
    expect(script.requests[1]!.body.messages.filter((m: { role: string }) => m.role === "user")).toHaveLength(2);
  });

  it("refuses an input that fails validation without running the tool", async () => {
    const { script, site, h, thread } = await setup([
      stream({ content: [thinking("s"), { type: "tool_use", id: "toolu_x", name: "update_entry", input: { path: "src/content/pages/about.md" }, chunks: 2 }], stop_reason: "tool_use" }),
      stream(text("Sorry, let me read it first.")),
    ]);
    const before = site.files.get("src/content/pages/about.md");

    await h.turn(thread.id, "Change the about page");
    const result = script.requests[1]!.body.messages.at(-1).content[0];

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("INVALID_JSON");
    expect(site.files.get("src/content/pages/about.md")).toBe(before);
  });

  it("re-issues the request when a streamed tool input can't be parsed at all", async () => {
    const { script, site, h, thread } = await setup([
      stream({ content: [thinking("s"), { type: "tool_use", id: "toolu_bad", name: "delete_entry", input: null, rawJson: '{"path": }' }], stop_reason: "tool_use" }),
      stream(text("Let me try that again.")),
    ]);

    await h.turn(thread.id, "Delete the about page");
    expect(script.requests).toHaveLength(2);
    expect(script.requests[1]!.body.messages).toEqual(script.requests[0]!.body.messages);
    expect(site.files.has("src/content/pages/about.md")).toBe(true);
    expect(h.logs.some((line) => line.includes("re-issuing"))).toBe(true);
  });

  it("stops on max_tokens without running a truncated tool call, and keeps the history valid", async () => {
    const { script, site, h, thread } = await setup([
      stream({ content: [thinking("s"), { type: "tool_use", id: "toolu_cut", name: "update_entry", input: { path: "src/content/pages/about.md", ops: [{ op: "body", value: "x" }] } }], stop_reason: "max_tokens" }),
      stream(text("Smaller, then.")),
    ]);
    const before = site.files.get("src/content/pages/about.md");

    await h.turn(thread.id, "Rewrite every page");
    expect(site.files.get("src/content/pages/about.md")).toBe(before);
    expect(h.bus.events).toContainEqual(expect.objectContaining({ type: "chat.error", message: TOO_LONG_MESSAGE }));
    expect(lastAssistant(h.bus.events).error).toBe(TOO_LONG_MESSAGE);

    await h.turn(thread.id, "Just the About page");
    // The failed turn left nothing behind: the next request opens with a user message.
    expect(script.requests[1]!.body.messages).toHaveLength(1);
    expect(script.requests[1]!.body.messages[0].content.at(-1).text).toBe("Just the About page");
  });

  it("discards a refused response and says so plainly", async () => {
    const { site, h, thread } = await setup([
      stream({
        content: [{ type: "text", text: "Here is how to" }, { type: "tool_use", id: "toolu_r", name: "delete_entry", input: { path: "src/content/pages/about.md" } }],
        stop_reason: "refusal",
        stop_details: { type: "refusal", category: "cyber", explanation: null },
      }),
    ]);

    await h.turn(thread.id, "Something the classifier declines");
    expect(site.files.has("src/content/pages/about.md")).toBe(true);
    const reply = lastAssistant(h.bus.events);

    expect(reply.text).toBe(REFUSAL_MESSAGE);
    expect(reply.changedPaths).toEqual([]);
  });

  it("keeps the echo-safe part of a response that fell back mid-output", async () => {
    const { script, h, thread } = await setup([
      stream({
        model: "claude-opus-5",
        content: [
          thinking("sig-declined"),
          { type: "text", text: "Partial " },
          { type: "fallback", from: "claude-opus-5-5", to: "claude-opus-5" },
          { type: "text", text: "answer from the fallback model." },
        ],
        stop_reason: "end_turn",
        iterations: [
          { type: "message", model: "claude-opus-5-5", input_tokens: 100, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
          { type: "fallback_message", model: "claude-opus-5", input_tokens: 100, output_tokens: 15, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
        ],
      }),
      stream(text("Next.")),
    ]);

    await h.turn(thread.id, "Hello");
    await h.turn(thread.id, "Again");
    const replayed = script.requests[1]!.body.messages[1].content.map((b: { type: string }) => b.type);

    expect(replayed).toEqual(["text", "fallback", "text"]);
    const usage = lastAssistant(h.bus.events.slice(0, h.bus.events.findIndex((e) => e.type === "chat.done") + 1)).usage!;

    expect(usage.outputTokens).toBe(20);
    expect(usage.cost).toBeCloseTo((100 * 4 + 5 * 20 + 100 * 5 + 15 * 25) / 1e6, 10);
  });

  it("counts as work in progress on its site from the moment the message is accepted until it is done", async () => {
    const { site, h, thread } = await setup([stream(text("Done."))]);
    const done = new Promise<void>((resolve) => h.bus.subscribe((event) => event.type === "chat.done" && resolve()));

    expect(h.runtime.working(site.id)).toBe(false);
    await h.runtime.send(site.id, thread.id, { text: "Hello" });
    expect(h.runtime.working(site.id)).toBe(true);
    expect(h.runtime.working("another-site")).toBe(false);
    // A site whose name begins the same is another site.
    expect(h.runtime.working(site.id.slice(0, -1))).toBe(false);
    await done;
    await vi.waitFor(() => expect(h.runtime.working(site.id)).toBe(false));
  });

  it("maps an overloaded response to one plain sentence", async () => {
    const { h, thread } = await setup([apiError(529, "overloaded_error", "Overloaded")]);

    await h.turn(thread.id, "Hello");
    expect(h.bus.events).toContainEqual(expect.objectContaining({ type: "chat.error", message: "The assistant is overloaded right now. Try again in a minute." }));
  });

  it("maps an error that arrives inside an open stream by its type", async () => {
    const { h, thread } = await setup([
      stream({ content: [{ type: "text", text: "Starting" }, { type: "text", text: "never" }], stop_reason: "end_turn", errorAfterBlocks: { blocks: 1, error: { type: "overloaded_error", message: "Overloaded" } } }),
    ]);

    await h.turn(thread.id, "Hello");
    expect(h.bus.events).toContainEqual(expect.objectContaining({ type: "chat.error", message: "The assistant is overloaded right now. Try again in a minute." }));
  });

  it("re-issues a request whose stream dropped mid-way", async () => {
    const { script, h, thread } = await setup([
      stream(text("This connection drops."), { breakAfter: 3 }),
      stream(text("Second time lucky.")),
    ]);

    await h.turn(thread.id, "Hello");
    expect(script.requests).toHaveLength(2);
    expect(script.requests[1]!.body).toEqual(script.requests[0]!.body);
    expect(lastAssistant(h.bus.events).text).toBe("Second time lucky.");
  });

  it("cancels mid-stream, refuses a second message while busy, and reports nothing changed", async () => {
    let hung!: () => void;
    const hanging = new Promise<void>((resolve) => (hung = resolve));
    const { site, h, thread } = await setup([stream(text("This will never finish streaming."), { hangAfter: 3, onHang: () => hung() })]);
    const { turnId } = await h.runtime.send(site.id, thread.id, { text: "Hello" });

    await hanging;
    await expect(h.runtime.send(site.id, thread.id, { text: "Me again" })).rejects.toMatchObject({ code: "busy" });
    expect((await h.runtime.getThread(site.id, thread.id))?.busy).toBe(true);
    await h.runtime.cancel(site.id, thread.id);
    expect(h.bus.events).toContainEqual({ type: "chat.done", siteId: site.id, threadId: thread.id, turnId });
    expect(lastAssistant(h.bus.events).text).toBe("Stopped. Nothing was changed.");
    expect(h.bus.events.some((e) => e.type === "chat.error")).toBe(false);
    expect((await h.runtime.getThread(site.id, thread.id))?.busy).toBe(false);
  });

  it("stops at the step ceiling", async () => {
    const step = () => stream(toolStep([{ id: `toolu_${Math.random().toString(36).slice(2)}`, name: "list_collections", input: {} }]));
    const { script, h, thread } = await setup([step(), step(), step()], { maxSteps: 2 });

    await h.turn(thread.id, "Loop forever");
    expect(script.requests).toHaveLength(2);
    expect(lastAssistant(h.bus.events).error).toBe(STEP_LIMIT_MESSAGE);
  });

  it("rejects a send with no key, in plain words", async () => {
    const { site, h, thread } = await setup([], { withKey: false });

    await expect(h.runtime.send(site.id, thread.id, { text: "Hello" })).rejects.toBeInstanceOf(GalleyError);
    await expect(h.runtime.send(site.id, thread.id, { text: "Hello" })).rejects.toMatchObject({ code: "unconfigured", message: expect.stringContaining("Settings") });
    expect((await h.runtime.getThread(site.id, thread.id))?.busy).toBe(false);
  });
});

describe("questions", () => {
  it("ends the turn on ask_user, shows options, and refuses a second question in a row", async () => {
    const { script, h, thread } = await setup([
      stream({
        content: [
          thinking("q"),
          { type: "text", text: "Let me check." },
          { type: "tool_use", id: "toolu_q", name: "ask_user", input: { question: "Which page do you mean?", options: [{ label: "Home" }, { label: "About" }] } },
        ],
        stop_reason: "tool_use",
      }),
      stream(toolStep([{ id: "toolu_q2", name: "ask_user", input: { question: "Are you sure?", options: [{ label: "Yes" }, { label: "No" }] } }])),
      stream(text("I changed the About page.")),
    ]);

    await h.turn(thread.id, "Change the page");
    expect(script.requests).toHaveLength(1);
    const asked = lastAssistant(h.bus.events);

    expect(asked.text).toBe("Which page do you mean?");
    expect(asked.options).toEqual([{ label: "Home" }, { label: "About" }]);

    await h.turn(thread.id, "About");
    // The answer joins the pending tool result as the next user message.
    const answer = script.requests[1]!.body.messages;

    expect(answer.at(-2).content[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_q" });
    expect(answer.at(-1).content.at(-1).text).toBe("About");
    const second = script.requests[2]!.body.messages.at(-1).content[0];

    expect(second.is_error).toBe(true);
    expect(second.content).toContain("already a question");
  });
});

describe("modes", () => {
  it("surfaces build tools with tool_addition, never by changing the tools array, and withdraws them again", async () => {
    const { script, site, h, thread } = await setup([
      stream(text("Content turn.")),
      stream(toolStep([{ id: "toolu_e", name: "edit_file", input: { path: "src/styles/tokens.css", old_string: "#1f6feb", new_string: "#0b3d91" } }])),
      stream(text("I changed the accent colour.")),
      stream(text("Back to content.")),
    ]);

    await h.turn(thread.id, "Hi");
    await h.turn(thread.id, "Make the accent navy", { mode: "build" });
    await h.turn(thread.id, "Thanks", { mode: "content" });
    expect(site.files.get("src/styles/tokens.css")).toContain("#0b3d91");
    expect(site.writes.find((w) => w.path === "src/styles/tokens.css")).toMatchObject({ mode: "build", origin: "agent" });

    const tools = script.requests.map((r) => JSON.stringify(r.body.tools));

    expect(new Set(tools).size).toBe(1);
    const buildTurn = script.requests[1]!.body.messages;
    const note = buildTurn.at(-1);

    expect(note.role).toBe("system");
    expect(note.content[0]).toEqual({ type: "text", text: expect.stringContaining("switched this conversation to build mode") });
    expect(note.content.filter((b: { type: string }) => b.type === "tool_addition").map((b: { tool: { name: string } }) => b.tool.name)).toEqual(BUILD_TOOL_NAMES);
    expect(buildTurn.at(-2).content[0].text).toContain("Mode: build");
    const backToContent = script.requests[3]!.body.messages.at(-1);

    expect(backToContent.content.filter((b: { type: string }) => b.type === "tool_removal")).toHaveLength(BUILD_TOOL_NAMES.length);
    expectAppendOnly(script.requests);
  });

  it("refuses a build tool in content mode even if the model calls it", async () => {
    const { script, site, h, thread } = await setup([
      stream(toolStep([{ id: "toolu_w", name: "write_file", input: { path: "src/components/Header.astro", content: "<header>hacked</header>\n" } }])),
      stream(text("I can't change the site's code in content mode.")),
    ]);
    const before = site.files.get("src/components/Header.astro");

    await h.turn(thread.id, "Change the header component");
    expect(site.files.get("src/components/Header.astro")).toBe(before);
    expect(script.requests[1]!.body.messages.at(-1).content[0]).toMatchObject({ is_error: true, content: expect.stringContaining("content mode") });
  });
});

describe("undo", () => {
  it("restores a turn's files, marks the reply undone, and tells the model with a system note", async () => {
    const { script, site, h, thread } = await setup([
      stream(toolStep([{ id: "toolu_u", name: "update_entry", input: { path: "src/content/pages/about.md", baseHash: ABOUT_AS_READ, ops: [{ op: "body-replace", find: "before dawn.", replace: "at midnight.", all: true }] } }])),
      stream(text("Done in Proof.")),
      stream(text("Understood.")),
    ]);
    const before = site.files.get("src/content/pages/about.md");
    const { turnId } = await h.turn(thread.id, "Say we bake at midnight");

    expect(site.files.get("src/content/pages/about.md")).not.toBe(before);
    const undone = await h.runtime.undoTurn(site.id, thread.id, turnId);

    expect(undone).toEqual({ restored: ["src/content/pages/about.md"], left: [] });
    expect(site.files.get("src/content/pages/about.md")).toBe(before);
    expect(h.bus.events.filter((e) => e.type === "chat.message").at(-1)).toMatchObject({ message: { undone: true, turnId } });
    expect(await h.runtime.undoTurn(site.id, thread.id, turnId)).toEqual({ restored: [], left: [] });

    await h.turn(thread.id, "What does the page say now?");
    const messages = script.requests[2]!.body.messages;

    expect(messages.at(-1)).toMatchObject({ role: "system" });
    expect(messages.at(-1).content[0].text).toContain("undid your turn");
    expect(messages.at(-1).content[0].text).toContain("src/content/pages/about.md");
    expectAppendOnly(script.requests);
    await expect(h.runtime.undoTurn(site.id, thread.id, "no-such-turn")).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("models and attachments", () => {
  it("switches model mid-thread without rewriting history, and leaves fallbacks off for Haiku", async () => {
    const { script, h, thread } = await setup([stream(text("One.")), stream(text("Two."))]);

    await h.turn(thread.id, "First");
    await h.settings.update({ ai: { model: "claude-haiku-5-5", effort: "low" } });
    await h.turn(thread.id, "Second");
    const second = script.requests[1]!.body;

    expect(second.model).toBe("claude-haiku-5-5");
    expect(second.output_config).toEqual({ effort: "low" });
    expect(second).not.toHaveProperty("fallbacks");
    expect(script.requests[1]!.headers["anthropic-beta"]).not.toContain("server-side-fallback");
    expect(second.messages[1].content[0]).toEqual({ type: "thinking", thinking: "", signature: "sig-4" });
    expectAppendOnly(script.requests);
  });

  it("saves an attached image to media, stores a reference, and rebuilds the identical block later", async () => {
    const { script, site, h, thread } = await setup([stream(text("A tiny image.")), stream(text("Still the same image."))]);

    await h.turn(thread.id, "What is this?", { attachments: [{ name: "Shop Front.png", mime: "image/png", dataUrl: `data:image/png;base64,${PNG_1X1}` }] });
    await h.turn(thread.id, "And now?");
    expect(site.files.has("public/images/Shop Front.png")).toBe(true);
    const first = script.requests[0]!.body.messages[0].content;

    expect(first[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: PNG_1X1 } });
    expect(first[0].text).toContain("Attached image “Shop Front.png”, saved to the site's media as /images/Shop Front.png");
    expect(script.requests[1]!.body.messages[0]).toEqual(script.requests[0]!.body.messages[0]);
    const stored = readFileSync(join(h.home, "state", site.id, "threads", `${thread.id}.json`), "utf8");

    expect(stored).not.toContain(PNG_1X1);
    const userMessage = lastAssistant(h.bus.events);

    expect(userMessage).toBeTruthy();
  });
});

describe("secrets never leak", () => {
  it("keeps the key out of logs, events, errors and stored files", async () => {
    const leak = () => ({ type: "error", error: { type: "authentication_error", message: `invalid x-api-key ${TEST_KEY}` } });
    const { h, thread, site } = await setup([(_r) => new Response(JSON.stringify(leak()), { status: 401, headers: { "content-type": "application/json" } })]);

    await h.turn(thread.id, "Hello");
    const error = h.bus.events.find((e) => e.type === "chat.error") as { message: string } | undefined;

    expect(error?.message).toBe("The assistant can't connect: the API key in Settings was rejected. Add a fresh key in Settings.");
    const haystack = [
      JSON.stringify(h.bus.events),
      h.logs.join("\n"),
      JSON.stringify(await h.settings.get()),
      readFileSync(join(h.home, "state", site.id, "threads", `${thread.id}.json`), "utf8"),
    ].join("\n");

    expect(h.logs.join("\n")).toContain("AuthenticationError");
    expect(haystack).not.toContain(TEST_KEY);
    expect(haystack).not.toContain(TEST_KEY.slice(0, 20));
  });
});
