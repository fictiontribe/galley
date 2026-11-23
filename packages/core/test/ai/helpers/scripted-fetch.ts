/**
 * A scripted `fetch` for the real Anthropic SDK: each request is recorded
 * (URL, headers, parsed JSON body) and answered by the next scripted step —
 * usually a Server-Sent-Events stream authored with `sse()`.
 */
import Anthropic from "@anthropic-ai/sdk";

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

export type Step = (request: RecordedRequest, signal: AbortSignal | null) => Response | Promise<Response>;

export function scriptedFetch(steps: Step[]) {
  const requests: RecordedRequest[] = [];
  const queue = [...steps];
  const fetchImpl = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};

    new Headers(init.headers as ConstructorParameters<typeof Headers>[0]).forEach((value, key) => {
      headers[key] = value;
    });
    const text = typeof init.body === "string" ? init.body : "";
    let body: any = null;

    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    const recorded = { url, method: init.method ?? "GET", headers, body };

    requests.push(recorded);
    const step = queue.shift();

    if (!step) throw new Error(`No scripted response left for request #${requests.length} to ${url}`);
    return step(recorded, init.signal ?? null);
  };

  return { fetch: fetchImpl as typeof fetch, requests, remaining: () => queue.length, push: (...more: Step[]) => void queue.push(...more) };
}

export const TEST_KEY = "sk-ant-test-0123456789abcdefSECRET";

export function testClient(fetchImpl: typeof fetch): Anthropic {
  // A fixed base URL and no auth token, so nothing in the machine's environment
  // (ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN) changes what the tests see.
  return new Anthropic({ apiKey: TEST_KEY, authToken: null, baseURL: "https://api.anthropic.com", fetch: fetchImpl, maxRetries: 0 });
}

// ─────────────────────────────────────────────────────────── SSE authoring

export type BlockSpec =
  | { type: "text"; text: string; chunks?: number }
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "tool_use"; id: string; name: string; input: unknown; chunks?: number; rawJson?: string }
  | { type: "fallback"; from: string; to: string }
  | { type: "compaction"; content: string };

export interface MessageSpec {
  id?: string;
  model?: string;
  content: BlockSpec[];
  stop_reason: string;
  stop_details?: unknown;
  usage?: Partial<{ input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }>;
  iterations?: unknown[];
  /** Emit an SSE `error` event (e.g. overloaded) after this many content blocks. */
  errorAfterBlocks?: { blocks: number; error: { type: string; message: string } };
}

function split(text: string, parts: number): string[] {
  if (parts <= 1 || text.length < parts) return [text];
  const size = Math.ceil(text.length / parts);
  const out: string[] = [];

  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

const event = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

export function sseEvents(spec: MessageSpec): string[] {
  const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...spec.usage };
  const events: string[] = [
    event("message_start", {
      type: "message_start",
      message: {
        id: spec.id ?? `msg_${Math.random().toString(36).slice(2, 10)}`,
        type: "message",
        role: "assistant",
        model: spec.model ?? "claude-opus-5-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { ...usage, output_tokens: 1 },
      },
    }),
  ];

  spec.content.forEach((block, index) => {
    if (spec.errorAfterBlocks && index === spec.errorAfterBlocks.blocks) {
      events.push(event("error", { type: "error", error: spec.errorAfterBlocks.error }));
      return;
    }
    if (spec.errorAfterBlocks && index > spec.errorAfterBlocks.blocks) return;
    switch (block.type) {
      case "text":
        events.push(event("content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } }));
        for (const piece of split(block.text, block.chunks ?? 2)) {
          events.push(event("content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: piece } }));
        }
        break;
      case "thinking":
        events.push(event("content_block_start", { type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } }));
        if (block.thinking) events.push(event("content_block_delta", { type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: block.thinking } }));
        events.push(event("content_block_delta", { type: "content_block_delta", index, delta: { type: "signature_delta", signature: block.signature } }));
        break;
      case "tool_use": {
        events.push(event("content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } }));
        const json = block.rawJson ?? JSON.stringify(block.input);

        for (const piece of split(json, block.chunks ?? 3)) {
          events.push(event("content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: piece } }));
        }
        break;
      }
      case "fallback":
        events.push(
          event("content_block_start", {
            type: "content_block_start",
            index,
            content_block: { type: "fallback", from: { model: block.from }, to: { model: block.to }, trigger: { type: "refusal" } },
          })
        );
        break;
      case "compaction":
        events.push(event("content_block_start", { type: "content_block_start", index, content_block: { type: "compaction", content: null, encrypted_content: null } }));
        events.push(event("content_block_delta", { type: "content_block_delta", index, delta: { type: "compaction_delta", content: block.content, encrypted_content: "enc" } }));
        break;
    }
    events.push(event("content_block_stop", { type: "content_block_stop", index }));
  });
  if (spec.errorAfterBlocks && spec.errorAfterBlocks.blocks >= spec.content.length) {
    events.push(event("error", { type: "error", error: spec.errorAfterBlocks.error }));
  }
  events.push(
    event("message_delta", {
      type: "message_delta",
      delta: { stop_reason: spec.stop_reason, stop_sequence: null, ...(spec.stop_details ? { stop_details: spec.stop_details } : {}) },
      usage: { output_tokens: usage.output_tokens, ...(spec.iterations ? { iterations: spec.iterations } : {}) },
    })
  );
  events.push(event("message_stop", { type: "message_stop" }));
  return events;
}

export interface StreamOptions {
  /** Stop sending after this many events and keep the connection open until aborted. */
  hangAfter?: number;
  /** Fail the connection (a network drop) after this many events. */
  breakAfter?: number;
  /** Called when the stream reaches `hangAfter`. */
  onHang?: () => void;
}

export function sseResponse(spec: MessageSpec, signal: AbortSignal | null, options: StreamOptions = {}): Response {
  const events = sseEvents(spec);
  const encoder = new TextEncoder();
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener("abort", () => {
        try {
          controller.error(new DOMException("The operation was aborted.", "AbortError"));
        } catch {
          // already closed
        }
      });
    },
    async pull(controller) {
      if (options.breakAfter !== undefined && sent >= options.breakAfter) {
        controller.error(new TypeError("terminated: other side closed"));
        return;
      }
      if (options.hangAfter !== undefined && sent >= options.hangAfter) {
        options.onHang?.();
        await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve()));
        return;
      }
      const next = events[sent];

      if (next === undefined) {
        controller.close();
        return;
      }
      sent += 1;
      controller.enqueue(encoder.encode(next));
    },
  });

  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

export function stream(spec: MessageSpec, options?: StreamOptions): Step {
  return (_request, signal) => sseResponse(spec, signal, options);
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export function apiError(status: number, type: string, message: string, headers: Record<string, string> = {}): Step {
  return () => jsonResponse(status, { type: "error", error: { type, message } }, headers);
}
