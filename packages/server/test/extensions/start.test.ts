/**
 * Embedding: starting and stopping. An extension that can't start stops the
 * server's start and leaves nothing running; where there are no accounts
 * the one person on their own computer is the caller.
 */
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { startServer, type ServerOptions } from "../../src";
import { defineExtension } from "../../src/extensions";
import { call, sandbox } from "../hosted-helpers";
import { newProbe, statusExtension } from "./status";

const box = sandbox("extensions-start");

afterAll(() => box.cleanup(), 60_000);

const local = (home: string, extensions: ServerOptions["extensions"], more: Partial<ServerOptions> = {}) =>
  startServer({ port: 0, host: "127.0.0.1", mode: "local", home, sitesDir: join(home, "sites"), webDir: join(box.root, "no-ui"), env: { PATH: process.env.PATH, HOME: box.root }, notice: () => {}, log: () => {}, extensions, ...more });

describe("starting a server with extensions", () => {
  it("a setup that doesn't finish in its time ends the start, is told so, and leaves the process free", async () => {
    let signal: AbortSignal | null = null;
    const stuck = defineExtension({ id: "stuck", setup: (_host, start) => ((signal = start.signal), new Promise<never>(() => {})) });

    await expect(local(box.folder("home"), [stuck], { extensionTimes: { setupMs: 60 } })).rejects.toThrow("Extension “stuck” couldn't start: it didn't finish starting in time");
    expect(signal!.aborted).toBe(true);
    // Nothing of it is left: the next server, extensions and all, starts.
    const probe = newProbe();
    const next = await local(box.folder("home"), [statusExtension(probe)]);

    await next.close({ graceMs: 0 });
  });

  it("a setup that throws, and a wrong declaration, end the start with the extension's name", async () => {
    const stopped: string[] = [];
    const fine = defineExtension({ id: "fine", setup: () => ({ stop: () => void stopped.push("fine") }) });

    await expect(local(box.folder("home"), [fine, defineExtension({ id: "broken", secrets: ["BROKEN_KEY"], setup: () => { throw new Error("no key\nsecond line"); } })])).rejects.toThrow("Extension “broken” couldn't start: no key second line");
    // The one that had started is stopped again.
    expect(stopped).toEqual(["fine"]);
    await expect(local(box.folder("home"), [defineExtension({ id: "levels", setup: () => ({ routes: { "GET /open": { access: "public" as never, handle: () => null } } }) })])).rejects.toThrow("Extension “levels”: the route “GET /open” has no access level. It is edit, publish or manage.");
    await expect(local(box.folder("home"), [fine, fine])).rejects.toThrow("The extension id “fine” isn't usable: two extensions have it.");
    await expect(local(box.folder("home"), [defineExtension({ id: "empty", setup: () => null as never })])).rejects.toThrow("Extension “empty” couldn't start: its setup returned nothing.");
  });

  it("where there are no accounts the caller is the one person at this computer, and there are no people to ask about", async () => {
    const probe = newProbe();
    const server = await local(box.folder("home"), [statusExtension(probe)]);

    try {
      const about = await call(server.port, "GET", "/api/x/status/about", { host: `127.0.0.1:${server.port}`, bearer: server.token! });

      expect([about.status, about.body]).toEqual([200, { mode: "local" }]);
      expect(probe.requests.at(-1)!.caller).toEqual({ kind: "local" });
      expect(probe.host!.people).toBeNull();
      expect(probe.host!.mode).toBe("local");
      // Nobody signed in is nobody here too.
      expect((await call(server.port, "GET", "/api/x/status/about", { host: `127.0.0.1:${server.port}`, headers: { "sec-fetch-site": "same-origin" } })).status).toBe(401);
    } finally {
      await server.close({ graceMs: 0 });
    }
  });

  it("a stop that fails or takes too long doesn't hold the server's own stop", async () => {
    const lines: string[] = [];
    const slow = defineExtension({ id: "slow-stop", setup: () => ({ stop: () => new Promise<void>(() => {}) }) });
    const failing = defineExtension({ id: "failing-stop", setup: () => ({ stop: () => { throw new Error("couldn't tidy"); } }) });
    const server = await local(box.folder("home"), [slow, failing], { extensionTimes: { stopMs: 60 }, log: (line) => void lines.push(line) });

    await server.close({ graceMs: 0 });
    expect(lines.filter((line) => line.includes("its stop failed"))).toEqual(["[failing-stop] its stop failed: couldn't tidy", "[slow-stop] its stop failed: it took too long"]);
  });
});
