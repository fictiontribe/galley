/**
 * One EventSource for the whole app. Screens subscribe by event type; when
 * the stream comes back after a drop, reconnect listeners run so stores can
 * refetch whatever they missed.
 *
 * A dropped stream is asked for again only while someone is at the window.
 * A while after it was last touched (or put behind another), the asking
 * stops, and starts again the moment the person is back: a window left open
 * doesn't keep a laptop's network awake for a server it can't reach, and a
 * server that restarted isn't knocked on by every window nobody is looking at.
 */
import { useEffect, useRef } from "react";
import { create } from "zustand";
import type { ServerEvent } from "@galley/core/types";
import { EVENTS_URL, buildUrl, reportUnauthorized } from "./api";

export type EventType = ServerEvent["type"];
export type EventOf<T extends EventType> = Extract<ServerEvent, { type: T }>;
/**
 * "limited": the server answered, and said this account has every stream it may have open (too many windows).
 * "resting": the stream dropped and nobody has been at this window for a while, so it isn't being asked for until they are back.
 */
export type ConnectionState = "idle" | "connecting" | "open" | "down" | "limited" | "resting";

interface ConnectionStore {
  state: ConnectionState;
  /** Epoch ms of the last successful open. */
  openedAt: number | null;
  /** Seconds until the next attempt while down. */
  retryIn: number | null;
  /** While limited: what the server said, in words to show. */
  problem: string | null;
}

export const useConnection = create<ConnectionStore>(() => ({ state: "idle", openedAt: null, retryIn: null, problem: null }));

type AnyHandler = (event: ServerEvent) => void;

const handlers = new Map<EventType, Set<AnyHandler>>();
const reconnectListeners = new Set<() => void>();

let source: EventSource | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;
let hasOpened = false;

const MAX_BACKOFF_MS = 15_000;
/** How long to wait before asking again once the server said the account has too many streams open. */
export const LIMITED_RETRY_MS = 30_000;
/** The last stream was refused for the account's limit: asking again is quiet until one is let in. */
let limited = false;
/**
 * How long after the window was last touched a dropped stream is still asked
 * for. Long enough that a restart heals unnoticed in front of someone reading
 * without touching anything; short enough that a window left open asks a
 * couple of dozen times and then not at all.
 */
export const REST_AFTER_MS = 5 * 60_000;
/** When someone was last at this window: it was loaded, pressed, clicked, scrolled, pointed at or brought to the front. */
let lastHere = Date.now();
/** The stream is down and isn't being asked for: nobody is at the window. */
let resting = false;

/** Delay before reconnect attempt n (0-based): 1 s, 2 s, 4 s … capped at 15 s, with jitter. */
export function backoffDelay(n: number, random: () => number = Math.random): number {
  const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** n);
  return Math.round(base * (0.8 + random() * 0.4));
}

/** Handlers that have failed once: each is said once, not at every event. */
const failedHandlers = new WeakSet<AnyHandler>();

function dispatch(event: ServerEvent): void {
  const set = handlers.get(event.type);
  if (!set) return;
  for (const handler of [...set]) {
    try {
      handler(event);
    } catch (error) {
      // One handler that fails must not keep the event from the others.
      if (!failedHandlers.has(handler)) console.error(`A handler for “${event.type}” events failed`, error);
      failedHandlers.add(handler);
    }
  }
}

/**
 * What an addition (src/additions) has carried on the stream's address for
 * its server half, by its id: `/api/events?x-<id>=<value>`. With none, the
 * stream is opened exactly as it always was.
 */
type StreamValue = () => Promise<string | null> | string | null;
const streamValues = new Map<string, StreamValue>();
/** How long a value may take. Past it the stream opens without: there is one stream, and one slow addition must not hold it. */
export const STREAM_VALUE_MS = 2000;
/** The least time between two streams opened only because a value changed. */
export const STREAM_REOPEN_MS = 5000;
const ADDITION_ID = /^[a-z][a-z0-9-]{2,31}$/;
const VALUE = /^[A-Za-z0-9._~-]{1,128}$/;
/** A value is being waited for before the stream opens. */
let opening = false;
/** Counts opens and closes: an answer that arrives for an older one is dropped. */
let generation = 0;
let reopenTimer: ReturnType<typeof setTimeout> | null = null;
let reopenedAt = -Infinity;

async function valueOf(id: string, value: StreamValue): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answer = await Promise.race([Promise.resolve().then(value), new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), STREAM_VALUE_MS)))]);
    if (answer === null) return null;
    if (typeof answer === "string" && VALUE.test(answer)) return answer;
    console.error(`The stream's value for “${id}” isn't usable: it is 1 to 128 letters, digits, dots, dashes, underscores or tildes.`);
    return null;
  } catch (error) {
    console.error(`The stream's value for “${id}” couldn't be worked out`, error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The stream's address with every addition's value on it. */
async function eventsUrl(): Promise<string> {
  const carried = (await Promise.all([...streamValues].map(async ([id, value]) => [id, await valueOf(id, value)] as const))).filter((entry): entry is readonly [string, string] => entry[1] !== null);
  // A value's characters need no encoding.
  return carried.length ? `${EVENTS_URL}?${carried.map(([id, value]) => `x-${id}=${value}`).join("&")}` : EVENTS_URL;
}

/**
 * The stream is open and what it should carry has changed: it is closed and
 * opened again, soon, and not more often than every few seconds however
 * often that is asked. Nothing is shown; what was missed meanwhile is
 * fetched as after any drop.
 */
function reopenSoon(): void {
  if (reopenTimer || (!source && !opening)) return;
  reopenTimer = setTimeout(() => {
    reopenTimer = null;
    if (!source && !opening) return;
    reopenedAt = Date.now();
    generation += 1;
    opening = false;
    source?.close();
    source = null;
    open(true);
  }, Math.max(0, reopenedAt + STREAM_REOPEN_MS - Date.now()));
}

/**
 * Has the stream carry a value for the extension `id`, worked out each time
 * the stream opens (null: none this time). Returns how to take it off again.
 * Setting one while the stream is open opens the stream again with it.
 */
export function setStreamValue(id: string, value: StreamValue): () => void {
  if (!ADDITION_ID.test(id)) throw new Error(`“${id}” isn't an extension's id.`);
  streamValues.set(id, value);
  reopenSoon();
  return () => {
    if (streamValues.get(id) !== value) return;
    streamValues.delete(id);
    reopenSoon();
  };
}

function scheduleRetry(): void {
  const delay = backoffDelay(attempt++);
  useConnection.setState({ state: "down", retryIn: Math.ceil(delay / 1000) });
  retryTimer = setTimeout(() => void probe(), delay);
}

/**
 * Before reopening the stream, ask the server whether it is back and whether
 * this browser is still signed in. An EventSource can't see a 401: a server
 * that restarted with a new session would otherwise be retried forever.
 */
async function probe(): Promise<void> {
  retryTimer = null;
  if (rests()) return;
  let authenticated: boolean;
  try {
    const response = await fetch(buildUrl("GET /api/meta"), { credentials: "same-origin", headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(String(response.status));
    authenticated = ((await response.json()) as { authenticated?: boolean }).authenticated !== false;
  } catch {
    if (!source && !retryTimer && !opening && hasOpened) scheduleRetry();
    return;
  }
  if (source || retryTimer || opening) return;
  if (!authenticated) {
    // Signed out by the restart: the sign-in (or hand-off) screen takes it from here, once.
    disconnectEvents();
    reportUnauthorized();
    return;
  }
  open();
}

/**
 * Nobody has been at this window for a while: the stream isn't asked for
 * again until they are back. True when it rests. A window told there are too
 * many open keeps saying so; any other says it is resting.
 */
function rests(): boolean {
  if (Date.now() - lastHere < REST_AFTER_MS) return false;
  resting = true;
  if (!limited) useConnection.setState({ state: "resting", retryIn: null });
  return true;
}

/** Someone is at the window. If the stream was resting, it is asked for now, from the shortest wait again. */
function here(): void {
  lastHere = Date.now();
  if (!resting) return;
  resting = false;
  attempt = 0;
  if (!limited) useConnection.setState({ state: "down", retryIn: null });
  void probe();
}

/** Coming back to the window, or the network returning: try now instead of waiting out the backoff. */
function retryNow(): void {
  if (!retryTimer) return;
  clearTimeout(retryTimer);
  void probe();
}

type Listen = (type: string, listener: () => void, options?: { passive?: boolean; capture?: boolean }) => void;
const host = globalThis as { addEventListener?: Listen; document?: { addEventListener?: Listen; visibilityState?: string } };
/** What a person at the window does. Each only notes the time, and wakes a resting stream. */
export const SIGNS_OF_SOMEONE = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "focus", "pageshow"] as const;
for (const type of SIGNS_OF_SOMEONE) host.addEventListener?.(type, here, { passive: true, capture: true });
// Brought back in front of another tab or window. Going behind one is not a sign of anyone.
host.document?.addEventListener?.("visibilitychange", () => {
  if (host.document?.visibilityState === "visible") here();
});
host.addEventListener?.("focus", retryNow);
host.addEventListener?.("online", retryNow);

function open(quiet = false): void {
  retryTimer = null;
  resting = false;
  // Asking again after being told there are too many windows changes nothing on the screen until the server lets this one in.
  if (!limited && !quiet) useConnection.setState({ state: hasOpened ? "down" : "connecting" });
  if (streamValues.size === 0) {
    openAt(EVENTS_URL);
    return;
  }
  const mine = (generation += 1);

  opening = true;
  void eventsUrl().then((url) => {
    // Closed, or asked for again, while the values were being worked out.
    if (mine !== generation) return;
    opening = false;
    openAt(url);
  });
}

function openAt(url: string): void {
  const es = new EventSource(url, { withCredentials: true });
  source = es;

  const opened = () => {
    const wasReconnect = hasOpened;
    hasOpened = true;
    attempt = 0;
    useConnection.setState({ state: "open", openedAt: Date.now(), retryIn: null, problem: null });
    if (wasReconnect) for (const listener of [...reconnectListeners]) listener();
  };

  es.onopen = () => {
    // A stream that is about to say "too many windows" opens too: after one such answer, wait for the first real event.
    if (!limited) opened();
  };

  es.onmessage = (message) => {
    let event: ServerEvent;
    try {
      event = JSON.parse(String(message.data)) as ServerEvent;
    } catch {
      return;
    }
    if (event.type === "stream.limit") {
      // The server ends the stream after this. Said once; asked again every so often, and at once on coming back to the window.
      const first = !limited;

      limited = true;
      es.close();
      if (source !== es) return;
      source = null;
      attempt = 0;
      useConnection.setState({ state: "limited", retryIn: null, problem: event.message });
      retryTimer = setTimeout(() => void probe(), LIMITED_RETRY_MS);
      if (first) dispatch(event);
      return;
    }
    if (limited) {
      limited = false;
      opened();
    }
    dispatch(event);
  };

  // EventSource retries by itself only for some failures; owning the retry
  // gives one backoff policy and a visible "reconnecting" state.
  es.onerror = () => {
    es.close();
    if (source !== es) return;
    source = null;
    scheduleRetry();
  };
}

/** Open the stream. Safe to call more than once. Asking for it counts as someone being here. */
export function connectEvents(): void {
  if (source || retryTimer || opening) return;
  lastHere = Date.now();
  open();
}

/** Close the stream (sign-out). */
export function disconnectEvents(): void {
  if (retryTimer) clearTimeout(retryTimer);
  if (reopenTimer) clearTimeout(reopenTimer);
  retryTimer = reopenTimer = null;
  generation += 1;
  opening = false;
  source?.close();
  source = null;
  hasOpened = false;
  attempt = 0;
  limited = false;
  resting = false;
  useConnection.setState({ state: "idle", retryIn: null, problem: null });
}

/** Listen for one event type. Returns the unsubscribe function. */
export function subscribe<T extends EventType>(type: T, handler: (event: EventOf<T>) => void): () => void {
  let set = handlers.get(type);
  if (!set) {
    set = new Set();
    handlers.set(type, set);
  }
  const wrapped = handler as AnyHandler;
  set.add(wrapped);
  return () => set.delete(wrapped);
}

/**
 * Listen for one event of an extension's own (`source` is its id). The
 * server's word that it didn't take this window's value arrives as the name
 * "stream.refused", with `{ code, message }` as its payload.
 */
export function subscribeExtension(id: string, name: string, handler: (event: { siteId: string; payload: unknown }) => void): () => void {
  return subscribe("extension", (event) => {
    if (event.source === id && event.name === name) handler({ siteId: event.siteId, payload: event.payload });
  });
}

/** Run after the stream reconnects following a drop. */
export function onReconnect(listener: () => void): () => void {
  reconnectListeners.add(listener);
  return () => reconnectListeners.delete(listener);
}

/** Subscribe for the lifetime of a component. The handler may change between renders. */
export function useServerEvent<T extends EventType>(type: T, handler: (event: EventOf<T>) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribe(type, (event) => ref.current(event)), [type]);
}
