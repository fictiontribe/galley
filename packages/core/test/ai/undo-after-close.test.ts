/**
 * Undo of an assistant's reply an hour later, and once its site has been
 * closed. A site whose Undo is still offered is not closed for lack of use:
 * an hour later is exactly when someone wants it. Once nothing is offered any
 * more, the registry closes it as before. A site closed anyway (removed, a
 * backup put back) lets go of what Undo kept: Undo then has
 * nothing to put back, says so, and doesn't mark the reply as undone. A real
 * registry, a real site in a real repository; only the model's answers are
 * scripted.
 */
import { execFileSync } from "node:child_process";
import { cpSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, expect, it } from "vitest";
import { createAgentRuntime, createImageService, createSettingsService } from "../../src/ai/index";
import { createSiteRegistry } from "../../src/site/index";
import type { ServerEvent } from "../../src/types";
import { UNDO_LOST } from "../../src/workspace";
import { cleanEnv, recordingBus, tempDir } from "./helpers/env";
import { TEST_KEY, scriptedFetch, stream, testClient, type MessageSpec } from "./helpers/scripted-fetch";

const STARTER = join(dirname(fileURLToPath(import.meta.url)), "../../../../starters/astro-starter");
const IDENTITY = ["-c", "user.name=Test Person", "-c", "user.email=test@example.com"];
const git = (cwd: string, ...args: string[]) => execFileSync("git", [...IDENTITY, ...args], { cwd, encoding: "utf8" }).trim();
const tools = (calls: Array<[string, string, unknown]>): MessageSpec => ({ content: [{ type: "thinking", thinking: "", signature: "sig-many" }, ...calls.map(([id, name, input]) => ({ type: "tool_use" as const, id, name, input }))], stop_reason: "tool_use" });
const say = (text: string): MessageSpec => ({ content: [{ type: "thinking", thinking: "", signature: "sig-text" }, { type: "text", text }], stop_reason: "end_turn" });
const ABOUT = "src/content/pages/about.md";
const closing: Array<() => Promise<void>> = [];

afterAll(async () => {
  for (const close of closing) await close();
});

/** A real registry and site, an assistant whose answers are scripted, and one thread. */
async function setup() {
  const root = tempDir("undo-closed-site-");

  cpSync(STARTER, root, { recursive: true, filter: (source) => !["node_modules", "dist", ".astro"].includes(relative(STARTER, source).split("/")[0] ?? "") });
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "Starter");
  const home = tempDir("undo-closed-home-");
  const settings = createSettingsService({ home, env: cleanEnv({ ANTHROPIC_API_KEY: TEST_KEY }) });
  const bus = recordingBus();
  const registry = await createSiteRegistry({ home, sitesDir: tempDir("undo-closed-sites-"), startersDir: tempDir("undo-closed-starters-"), events: bus, overlayScript: () => "", settings, install: async () => undefined });

  closing.push(() => registry.dispose());
  const site = await registry.open({ path: root });
  const script = scriptedFetch([]);
  const runtime = createAgentRuntime({ home, registry, settings, images: createImageService({ home, settings }), events: bus, client: testClient(script.fetch), maxTokens: 8_000, env: {}, logger: () => undefined });
  const threadId = (await runtime.createThread(site.id)).id;
  const before = readFileSync(join(root, ABOUT), "utf8");
  /** One reply that retitles the about page. */
  const retitle = async (title: string): Promise<string> => {
    script.push(...[tools([["r1", "read_entry", { path: ABOUT }]]), tools([["r2", "update_entry", { path: ABOUT, ops: [{ op: "set", path: ["title"], value: title }] }]]), say("Retitled. It is in Proof.")].map((spec) => stream(spec)));
    const { turnId } = await runtime.send(site.id, threadId, { text: `Call the about page “${title}”` });

    await bus.waitFor((event: ServerEvent) => event.type === "chat.done" && event.turnId === turnId, 20_000);
    return turnId;
  };
  const undone = async (turnId: string) => (await runtime.getThread(site.id, threadId))!.messages.find((message) => message.turnId === turnId && message.role === "assistant")?.undone ?? false;

  /** One reply that changes nothing. */
  const answer = async (text: string): Promise<string> => {
    script.push(stream(say(text)));
    const { turnId } = await runtime.send(site.id, threadId, { text: "Is the about page fine?" });

    await bus.waitFor((event: ServerEvent) => event.type === "chat.done" && event.turnId === turnId, 20_000);
    return turnId;
  };

  return { root, registry, site, runtime, threadId, before, retitle, answer, undone };
}

it("keeps a site whose Undo is offered open past the hour; once the site is closed anyway, says it can't be undone, leaves the reply as it was, and Proof can still discard the change", async () => {
  const { root, registry, site, runtime, threadId, before, retitle, undone } = await setup();

  // The control: with the site open, Undo puts the page back and marks the reply.
  const first = await retitle("Who we are");

  expect(readFileSync(join(root, ABOUT), "utf8")).toContain("title: Who we are");

  expect(await runtime.undoTurn(site.id, threadId, first)).toEqual({ restored: [ABOUT], left: [] });
  expect(readFileSync(join(root, ABOUT), "utf8")).toBe(before);
  expect(await undone(first)).toBe(true);

  // Another reply, and then an hour and a minute with nobody at the window: its Undo is offered, so the site stays open.
  const second = await retitle("The people behind the work");

  expect(await registry.releaseIdle(Date.now() + 61 * 60_000)).toEqual([]);
  expect(await registry.get(site.id)).toBe(site);
  // An hour later Undo still puts the page back, and marks the reply.
  expect(await runtime.undoTurn(site.id, threadId, second)).toEqual({ restored: [ABOUT], left: [] });
  expect(readFileSync(join(root, ABOUT), "utf8")).toBe(before);
  expect(await undone(second)).toBe(true);
  // With nothing offered any more, an hour without use closes the site as before.
  expect(await registry.releaseIdle(Date.now() + 61 * 60_000)).toEqual([site.id]);

  // A reply on the site as it is opened again, and then the site is closed anyway (removed from the list).
  const third = await retitle("Our studio");
  const changed = readFileSync(join(root, ABOUT), "utf8");

  expect(changed).toContain("title: Our studio");
  await registry.remove(site.id);

  // Undo has nothing left to put back. It says so; it does not answer as if it had been done.
  await expect(runtime.undoTurn(site.id, threadId, third)).rejects.toMatchObject({ code: "not-found", message: UNDO_LOST });
  expect(readFileSync(join(root, ABOUT), "utf8")).toBe(changed);
  expect(await undone(third)).toBe(false);
  // Asked again, it says the same, and still marks nothing.
  await expect(runtime.undoTurn(site.id, threadId, third)).rejects.toMatchObject({ code: "not-found", message: UNDO_LOST });
  expect(await undone(third)).toBe(false);

  // What the sentence promises: the change is still in Proof, and can be discarded there.
  const open = await registry.open({ path: root });

  expect(open).not.toBe(site);
  expect((await open.changes()).files.map((file) => file.path)).toEqual([ABOUT]);
  await open.discard([ABOUT]);
  expect(readFileSync(join(root, ABOUT), "utf8")).toBe(before);
}, 120_000);

it("a reply that changed nothing offers no Undo, and doesn't keep its site open", async () => {
  const { registry, site, answer } = await setup();

  await answer("It reads well. I didn't change anything.");
  expect(await registry.releaseIdle(Date.now() + 61 * 60_000)).toEqual([site.id]);
}, 120_000);

it("two undos of one reply at once: one puts it back, the other is told so, and the next reply's Undo still works and is then let go", async () => {
  const { root, registry, site, runtime, threadId, before, retitle } = await setup();
  const first = await retitle("Who we are");
  const second = await retitle("The people behind the work");
  const outcomes = await Promise.allSettled([runtime.undoTurn(site.id, threadId, second), runtime.undoTurn(site.id, threadId, second)]);

  expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.find((outcome) => outcome.status === "rejected")).toMatchObject({ reason: { code: "busy" } });
  expect(await runtime.undoTurn(site.id, threadId, first)).toEqual({ restored: [ABOUT], left: [] });
  expect(readFileSync(join(root, ABOUT), "utf8")).toBe(before);
  // Nothing is offered any more: the site closes after an hour without use.
  expect(await registry.releaseIdle(Date.now() + 61 * 60_000)).toEqual([site.id]);
}, 120_000);

it("deleting the conversation lets its site close", async () => {
  const { registry, site, runtime, threadId, retitle } = await setup();

  await retitle("Who we are");
  expect(await registry.releaseIdle(Date.now() + 61 * 60_000)).toEqual([]);
  await runtime.deleteThread(site.id, threadId);
  expect(await registry.releaseIdle(Date.now() + 61 * 60_000)).toEqual([site.id]);
}, 120_000);

it("a reply pushed out by twenty newer ones no longer keeps its site open", async () => {
  const { registry, site, runtime, threadId, retitle } = await setup();

  for (let i = 0; i < 21; i += 1) await retitle(`Title ${i}`);
  // Twenty are still offered: the site stays open. Undo them all, and the one pushed out keeps nothing.
  expect(await registry.releaseIdle(Date.now() + 61 * 60_000)).toEqual([]);
  const thread = (await runtime.getThread(site.id, threadId))!;
  const turns = [...new Set(thread.messages.filter((message) => message.role === "assistant" && message.turnId).map((message) => message.turnId!))];

  for (const turnId of turns.slice(-20).reverse()) await runtime.undoTurn(site.id, threadId, turnId);
  expect(await registry.releaseIdle(Date.now() + 61 * 60_000)).toEqual([site.id]);
}, 300_000);
