// @vitest-environment happy-dom
/**
 * Additions: what a program that builds its own edition of the editor draws
 * in the app. The real app in a page, against the mock server. Each test is
 * a sentence someone could try to break: without additions the app is as it
 * was, an addition is drawn in its places and can't take a screen down, and
 * the one live stream is neither held up nor lost to one.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerEvent } from "@galley/core/types";
import { renderApp, startServer, until, type MockServer, type Rendered } from "./harness";

const APP = "../../src/app/App.tsx";
const KIT = "../../src/additions/index.ts";
const PLACES = "../../src/additions/places.tsx";
const EVENTS = "../../src/lib/events.ts";
const API = "../../src/lib/api.ts";
const META = "../../src/lib/stores/meta.ts";

/** The parts of `@galley/web/additions` the tests use, typed loosely: the app is loaded fresh by dynamic import. */
interface Kit {
  extensionApi(id: string): Record<"get" | "post" | "put" | "patch" | "delete", (parts: readonly string[], more?: unknown) => Promise<unknown>>;
  extensionUrl(id: string, parts: readonly string[], query?: Record<string, unknown>): string;
  subscribeExtension(id: string, name: string, handler: (event: { siteId: string; payload: unknown }) => void): () => void;
  setStreamValue(id: string, value: () => Promise<string | null> | string | null): () => void;
  onReconnect(listener: () => void): () => void;
  useSiteId(): string | null;
  useAccount(): { name: string; role: string } | null;
  useRoleMay(level: string): boolean;
  SafeText: unknown;
  SafeMarkdown: unknown;
  STREAM_VALUE_MS: number;
  STREAM_REOPEN_MS: number;
}
type React = typeof import("react");

let page: { unmount(): Promise<void> } | null = null;
afterEach(async () => {
  await page?.unmount();
  page = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function siteOf(server: MockServer): string {
  const id = server.install?.site.id;

  if (!id) throw new Error("The mock install has no site");
  return id;
}

/** Notes the address of every stream the app opens. */
/** Every stream the app has opened since `recordStreams` was last called, to make one fail from the test; and when each was opened. */
const sources: Array<{ onerror: (() => void) | null }> = [];
const openedAt: number[] = [];

function recordStreams(): string[] {
  const opened: string[] = [];
  const Base = (globalThis as unknown as { EventSource: new () => { onerror: (() => void) | null } }).EventSource;

  vi.stubGlobal(
    "EventSource",
    class extends Base {
      constructor(url: string) {
        super();
        opened.push(url);
        sources.push(this);
        openedAt.push(Date.now());
      }
    },
  );
  sources.length = 0;
  openedAt.length = 0;
  return opened;
}

/** What the app reports the way a browser reports an uncaught error, kept here where the page would log it. */
function recordReported(): unknown[] {
  const reported: unknown[] = [];

  vi.stubGlobal("reportError", (error: unknown) => void reported.push(error));
  return reported;
}

const pause = async (react: React, ms: number) =>
  react.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

/** The app, loaded fresh, with the additions `make` builds from the same fresh modules. */
async function renderWith(path: string, make: (kit: Kit, react: React) => unknown[]): Promise<{ kit: Kit; react: React; again(additions: unknown[]): Promise<void>; unmount(): Promise<void> }> {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, "", path);
  const [react, { createRoot }, { App }, kit] = await Promise.all([import("react"), import("react-dom/client"), import(/* @vite-ignore */ APP) as Promise<{ App: (props: { additions?: unknown[] }) => null }>, import(/* @vite-ignore */ KIT) as Promise<Kit>]);
  const container = document.createElement("div");

  document.body.replaceChildren(container);
  const root = createRoot(container);

  await react.act(async () => root.render(react.createElement(App, { additions: make(kit, react) })));
  return {
    kit,
    react,
    // The app drawn again with another list, as a careless entry file might on every render.
    again: async (additions) => {
      await react.act(async () => root.render(react.createElement(App, { additions })));
    },
    unmount: async () => {
      // The app's one stream belongs to the page, not to the tree: closed here, with anything it still meant to do
      // (opening again for a changed value, a few seconds on), so nothing of this test reaches the next one.
      const { disconnectEvents } = (await import(/* @vite-ignore */ EVENTS)) as { disconnectEvents(): void };

      disconnectEvents();
      await react.act(async () => root.unmount());
    },
  };
}

/** What was said on the console about additions and handlers, without React's own lines. */
const saidAbout = (spy: { mock: { calls: unknown[][] } }, words: string) => spy.mock.calls.map((call) => String(call[0])).filter((line) => line.includes(words));

async function hosted(role: "owner" | "editor" | "contributor" = "editor"): Promise<{ server: MockServer; site: string; emit(event: ServerEvent): void }> {
  let emit: (event: ServerEvent) => void = () => undefined;
  const server = await startServer({
    mode: "hosted",
    setup: "done",
    role,
    handlers: (handlers, backend) => {
      emit = (event) => backend.emit(event);
      return handlers;
    },
  });

  return { server, site: siteOf(server), emit: (event) => emit(event) };
}

describe("the app without additions", () => {
  it("is as it was: nothing more in a row or the top bar, and the stream opened at its plain address", async () => {
    const { server, site } = await hosted();
    const opened = recordStreams();
    const before = new Set(Object.getOwnPropertyNames(globalThis));
    const rendered: Rendered = await renderApp(server, `/sites/${site}/c/blog`);

    page = rendered;
    await until(() => expect(document.querySelectorAll(".app-row").length).toBeGreaterThan(0));
    expect(document.querySelector(".app-row__with-additions")).toBeNull();
    expect(document.querySelector(".app-row__additions")).toBeNull();
    expect(opened).toEqual(["/api/events"]);
    // Nothing on the page's window to fill a place through: additions come from the program's own entry file, nowhere else.
    expect(Object.getOwnPropertyNames(globalThis).filter((name) => !before.has(name) && /addition|extension/i.test(name))).toEqual([]);
  });

  it("draws nothing of an addition for someone who isn't signed in: not on the sign-in screen, not its root", async () => {
    const server = await startServer({ mode: "hosted", setup: "done" });
    let mounted = 0;

    expect(server.backend.authenticated).toBe(false);
    page = await renderWith("/login", (_kit, { createElement: h, useEffect }) => [
      { id: "status", root: () => (useEffect(() => void (mounted += 1), []), h("span", { "data-test": "root" }, "root")), topBar: () => h("span", { "data-test": "bar" }, "bar") },
    ]);
    await until(() => expect(document.body.textContent).toContain("Sign in"));
    expect(document.querySelector('[data-test="root"], [data-test="bar"]')).toBeNull();
    expect(mounted).toBe(0);
  });
});

describe("an addition", () => {
  it("is drawn in its three places, and can ask which site is open and who is signed in", async () => {
    const { server, site } = await hosted("editor");
    const counts = { mounted: 0, unmounted: 0 };
    const rendered = await renderWith(`/sites/${site}/c/blog`, (kit, { createElement: h, useEffect }) => [
      {
        id: "status",
        root: () => {
          useEffect(() => {
            counts.mounted += 1;
            return () => void (counts.unmounted += 1);
          }, []);
          return null;
        },
        topBar: () => {
          const account = kit.useAccount();

          return h("span", { "data-test": "bar" }, [kit.useSiteId(), account?.name, account?.role, kit.useRoleMay("publish"), kit.useRoleMay("manage")].join(" | "));
        },
        listRow: ({ siteId, path }: { siteId: string; path: string }) => h("span", { "data-test": "row" }, `${siteId} ${path}`),
      },
    ]);

    page = rendered;
    await until(() => expect(document.querySelectorAll(".app-row").length).toBeGreaterThan(0));
    const editor = server.accounts!.current()!;
    const bar = document.querySelector('[data-test="bar"]')!;

    expect(bar.textContent).toBe(`${site} | ${editor.name} | editor | true | false`);
    // At the right of the top bar, with the account menu still after it.
    expect(bar.parentElement?.matches("header.app-toolbar")).toBe(true);
    expect(bar.nextElementSibling).not.toBeNull();
    expect(bar.previousElementSibling).not.toBeNull();
    // Once in every row, after its title, told which page the row is.
    const rows = [...document.querySelectorAll(".app-row")];

    for (const row of rows) {
      const link = row.querySelector<HTMLAnchorElement>("a.app-row__link")!;
      const added = row.querySelectorAll('[data-test="row"]');

      expect(added).toHaveLength(1);
      expect(added[0]!.textContent).toBe(`${site} ${new URLSearchParams(link.getAttribute("href")!.split("?")[1]).get("path")}`);
      expect(link.nextElementSibling?.contains(added[0]!)).toBe(true);
      // Nothing of an addition is inside the row's link.
      expect(link.querySelector('[data-test="row"]')).toBeNull();
    }
    expect(counts).toEqual({ mounted: 1, unmounted: 0 });

    // Someone else signs in here: what an addition keeps going starts afresh for them.
    const { useMeta } = (await import(/* @vite-ignore */ META)) as { useMeta: { getState(): { meta: { account: { id: string } } }; setState(next: unknown): void } };
    const meta = useMeta.getState().meta;

    await rendered.react.act(async () => useMeta.setState({ meta: { ...meta, account: { ...meta.account, id: "someone-else" } } }));
    expect(counts).toEqual({ mounted: 2, unmounted: 1 });

    // The list is read once, when the app starts: another one handed in later changes nothing.
    await rendered.again([{ id: "later", topBar: () => rendered.react.createElement("span", { "data-test": "later" }, "later") }]);
    expect(document.querySelector('[data-test="later"]')).toBeNull();
    expect(document.querySelector('[data-test="bar"]')).not.toBeNull();
    expect(counts).toEqual({ mounted: 2, unmounted: 1 });
  });

  it("that fails while it draws shows nothing in that place, says so once, and leaves the screen and the other additions", async () => {
    const { site } = await hosted("editor");
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const boom = () => {
      throw new Error("the addition broke");
    };

    page = await renderWith(`/sites/${site}/c/blog`, (_kit, { createElement: h }) => [
      { id: "broken", root: boom, topBar: boom, listRow: boom },
      { id: "fine", topBar: () => h("span", { "data-test": "fine" }, "fine"), listRow: () => h("span", { "data-test": "fine-row" }, "fine") },
    ]);
    await until(() => expect(document.querySelectorAll(".app-row").length).toBeGreaterThan(1));
    const rows = document.querySelectorAll(".app-row").length;

    // The screen is all there: its rows with their titles, the top bar with Proof.
    expect(document.querySelectorAll("a.app-row__link .app-row__title")).toHaveLength(rows);
    expect(document.querySelector("header.app-toolbar")?.textContent).toContain("Proof");
    expect(document.querySelector('[data-test="fine"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-test="fine-row"]')).toHaveLength(rows);
    // Said once for each place, though a row's addition failed in every row.
    expect(saidAbout(errors, "The addition “broken” failed while drawing").sort()).toEqual(["listRow", "root", "topBar"].map((place) => `The addition “broken” failed while drawing in ${place}, so nothing is shown there.`));
  });

  it("is checked once when the app starts: a wrong id, the same id twice or something that isn't a component stops it there", async () => {
    vi.resetModules();
    const { checkedAdditions } = (await import(/* @vite-ignore */ PLACES)) as { checkedAdditions(additions: unknown): ReadonlyArray<Record<string, unknown>> };
    const part = () => null;

    for (const id of ["", "ab", "Status", "1st", "has space", "status/x", "x".repeat(33), undefined, 7]) {
      expect(() => checkedAdditions([{ id, topBar: part }]), String(id)).toThrow(`The addition id “${String(id)}” isn't usable. An id is lower-case letters, digits and dashes, 3 to 32 characters, starting with a letter.`);
    }
    expect(() => checkedAdditions([{ id: "status" }, { id: "status" }])).toThrow("The addition id “status” isn't usable: two additions have it.");
    const { createElement, forwardRef, lazy, memo } = await import("react");
    const notOne = "The addition “status” gives something for topBar that isn't a component. A component is a function, or what memo, forwardRef or lazy return; an element such as <Badge /> is not one.";

    // A string, a number, a plain object, a list, a promise, and an element where the component was meant.
    for (const wrong of ["a badge", 7, true, {}, [part], Promise.resolve(part), createElement(part)]) expect(() => checkedAdditions([{ id: "status", topBar: wrong }]), String(wrong)).toThrow(notOne);
    for (const fine of [part, memo(part), forwardRef(part), lazy(async () => ({ default: part }))]) expect(() => checkedAdditions([{ id: "status", root: fine, topBar: fine, listRow: fine }])).not.toThrow();
    // What the app keeps is its own copy: only the three places, and nothing that can be changed later.
    const given = { id: "status", topBar: part, anything: "else" };
    const kept = checkedAdditions([given]);

    expect(kept).toEqual([{ id: "status", topBar: part }]);
    expect(Object.isFrozen(kept) && Object.isFrozen(kept[0])).toBe(true);
    expect(checkedAdditions(undefined)).toEqual([]);
    expect(checkedAdditions([])).toBe(checkedAdditions(undefined));
  });
});

describe("the live stream with additions", () => {
  it("carries each addition's value from the first time it opens; only a changed value opens it again, quietly, and at most once in five seconds", async () => {
    const { site } = await hosted("editor");
    const opened = recordStreams();
    let reconnects = 0;
    const rendered = await renderWith(`/sites/${site}`, (kit, { useEffect }) => [
      {
        id: "status",
        root: () => {
          // Set as the addition is mounted: before the app asks for its stream.
          useEffect(() => kit.setStreamValue("status", async () => "tab-1"), []);
          return null;
        },
      },
      { id: "second", root: () => (useEffect(() => kit.setStreamValue("second", () => "A-Za-z0-9._~-"), []), null) },
    ]);

    page = rendered;
    const { kit, react } = rendered;
    const { useConnection } = (await import(/* @vite-ignore */ EVENTS)) as { useConnection: { getState(): { state: string } } };

    await until(() => expect(useConnection.getState().state).toBe("open"));
    expect(opened).toEqual(["/api/events?x-status=tab-1&x-second=A-Za-z0-9._~-"]);
    kit.onReconnect(() => void (reconnects += 1));
    const states: string[] = [];
    const unwatch = (useConnection as unknown as { subscribe(listener: (state: { state: string }) => void): () => void }).subscribe((state) => void states.push(state.state));

    // The same value again, as an addition that sets it on every render or after every fetch would: nothing is opened, nobody fetches afresh.
    await react.act(async () => {
      for (let again = 0; again < 3; again += 1) kit.setStreamValue("status", () => "tab-1");
    });
    await pause(react, 400);
    expect([opened.length, reconnects]).toEqual([1, 0]);

    // A value changes while the stream is open: one more stream, with the newest of them.
    await react.act(async () => {
      kit.setStreamValue("status", () => "tab-2");
      kit.setStreamValue("status", () => "tab-3");
    });
    await until(() => expect(opened).toHaveLength(2));
    expect(opened[1]).toBe("/api/events?x-status=tab-3&x-second=A-Za-z0-9._~-");
    await until(() => expect(reconnects).toBe(1));
    // Nothing on the screen said the connection was lost.
    expect(states.filter((state) => state !== "open")).toEqual([]);

    // Changed again at once, and once more a moment later: it is opened a third time with the newest value, and not
    // before five seconds have passed since the second. The gap is read from when the two streams were opened, so a
    // machine too busy to run this test on time makes it longer, never shorter.
    await react.act(async () => void kit.setStreamValue("status", () => "tab-4"));
    await pause(react, 300);
    await react.act(async () => void kit.setStreamValue("status", () => "tab-5"));
    await until(() => expect(opened).toHaveLength(3), 40_000);
    expect(openedAt[2]! - openedAt[1]!).toBeGreaterThanOrEqual(5000 - 100);
    expect(opened[2]).toBe("/api/events?x-status=tab-5&x-second=A-Za-z0-9._~-");
    await until(() => expect(reconnects).toBe(2));
    expect(kit.STREAM_REOPEN_MS).toBe(5000);
    // And that was all: nothing more is opened for values that are now the stream's own.
    await pause(react, 300);
    expect(opened).toHaveLength(3);
    unwatch();
  }, 90_000);

  it("taking a value off opens the stream again without it; taking it off and putting the same one straight back opens nothing", async () => {
    const { site } = await hosted("editor");
    const opened = recordStreams();
    const rendered = await renderWith(`/sites/${site}`, () => [{ id: "status" }]);

    page = rendered;
    const { kit, react } = rendered;

    await until(() => expect(opened).toEqual(["/api/events"]));
    let off: () => void = () => undefined;

    // Set after the stream has opened: it is opened again with the value, at once the first time.
    await react.act(async () => void (off = kit.setStreamValue("status", () => "tab-1")));
    await until(() => expect(opened).toEqual(["/api/events", "/api/events?x-status=tab-1"]));
    // Off and on again with the same value, as an effect that runs again does: once the five seconds are up, nothing is opened.
    await react.act(async () => {
      off();
      off = kit.setStreamValue("status", () => "tab-1");
    });
    await pause(react, kit.STREAM_REOPEN_MS + 400);
    expect(opened).toHaveLength(2);
    // Off for good: opened again without it.
    await react.act(async () => off());
    await until(() => expect(opened).toEqual(["/api/events", "/api/events?x-status=tab-1", "/api/events"]), 40_000);
  }, 90_000);

  it("a listener for the stream coming back that fails doesn't cost the others theirs, the app's own fetching afresh among them", async () => {
    const { server, site } = await hosted("editor");
    const opened = recordStreams();
    const reported = recordReported();
    const ran: string[] = [];
    const rendered = await renderWith(`/sites/${site}`, (kit, { useEffect }) => [
      {
        id: "status",
        // Registered as the addition mounts, which is before the app registers its own: it is first in line.
        root: () => {
          useEffect(
            () =>
              kit.onReconnect(() => {
                ran.push("the failing one");
                throw new Error("an addition's listener broke");
              }),
            [],
          );
          return null;
        },
      },
    ]);

    page = rendered;
    const { kit, react } = rendered;

    await until(() => expect(opened).toHaveLength(1));
    kit.onReconnect(() => void ran.push("the one after it"));
    const fetched = () => server.log.filter((entry) => entry.method === "GET" && (entry.path === "/api/sites" || entry.path === `/api/sites/${site}/changes`)).length;

    await pause(react, 300);
    const before = fetched();

    // The stream is opened again (a value is set), which is a coming back like any other.
    await react.act(async () => void kit.setStreamValue("status", () => "tab-1"));
    await until(() => expect(opened).toHaveLength(2));
    await until(() => expect(ran).toEqual(["the failing one", "the one after it"]));
    // The app's own listener ran too: it asked the server again for what is on screen.
    await until(() => expect(fetched()).toBeGreaterThan(before));
    expect(reported.map((error) => (error as Error).message)).toEqual(["an addition's listener broke"]);
  }, 90_000);

  it("opens nothing for a new value while the stream is down or signed out: the next stream carries it, and a sign-out mid-way opens none", async () => {
    const { site } = await hosted("editor");
    const opened = recordStreams();
    const rendered = await renderWith(`/sites/${site}`, (kit, { useEffect }) => [{ id: "status", root: () => (useEffect(() => kit.setStreamValue("status", () => "tab-1"), []), null) }]);

    page = rendered;
    const { kit, react } = rendered;
    const { useConnection, disconnectEvents, connectEvents } = (await import(/* @vite-ignore */ EVENTS)) as { useConnection: { getState(): { state: string } }; disconnectEvents(): void; connectEvents(): void };

    await until(() => expect(opened).toEqual(["/api/events?x-status=tab-1"]));
    // The connection drops. A value set now opens nothing by itself: the app's own next try is the one stream, and carries it.
    await react.act(async () => sources[0]!.onerror?.());
    expect(useConnection.getState().state).toBe("down");
    await react.act(async () => void kit.setStreamValue("status", () => "tab-2"));
    await pause(react, 300);
    expect(opened).toHaveLength(1);
    await until(() => expect(opened).toEqual(["/api/events?x-status=tab-1", "/api/events?x-status=tab-2"]), 40_000);

    // Signed out while a value is still being worked out: no stream opens when it arrives.
    await react.act(async () => disconnectEvents());
    let give: (value: string) => void = () => undefined;

    kit.setStreamValue("status", () => new Promise<string>((resolve) => (give = resolve)));
    await react.act(async () => connectEvents());
    await pause(react, 100);
    await react.act(async () => disconnectEvents());
    await react.act(async () => give("tab-3"));
    await pause(react, 300);
    expect(opened).toHaveLength(2);
    expect(useConnection.getState().state).toBe("idle");
  }, 90_000);

  it("isn't held up by a value that never comes, and leaves out one that isn't a value", async () => {
    const { site } = await hosted("editor");
    const opened = recordStreams();
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // When the app asked for the slow value, and a timer set at that same moment for a second and a half past the two
    // seconds a value has: the stream must open before that timer runs. Both wait in the same queue, so a machine too
    // busy to run timers on time delays both, and the order still says whether the wait was the two seconds.
    const asked = { at: 0, tooLate: false };
    const rendered = await renderWith(`/sites/${site}`, (kit, { useEffect }) => [
      {
        id: "slow",
        root: () => (
          useEffect(
            () =>
              kit.setStreamValue("slow", () => {
                asked.at = Date.now();
                setTimeout(() => (asked.tooLate = true), 2000 + 1500);
                return new Promise<string>(() => undefined);
              }),
            [],
          ),
          null
        ),
      },
      { id: "wrong", root: () => (useEffect(() => kit.setStreamValue("wrong", () => "not a value"), []), null) },
      { id: "failing", root: () => (useEffect(() => kit.setStreamValue("failing", () => Promise.reject(new Error("no id yet"))), []), null) },
      { id: "none", root: () => (useEffect(() => kit.setStreamValue("none", () => null), []), null) },
      { id: "fine", root: () => (useEffect(() => kit.setStreamValue("fine", () => "tab-1"), []), null) },
    ]);

    page = rendered;
    await until(() => expect(opened).toHaveLength(1), 40_000);
    // It waited for the slow one: its two seconds, and no longer. (The app's own two seconds start a moment before it
    // asks for the value, and a busy machine stretches that moment: so "waited" is most of two seconds, and "no longer"
    // is the timer above.)
    expect(openedAt[0]! - asked.at).toBeGreaterThanOrEqual(1500);
    expect(asked.tooLate).toBe(false);
    expect(rendered.kit.STREAM_VALUE_MS).toBe(2000);
    expect(opened).toEqual(["/api/events?x-fine=tab-1"]);
    expect(saidAbout(errors, "The stream's value for").sort()).toEqual(["The stream's value for “failing” couldn't be worked out", "The stream's value for “wrong” isn't usable: it is 1 to 128 letters, digits, dots, dashes, underscores or tildes."]);
    expect(() => rendered.kit.setStreamValue("Not An Id", () => "x")).toThrow("“Not An Id” isn't an extension's id.");
  });

  it("hands an addition its own events by name, and one handler that fails doesn't keep an event from the others", async () => {
    const { site, emit } = await hosted("editor");
    const reported = recordReported();
    const heard: unknown[] = [];
    const rendered = await renderWith(`/sites/${site}`, () => []);

    page = rendered;
    const { kit, react } = rendered;
    const { useConnection, subscribe } = (await import(/* @vite-ignore */ EVENTS)) as { useConnection: { getState(): { state: string } }; subscribe(type: string, handler: (event: unknown) => void): () => void };

    await until(() => expect(useConnection.getState().state).toBe("open"));
    kit.subscribeExtension("status", "changed", () => {
      throw new Error("the first handler broke");
    });
    kit.subscribeExtension("status", "changed", (event) => void heard.push(event));
    kit.subscribeExtension("status", "stream.refused", (event) => void heard.push(event));
    kit.subscribeExtension("other", "changed", () => void heard.push("another extension's"));
    const stop = kit.subscribeExtension("status", "changed", () => void heard.push("stopped listening"));

    stop();
    // The same holds for the app's own events: a handler of one screen that fails doesn't cost the others theirs.
    subscribe("site.updated", () => {
      throw new Error("a screen's handler broke");
    });
    subscribe("site.updated", () => void heard.push("site.updated"));
    await react.act(async () => {
      emit({ type: "extension", source: "status", name: "changed", siteId: site, payload: { note: "one" } });
      emit({ type: "extension", source: "status", name: "changed", siteId: site, payload: { note: "two" } });
      emit({ type: "extension", source: "status", name: "stream.refused", siteId: "", payload: { code: "forbidden", message: "Not that one." } });
      emit({ type: "site.updated", siteId: "another-site" });
    });
    expect(heard).toEqual([{ siteId: site, payload: { note: "one" } }, { siteId: site, payload: { note: "two" } }, { siteId: "", payload: { code: "forbidden", message: "Not that one." } }, "site.updated"]);
    // Reported the way an uncaught error is, once for each handler though one of them failed at two events.
    expect(reported.map((error) => (error as Error).message)).toEqual(["the first handler broke", "a screen's handler broke"]);
    // The same handler failing in another way is new, and is reported.
    let how = "one way";

    subscribe("sites.updated", () => {
      throw new Error(how);
    });
    await react.act(async () => {
      emit({ type: "sites.updated" });
      emit({ type: "sites.updated" });
      how = "another way";
      emit({ type: "sites.updated" });
    });
    expect(reported.slice(2).map((error) => (error as Error).message)).toEqual(["one way", "another way"]);
  });
});

describe("an addition's own routes", () => {
  it("are called by their parts, each encoded, with the server's refusal in its own words", async () => {
    vi.resetModules();
    const calls: Array<{ url: string; method: string; body: string | null; contentType: string | null }> = [];
    let answer: () => Response = () => Response.json({ waiting: 3 });

    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? "GET", body: (init.body as string | undefined) ?? null, contentType: (init.headers as Record<string, string>)["content-type"] ?? null });
      return answer();
    });
    const kit = (await import(/* @vite-ignore */ KIT)) as Kit;
    const { setUnauthorizedHandler } = (await import(/* @vite-ignore */ API)) as { setUnauthorizedHandler(handler: (() => void) | null): void };
    const status = kit.extensionApi("status");
    let lost = 0;

    setUnauthorizedHandler(() => void (lost += 1));
    expect(await status.get(["sites", "site 1/../x", "note"], { since: 5, all: true, none: undefined })).toEqual({ waiting: 3 });
    expect(await status.post(["sites", "s1", "note"], { text: "Ready" })).toEqual({ waiting: 3 });
    await status.put(["a"], [1]);
    await status.patch(["a"]);
    await status.delete(["a"]);
    expect(calls).toEqual([
      { url: "/api/x/status/sites/site%201%2F..%2Fx/note?since=5&all=true", method: "GET", body: null, contentType: null },
      { url: "/api/x/status/sites/s1/note", method: "POST", body: '{"text":"Ready"}', contentType: "application/json" },
      { url: "/api/x/status/a", method: "PUT", body: "[1]", contentType: "application/json" },
      { url: "/api/x/status/a", method: "PATCH", body: "{}", contentType: "application/json" },
      { url: "/api/x/status/a", method: "DELETE", body: null, contentType: null },
    ]);
    // An address is parts, never a path of the caller's making.
    for (const parts of [[], ["sites", ""], ["sites", ".."], ["."], "sites/s1"]) expect(() => kit.extensionUrl("status", parts as string[]), JSON.stringify(parts)).toThrow("A route's address is given as its parts, each a word of its own.");
    expect(() => kit.extensionApi("Status")).toThrow("“Status” isn't an extension's id.");

    // A refusal is thrown in the server's words; only "not signed in" sends the person to sign in.
    answer = () => Response.json({ error: { code: "forbidden", message: "A note is for those who publish." } }, { status: 403 });
    await expect(status.post(["sites", "s1", "note"], {})).rejects.toMatchObject({ name: "ApiFailure", status: 403, message: "A note is for those who publish.", shape: { code: "forbidden" } });
    expect(lost).toBe(0);
    answer = () => Response.json({ error: { code: "unauthorized", message: "Sign in to continue." } }, { status: 401 });
    await expect(status.get(["sites", "s1"])).rejects.toMatchObject({ status: 401 });
    expect(lost).toBe(1);
    answer = () => new Response(null, { status: 204 });
    expect(await status.delete(["a"])).toBeUndefined();
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("network down");
    });
    await expect(status.get(["a"])).rejects.toMatchObject({ status: 0, message: "Can’t reach the app’s server. Check that it’s still running, then try again." });
    setUnauthorizedHandler(null);
  });
});

describe("other people's words in an addition", () => {
  it("are shown as text, or as a small Markdown with nothing in it that runs or loads", async () => {
    vi.resetModules();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const [react, { createRoot }, kit] = await Promise.all([import("react"), import("react-dom/client"), import(/* @vite-ignore */ KIT) as Promise<Kit>]);
    const container = document.createElement("div");
    const words = 'A **note** <script>window.hacked = 1</script> <img src="x" onerror="window.hacked = 1"> ![a picture](https://example.com/p.png) [a link](https://example.com/page) [a trap](javascript:window.hacked=1) <a href="https://example.com/raw" onclick="window.hacked = 1">raw</a>';

    document.body.replaceChildren(container);
    const root = createRoot(container);

    page = {
      unmount: async () => {
        await react.act(async () => root.unmount());
      },
    };
    await react.act(async () => root.render(react.createElement("div", null, react.createElement(kit.SafeText as never, { text: words, className: "plain" }), react.createElement(kit.SafeMarkdown as never, { text: words }))));
    // As text: the words as they were written, and not one element made from them.
    const plain = container.querySelector(".plain")!;

    expect(plain.textContent).toBe(words);
    expect(plain.children).toHaveLength(0);
    expect(plain.className).toBe("app-safe-text plain");
    // As Markdown, once its renderer has loaded.
    await until(() => expect(container.querySelector(".app-safe-md")).not.toBeNull());
    const shown = container.querySelector(".app-safe-md")!;

    expect(shown.querySelector("strong")?.textContent).toBe("note");
    expect(shown.querySelectorAll("script, img, style, form, input, button, iframe")).toHaveLength(0);
    // Raw HTML is shown as the text it was typed as: no element carries anything that runs.
    expect([...shown.querySelectorAll("*")].flatMap((element) => element.getAttributeNames()).filter((name) => name.startsWith("on"))).toEqual([]);
    expect(shown.textContent).toContain('<img src="x" onerror="window.hacked = 1">');
    // Only the Markdown link to a web address is a link, and it opens apart from this window.
    const links = [...shown.querySelectorAll("a")];

    expect(links.map((link) => [link.getAttribute("href"), link.getAttribute("target"), link.getAttribute("rel")])).toEqual([["https://example.com/page", "_blank", "noopener noreferrer"]]);
    expect(shown.textContent).toContain("a picture");
    expect((globalThis as { hacked?: number }).hacked).toBeUndefined();
  });

  it("keep only links to web and mail addresses, however a link is written", async () => {
    vi.resetModules();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const [react, { createRoot }, kit] = await Promise.all([import("react"), import("react-dom/client"), import(/* @vite-ignore */ KIT) as Promise<Kit>]);
    const container = document.createElement("div");
    const words = [
      // Each of these would run a script or load a page of the writer's making if it became a link.
      "An autolink <javascript:window.hacked=1> and another <data:text/html,hello>.",
      "[capitals](JAVASCRIPT:window.hacked=1) [entities](&#106;avascript:window.hacked=1) [data](data:text/html;base64,aGk=) [vb](vbscript:msgbox) [file](file:///etc/passwd) [here](/api/auth/logout-all) [protocol-less](//evil.example/x)",
      "[by reference][trap] and [a good one][fine], and mail to [someone](mailto:someone@example.com).",
      "",
      "[trap]: javascript:window.hacked=1",
      "[fine]: https://example.com/reference",
    ].join("\n");

    document.body.replaceChildren(container);
    const root = createRoot(container);

    page = {
      unmount: async () => {
        await react.act(async () => root.unmount());
      },
    };
    await react.act(async () => root.render(react.createElement(kit.SafeMarkdown as never, { text: words })));
    await until(() => expect(container.querySelector(".app-safe-md")).not.toBeNull());
    const shown = container.querySelector(".app-safe-md")!;

    expect([...shown.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual(["https://example.com/reference", "mailto:someone@example.com"]);
    for (const link of shown.querySelectorAll("a")) expect([link.getAttribute("target"), link.getAttribute("rel")]).toEqual(["_blank", "noopener noreferrer"]);
    // What was not made a link is still there to read.
    for (const label of ["capitals", "entities", "data", "by reference", "protocol-less"]) expect(shown.textContent).toContain(label);
    expect((globalThis as { hacked?: number }).hacked).toBeUndefined();
  });
});

describe("an addition's place in a row and on the screen", () => {
  // The tests run from the web package's folder; a page's address is not a file's here.
  const CONTENT_CSS = readFileSync(join(process.cwd(), "src/styles/content.css"), "utf8");
  const rule = (selector: string) => [...CONTENT_CSS.matchAll(new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`, "g"))].map((match) => match[2]).join(";");

  it("can be pointed at and clicked: it is raised over the row's link, which is stretched across the whole row", () => {
    // Why it needs raising: the link's own box covers the row.
    expect(rule(".app-row__link::after")).toMatch(/position: absolute; inset: 0/);
    expect(rule(".app-row__additions")).toMatch(/position: relative; z-index: var\(--z-raised\)/);
    // As the row's own menu is.
    expect(rule(".app-row__menu, .app-row__thumb, .app-row__status")).toMatch(/position: relative; z-index: var\(--z-raised\)/);
  });

  it("wraps a row only when some addition draws in rows: one that draws in the top bar alone leaves every row as it was", async () => {
    const { site } = await hosted("editor");

    page = await renderWith(`/sites/${site}/c/blog`, (_kit, { createElement: h }) => [{ id: "status", topBar: () => h("span", { "data-test": "bar" }, "bar") }]);
    await until(() => expect(document.querySelectorAll(".app-row").length).toBeGreaterThan(0));
    expect(document.querySelector('[data-test="bar"]')).not.toBeNull();
    expect(document.querySelector(".app-row__with-additions, .app-row__additions")).toBeNull();
    for (const row of document.querySelectorAll(".app-row")) expect(row.querySelector(":scope > a.app-row__link")).not.toBeNull();
  });

  it("that waits for something (a lazy component, a promise it reads) shows nothing meanwhile, and the screen is there", async () => {
    const { site } = await hosted("editor");
    const never = new Promise<never>(() => undefined);

    page = await renderWith(`/sites/${site}/c/blog`, (_kit, { createElement: h, lazy, use }) => [
      // Loaded on demand, and never arriving.
      { id: "waiting", root: lazy(() => never), topBar: lazy(() => never), listRow: lazy(() => never) },
      // Reads a promise that never settles while it draws.
      { id: "reading", topBar: () => use(never), listRow: () => use(never) },
      { id: "fine", topBar: () => h("span", { "data-test": "fine" }, "fine"), listRow: () => h("span", { "data-test": "fine-row" }, "fine") },
    ]);
    await until(() => expect(document.querySelectorAll(".app-row").length).toBeGreaterThan(1));
    const rows = document.querySelectorAll(".app-row").length;

    // The screen was not replaced by its loading state: its rows with their titles, the top bar with Proof, and the other addition.
    expect(document.querySelectorAll("a.app-row__link .app-row__title")).toHaveLength(rows);
    expect(document.querySelector("header.app-toolbar")?.textContent).toContain("Proof");
    expect(document.querySelector('[data-test="fine"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-test="fine-row"]')).toHaveLength(rows);
  });
});
