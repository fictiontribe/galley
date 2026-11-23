/** The harness-neutral registry that MCP serves from the assistant's own tool definitions. */
import { describe, expect, it } from "vitest";
import { executeTool, siteTools, toolByName } from "../../src/ai/index";
import { ALL_TOOLS } from "../../src/ai/tools/index";
import type { ToolContext } from "../../src/ai/tools/types";
import { createFakeSite } from "./helpers/fake-site";

describe("the shared tool registry", () => {
  it("is the assistant's definitions minus the chat-only ones", () => {
    const names = siteTools.map((tool) => tool.name);

    expect(names).not.toContain("ask_user");
    expect(names).not.toContain("list_collections");
    expect(names).toHaveLength(ALL_TOOLS.length - 2);
    for (const tool of siteTools) expect(toolByName(tool.name)).toBe(tool);
  });

  it("every tool has a title and states its effect", () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.title, tool.name).toMatch(/^[A-Z]/);
      expect(tool.effect, tool.name).toMatchObject({ readOnly: expect.any(Boolean), destructive: expect.any(Boolean), idempotent: expect.any(Boolean), openWorld: expect.any(Boolean) });
      if (tool.effect.readOnly) expect(tool.effect.destructive, tool.name).toBe(false);
    }
    const writers = ALL_TOOLS.filter((tool) => !tool.effect.readOnly).map((tool) => tool.name).sort();

    expect(writers).toEqual(["create_entry", "delete_entry", "edit_file", "generate_image", "run_build", "save_site_config", "update_entry", "write_file"]);
    expect(ALL_TOOLS.filter((tool) => tool.effect.openWorld).map((tool) => tool.name)).toEqual(["generate_image"]);
  });

  it("executeTool applies the same mode check and validation as the assistant's dispatcher", async () => {
    const site = createFakeSite();
    const ctx: ToolContext = {
      site,
      siteId: site.id,
      mode: "content",
      model: await site.model(),
      images: undefined as never,
      signal: new AbortController().signal,
      titles: new Map(),
      question: null,
      askedLastTurn: false,
    };
    const write = toolByName("write_file");

    expect(await executeTool(write, "write_file", { path: "src/x.astro", content: "x" }, ctx, "Writing")).toMatchObject({ isError: true, content: expect.stringContaining("content mode") });
    expect(await executeTool(undefined, "nope", {}, ctx, "x")).toMatchObject({ isError: true, content: "There is no tool called nope." });
    const bad = await executeTool(toolByName("read_entry"), "read_entry", { path: 7 }, ctx, "Reading");

    expect(bad.isError).toBe(true);
    expect(bad.content).toContain("path");
    const missing = await executeTool(toolByName("read_entry"), "read_entry", { path: "src/content/pages/missing.md" }, ctx, "Reading the page");

    expect(missing.isError).toBe(true);
  });
});
