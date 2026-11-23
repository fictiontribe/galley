import { describe, expect, it } from "vitest";
import type { Field } from "@galley/core/types";
import { placeholderFor } from "../../src/features/content/fields/common";

const field = (key: string, examples: string[]): Field => ({ key, label: key, type: "string", required: false, source: "inferred", examples });

describe("placeholders", () => {
  it("never offer another page's title or description as an example for this one", () => {
    expect(placeholderFor(field("title", ["Page not found"]))).toBe("A short, specific title");
    expect(placeholderFor(field("description", ["The page you asked for isn’t here."]))).toBe("One or two plain sentences about this page");
    expect(placeholderFor(field("seoTitle", ["Contact"]))).toBe("A short, specific title");
  });

  it("still show a real example where one helps", () => {
    expect(placeholderFor(field("eyebrow", ["New this season"]))).toBe("e.g. New this season");
    expect(placeholderFor(field("name", ["Hesper Lowe"]))).toBe("e.g. Hesper Lowe");
  });
});
