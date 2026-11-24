import { describe, expect, it } from "vitest";
import { frameLocal, startsDrag } from "@/features/builder/drag";
import { parseOverlayMessage } from "@/features/preview/frames";

describe("Arrange messages from the page", () => {
  it("accepts exactly the protocol's shapes", () => {
    expect(parseOverlayMessage({ galley: 1, type: "arrange-status", status: "declined", how: null, reason: "Two sections show the same text.", revision: 4 })).toMatchObject({ status: "declined", revision: 4 });
    expect(parseOverlayMessage({ galley: 1, type: "arrange-status", status: "maybe", how: null, reason: null, revision: 1 })).toBeNull();
    expect(parseOverlayMessage({ galley: 1, type: "arrange-select", key: "sections.2" })).toMatchObject({ key: "sections.2" });
    expect(parseOverlayMessage({ galley: 1, type: "arrange-select", key: "sections" })).toBeNull();
    expect(parseOverlayMessage({ galley: 1, type: "arrange-action", action: "move", field: "sections", index: 0, to: 3 })).toMatchObject({ action: "move", to: 3 });
    expect(parseOverlayMessage({ galley: 1, type: "arrange-action", action: "move", field: "sections", index: 0 })).toBeNull();
    expect(parseOverlayMessage({ galley: 1, type: "arrange-action", action: "step", field: "sections", index: 1, delta: 2 })).toBeNull();
    expect(parseOverlayMessage({ galley: 1, type: "arrange-action", action: "delete-everything", field: "sections", index: 0 })).toBeNull();
    expect(parseOverlayMessage({ galley: 1, type: "placing-at", field: null, index: null })).toMatchObject({ index: null });
    expect(parseOverlayMessage({ galley: 1, type: "place", field: "sections", index: -1 })).toBeNull();
  });

  it("takes the reason a page was declined, and whether it was drawn", () => {
    expect(parseOverlayMessage({ galley: 1, type: "arrange-status", status: "declined", how: null, reason: "x", revision: 2, cause: "page-failed" })).toMatchObject({ cause: "page-failed" });
    // An older overlay says no cause; an unknown one is dropped, never guessed.
    expect(parseOverlayMessage({ galley: 1, type: "arrange-status", status: "declined", how: null, reason: "x", revision: 2 })).not.toHaveProperty("cause");
    expect(parseOverlayMessage({ galley: 1, type: "arrange-status", status: "declined", how: null, reason: "x", revision: 2, cause: "bored" })).not.toHaveProperty("cause");
    expect(parseOverlayMessage({ galley: 1, type: "page-state", state: "failed", status: 500, message: "ENOENT: no such file" })).toEqual({ galley: 1, type: "page-state", state: "failed", status: 500, message: "ENOENT: no such file" });
    expect(parseOverlayMessage({ galley: 1, type: "page-state", state: "drawn", status: null, message: null })).toMatchObject({ state: "drawn" });
    expect(parseOverlayMessage({ galley: 1, type: "page-state", state: "broken", status: 500, message: null })).toBeNull();
    expect(parseOverlayMessage({ galley: 1, type: "page-state", state: "failed", status: "500", message: null })).toBeNull();
    expect(parseOverlayMessage({ galley: 1, type: "page-state", state: "failed", status: 500, message: "x".repeat(500) })).toBeNull();
  });
});

describe("dragging a palette card onto the page", () => {
  const box = { left: 300, top: 40, right: 1100, bottom: 840 };
  it("turns app coordinates into the frame's own, or null outside it", () => {
    expect(frameLocal(box, 350, 100)).toEqual({ x: 50, y: 60 });
    expect(frameLocal(box, 200, 100)).toBeNull();
    expect(frameLocal(box, 1100, 100)).toBeNull();
  });
  it("starts after a small move; a finger only drags sideways so the list still scrolls", () => {
    expect(startsDrag("mouse", 3, 2)).toBe(false);
    expect(startsDrag("mouse", 6, 0)).toBe(true);
    expect(startsDrag("touch", 2, 30)).toBe(false);
    expect(startsDrag("touch", 24, 4)).toBe(true);
  });
});
