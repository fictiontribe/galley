import { describe, expect, it } from "vitest";
import type { Collection, Field } from "@galley/core/types";
import { isKitFile, isVisibilitySettings } from "../../src/features/forms/logic/locate";

const field = (key: string): Field => ({ key, label: key, type: "string", required: false, source: "schema" });
const data = (id: string, path: string, keys: string[]): Collection =>
  ({ id, label: id, kind: "data", format: "json", path, fields: keys.map(field), count: 1, source: "schema" }) as unknown as Collection;

describe("the site kit's own files stay out of the content list", () => {
  it("recognises the AI-readable output settings by the fields the engine gives them", () => {
    const visibility = data("visibility", "src/data/visibility.json", ["site", "crawlers", "robots", "sitemap", "structuredData", "agentReadable"]);

    expect(isVisibilitySettings(visibility)).toBe(true);
    expect(isKitFile(visibility)).toBe(true);
  });

  it("leaves ordinary data files alone, even one that shares a key", () => {
    expect(isKitFile(data("site", "src/data/site.json", ["site", "title", "tagline"]))).toBe(false);
    expect(isKitFile(data("navigation", "src/data/navigation.json", ["main", "footer"]))).toBe(false);
    expect(isVisibilitySettings(data("empty", "src/data/empty.json", []))).toBe(false);
  });
});
