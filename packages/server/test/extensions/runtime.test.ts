/**
 * Embedding: the pieces under the events and the stream, tried without a
 * server: what an event's declaration may be, extensions stopped and started
 * again, the answer of one that couldn't be, and the one person of an
 * install without accounts as a reader.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { ServerEvent, SiteService } from "@galley/core/types";
import { declaredEvents, declaredRoutes, defineExtension, ExtensionError, EXTENSION_EVENT_BYTES_A_SECOND } from "../../src/extensions/declare";
import { isJson, jsonBytes } from "../../src/extensions/json";
import { NOT_FROM_THE_EDITOR, NOT_RUNNING } from "../../src/extensions/mount";
import { startExtensions, type StartedExtensions, type StartOptions } from "../../src/extensions/run";
import { extensionStream } from "../../src/extensions/stream";
import type { ExtensionEventRule, ExtensionHost, ExtensionRoute, JsonValue } from "../../src/extensions";
import { until } from "../hosted-helpers";
import { cookiesOf, createBus, fakeSite, SITE_ID, testApp, TOKEN } from "../helpers";
import { MAX_QUEUED_BYTES } from "../../src/events";

const homes: string[] = [];
/** What a test leaves open (a stream, extensions running), closed after it whether it passed or not: a stream left open keeps the run from ending. */
const leftOpen: Array<() => unknown> = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of leftOpen.splice(0).reverse()) await Promise.resolve(close()).catch(() => undefined);
});

afterAll(async () => {
  for (const home of homes) await rm(home, { recursive: true, force: true });
});

async function options(more: Partial<StartOptions> = {}): Promise<StartOptions & { lines: string[] }> {
  const lines: string[] = [];
  const home = await mkdtemp(join(tmpdir(), "extensions-runtime-"));

  homes.push(home);
  return { home, mode: "local", env: {}, log: (line) => void lines.push(line), desk: null, site: async (id) => (id === SITE_ID ? fakeSite() : null), lines, ...more };
}

describe("what an extension declares about its events", () => {
  const events = (table: Record<string, unknown>) => () => declaredEvents("status", { events: table as Record<string, ExtensionEventRule> });

  it("gives every event a name in lower-case words and a level, and at most a function that shapes it", () => {
    for (const name of ["", "Changed", "changed.", ".changed", "has space", "a..b", "1st", "kebab-case", "under_score", "a.b.c.d.e.f.g", "x".repeat(65), "note/changed", "__proto__"]) {
      expect(events({ [name]: { level: "edit" } }), name).toThrow(`Extension “status”: the event “${name}” isn't usable. A name is lower-case words joined by dots, and names that begin with “stream.” are the server's own.`);
    }
    // The server's own name can't be taken.
    // The names the server sends itself, and any it may come to send, can't be taken.
    for (const name of ["stream.refused", "stream.missed", "stream.anything", "stream.a.b"]) expect(events({ [name]: { level: "edit" } }), name).toThrow(/names that begin with “stream.” are the server's own/);
    expect(events({ stream: { level: "edit" } })).not.toThrow();
    expect(events({ "streams.changed": { level: "edit" } })).not.toThrow();
    for (const name of ["changed", "note.changed", "a1.b2", "a.b.c.d.e.f"]) expect(events({ [name]: { level: "edit" } }), name).not.toThrow();
    for (const level of [undefined, "public", "owner", "", null, true]) {
      expect(events({ changed: { level } }), String(level)).toThrow("Extension “status”: the event “changed” has no level. It is edit, publish or manage: the least a reader's role must have to be sent it.");
    }
    expect(events({ changed: null })).toThrow(/has no level/);
    expect(events({ changed: { level: "edit", for: "everyone" } })).toThrow("Extension “status”: the event “changed” isn't usable: what shapes it for a reader is a function, or left out.");
    expect(() => declaredEvents("status", { events: "changed" as never })).toThrow("Extension “status” couldn't start: its events aren't a list of events.");
    expect(declaredEvents("status", {}).size).toBe(0);
  });

  it("keeps the level an event was declared with, whatever becomes of the object it was declared in", () => {
    const rule: { level: "edit" | "publish" | "manage"; for?: () => null } = { level: "manage" };
    const declared = declaredEvents("status", { events: { changed: rule } });

    rule.level = "edit";
    rule.for = () => null;
    expect(declared.get("changed")).toEqual({ level: "manage" });
    expect(Object.isFrozen(declared.get("changed"))).toBe(true);
  });

  it("measures a payload as the JSON it is sent as", () => {
    expect(jsonBytes({ text: "é" })).toBe(Buffer.byteLength('{"text":"é"}'));
    expect(jsonBytes("x".repeat(100))).toBe(102);
    expect(isJson({ n: 1n })).toBe(false);
  });
});

describe("extensions stopped and started again", () => {
  it("each gets a new host and the old one does nothing; one that can't start is said, left stopped and answers so; every window's stream can be ended to be opened again", async () => {
    const hosts: Record<"steady" | "flaky", ExtensionHost[]> = { steady: [], flaky: [] };
    const stops: string[] = [];
    const told: string[] = [];
    const bus = createBus();
    const site = fakeSite();
    const born = (id: "steady" | "flaky") => ({ "GET /born": { access: "edit" as const, handle: () => hosts[id].length } });
    const steady = defineExtension({
      id: "steady",
      setup(host) {
        const mine = hosts.steady.push(host);

        host.events.onStream((stream) => {
          told.push(`${mine}: ${stream.value} is here`);
          return () => void told.push(`${mine}: ${stream.value} has gone`);
        });
        return {
          stop: () => void stops.push("steady"),
          events: { tick: { level: "edit" } },
          routes: { ...born("steady"), "POST /sites/:siteId/tick": { access: "edit", body: (input) => input as JsonValue, handle: (request) => (host.events.emit("tick", request.site!.id, request.body), { ok: true }) } },
        };
      },
    });
    const flaky = defineExtension({
      id: "flaky",
      secrets: ["FLAKY_SERVICE_TOKEN"],
      setup(host) {
        // The second time, its service is away.
        if (hosts.flaky.push(host) === 2) throw new Error("the service said no to flaky-token-123456.");
        return { stop: () => void stops.push("flaky"), routes: born("flaky") };
      },
    });
    const given = await options({ env: { FLAKY_SERVICE_TOKEN: "flaky-token-123456" }, site: async (id) => (id === SITE_ID ? site : null), emit: (event) => bus.emit(event) });
    const runtime = await startExtensions([steady, flaky], given);
    const app = testApp({ site, events: bus }, { extensions: { runtime, desk: null } });
    const ask = async (id: string) => {
      const answer = await app.call("GET", `/api/x/${id}/born`);

      return [answer.status, await answer.json()];
    };
    const closed: string[] = [];

    expect(runtime.ids).toEqual(["steady", "flaky"]);
    expect([await ask("steady"), await ask("flaky")]).toEqual([[200, 1], [200, 1]]);
    const window = runtime.streamOpened("steady", { caller: { kind: "local" }, value: "tab-1" }, () => void closed.push("tab-1"));
    const gone = runtime.streamOpened("steady", { caller: { kind: "local" }, value: "tab-2" }, () => void closed.push("tab-2"));

    // That window closed by itself: it is not one to end later.
    gone.ended();
    expect(window.refused).toBeNull();
    expect(told).toEqual(["1: tab-1 is here", "1: tab-2 is here", "1: tab-2 has gone"]);

    expect(await runtime.restart()).toEqual(["flaky"]);
    // Stopped last to first, then started first to last.
    expect(stops).toEqual(["flaky", "steady"]);
    expect([hosts.steady.length, hosts.flaky.length]).toEqual([2, 2]);
    expect(hosts.steady[1]).not.toBe(hosts.steady[0]);
    expect(runtime.list.map((extension) => extension.id)).toEqual(["steady"]);
    expect(runtime.find("flaky")).toBeUndefined();
    expect(given.lines).toEqual(["Extension “flaky” couldn't start: the service said no to •••. It was stopped and couldn't be started again: its routes answer that it isn't running until the server is restarted."]);
    // The same addresses: the one that runs now answers, and the one that doesn't says so.
    expect(await ask("steady")).toEqual([200, 2]);
    expect(await ask("flaky")).toEqual([503, { error: { code: "busy", message: NOT_RUNNING } }]);
    // The window that was there is not known to the one running now: its stream is ended, to open another. The extension that was stopped is not called about it.
    expect(closed).toEqual([]);
    runtime.endStreams();
    expect(closed).toEqual(["tab-1"]);
    window.ended();
    expect(told).toHaveLength(3);
    // What the first one was handed does nothing; the new one's events go out.
    expect(() => hosts.steady[0]!.events.emit("tick", SITE_ID, 0)).toThrow("This extension has been stopped, so it can no longer send events.");
    expect(await hosts.steady[0]!.sites.get(SITE_ID)).toBeNull();
    const heard: ServerEvent[] = [];

    bus.subscribe((event) => void heard.push(event));
    expect((await app.call("POST", `/api/x/steady/sites/${SITE_ID}/tick`, { n: 1 })).status).toBe(200);
    expect(heard).toEqual([{ type: "extension", source: "steady", name: "tick", siteId: SITE_ID, payload: { n: 1 } }]);

    // Once more, and its service is back.
    expect(await runtime.restart()).toEqual([]);
    expect(runtime.list.map((extension) => extension.id)).toEqual(["steady", "flaky"]);
    expect([await ask("steady"), await ask("flaky")]).toEqual([[200, 3], [200, 3]]);

    // Stopped for a while: nothing runs, a window that opens meanwhile is kept, and is ended when they run again.
    await runtime.stopForNow();
    expect(runtime.list).toEqual([]);
    expect(await ask("steady")).toEqual([503, { error: { code: "busy", message: NOT_RUNNING } }]);
    expect(runtime.streamOpened("steady", { caller: { kind: "local" }, value: "tab-3" }, () => void closed.push("tab-3")).refused).toBeNull();
    expect(told).toHaveLength(3);
    expect(await runtime.restart()).toEqual([]);
    runtime.endStreams();
    expect(closed).toEqual(["tab-1", "tab-3"]);

    // Stopped for good: asked to start again, nothing does.
    await runtime.stop();
    expect(await runtime.restart()).toEqual([]);
    expect(runtime.list).toEqual([]);
    expect([hosts.steady.length, hosts.flaky.length]).toEqual([4, 4]);
  });

  it("starts nothing more once the server is stopping: a start under way is told, and what it had started is stopped", async () => {
    let letGo!: () => void;
    const held = new Promise<void>((resolve) => (letGo = resolve));
    const seen: { starts: number[]; signal: AbortSignal | null; stops: string[] } = { starts: [0, 0], signal: null, stops: [] };
    const first = defineExtension({
      id: "first",
      async setup(_host, start) {
        // Its second start waits on something slow.
        if ((seen.starts[0]! += 1) === 2) {
          seen.signal = start.signal;
          await held;
        }
        return { stop: () => void seen.stops.push("first") };
      },
    });
    const last = defineExtension({ id: "last", setup: () => ((seen.starts[1]! += 1), { stop: () => void seen.stops.push("last") }) });
    const runtime = await startExtensions([first, last], await options());
    const restarting = runtime.restart();

    await until(() => seen.signal !== null);
    const stopping = runtime.stop();

    expect(seen.signal!.aborted).toBe(true);
    letGo();
    expect(await restarting).toEqual([]);
    await stopping;
    expect(runtime.list).toEqual([]);
    // The second was never started again, and the first, which was, is stopped again.
    expect(seen.starts).toEqual([2, 1]);
    expect(seen.stops).toEqual(["last", "first", "first"]);
  });
});

describe("an extension started again, and the addresses it was mounted with", () => {
  const AGAIN = "It was stopped and couldn't be started again: its routes answer that it isn't running until the server is restarted.";

  it("keeps the guards its addresses have: started again with other routes, it is stopped and answers that it isn't running", async () => {
    const report: ExtensionRoute = { access: "edit", handle: () => "the report" };
    const note: ExtensionRoute<unknown> = { access: "edit", body: (input) => input, handle: () => null };
    const tables: Array<Record<string, ExtensionRoute<any>>> = [
      { "GET /report": report, "POST /note": note },
      // One difference at a time: a level, a size limit, "a person only", an address more, an address fewer.
      { "GET /report": { ...report, access: "manage" }, "POST /note": note },
      { "GET /report": report, "POST /note": { ...note, bodyLimit: 512 } },
      { "GET /report": { ...report, person: true }, "POST /note": note },
      { "GET /report": report, "POST /note": note, "GET /more": report },
      { "GET /report": report },
      // The same again, in another order and with other functions: nothing an address is guarded by differs.
      { "POST /note": { ...note, handle: () => 1 }, "GET /report": { ...report, handle: () => "the report again" } },
    ];
    const seen = { round: 0, stops: 0, steady: 0 };
    const shifting = defineExtension({ id: "shifting", setup: () => ({ routes: tables[seen.round++]!, stop: () => void (seen.stops += 1) }) });
    const steady = defineExtension({ id: "steady", setup: () => ((seen.steady += 1), { routes: { "GET /n": { access: "edit", handle: () => seen.steady } } }) });
    const given = await options();
    const runtime = await startExtensions([shifting, steady], given);
    const app = testApp({ site: fakeSite() }, { extensions: { runtime, desk: null } });
    const ask = async (path: string) => {
      const answer = await app.call("GET", path);

      return [answer.status, await answer.json()];
    };

    expect(await ask("/api/x/shifting/report")).toEqual([200, "the report"]);
    for (let round = 1; round <= 5; round += 1) {
      expect(await runtime.restart(), `table ${round}`).toEqual(["shifting"]);
      // Its own stop was called each time (and once more the first time, for the one that was running): what a setup started is not left running.
      expect(seen.stops, `table ${round}`).toBe(round + 1);
      expect(await ask("/api/x/shifting/report"), `table ${round}`).toEqual([503, { error: { code: "busy", message: NOT_RUNNING } }]);
      expect(await ask("/api/x/steady/n")).toEqual([200, round + 1]);
    }
    expect(given.lines).toEqual(Array.from({ length: 5 }, () => `Extension “shifting” returned other routes than it did when the server started (an address, a level, a size limit or “a person only” differs), and an address keeps the guards it was mounted with. ${AGAIN}`));
    // With the routes it started with, it runs again, behind the guards its addresses always had.
    expect(await runtime.restart()).toEqual([]);
    expect(await ask("/api/x/shifting/report")).toEqual([200, "the report again"]);
    await runtime.stop();
  });

  it("should a handler ever be reached with a level other than its address was mounted with, it isn't run", async () => {
    const calls: string[] = [];
    const routes = (access: "edit" | "manage") => declaredRoutes("status", { routes: { "GET /report": { access, handle: () => (calls.push(access), "the report") } } });
    const extension = (access: "edit" | "manage") => ({ id: "status", routes: routes(access), scrub: (text: string) => text, say: () => undefined, alive: () => true, handed: () => undefined });
    let now = extension("edit");
    const runtime = { ids: ["status"], list: [extension("edit")], find: () => now, secretEnv: [], streamOpened: () => ({ refused: null, ended: () => undefined }), stop: async () => undefined, stopForNow: async () => undefined, restart: async () => [], endStreams: () => undefined } as unknown as StartedExtensions;
    const app = testApp({ site: fakeSite() }, { extensions: { runtime, desk: null } });

    expect((await app.call("GET", "/api/x/status/report")).status).toBe(200);
    now = extension("manage");
    const refused = await app.call("GET", "/api/x/status/report");

    expect([refused.status, await refused.json()]).toEqual([503, { error: { code: "busy", message: NOT_RUNNING } }]);
    expect(calls).toEqual(["edit"]);
  });

  it("a setup that runs out of time is told, and if it finishes after all, what it started is stopped", async () => {
    const seen: { round: number; signal: AbortSignal | null; lateStops: number } = { round: 0, signal: null, lateStops: 0 };
    let finish: (() => void) | null = null;
    const slow = defineExtension({
      id: "slow",
      secrets: ["SLOW_SERVICE_TOKEN"],
      setup: (_host, start) =>
        (seen.round += 1) === 1
          ? {}
          : new Promise((resolve) => {
              seen.signal = start.signal;
              // Finishes late, having started something of its own; its stop then fails with a secret in its words.
              finish = () =>
                resolve({
                  stop() {
                    seen.lateStops += 1;
                    throw new Error("couldn't close slow-token-123456");
                  },
                });
            }),
    });
    const given = await options({ setupMs: 40, env: { SLOW_SERVICE_TOKEN: "slow-token-123456" } });
    const runtime = await startExtensions([slow], given);

    expect(await runtime.restart()).toEqual(["slow"]);
    expect(seen.signal!.aborted).toBe(true);
    expect(given.lines).toEqual([`Extension “slow” couldn't start: it didn't finish starting in time. ${AGAIN}`]);
    expect(runtime.list).toEqual([]);
    finish!();
    await until(() => seen.lateStops === 1);
    await until(() => given.lines.length === 2);
    expect(given.lines[1]).toBe("[slow] its setup finished after its time was up, and its stop then failed: couldn't close •••");
    await runtime.stop();
  });

  it("a late setup's stop takes its turn: never in the middle of another start or stop, and one that can't even be looked at ends nothing", async () => {
    const order: string[] = [];
    const seen = { round: 0 };
    let finishLate: (() => void) | null = null;
    let letStopEnd!: () => void;
    const held = new Promise<void>((resolve) => (letStopEnd = resolve));
    const late = defineExtension({
      id: "late",
      setup: () =>
        (seen.round += 1) === 2
          ? new Promise((resolve) => (finishLate = () => (order.push("the late setup finished"), resolve({ stop: () => void order.push("the late stop") }))))
          : seen.round === 3
            ? // Its third start runs out of time too, and what it hands back late fails on being looked at.
              new Promise((resolve) => setTimeout(() => resolve(Object.defineProperty({}, "stop", { get: () => { throw new Error("no stop to give"); } })), 80))
            : {},
    });
    // Another extension whose stop takes a while: the middle of a restart.
    const slow = defineExtension({
      id: "slow-to-stop",
      setup: () => ({
        async stop() {
          order.push("another stop began");
          if (seen.round === 2) await held;
          order.push("another stop ended");
        },
      }),
    });
    const given = await options({ setupMs: 40 });
    const runtime = await startExtensions([late, slow], given);

    // Started again: the first one's setup runs out of time.
    expect(await runtime.restart()).toEqual(["late"]);
    order.length = 0;
    // Started again once more, and while the other extension is being stopped, the abandoned setup finishes after all.
    const restarting = runtime.restart();

    await until(() => order.includes("another stop began"));
    finishLate!();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(order).toEqual(["another stop began", "the late setup finished"]);
    letStopEnd();
    expect(await restarting).toEqual(["late"]);
    await until(() => order.includes("the late stop"));
    // Only after the stop it would have run into had ended.
    expect(order.indexOf("the late stop")).toBeGreaterThan(order.indexOf("another stop ended"));
    // The one that fails on being looked at: said, and nothing else happens (no rejection left unhandled, which would end the process).
    await until(() => given.lines.some((line) => line.includes("no stop to give")), 5000);
    expect(given.lines.filter((line) => line.startsWith("[late]"))).toEqual(["[late] its setup finished after its time was up, and its stop then failed: no stop to give"]);
    await runtime.stop();
  });

  it("an error of the extension's own making is said on one line with its secrets taken out", async () => {
    let round = 0;
    const loud = defineExtension({
      id: "loud",
      secrets: ["LOUD_SERVICE_TOKEN"],
      setup() {
        if ((round += 1) === 2) throw new ExtensionError("The loud service refused loud-token-123456.\nGET /api/people 200 forged");
        return {};
      },
    });
    const given = await options({ env: { LOUD_SERVICE_TOKEN: "loud-token-123456" } });
    const runtime = await startExtensions([loud], given);

    expect(await runtime.restart()).toEqual(["loud"]);
    expect(given.lines).toEqual([`The loud service refused •••. GET /api/people 200 forged. ${AGAIN}`]);
    await runtime.stop();
  });
});

describe("how much an extension may send", () => {
  it("is counted over any one second, not by the clock's seconds: fifty just before a second turns leave no room just after it", async () => {
    const heard: ServerEvent[] = [];
    let host!: ExtensionHost;
    const quick = defineExtension({ id: "quick", setup: (given) => ((host = given), { events: { tick: { level: "edit" } } }) });
    const runtime = await startExtensions([quick], await options({ emit: (event) => void heard.push(event), siteId: () => SITE_ID }));
    const second = Math.floor(performance.now() / 1000) * 1000 + 5000;
    let now = second + 999;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    // The wall clock is set back an hour meanwhile (by hand, by a time service, by a machine that slept): nothing here goes by it.
    const wall = vi.spyOn(Date, "now").mockImplementation(() => 1_000_000_000_000 - (now - second) * 3_600);
    const send = (times: number) => {
      for (let sent = 0; sent < times; sent += 1) host.events.emit("tick", SITE_ID, sent);
    };

    try {
      send(60);
      expect(heard).toHaveLength(50);
      // One millisecond later the clock shows a new second. It is the same second for this.
      now = second + 1000;
      send(10);
      expect(heard).toHaveLength(50);
      // A second after the fifty, there is room again.
      now = second + 999 + 1000;
      send(10);
      expect(heard).toHaveLength(60);
    } finally {
      clock.mockRestore();
      wall.mockRestore();
    }
    await runtime.stop();
  });
});

describe("an extension's events and a reader that is behind", () => {
  it("are left out for that reader and counted, while the editor's own events keep their room and the reader is never let go for them", async () => {
    const bus = createBus();
    const site = fakeSite();
    const busy = defineExtension({
      id: "busy",
      setup: (host) => ({
        events: { tick: { level: "edit" }, shaped: { level: "edit", for: (payload: JsonValue) => payload } },
        routes: {
          "POST /sites/:siteId/send": {
            access: "edit",
            body: (input) => input as { name: string; kb: number; times: number },
            handle(request) {
              for (let sent = 0; sent < request.body.times; sent += 1) host.events.emit(request.body.name, request.site!.id, { pad: "x".repeat(request.body.kb * 1024) });
              return { ok: true };
            },
          },
        },
      }),
    });
    const given = await options({ site: async (id) => (id === SITE_ID ? site : null), emit: (event) => bus.emit(event) });
    const runtime = await startExtensions([busy], given);
    const app = testApp({ site, events: bus }, { extensions: { runtime, desk: null } });
    const send = async (name: string, kb: number, times: number) => expect((await app.call("POST", `/api/x/busy/sites/${SITE_ID}/send`, { name, kb, times })).status).toBe(200);
    // A window that opens its stream and then reads nothing.
    const stream = await app.raw("GET", "/api/events", { headers: { authorization: `Bearer ${TOKEN}` } });

    leftOpen.push(() => runtime.stop(), () => (stream.body!.locked ? undefined : stream.body!.cancel()));
    let now = performance.now();
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);

    try {
      // Twenty seconds of everything it may send: four events of 60 KB in each, under its 256 KB a second.
      expect(4 * 60 * 1024).toBeLessThan(EXTENSION_EVENT_BYTES_A_SECOND);
      for (let second = 0; second < 20; second += 1) {
        now += 1001;
        await send(second % 2 ? "tick" : "shaped", 60, 4);
      }
      // One of the editor's own events, large: it is not left out.
      bus.emit({ type: "site.updated", siteId: SITE_ID, pad: "y".repeat(300_000) } as never);
      now += 1001;
      await send("tick", 60, 1);
    } finally {
      clock.mockRestore();
    }
    // Now the window reads what is waiting for it. It was not let go: the stream is there to be read.
    const reader = stream.body!.getReader();

    leftOpen.push(() => reader.cancel());
    const decoder = new TextDecoder();
    let text = "";
    const read = async (enough: () => boolean) => {
      while (!enough()) {
        const { done, value } = await reader.read();

        if (done) throw new Error("the stream had been ended");
        text += decoder.decode(value, { stream: true });
      }
    };

    const sentOf = () => (text.match(/"name":"(tick|shaped)"/g) ?? []).length;

    await read(() => text.includes('"site.updated"'));
    const arrived = sentOf();

    // Half of what a reader may have waiting is 512 KB: eight events of 60 KB are under it, the ninth takes it over, and from then on they are left out.
    expect(MAX_QUEUED_BYTES).toBe(1024 * 1024);
    expect(arrived).toBe(9);
    expect(text.length).toBeLessThan(MAX_QUEUED_BYTES);
    // Said a second after the first of them, with how many: 81 were sent.
    await until(() => given.lines.length > 0, 5000);
    expect(given.lines).toEqual(["[busy] 72 times an event of its was not sent to a window that had fallen behind in reading."]);
    // Once it has caught up, it is sent them again. And first it is told that it missed some, and how many: it was never
    // let go, so nothing else would have told it to ask for what it shows again.
    await send("tick", 1, 1);
    await read(() => sentOf() === 10);
    const told = `data: ${JSON.stringify({ type: "extension", source: "busy", name: "stream.missed", siteId: "", payload: { count: 72 } })}`;

    expect(text.split(told)).toHaveLength(2);
    expect(text.indexOf(told)).toBeGreaterThan(text.indexOf('"site.updated"'));
    expect(text.indexOf(told)).toBeLessThan(text.lastIndexOf('"name":"tick"'));
    // Told once: nothing more is owed until it misses again.
    await send("tick", 1, 2);
    await read(() => sentOf() === 12);
    expect(text.split('"stream.missed"')).toHaveLength(2);
    await reader.cancel();
    await runtime.stop();
  });
});

describe("a reader whose sign-in no longer counts", () => {
  it("is sent nothing of an extension's and asked about by no rule, and the stream says it is over, whatever else still lets them listen", async () => {
    const asked: string[] = [];
    const told: string[] = [];
    const noted = defineExtension({
      id: "noted",
      setup: (host) => (host.events.onStream((stream) => void told.push(stream.value)), { events: { tick: { level: "edit", for: (payload: JsonValue, reader) => (asked.push(reader.kind), payload) } } }),
    });
    const runtime = await startExtensions([noted], await options());
    const account = { id: "a1", role: "owner", name: "Sam Owner", disabled: false } as never;
    const session = { id: "s1", issuedAt: Date.now(), expiresAt: Date.now() + 60_000, kind: "password" as const, accountId: "a1" };
    let counts = true;
    // Everything else says yes: the account is there, and the stream's own check lets them listen.
    const base = { live: () => true, filter: (event: ServerEvent) => event };
    const event: ServerEvent = { type: "extension", source: "noted", name: "tick", siteId: SITE_ID, payload: 1 };
    let made!: ReturnType<typeof extensionStream>;
    const app = new Hono();

    app.get("/stream", (c) => {
      made = extensionStream(c, runtime, { callerOf: () => ({ kind: "person", account, session }), accountNow: () => account, refOf: () => "ref" as never, stillCounts: () => counts }, base);
      return c.text("");
    });
    await app.request("/stream?x-noted=tab-1", { headers: { "sec-fetch-site": "same-origin" } });
    expect([made.access.live(), made.access.filter(event)]).toEqual([true, event]);
    expect(asked).toEqual(["person"]);
    counts = false;
    expect([made.access.live(), made.access.filter(event)]).toEqual([false, null]);
    expect(asked).toEqual(["person"]);
    // The editor's own events are the stream's own check's to decide, as before.
    expect(made.access.filter({ type: "sites.updated" })).toEqual({ type: "sites.updated" });
    // A stream opened by a sign-in that doesn't count tells no extension it is there.
    expect(made.hooks.opened(() => undefined)).toBeTypeOf("function");
    expect(told).toEqual([]);
    counts = true;
    made.hooks.opened(() => undefined);
    expect(told).toEqual(["tab-1"]);
    await runtime.stop();
  });
});

describe("where there are no accounts", () => {
  it("the one person at this computer is a reader like any other: the rule is asked about them, and their window is told", async () => {
    const bus = createBus();
    const site = fakeSite();
    const asked: string[] = [];
    const told: string[] = [];
    const lone = defineExtension({
      id: "lone",
      setup(host) {
        host.events.onStream((stream) => {
          told.push(`${stream.caller.kind}: ${stream.value} is here`);
          return () => void told.push(`${stream.value} has gone`);
        });
        return {
          events: {
            // The highest level there is: the one person has it.
            tick: { level: "manage", for: (payload: JsonValue, reader) => (asked.push(reader.kind), { payload, for: reader.kind }) },
            never: { level: "edit", for: () => null },
          },
          routes: {
            "POST /sites/:siteId/tick": { access: "edit", body: (input) => input as JsonValue, handle: (request) => (host.events.emit("never", request.site!.id, 0), host.events.emit("tick", request.site!.id, request.body), { ok: true }) },
          },
        };
      },
    });
    const runtime = await startExtensions([lone], await options({ site: async (id) => (id === SITE_ID ? site : null), emit: (event) => bus.emit(event) }));
    const app = testApp({ site, events: bus }, { extensions: { runtime, desk: null } });
    const stream = await app.raw("GET", "/api/events?x-lone=tab-1", { headers: { authorization: `Bearer ${TOKEN}` } });
    const reader = stream.body!.getReader();

    leftOpen.push(() => runtime.stop(), () => reader.cancel());
    const decoder = new TextDecoder();
    let text = "";
    const read = async (enough: () => boolean) => {
      while (!enough()) {
        const { done, value } = await reader.read();

        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
    };

    expect(stream.status).toBe(200);
    await read(() => text.includes("hello"));
    expect(told).toEqual(["local: tab-1 is here"]);
    // An event about a site it hasn't been handed is refused; a route that names the site hands it over.
    expect((await app.call("POST", `/api/x/lone/sites/${SITE_ID}/tick`, { n: 1 })).status).toBe(200);
    await read(() => text.includes('"tick"'));
    expect(text).toContain(`data: ${JSON.stringify({ type: "extension", source: "lone", name: "tick", siteId: SITE_ID, payload: { payload: { n: 1 }, for: "local" } })}`);
    expect(text).not.toContain('"never"');
    expect(asked).toEqual(["local"]);
    await reader.cancel();
    expect(told).toEqual(["local: tab-1 is here", "tab-1 has gone"]);

    // With the cookie the browser on this computer has, a value is taken only from the editor's own page here too.
    const cookie = cookiesOf(await app.raw("GET", `/?token=${TOKEN}`))[0]!;
    /** Opens a stream with the cookie and says what it is sent in its first moments. */
    const first = async (headers: Record<string, string>) => {
      const opened = await app.raw("GET", "/api/events?x-lone=tab-2", { headers: { cookie, ...headers } });
      const from = opened.body!.getReader();
      let words = "";

      for (;;) {
        const next = await Promise.race([from.read(), new Promise<null>((resolve) => setTimeout(() => resolve(null), 150))]);

        if (next === null || next.done) break;
        words += new TextDecoder().decode(next.value);
      }
      void from.cancel().catch(() => undefined);
      return [opened.status, words.split("data: ").slice(1).map((line) => JSON.parse(line) as { type: string; name?: string; payload?: unknown })] as const;
    };
    const [status, events] = await first({});

    expect(status).toBe(200);
    expect(events.map((event) => event.type)).toEqual(["hello", "extension"]);
    expect(events[1]).toMatchObject({ source: "lone", name: "stream.refused", payload: { code: "forbidden", message: NOT_FROM_THE_EDITOR } });
    expect(told).toHaveLength(2);
    const [, own] = await first({ "sec-fetch-site": "same-origin" });

    expect(own.map((event) => event.type)).toEqual(["hello"]);
    expect(told[2]).toBe("local: tab-2 is here");
    await runtime.stop();
  });
});
