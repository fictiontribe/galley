/**
 * What the assistant read in one reply, and newer versions that came in
 * before the next: the real runtime and tools, a real site with a code host,
 * and a hosted editor's own round between two replies of one conversation.
 * The second reply writes from what the first one read.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addBareRemote, cleanupAll, disposeAll, makeSite, openSite, POST, sh, tempDir } from "../site/helpers";
import { harness } from "./helpers/env";
import { scriptedFetch, stream, testClient, type MessageSpec } from "./helpers/scripted-fetch";

const STYLE = "src/styles/tokens.css";

afterEach(async () => {
  await disposeAll();
  cleanupAll();
});

const thinking = { type: "thinking" as const, thinking: "", signature: "sig" };
const say = (text: string): MessageSpec => ({ content: [thinking, { type: "text", text }], stop_reason: "end_turn" });
const use = (id: string, name: string, input: unknown): MessageSpec => ({ content: [thinking, { type: "tool_use" as const, id, name, input, chunks: 2 }], stop_reason: "tool_use" });

describe("a conversation remembers what it read from one reply to the next", { timeout: 120_000 }, () => {
  it("so a reply can't replace, from an earlier reply's reading, versions that came in between", async () => {
    const root = makeSite();
    const bare = addBareRemote(root);
    const other = tempDir("ai-across-other-");
    const { site } = await openSite(root);
    const script = scriptedFetch([]);
    const h = harness({ client: testClient(script.fetch), site });
    const thread = await h.runtime.createThread(site.id, { mode: "build" });
    const read = (path: string) => readFileSync(join(root, ...path.split("/")), "utf8");
    /** What the model was told about its last tool call. */
    const told = () => script.requests.at(-1)!.body.messages.at(-1).content[0] as { is_error?: boolean; content: string };
    const asRead = { style: read(STYLE), post: read(POST) };

    // The first reply reads a stylesheet and a post, and changes nothing.
    script.push(stream(use("r1", "read_file", { path: STYLE })), stream(use("r2", "read_entry", { path: POST })), stream(say("I've read both.")));
    await h.turn(thread.id, "Look at the colours and the survey post");

    // Between the replies someone publishes newer versions of both, and the editor's own round brings them in.
    sh(other, "clone", "-q", bare, ".");
    writeFileSync(join(other, STYLE), `${asRead.style}\n/* theirs */\n`);
    writeFileSync(join(other, POST), asRead.post.replace(/^title: .*$/m, "title: Theirs"));
    sh(other, "commit", "-q", "-am", "Their versions");
    sh(other, "push", "-q", "origin", "main");
    expect(h.runtime.working(site.id)).toBe(false);
    expect(await site.catchUp()).toMatchObject({ brought: 1 });
    const theirs = { style: read(STYLE), post: read(POST) };

    expect(theirs.style).toContain("/* theirs */");

    // The second reply writes both from what the first one read, without reading again.
    script.push(
      stream(use("w1", "write_file", { path: STYLE, content: `${asRead.style}\n/* the assistant's */\n` })),
      stream(use("w2", "update_entry", { path: POST, ops: [{ op: "body", value: "Rewritten from the first reading.\n" }] })),
      stream(say("Neither could be changed: both had changed since I read them."))
    );
    await h.turn(thread.id, "Now tidy both");
    const refusals = script.requests.slice(-2).map((request) => request.body.messages.at(-1).content[0] as { is_error?: boolean; content: string });

    expect(refusals[0]).toMatchObject({ is_error: true, content: "The file changed after you read it, so it wasn't replaced. Read it again, then make your change to what is there now." });
    expect(refusals[1]).toMatchObject({ is_error: true, content: "The entry changed after you read it, so nothing was changed. Read it again with read_entry, then make your change to what is there now." });
    expect(read(STYLE)).toBe(theirs.style);
    expect(read(POST)).toBe(theirs.post);
    expect((await site.changes()).files).toEqual([]);

    // A third reply reads again and then changes them: on top of the newer versions.
    script.push(
      stream(use("r3", "read_file", { path: STYLE })),
      stream(use("w3", "write_file", { path: STYLE, content: `${theirs.style}/* the assistant's */\n` })),
      stream(use("r4", "read_entry", { path: POST })),
      stream(use("w4", "update_entry", { path: POST, ops: [{ op: "set", path: "description", value: "Tidied." }] })),
      stream(say("Both are tidied."))
    );
    await h.turn(thread.id, "Read them again and tidy them");
    expect(told().is_error).toBeUndefined();
    expect(read(STYLE)).toBe(`${theirs.style}/* the assistant's */\n`);
    expect(read(POST)).toBe(theirs.post.replace(/^description: .*$/m, "description: Tidied."));

    // And a fourth goes on from its own writing without reading once more: what it wrote is what it knows.
    script.push(stream(use("w5", "write_file", { path: STYLE, content: "/* all the assistant's now */\n" })), stream(say("Done.")));
    await h.turn(thread.id, "Replace the stylesheet");
    expect(read(STYLE)).toBe("/* all the assistant's now */\n");

    // Another conversation on the same site has read nothing: it replaces nothing it hasn't read.
    const second = await h.runtime.createThread(site.id, { mode: "build" });

    script.push(stream(use("w6", "write_file", { path: STYLE, content: "/* from a conversation that never read it */\n" })), stream(say("I need to read it first.")));
    await h.turn(second.id, "Replace the stylesheet");
    expect(told()).toMatchObject({ is_error: true, content: expect.stringContaining("you haven't read it in this conversation") });
    expect(read(STYLE)).toBe("/* all the assistant's now */\n");
    // A conversation that is deleted is forgotten with it.
    await h.runtime.deleteThread(site.id, thread.id);
  });
});
