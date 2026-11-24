/**
 * The event stream when the server says this account has too many windows
 * open: said once, shown as its own state, and asked again quietly until the
 * server lets this window in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerEvent } from "@galley/core/types";
import { connectEvents, disconnectEvents, LIMITED_RETRY_MS, onReconnect, subscribe, useConnection } from "../../src/lib/events";

/** A stand-in for the browser's EventSource that the test opens and pushes events through. */
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
  /** The server answered 200: a browser calls `onopen` before any event. */
  answer(...events: ServerEvent[]) {
    this.onopen?.();
    for (const event of events) this.onmessage?.({ data: JSON.stringify(event) });
  }
}

const LIMIT: ServerEvent = { type: "stream.limit", message: "Too many windows of the editor are open on this account: 16 is the limit. Close one of the others, and this one connects again." };
const HELLO: ServerEvent = { type: "hello", version: "test" };
const last = () => FakeEventSource.all.at(-1)!;

describe("too many windows on one account", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.all = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    // The check before each new attempt: the server is there and this browser is signed in.
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ authenticated: true }) })));
  });

  afterEach(() => {
    disconnectEvents();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("is its own state with the server's words, said once, and the stream is closed", () => {
    const said: string[] = [];
    const stop = subscribe("stream.limit", (event) => said.push(event.message));

    connectEvents();
    last().answer(LIMIT);
    expect(useConnection.getState()).toMatchObject({ state: "limited", problem: LIMIT.type === "stream.limit" ? LIMIT.message : "", retryIn: null });
    expect(last().closed).toBe(true);
    expect(said).toHaveLength(1);
    stop();
  });

  it("asks again every so often without a word, and is live again when the server lets it in", async () => {
    const said: string[] = [];
    const states: string[] = [];
    let reconnects = 0;
    const stops = [subscribe("stream.limit", (event) => said.push(event.message)), onReconnect(() => (reconnects += 1)), useConnection.subscribe((store) => states.push(store.state))];

    connectEvents();
    last().answer(LIMIT);
    const afterFirst = states.length;

    // Asked again, and refused again: nothing on the screen changes, and nothing is said twice.
    await vi.advanceTimersByTimeAsync(LIMITED_RETRY_MS);
    expect(FakeEventSource.all).toHaveLength(2);
    last().answer(LIMIT);
    expect(states.slice(afterFirst).filter((state) => state !== "limited")).toEqual([]);
    expect(said).toHaveLength(1);
    expect(reconnects).toBe(0);

    // Another window closed: this one is let in, and reads everything afresh once.
    await vi.advanceTimersByTimeAsync(LIMITED_RETRY_MS);
    expect(FakeEventSource.all).toHaveLength(3);
    last().answer(HELLO);
    expect(useConnection.getState()).toMatchObject({ state: "open", problem: null });
    expect(reconnects).toBe(1);
    for (const stop of stops) stop();
  });
});
