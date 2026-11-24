/**
 * The app's two channels to its server — `fetch` for /api routes and one
 * `EventSource` for /api/events — answered in the page by the mock server.
 *
 * In-page rather than a service worker: a worker can be stopped by the
 * browser whenever it is idle, which would lose the visitor's work held in
 * memory, and the first visit isn't controlled by it until a reload. The
 * app's own client (src/lib/api.ts, src/lib/events.ts) is unchanged: it
 * calls the globals, and these answer the same way the server does.
 */
import type { ServerEvent } from "@galley/core/types";
import { bufferFrom, type DemoBuffer } from "./buffer";

/** The part of mock/server.ts's MockServer the transport needs. */
export interface DemoServer {
  handle(request: { method: string; url: string; headers: Record<string, string | undefined>; body?: Buffer }): Promise<{ status: number; headers: Record<string, string>; body: string | Uint8Array | null; sse?: boolean }>;
  onEvent(listener: (event: ServerEvent) => void): () => void;
}

/** True for a request the mock answers: this page's own origin, under /api/. */
export function isApiUrl(url: URL, origin: string): boolean {
  return url.origin === origin && (url.pathname === "/api" || url.pathname.startsWith("/api/"));
}

/** The request body as bytes, whatever the app handed `fetch`. */
export async function bodyBytes(body: BodyInit | null | undefined): Promise<DemoBuffer | undefined> {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return bufferFrom(body);
  if (body instanceof ArrayBuffer) return bufferFrom(body);
  if (ArrayBuffer.isView(body)) return bufferFrom(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
  if (body instanceof URLSearchParams) return bufferFrom(body.toString());
  if (typeof (body as Blob).arrayBuffer === "function") return bufferFrom(await (body as Blob).arrayBuffer());
  // FormData and streams: nothing in the app sends them to /api.
  return bufferFrom(await new Response(body).arrayBuffer());
}

export function headerRecord(headers: HeadersInit | undefined): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  if (!headers) return out;
  new Headers(headers).forEach((value, name) => (out[name.toLowerCase()] = value));
  return out;
}

const abortError = () => new DOMException("The request was aborted.", "AbortError");

/** A `fetch` that answers /api from the mock and leaves everything else to the browser. */
export function demoFetch(server: DemoServer, original: typeof fetch, origin: string): typeof fetch {
  return async function fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input instanceof URL ? input.href : input), origin);
    if (!isApiUrl(url, origin)) return original(input, init);
    const signal = init?.signal ?? request?.signal;
    if (signal?.aborted) throw abortError();
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const headers = headerRecord(init?.headers ?? request?.headers);
    const body = init?.body !== undefined ? await bodyBytes(init.body) : request && method !== "GET" && method !== "HEAD" ? bufferFrom(await request.arrayBuffer()) : undefined;
    const answer = await server.handle({ method, url: `${url.pathname}${url.search}`, headers, body: body as unknown as Buffer | undefined });
    if (signal?.aborted) throw abortError();
    const payload = answer.body === null || answer.status === 204 ? null : typeof answer.body === "string" ? answer.body : new Uint8Array(answer.body);
    return new Response(payload, { status: answer.status, headers: answer.headers });
  };
}

type Listener = (event: MessageEvent) => void;

/**
 * An EventSource for /api/events fed by the mock's events; any other address
 * gets the browser's own. It opens on the next tick, as a real one does, and
 * greets with the server's `hello`.
 */
export function demoEventSource(server: DemoServer, Original: typeof EventSource, origin: string): typeof EventSource {
  class DemoEventSource extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 2;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSED = 2;
    readonly url: string;
    readonly withCredentials: boolean;
    readyState = 0;
    onopen: ((event: Event) => void) | null = null;
    onmessage: Listener | null = null;
    onerror: ((event: Event) => void) | null = null;
    private stop: (() => void) | null = null;

    constructor(url: string | URL, init?: EventSourceInit) {
      super();
      this.url = new URL(String(url), origin).href;
      this.withCredentials = Boolean(init?.withCredentials);
      setTimeout(() => {
        if (this.readyState === 2) return;
        this.readyState = 1;
        const opened = new Event("open");
        this.onopen?.(opened);
        this.dispatchEvent(opened);
        this.deliver({ type: "hello", version: "demo" } as ServerEvent);
        this.stop = server.onEvent((event) => this.deliver(event));
      }, 0);
    }

    private deliver(event: ServerEvent): void {
      if (this.readyState !== 1) return;
      const message = new MessageEvent("message", { data: JSON.stringify(event) });
      this.onmessage?.(message);
      this.dispatchEvent(message);
    }

    close(): void {
      this.readyState = 2;
      this.stop?.();
      this.stop = null;
    }
  }

  return new Proxy(Original, {
    construct(target, args: [string | URL, EventSourceInit?]) {
      const url = new URL(String(args[0]), origin);
      return isApiUrl(url, origin) ? new DemoEventSource(args[0], args[1]) : new target(...args);
    },
  });
}
