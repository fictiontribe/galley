import { describe, expect, it } from "vitest";
import { outsideKind } from "../../src/features/content/form/outside";

describe("which fresh copies the form announces", () => {
  it("is silent about edits made in this app, whatever event came with them", () => {
    expect(outsideKind({ own: true, origin: "user" })).toBeNull();
    expect(outsideKind({ own: true, origin: null })).toBeNull();
    // Even when an assistant event for the same page is still pending.
    expect(outsideKind({ own: true, origin: "agent" })).toBeNull();
  });

  it("announces the assistant's edits and changes from outside the app", () => {
    expect(outsideKind({ own: false, origin: "agent" })).toBe("agent");
    expect(outsideKind({ own: false, origin: "external" })).toBe("external");
  });

  it("folds everything else in quietly", () => {
    for (const origin of ["user", "publish", "discard", "undo", null, undefined] as const) expect(outsideKind({ own: false, origin })).toBeNull();
  });
});

describe("the record of copies written in this app", () => {
  it("knows a copy by site, path and hash", async () => {
    const { isOwnCopy, noteOwnCopy } = await import("../../src/lib/entryWrites");
    noteOwnCopy("s1", { path: "src/content/pages/index.md", hash: "abc" });
    expect(isOwnCopy("s1", { path: "src/content/pages/index.md", hash: "abc" })).toBe(true);
    expect(isOwnCopy("s1", { path: "src/content/pages/index.md", hash: "def" })).toBe(false);
    expect(isOwnCopy("s2", { path: "src/content/pages/index.md", hash: "abc" })).toBe(false);
  });
});
