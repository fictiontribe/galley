/** The walkthrough's step logic: each step ends when the visitor does the real thing, never past a card-only step. */
import { describe, expect, it } from "vitest";
import { HOME_PAGE, isDone, isThere, next, placeFor, settle, skipEmpty, start, type Facts, type TourState } from "../../demo/tour/steps";
import { placeCard } from "../../demo/tour/place";
import { noticeFor } from "../../demo/layer/notices";

const facts = (patch: Partial<Facts> = {}): Facts => ({ route: "/sites/caddow", entryPath: null, pending: 0, headingChanged: false, pageEdited: false, assistantChanged: false, published: 0, ...patch });
const at = (step: TourState["step"], patch: Partial<TourState> = {}): TourState => ({ step, pendingAtStart: 0, publishedAtStart: 0, ...patch });

describe("the walkthrough", () => {
  it("starts at the welcome, which only the card ends", () => {
    const state = start(facts());
    expect(state.step).toBe("welcome");
    expect(settle(state, facts({ headingChanged: true, pageEdited: true }))).toEqual(state);
  });

  it("moves on when the visitor does each thing", () => {
    expect(isDone(at("form"), facts({ headingChanged: true }))).toBe(true);
    expect(isDone(at("page"), facts({ pageEdited: true }))).toBe(true);
    expect(isDone(at("assistant"), facts({ assistantChanged: true }))).toBe(true);
    expect(isDone(at("proof"), facts({ route: "/sites/caddow/proof" }))).toBe(true);
    expect(isDone(at("proof"), facts({ route: "/sites/caddow/edit" }))).toBe(false);
    expect(isDone(at("putBack", { pendingAtStart: 3 }), facts({ pending: 2 }))).toBe(true);
    expect(isDone(at("putBack", { pendingAtStart: 3 }), facts({ pending: 3 }))).toBe(false);
    expect(isDone(at("publish", { publishedAtStart: 0 }), facts({ published: 1 }))).toBe(true);
    expect(isDone(at("history"), facts({ route: "/sites/caddow/history" }))).toBe(true);
  });

  it("catches up when the visitor ran ahead, and stops at the end card", () => {
    const ahead = facts({ headingChanged: true, pageEdited: true, assistantChanged: true, route: "/sites/caddow/history", published: 1, pending: 0 });
    expect(settle(at("form"), ahead).step).toBe("proof");
    expect(settle(at("history"), ahead).step).toBe("done");
    expect(next(at("done"), ahead).step).toBe("done");
  });

  it("measures put back from where the step began", () => {
    const state = next(at("proof"), facts({ pending: 3 }));
    expect(state).toEqual({ step: "putBack", pendingAtStart: 3, publishedAtStart: 0 });
  });

  it("skips put back when there is nothing in Proof", () => {
    expect(skipEmpty(at("putBack"), facts({ pending: 0 })).step).toBe("publish");
    expect(skipEmpty(at("putBack"), facts({ pending: 2 })).step).toBe("putBack");
  });

  it("knows where each step happens", () => {
    expect(placeFor("form", "caddow")).toBe(`/sites/caddow/edit?path=${encodeURIComponent(HOME_PAGE)}`);
    expect(placeFor("putBack", "caddow")).toBe("/sites/caddow/proof");
    expect(placeFor("welcome", "caddow")).toBeNull();
    expect(isThere("form", { route: "/sites/caddow/edit", entryPath: HOME_PAGE })).toBe(true);
    expect(isThere("form", { route: "/sites/caddow/edit", entryPath: "src/content/pages/atelier.md" })).toBe(false);
    expect(isThere("publish", { route: "/sites/caddow", entryPath: null })).toBe(false);
  });

  it("puts the card beside the control, inside the window", () => {
    const view = { width: 1440, height: 900 };
    expect(placeCard({ x: 100, y: 200, width: 300, height: 50 }, view, 340, 200)).toEqual({ x: 414, y: 200 });
    expect(placeCard({ x: 1200, y: 200, width: 200, height: 50 }, view, 340, 200)).toEqual({ x: 846, y: 200 });
    expect(placeCard(null, view, 340, 200)).toEqual({ x: 1084, y: 652 });
  });

  it("says where the demo stands in, and nothing on the screens that work as they do at home", () => {
    expect(noticeFor("/sites/caddow/online")).toMatch(/stand-in/);
    expect(noticeFor("/sites/caddow/media?x=1")).toMatch(/placeholders/);
    expect(noticeFor("/sites/caddow/edit")).toBeNull();
    expect(noticeFor("/sites/caddow/proof")).toBeNull();
  });
});
