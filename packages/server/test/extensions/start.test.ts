/**
 * Embedding: starting and stopping. An extension that can't start stops the
 * server's start and leaves nothing running; where there are no accounts
 * the one person on their own computer is the caller.
 */
import { createServer } from "node:net";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { asOperator, callerMay } from "@galley/core/install";
import { hostedMode } from "@galley/core/plugins";
import { withoutHiddenVariables } from "@galley/core/workspace";
import { startServer, type ServerOptions } from "../../src";
import { defineExtension, type ExtensionHost } from "../../src/extensions";
import { call, EDITOR, sandbox, siteRepository, startHosted, stopHosted } from "../hosted-helpers";
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

  it("on a hosted install a failed start undoes everything, keeps the secret from what started meanwhile, and leaves the extension holding nothing", async () => {
    const home = box.folder("hosted-home");
    const env = {
      GALLEY_PUBLIC_URL: EDITOR,
      GALLEY_PASSWORD: "correct horse battery staple",
      GALLEY_OWNER_NAME: "Sam Owner",
      GALLEY_OWNER_EMAIL: "sam@example.com",
      GALLEY_SITE_REPOSITORY: siteRepository(box),
      GALLEY_SITE_ACCESS: "token",
      GALLEY_SITE_TOKEN: "fake-access-key-for-the-repository-0000",
      FAILING_SERVICE_TOKEN: "failing-secret-value-123",
    };
    const seen: { hidden?: boolean; asWhom?: boolean; host?: ExtensionHost; signal?: AbortSignal; siteDuring?: boolean } = {};
    const lines: string[] = [];
    const failing = defineExtension({
      id: "failing",
      secrets: ["FAILING_SERVICE_TOKEN"],
      async setup(host, start) {
        seen.host = host;
        seen.signal = start.signal;
        // By the time any setup runs, a command of the site's is already started without the secret.
        seen.hidden = !("FAILING_SERVICE_TOKEN" in withoutHiddenVariables({ FAILING_SERVICE_TOKEN: "x" }));
        // Whoever called startServer, setup is nobody: on a hosted install nobody may not publish.
        seen.asWhom = callerMay("publish");
        throw new Error("the service said no to failing-secret-value-123");
      },
    });

    // Started as the operator would start it from a command of their own.
    await expect(asOperator(() => startHosted(box, home, env, { extensions: [failing], log: (line) => void lines.push(line) }))).rejects.toThrow("Extension “failing” couldn't start: the service said no to •••");
    expect(seen).toMatchObject({ hidden: true, asWhom: false });
    expect(seen.signal!.aborted).toBe(true);
    // Nothing of the server is left in the process: its mode, its guard, its hidden names.
    expect(hostedMode()).toBe(false);
    expect(callerMay("publish")).toBe(true);
    expect(withoutHiddenVariables({ FAILING_SERVICE_TOKEN: "x" })).toEqual({ FAILING_SERVICE_TOKEN: "x" });
    // What the extension was handed does nothing now.
    seen.host!.log("after the failed start");
    expect(await seen.host!.sites.get("any")).toBeNull();
    expect(lines.join("\n")).not.toContain("after the failed start");
    expect(lines.join("\n")).not.toContain("failing-secret-value-123");
    // The data folder was let go: the same install starts on it, with a working extension, and stops.
    const probe = newProbe();
    const next = await startHosted(box, home, env, { extensions: [statusExtension(probe)] });

    expect(next.notices.join("\n")).toMatch(/Extensions: status/);
    await stopHosted(box, next);
  });

  it("a setup that ignores its time is left holding nothing once the start has ended", async () => {
    let host: ExtensionHost | null = null;
    const stubborn = defineExtension({ id: "stubborn", setup: (handed) => ((host = handed), new Promise<never>(() => {})) });

    await expect(local(box.folder("home"), [stubborn], { extensionTimes: { setupMs: 40 } })).rejects.toThrow(/didn't finish starting in time/);
    expect(await host!.sites.get("any")).toBeNull();
    // Times that make no sense are brought within reason rather than waited on for ever, or not at all.
    await expect(local(box.folder("home"), [stubborn], { extensionTimes: { setupMs: -5 } })).rejects.toThrow(/didn't finish starting in time/);
  });

  it("a hosted start that can't have its port leaves the process as it found it", async () => {
    // The commonest way a start fails: something else is already listening there.
    const taken = createServer();
    const port = await new Promise<number>((resolve) => taken.listen(0, "127.0.0.1", () => resolve((taken.address() as { port: number }).port)));

    try {
      await expect(
        startHosted(box, box.folder("taken-home"), { GALLEY_PUBLIC_URL: EDITOR, GALLEY_PASSWORD: "correct horse battery staple", GALLEY_TOKEN: "an-operator-token-for-scripts-0000" }, { port, findFreePort: false })
      ).rejects.toThrow();
      // Hosted mode, the guard on work for nobody and the names hidden from a site's commands are all the process's: none is left on.
      expect(hostedMode()).toBe(false);
      expect(callerMay("publish")).toBe(true);
      expect(withoutHiddenVariables({ GALLEY_TOKEN: "x" })).toEqual({ GALLEY_TOKEN: "x" });
    } finally {
      await new Promise<void>((resolve) => taken.close(() => resolve()));
    }
  });
});
