import type { Context } from "hono";
import { VERSION } from "@galley/core/brand";
import type { EventBus, ServerEvent } from "@galley/core/types";
import type { StreamRegistry } from "./types";

export const HEARTBEAT_MS = 20_000;

export function createStreamRegistry(): StreamRegistry {
  const open = new Set<() => void>();

  return {
    add(close) {
      open.add(close);
      return () => open.delete(close);
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

/**
 * GET /api/events — the EventBus as Server-Sent Events. One `data:` line of
 * JSON per event, a comment heartbeat so proxies keep the connection open,
 * and the subscription is dropped the moment the client goes away.
 */
export function eventStream(c: Context, bus: EventBus, streams: StreamRegistry, heartbeatMs = HEARTBEAT_MS, access?: StreamAccess): Response {
  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
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
      unregister = streams.add(finish);
      c.req.raw.signal?.addEventListener("abort", onAbort);
      // One chunk, so the very first read a client makes already holds the hello.
      send(`retry: 3000\ndata: ${JSON.stringify({ type: "hello", version: VERSION } satisfies ServerEvent)}\n\n`);
    },
    cancel() {
      cleanup?.();
    },
  });

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
