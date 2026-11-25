/**
 * Embedding: the pieces under the events and the stream, tried without a
 * server: what an event's declaration may be, extensions stopped and started
 * again, the answer of one that couldn't be, and the one person of an
 * install without accounts as a reader.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ServerEvent, SiteService } from "@galley/core/types";
import { declaredEvents, defineExtension } from "../../src/extensions/declare";
import { isJson, jsonBytes } from "../../src/extensions/json";
import { NOT_RUNNING } from "../../src/extensions/mount";
import { startExtensions, type StartOptions } from "../../src/extensions/run";
import type { ExtensionEventRule, ExtensionHost, JsonValue } from "../../src/extensions";
import { until } from "../hosted-helpers";
import { createBus, fakeSite, SITE_ID, testApp, TOKEN } from "../helpers";

const homes: string[] = [];

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
      expect(events({ [name]: { level: "edit" } }), name).toThrow(`Extension “status”: the event “${name}” isn't usable. A name is lower-case words joined by dots, and “stream.refused” is the server's own.`);
    }
    // The server's own name can't be taken.
    expect(events({ "stream.refused": { level: "edit" } })).toThrow(/“stream.refused” is the server's own/);
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
    await runtime.stop();
  });
});
