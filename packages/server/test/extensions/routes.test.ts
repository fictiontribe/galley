/**
 * Embedding: routes a program adds to the server it starts, on a started
 * hosted install with the "status" extension. Each test is a sentence someone
 * could try to break: an added route is behind every guard a built-in one
 * has, is handed only what it should be, and is nobody's once it has answered.
 */
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUILD_MODE_REFUSAL, ROLE_REFUSAL } from "@galley/core/install";
import type { SiteService } from "@galley/core/types";
import { withoutHiddenVariables } from "@galley/core/workspace";
import { startServer } from "../../src";
import { GET_CHANGES_NOTHING, SITE_CHANGES, SITE_INTERNAL, SITE_READS, SITE_WITHHELD, UNREADABLE } from "../../src/extensions/site";
import { NOT_FROM_THE_EDITOR } from "../../src/extensions/mount";
import { NEEDS_A_PERSON } from "../../src/who";
import { call, EDITOR, sandbox, siteRepository, startHosted, stopHosted, until, type CallInit } from "../hosted-helpers";
import { newProbe, statusExtension } from "./status";

const box = sandbox("extensions-routes");
const PASSWORD = "correct horse battery staple";
const OPERATOR = "an-operator-token-for-scripts-0000";
const SECRET = "status-secret-value-123456";
const probe = newProbe();
let port = 0;
let siteId = "";
let folder = "";
let logs: string[] = [];
let started: Awaited<ReturnType<typeof startHosted>>;
const people: Record<"owner" | "editor" | "contributor", { id: string; cookie: string }> = { owner: { id: "", cookie: "" }, editor: { id: "", cookie: "" }, contributor: { id: "", cookie: "" } };

const OWN_PAGE = { "sec-fetch-site": "same-origin" };
/** A call to the extension as the editor's own page makes it. */
const x = (method: string, path: string, init: CallInit = {}) => call(port, method, `/api/x/status${path}`, { ...init, headers: { ...OWN_PAGE, ...init.headers } });
const site = (rest = "") => `/sites/${siteId}${rest}`;

async function signIn(email: string): Promise<string> {
  const answer = await call(port, "POST", "/api/auth/login", { body: { email, password: PASSWORD } });

  if (answer.status !== 200) throw new Error(`sign-in failed: ${answer.status} ${answer.text}`);
  return answer.cookies[0]!;
}

async function join_(email: string, role: "editor" | "contributor", name: string): Promise<{ id: string; cookie: string }> {
  const invited = await call(port, "POST", "/api/people/invitations", { cookie: people.owner.cookie, body: { email, role } });
  const accepted = await call(port, "POST", "/api/auth/link", { body: { code: String(invited.body.link.url).split("#")[1], password: PASSWORD, name } });
  const cookie = accepted.cookies[0]!;

  return { id: (await call(port, "GET", "/api/account", { cookie })).body.id, cookie };
}

beforeAll(async () => {
  // The extension reads its key where a real one would: the process's environment.
  process.env.STATUS_API_KEY = SECRET;
  started = await startHosted(
    box,
    box.folder("home"),
    {
      GALLEY_PUBLIC_URL: EDITOR,
      GALLEY_PASSWORD: PASSWORD,
      GALLEY_OWNER_NAME: "Sam Owner",
      GALLEY_OWNER_EMAIL: "sam@example.com",
      GALLEY_TOKEN: OPERATOR,
      // A site whose pages content mode may change and whose other source build mode may.
      GALLEY_SITE_REPOSITORY: siteRepository(box, { extra: { "galley.config.json": JSON.stringify({ name: "Harbour Notes", dev: { command: "node server.mjs" }, writable: { content: ["src/content/**"], build: ["src/**"] } }) } }),
      GALLEY_SITE_ACCESS: "token",
      GALLEY_SITE_TOKEN: "fake-access-key-for-the-repository-0000",
      GALLEY_AUTHOR_NAME: "Site Publisher",
      GALLEY_AUTHOR_EMAIL: "publisher@example.com",
      STATUS_API_KEY: SECRET,
    },
    {
      extensions: [
        statusExtension(probe, {
          // A listener that tries to publish: it runs when an owner's request changes who is signed in.
          setup(host) {
            host.people!.onChange(() => {
              probe.calls.changed = (probe.calls.changed ?? 0) + 1;
              void host.sites.get(siteId).then(async (open) => probe.later.push(`listener publish ${await open!.publish({ message: "From a listener" }).then(() => "done", (error: Error) => `refused: ${error.message}`)}`));
            });
          },
          stop: () => void (probe.calls.stop = (probe.calls.stop ?? 0) + 1),
        }),
      ],
    }
  );
  ({ port, logs } = started);
  await started.server.install!.idle();
  siteId = started.server.install!.siteId()!;
  folder = started.server.install!.siteFolder();
  people.owner = { cookie: await signIn("sam@example.com"), id: "" };
  people.owner.id = (await call(port, "GET", "/api/account", { cookie: people.owner.cookie })).body.id;
  people.editor = await join_("ed@example.com", "editor", "Ed Editor");
  people.contributor = await join_("con@example.com", "contributor", "Con Tributor");
}, 180_000);

afterAll(async () => {
  delete process.env.STATUS_API_KEY;
  await box.cleanup();
}, 120_000);

describe("routes an embedding program adds", () => {
  it("serves the worked example: how many changes wait, and a note only someone who may publish can leave", async () => {
    writeFileSync(join(folder, "src/content/pages/waiting.md"), "---\ntitle: Waiting\n---\nWaiting\n");
    const before = await x("GET", site(), { cookie: people.contributor.cookie });

    expect(before.status, before.text).toBe(200);
    expect(before.body).toEqual({ waiting: 1, note: null });
    const refused = await x("POST", site("/note"), { cookie: people.contributor.cookie, body: { text: "Hello" } });

    expect([refused.status, refused.body.error.message]).toEqual([403, ROLE_REFUSAL]);
    expect((await x("POST", site("/note"), { cookie: people.editor.cookie, body: { text: "  Ready for Monday  " } })).body).toEqual({ ok: true });
    expect((await x("GET", site(), { cookie: people.contributor.cookie })).body).toEqual({ waiting: 1, note: "Ready for Monday" });
    expect((await x("POST", site("/note"), { cookie: people.editor.cookie, body: { text: "" } })).body.error).toMatchObject({ code: "invalid", message: "A note is 1 to 200 characters." });
    expect(started.notices.join("\n")).toContain("Extensions: status (12 routes)");
  });

  it("is behind the guards a built-in route of the same level is behind, with the same answers", async () => {
    const pairs: Array<{ method: string; builtIn: string; added: string; body?: unknown; level: "edit" | "publish" | "manage" }> = [
      { method: "GET", builtIn: `/api/sites/${siteId}/media`, added: `/api/x/status${site()}`, level: "edit" },
      { method: "POST", builtIn: `/api/sites/${siteId}/publish`, added: `/api/x/status${site("/note")}`, body: { text: "A note", message: "x" }, level: "publish" },
      { method: "GET", builtIn: "/api/people", added: "/api/x/status/about", level: "manage" },
    ];
    /** `bare`: without the browser's word that the request is the editor's own page's. */
    const both = async (pair: (typeof pairs)[number], init: CallInit, bare = false) => {
      const [builtIn, added] = await Promise.all([pair.builtIn, pair.added].map((path) => call(port, pair.method, path, { ...(pair.body ? { body: pair.body } : {}), ...init, headers: { ...(bare ? {} : OWN_PAGE), ...init.headers } })));

      return { builtIn: [builtIn!.status, builtIn!.body?.error?.code ?? null], added: [added!.status, added!.body?.error?.code ?? null] };
    };

    for (const pair of pairs) {
      const label = `${pair.method} ${pair.added}`;
      // Nobody; a cookie that was signed out; another server's name in Host.
      const nobody = await both(pair, {});

      expect(nobody.added, label).toEqual(nobody.builtIn);
      expect(nobody.added, label).toEqual([401, "unauthorized"]);
      const wrongHost = await both(pair, { cookie: people.owner.cookie, host: "evil.example" });

      expect(wrongHost.added, label).toEqual(wrongHost.builtIn);
      expect(wrongHost.added[0], label).toBeGreaterThanOrEqual(400);
      // A role below the level.
      if (pair.level !== "edit") {
        const below = await both(pair, { cookie: people.contributor.cookie });

        expect(below.added, label).toEqual(below.builtIn);
        expect(below.added, label).toEqual([403, "forbidden"]);
      }
      // What changes state needs the editor's own Origin.
      if (pair.method === "POST") {
        for (const origin of [null, "https://evil.example"]) {
          const crossed = await both(pair, { cookie: people.owner.cookie, origin }, origin === null);

          expect(crossed.added, `${label} ${origin}`).toEqual(crossed.builtIn);
          expect(crossed.added[0], `${label} ${origin}`).toBe(403);
        }
      }
    }
    // The operator's token reaches an added route as it reaches a built-in one, with no word from a browser.
    expect((await call(port, "GET", "/api/x/status/about", { bearer: OPERATOR })).body).toEqual({ mode: "hosted" });
    expect((await call(port, "GET", `/api/sites/${siteId}/media`, { bearer: OPERATOR })).status).toBe(200);
    expect((await call(port, "GET", "/api/x/status/about", { bearer: "not-the-operators-token-000000000" })).status).toBe(401);
    // An address that isn't an added route is nothing, as anywhere else.
    expect((await x("GET", "/nothing-here", { cookie: people.owner.cookie })).status).toBe(404);
    expect((await call(port, "GET", "/api/x/other/about", { cookie: people.owner.cookie, headers: OWN_PAGE })).status).toBe(404);
  });

  it("can't be called by a page on another origin as the person signed in, same site or not", async () => {
    const before = probe.calls.status ?? 0;

    for (const from of ["same-site", "cross-site", undefined]) {
      for (const method of ["GET", "HEAD"]) {
        const answer = await call(port, method, `/api/x/status${site()}`, { cookie: people.owner.cookie, headers: from ? { "sec-fetch-site": from } : {} });

        expect(answer.status, `${method} ${from}`).toBe(403);
        if (method === "GET") expect(answer.body.error.message).toBe(NOT_FROM_THE_EDITOR);
      }
      const post = await call(port, "POST", `/api/x/status${site("/note")}`, { cookie: people.owner.cookie, body: { text: "From elsewhere" }, headers: from ? { "sec-fetch-site": from } : {} });

      expect(post.status, `POST ${from}`).toBe(403);
    }
    expect(probe.calls.status ?? 0).toBe(before);
    // The editor's own page, and an address typed by hand.
    expect((await call(port, "GET", `/api/x/status${site()}`, { cookie: people.owner.cookie, headers: { "sec-fetch-site": "same-origin" } })).status).toBe(200);
    expect((await call(port, "GET", `/api/x/status${site()}`, { cookie: people.owner.cookie, headers: { "sec-fetch-site": "none" } })).status).toBe(200);
    expect((await call(port, "HEAD", `/api/x/status${site()}`, { cookie: people.owner.cookie, headers: OWN_PAGE })).status).toBe(200);
    expect((await x("GET", site(), { cookie: people.owner.cookie })).body.note).toBe("Ready for Monday");
  });

  it("a route that needs a person refuses the operator's token", async () => {
    const token = await call(port, "POST", `/api/x/status${site("/sign-off")}`, { bearer: OPERATOR, body: {} });

    expect([token.status, token.body.error.message]).toEqual([403, NEEDS_A_PERSON]);
    expect((await x("POST", site("/sign-off"), { cookie: people.editor.cookie, body: {} })).body).toEqual({ ok: true });
  });

  it("hands a handler six things and no more: nothing of the cookie, the headers or the token", async () => {
    probe.requests.length = 0;
    await x("POST", site("/note?tag=a&tag=b&x=1"), { cookie: people.editor.cookie, body: { text: "Seen" }, headers: { "x-secret-header": "header-value-000" } });
    const request = probe.requests.at(-1)!;

    expect(Object.keys(request).sort()).toEqual(["body", "caller", "params", "query", "signal", "site"]);
    expect(request.params).toEqual({ siteId });
    expect({ ...request.query }).toEqual({ tag: "a", x: "1" });
    expect(request.body).toEqual({ text: "Seen" });
    expect(request.caller).toMatchObject({ kind: "person", account: people.editor.id, role: "editor", name: "Ed Editor" });
    expect(Object.keys(request.caller).sort()).toEqual(["account", "kind", "name", "role", "session"]);
    const handed = JSON.stringify({ params: request.params, query: request.query, body: request.body, caller: request.caller });

    for (const kept of [people.editor.cookie.split("=")[1]!, "header-value-000", OPERATOR, "ed@example.com", PASSWORD]) expect(handed).not.toContain(kept);
    expect(Object.isFrozen(request) && Object.isFrozen(request.caller) && Object.isFrozen(request.params)).toBe(true);
    await call(port, "GET", "/api/x/status/about", { bearer: OPERATOR });
    expect(probe.requests.at(-1)!.caller).toEqual({ kind: "operator" });
    expect(Object.keys(probe.requests.at(-1)!).sort()).toEqual(["body", "caller", "params", "query", "signal"]);
  });

  it("answers only with JSON: anything else is an error of the server's, and is logged", async () => {
    const odd: Array<[string, () => unknown]> = [
      ["a response of its own", () => new Response("mine", { status: 200, headers: { "set-cookie": "a=b" } })],
      ["nothing", () => undefined],
      ["a number too large for JSON", () => ({ n: 10n })],
      ["something that isn't a number", () => ({ n: Number.NaN })],
      ["a date", () => ({ at: new Date() })],
      ["a loop", () => {
        const loop: Record<string, unknown> = {};

        loop.self = loop;
        return loop;
      }],
    ];

    for (const [what, answer] of odd) {
      probe.answer = answer;
      const response = await x("GET", "/odd", { cookie: people.owner.cookie });

      expect(response.status, what).toBe(500);
      expect(response.body.error.code, what).toBe("internal");
      expect(response.headers["set-cookie"], what).toBeUndefined();
    }
    expect(logs.some((line) => line.includes("The extension “status” answered GET /odd with something that isn't JSON."))).toBe(true);
    probe.answer = () => ({ ok: [1, "two", null, { three: true }] });
    expect((await x("GET", "/odd", { cookie: people.owner.cookie })).body).toEqual({ ok: [1, "two", null, { three: true }] });
    delete probe.answer;
  });

  it("a part of the address can't carry a path", async () => {
    writeFileSync(join(started.server.home, "extensions", "status", "kept.txt"), "kept");
    expect((await x("GET", "/notes/kept.txt", { cookie: people.owner.cookie })).body).toEqual({ read: 4 });
    for (const part of ["..%2F..%2Fsession.key", "a%2Fb", "a%5Cb", "a%00b", "%2e%2e%2f%2e%2e%2fsession.key"]) {
      const answer = await x("GET", `/notes/${part}`, { cookie: people.owner.cookie });

      expect([answer.status, answer.body?.error?.code], part).toEqual([400, "invalid"]);
      expect(JSON.stringify(answer.body), part).not.toContain("read");
    }
    // The folder is the extension's own, and nobody else's to read.
    expect(statSync(join(started.server.home, "extensions", "status")).mode & 0o777).toBe(0o700);
  });

  it("can't read secrets or the version history's own files through the site it is handed", async () => {
    writeFileSync(join(folder, ".env"), "TOKEN=in-the-site\n");
    mkdirSync(join(folder, "src/content/pages"), { recursive: true });
    for (const path of [".env", ".ENV", ".env.local", ".git/config", ".GIT/HEAD", "sub/.git/HEAD"]) {
      const answer = await x("GET", site(`/file?path=${encodeURIComponent(path)}`), { cookie: people.contributor.cookie });

      expect([answer.status, answer.body.error.message], path).toEqual([403, UNREADABLE]);
    }
    expect((await x("GET", site(`/file?path=${encodeURIComponent("src/content/pages/waiting.md")}`), { cookie: people.contributor.cookie })).body.content).toContain("title: Waiting");
    // The same through the host, outside a request.
    const open = (await probe.host!.sites.get(siteId))!;

    expect(() => open.readFile(".env")).toThrow(UNREADABLE);
    expect(() => open.resolvePath(".git/config")).toThrow(UNREADABLE);
    expect("dispose" in open).toBe(false);
    expect(await probe.host!.sites.get("no-such-site")).toBeNull();
  });

  it("every member of a site is known to read, to change, or to be withheld", async () => {
    const real = (await started.server.services.registry.get(siteId)) as SiteService;
    const known = new Set<string>([...SITE_READS, ...SITE_CHANGES, ...SITE_WITHHELD, ...SITE_INTERNAL]);

    expect(Object.keys(real).filter((name) => !known.has(name))).toEqual([]);
    expect(SITE_READS.filter((name) => (SITE_CHANGES as readonly string[]).includes(name))).toEqual([]);
  });

  it("a GET is handed nothing that changes a site; other routes change it only as far as the caller may", async () => {
    expect((await x("GET", site("/write"), { cookie: people.owner.cookie })).body).toEqual({ tried: `refused: ${GET_CHANGES_NOTHING}` });
    const save = (who: keyof typeof people, path: string, mode: "content" | "build") => x("POST", site("/save"), { cookie: people[who].cookie, body: { path, mode } }).then((answer) => String(answer.body.tried));

    expect(await save("contributor", "src/layouts/Base.astro", "build")).toBe(`refused: ${BUILD_MODE_REFUSAL}`);
    expect(await save("contributor", ".git/config", "content")).toMatch(/^refused: /);
    expect(await save("contributor", "../outside.md", "content")).toMatch(/^refused: /);
    expect(await save("contributor", ".env", "content")).toMatch(/^refused: /);
    expect(await save("contributor", "src/content/pages/by-a-contributor.md", "content")).toBe("done");
  });

  it("work a handler leaves running is nobody's once it has answered", async () => {
    for (const init of [{ cookie: people.owner.cookie }, { bearer: OPERATOR }] as CallInit[]) {
      probe.later.length = 0;
      expect((await x("POST", site("/later"), { ...init, body: { wait: 30 } })).body).toEqual({ started: true });
      await until(() => probe.later.length === 2);
      // It may not publish. It may still save content, as work for nobody may on a hosted install.
      expect(probe.later[0], JSON.stringify(init)).toMatch(/^publish refused: /);
      expect(probe.later[1], JSON.stringify(init)).toBe("save done");
    }
  });

  it("and is nobody's at once when the sign-in stops counting", async () => {
    const guest = await join_("guest@example.com", "editor", "Guest Editor");
    let open!: () => void;

    probe.gate = new Promise<void>((resolve) => (open = resolve));
    const slow = x("POST", site("/slow"), { cookie: guest.cookie, body: {} });

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect((await call(port, "POST", "/api/auth/logout", { cookie: guest.cookie })).status).toBe(200);
    open();
    expect(String((await slow).body.tried)).toMatch(/^refused: /);
    delete probe.gate;
  });

  it("keeps a declared secret from the site's commands, the log and an error shown to a person", async () => {
    expect(withoutHiddenVariables({ STATUS_API_KEY: SECRET, PATH: "/bin", OTHER: "kept" })).toEqual({ PATH: "/bin", OTHER: "kept" });
    const answer = await x("GET", "/leak", { cookie: people.owner.cookie });

    expect(answer.body.error).toMatchObject({ code: "invalid", message: "The service refused the key •••." });
    expect(answer.text).not.toContain(SECRET);
    const line = logs.find((entry) => entry.includes("[status] asked with"))!;

    expect(line).toBe("[status] asked with ••• GET /api/people 200 forged");
    expect(logs.join("\n")).not.toContain(SECRET);
  });

  it("tells an extension a name and whether a sign-in still counts, and nothing else about an account", async () => {
    const desk = probe.host!.people!;

    expect(Object.keys(desk).sort()).toEqual(["counts", "name", "onChange"]);
    expect(desk.name(people.owner.id)).toBe("Sam Owner");
    expect(desk.name("no-such-account")).toBeNull();
    const visitor = await join_("visitor@example.com", "contributor", "Vi Visitor");

    await x("GET", site(), { cookie: visitor.cookie });
    const caller = probe.requests.at(-1)!.caller as unknown as { session: never; account: string };

    expect(desk.counts(caller.session)).toBe(true);
    expect(desk.counts("s-not-a-sign-in" as never)).toBe(false);
    expect(caller.session).not.toContain(visitor.cookie.split("=")[1]!.slice(0, 12));
    // An owner switches the account off: its sign-in stops counting, and its name is no longer given.
    probe.later.length = 0;
    const changedBefore = probe.calls.changed ?? 0;

    expect((await call(port, "PATCH", `/api/people/${visitor.id}`, { cookie: people.owner.cookie, body: { disabled: true } })).status).toBe(200);
    expect(desk.counts(caller.session)).toBe(false);
    expect(desk.name(visitor.id)).toBeNull();
    expect(probe.calls.changed ?? 0).toBeGreaterThan(changedBefore);
    // The listener ran inside the owner's request, and was nobody all the same: it could not publish.
    await until(() => probe.later.some((line) => line.startsWith("listener publish")));
    expect(probe.later.filter((line) => line.startsWith("listener publish")).every((line) => /^listener publish refused: /.test(line))).toBe(true);
    // A change of name is a change to what `name` answers: listeners are told.
    const renamedBefore = probe.calls.changed ?? 0;

    expect((await call(port, "PATCH", "/api/account", { cookie: people.editor.cookie, body: { name: "Edith Editor" } })).status).toBe(200);
    expect(desk.name(people.editor.id)).toBe("Edith Editor");
    expect(probe.calls.changed ?? 0).toBeGreaterThan(renamedBefore);
    // Nothing handed to the extension all along held an e-mail, a password or a cookie.
    const handed = JSON.stringify(probe.requests.map((request) => ({ params: request.params, query: request.query, caller: request.caller })));

    for (const kept of ["@example.com", PASSWORD, OPERATOR, people.owner.cookie.split("=")[1]!]) expect(handed).not.toContain(kept);
  });

  it("has the process to itself while it runs, and is stopped with the server", async () => {
    const second = () => startServer({ port: 0, host: "127.0.0.1", mode: "local", home: box.folder("second-home"), sitesDir: box.folder("second-sites"), webDir: join(box.root, "no-ui"), env: { PATH: process.env.PATH, HOME: box.root }, notice: () => {}, log: () => {} });

    await expect(second()).rejects.toThrow(/^Extensions need the process to themselves/);
    // The first is as it was.
    expect((await x("GET", "/about", { cookie: people.owner.cookie })).body).toEqual({ mode: "hosted" });
    expect(withoutHiddenVariables({ STATUS_API_KEY: SECRET })).toEqual({});
    expect(probe.calls.stop ?? 0).toBe(0);
    await stopHosted(box, started);
    expect(probe.calls.stop).toBe(1);
    // With it gone, a server starts; and beside that one, a server with extensions doesn't.
    const plain = await second();

    try {
      await expect(startHosted(box, box.folder("home"), { GALLEY_PUBLIC_URL: EDITOR, GALLEY_PASSWORD: PASSWORD }, { extensions: [statusExtension(newProbe())] })).rejects.toThrow(/^Extensions need the process to themselves/);
    } finally {
      await plain.close({ graceMs: 0 });
    }
  });
});
