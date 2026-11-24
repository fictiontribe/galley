import { describe, expect, it } from "vitest";
import { importStanding } from "../src/import";

describe("where an import's entries stand", () => {
  const written = ["src/content/blog/a.md", "src/content/blog/b.md", "src/content/pages/c.md"];

  it("counts each written entry once: still pending, published since, or discarded", () => {
    expect(importStanding(written, new Set(written), new Set())).toEqual({ pending: 3, published: 0, discarded: 0 });
    expect(importStanding(written, new Set(), new Set())).toEqual({ pending: 0, published: 0, discarded: 3 });
    expect(importStanding(written, new Set([written[2]!]), new Set([written[0]!, "src/data/site.json"]))).toEqual({ pending: 1, published: 1, discarded: 1 });
    // Published, then edited again: it is waiting, not done.
    expect(importStanding(written, new Set([written[0]!]), new Set([written[0]!]))).toEqual({ pending: 1, published: 0, discarded: 2 });
  });
});
