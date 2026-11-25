/**
 * Embedding: what a wrong declaration does. Each stops the start with one
 * sentence that names the extension; nothing is left for the first person
 * who calls the route to find.
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkExtensions, declaredRoutes, defineExtension, EXTENSION_BODY_LIMIT, ExtensionError } from "../../src/extensions/declare";
import { isJson } from "../../src/extensions/mount";
import { assertRouter, callNow, oneLine, scrubberFor, startExtensions } from "../../src/extensions/run";
import type { PeopleDesk } from "../../src/extensions/people";
import { copyOf, duringGet, guardSite, LINKS_AT_ONCE, STOPPED, unreadable } from "../../src/extensions/site";
import { undoEach } from "../../src/teardown";
import type { ExtensionHost, ExtensionRoute, ServerExtension } from "../../src/extensions";
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
    // A variable every program needs is no secret: hidden, the site's preview wouldn't start, and its value would be struck out of every log line.
    for (const name of ["PATH", "HOME", "NODE_OPTIONS", "path", "Tmpdir", "SHLVL", "JAVA_HOME", "NODE_EXTRA_CA_CERTS", "SystemDrive", "LC_MESSAGES", "XDG_CONFIG_HOME", "LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH", "npm_config_registry"]) {
      expect(() => checkExtensions([defineExtension({ id: "status", secrets: [name], setup })]), name).toThrow(`Extension “status”: ${name} can't be named as a secret.`);
    }
    // A proxy's address can carry a password: it may be named.
    expect(() => checkExtensions([defineExtension({ id: "status", secrets: ["HTTPS_PROXY", "STATUS_LD_KEY", "MY_PATH"], setup })])).not.toThrow();
    // A name on its own, not in a list, would be read letter by letter and hide nothing.
    expect(() => checkExtensions([{ id: "status", secrets: "STATUS_API_KEY", setup } as unknown as ServerExtension])).toThrow("Extension “status”: its secrets are a list of the names of environment variables.");
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

  it("nothing the editor itself serves is under the prefix added routes live in", () => {
    expect(Object.keys(ROUTE_ACCESS).filter((key) => key.split(" ")[1]!.startsWith("/api/x/") || key.split(" ")[1] === "/api/x")).toEqual([]);
    // Every address the app really has, the ones outside that table included, in both modes.
    for (const mode of ["local", "hosted"] as const) {
      const paths = testApp({ site: fakeSite() }, mode === "hosted" ? { mode } : {}).app.routes.map((route) => route.path);

      expect(paths.length).toBeGreaterThan(100);
      expect(paths.filter((path) => path.toLowerCase().startsWith("/api/x")), mode).toEqual([]);
    }
  });

  it("is refused where a hosted server has no accounts: every level would be anyone signed in", () => {
    const none = { runtime: { ids: [], list: [], find: () => undefined, secretEnv: [], streamOpened: () => ({ refused: null, ended: () => undefined }), stop: async () => undefined, stopForNow: async () => undefined, restart: async () => [], endStreams: () => undefined }, desk: null };

    expect(() => testApp({ site: fakeSite() }, { mode: "hosted", extensions: none })).toThrow(ExtensionError);
    expect(() => testApp({ site: fakeSite() }, { mode: "hosted", extensions: none })).toThrow(/^Extensions need accounts in hosted mode/);
    expect(() => testApp({ site: fakeSite() }, { extensions: none })).not.toThrow();
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
    expect(oneLine("first\nGET /api/people 200\r\nthird\u2028fourth\tfifth\u0000")).toBe("first GET /api/people 200 third fourth fifth ");
    // The other set of control characters too: a "next line", and the one that starts a terminal's commands.
    expect(oneLine("one\u0085two\u009b31mthree")).toBe("one two 31mthree");
    const scrub = scrubberFor(["STATUS_API_KEY", "STATUS_OTHER", "STATUS_UNSET", "STATUS_SHORT"], { STATUS_API_KEY: "key-0123456789", STATUS_OTHER: "key-0123456789-longer", STATUS_SHORT: "abc" });

    expect(scrub("a key-0123456789-longer b key-0123456789 c abc")).toBe("a ••• b ••• c abc");
    expect(scrubberFor([], {})("unchanged")).toBe("unchanged");
    // Where the server was handed an environment of its own, the process's is read as well: that is where an extension reads.
    expect(scrubberFor(["STATUS_API_KEY"], {}, { STATUS_API_KEY: "from-the-process" })("x from-the-process y")).toBe("x ••• y");
    expect(scrubberFor(["STATUS_API_KEY"], { STATUS_API_KEY: "handed-to-the-server" }, { STATUS_API_KEY: "from-the-process" })("handed-to-the-server from-the-process")).toBe("••• •••");
    // Its limits, as the docs give them: under six characters, and any encoded form, are left.
    expect(scrubberFor(["STATUS_API_KEY"], { STATUS_API_KEY: "a b/c+d" })(`a b/c+d ${encodeURIComponent("a b/c+d")}`)).toBe("••• a%20b%2Fc%2Bd");
  });

  it("refuses a promise where an answer is expected at once, and a failure never escapes", async () => {
    const lines: string[] = [];
    // The extension's own line: its id in front, one line, its secrets out (run.ts makes one for each extension).
    const say = (line: string) => void lines.push(`[status] ${scrubberFor(["STATUS_API_KEY"], { STATUS_API_KEY: "key-0123456789" })(oneLine(line))}`);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => void unhandled.push(reason);

    process.on("unhandledRejection", onUnhandled);
    try {
      expect(callNow(say, "a listener", () => 7)).toEqual({ ok: true, value: 7 });
      expect(callNow(say, "a listener", () => { throw new Error("broke\nGET /api/people 200 key-0123456789"); })).toEqual({ ok: false });
      expect(callNow(say, "a listener", async () => 7)).toEqual({ ok: false });
      expect(callNow(say, "a listener", async () => { throw new Error("later key-0123456789"); })).toEqual({ ok: false });
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
    expect(lines).toEqual([
      "[status] a listener failed: broke GET /api/people 200 •••",
      "[status] a listener answered with a promise. It has to answer at once, so its answer was not used.",
      "[status] a listener answered with a promise. It has to answer at once, so its answer was not used.",
      "[status] a listener failed later: later •••",
    ]);
  });

  it("guards a site by lists, not by trust: what isn't on one isn't handed", () => {
    const calls: string[] = [];
    const real = { id: "s1", root: "/nowhere", resolvePath: (path: string) => `/nowhere/${path}`, readFile: (path: string) => (calls.push(`read ${path}`), "content"), writeFile: (path: string) => (calls.push(`write ${path}`), undefined), dispose: () => void calls.push("dispose"), somethingNew: () => void calls.push("new"), preview: { start: () => "started" } } as unknown as SiteService;
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
    // A site handed out earlier refuses too while a GET is being handled, and whatever that GET started.
    expect(() => duringGet(() => whole.writeFile!("b.md"))).toThrow(/A GET route can't change a site/);
    expect(calls).toEqual(["read a.md", "write a.md"]);
    expect(Object.isFrozen(whole)).toBe(true);
    for (const path of [".env", ".ENV", "a/.env.production", ".envrc", "a/.env-production", ".env_local", "a\\.Envrc", ".git", ".git/config", "a\\.git\\HEAD", "A/.GIT/x"]) expect(unreadable(path), path).toBe(true);
    // A name that starts with ".env" is taken for a secrets file even when it is something else: the side to err on.
    for (const path of [".environment", ".envoy.yaml"]) expect(unreadable(path), path).toBe(true);
    for (const path of ["env", "a.env", "src/env.d.ts", "docs/my.env.md", ".github/workflows/ci.yml", "src/git/.keep", ".gitignore", 7, undefined]) expect(unreadable(path), String(path)).toBe(false);
  });

  it("refuses every read that names a file, leaves unreadable files out of a search, and answers each read with a copy", async () => {
    const model = { writable: { content: ["src/content/**"] }, adapter: { name: "x", detect: () => true } };
    const hits = [{ path: "src/a.md", line: 1, text: "ok" }, { path: ".env", line: 1, text: "KEY=1" }, { path: "sub/.git/config", line: 2, text: "x" }];
    const bytes = new Uint8Array([1, 2, 3]);
    const real = {
      id: "s1",
      root: "/nowhere",
      resolvePath: (path: string) => `/nowhere/${path}`,
      model: async () => model,
      readBase: async () => bytes,
      diff: async (path: string) => ({ path }),
      readEntry: async (path: string) => ({ path }),
      readFile: async (path: string) => ({ content: path }),
      grepText: async () => hits,
      listFiles: async () => ["a.md"],
    } as unknown as SiteService;
    const guarded = guardSite(real, { readOnly: false }) as unknown as { [name: string]: (...args: unknown[]) => Promise<any> };

    for (const name of ["readFile", "readBase", "diff", "readEntry", "resolvePath"]) {
      for (const path of [".env", "a/.env.local", ".envrc", "a/.env-production", ".env_local", ".ENV", ".git/HEAD"]) expect(() => guarded[name]!(path), `${name} ${path}`).toThrow("That file can't be shown here.");
      // A name that only has "env" in it is an ordinary file.
      for (const path of ["src/env.d.ts", "environment.md", "docs/my.env.md"]) expect(() => guarded[name]!(path), `${name} ${path}`).not.toThrow();
    }
    expect(await guarded.grepText!("KEY")).toEqual([hits[0]]);
    // Copies: nothing done to an answer reaches the engine's own, not even where the answer holds a function.
    const copy = (await guarded.model!()) as typeof model;

    copy.writable.content.push("**/*");
    copy.adapter.name = "changed";
    expect(model.writable.content).toEqual(["src/content/**"]);
    expect(model.adapter.name).toBe("x");
    expect(copy.adapter.detect).toBe(model.adapter.detect);
    const base = (await guarded.readBase!("a.md")) as Uint8Array;

    base[0] = 9;
    expect([...bytes]).toEqual([1, 2, 3]);
    expect((await guarded.grepText!("ok"))[0]).not.toBe(hits[0]);
    expect(copyOf("text")).toBe("text");
    expect(copyOf(null)).toBeNull();
  });


  it("copies what a change answers with too, hands a controller as it is, and keeps a file's bytes a file's bytes", async () => {
    const model = { writable: { content: ["src/content/**"] } };
    const controller = { start: () => "started", status: { state: "stopped" } };
    const whole = Buffer.from("hello, this is a larger buffer than the part handed out");
    const real = { id: "s1", root: "/nowhere", resolvePath: (path: string) => `/nowhere/${path}`, refresh: async () => model, saveConfig: async () => model, preview: () => controller, checkpoint: () => controller, readBase: async () => whole.subarray(0, 5) } as unknown as SiteService;
    const guarded = guardSite(real, { readOnly: false }) as unknown as { [name: string]: (...args: unknown[]) => any };

    for (const change of ["refresh", "saveConfig"]) {
      const answered = (await guarded[change]!()) as typeof model;

      expect(answered).toEqual(model);
      answered.writable.content.push("**/*");
    }
    expect(model.writable.content).toEqual(["src/content/**"]);
    // A thing to drive, not data: the engine's own, working, behind the site's guards.
    const preview = guarded.preview!() as typeof controller;

    expect(preview).not.toBe(controller);
    expect(preview.start()).toBe("started");
    expect(preview.status).toEqual({ state: "stopped" });
    expect(preview.status).not.toBe(controller.status);
    // What it is can't be changed from outside.
    expect(() => void ((preview as { start: unknown }).start = () => "mine")).toThrow(TypeError);
    expect(controller.start()).toBe("started");
    // A file's bytes: still a Buffer (it reads as text), only the bytes that were handed, and not the engine's own memory.
    const bytes = (await guarded.readBase!("a.md")) as Buffer;

    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(bytes.toString()).toBe("hello");
    // Memory of its own and exactly its size: not the engine's, and not a pool shared with whatever else was read lately.
    expect(bytes.buffer).not.toBe(whole.buffer);
    expect(bytes.buffer.byteLength).toBe(5);
    expect(bytes.byteOffset).toBe(0);
    bytes[0] = 0x48;
    expect(whole.toString().startsWith("hello")).toBe(true);
    const view = new Uint16Array(new ArrayBuffer(64), 8, 4);

    expect(copyOf(view).buffer.byteLength).toBe(8);
  });

  it("a controller taken from a site keeps the site's rules, however long it is kept: dead once the extension is stopped, and no way round a GET", async () => {
    let live = true;
    const calls: string[] = [];
    const previewController = { status: () => (calls.push("status"), { state: "stopped" }), start: async () => (calls.push("start"), { state: "ready" }), stop: async () => void calls.push("stop"), restart: async () => (calls.push("restart"), { state: "ready" }) };
    const checkpoint = { id: "c1", paths: () => ["a.md"], run: <T>(work: () => T) => work(), close: () => void calls.push("close") };
    const real = { id: "s1", root: "/nowhere", resolvePath: (path: string) => `/nowhere/${path}`, preview: () => previewController, checkpoint: () => checkpoint } as unknown as SiteService;
    const guarded = guardSite(real, { readOnly: false, alive: () => live }) as unknown as { preview(): typeof previewController; checkpoint(label: string): typeof checkpoint };
    const preview = guarded.preview();
    const turn = guarded.checkpoint("a turn");

    // Outside a GET, alive: it drives the engine's own.
    expect(preview.status()).toEqual({ state: "stopped" });
    expect(await preview.start()).toEqual({ state: "ready" });
    expect(turn.id).toBe("c1");
    expect(turn.run(() => 7)).toBe(7);
    // Inside a GET, kept from before: its status is a read; starting, stopping and restarting are not.
    duringGet(() => {
      expect(preview.status()).toEqual({ state: "stopped" });
      for (const change of ["start", "stop", "restart"] as const) expect(() => preview[change](), change).toThrow(/A GET route can't change a site/);
      expect(turn.paths()).toEqual(["a.md"]);
    });
    expect(calls).toEqual(["status", "start", "status"]);
    // Once the extension has been stopped: every method refuses, and so does its name.
    live = false;
    for (const method of ["status", "start", "stop", "restart"] as const) expect(() => preview[method](), method).toThrow(STOPPED);
    for (const method of ["paths", "close"] as const) expect(() => turn[method](), method).toThrow(STOPPED);
    expect(() => turn.run(() => 7)).toThrow(STOPPED);
    expect(() => turn.id).toThrow(STOPPED);
    expect(calls).toEqual(["status", "start", "status"]);
  });

  it("a handed controller gives no way to the engine's own, however it is looked at", () => {
    let live = true;
    class Preview {
      #state = "idle";
      status() {
        return { state: this.#state };
      }
      async start() {
        this.#state = "ready";
        return this.status();
      }
      async stop() {
        this.#state = "idle";
      }
      async restart() {
        return this.start();
      }
    }
    const own = new Preview();
    const real = { id: "s1", root: "/nowhere", resolvePath: (path: string) => `/nowhere/${path}`, preview: () => own } as unknown as SiteService;
    const handed = (guardSite(real, { readOnly: false, alive: () => live }) as unknown as { preview(): Preview }).preview();

    // A plain frozen object with the same four members, each a function of its own.
    expect(Object.getPrototypeOf(handed)).toBe(Object.prototype);
    expect(Object.isFrozen(handed)).toBe(true);
    expect(Object.getOwnPropertyNames(handed).sort()).toEqual(["restart", "start", "status", "stop"]);
    for (const name of ["status", "start", "stop", "restart"] as const) {
      const described = Object.getOwnPropertyDescriptor(handed, name)!;

      expect(typeof described.value, name).toBe("function");
      expect(described.value, name).not.toBe(Preview.prototype[name]);
      expect(described.value, name).not.toBe(own[name]);
      expect([described.writable, described.configurable], name).toEqual([false, false]);
    }
    // What a descriptor hands out is guarded too: taken off the object and called on its own, dead or inside a GET.
    const start = Object.getOwnPropertyDescriptor(handed, "start")!.value as () => Promise<unknown>;

    expect(() => duringGet(() => start())).toThrow(/A GET route can't change a site/);
    live = false;
    expect(() => start()).toThrow(STOPPED);
    expect(() => Reflect.get(handed, "status").call(own)).toThrow(STOPPED);
    expect(own.status()).toEqual({ state: "idle" });
    // Nothing else of the engine's object is on it.
    expect("constructor" in handed && (handed as { constructor: unknown }).constructor).toBe(Object);
  });

  it("a handed checkpoint has its public members and nothing else of the engine's object, whatever that carries", () => {
    // The engine's checkpoint carries more for its own use than an extension is handed.
    const own = {
      id: "c1",
      label: "a turn",
      manager: {},
      records: new Map(),
      paths: () => ["a.md"],
      run: <T,>(work: () => T) => work(),
      close: () => undefined,
      restore: async () => [] as string[],
      left: () => [] as string[],
      release: async () => undefined,
      offer: () => undefined,
    };
    const real = { id: "s1", root: "/nowhere", resolvePath: (path: string) => `/nowhere/${path}`, checkpoint: () => own } as unknown as SiteService;
    const handed = (guardSite(real, { readOnly: false, alive: () => true }) as unknown as { checkpoint(label: string): Record<string, unknown> }).checkpoint("a turn");

    expect(Object.getOwnPropertyNames(handed).sort()).toEqual(["close", "id", "left", "paths", "release", "restore", "run"]);
    for (const name of ["manager", "label", "records", "offer"]) expect(name in handed, name).toBe(false);
    expect(handed.id).toBe("c1");
  });

  it("what a handed controller answers is a copy, never an object the engine goes on using", async () => {
    const shared = { state: "ready" };
    const started = Promise.resolve(shared);
    const own = { status: () => shared, start: () => started, stop: async () => undefined, restart: () => started };
    const real = { id: "s1", root: "/nowhere", resolvePath: (path: string) => `/nowhere/${path}`, preview: () => own } as unknown as SiteService;
    const handed = (guardSite(real, { readOnly: false, alive: () => true }) as unknown as { preview(): typeof own }).preview();
    const answer = handed.start();

    expect(answer).not.toBe(started);
    expect(await answer).toEqual(shared);
    expect(await answer).not.toBe(shared);
    expect(handed.status()).not.toBe(shared);
  });

  it("looks at a search's files for links a few at a time, and still leaves out every one that leads to a secret", async () => {
    const root = await mkdtemp(join(tmpdir(), "links-"));

    await mkdir(join(root, "notes"));
    await writeFile(join(root, ".env"), "KEY=1");
    const hits: Array<{ path: string; line: number; text: string }> = [];

    for (let index = 0; index < 150; index += 1) {
      const path = `notes/${index}.txt`;

      // Every fifteenth is a link to the secret, under an ordinary name.
      if (index % 15 === 0) await symlink("../.env", join(root, path));
      else await writeFile(join(root, path), "KEY");
      hits.push({ path, line: 1, text: "KEY" }, { path, line: 2, text: "KEY again" });
    }
    const real = { id: "s1", root, resolvePath: (path: string) => join(root, path), grepText: async () => hits } as unknown as SiteService;
    const found = (await (guardSite(real, { readOnly: false }) as unknown as { grepText(pattern: string): Promise<typeof hits> }).grepText("KEY")).map((hit) => hit.path);

    expect(LINKS_AT_ONCE).toBeLessThan(150);
    expect(new Set(found).size).toBe(140);
    expect(found).toHaveLength(280);
    expect(found.filter((path) => Number(path.match(/\d+/)![0]) % 15 === 0)).toEqual([]);
    await rm(root, { recursive: true, force: true });
  });

  it("undoing a failed start tries every step, whatever the one before did, and says which didn't work", async () => {
    const done: string[] = [];
    const said: string[] = [];

    await undoEach(
      [
        { what: "the first", run: () => void done.push("first") },
        { what: "one that throws", run: () => { throw new Error("broke"); } },
        { what: "one that fails later", run: async () => { throw new Error("broke later"); } },
        { what: "one that never ends", run: () => new Promise<never>(() => {}) },
        { what: "the last", run: async () => void done.push("last") },
      ],
      (line) => void said.push(line),
      40
    );
    expect(done).toEqual(["first", "last"]);
    expect(said).toEqual([
      "While undoing a start that failed, one that throws didn't work: broke",
      "While undoing a start that failed, one that fails later didn't work: broke later",
      "While undoing a start that failed, one that never ends didn't work: it took too long",
    ]);
  });

  it("stops with the extension it was handed to: every member of the site refuses, its name included", () => {
    let live = true;
    const real = { id: "s1", root: "/nowhere", resolvePath: (path: string) => `/nowhere/${path}`, readFile: () => "content", changes: async () => ({ files: [] }), writeFile: () => undefined, preview: () => ({}), grepText: async () => [] } as unknown as SiteService;
    const guarded = guardSite(real, { readOnly: false, alive: () => live }) as unknown as { [name: string]: (...args: unknown[]) => unknown } & { id: string };

    expect(guarded.id).toBe("s1");
    expect(guarded.readFile!("a.md")).toBe("content");
    live = false;
    for (const name of ["readFile", "changes", "writeFile", "preview"]) expect(() => guarded[name]!("a.md"), name).toThrow(STOPPED);
    expect(() => guarded.id).toThrow(STOPPED);
    return expect(guarded.grepText!("x")).rejects.toThrow(STOPPED);
  });

  it("a declaration that turns out wrong after the setup ran stops that extension like any other: its stop is called, its listeners are gone, what it was handed is dead", async () => {
    const listeners = new Set<() => void>();
    const desk = { name: () => "Someone", counts: () => true, onChanged: (listener: () => void) => (listeners.add(listener), () => void listeners.delete(listener)), refOf: () => "s-ref", stillCounts: () => true } as unknown as PeopleDesk;
    const seen: { host?: ExtensionHost; signal?: AbortSignal; stops: number; ticks: number } = { stops: 0, ticks: 0 };
    const lines: string[] = [];
    const earlier = defineExtension({ id: "earlier", setup: () => ({ stop: () => void (seen.stops += 10) }) });
    const wrong = defineExtension({
      id: "wrong",
      setup(host, start) {
        seen.host = host;
        seen.signal = start.signal;
        host.people!.onChange(() => void (seen.ticks += 1));
        // A capital letter: not a route. Found only after this setup has run.
        return { routes: { "GET /Status": { access: "edit", handle: () => null } }, stop: () => void (seen.stops += 1) };
      },
    });
    const options = { home: await mkdtemp(join(tmpdir(), "extensions-")), mode: "hosted" as const, env: {}, log: (line: string) => void lines.push(line), desk, site: async () => ({ id: "s1" }) as unknown as SiteService };

    await expect(startExtensions([earlier, wrong], options)).rejects.toThrow("Extension “wrong”: the route “GET /Status” isn't a route.");
    // Its own stop ran, then the one before it was stopped as well.
    expect(seen.stops).toBe(11);
    expect(seen.signal!.aborted).toBe(true);
    expect(listeners.size).toBe(0);
    expect(await seen.host!.sites.get("s1")).toBeNull();
    seen.host!.log("after");
    expect(seen.host!.people!.counts("s-ref" as never)).toBe(false);
    expect(lines).toEqual([]);
    await rm(options.home, { recursive: true, force: true });
  });
});
