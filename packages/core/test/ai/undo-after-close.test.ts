/**
 * Undo of an assistant's reply once the site has been closed. The registry
 * closes a site nobody has used for an hour, and what a reply's checkpoint
 * kept is let go with it. Undo then has nothing to put back: it must say so,
 * and must not mark the reply as undone. A real registry, a real site in a
 * real repository; only the model's answers are scripted.
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

it("says it can't be undone any more, leaves the reply as it was, and Proof can still discard the change", async () => {
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

  // The control: with the site open, Undo puts the page back and marks the reply.
  const first = await retitle("Who we are");

  expect(readFileSync(join(root, ABOUT), "utf8")).toContain("title: Who we are");

  expect(await runtime.undoTurn(site.id, threadId, first)).toEqual({ restored: [ABOUT], left: [] });
  expect(readFileSync(join(root, ABOUT), "utf8")).toBe(before);
  expect(await undone(first)).toBe(true);

  // Another reply, and then an hour and a minute with nobody at the window: the registry closes the site.
  const second = await retitle("The people behind the work");
  const changed = readFileSync(join(root, ABOUT), "utf8");

  expect(changed).not.toBe(before);
  expect(changed).toContain("title: The people behind the work");
  expect(await registry.releaseIdle(Date.now() + 61 * 60_000)).toEqual([site.id]);

  // Undo has nothing left to put back. It says so; it does not answer as if it had been done.
  await expect(runtime.undoTurn(site.id, threadId, second)).rejects.toMatchObject({ code: "not-found", message: UNDO_LOST });
  expect(readFileSync(join(root, ABOUT), "utf8")).toBe(changed);
  expect(await undone(second)).toBe(false);
  // Asked again, it says the same, and still marks nothing.
  await expect(runtime.undoTurn(site.id, threadId, second)).rejects.toMatchObject({ code: "not-found", message: UNDO_LOST });
  expect(await undone(second)).toBe(false);

  // What the sentence promises: the change is still in Proof, and can be discarded there.
  const open = (await registry.get(site.id))!;

  expect(open).not.toBe(site);
  expect((await open.changes()).files.map((file) => file.path)).toEqual([ABOUT]);
  await open.discard([ABOUT]);
  expect(readFileSync(join(root, ABOUT), "utf8")).toBe(before);
}, 120_000);
