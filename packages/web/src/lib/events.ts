/**
 * One EventSource for the whole app. Screens subscribe by event type; when
 * the stream comes back after a drop, reconnect listeners run so stores can
 * refetch whatever they missed.
 */
import { useEffect, useRef } from "react";
import { create } from "zustand";
import type { ServerEvent } from "@galley/core/types";
import { EVENTS_URL, buildUrl, reportUnauthorized } from "./api";

export type EventType = ServerEvent["type"];
export type EventOf<T extends EventType> = Extract<ServerEvent, { type: T }>;
export type ConnectionState = "idle" | "connecting" | "open" | "down";

interface ConnectionStore {
  state: ConnectionState;
  /** Epoch ms of the last successful open. */
  openedAt: number | null;
  /** Seconds until the next attempt while down. */
  retryIn: number | null;
}

export const useConnection = create<ConnectionStore>(() => ({ state: "idle", openedAt: null, retryIn: null }));

type AnyHandler = (event: ServerEvent) => void;

const handlers = new Map<EventType, Set<AnyHandler>>();
const reconnectListeners = new Set<() => void>();

let source: EventSource | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;
let hasOpened = false;

const MAX_BACKOFF_MS = 15_000;

/** Delay before reconnect attempt n (0-based): 1 s, 2 s, 4 s … capped at 15 s, with jitter. */
export function backoffDelay(n: number, random: () => number = Math.random): number {
  const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** n);
  return Math.round(base * (0.8 + random() * 0.4));
}

function dispatch(event: ServerEvent): void {
  const set = handlers.get(event.type);
  if (!set) return;
  for (const handler of [...set]) handler(event);
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
  let authenticated: boolean;
  try {
    const response = await fetch(buildUrl("GET /api/meta"), { credentials: "same-origin", headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(String(response.status));
    authenticated = ((await response.json()) as { authenticated?: boolean }).authenticated !== false;
  } catch {
    if (!source && !retryTimer && hasOpened) scheduleRetry();
    return;
  }
  if (source || retryTimer) return;
  if (!authenticated) {
    // Signed out by the restart: the sign-in (or hand-off) screen takes it from here, once.
    disconnectEvents();
    reportUnauthorized();
    return;
  }
  open();
}

/** Coming back to the window, or the network returning: try now instead of waiting out the backoff. */
function retryNow(): void {
  if (!retryTimer) return;
  clearTimeout(retryTimer);
  void probe();
}
const host = globalThis as { addEventListener?: (type: string, listener: () => void) => void };
host.addEventListener?.("focus", retryNow);
host.addEventListener?.("online", retryNow);

function open(): void {
  retryTimer = null;
  useConnection.setState({ state: hasOpened ? "down" : "connecting" });
  const es = new EventSource(EVENTS_URL, { withCredentials: true });
  source = es;

  es.onopen = () => {
    const wasReconnect = hasOpened;
    hasOpened = true;
    attempt = 0;
    useConnection.setState({ state: "open", openedAt: Date.now(), retryIn: null });
    if (wasReconnect) for (const listener of [...reconnectListeners]) listener();
  };

  es.onmessage = (message) => {
    let event: ServerEvent;
    try {
      event = JSON.parse(String(message.data)) as ServerEvent;
    } catch {
      return;
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

/** Open the stream. Safe to call more than once. */
export function connectEvents(): void {
  if (source || retryTimer) return;
  open();
}

/** Close the stream (sign-out). */
export function disconnectEvents(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  source?.close();
  source = null;
  hasOpened = false;
  attempt = 0;
  useConnection.setState({ state: "idle", retryIn: null });
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
