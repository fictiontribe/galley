import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStatusMiddleware, probeGalley, statusPaths } from "../src/status.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  const server = createServer(handler);

  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Answers /api/meta the way a Galley server does to a visitor without a session. */
const fakeGalley = (req: IncomingMessage, res: ServerResponse) => {
  if (req.url === "/api/meta") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ version: "", brand: { productName: "Galley", byline: "" }, mode: "local", authenticated: false, desktop: false, platform: "" }));
    return;
  }
  res.statusCode = 404;
  res.end();
};

async function freePort(): Promise<string> {
  const url = await listen(() => {});
  await new Promise((done) => servers.pop()!.close(done));
  return url;
}

describe("probeGalley()", () => {
  it("is true only for a Galley /api/meta answer", async () => {
    expect(await probeGalley(await listen(fakeGalley))).toBe(true);
    expect(await probeGalley(await listen((_req, res) => res.end("<!doctype html><p>another app</p>")))).toBe(false);
    expect(await probeGalley(await listen((_req, res) => res.end(JSON.stringify({ brand: "x" }))))).toBe(false);
    expect(await probeGalley(await listen((_req, res) => ((res.statusCode = 500), res.end())))).toBe(false);
    expect(await probeGalley(await freePort())).toBe(false);
    expect(await probeGalley("not a url")).toBe(false);
  });

  it("gives up after its timeout when nothing answers", async () => {
    const hanging = await listen(() => {});
    const started = Date.now();

    expect(await probeGalley(hanging, { timeoutMs: 200 })).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("createStatusMiddleware()", () => {
  async function devServer(options: Parameters<typeof createStatusMiddleware>[0]): Promise<string> {
    const middleware = createStatusMiddleware(options);

    return listen((req, res) =>
      middleware(req, res, () => {
        res.statusCode = 418;
        res.end("passed on");
      })
    );
  }

  it("answers { running, url, root } and nothing else, never cached by the browser", async () => {
    const galley = await listen(fakeGalley);
    const dev = await devServer({ url: galley, root: "/projects/studio" });
    const response = await fetch(`${dev}/__galley/status`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(await response.json()).toEqual({ running: true, url: galley, root: "/projects/studio" });
  });

  it("says not running when nothing listens", async () => {
    const url = await freePort();
    const dev = await devServer({ url, root: "/projects/studio" });

    expect(await (await fetch(`${dev}/__galley/status?t=1`)).json()).toEqual({ running: false, url, root: "/projects/studio" });
  });

  it("passes every other request on, and refuses other methods", async () => {
    const dev = await devServer({ url: "http://127.0.0.1:9", root: "/r", base: "/docs/" });

    expect(await (await fetch(`${dev}/about/`)).text()).toBe("passed on");
    expect(await (await fetch(`${dev}/__galley/status/extra`)).text()).toBe("passed on");
    expect((await fetch(`${dev}/__galley/status`, { method: "POST" })).status).toBe(405);
    expect((await fetch(`${dev}/docs/__galley/status`)).status).toBe(200);
    expect([...statusPaths("/docs/")]).toEqual(["/__galley/status", "/docs/__galley/status"]);
  });

  it("asks Galley at most once per cache period", async () => {
    let clock = 0;
    const probe = vi.fn(async () => true);
    const dev = await devServer({ url: "http://127.0.0.1:9", root: "/r", probe, cacheMs: 1000, now: () => clock });

    await fetch(`${dev}/__galley/status`);
    await fetch(`${dev}/__galley/status`);
    expect(probe).toHaveBeenCalledTimes(1);
    clock = 1500;
    await fetch(`${dev}/__galley/status`);
    expect(probe).toHaveBeenCalledTimes(2);
  });
});
