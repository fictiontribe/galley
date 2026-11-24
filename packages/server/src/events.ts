import type { Context } from "hono";
import { VERSION } from "@galley/core/brand";
import type { EventBus, ServerEvent } from "@galley/core/types";
import { RateLimitError } from "./errors";
import type { StreamRegistry } from "./types";

export const HEARTBEAT_MS = 20_000;
/** What one stream may hold that its reader hasn't taken yet. Past it the reader isn't reading, and is let go. */
export const MAX_QUEUED_BYTES = 1024 * 1024;
/** Open streams one identity may have where they are counted (a hosted install): a window of the editor is one. */
export const MAX_STREAMS_PER_ACCOUNT = 16;

export function createStreamRegistry(): StreamRegistry {
  const open = new Set<() => void>();
  const owned = new Map<string, number>();

  return {
    add(close, owner) {
      let counted = owner !== undefined;

      open.add(close);
      if (owner !== undefined) owned.set(owner, (owned.get(owner) ?? 0) + 1);
      return () => {
        open.delete(close);
        if (owner === undefined || !counted) return;
        counted = false;
        const left = (owned.get(owner) ?? 1) - 1;

        if (left > 0) owned.set(owner, left);
        else owned.delete(owner);
      };
    },
    count(owner) {
      return owned.get(owner) ?? 0;
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
}

/**
 * GET /api/events — the EventBus as Server-Sent Events. One `data:` line of
 * JSON per event, a comment heartbeat so proxies keep the connection open,
 * and the subscription is dropped the moment the client goes away — or stops
 * reading: what is kept for one reader is bounded, and so is how many
 * streams one identity may hold open.
 */
export function eventStream(c: Context, bus: EventBus, streams: StreamRegistry, heartbeatMs = HEARTBEAT_MS, access?: StreamAccess, limits: StreamLimits = {}): Response {
  const max = limits.maxStreams ?? MAX_STREAMS_PER_ACCOUNT;

  if (limits.owner !== undefined && streams.count(limits.owner) >= max) throw new RateLimitError(limits.refusal ?? `Too many event streams are open: ${max} is the limit. Close one of the others first.`);
  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        // This much unread already: the reader has stopped reading. It is let go rather than kept for without end, and its
        // connection is ended so what was waiting is freed. A browser connects again and reads everything afresh.
        if ((controller.desiredSize ?? 0) <= 0) {
          finish();
          (c.env as { outgoing?: { destroy(): void } } | undefined)?.outgoing?.destroy();
          return;
        }
        try {
          controller.enqueue(encoder.encode(chunk));
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

        if (shown) send(`data: ${JSON.stringify(shown)}\n\n`);
      };
      const unsubscribe = bus.subscribe(sendEvent);
      const unwatch = access?.onChange?.(() => {
        if (!access.live()) finish();
      }) ?? (() => {});
      const heartbeat = setInterval(() => send(": heartbeat\n\n"), heartbeatMs);
      const onAbort = () => finish();
      let unregister: () => void = () => {};

      function finish(): void {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        unwatch();
        unregister();
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
    },
    cancel() {
      cleanup?.();
    },
  }, new ByteLengthQueuingStrategy({ highWaterMark: limits.maxQueuedBytes ?? MAX_QUEUED_BYTES }));

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
