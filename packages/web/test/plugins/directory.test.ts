import { describe, expect, it } from "vitest";
import { AI_STARTER_IDEAS, DIRECTORY_CATEGORIES, DIRECTORY_PLUGINS, buildPluginPrompt } from "@/features/plugins/directory";

describe("plugin directory", () => {
  it("lists unique plugins across valid categories, with blueprints carrying AI prompts", () => {
    const ids = new Set(DIRECTORY_PLUGINS.map((p) => p.id));
    expect(ids.size).toBe(DIRECTORY_PLUGINS.length);

    const validCategories = new Set(DIRECTORY_CATEGORIES.map((c) => c.id));
    for (const entry of DIRECTORY_PLUGINS) {
      expect(validCategories.has(entry.category)).toBe(true);
      expect(entry.capabilities.length).toBeGreaterThan(0);
      if (entry.kind === "blueprint") {
        expect(entry.aiIdea?.trim().length).toBeGreaterThan(10);
      } else {
        expect(entry.packageName).toBeTruthy();
      }
    }
  });

  it("builds a self-contained apiVersion 1 plugin prompt from any idea", () => {
    const prompt = buildPluginPrompt("  Send form leads to Notion  ");
    expect(prompt).toContain("Send form leads to Notion");
    expect(prompt).toContain("apiVersion: 1");
    expect(prompt).toContain("galley.config.json");
    expect(prompt).toContain("secret: true");
  });

  it("provides non-empty starter ideas for the AI creator", () => {
    expect(AI_STARTER_IDEAS.length).toBeGreaterThanOrEqual(4);
    for (const preset of AI_STARTER_IDEAS) {
      expect(preset.label.trim().length).toBeGreaterThan(0);
      expect(preset.idea.trim().length).toBeGreaterThan(20);
    }
  });
});
