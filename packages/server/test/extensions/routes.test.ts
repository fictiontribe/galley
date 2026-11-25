/**
 * Embedding: routes a program adds to the server it starts, on a started
 * hosted install with the "status" extension. Each test is a sentence someone
 * could try to break: an added route is behind every guard a built-in one
 * has, is handed only what it should be, and is nobody's once it has answered.
 */
import { existsSync, mkdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUILD_MODE_REFUSAL, NO_CALLER_REFUSAL, OUTLIVED_REFUSAL, ROUTE_ACCESS, ROLE_REFUSAL, SIGN_IN_ENDED_REFUSAL } from "@galley/core/install";
import type { SiteService } from "@galley/core/types";
import { deniedReason, withoutHiddenVariables } from "@galley/core/workspace";
import { startServer } from "../../src";
import { GET_CHANGES_NOTHING, SITE_CHANGES, SITE_INTERNAL, SITE_READS, SITE_WITHHELD, STOPPED, UNREADABLE } from "../../src/extensions/site";
import { NOT_FROM_THE_EDITOR } from "../../src/extensions/mount";
import { NEEDS_A_PERSON } from "../../src/who";
import { call, EDITOR, git, sandbox, siteRepository, startHosted, stopHosted, until, type CallInit } from "../hosted-helpers";
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
/** A page of the site with something new on it, so there is something to publish. */
const touch = (name: string) => writeFileSync(join(folder, "src/content/pages", `${name}.md`), `---\ntitle: ${name}\n---\n${Date.now()} ${Math.random()}\n`);
const x = (method: string, path: string, init: CallInit = {}) => call(port, method, `/api/x/status${path}`, { ...init, headers: { ...OWN_PAGE, ...init.headers } });
const site = (rest = "") => `/sites/${siteId}${rest}`;
/** What every route of the editor's own answers someone who isn't signed in, by route: its status and its error's code. */
async function strangersAnswers(onPort: number): Promise<Record<string, string>> {
  const answers: Record<string, string> = {};

  for (const key of Object.keys(ROUTE_ACCESS)) {
    const [method, path] = key.split(" ") as [string, string];
    // The event stream stays open for anyone it lets in; a stranger is refused before it opens.
    const answer = await call(onPort, method, path.replace(/:[A-Za-z]+/g, "x"), { headers: OWN_PAGE });

    answers[key] = `${answer.status} ${answer.body?.error?.code ?? ""}`.trim();
  }
  return answers;
}

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
            host.people!.onChange(() => {
              throw new Error(`a listener broke with ${SECRET}`);
            });
            host.people!.onChange((async () => {
              throw new Error(`a listener broke later with ${SECRET}`);
            }) as unknown as () => void);
          },
          // Tries to publish as it stops, then fails with a secret in its words.
          async stop() {
            probe.calls.stop = (probe.calls.stop ?? 0) + 1;
            const open = await probe.host!.sites.get(siteId);

            probe.later.push(`stop publish ${await open!.publish({ message: "While stopping" }).then(() => "done", (error: Error) => `refused: ${error.message}`)}`);
            throw new Error(`couldn't tidy up with ${SECRET}`);
          },
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
    expect(started.notices.join("\n")).toMatch(/Extensions: status \(\d+ routes\)/);
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
    // A cookie that was signed out, and one whose account was switched off, are nobody's on both.
    const gone = await join_("gone@example.com", "editor", "Gone Editor");
    const off = await join_("off@example.com", "editor", "Off Editor");

    expect((await call(port, "POST", "/api/auth/logout", { cookie: gone.cookie })).status).toBe(200);
    expect((await call(port, "PATCH", `/api/people/${off.id}`, { cookie: people.owner.cookie, body: { disabled: true } })).status).toBe(200);
    for (const pair of pairs) {
      for (const cookie of [gone.cookie, off.cookie]) {
        const ended = await both(pair, { cookie });

        expect(ended.added, `${pair.added} after the sign-in ended`).toEqual(ended.builtIn);
        expect(ended.added, pair.added).toEqual([401, "unauthorized"]);
      }
    }
    // More than the route takes: refused before the reader or the handler sees any of it.
    const notes = probe.calls.note ?? 0;
    const tooMuch = await x("POST", site("/note"), { cookie: people.editor.cookie, body: { text: "x".repeat(8000) } });

    expect([tooMuch.status, tooMuch.body.error.code]).toEqual([413, "invalid"]);
    expect(probe.calls.note ?? 0).toBe(notes);
    // The address spelt with an encoded letter is the same address, behind the same guards.
    expect((await call(port, "GET", "/%61pi/x/status/about", { cookie: people.owner.cookie, headers: OWN_PAGE })).body).toEqual({ mode: "hosted" });
    expect((await call(port, "GET", "/%61pi/x/status/about", { headers: OWN_PAGE })).status).toBe(401);
    expect((await call(port, "GET", "/%61pi/x/status/about", { cookie: people.contributor.cookie, headers: OWN_PAGE })).status).toBe(403);
    expect((await call(port, "GET", "/%61pi/x/status/about", { cookie: people.owner.cookie, headers: { "sec-fetch-site": "same-site" } })).status).toBe(403);
    // An address that ends like one the editor treats specially is still the extension's.
    expect((await x("POST", site("/preview/start"), { cookie: people.contributor.cookie, body: {} })).body).toEqual({ mine: true });
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
    for (const path of [".env", ".ENV", ".env.local", ".envrc", ".env-production", ".env_local", "sub/.Envrc", ".git/config", ".GIT/HEAD", "sub/.git/HEAD"]) {
      const answer = await x("GET", site(`/file?path=${encodeURIComponent(path)}`), { cookie: people.contributor.cookie });

      expect([answer.status, answer.body.error.message], path).toEqual([403, UNREADABLE]);
    }
    expect((await x("GET", site(`/file?path=${encodeURIComponent("src/content/pages/waiting.md")}`), { cookie: people.contributor.cookie })).body.content).toContain("title: Waiting");
    // A link inside the site that leads to one of them is that file, whatever the link is called.
    symlinkSync("../../../.env", join(folder, "src/content/pages/notes.txt"));
    const linked = await x("GET", site(`/file?path=${encodeURIComponent("src/content/pages/notes.txt")}`), { cookie: people.contributor.cookie });

    expect([linked.status, linked.body.error.message]).toEqual([403, UNREADABLE]);
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

  it("a GET is handed nothing that changes a site, however the site is reached", async () => {
    expect((await x("GET", site("/write"), { cookie: people.owner.cookie })).body).toEqual({ tried: `refused: ${GET_CHANGES_NOTHING}` });
    // Through the host instead of the request: the same.
    expect((await x("GET", `/any-site?site=${siteId}`, { cookie: people.owner.cookie })).body).toEqual({ tried: `refused: ${GET_CHANGES_NOTHING}` });
    expect((await call(port, "HEAD", `/api/x/status${site("/write")}`, { cookie: people.owner.cookie, headers: OWN_PAGE })).status).toBe(200);
    // And a site asked for earlier, outside any GET, and kept: used inside a GET it refuses too.
    expect((await x("POST", site("/keep"), { cookie: people.owner.cookie, body: {} })).body).toEqual({ kept: true });
    expect((await x("GET", "/kept-write", { cookie: people.owner.cookie })).body).toEqual({ tried: `refused: ${GET_CHANGES_NOTHING}` });
    expect(git(folder, "status", "--porcelain", "--", "src/content/pages/about.md", "src/content/pages/by-a-get.md", "src/content/pages/by-a-kept-site.md")).toBe("");
    // And the preview's controller, taken by a POST and kept: inside a GET its status can be read, and it can't be started, stopped or restarted.
    expect((await x("POST", site("/keep-preview"), { cookie: people.owner.cookie, body: {} })).body).toEqual({ state: "idle" });
    expect((await x("GET", "/kept-preview", { cookie: people.owner.cookie })).body).toEqual({
      state: "idle",
      started: `refused: ${GET_CHANGES_NOTHING}`,
      stopped: `refused: ${GET_CHANGES_NOTHING}`,
      restarted: `refused: ${GET_CHANGES_NOTHING}`,
    });
    // And a checkpoint, taken by a POST and kept: inside a GET it can be read, and it can't put back what it recorded.
    const page = "src/content/pages/by-a-checkpoint.md";

    expect((await x("POST", site("/keep-checkpoint"), { cookie: people.owner.cookie, body: {} })).body).toEqual({ paths: [page] });
    expect(existsSync(join(folder, page))).toBe(true);
    expect((await x("GET", "/kept-checkpoint", { cookie: people.owner.cookie })).body).toEqual({ id: "string", paths: [page], restored: `refused: ${GET_CHANGES_NOTHING}`, left: [] });
    expect(existsSync(join(folder, page))).toBe(true);
    // Outside a GET it does what a checkpoint does.
    expect((await x("POST", "/kept-checkpoint/restore", { cookie: people.owner.cookie, body: {} })).body).toEqual({ restored: [page] });
    expect(existsSync(join(folder, page))).toBe(false);
  });

  it("what a read answers with is a copy: changing it changes nothing of the site's own rules", async () => {
    const real = (await started.server.services.registry.get(siteId)) as SiteService;
    const before = JSON.stringify((await real.model()).writable);

    expect((await x("GET", site("/tidy"), { cookie: people.contributor.cookie })).body).toEqual({ content: JSON.parse(before).content.length + 2 });
    expect(JSON.stringify((await real.model()).writable)).toBe(before);
    // A change answers with the model too (`refresh`): the same tidying of that answer, from a POST, changes nothing either.
    expect((await x("POST", site("/tidy"), { cookie: people.contributor.cookie, body: {} })).body).toMatchObject({ content: JSON.parse(before).content.length + 2 });
    expect(JSON.stringify((await real.model()).writable)).toBe(before);
    // Content mode is as narrow as it was: a contributor still can't save the site's code as content.
    const tried = (await x("POST", site("/save"), { cookie: people.contributor.cookie, body: { path: "src/layouts/Tidy.astro", mode: "content" } })).body.tried;

    expect(tried).toBe("refused: Only content and media can be changed in content mode. Switch to build mode to change the site's code.");
    // Every read answers with something that can be copied, and never the engine's own object.
    const guarded = (await probe.host!.sites.get(siteId))!;

    expect(await guarded.model()).toEqual(await real.model());
    expect(await guarded.model()).not.toBe(await real.model());
    expect((await guarded.changes()).files).not.toBe((await real.changes()).files);
    expect(typeof guarded.id === "string" && guarded.root === real.root).toBe(true);
  });

  it("changes a site only as far as the caller may, by the engine's own rules", async () => {
    const save = (who: keyof typeof people, path: string, mode: "content" | "build") => x("POST", site("/save"), { cookie: people[who].cookie, body: { path, mode } }).then((answer) => String(answer.body.tried));

    expect(await save("contributor", "src/layouts/Base.astro", "build")).toBe(`refused: ${BUILD_MODE_REFUSAL}`);
    // Control: the same save by someone who may use build mode goes through.
    expect(await save("editor", "src/layouts/Base.astro", "build")).toBe("done");
    // What nobody may write, an editor in build mode included: each refused by the rule for that kind of file.
    for (const mode of ["content", "build"] as const) {
      expect(await save("editor", ".git/config", mode), mode).toBe(`refused: ${deniedReason(".git/config", mode)}`);
      expect(await save("editor", ".env", mode), mode).toBe(`refused: ${deniedReason(".env", mode)}`);
      expect(await save("editor", "../outside.md", mode), mode).toBe("refused: That file is outside the site folder, so it can't be opened or changed here.");
    }
    expect(deniedReason(".git/config", "build")).toBe("Version-history files can't be changed from here.");
    expect(await save("contributor", "src/content/pages/by-a-contributor.md", "content")).toBe("done");
  });

  it("work a handler leaves running is nobody's once it has answered: it can't publish, though the handler itself could", async () => {
    for (const [init, name] of [[{ cookie: people.owner.cookie }, "Sam Owner"], [{ bearer: OPERATOR }, "nobody's"]] as Array<[CallInit, string]>) {
      // Control: the same publish, inside the handler, as the same caller, goes through.
      touch("published-inside");
      expect((await x("POST", site("/inside"), { ...init, body: {} })).body, JSON.stringify(init)).toEqual({ tried: "done" });
      expect(git(folder, "log", "-1", "--format=%s")).toBe("Inside");
      // Left running, with something there to publish: refused, in the words for work that outlived its request.
      touch("published-later");
      probe.later.length = 0;
      expect((await x("POST", site("/later"), { ...init, body: { wait: 30 } })).body).toEqual({ started: true });
      await until(() => probe.later.length === 4);
      expect(probe.later[0], JSON.stringify(init)).toBe(`publish refused: ${OUTLIVED_REFUSAL}`);
      expect(git(folder, "log", "-1", "--format=%s")).toBe("Inside");
      // It may still save content, as work for nobody may on a hosted install…
      expect(probe.later[1]).toBe("save done");
      // …and what it records still carries the publishing name of the person whose request started it. `host.outside` carries none.
      expect(probe.later[2]).toBe(`name ${name}`);
      expect(probe.later[3]).toBe("outside nobody's");
    }
  });

  it("and loses its caller's access at once when the sign-in stops counting", async () => {
    const guest = await join_("guest@example.com", "editor", "Guest Editor");
    const slowly = async (signOut: boolean) => {
      let open!: () => void;

      probe.gate = new Promise<void>((resolve) => (open = resolve));
      touch("published-slowly");
      const slow = x("POST", site("/slow"), { cookie: guest.cookie, body: {} });

      await new Promise((resolve) => setTimeout(resolve, 150));
      if (signOut) expect((await call(port, "POST", "/api/auth/logout", { cookie: guest.cookie })).status).toBe(200);
      open();
      return String((await slow).body.tried);
    };

    // Control: the same slow handler, the sign-in still good, publishes.
    expect(await slowly(false)).toBe("done");
    expect(git(folder, "log", "-1", "--format=%s")).toBe("Slow");
    const head = git(folder, "rev-parse", "HEAD");

    // In words of its own: it isn't that the account may not, it is that the sign-in is over.
    expect(await slowly(true)).toBe(`refused: ${SIGN_IN_ENDED_REFUSAL}`);
    expect(git(folder, "rev-parse", "HEAD")).toBe(head);
    delete probe.gate;
  });

  it("a body reader is the route's own code: it may be async, and what it throws is answered, never left to end the process", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => void unhandled.push(reason);

    process.on("unhandledRejection", onUnhandled);
    try {
      // The reader refuses an empty body; the handler would have refused the operator's token without looking at it.
      const empty = await call(port, "POST", "/api/x/status/request", { bearer: OPERATOR });

      expect([empty.status, empty.body.error.code, empty.body.error.message]).toEqual([400, "invalid", "Say what you need. (•••)"]);
      expect((await call(port, "POST", "/api/x/status/request", { bearer: OPERATOR, body: { need: "a page" } })).body.error).toMatchObject({ code: "forbidden", message: "People only." });
      expect((await x("POST", "/request", { cookie: people.contributor.cookie, body: { need: "a page" } })).body).toEqual({ need: "a page" });
      expect((await x("POST", "/request", { cookie: people.contributor.cookie, raw: "{not json", headers: { "content-type": "application/json" } })).body.error.message).toBe("The request body isn't valid JSON.");
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });

  it("only the editor's own check says 'not signed in': whatever a handler throws, the app is never sent to sign in", async () => {
    for (const how of ["code", "status", "http"]) {
      const answer = await x("GET", `/refuse/${how}`, { cookie: people.owner.cookie });

      expect(answer.status, how).toBe(403);
      expect(answer.body.error.code, how).toBe(how === "status" ? "invalid" : "forbidden");
    }
  });

  it("keeps a declared secret from the site's commands, every line of the log and an error shown to a person", async () => {
    expect(withoutHiddenVariables({ STATUS_API_KEY: SECRET, PATH: "/bin", OTHER: "kept" })).toEqual({ PATH: "/bin", OTHER: "kept" });
    const answer = await x("GET", "/leak", { cookie: people.owner.cookie });

    expect(answer.body.error).toMatchObject({ code: "invalid", message: "The service refused the key •••." });
    expect(answer.text).not.toContain(SECRET);
    expect(logs.find((entry) => entry.includes("[status] asked with"))).toBe("[status] asked with ••• GET /api/people 200 forged");
    // A failure that isn't one of the editor's errors is written to the server's own log, stack and all: without the value.
    const crash = await x("GET", "/refuse/crash", { cookie: people.owner.cookie });

    expect([crash.status, crash.body.error.code]).toEqual([500, "internal"]);
    expect(crash.text).not.toContain(SECRET);
    expect(logs.some((entry) => entry.includes("/api/x/status/refuse/crash failed") && entry.includes("the status service refused"))).toBe(true);
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
    expect([...new Set(probe.later.filter((line) => line.startsWith("listener publish")))]).toEqual([`listener publish refused: ${NO_CALLER_REFUSAL}`]);
    // The listeners that failed did so under the extension's own name, on one line, without its secret.
    expect(logs).toContain("[status] a people listener failed: a listener broke with •••");
    expect(logs).toContain("[status] a people listener answered with a promise. It has to answer at once, so its answer was not used.");
    await until(() => logs.includes("[status] a people listener failed later: a listener broke later with •••"));
    expect(logs.join("\n")).not.toContain(SECRET);
    // Every other way a sign-in ends stops it counting too.
    const refOf = async (cookie: string) => {
      await x("GET", site(), { cookie });
      return (probe.requests.at(-1)!.caller as unknown as { session: never }).session;
    };
    const endings: Array<[string, (person: { id: string; cookie: string }) => Promise<unknown>]> = [
      ["signs out", (person) => call(port, "POST", "/api/auth/logout", { cookie: person.cookie })],
      ["is signed out by an owner", (person) => call(port, "POST", `/api/people/${person.id}/sign-out`, { cookie: people.owner.cookie })],
      ["chooses a new password", (person) => call(port, "POST", "/api/account/password", { cookie: person.cookie, body: { current: PASSWORD, next: "another long password 123" } })],
      ["is removed", (person) => call(port, "DELETE", `/api/people/${person.id}`, { cookie: people.owner.cookie })],
    ];

    for (const [how, end] of endings) {
      const person = await join_(`${how.replace(/\W+/g, "-")}@example.com`, "contributor", `Someone who ${how}`);
      const ref = await refOf(person.cookie);

      expect(desk.counts(ref), how).toBe(true);
      await end(person);
      expect(desk.counts(ref), how).toBe(false);
    }
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
    // Before it stops: what each of the editor's own routes answers a stranger, with the extension mounted.
    const withIt = await strangersAnswers(port);

    touch("published-while-stopping");
    probe.later.length = 0;
    // Work a handler leaves running that will only wake after the server has stopped.
    expect((await x("POST", site("/later"), { cookie: people.owner.cookie, body: { wait: 1200 } })).body).toEqual({ started: true });
    const heldFromARequest = probe.requests.find((request) => request.site)!.site!;
    const kept = probe.kept!;
    const keptPreview = probe.keptPreview!;

    expect(keptPreview.status().state).toBe("idle");

    expect(kept.id).toBe(siteId);
    await stopHosted(box, started);
    expect(probe.calls.stop).toBe(1);
    // Its stop ran as nobody, and its failure is one line under its own name without its secret.
    expect(probe.later.filter((line) => line.startsWith("stop publish"))).toEqual([`stop publish refused: ${NO_CALLER_REFUSAL}`]);
    expect(logs).toContain("[status] its stop failed: couldn't tidy up with •••");
    // What it was handed does nothing now: the data folder may be another server's.
    const lines = logs.length;

    expect(await probe.host!.sites.get(siteId)).toBeNull();
    probe.host!.log("after the stop");
    expect(probe.host!.people!.counts("s-anything" as never)).toBe(false);
    expect(probe.host!.people!.name(people.owner.id)).toBeNull();
    expect(logs.length).toBe(lines);
    expect(withoutHiddenVariables({ STATUS_API_KEY: SECRET })).toEqual({ STATUS_API_KEY: SECRET });
    // Nor does a site it already held: one it asked the host for, and one a request was handed. Reads, changes, even its name.
    for (const held of [kept, heldFromARequest]) {
      expect(() => held.readFile("src/content/pages/index.md")).toThrow(STOPPED);
      expect(() => held.changes()).toThrow(STOPPED);
      expect(() => held.model()).toThrow(STOPPED);
      expect(() => held.publish({ message: "After the stop" })).toThrow(STOPPED);
      expect(() => held.writeFile("src/content/pages/after.md", "x", { origin: "user", mode: "content" })).toThrow(STOPPED);
      expect(() => held.id).toThrow(STOPPED);
    }
    // Nor does a controller it took from one: the site's own dev server is not started in a folder that may be someone else's now.
    expect(() => keptPreview.status()).toThrow(STOPPED);
    expect(() => keptPreview.start()).toThrow(STOPPED);
    expect(() => keptPreview.restart()).toThrow(STOPPED);
    expect(() => keptPreview.stop()).toThrow(STOPPED);
    // The work left running wakes now, with the server's guards already dropped: still refused, by the site it holds.
    await until(() => probe.later.some((line) => line.startsWith("save ")));
    expect(probe.later.filter((line) => /^(publish|save) /.test(line))).toEqual([`publish refused: ${STOPPED}`, `save refused: ${STOPPED}`]);
    expect(git(folder, "log", "-1", "--format=%s")).not.toBe("Later");
    // The same install without the extension answers a stranger the same on every one of its routes.
    const without = await startHosted(box, started.server.home, { GALLEY_PUBLIC_URL: EDITOR, GALLEY_PASSWORD: PASSWORD, GALLEY_OWNER_NAME: "Sam Owner", GALLEY_OWNER_EMAIL: "sam@example.com", GALLEY_TOKEN: OPERATOR });
    const withoutIt = await strangersAnswers(without.port);

    await stopHosted(box, without);
    expect(Object.keys(withIt).length).toBeGreaterThan(200);
    expect(withIt).toEqual(withoutIt);
    // With it gone, a server starts; and beside that one, a server with extensions doesn't.
    const plain = await second();

    try {
      await expect(startHosted(box, box.folder("home"), { GALLEY_PUBLIC_URL: EDITOR, GALLEY_PASSWORD: PASSWORD }, { extensions: [statusExtension(newProbe())] })).rejects.toThrow(/^Extensions need the process to themselves/);
    } finally {
      await plain.close({ graceMs: 0 });
    }
  });
});
