import type { Context } from "hono";
import { VERSION } from "@galley/core/brand";
import type { EventBus, ServerEvent } from "@galley/core/types";
import type { StreamRegistry } from "./types";

export const HEARTBEAT_MS = 20_000;
/** What one stream may hold that its reader hasn't taken yet. Past it the reader isn't reading, and is let go. */
export const MAX_QUEUED_BYTES = 1024 * 1024;
/** Open streams one identity may have where they are counted (a hosted install): a window of the editor is one. */
export const MAX_STREAMS_PER_ACCOUNT = 16;
/** How often, at most, one identity's streams are all ended to find the ones nobody is reading any more. */
export const STREAM_SWEEP_MS = 10 * 60_000;
/** How long a browser told its account has too many streams waits before it asks again. */
export const STREAM_LIMIT_RETRY_MS = 30_000;

export function createStreamRegistry(): StreamRegistry {
  const open = new Set<() => void>();
  const owned = new Map<string, Set<() => void>>();
  const swept = new Map<string, number>();

  return {
    add(close, owner) {
      open.add(close);
      if (owner !== undefined) {
        const mine = owned.get(owner) ?? new Set<() => void>();

        mine.add(close);
        owned.set(owner, mine);
      }
      return () => {
        open.delete(close);
        if (owner === undefined) return;
        const mine = owned.get(owner);

        mine?.delete(close);
        if (mine?.size === 0) owned.delete(owner);
      };
    },
    count(owner) {
      return owned.get(owner)?.size ?? 0;
    },
    sweep(owner, everyMs, now = Date.now()) {
      const last = swept.get(owner);

      if (last !== undefined && now - last < everyMs) return false;
      swept.set(owner, now);
      for (const close of [...(owned.get(owner) ?? [])]) close();
      return true;
    },
    closeAll() {
      for (const close of [...open]) close();
      open.clear();
    },
    get size() {
      return open.size;
    },
  };
}

/**
 * What one listener may hear (a hosted install's signed-in person): checked
 * per event, so a role change applies to the next one, and the stream ends
 * when the person may no longer listen at all.
 */
export interface StreamAccess {
  /** The event as this listener may see it, or null to leave it out. */
  filter(event: ServerEvent): ServerEvent | null;
  /** Whether the listener may still listen (signed in, not switched off or removed). */
  live(): boolean;
  /** Calls back whenever `live` may have changed (a sign-out anywhere). Returns the way to stop. */
  onChange?(listener: () => void): () => void;
}

/** How many streams one identity may hold open, and how far one reader may fall behind. Absent: not counted, and the default bound. */
export interface StreamLimits {
  /** Whose stream this is, where streams are counted per identity. */
  owner?: string;
  /** What that identity is told when it has too many open. */
  refusal?: string;
  maxStreams?: number;
  maxQueuedBytes?: number;
  /** How often, at most, the identity's streams are all ended to make room (default STREAM_SWEEP_MS). */
  sweepEveryMs?: number;
}

/**
 * What else one window's stream is handed: told once the stream really
 * opens (never for one that is told its identity has too many), and what to
 * send that window alone straight afterwards.
 */
export interface StreamHooks {
  /** `close` ends this stream. What is returned runs once when the stream ends, however it ends. */
  opened(close: () => void): () => void;
  /** Events for this window alone, sent as they are: no filter is asked. */
  first(): ServerEvent[];
  /**
   * Asked when this reader already has half of what it may have waiting:
   * true leaves the event out for this reader. For events that may be
   * missed, so that they are never what gets a slow reader let go.
   */
  low?(event: ServerEvent): boolean;
}

/** An extension's event as the line it is sent as: one that goes to many readers unchanged is written out once. */
const lines = new WeakMap<object, string>();

function lineOf(event: ServerEvent): string {
  let line = lines.get(event);

  if (line === undefined) {
    line = `data: ${JSON.stringify(event)}\n\n`;
    lines.set(event, line);
  }
  return line;
}

const STREAM_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};

/**
 * What an identity with every stream it may have is answered: one event
 * that says so, and the end of the stream. A stream and not an error
 * status, because a browser's EventSource can't read the words of a
 * refusal and would only say it lost the connection.
 */
function limitStream(message: string): Response {
  const event: ServerEvent = { type: "stream.limit", message };

  return new Response(`retry: ${STREAM_LIMIT_RETRY_MS}\ndata: ${JSON.stringify(event)}\n\n`, { status: 200, headers: STREAM_HEADERS });
}

/**
 * GET /api/events — the EventBus as Server-Sent Events. One `data:` line of
 * JSON per event, a comment heartbeat so proxies keep the connection open,
 * and the subscription is dropped the moment the client goes away — or stops
 * reading: what is kept for one reader is bounded, and so is how many
 * streams one identity may hold open.
 */
export function eventStream(c: Context, bus: EventBus, streams: StreamRegistry, heartbeatMs = HEARTBEAT_MS, access?: StreamAccess, limits: StreamLimits = {}, hooks?: StreamHooks): Response {
  const max = limits.maxStreams ?? MAX_STREAMS_PER_ACCOUNT;
  const bound = limits.maxQueuedBytes ?? MAX_QUEUED_BYTES;

  // As many open as this identity may have. Some may be windows that went without a word (a laptop closed, a connection
  // dropped behind a proxy), which nothing here can tell from ones still reading. So, once in a while, all of them are
  // ended: the windows still there connect again by themselves, and this one takes a place. Otherwise it is told.
  if (limits.owner !== undefined && streams.count(limits.owner) >= max && !streams.sweep(limits.owner, limits.sweepEveryMs ?? STREAM_SWEEP_MS)) {
    return limitStream(limits.refusal ?? `Too many event streams are open: ${max} is the limit. Close one of the others first.`);
  }
  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      // Room given for one event that is larger than the bound by itself: a reader that keeps up is not let go for it.
      let spare = 0;
      const send = (chunk: string) => {
        if (closed) return;
        const bytes = encoder.encode(chunk);
        const room = controller.desiredSize ?? 0;

        // The reader has caught up since the large one.
        if (room > 0) spare = 0;
        // This much unread already: the reader has stopped reading. It is let go rather than kept for without end, and its
        // connection is ended so what was waiting is freed. A browser connects again and reads everything afresh.
        if (room + spare <= 0) {
          finish();
          (c.env as { outgoing?: { destroy(): void } } | undefined)?.outgoing?.destroy();
          return;
        }
        if (bytes.byteLength > bound) spare = Math.max(spare, bytes.byteLength);
        try {
          controller.enqueue(bytes);
        } catch {
          finish();
        }
      };
      const sendEvent = (event: ServerEvent) => {
        if (access && !access.live()) {
          finish();
          return;
        }
        const shown = access ? access.filter(event) : event;

        if (!shown) return;
        if (hooks?.low && (controller.desiredSize ?? 0) < bound / 2 && hooks.low(shown)) return;
        // The envelope of an extension's event is made once and never changed: sent as it is, it is the same line for every reader.
        send(shown === event && event.type === "extension" ? lineOf(event) : `data: ${JSON.stringify(shown)}\n\n`);
      };
      const unsubscribe = bus.subscribe(sendEvent);
      const unwatch = access?.onChange?.(() => {
        if (!access.live()) finish();
      }) ?? (() => {});
      const heartbeat = setInterval(() => {
        // A listener can stop counting with nothing sent and nobody told (a sign-in passes its age): looked at with every heartbeat.
        if (access && !access.live()) finish();
        else send(": heartbeat\n\n");
      }, heartbeatMs);
      const onAbort = () => finish();
      let unregister: () => void = () => {};
      let ended: (() => void) | undefined;

      function finish(): void {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        unwatch();
        unregister();
        ended?.();
        c.req.raw.signal?.removeEventListener("abort", onAbort);
        try {
          controller.close();
        } catch {
          // Already closed by the client side.
        }
      }

      cleanup = finish;
      unregister = streams.add(finish, limits.owner);
      c.req.raw.signal?.addEventListener("abort", onAbort);
      // One chunk, so the very first read a client makes already holds the hello.
      send(`retry: 3000\ndata: ${JSON.stringify({ type: "hello", version: VERSION } satisfies ServerEvent)}\n\n`);
      // The stream is open: whoever needs to know is told now (never for one that was told there are too many), and once more when it ends.
      if (hooks && !closed) {
        ended = hooks.opened(finish);
        for (const event of hooks.first()) send(`data: ${JSON.stringify(event)}\n\n`);
      }
    },
    cancel() {
      cleanup?.();
    },
  }, new ByteLengthQueuingStrategy({ highWaterMark: bound }));

  return new Response(body, { status: 200, headers: STREAM_HEADERS });
}
