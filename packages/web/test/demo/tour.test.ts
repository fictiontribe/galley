/** The walkthrough's step logic: each step ends when the visitor does the real thing, never past a card-only step. */
import { describe, expect, it } from "vitest";
import { HOME_PAGE, NOTHING_TO_PUBLISH, ORDER, STEPS, TOTAL_STEPS, isDone, isThere, next, nothingToPublish, placeFor, settle, skipEmpty, start, type Facts, type TourState } from "../../demo/tour/steps";
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

  it("keeps the card clear of a whole dialog, or a whole change, when the control sits inside one", () => {
    const view = { width: 1440, height: 900 };
    const overlaps = (a: { x: number; y: number }, w: number, h: number, b: { x: number; y: number; width: number; height: number }) => a.x < b.x + b.width && a.x + w > b.x && a.y < b.y + b.height && a.y + h > b.y;
    // The Published dialog in the middle of the window, its "See version history" at its foot, another button to its right.
    const dialog = { x: 460, y: 316, width: 520, height: 268 };
    const button = { x: 744, y: 536, width: 150, height: 36 };
    // Beside the button alone, the card lands on the rest of the dialog's foot…
    expect(overlaps(placeCard(button, view, 340, 240), 340, 240, dialog)).toBe(true);
    // …and beside the dialog, level with the button, it covers none of it.
    const placed = placeCard(button, view, 340, 240, dialog);

    expect(placed).toEqual({ x: 994, y: 536 });
    expect(overlaps(placed, 340, 240, dialog)).toBe(false);
    // A change in Proof's right-hand column, its "Put back" at its right end: beside the button alone the card
    // sits on the words that changed; beside the whole change (to its left, where there is room) it doesn't.
    const change = { x: 640, y: 360, width: 780, height: 96 };
    const putBack = { x: 1330, y: 384, width: 76, height: 32 };

    expect(overlaps(placeCard(putBack, view, 340, 200), 340, 200, change)).toBe(true);
    const beside = placeCard(putBack, view, 340, 200, change);

    expect(beside).toEqual({ x: 286, y: 384 });
    expect(overlaps(beside, 340, 200, change)).toBe(false);
    // A change as wide as the window: under it, in line with the button.
    const wide = { x: 20, y: 360, width: 1400, height: 96 };

    expect(placeCard(putBack, view, 340, 200, wide)).toEqual({ x: 1084, y: 470 });
    // Nothing to keep clear of: as before.
    expect(placeCard(button, view, 340, 240, null)).toEqual(placeCard(button, view, 340, 240));
  });

  it("gives every step a number of its own, 1 to 7, and none to the welcome or the last card", () => {
    const numbered = STEPS.filter((step) => step.number !== null);

    expect(numbered.map((step) => step.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(numbered).toHaveLength(TOTAL_STEPS);
    expect(STEPS.filter((step) => step.number === null).map((step) => step.id)).toEqual(["welcome", "done"]);
    expect(STEPS.map((step) => step.id)).toEqual(ORDER);
  });

  it("at Publish with every change discarded, says there is nothing to publish instead of asking for a press that can't be made", () => {
    // Two changes waiting when "Put one back" began; the bar's Discard takes them all.
    const putBack = at("putBack", { pendingAtStart: 2 });
    const afterDiscard = skipEmpty(settle(putBack, facts({ route: "/sites/caddow/proof", pending: 0 })), facts({ route: "/sites/caddow/proof", pending: 0 }));

    expect(afterDiscard.step).toBe("publish");
    expect(nothingToPublish(afterDiscard, facts({ pending: 0 }))).toBe(true);
    expect(NOTHING_TO_PUBLISH).toMatch(/^Nothing is waiting to be published now/);
    expect(NOTHING_TO_PUBLISH).not.toMatch(/commit|branch|discard(ed)? all/i);
    // One change put back, one still waiting: the ordinary Publish step.
    expect(nothingToPublish(at("publish"), facts({ pending: 1 }))).toBe(false);
    // The visitor changes something again: the step carries on, and ends when a version is published.
    expect(nothingToPublish(afterDiscard, facts({ pending: 1 }))).toBe(false);
    expect(settle(afterDiscard, facts({ pending: 0, published: 1 })).step).toBe("history");
    // Published already, nothing waiting: that is the step done, not an empty Publish.
    expect(nothingToPublish(afterDiscard, facts({ pending: 0, published: 1 }))).toBe(false);
    // Only ever at the Publish step.
    for (const step of ORDER.filter((id) => id !== "publish")) expect(nothingToPublish(at(step), facts({ pending: 0 }))).toBe(false);
  });

  it("says where the demo stands in, and nothing on the screens that work as they do at home", () => {
    expect(noticeFor("/sites/caddow/online")).toMatch(/stand-in/);
    expect(noticeFor("/sites/caddow/media?x=1")).toMatch(/placeholders/);
    expect(noticeFor("/sites/caddow/edit")).toBeNull();
    expect(noticeFor("/sites/caddow/proof")).toBeNull();
  });
});
