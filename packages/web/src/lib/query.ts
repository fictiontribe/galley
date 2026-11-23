/**
 * A small shared cache for server data.
 *
 * Keys are arrays — ["site", siteId, "history"]. Screens that ask for the
 * same key share one request and one result. `invalidate(prefix)` marks every
 * key that starts with the prefix as stale and refetches the ones on screen,
 * keeping the old data visible meanwhile (no skeleton flash). `sync.ts` maps
 * server events to invalidations, so data refreshes when the server says so.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

export type QueryKey = readonly (string | number | boolean | null)[];
export type QueryStatus = "idle" | "loading" | "success" | "error";

export interface QueryState<T> {
  status: QueryStatus;
  data: T | undefined;
  error: unknown;
  /** A request is in flight (first load or background refresh). */
  fetching: boolean;
  /** Epoch ms of the last successful fetch. */
  updatedAt: number;
}

interface Entry {
  key: QueryKey;
  state: QueryState<unknown>;
  fetcher: (() => Promise<unknown>) | null;
  listeners: Set<() => void>;
  /** Increments per request; only the latest request may write its result. */
  ticket: number;
  stale: boolean;
  /** Extra prefixes that, when invalidated, also refresh this entry. */
  deps: QueryKey[];
  /** The request in flight, shared by everyone asking meanwhile. */
  inflight: Promise<unknown> | null;
}

const IDLE: QueryState<unknown> = { status: "idle", data: undefined, error: undefined, fetching: false, updatedAt: 0 };

const cache = new Map<string, Entry>();

export function hashKey(key: QueryKey): string {
  return JSON.stringify(key);
}

/** Whether `key` starts with every element of `prefix`. */
export function matchesPrefix(key: QueryKey, prefix: QueryKey): boolean {
  if (prefix.length > key.length) return false;
  return prefix.every((part, index) => key[index] === part);
}

function entryFor(key: QueryKey): Entry {
  const hash = hashKey(key);
  let entry = cache.get(hash);
  if (!entry) {
    entry = { key, state: IDLE, fetcher: null, listeners: new Set(), ticket: 0, stale: true, deps: [], inflight: null };
    cache.set(hash, entry);
  }
  return entry;
}

function write(entry: Entry, patch: Partial<QueryState<unknown>>): void {
  entry.state = { ...entry.state, ...patch };
  for (const listener of [...entry.listeners]) listener();
}

function run(entry: Entry): Promise<unknown> {
  const fetcher = entry.fetcher;
  if (!fetcher) return Promise.resolve(entry.state.data);
  const ticket = ++entry.ticket;
  entry.stale = false;
  write(entry, { fetching: true, status: entry.state.status === "success" ? "success" : "loading" });
  const request = fetcher().then(
    (data) => {
      if (ticket === entry.ticket) write(entry, { status: "success", data, error: undefined, fetching: false, updatedAt: Date.now() });
      return data;
    },
    (error: unknown) => {
      if (ticket === entry.ticket) {
        // A failed background refresh keeps the last good data on screen.
        write(entry, { status: entry.state.data === undefined ? "error" : "success", error, fetching: false });
      }
      throw error;
    },
  );
  entry.inflight = request;
  const clear = () => {
    if (entry.inflight === request) entry.inflight = null;
  };
  request.then(clear, clear);
  return request;
}

/** Fetch (or reuse fresh data) outside React. */
export function fetchQuery<T>(key: QueryKey, fetcher: () => Promise<T>): Promise<T> {
  const entry = entryFor(key);
  entry.fetcher = fetcher;
  if (entry.inflight && !entry.stale) return entry.inflight as Promise<T>;
  if (!entry.stale && entry.state.status === "success") return Promise.resolve(entry.state.data as T);
  return run(entry) as Promise<T>;
}

export function getQueryState<T>(key: QueryKey): QueryState<T> {
  return (cache.get(hashKey(key))?.state ?? IDLE) as QueryState<T>;
}

/** Replace cached data (after a mutation that returned the new value). */
export function setQueryData<T>(key: QueryKey, data: T): void {
  const entry = entryFor(key);
  entry.ticket++;
  entry.stale = false;
  entry.inflight = null;
  write(entry, { status: "success", data, error: undefined, fetching: false, updatedAt: Date.now() });
}

export function subscribeQuery(key: QueryKey, listener: () => void): () => void {
  const entry = entryFor(key);
  entry.listeners.add(listener);
  return () => entry.listeners.delete(listener);
}

/**
 * Mark everything under `prefix` stale. Entries someone is watching refetch
 * now; the rest refetch when next used. Returns how many entries matched.
 */
export function invalidate(prefix: QueryKey = []): number {
  let matched = 0;
  for (const entry of cache.values()) {
    const hit = matchesPrefix(entry.key, prefix) || entry.deps.some((dep) => matchesPrefix(dep, prefix) || matchesPrefix(prefix, dep));
    if (!hit) continue;
    matched++;
    entry.stale = true;
    if (entry.listeners.size > 0 && entry.fetcher) run(entry).catch(() => undefined);
  }
  return matched;
}

/** Forget everything (sign-out, tests). */
export function clearQueries(): void {
  cache.clear();
}

export interface QueryOptions {
  /** Don't fetch while false (e.g. a required id is still missing). */
  enabled?: boolean;
  /**
   * Key prefixes this query also depends on: invalidating any of them
   * refreshes it too. E.g. a site-home summary depending on
   * ["site", id, "changes"].
   */
  deps?: QueryKey[];
}

export interface QueryResult<T> extends QueryState<T> {
  /** First load with nothing to show yet — render a skeleton. */
  loading: boolean;
  refetch: () => Promise<T | undefined>;
}

/** Read a key, fetching when it is missing or stale. */
export function useQuery<T>(key: QueryKey, fetcher: () => Promise<T>, options: QueryOptions = {}): QueryResult<T> {
  const { enabled = true, deps } = options;
  const hash = hashKey(key);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const subscribe = useCallback((listener: () => void) => subscribeQuery(JSON.parse(hash) as QueryKey, listener), [hash]);
  const getSnapshot = useCallback(() => getQueryState<T>(JSON.parse(hash) as QueryKey), [hash]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const depsHash = deps ? JSON.stringify(deps) : "";
  useEffect(() => {
    if (!enabled) return;
    const entry = entryFor(JSON.parse(hash) as QueryKey);
    entry.fetcher = () => fetcherRef.current();
    entry.deps = depsHash ? (JSON.parse(depsHash) as QueryKey[]) : [];
    if (!entry.inflight && (entry.stale || entry.state.status === "idle" || entry.state.status === "error")) {
      run(entry).catch(() => undefined);
    }
  }, [hash, enabled, depsHash]);

  const refetch = useCallback(async () => {
    const entry = entryFor(JSON.parse(hash) as QueryKey);
    entry.fetcher = () => fetcherRef.current();
    try {
      return (await run(entry)) as T;
    } catch {
      return undefined;
    }
  }, [hash]);

  return {
    ...state,
    loading: enabled && state.data === undefined && state.status !== "error",
    refetch,
  };
}
