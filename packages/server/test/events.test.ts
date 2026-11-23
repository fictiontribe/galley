import { describe, expect, it } from "vitest";
import { createStreamRegistry } from "../src/events";
import { createBus, testApp, TOKEN } from "./helpers";

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, pattern: RegExp, sink: { text: string }): Promise<string> {
  const decoder = new TextDecoder();

  while (!pattern.test(sink.text)) {
    const { value, done } = await reader.read();

    if (done) break;
    sink.text += decoder.decode(value, { stream: true });
  }
  return sink.text;
}

describe("GET /api/events", () => {
  it("requires a session", async () => {
    const { raw } = testApp();

    expect((await raw("GET", "/api/events")).status).toBe(401);
  });

  it("starts with hello, forwards emitted events, and unsubscribes on disconnect", async () => {
    const events = createBus();
    const { call } = testApp({ events });
    const response = await call("GET", "/api/events");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/event-stream/);
    expect(response.headers.get("cache-control")).toMatch(/no-cache/);
    const reader = response.body!.getReader();
    const sink = { text: "" };

    await readUntil(reader, /"type":"hello"/, sink);
    expect(sink.text).toMatch(/data: \{"type":"hello","version":"[^"]+"\}\n\n/);
    expect(events.listenerCount).toBe(1);

    events.emit({ type: "changes.updated", siteId: "site-1", paths: ["a.md"], origin: "user" });
    await readUntil(reader, /changes\.updated/, sink);
    expect(sink.text).toContain('data: {"type":"changes.updated","siteId":"site-1","paths":["a.md"],"origin":"user"}\n\n');

    await reader.cancel();
    expect(events.listenerCount).toBe(0);
  });

  it("unsubscribes when the request is aborted", async () => {
    const events = createBus();
    const { app } = testApp({ events });
    const controller = new AbortController();
    const response = await app.request("/api/events", { headers: { authorization: `Bearer ${TOKEN}` }, signal: controller.signal });

    expect(events.listenerCount).toBe(1);
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events.listenerCount).toBe(0);
    await response.body?.cancel().catch(() => {});
  });

  it("sends a comment heartbeat", async () => {
    const { call } = testApp({}, { heartbeatMs: 20 });
    const response = await call("GET", "/api/events");
    const reader = response.body!.getReader();
    const sink = { text: "" };

    await readUntil(reader, /: heartbeat\n\n/, sink);
    expect(sink.text).toContain(": heartbeat\n\n");
    await reader.cancel();
  });

  it("closeAll ends every open stream", async () => {
    const events = createBus();
    const streams = createStreamRegistry();
    const { call } = testApp({ events }, { streams });
    const response = await call("GET", "/api/events");
    const reader = response.body!.getReader();

    await readUntil(reader, /hello/, { text: "" });
    expect(streams.size).toBe(1);
    streams.closeAll();
    let done = false;

    while (!done) done = (await reader.read()).done;
    expect(events.listenerCount).toBe(0);
    expect(streams.size).toBe(0);
  });
});
