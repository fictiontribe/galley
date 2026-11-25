/**
 * The tests' own set-up (test/setup.ts): no request a test makes rides a
 * connection kept from the one before. Held with a plain server that counts
 * the connections it is given.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("a request made by a test", () => {
  let server: http.Server;
  let origin = "";
  let connections = 0;
  const seen: Array<string | undefined> = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      seen.push(req.headers.connection);
      res.end("ok");
    });
    server.on("connection", () => (connections += 1));
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise((done) => server.close(done)));

  it("opens a connection of its own, however it is made, and keeps a header the test set itself", async () => {
    await (await fetch(`${origin}/a`)).text();
    await (await fetch(`${origin}/b`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).text();
    await (await fetch(new Request(`${origin}/c`, { headers: { authorization: "Bearer x" } }))).text();
    await (await fetch(new URL(`${origin}/d`))).text();

    expect(seen).toEqual(["close", "close", "close", "close"]);
    expect(connections).toBe(4);
    await (await fetch(`${origin}/e`, { headers: { connection: "keep-alive" } })).text();
    expect(seen.at(-1)).toBe("keep-alive");
  });
});
