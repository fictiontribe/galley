/**
 * A save against everything that rewrites files without asking it: a
 * Discard, newer versions coming in, and a publish being undone. Each is
 * stopped in the middle, at the one moment that matters: it holds the
 * workspace, and has not yet rewritten the files the saves are about. The
 * saves read those files then, and can only write once it has finished.
 *
 * What must hold whoever saves, a person or the assistant: text worked out
 * from a version of the file that is no longer there never reaches the disk.
 * A save that said what it had opened is told to reopen; one that didn't is
 * worked out again from what is there now.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runningActivity, runTool } from "../../src/ai/tools/index";
import type { ToolContext } from "../../src/ai/tools/types";
import type { AgentMode } from "../../src/types";
import { hashContent } from "../../src/workspace/index";
import type { OpenSite } from "../../src/site/service";
import { addBareRemote, cleanupAll, disposeAll, HOME, makeSite, openSite, POST, PRICING, sh, tempDir, until } from "./helpers";

const GIT_HEAVY = { timeout: 180_000 };
/** Sorts before every other file these tests change, so git writes it first. */
const GATE = "aaa-gate.txt";
const STYLE = "src/styles/tokens.css";
const FILES = [GATE, HOME, PRICING, POST, STYLE];

afterEach(async () => {
  await disposeAll();
  cleanupAll();
});

const read = (root: string, path: string) => readFileSync(join(root, ...path.split("/")), "utf8");
const hashOf = (root: string, path: string) => hashContent(readFileSync(join(root, ...path.split("/"))));
/** The same file with its title changed (or, for the stylesheet, a line added): another version of it. */
const versionOf = (text: string, path: string, mark: string) => (path.endsWith(".md") ? text.replace(/^title: .*$/m, `title: ${mark}`) : `${text}\n/* ${mark} */\n`);

/**
 * A site whose repository makes git wait, when armed, whenever git itself
 * writes GATE into the site's files (a filter the repository names for that
 * one file; saves made by the app don't pass through it). Whatever git
 * command is rewriting files stops there, before the files after it.
 */
function gatedSite() {
  const root = makeSite();
  const gate = tempDir("site-gate-");
  const program = join(gate, "wait.sh");

  writeFileSync(join(root, GATE), "one\n");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "A file git writes first");
  writeFileSync(join(gate, "go"), "");
  writeFileSync(program, `#!/bin/sh\n: > '${gate}/reached'\nwhile [ ! -e '${gate}/go' ]; do sleep 0.05; done\ncat\n`, { mode: 0o755 });
  sh(root, "config", "filter.gate.smudge", program);
  sh(root, "config", "filter.gate.clean", "cat");
  appendFileSync(join(root, ".git", "info", "attributes"), `${GATE} filter=gate\n`);
  return {
    root,
    arm() {
      rmSync(join(gate, "reached"), { force: true });
      rmSync(join(gate, "go"), { force: true });
    },
    reached: () => existsSync(join(gate, "reached")),
    letThrough: () => writeFileSync(join(gate, "go"), ""),
  };
}

function toolContext(site: OpenSite, model: ToolContext["model"], mode: AgentMode, seen: Map<string, string>): ToolContext {
  return { site, siteId: site.id, mode, model, images: undefined as never, signal: new AbortController().signal, titles: new Map(), read: seen, question: null, askedLastTurn: false };
}

/** One call of one of the assistant's real tools. */
async function tool(ctx: ToolContext, name: string, input: unknown) {
  const block = { type: "tool_use", id: `toolu_${name}`, name, input } as Anthropic.Beta.BetaToolUseBlock;
  const run = await runTool(block, ctx, runningActivity(block, ctx));

  return { error: run.result.is_error === true, text: String(run.result.content) };
}

/**
 * With `rewriting` stopped at the gate: a person saves HOME without saying
 * what they opened, a person saves PRICING saying what they opened, and the
 * assistant changes POST (with the hash it read) and replaces STYLE (which
 * it read). Then `rewriting` is let through. `after` is what each file must
 * hold once it has finished.
 */
async function saveDuring(site: ReturnType<typeof gatedSite>, open: OpenSite, rewriting: () => Promise<unknown>, after: Record<string, string>) {
  const model = await open.model();
  const seen = new Map<string, string>();
  const content = toolContext(open, model, "content", seen);
  const build = toolContext(open, model, "build", seen);
  // What each of them read before anything was rewritten.
  const opened = hashOf(site.root, PRICING);
  const assistantRead = JSON.parse((await tool(content, "read_entry", { path: POST })).text) as { hash: string };
  const before = Object.fromEntries(FILES.map((path) => [path, read(site.root, path)]));

  expect((await tool(build, "read_file", { path: STYLE })).error).toBe(false);
  expect(assistantRead.hash).toBe(hashOf(site.root, POST));
  site.arm();
  const rewritten = rewriting();

  await until(() => site.reached(), 60_000);
  // The workspace is held and the files are still as they were read.
  for (const path of FILES.slice(1)) expect(read(site.root, path)).toBe(before[path]);
  const settle = <T>(work: Promise<T>) => work.then((value) => ({ value }), (error: unknown) => ({ error: error as { code?: string; message?: string } }));
  const unhashed = settle(open.updateEntry(HOME, [{ op: "set", path: ["description"], value: "Saved meanwhile." }]));
  const hashed = settle(open.updateEntry(PRICING, [{ op: "set", path: ["description"], value: "Saved meanwhile." }], { baseHash: opened }));
  const assistantEntry = tool(content, "update_entry", { path: POST, ops: [{ op: "set", path: "description", value: "Saved meanwhile." }], baseHash: assistantRead.hash });
  const assistantFile = tool(build, "write_file", { path: STYLE, content: `${before[STYLE]}\n/* the assistant's */\n` });

  // Long enough for every one of them to have read its file and be waiting to write.
  await new Promise((resolve) => setTimeout(resolve, 400));
  for (const path of FILES.slice(1)) expect(read(site.root, path)).toBe(before[path]);
  site.letThrough();
  await rewritten;

  // Worked out again from what is there now: the save is in, on top of the rewritten text and nothing older.
  expect(await unhashed).toMatchObject({ value: { applied: 1 } });
  expect(read(site.root, HOME)).toBe(after[HOME]!.replace(/^description: .*$/m, "description: Saved meanwhile."));
  expect(after[HOME]).toMatch(/^description: .+$/m);
  // Said what it had opened, and that is gone: told to reopen, and nothing written.
  expect(await hashed).toMatchObject({ error: { code: "conflict", message: expect.stringMatching(/changed since you opened it, so your edit wasn't saved/) } });
  expect(read(site.root, PRICING)).toBe(after[PRICING]);
  // The assistant, the same: its change to the entry and its replacement of the file are both refused.
  expect(await assistantEntry).toMatchObject({ error: true, text: expect.stringMatching(/changed since you opened it/) });
  expect(read(site.root, POST)).toBe(after[POST]);
  expect(await assistantFile).toMatchObject({ error: true, text: expect.stringMatching(/changed after you read it, so it wasn't replaced/) });
  expect(read(site.root, STYLE)).toBe(after[STYLE]);
  // Read again, the assistant's changes go through, on the text that is there now.
  const reread = JSON.parse((await tool(content, "read_entry", { path: POST })).text) as { hash: string };

  expect((await tool(content, "update_entry", { path: POST, ops: [{ op: "set", path: "description", value: "Saved afterwards." }], baseHash: reread.hash })).error).toBe(false);
  expect(read(site.root, POST)).toBe(after[POST]!.replace(/^description: .*$/m, "description: Saved afterwards."));
  await tool(build, "read_file", { path: STYLE });
  expect((await tool(build, "write_file", { path: STYLE, content: "/* replaced */\n" })).error).toBe(false);
  expect(read(site.root, STYLE)).toBe("/* replaced */\n");
}

describe.skipIf(process.platform === "win32")("a save while files are being rewritten under it", GIT_HEAVY, () => {
  it("by a Discard: what was discarded doesn't come back", async () => {
    const site = gatedSite();
    const head = Object.fromEntries(FILES.map((path) => [path, read(site.root, path)]));
    const { site: open } = await openSite(site.root);

    // Unpublished changes to every one of them.
    for (const path of FILES) writeFileSync(join(site.root, path), versionOf(head[path]!, path, "Unpublished"));
    await open.changes();
    await saveDuring(site, open, () => open.discard(FILES), head);
    for (const path of [HOME, PRICING, POST]) expect(read(site.root, path)).not.toContain("Unpublished");
  });

  it("by newer versions coming in: they are not undone", async () => {
    const site = gatedSite();
    const bare = addBareRemote(site.root);
    const other = tempDir("site-gate-other-");
    const { site: open } = await openSite(site.root);

    sh(other, "clone", "-q", bare, ".");
    const theirs = Object.fromEntries(FILES.map((path) => [path, versionOf(read(other, path), path, "Theirs")]));

    for (const path of FILES) writeFileSync(join(other, path), theirs[path]!);
    sh(other, "commit", "-q", "-am", "Their version");
    sh(other, "push", "-q", "origin", "main");
    await saveDuring(site, open, () => open.pull(), theirs);
    expect(sh(site.root, "log", "-1", "--format=%s")).toBe("Their version");
    for (const path of [HOME, PRICING, POST]) expect(read(site.root, path)).toContain("title: Theirs");
  });

  it("by a publish being undone: the undo holds", async () => {
    const site = gatedSite();
    const head = Object.fromEntries(FILES.map((path) => [path, read(site.root, path)]));
    const { site: open } = await openSite(site.root);

    for (const path of FILES) writeFileSync(join(site.root, path), versionOf(head[path]!, path, "Published by mistake"));
    const published = await open.publish({ paths: FILES, message: "A mistake" });

    expect(published).toMatchObject({ ok: true, files: [...FILES].sort() });
    await saveDuring(site, open, async () => expect(await open.revert(published.commit!)).toMatchObject({ ok: true }), head);
    for (const path of [HOME, PRICING, POST]) expect(read(site.root, path)).not.toContain("Published by mistake");
  });
});
