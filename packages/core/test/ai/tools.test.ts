/** Each tool against the in-memory fake site, outside the loop. */
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { createImageService, createSettingsService } from "../../src/ai/index";
import { ALL_TOOLS, runTool, runningActivity, toolsForMode } from "../../src/ai/tools/index";
import { toFieldPath } from "../../src/ai/tools/content";
import { entryName, fileName } from "../../src/ai/tools/labels";
import { READS_KEPT, rememberVersion } from "../../src/ai/tools/reads";
import type { ToolContext } from "../../src/ai/tools/types";
import type { AgentMode } from "../../src/types";
import { cleanEnv, tempDir } from "./helpers/env";
import { createFakeSite, type FakeSite } from "./helpers/fake-site";

function context(site: FakeSite, mode: AgentMode = "content", extra: Partial<ToolContext> = {}): ToolContext {
  const home = tempDir("ai-tools-");
  const settings = createSettingsService({ home, env: cleanEnv() });

  return {
    site,
    siteId: site.id,
    mode,
    model: undefined as never,
    images: createImageService({ home, settings }),
    signal: new AbortController().signal,
    titles: new Map(),
    question: null,
    askedLastTurn: false,
    ...extra,
  };
}

async function call(ctx: ToolContext, name: string, input: unknown) {
  ctx.model ??= await ctx.site.model();
  const block = { type: "tool_use", id: `toolu_${name}`, name, input } as Anthropic.Beta.BetaToolUseBlock;
  const running = runningActivity(block, ctx);
  const run = await runTool(block, ctx, running);

  return { running, ...run, text: String(run.result.content), json: () => JSON.parse(String(run.result.content)) };
}

describe("tool set", () => {
  it("offers build tools only in build mode", () => {
    const content = toolsForMode("content").map((t) => t.name);
    const build = toolsForMode("build").map((t) => t.name);

    expect(content).not.toContain("write_file");
    expect(content).toContain("update_entry");
    expect(build).toEqual(expect.arrayContaining(["write_file", "edit_file", "read_file", "list_files", "run_build", "save_site_config"]));
    expect(content).toEqual(expect.arrayContaining(["audit_site", "audit_entry"]));
    // 19, plus check_redirects (redirects), get_brand and check_brand (the site's brand).
    expect(ALL_TOOLS).toHaveLength(22);
  });

  it("parses dotted and array field paths", () => {
    expect(toFieldPath("sections.2.heading")).toEqual(["sections", 2, "heading"]);
    expect(toFieldPath("items[3].label")).toEqual(["items", 3, "label"]);
    expect(toFieldPath(["hero", "title"])).toEqual(["hero", "title"]);
  });

  it("names things the way the person does", async () => {
    const model = await createFakeSite().model();

    expect(entryName("src/content/pages/index.md", model, new Map())).toBe("the home page");
    expect(entryName("src/content/pages/about.md", model, new Map())).toBe("the About page");
    expect(entryName("src/content/blog/rye.md", model, new Map([["src/content/blog/rye.md", "Why rye"]]))).toBe("the post “Why rye”");
    expect(fileName("src/components/Header.astro")).toBe("the “Header” component");
    expect(fileName("src/layouts/Base.astro")).toBe("the “Base” layout");
    expect(fileName("src/styles/tokens.css")).toBe("the “tokens” stylesheet");
    expect(fileName("galley.config.json")).toBe("the site configuration");
  });
});

describe("content tools", () => {
  it("reads an entry with its fields, hash and issues", async () => {
    const site = createFakeSite();
    const ctx = context(site);
    const result = await call(ctx, "read_entry", { path: "src/content/pages/index.md" });
    const value = result.json();

    expect(result.activity).toMatchObject({ status: "done", label: "Read the home page" });
    expect(value.data.sections[0].heading).toBe("Bread from the harbour");
    expect(value.hash).toMatch(/\w+/);
    expect(value.fields.join("\n")).toContain("heading");
    const field = (await call(ctx, "read_entry", { path: "src/content/pages/index.md", field: "sections.1" })).json();

    expect(field.value).toEqual({ type: "text", heading: "Our ovens", text: "Wood-fired since 1998." });
  });

  it("pages a long body instead of dumping it", async () => {
    const long = Array.from({ length: 300 }, (_, i) => `## Part ${i}\n\nSome words about part ${i} that run on for a while.`).join("\n\n");
    const site = createFakeSite();

    site.files.set("src/content/pages/long.md", `---\ntitle: Long\n---\n\n${long}\n`);
    const ctx = context(site);
    const first = (await call(ctx, "read_entry", { path: "src/content/pages/long.md" })).json();

    expect(first.body.text.length).toBeLessThanOrEqual(8_000);
    expect(first.body.more).toContain("bodyOffset");
    expect(first.body.outline.length).toBeGreaterThan(10);
    const next = (await call(ctx, "read_entry", { path: "src/content/pages/long.md", bodyOffset: first.body.to })).json();

    expect(next.body.from).toBe(first.body.to);
  });

  it("applies edits, reports refusals, and adds a section at the end", async () => {
    const site = createFakeSite();
    const ctx = context(site);
    const { hash } = (await call(ctx, "read_entry", { path: "src/content/pages/index.md" })).json();
    const added = await call(ctx, "update_entry", {
      path: "src/content/pages/index.md",
      baseHash: hash,
      ops: [{ op: "insert", path: "sections", value: { type: "text", heading: "Visit us", text: "On the quay, from 7am." } }],
    });

    expect(added.result.is_error).toBeUndefined();
    expect(added.json().applied).toBe(1);
    expect(site.files.get("src/content/pages/index.md")).toContain("heading: Visit us");
    // An entry this conversation hasn't read is not changed at all, whatever the edit.
    const unread = await call(ctx, "update_entry", { path: "src/content/pages/about.md", ops: [{ op: "set", path: "title", value: "About us" }] });

    expect(unread.result.is_error).toBe(true);
    expect(unread.text).toBe("You haven't read this entry in this conversation, so nothing was changed. Read it with read_entry first, then make your change.");
    expect(site.files.get("src/content/pages/about.md")).toContain("title: About\n");
    await call(ctx, "read_entry", { path: "src/content/pages/about.md" });
    const refused = await call(ctx, "update_entry", { path: "src/content/pages/about.md", ops: [{ op: "body-replace", find: "before dawn", replace: "at night" }] });

    expect(refused.result.is_error).toBe(true);
    expect(refused.json().refused[0].reason).toMatch(/\w/);
    expect(refused.activity.label).toBe("Couldn't edit the About page");
    const stale = await call(ctx, "update_entry", { path: "src/content/pages/index.md", baseHash: hash, ops: [{ op: "set", path: "title", value: "X" }] });

    expect(stale.result.is_error).toBe(true);
    expect(stale.text).toBe("The entry changed after you read it, so nothing was changed. Read it again with read_entry, then make your change to what is there now.");
    expect(stale.activity.label).toBe("Couldn't edit the home page");
    // With no version named, the one it last read or wrote goes with the edit: its own edits follow each other…
    const followed = await call(ctx, "update_entry", { path: "src/content/pages/index.md", ops: [{ op: "set", path: "title", value: "Home again" }] });

    expect(followed.result.is_error).toBeUndefined();
    expect(followed.json().applied).toBe(1);
    expect((await call(ctx, "update_entry", { path: "src/content/pages/index.md", ops: [{ op: "set", path: "title", value: "And again" }] })).json().applied).toBe(1);
    // …and an edit made from text that has since been replaced (a person discarded, newer versions came in) changes nothing.
    const replaced = String(site.files.get("src/content/pages/index.md")).replace("And again", "Theirs");

    site.files.set("src/content/pages/index.md", replaced);
    const blind = await call(ctx, "update_entry", { path: "src/content/pages/index.md", ops: [{ op: "body", value: "A whole new text, written from the old one.\n" }] });

    expect(blind.result.is_error).toBe(true);
    expect(blind.text).toContain("changed after you read it, so nothing was changed");
    expect(site.files.get("src/content/pages/index.md")).toBe(replaced);
    // Told to read again, it can't go round for ever: the same edit is refused the same way until it has.
    expect((await call(ctx, "update_entry", { path: "src/content/pages/index.md", ops: [{ op: "body", value: "Again.\n" }] })).result.is_error).toBe(true);
    expect(site.files.get("src/content/pages/index.md")).toBe(replaced);
    await call(ctx, "read_entry", { path: "src/content/pages/index.md" });
    expect((await call(ctx, "update_entry", { path: "src/content/pages/index.md", ops: [{ op: "set", path: "title", value: "Ours" }] })).json().applied).toBe(1);
    expect(site.files.get("src/content/pages/index.md")).toBe(replaced.replace("Theirs", "Ours"));
  });

  it("creates and deletes entries through the site", async () => {
    const site = createFakeSite();
    const ctx = context(site);
    const created = await call(ctx, "create_entry", { collection: "blog", slug: "sourdough-starter", data: { title: "Keeping a starter", date: "2026-11-01" }, body: "Feed it daily." });

    expect(created.running.label).toBe("Writing a new post “Keeping a starter”");
    expect(created.json().path).toBe("src/content/blog/sourdough-starter.md");
    expect(site.writes.at(-1)).toMatchObject({ origin: "agent" });
    await call(ctx, "delete_entry", { path: "src/content/blog/sourdough-starter.md" });
    expect(site.files.has("src/content/blog/sourdough-starter.md")).toBe(false);
  });

  it("searches, lists and validates", async () => {
    const ctx = context(createFakeSite());

    expect((await call(ctx, "search_content", { query: "dawn" })).json()[0].path).toBe("src/content/pages/about.md");
    expect((await call(ctx, "list_entries", { collection: "pages" })).json().total).toBe(2);
    expect((await call(ctx, "validate", {})).json().errors).toBe(0);
  });

  it("generates an image with the mock provider, saves it, and returns its URL", async () => {
    const site = createFakeSite();
    const ctx = context(site);
    // No service chosen: placeholder artwork, and the result says it is one.
    const placeholder = await call(ctx, "generate_image", { prompt: "A harbour wall at dawn" });

    expect(placeholder.result.is_error).toBeUndefined();
    expect(placeholder.json()).toMatchObject({ provider: "mock", placeholder: expect.stringContaining("placeholder artwork") });
    expect(placeholder.activity.label).toBe("Made placeholder artwork");
    const home = tempDir("ai-img-");
    const settings = createSettingsService({ home, env: cleanEnv() });

    await settings.update({ images: { provider: "mock" } });
    ctx.images = createImageService({ home, settings });
    const made = (await call(ctx, "generate_image", { prompt: "Loaves cooling on a rack", aspect: "16:9" })).json();

    expect(made.url).toBe("/images/loaves-cooling-rack.svg");
    expect(site.files.has("public/images/loaves-cooling-rack.svg")).toBe(true);
    expect((await call(ctx, "generate_image", { prompt: "Loaves cooling on a rack" })).json().url).toBe("/images/loaves-cooling-rack-2.svg");
  });

  it("asks one question at a time", async () => {
    const ctx = context(createFakeSite());
    const first = await call(ctx, "ask_user", { question: "Which page?", options: [{ label: "Home" }, { label: "About" }] });

    expect(first.result.is_error).toBeUndefined();
    expect(ctx.question?.options).toHaveLength(2);
    expect((await call(ctx, "ask_user", { question: "Really?", options: [{ label: "Yes" }, { label: "No" }] })).result.is_error).toBe(true);
    const tooMany = await call(context(createFakeSite()), "ask_user", { question: "Which?", options: [{ label: "A" }, { label: "B" }, { label: "C" }, { label: "D" }, { label: "E" }] });

    expect(tooMany.result.is_error).toBe(true);
  });
});

describe("build tools and the mode guard", () => {
  it("is refused by the dispatcher in content mode", async () => {
    const site = createFakeSite();
    const result = await call(context(site, "content"), "write_file", { path: "src/components/Header.astro", content: "x" });

    expect(result.result.is_error).toBe(true);
    expect(site.files.get("src/components/Header.astro")).not.toBe("x");
  });

  it("is refused by the engine too: the write carries the turn's mode", async () => {
    const site = createFakeSite();
    const write = ALL_TOOLS.find((tool) => tool.name === "write_file")!;
    const ctx = context(site, "content");

    ctx.model = await site.model();
    // Call the tool's own run(), skipping the dispatcher's mode check.
    await expect(write.run({ path: "src/components/Header.astro", content: "<header>x</header>" }, ctx)).rejects.toMatchObject({ code: "forbidden" });
    expect(site.files.get("src/components/Header.astro")).toContain("Home");
  });

  it("never reads a secrets file or one of the version history's own, and says so in words the assistant can act on", async () => {
    const site = createFakeSite();
    const ctx = context(site, "build", { read: new Map() });
    const secrets = [".env", ".envrc", "config/.env-production", ".ENV.local"];
    const reads: string[] = [];
    const readFile = site.readFile.bind(site);

    for (const path of [...secrets, ".git/config", "sub/.git/HEAD"]) site.files.set(path, "TOKEN=not-for-the-assistant\n");
    site.readFile = async (path) => (reads.push(path), readFile(path));
    for (const path of secrets) {
      const read = await call(ctx, "read_file", { path });

      expect(read.result.is_error, path).toBe(true);
      expect(read.text, path).toBe("That is a secrets file, so it isn't read here. Ask the person for what you need from it.");
      // An edit is no way to ask what a file holds: found or not, once or many times, it is told nothing.
      for (const old_string of ["TOKEN", "nothing-like-this"]) {
        const edit = await call(ctx, "edit_file", { path, old_string, new_string: "x", replace_all: true });

        expect(edit.result.is_error, path).toBe(true);
        expect(edit.text, path).toBe("That is a secrets file, so it isn't read here. Ask the person for what you need from it.");
      }
    }
    for (const path of [".git/config", "sub/.git/HEAD"]) {
      const read = await call(ctx, "read_file", { path });

      expect(read.result.is_error, path).toBe(true);
      expect(read.text, path).toBe("That is one of the version history's own files, so it isn't read here. Ask for the site's history instead.");
    }
    // Not one of them was opened, by a read, an edit or a write that found a file in its way.
    for (const path of secrets) await call(ctx, "write_file", { path, content: "x\n" }).catch(() => undefined);
    expect(reads).toEqual([]);
    expect(site.files.get(".env")).toBe("TOKEN=not-for-the-assistant\n");
    // A file that only has "env" in its name is an ordinary file.
    site.files.set("src/env.d.ts", "/// <reference types=\"astro/client\" />\n");
    expect((await call(ctx, "read_file", { path: "src/env.d.ts" })).json().text).toContain("astro/client");
    // And a search of the content says nothing of what a secrets file holds: no path, no count.
    expect((await call(ctx, "search_content", { query: "not-for-the-assistant" })).text).not.toMatch(/\.env|\.git|TOKEN/);
  });

  it("doesn't replace a file that changed after it was read, until it has been read again", async () => {
    const site = createFakeSite();
    const ctx = context(site, "build", { read: new Map() });
    const path = "src/styles/tokens.css";

    await call(ctx, "read_file", { path });
    // Newer versions came in, or someone else saved the file, before the write.
    site.files.set(path, ":root { --accent: #000; }\n");
    const refused = await call(ctx, "write_file", { path, content: "mine\n" });

    expect(refused.result.is_error).toBe(true);
    expect(refused.text).toBe("The file changed after you read it, so it wasn't replaced. Read it again, then make your change to what is there now.");
    expect(refused.activity.label).toBe("Couldn't write the “tokens” stylesheet");
    expect(site.files.get(path)).toBe(":root { --accent: #000; }\n");
    // Trying again without reading is refused the same way.
    expect((await call(ctx, "write_file", { path, content: "mine\n" })).result.is_error).toBe(true);
    expect(site.files.get(path)).toBe(":root { --accent: #000; }\n");
    expect((await call(ctx, "read_file", { path })).json().text).toContain("--accent: #000");
    expect((await call(ctx, "write_file", { path, content: "mine\n" })).result.is_error).toBeUndefined();
    expect(site.files.get(path)).toBe("mine\n");
    // Its own edits and writes are not somebody else's changes.
    expect((await call(ctx, "edit_file", { path, old_string: "mine", new_string: "ours" })).result.is_error).toBeUndefined();
    expect((await call(ctx, "write_file", { path, content: "again\n" })).result.is_error).toBeUndefined();
    expect((await call(ctx, "write_file", { path, content: "and again\n" })).result.is_error).toBeUndefined();
    expect(site.files.get(path)).toBe("and again\n");
    // A file that isn't there yet is made: there was nothing to read.
    expect((await call(ctx, "write_file", { path: "src/styles/new.css", content: "a {}\n" })).result.is_error).toBeUndefined();
    expect(site.files.get("src/styles/new.css")).toBe("a {}\n");
    // A file that is there and was never read in this conversation is not replaced.
    const header = site.files.get("src/components/Header.astro");
    const unread = await call(ctx, "write_file", { path: "src/components/Header.astro", content: "<header>new</header>\n" });

    expect(unread.result.is_error).toBe(true);
    expect(unread.text).toBe("That file is already there and you haven't read it in this conversation, so it wasn't replaced. Read it with read_file first, then write it.");
    expect(site.files.get("src/components/Header.astro")).toBe(header);
    await call(ctx, "read_file", { path: "src/components/Header.astro" });
    expect((await call(ctx, "write_file", { path: "src/components/Header.astro", content: "<header>new</header>\n" })).result.is_error).toBeUndefined();
    // What was read on one site says nothing about the file of that name on another (a session can work on several).
    const other = createFakeSite();
    const elsewhere = context(other, "build", { read: ctx.read!, siteId: "another-site" });
    const theirs = other.files.get(path);

    expect((await call(elsewhere, "write_file", { path, content: "mine\n" })).text).toContain("haven't read it in this conversation");
    expect(other.files.get(path)).toBe(theirs);
    await call(elsewhere, "read_file", { path });
    expect((await call(elsewhere, "write_file", { path, content: "theirs now\n" })).result.is_error).toBeUndefined();
    // Reading it there didn't touch what is remembered of the first site's file.
    expect((await call(ctx, "write_file", { path, content: "mine once more\n" })).result.is_error).toBeUndefined();
    expect(site.files.get(path)).toBe("mine once more\n");
    // Only so many files are remembered; one read long ago is read again before it is replaced.
    for (let n = 0; n < READS_KEPT; n += 1) rememberVersion(ctx, `src/filler/${n}.css`, "0000000000000000");
    expect((await call(ctx, "write_file", { path, content: "forgotten\n" })).text).toContain("haven't read it in this conversation");
    expect(ctx.read!.size).toBe(READS_KEPT);
  });

  it("edits exactly one match, or refuses with the reason", async () => {
    const site = createFakeSite();
    const ctx = context(site, "build");

    site.files.set("src/styles/dupe.css", "a { color: red; }\nb { color: red; }\n");
    expect((await call(ctx, "edit_file", { path: "src/styles/dupe.css", old_string: "color: red", new_string: "color: blue" })).text).toContain("appears 2 times");
    expect((await call(ctx, "edit_file", { path: "src/styles/dupe.css", old_string: "nope", new_string: "x" })).text).toContain("wasn't found");
    const all = await call(ctx, "edit_file", { path: "src/styles/dupe.css", old_string: "color: red", new_string: "color: blue", replace_all: true });

    expect(all.json().replaced).toBe(2);
    const one = await call(ctx, "edit_file", { path: "src/styles/tokens.css", old_string: "#1f6feb", new_string: "#0b3d91" });

    expect(one.activity.label).toBe("Edited the “tokens” stylesheet");
    expect(site.files.get("src/styles/tokens.css")).toContain("#0b3d91");
  });

  it("reads files in line ranges and reports the build's tail", async () => {
    const site = createFakeSite();
    const ctx = context(site, "build");

    site.files.set("src/big.ts", Array.from({ length: 900 }, (_, i) => `const line${i} = ${i};`).join("\n"));
    const first = (await call(ctx, "read_file", { path: "src/big.ts" })).json();

    expect(first.to).toBe(400);
    expect(first.more).toContain("startLine 401");
    expect((await call(ctx, "read_file", { path: "src/big.ts", startLine: 899, endLine: 900 })).json().text).toContain("line899");
    site.buildResult = { ok: false, output: `${"x".repeat(10_000)}\nError: Header.astro:2 unexpected token`, durationMs: 4300 };
    const build = await call(ctx, "run_build", {});

    expect(build.result.is_error).toBe(true);
    expect(build.json().output.length).toBeLessThanOrEqual(4_001);
    expect(build.json().output).toContain("unexpected token");
    expect(build.activity.label).toBe("Built the site · it reported problems");
  });
});
