/**
 * A dropped event stream is asked for again only while someone is at the
 * window: a while after it was last touched the asking stops, and it starts
 * again at the first sign of them. Driven through the window's own events.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerEvent } from "@galley/core/types";

type Events = typeof import("../../src/lib/events");

class FakeEventSource {
  static all: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor() {
    FakeEventSource.all.push(this);
  }
  close() {
    this.closed = true;
  }
  answer(...events: ServerEvent[]) {
    this.onopen?.();
    for (const event of events) this.onmessage?.({ data: JSON.stringify(event) });
  }
  /** The connection was lost, or the server didn't answer. */
  drop() {
    this.onerror?.();
  }
}

const HELLO: ServerEvent = { type: "hello", version: "test" };
const LIMIT: ServerEvent = { type: "stream.limit", message: "Too many windows of the editor are open on this account: 16 is the limit. Close one of the others, and this one connects again." };
const last = () => FakeEventSource.all.at(-1)!;
const MINUTE = 60_000;

describe("a dropped stream and a window nobody is at", () => {
  let events: Events;
  let windowListeners: Map<string, Array<() => void>>;
  let documentListeners: Map<string, Array<() => void>>;
  let page: { visibilityState: string };
  /** Whether the server answers the check made before each new attempt. */
  let serverUp: boolean;
  let checks: number;
  /** Something happens in the window, as the browser would tell it. */
  const fire = (type: string) => (windowListeners.get(type) ?? []).forEach((listener) => listener());
  const show = (state: "visible" | "hidden") => {
    page.visibilityState = state;
    (documentListeners.get("visibilitychange") ?? []).forEach((listener) => listener());
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    FakeEventSource.all = [];
    windowListeners = new Map();
    documentListeners = new Map();
    serverUp = false;
    checks = 0;
    const collect = (into: Map<string, Array<() => void>>) => (type: string, listener: () => void) => void into.set(type, [...(into.get(type) ?? []), listener]);
    const doc = { visibilityState: "visible", addEventListener: collect(documentListeners) };

    page = doc;
    vi.stubGlobal("addEventListener", collect(windowListeners));
    vi.stubGlobal("document", doc);
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        checks += 1;
        if (!serverUp) throw new Error("no answer");
        return { ok: true, json: async () => ({ authenticated: true }) };
      })
    );
    events = await import("../../src/lib/events");
  });

  afterEach(() => {
    events.disconnectEvents();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Opens the stream, has it answer, then loses it with the server gone. */
  function openThenDrop() {
    events.connectEvents();
    last().answer(HELLO);
    last().drop();
  }

  it("keeps asking while someone is at the window, however long the server is away", async () => {
    openThenDrop();
    for (let minute = 0; minute < 12; minute += 1) {
      await vi.advanceTimersByTimeAsync(MINUTE);
      fire("pointermove");
    }
    expect(events.useConnection.getState().state).toBe("down");
    // At most 18 s between attempts: 40 or more in twelve minutes.
    expect(checks).toBeGreaterThanOrEqual(40);
  });

  it("stops asking five minutes after the window was last touched, and says so", async () => {
    openThenDrop();
    await vi.advanceTimersByTimeAsync(events.REST_AFTER_MS - 20_000);
    expect(events.useConnection.getState().state).toBe("down");
    const before = checks;

    expect(before).toBeGreaterThan(10);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(events.useConnection.getState()).toMatchObject({ state: "resting", retryIn: null });
    const rested = checks;

    // An hour on: not one more question, and nothing waiting to ask one.
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    expect(checks).toBe(rested);
    expect(vi.getTimerCount()).toBe(0);
    expect(FakeEventSource.all).toHaveLength(1);
  });

  it.each(["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "focus", "pageshow"])("asks again at once on %s, and reads everything afresh when the stream is back", async (sign) => {
    let reconnects = 0;
    const stop = events.onReconnect(() => (reconnects += 1));

    expect(events.SIGNS_OF_SOMEONE).toContain(sign);
    openThenDrop();
    await vi.advanceTimersByTimeAsync(events.REST_AFTER_MS + MINUTE);
    expect(events.useConnection.getState().state).toBe("resting");
    const rested = checks;

    serverUp = true;
    fire(sign);
    expect(events.useConnection.getState()).toMatchObject({ state: "down", retryIn: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(checks).toBe(rested + 1);
    expect(FakeEventSource.all).toHaveLength(2);
    last().answer(HELLO);
    expect(events.useConnection.getState().state).toBe("open");
    expect(reconnects).toBe(1);
    stop();
  });

  it("asks again when the window comes back in front, and not when it goes behind", async () => {
    openThenDrop();
    await vi.advanceTimersByTimeAsync(events.REST_AFTER_MS + MINUTE);
    const rested = checks;

    show("hidden");
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(checks).toBe(rested);
    expect(events.useConnection.getState().state).toBe("resting");
    show("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(checks).toBe(rested + 1);
  });

  it("starts from the shortest wait again after resting, and rests again if nobody stays", async () => {
    openThenDrop();
    await vi.advanceTimersByTimeAsync(events.REST_AFTER_MS + MINUTE);
    const rested = checks;

    // Back for a moment, the server still away: asked at once, then after about a second, not after fifteen.
    fire("keydown");
    await vi.advanceTimersByTimeAsync(0);
    expect(checks).toBe(rested + 1);
    expect(events.useConnection.getState()).toMatchObject({ state: "down", retryIn: expect.any(Number) });
    expect(events.useConnection.getState().retryIn).toBeLessThanOrEqual(2);
    await vi.advanceTimersByTimeAsync(1_300);
    expect(checks).toBe(rested + 2);
    // And gone again: five minutes later it rests once more.
    await vi.advanceTimersByTimeAsync(events.REST_AFTER_MS + MINUTE);
    expect(events.useConnection.getState().state).toBe("resting");
    const again = checks;

    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    expect(checks).toBe(again);
  });

  it("leaves a stream that is open alone, however long nobody is there", async () => {
    events.connectEvents();
    last().answer(HELLO);
    await vi.advanceTimersByTimeAsync(3 * 60 * MINUTE);
    expect(events.useConnection.getState().state).toBe("open");
    expect(last().closed).toBe(false);
    expect(checks).toBe(0);
    // It drops with nobody there: not asked for once.
    last().drop();
    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    expect(checks).toBe(0);
    expect(events.useConnection.getState().state).toBe("resting");
  });

  it("doesn't take the network coming back for a person", async () => {
    openThenDrop();
    await vi.advanceTimersByTimeAsync(events.REST_AFTER_MS + MINUTE);
    const rested = checks;

    serverUp = true;
    fire("online");
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(checks).toBe(rested);
    expect(events.useConnection.getState().state).toBe("resting");
  });

  it("rests the quiet asking of a window told there are too many open, and keeps its words", async () => {
    serverUp = true;
    events.connectEvents();
    last().answer(LIMIT);
    expect(events.useConnection.getState().state).toBe("limited");
    await vi.advanceTimersByTimeAsync(events.REST_AFTER_MS + MINUTE);
    const asked = FakeEventSource.all.length;

    // Each quiet attempt was refused again while someone might still be there; then they stop.
    for (const source of FakeEventSource.all.slice(1)) if (!source.closed) source.answer(LIMIT);
    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    expect(FakeEventSource.all).toHaveLength(asked);
    expect(events.useConnection.getState()).toMatchObject({ state: "limited", problem: LIMIT.type === "stream.limit" ? LIMIT.message : "" });
    // Back at the window: asked at once, and let in.
    fire("pointerdown");
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeEventSource.all).toHaveLength(asked + 1);
    last().answer(HELLO);
    expect(events.useConnection.getState()).toMatchObject({ state: "open", problem: null });
  });

  it("signing out ends a rest: nothing asks later, and signing in again opens a stream", async () => {
    openThenDrop();
    await vi.advanceTimersByTimeAsync(events.REST_AFTER_MS + MINUTE);
    events.disconnectEvents();
    expect(events.useConnection.getState().state).toBe("idle");
    const before = checks;

    fire("pointermove");
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(checks).toBe(before);
    events.connectEvents();
    expect(FakeEventSource.all).toHaveLength(2);
  });
});
