/**
 * Embedding: what a wrong declaration does. Each stops the start with one
 * sentence that names the extension; nothing is left for the first person
 * who calls the route to find.
 */
import { describe, expect, it } from "vitest";
import { checkExtensions, declaredRoutes, defineExtension, EXTENSION_BODY_LIMIT, ExtensionError } from "../../src/extensions/declare";
import { isJson } from "../../src/extensions/mount";
import { assertRouter, callNow, oneLine, scrubberFor } from "../../src/extensions/run";
import { guardSite, unreadable } from "../../src/extensions/site";
import type { ExtensionRoute, ServerExtension } from "../../src/extensions";
import { ROUTE_ACCESS } from "@galley/core/install";
import type { SiteService } from "@galley/core/types";
import { fakeSite, testApp } from "../helpers";

const setup = () => ({});
const get: ExtensionRoute = { access: "edit", handle: () => null };
const post: ExtensionRoute<unknown> = { access: "edit", body: (input) => input, handle: () => null };
const routes = (table: Record<string, unknown>) => () => declaredRoutes("status", { routes: table as Record<string, ExtensionRoute> });

describe("what an extension declares", () => {
  it("has an id of its own, well formed", () => {
    for (const id of ["x", "ab", "Status", "1status", "status-", "a".repeat(33), "sta tus", "", undefined, 7]) {
      expect(() => checkExtensions([{ id, setup } as unknown as ServerExtension]), String(id)).toThrow(/^The extension id “.*” isn't usable: it is 3 to 32 lower-case letters/);
    }
    expect(() => checkExtensions([defineExtension({ id: "status", setup }), defineExtension({ id: "status", setup })])).toThrow("The extension id “status” isn't usable: two extensions have it.");
    expect(() => checkExtensions([{ id: "status" } as unknown as ServerExtension])).toThrow("Extension “status” couldn't start: it has no setup.");
    expect(() => checkExtensions([defineExtension({ id: "status", secrets: ["STATUS_API_KEY", "not a name"], setup })])).toThrow("Extension “status”: “not a name” isn't the name of an environment variable.");
    expect(() => checkExtensions([defineExtension({ id: "status", secrets: ["STATUS_API_KEY"], setup }), defineExtension({ id: "a-2nd-one", setup })])).not.toThrow();
  });

  it("names each route by a method and a path of its own, and can name no other address", () => {
    for (const key of ["/sites", "GET", "GET sites", "FETCH /sites", "get /sites", "GET /", "GET /sites/", "GET //sites", "GET /sites/../people", "GET /sites/*", "GET /Sites", "GET /sites/:", "GET /sites/:site-id", "GET /a/:id/b/:id", "GET /a/b/c/d/e/f/g/h/i", "GET https://example.com/x", "GET /sites?x=1", "GET /a b", "OPTIONS /sites", "HEAD /sites"]) {
      expect(routes({ [key]: get }), key).toThrow(new RegExp(`^Extension “status”: the route “.*” isn't a route\\.`));
    }
    const declared = declaredRoutes("status", { routes: { "GET /sites/:siteId/notes/:name": get, "DELETE /notes/:name": get, "POST /note": post } });

    expect(declared.map((route) => [route.method, route.path, route.siteScoped])).toEqual([
      ["GET", "/api/x/status/sites/:siteId/notes/:name", true],
      ["DELETE", "/api/x/status/notes/:name", false],
      ["POST", "/api/x/status/note", false],
    ]);
    // Whatever the key, the address begins with the extension's own prefix.
    expect(declared.every((route) => route.path.startsWith("/api/x/status/"))).toBe(true);
    expect(routes({ "GET /sites": null })).toThrow(/isn't a route/);
    expect(routes({ "GET /sites": { access: "edit" } })).toThrow(/isn't a route/);
  });

  it("gives every route a level, and only one of the three", () => {
    for (const access of [undefined, "public", "setup", "restore", "owner", "", null, true]) {
      expect(routes({ "GET /sites": { ...get, access } }), String(access)).toThrow("Extension “status”: the route “GET /sites” has no access level. It is edit, publish or manage.");
    }
    for (const access of ["edit", "publish", "manage"]) expect(routes({ "GET /sites": { ...get, access } })).not.toThrow();
  });

  it("says how a body is read where there is one, and takes none where there isn't", () => {
    const refusal = /must say how its body is read/;

    for (const method of ["POST", "PUT", "PATCH"]) expect(routes({ [`${method} /note`]: get }), method).toThrow(refusal);
    for (const method of ["GET", "DELETE"]) expect(routes({ [`${method} /note`]: post }), method).toThrow(refusal);
    expect(routes({ "GET /note": { ...get, bodyLimit: 10 } })).toThrow(refusal);
    for (const bodyLimit of [0, -1, 1.5, EXTENSION_BODY_LIMIT + 1, Number.NaN]) expect(routes({ "POST /note": { ...post, bodyLimit } }), String(bodyLimit)).toThrow(refusal);
    expect(declaredRoutes("status", { routes: { "POST /note": post, "PUT /note": { ...post, bodyLimit: 512 } } }).map((route) => route.bodyLimit)).toEqual([EXTENSION_BODY_LIMIT, 512]);
    expect(routes({ "POST /note": { ...post, person: false } })).toThrow(/person is true or left out/);
  });

  it("no route of the editor's own is under the prefix added routes live in", () => {
    expect(Object.keys(ROUTE_ACCESS).filter((key) => key.split(" ")[1]!.startsWith("/api/x/") || key.split(" ")[1] === "/api/x")).toEqual([]);
  });

  it("is refused where a hosted server has no accounts: every level would be anyone signed in", () => {
    expect(() => testApp({ site: fakeSite() }, { mode: "hosted", extensions: { list: [], desk: null } })).toThrow(ExtensionError);
    expect(() => testApp({ site: fakeSite() }, { mode: "hosted", extensions: { list: [], desk: null } })).toThrow(/^Extensions need accounts in hosted mode/);
    expect(() => testApp({ site: fakeSite() }, { extensions: { list: [], desk: null } })).not.toThrow();
  });
});

describe("what the server does around an extension", () => {
  it("knows the router it runs on: the guards on added routes are written for how it reads an address", async () => {
    await expect(assertRouter()).resolves.toBeUndefined();
  });

  it("sends only what is JSON as it stands", () => {
    for (const fine of [null, true, 0, -1.5, "", "text", [], [1, [2, [3]]], {}, { a: { b: [null, "c"] } }, Object.create(null)]) expect(isJson(fine), JSON.stringify(fine)).toBe(true);
    const loop: unknown[] = [];

    loop.push(loop);
    for (const odd of [undefined, 10n, Number.NaN, Number.POSITIVE_INFINITY, () => 1, Symbol("s"), new Date(), new Map(), new Response("x"), Promise.resolve(1), loop, { a: undefined }, [() => 1], new (class Note {})()]) expect(isJson(odd), String(odd)).toBe(false);
    // The same value twice is not a loop.
    const shared = { n: 1 };

    expect(isJson({ a: shared, b: shared, c: [shared, shared] })).toBe(true);
  });

  it("keeps a log line to one line and takes declared secrets out of it", () => {
    expect(oneLine("first\nGET /api/people 200\r\nthird fourth\tfifth\u0000")).toBe("first GET /api/people 200 third fourth fifth ");
    const scrub = scrubberFor(["STATUS_API_KEY", "STATUS_OTHER", "STATUS_UNSET", "STATUS_SHORT"], { STATUS_API_KEY: "key-0123456789", STATUS_OTHER: "key-0123456789-longer", STATUS_SHORT: "abc" });

    expect(scrub("a key-0123456789-longer b key-0123456789 c abc")).toBe("a ••• b ••• c abc");
    expect(scrubberFor([], {})("unchanged")).toBe("unchanged");
  });

  it("refuses a promise where an answer is expected at once, and a failure never escapes", async () => {
    const lines: string[] = [];
    const log = (line: string) => void lines.push(line);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => void unhandled.push(reason);

    process.on("unhandledRejection", onUnhandled);
    try {
      expect(callNow(log, "status", "a listener", () => 7)).toEqual({ ok: true, value: 7 });
      expect(callNow(log, "status", "a listener", () => { throw new Error("broke\nGET /api/people 200"); })).toEqual({ ok: false });
      expect(callNow(log, "status", "a listener", async () => 7)).toEqual({ ok: false });
      expect(callNow(log, "status", "a listener", async () => { throw new Error("later"); })).toEqual({ ok: false });
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
    expect(lines).toEqual([
      "[status] a listener failed: broke GET /api/people 200",
      "[status] a listener answered with a promise. It has to answer at once, so its answer was not used.",
      "[status] a listener answered with a promise. It has to answer at once, so its answer was not used.",
      "[status] a listener failed later: later",
    ]);
  });

  it("guards a site by lists, not by trust: what isn't on one isn't handed", () => {
    const calls: string[] = [];
    const real = { id: "s1", readFile: (path: string) => (calls.push(`read ${path}`), "content"), writeFile: (path: string) => (calls.push(`write ${path}`), undefined), dispose: () => void calls.push("dispose"), somethingNew: () => void calls.push("new"), preview: { start: () => "started" } } as unknown as SiteService;
    const whole = guardSite(real, { readOnly: false }) as unknown as Record<string, (...args: unknown[]) => unknown> & { id: string; preview: { start(): string } };
    const reading = guardSite(real, { readOnly: true }) as unknown as typeof whole;

    expect(whole.id).toBe("s1");
    expect(whole.readFile!("a.md")).toBe("content");
    whole.writeFile!("a.md");
    expect(whole.preview.start()).toBe("started");
    expect("dispose" in whole || "somethingNew" in whole).toBe(false);
    expect(() => reading.writeFile!("a.md")).toThrow(/A GET route can't change a site/);
    expect(() => reading.preview).toThrow(/A GET route can't change a site/);
    expect(() => whole.readFile!(".env")).toThrow("That file can't be shown here.");
    expect(calls).toEqual(["read a.md", "write a.md"]);
    expect(Object.isFrozen(whole)).toBe(true);
    for (const path of [".env", ".ENV", "a/.env.production", ".git", ".git/config", "a\\.git\\HEAD", "A/.GIT/x"]) expect(unreadable(path), path).toBe(true);
    for (const path of ["env", "a.env", ".environment", ".github/workflows/ci.yml", "src/git/.keep", ".gitignore", 7, undefined]) expect(unreadable(path), String(path)).toBe(false);
  });
});
