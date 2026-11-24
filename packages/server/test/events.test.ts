import { describe, expect, it } from "vitest";
import { createStreamRegistry, MAX_QUEUED_BYTES, MAX_STREAMS_PER_ACCOUNT } from "../src/events";
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

  it("ends a stream whose reader has stopped reading, once what waits for it passes the bound, and keeps sending to the others", async () => {
    const events = createBus();
    const streams = createStreamRegistry();
    const { call } = testApp({ events }, { streams });
    const stalled = await call("GET", "/api/events");
    const reading = await call("GET", "/api/events");
    const reader = reading.body!.getReader();
    const sink = { text: "" };
    let open = true;
    // One reader keeps up; the other's response is never read.
    const pump = (async () => {
      const decoder = new TextDecoder();

      for (;;) {
        const { value, done } = await reader.read();

        if (done) break;
        sink.text += decoder.decode(value, { stream: true });
      }
      open = false;
    })();

    expect(streams.size).toBe(2);
    const page = "x".repeat(8 * 1024);
    const needed = Math.ceil(MAX_QUEUED_BYTES / page.length) + 8;

    for (let sent = 0; sent < needed; sent += 1) {
      events.emit({ type: "changes.updated", siteId: "site-1", paths: [`${sent}-${page}`], origin: "user" });
      // The reader that keeps up gets its turn between events.
      await new Promise((resolve) => setImmediate(resolve));
    }
    events.emit({ type: "site.updated", siteId: "the-last-one" });
    await readUntil(reader, /the-last-one/, sink).catch(() => undefined);
    for (let waited = 0; waited < 200 && !sink.text.includes("the-last-one"); waited += 1) await new Promise((resolve) => setTimeout(resolve, 5));

    // The stalled one was let go; the other heard every event and is still open.
    expect(streams.size).toBe(1);
    expect(events.listenerCount).toBe(1);
    expect(sink.text.match(/"type":"changes.updated"/g)).toHaveLength(needed);
    expect(sink.text).toContain("the-last-one");
    expect(open).toBe(true);
    // What the stalled reader had waiting is at most the bound and one event more.
    let kept = 0;
    const late = stalled.body!.getReader();

    for (;;) {
      const { value, done } = await late.read();

      if (done) break;
      kept += value.byteLength;
    }
    expect(kept).toBeGreaterThan(MAX_QUEUED_BYTES);
    expect(kept).toBeLessThan(MAX_QUEUED_BYTES + 2 * page.length);
    await reader.cancel();
    await pump;
    expect(streams.size).toBe(0);
  });

  it("doesn't count streams in local mode: one person, one computer", async () => {
    const streams = createStreamRegistry();
    const { call } = testApp({}, { streams });
    const responses = await Promise.all(Array.from({ length: MAX_STREAMS_PER_ACCOUNT + 4 }, () => call("GET", "/api/events")));

    expect(responses.map((response) => response.status)).toEqual(responses.map(() => 200));
    expect(streams.size).toBe(MAX_STREAMS_PER_ACCOUNT + 4);
    await Promise.all(responses.map((response) => response.body!.cancel()));
    expect(streams.size).toBe(0);
  });

  it("counts the streams of each identity apart, and gives a place back when one ends", () => {
    const streams = createStreamRegistry();
    const first = streams.add(() => {}, "account:a");

    streams.add(() => {}, "account:a");
    streams.add(() => {}, "account:b");
    streams.add(() => {});
    expect([streams.count("account:a"), streams.count("account:b"), streams.count("nobody"), streams.size]).toEqual([2, 1, 0, 4]);
    first();
    // Taken off once, however often it is asked.
    first();
    expect([streams.count("account:a"), streams.size]).toEqual([1, 3]);
  });
});
