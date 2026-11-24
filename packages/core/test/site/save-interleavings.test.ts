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
import { changeSettings, readSettings } from "../../src/site/settings-records";
import { addBareRemote, cleanupAll, disposeAll, HOME, makeSite, openSite, POST, PRICING, sh, tempDir, until } from "./helpers";

const GIT_HEAVY = { timeout: 180_000 };
/** Sorts before every other file these tests change, so git writes it first. */
const GATE = "aaa-gate.txt";
const STYLE = "src/styles/tokens.css";
const OTHER_POST = "src/content/blog/kitchen-extension-questions.md";
const FILES = [GATE, HOME, PRICING, POST, OTHER_POST, STYLE];

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
 * assistant changes POST (naming the version it read), rewrites OTHER_POST's
 * whole text from what it read (naming no version) and replaces STYLE
 * (which it read). Then `rewriting` is let through. `after` is what each
 * file must hold once it has finished.
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
  expect((await tool(content, "read_entry", { path: OTHER_POST })).error).toBe(false);
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
  // The whole text, written from the text it read, with no version named: the edit a re-apply would get most wrong.
  const assistantText = tool(content, "update_entry", { path: OTHER_POST, ops: [{ op: "body", value: "The assistant's rewrite of the text it read.\n" }] });
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
  // The assistant is never worked out again for: its changes to the entries and its replacement of the file are all refused.
  expect(await assistantEntry).toMatchObject({ error: true, text: expect.stringMatching(/changed after you read it, so nothing was changed/) });
  expect(read(site.root, POST)).toBe(after[POST]);
  expect(await assistantText).toMatchObject({ error: true, text: expect.stringMatching(/changed after you read it, so nothing was changed\. Read it again/) });
  expect(read(site.root, OTHER_POST)).toBe(after[OTHER_POST]);
  expect(read(site.root, OTHER_POST)).not.toContain("The assistant's rewrite");
  // Asking again without reading changes nothing either.
  expect((await tool(content, "update_entry", { path: OTHER_POST, ops: [{ op: "body", value: "Once more.\n" }] })).error).toBe(true);
  expect(read(site.root, OTHER_POST)).toBe(after[OTHER_POST]);
  expect(await assistantFile).toMatchObject({ error: true, text: expect.stringMatching(/changed after you read it, so it wasn't replaced/) });
  expect(read(site.root, STYLE)).toBe(after[STYLE]);
  // Read again, the assistant's changes go through, on the text that is there now.
  const reread = JSON.parse((await tool(content, "read_entry", { path: POST })).text) as { hash: string };

  expect((await tool(content, "update_entry", { path: POST, ops: [{ op: "set", path: "description", value: "Saved afterwards." }], baseHash: reread.hash })).error).toBe(false);
  expect(read(site.root, POST)).toBe(after[POST]!.replace(/^description: .*$/m, "description: Saved afterwards."));
  await tool(content, "read_entry", { path: OTHER_POST });
  expect((await tool(content, "update_entry", { path: OTHER_POST, ops: [{ op: "body", value: "Rewritten from what is there now.\n" }] })).error).toBe(false);
  expect(read(site.root, OTHER_POST)).toContain("Rewritten from what is there now.");
  expect(read(site.root, OTHER_POST).split("---")[1]).toBe(after[OTHER_POST]!.split("---")[1]);
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
    for (const path of [HOME, PRICING, POST, OTHER_POST]) expect(read(site.root, path)).not.toContain("Unpublished");
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
    for (const path of [HOME, PRICING, POST, OTHER_POST]) expect(read(site.root, path)).toContain("title: Theirs");
  });

  it("by a publish being undone: the undo holds", async () => {
    const site = gatedSite();
    const head = Object.fromEntries(FILES.map((path) => [path, read(site.root, path)]));
    const { site: open } = await openSite(site.root);

    for (const path of FILES) writeFileSync(join(site.root, path), versionOf(head[path]!, path, "Published by mistake"));
    const published = await open.publish({ paths: FILES, message: "A mistake" });

    expect(published).toMatchObject({ ok: true, files: [...FILES].sort() });
    await saveDuring(site, open, async () => expect(await open.revert(published.commit!)).toMatchObject({ ok: true }), head);
    for (const path of [HOME, PRICING, POST, OTHER_POST]) expect(read(site.root, path)).not.toContain("Published by mistake");
  });
});

describe.skipIf(process.platform === "win32")("the orders that are left", GIT_HEAVY, () => {
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const settle = <T>(work: Promise<T>) => work.then((value) => ({ value }), (error: unknown) => ({ error: error as { code?: string; message?: string } }));

  it("an assistant's reply undone while saves made from its text are on their way: the undo holds", async () => {
    const site = gatedSite();
    const entries = [PRICING, POST, OTHER_POST];
    const original = Object.fromEntries(entries.map((path) => [path, read(site.root, path)]));
    const { site: open } = await openSite(site.root);
    // Three replies of the assistant, each changing one entry.
    const replies = [];

    for (const path of entries) {
      const reply = open.checkpoint(`Assistant: ${path}`);

      await reply.run(() => open.updateEntry(path, [{ op: "set", path: ["description"], value: "The assistant's wording." }], { origin: "agent" }));
      reply.close();
      replies.push(reply);
    }
    for (const path of entries) expect(read(site.root, path)).toContain("The assistant's wording.");
    // A person has PRICING open as the reply left it; another conversation of the assistant has read POST as the reply left it.
    const opened = hashOf(site.root, PRICING);
    const other = toolContext(open, await open.model(), "content", new Map());

    expect((await tool(other, "read_entry", { path: POST })).error).toBe(false);
    // Something holds the workspace (a discard, stopped mid-way), and the replies are undone: each undo waits its turn behind it.
    writeFileSync(join(site.root, GATE), "unpublished\n");
    await open.changes();
    site.arm();
    const holding = open.discard([GATE]);

    await until(() => site.reached(), 60_000);
    const undone = Promise.all(replies.map((reply) => reply.restore()));

    await pause(200);
    // Saves made from the replies' text read it now, and can only write after the undos.
    const hashed = settle(open.updateEntry(PRICING, [{ op: "set", path: ["title"], value: "Mine" }], { baseHash: opened }));
    const assistant = tool(other, "update_entry", { path: POST, ops: [{ op: "body", value: "Rewritten from the reply's text.\n" }] });
    const unhashed = settle(open.updateEntry(OTHER_POST, [{ op: "set", path: ["title"], value: "Mine" }]));

    await pause(300);
    for (const path of entries) expect(read(site.root, path)).toContain("The assistant's wording.");
    site.letThrough();
    await holding;
    // Every reply's entry was still as the reply left it when its undo ran: all three are put back.
    expect((await undone).flat().sort()).toEqual([...entries].sort());
    // The person who had the reply's text open is told to reopen; nothing of the reply comes back.
    expect(await hashed).toMatchObject({ error: { code: "conflict" } });
    expect(read(site.root, PRICING)).toBe(original[PRICING]);
    // The other conversation's rewrite, made from the reply's text, changes nothing.
    expect(await assistant).toMatchObject({ error: true, text: expect.stringMatching(/changed after you read it, so nothing was changed/) });
    expect(read(site.root, POST)).toBe(original[POST]);
    // A save that named no version is worked out again on what the undo put back: its own change and nothing of the reply's.
    expect(await unhashed).toMatchObject({ value: { applied: 1 } });
    expect(read(site.root, OTHER_POST)).toBe(original[OTHER_POST]!.replace(/^title: .*$/m, "title: Mine"));
    for (const path of entries) expect(read(site.root, path)).not.toContain("The assistant's wording.");
  });

  it("a look at the code host beside a discard: neither disturbs the other, and the look answers with the discard done", async () => {
    const site = gatedSite();
    const bare = addBareRemote(site.root);
    const elsewhere = tempDir("site-gate-other-");
    const head = Object.fromEntries([GATE, HOME].map((path) => [path, read(site.root, path)]));
    const { site: open } = await openSite(site.root);

    sh(elsewhere, "clone", "-q", bare, ".");
    writeFileSync(join(elsewhere, PRICING), versionOf(read(elsewhere, PRICING), PRICING, "Theirs"));
    sh(elsewhere, "commit", "-q", "-am", "Their version");
    sh(elsewhere, "push", "-q", "origin", "main");
    const theirs = sh(elsewhere, "rev-parse", "HEAD");

    for (const path of [GATE, HOME]) writeFileSync(join(site.root, path), versionOf(head[path]!, path, "Unpublished"));
    await open.changes();
    site.arm();
    let discarded = false;
    const discarding = open.discard([GATE, HOME]).finally(() => void (discarded = true));

    await until(() => site.reached(), 60_000);
    // The discard is part-way; a look is asked for now.
    let answered = false;
    const looking = open.checkGit().finally(() => void (answered = true));

    // It asks the code host without waiting for the discard: what the code host has is known here…
    await until(() => sh(site.root, "rev-parse", "-q", "--verify", "refs/remotes/origin/main") === theirs, 60_000);
    await pause(200);
    // …while the discard is still where it stopped, and the look's answer waits for the files to be still.
    expect(discarded).toBe(false);
    expect(answered).toBe(false);
    expect(read(site.root, HOME)).toContain("Unpublished");
    site.letThrough();
    await discarding;
    for (const path of [GATE, HOME]) expect(read(site.root, path)).toBe(head[path]);
    // The answer is of the copy as the discard left it: nothing pending, one newer version waiting, nothing brought in.
    expect(await looking).toMatchObject({ behind: 1, ahead: 0, clean: true });
    expect((await looking).checkProblem).toBeUndefined();
    expect(read(site.root, PRICING)).not.toContain("Theirs");
    expect(sh(site.root, "status", "--porcelain")).toBe("");
  });
});

describe("the site's settings file", GIT_HEAVY, () => {
  const SETTINGS = "galley.config.json";

  it("is replaced only over the version the new settings were made from, by a person's save and by the assistant's", async () => {
    const root = makeSite();
    const { site: open } = await openSite(root);
    const config = (await open.readConfig())!;
    const opened = (await open.readFile(SETTINGS)).hash;

    // Someone else saves the settings first.
    await open.saveConfig({ ...config, name: "Theirs" });
    const theirs = read(root, SETTINGS);

    expect(theirs).toContain("Theirs");
    // A save that says which version it was made from, and that is gone: nothing is saved.
    await expect(open.saveConfig({ ...config, name: "Mine" }, { baseHash: opened })).rejects.toMatchObject({ code: "conflict", status: 409, message: expect.stringMatching(/settings changed since they were opened, so nothing was saved/) });
    expect(read(root, SETTINGS)).toBe(theirs);
    await open.saveConfig({ ...config, name: "Mine" }, { baseHash: hashOf(root, SETTINGS) });
    expect(read(root, SETTINGS)).toContain("Mine");

    // The assistant: not without reading the file in its conversation…
    const ctx = toolContext(open, await open.model(), "build", new Map());
    const before = read(root, SETTINGS);
    const unread = await tool(ctx, "save_site_config", { config: { ...config, name: "The assistant's" } });

    expect(unread).toMatchObject({ error: true, text: expect.stringMatching(/haven't read the configuration file \(galley\.config\.json\) in this conversation, so it wasn't replaced/) });
    expect(read(root, SETTINGS)).toBe(before);
    // …and not over a version newer than the one it read.
    expect((await tool(ctx, "read_file", { path: SETTINGS })).error).toBe(false);
    await open.saveConfig({ ...config, name: "Theirs again" });
    const newer = read(root, SETTINGS);
    const stale = await tool(ctx, "save_site_config", { config: { ...config, name: "The assistant's" } });

    expect(stale).toMatchObject({ error: true, text: expect.stringMatching(/configuration file changed after you read it, so it wasn't replaced\. Read it again/) });
    expect(read(root, SETTINGS)).toBe(newer);
    await tool(ctx, "read_file", { path: SETTINGS });
    expect((await tool(ctx, "save_site_config", { config: { ...config, name: "The assistant's" } })).error).toBe(false);
    expect(read(root, SETTINGS)).toContain("The assistant's");
  });
});

describe("the assistant's delete, and a file it can't read", GIT_HEAVY, () => {
  it("deletes an entry it has read only as it read it, and is told plainly about a file that can never be read", async () => {
    const root = makeSite();
    const { site: open } = await openSite(root);
    const model = await open.model();
    const content = toolContext(open, model, "content", new Map());

    // Read, then changed by someone else (newer versions came in, a person saved): not deleted as it now is.
    expect((await tool(content, "read_entry", { path: POST })).error).toBe(false);
    const theirs = versionOf(read(root, POST), POST, "Theirs");

    writeFileSync(join(root, POST), theirs);
    const refused = await tool(content, "delete_entry", { path: POST });

    expect(refused).toMatchObject({ error: true, text: "The entry changed after you read it, so it wasn't deleted. Read it again with read_entry, and delete it only if that is still what the person wants." });
    expect(read(root, POST)).toBe(theirs);
    // Read again, it goes; and it is forgotten with it, so a new entry of that name was never read.
    await tool(content, "read_entry", { path: POST });
    expect((await tool(content, "delete_entry", { path: POST })).error).toBe(false);
    expect(existsSync(join(root, POST))).toBe(false);
    writeFileSync(join(root, POST), theirs);
    expect((await tool(content, "update_entry", { path: POST, ops: [{ op: "set", path: "title", value: "Blind" }] })).text).toContain("You haven't read this entry in this conversation");
    // An entry it never read is deleted as asked: nothing it wrote was made from an older reading.
    expect((await tool(content, "delete_entry", { path: OTHER_POST })).error).toBe(false);
    expect(existsSync(join(root, OTHER_POST))).toBe(false);
    // The engine's own check, for any caller that names a version.
    await expect(open.deleteEntry(PRICING, { baseHash: "0000000000000000" })).rejects.toMatchObject({ code: "conflict", status: 409 });
    expect(existsSync(join(root, PRICING))).toBe(true);

    // A picture that is already there can't be read, so "read it first" could never be done: said as it is.
    const build = toolContext(open, model, "build", new Map());
    const picture = "public/images/share.png";
    const bytes = readFileSync(join(root, picture));
    const unreadable = await tool(build, "write_file", { path: picture, content: "not a picture\n" });

    expect(unreadable).toMatchObject({ error: true, text: expect.stringMatching(/^That file is already there and it isn't text \(a picture, a font or another kind of file\), so it can't be read and write_file doesn't replace it\./) });
    expect(unreadable.text).not.toContain("Read it");
    expect(readFileSync(join(root, picture)).equals(bytes)).toBe(true);
    // A new file beside it is made as before.
    expect((await tool(build, "write_file", { path: "public/images/note.txt", content: "a note\n" })).error).toBe(false);
  });
});

describe("settings changed on top of what is there", GIT_HEAVY, () => {
  it("a key someone else set between the read and the save is not set back", async () => {
    const root = makeSite();
    const { site: open } = await openSite(root);
    let meddled = false;
    // The site as a service holds it, with someone else saving the settings just after they are read.
    const meddling = new Proxy(open, {
      get(target, key) {
        if (key === "readConfig") {
          return async () => {
            const config = await target.readConfig();

            if (!meddled) {
              meddled = true;
              await target.saveConfig({ ...config, name: "Set by someone else" });
            }
            return config;
          };
        }
        const value = Reflect.get(target, key) as unknown;

        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });

    await changeSettings(meddling, (current) => ({ ...current, urls: { ...current.urls, production: "https://www.example.com" } }));
    expect(await open.readConfig()).toMatchObject({ name: "Set by someone else", urls: { production: "https://www.example.com" } });
    // Nothing to change: nothing is written.
    const before = read(root, "galley.config.json");

    expect(await changeSettings(open, () => null)).toBeNull();
    expect(read(root, "galley.config.json")).toBe(before);
    expect(await readSettings(open)).toEqual({ config: await open.readConfig(), hash: hashOf(root, "galley.config.json") });
  });
});

