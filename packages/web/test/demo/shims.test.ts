/** The browser stand-ins the mock runs on in the demo: Buffer, and the in-page answers to fetch and EventSource. */
import { describe, expect, it } from "vitest";
import type { ServerEvent } from "@galley/core/types";
import { DemoBuffer, StaticFile, bufferFrom } from "../../demo/shim/buffer";
import { demoEventSource, demoFetch, isApiUrl, type DemoServer } from "../../demo/shim/transport";
import { isSuggested } from "../../demo/assistant";

describe("the demo's Buffer", () => {
  it("does what the mock asks of Node's", () => {
    const text = bufferFrom("Caddow — forty coats");
    expect(text).toBeInstanceOf(DemoBuffer);
    expect(text.toString("utf8")).toBe("Caddow — forty coats");
    expect(bufferFrom(text.toString("base64"), "base64").toString()).toBe("Caddow — forty coats");
    expect(bufferFrom("hi").toString("hex")).toBe("6869");
    expect(bufferFrom("~~~?").toString("base64url")).toBe(Buffer.from("~~~?").toString("base64url"));
    expect(DemoBuffer.concat([bufferFrom("a"), bufferFrom("bc")]).toString()).toBe("abc");
    expect(bufferFrom("abc").equals(bufferFrom("abc"))).toBe(true);
    expect(bufferFrom("abc").equals(bufferFrom("abd"))).toBe(false);
    expect(bufferFrom([0, 0, 1, 2]).readUInt32BE(0)).toBe(258);
    expect((DemoBuffer as unknown as { from: typeof bufferFrom }).from("x").toString()).toBe("x");
    expect(text.subarray(0, 6)).toBeInstanceOf(DemoBuffer);
    expect(text.subarray(0, 6).toString()).toBe("Caddow");
  });

  it("keeps a photograph as its address and size, not its bytes", () => {
    const file = StaticFile.at("/demo/site/images/a.webp", 1200);
    expect(file.length).toBe(1200);
    expect(file.url).toBe("/demo/site/images/a.webp");
  });
});

describe("the in-page transport", () => {
  const origin = "https://galley.example";
  const answers: Array<{ method: string; url: string; body?: string }> = [];
  const listeners = new Set<(event: ServerEvent) => void>();
  const server: DemoServer = {
    async handle({ method, url, body }) {
      answers.push({ method, url, body: body?.toString() });
      return { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ ok: true, url }) };
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  it("answers /api on this origin from the mock and leaves the rest to the browser", async () => {
    expect(isApiUrl(new URL("/api/sites", origin), origin)).toBe(true);
    expect(isApiUrl(new URL("/apis/x", origin), origin)).toBe(false);
    expect(isApiUrl(new URL("https://elsewhere.example/api/sites"), origin)).toBe(false);
    const passed: string[] = [];
    const fetch = demoFetch(server, (async (input: RequestInfo | URL) => (passed.push(String(input)), new Response("site"))) as typeof globalThis.fetch, origin);
    const answer = await fetch("/api/sites/caddow/entry?path=x", { method: "PATCH", body: JSON.stringify({ ops: [] }) });
    expect(await answer.json()).toEqual({ ok: true, url: "/api/sites/caddow/entry?path=x" });
    expect(answers.at(-1)).toEqual({ method: "PATCH", url: "/api/sites/caddow/entry?path=x", body: '{"ops":[]}' });
    expect(await (await fetch("/demo/site/")).text()).toBe("site");
    expect(passed).toEqual(["/demo/site/"]);
  });

  it("refuses an aborted request as the browser does", async () => {
    const fetch = demoFetch(server, globalThis.fetch, origin);
    const controller = new AbortController();
    controller.abort();
    await expect(fetch("/api/meta", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("opens an event stream that greets and then carries the mock's events", async () => {
    class Original {
      constructor(readonly url: string) {}
    }
    const EventSourceInPage = demoEventSource(server, Original as unknown as typeof EventSource, origin);
    const source = new EventSourceInPage("/api/events");
    const seen: string[] = [];
    source.onmessage = (message) => seen.push(JSON.parse(String(message.data)).type);
    await new Promise((resolve) => setTimeout(resolve, 5));
    for (const listener of listeners) listener({ type: "sites.updated" });
    expect(seen).toEqual(["hello", "sites.updated"]);
    source.close();
    expect(new EventSourceInPage("https://elsewhere.example/stream")).toBeInstanceOf(Original);
  });

  it("knows the suggested request however it's typed", () => {
    expect(isSuggested("make the line under the home page heading shorter")).toBe(true);
    expect(isSuggested("Make the line under the home page heading shorter.")).toBe(true);
    expect(isSuggested("Rewrite the home page")).toBe(false);
  });
});
