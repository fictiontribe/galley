// The dev server's HTML interception must take a page however it is written.
// Astro's dev server writes pages as Uint8Array chunks; an earlier version
// turned those into strings, so every previewed page came back as
// "60,33,68,…" instead of HTML.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { interceptHtml, toBuffer } from "../src/visibility/integration.js";

const PAGE = "<!DOCTYPE html><html><head><title>Café</title></head><body><main><h1>Señor — “quoted”</h1></main></body></html>";
let server: Server | null = null;

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

async function serve(write: (res: import("node:http").ServerResponse) => void): Promise<string> {
  server = createServer((_req, res) => {
    interceptHtml(res, async (html: string) => html.replace("</body>", "<!--read--></body>"));
    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    write(res);
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${port}/`);

  return response.text();
}

describe("the dev server's HTML interception", () => {
  it("reads a page written as Uint8Array chunks", async () => {
    const bytes = new TextEncoder().encode(PAGE);
    const body = await serve((res) => {
      res.write(bytes.subarray(0, 40));
      res.end(bytes.subarray(40));
    });

    expect(body).toBe(PAGE.replace("</body>", "<!--read--></body>"));
    expect(body).not.toMatch(/^\d+,\d+,\d+/);
  });

  it("reads a page written as strings and as Buffers", async () => {
    const asStrings = await serve((res) => {
      res.write(PAGE.slice(0, 30));
      res.end(PAGE.slice(30));
    });
    const asBuffers = await serve((res) => {
      res.end(Buffer.from(PAGE));
    });

    expect(asStrings).toBe(PAGE.replace("</body>", "<!--read--></body>"));
    expect(asBuffers).toBe(asStrings);
  });

  it("turns every kind of chunk into the same bytes", () => {
    const text = "Señor — “quoted”";
    const utf8 = Buffer.from(text);

    expect(toBuffer(utf8)).toBe(utf8);
    expect(toBuffer(new TextEncoder().encode(text)).equals(utf8)).toBe(true);
    expect(toBuffer(new Uint8Array(utf8).buffer).equals(utf8)).toBe(true);
    expect(toBuffer(text).equals(utf8)).toBe(true);
    expect(toBuffer("café", "latin1").equals(Buffer.from([0x63, 0x61, 0x66, 0xe9]))).toBe(true);
    // A view over part of a larger buffer keeps to its own bytes.
    const padded = new Uint8Array([1, 2, ...utf8, 3]);

    expect(toBuffer(padded.subarray(2, 2 + utf8.length)).equals(utf8)).toBe(true);
  });
});
