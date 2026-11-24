/**
 * The assistant's tools, the way the routes are tested: every tool × owner,
 * editor, contributor and nobody, driven from the tool list itself (a tool
 * missing from the table below fails the test), against a real site. A tool
 * is offered only to someone whose role has its level; running it checks
 * again; and with that check stepped round, the engine still refuses every
 * write the role can't make. The assistant surfaces only the build-mode
 * tools the person may use, and refuses build mode to someone who can't use it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createImageService, createSettingsService } from "../../src/ai/index";
import { plainTools } from "../../src/ai/profiles";
import { everywhereTools, executeTool, offeredBuildToolNames, toolsFor, toolsForMode } from "../../src/ai/tools/index";
import type { AssistantTool, ToolContext } from "../../src/ai/tools/types";
import { GalleyError } from "../../src/errors";
import { roleMay, type AccessLevel, type AccountRole } from "../../src/install/accounts";
import { BUILD_MODE_REFUSAL, withCaller } from "../../src/install/caller";
import { ROLE_REFUSAL } from "../../src/install/route-access";
import type { GalleyConfig } from "../../src/types";
import { cleanupAll, disposeAll, makeSite, openSite, sh } from "../site/helpers";
import { createFakeSite } from "./helpers/fake-site";
import { cleanEnv, harness, tempDir } from "./helpers/env";
import { scriptedFetch, stream, testClient, type MessageSpec } from "./helpers/scripted-fetch";

afterEach(async () => {
  await disposeAll();
  cleanupAll();
});

type Who = AccountRole | null;
const EVERYONE: Who[] = ["owner", "editor", "contributor", null];

/** What each tool needs, written down here on its own — not read from the tools — so a change to a tool's level is a change to this table. */
const NEEDS: Record<string, AccessLevel> = {
  list_collections: "edit",
  list_entries: "edit",
  read_entry: "edit",
  search_content: "edit",
  update_entry: "edit",
  create_entry: "edit",
  delete_entry: "edit",
  list_media: "edit",
  generate_image: "edit",
  validate: "edit",
  ask_user: "edit",
  audit_site: "edit",
  audit_entry: "edit",
  get_brand: "edit",
  check_brand: "edit",
  check_redirects: "edit",
  list_files: "publish",
  read_file: "publish",
  write_file: "publish",
  edit_file: "publish",
  run_build: "publish",
  save_site_config: "manage",
};

/** A call each tool can make on the starter site, for each person (their own names, so nobody's call undoes another's). */
function inputFor(name: string, who: Who, config: GalleyConfig): unknown {
  const tag = who ?? "nobody";
  const inputs: Record<string, unknown> = {
    list_collections: {},
    list_entries: { collection: "pages" },
    read_entry: { path: "src/content/pages/about.md" },
    search_content: { query: "studio" },
    update_entry: { path: "src/content/pages/about.md", ops: [{ op: "set", path: "title", value: `About (${tag})` }] },
    create_entry: { collection: "blog", slug: `a-post-by-${tag}`, data: { title: `A post by ${tag}` } },
    delete_entry: { path: "src/content/blog/measured-survey.md" },
    list_media: {},
    generate_image: { prompt: "A quiet studio with a long table" },
    validate: {},
    ask_user: { question: "Which page did you mean?", options: [{ label: "About" }, { label: "Services" }] },
    audit_site: { rendered: false },
    audit_entry: { path: "src/content/pages/about.md" },
    get_brand: {},
    check_brand: {},
    check_redirects: {},
    list_files: { glob: "src/content/pages/*.md", limit: 5 },
    read_file: { path: "package.json" },
    write_file: { path: `src/components/Note-${tag}.astro`, content: "<p>Note</p>\n" },
    edit_file: { path: "src/components/Edit.astro", old_string: "<p>before</p>", new_string: `<p>after ${tag}</p>`, replace_all: true },
    run_build: {},
    save_site_config: { config: { ...config, name: `Renamed by ${tag}` } },
  };

  return inputs[name];
}

const may = (who: Who, level: AccessLevel) => who === null || roleMay(who, level);
const as = <T>(who: Who, run: () => T): T => (who === null ? run() : withCaller({ accountId: `${who}-1`, role: who }, run));
const names = (tools: AssistantTool[]) => tools.map((tool) => tool.name).sort();

/** The starter, with a build that costs nothing and a file to edit; the turn in build mode for whoever may use it. */
async function starter(who: Who = null) {
  const root = makeSite();
  const config = JSON.parse(readFileSync(join(root, "galley.config.json"), "utf8")) as GalleyConfig;

  writeFileSync(join(root, "galley.config.json"), JSON.stringify({ ...config, build: { command: "node --version" } }, null, 2));
  writeFileSync(join(root, "src", "components", "Edit.astro"), "<p>before</p>\n");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "A quick build");
  const { site } = await openSite(root);
  const home = tempDir("tools-access-");
  const settings = createSettingsService({ home, env: cleanEnv() });
  const ctx: ToolContext = {
    site,
    siteId: site.id,
    mode: may(who, "publish") ? "build" : "content",
    model: await site.model(),
    images: createImageService({ home, settings }),
    signal: new AbortController().signal,
    titles: new Map(),
    question: null,
    askedLastTurn: false,
  };

  return { site, ctx, config: (await site.readConfig()) as GalleyConfig };
}

describe("every assistant tool, by role", () => {
  it("the table names exactly the tools there are", () => {
    expect(Object.keys(NEEDS).sort()).toEqual(names(toolsFor()));
  });

  it("is offered only to someone whose role has its level, in the assistant and over MCP", () => {
    for (const who of EVERYONE) {
      const allowed = (tool: AssistantTool) => may(who, NEEDS[tool.name]!);

      as(who, () => {
        expect(names(toolsForMode("build")), String(who)).toEqual(names(toolsFor().filter(allowed)));
        expect(names(toolsForMode("content")), String(who)).toEqual(names(toolsFor().filter((tool) => tool.mode === "any" && allowed(tool))));
        expect(names(everywhereTools()), String(who)).toEqual(names(toolsFor().filter((tool) => (tool.surface ?? "everywhere") === "everywhere" && allowed(tool))));
        expect(offeredBuildToolNames(), String(who)).toEqual(names(toolsFor().filter((tool) => tool.mode === "build" && allowed(tool))));
        expect(plainTools("build").map((tool) => tool.name).sort(), String(who)).toEqual(names(toolsFor().filter(allowed)));
      });
    }
  });

  it("runs for someone whose role has its level, and is refused for anyone else — checked again at run time", async () => {
    for (const who of EVERYONE) {
      const { ctx, config } = await starter(who);

      for (const tool of toolsFor()) {
        const input = inputFor(tool.name, who, config);

        expect(input, `a sample call for ${tool.name}`).toBeDefined();
        // The configuration is replaced only by a conversation that has read it.
        if (tool.name === "save_site_config" && may(who, NEEDS[tool.name]!)) {
          const reading = toolsFor().find((candidate) => candidate.name === "read_file")!;

          await as(who, () => executeTool(reading, reading.name, { path: "galley.config.json" }, ctx, reading.title));
        }
        const outcome = await as(who, () => executeTool(tool, tool.name, input, ctx, tool.title));

        if (may(who, NEEDS[tool.name]!)) {
          expect(outcome.isError ?? false, `${tool.name} as ${who}: ${outcome.content.slice(0, 300)}`).toBe(false);
        } else {
          expect(outcome.isError, `${tool.name} as ${who}`).toBe(true);
          expect(outcome.content.startsWith(NEEDS[tool.name] === "publish" ? BUILD_MODE_REFUSAL : ROLE_REFUSAL), `${tool.name} as ${who}: ${outcome.content}`).toBe(true);
        }
      }
    }
  });

  it("with the tool layer's own check stepped round, the engine still refuses every write the role can't make", async () => {
    for (const who of ["editor", "contributor"] as const) {
      const { site, ctx, config } = await starter(who);
      // Stepped round the mode too: the turn says build mode, as a tool or plugin holding the site could.
      ctx.mode = "build";
      const before = readFileSync(join(site.root, "galley.config.json"), "utf8");

      for (const tool of toolsFor()) {
        if (may(who, NEEDS[tool.name]!) || tool.effect.readOnly) continue;
        const parsed = tool.input.parse(inputFor(tool.name, who, config));
        let refused: unknown = null;

        try {
          await as(who, () => tool.run(parsed, ctx));
        } catch (error) {
          refused = error;
        }
        expect(refused instanceof GalleyError && refused.code === "forbidden", `${tool.name} as ${who}: ${String(refused)}`).toBe(true);
      }
      expect(readFileSync(join(site.root, "galley.config.json"), "utf8")).toBe(before);
      expect(await site.listFiles({ glob: "src/components/Note-*" })).toEqual([]);
      expect(readFileSync(join(site.root, "src", "components", "Edit.astro"), "utf8")).toBe("<p>before</p>\n");
    }
  });
});

describe("the assistant's turn", () => {
  const thinking = { type: "thinking" as const, thinking: "", signature: "sig" };
  const text = (value: string): MessageSpec => ({ content: [thinking, { type: "text", text: value }], stop_reason: "end_turn" });
  const toolStep = (name: string, input: unknown): MessageSpec => ({ content: [thinking, { type: "tool_use", id: `toolu_${name}`, name, input, chunks: 2 }], stop_reason: "tool_use" });
  const changes = (body: { messages: Array<{ role: string; content: Array<{ type: string; tool?: { name: string } }> }> }, type: string) =>
    (body.messages.at(-1)?.role === "system" ? body.messages.at(-1)!.content : []).filter((block) => block.type === type).map((block) => block.tool!.name).sort();

  it("surfaces only the build-mode tools the person may use, and withdraws those someone before them could", async () => {
    const script = scriptedFetch([stream(text("Owner's build turn.")), stream(text("Editor's build turn.")), stream(text("Contributor's content turn.")), stream(toolStep("write_file", { path: "src/components/Header.astro", content: "<header>x</header>\n" })), stream(text("I can't change the code."))]);
    const site = createFakeSite();
    const h = harness({ client: testClient(script.fetch), site });
    const thread = await as("owner", () => h.runtime.createThread(site.id, { mode: "build" }));
    const all = toolsFor().filter((tool) => tool.mode === "build").map((tool) => tool.name).sort();

    await as("owner", () => h.turn(thread.id, "Change the header", { mode: "build" }));
    expect(changes(script.requests[0]!.body, "tool_addition")).toEqual(all);
    await as("editor", () => h.turn(thread.id, "Carry on", { mode: "build" }));
    expect(changes(script.requests[1]!.body, "tool_addition")).toEqual([]);
    expect(changes(script.requests[1]!.body, "tool_removal")).toEqual(["save_site_config"]);

    // A contributor asking for build mode, or carrying on a build-mode conversation, is told so — never switched quietly.
    await expect(as("contributor", () => h.runtime.send(site.id, thread.id, { text: "Carry on", mode: "build" }))).rejects.toThrow(BUILD_MODE_REFUSAL);
    await expect(as("contributor", () => h.runtime.send(site.id, thread.id, { text: "Carry on" }))).rejects.toThrow(/This conversation is in build mode/);
    await expect(as("contributor", () => h.runtime.createThread(site.id, { mode: "build" }))).rejects.toThrow(BUILD_MODE_REFUSAL);
    await as("contributor", () => h.turn(thread.id, "Just the content now", { mode: "content" }));
    expect(changes(script.requests[2]!.body, "tool_removal")).toEqual(all.filter((name) => name !== "save_site_config"));
    // And a build-mode tool the model calls anyway is refused before it runs.
    const header = site.files.get("src/components/Header.astro");

    await as("contributor", () => h.turn(thread.id, "Change the header code", { mode: "content" }));
    const result = script.requests[4]!.body.messages.at(-1).content.find((block: { type: string }) => block.type === "tool_result");

    expect(result).toMatchObject({ is_error: true, content: expect.stringContaining(BUILD_MODE_REFUSAL) });
    expect(site.files.get("src/components/Header.astro")).toBe(header);
  });
});
