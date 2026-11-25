/**
 * Embedding: an extension's events on the live stream, and the stream as the
 * sign that a window is there. On a started hosted install with accounts and
 * two extensions, over real HTTP. Each test is a sentence someone could try
 * to break.
 */
import http from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { NO_CALLER_REFUSAL } from "@galley/core/install";
import { MAX_STREAMS_PER_ACCOUNT } from "../../src/events";
import { defineExtension, EXTENSION_EVENTS_A_SECOND, forbidden, STREAM_REFUSED, type ExtensionHost, type ExtensionStream, type JsonValue } from "../../src/extensions";
import { NOT_FROM_THE_EDITOR } from "../../src/extensions/mount";
import { NOT_A_VALUE } from "../../src/extensions/stream";
import { call, EDITOR, EDITOR_HOST, sandbox, siteRepository, startHosted, until, waitForJob, type CallInit } from "../hosted-helpers";
import { newProbe, statusExtension } from "./status";

const box = sandbox("extensions-events");
const PASSWORD = "correct horse battery staple";
const PASSPHRASE = "the backup passphrase, long";
const OPERATOR = "an-operator-token-for-scripts-0000";
const SECRET = "status-secret-value-123456";
const OWN_PAGE = { "sec-fetch-site": "same-origin" };
const probe = newProbe();
/** What the second extension was told. */
const second: { streams: ExtensionStream[]; ends: string[]; host: ExtensionHost | null } = { streams: [], ends: [], host: null };
/** What the status extension found in its own folder each time it started, and as it stopped. */
const folderAt: { setup: string[]; stop: string[] } = { setup: [], stop: [] };
let port = 0;
let siteId = "";
let folder = "";
let logs: string[] = [];
let started: Awaited<ReturnType<typeof startHosted>>;
const people: Record<"owner" | "editor" | "contributor", { id: string; cookie: string }> = { owner: { id: "", cookie: "" }, editor: { id: "", cookie: "" }, contributor: { id: "", cookie: "" } };

const x = (method: string, path: string, init: CallInit = {}, id = "status") => call(port, method, `/api/x/${id}${path}`, { ...init, headers: { ...OWN_PAGE, ...init.headers } });
const site = (rest = "") => `/sites/${siteId}${rest}`;
const noteIn = (dir: string) => {
  try {
    return readFileSync(join(dir, "note.txt"), "utf8");
  } catch {
    return "nothing";
  }
};

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

/** One window's stream, as it is heard. */
interface Listening {
  /** 0 until the server has answered. */
  status: number;
  events: Array<Record<string, any>>;
  /** Everything received, as text. */
  text: string;
  ended: boolean;
  /** The events of an extension heard so far, by name. */
  named(name: string, source?: string): Array<Record<string, any>>;
  stop(): void;
}

const listening: Listening[] = [];

/** Opens a stream. Any header can be sent: this is not a browser. */
function listen(query = "", init: { cookie?: string; bearer?: string; headers?: Record<string, string> } = {}): Listening {
  let rest = "";
  const request = http.request(
    { host: "127.0.0.1", port, path: `/api/events${query}`, agent: false, headers: { host: EDITOR_HOST, ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.bearer ? { authorization: `Bearer ${init.bearer}` } : {}), ...init.headers } },
    (response) => {
      heard.status = response.statusCode ?? 0;
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        heard.text += chunk;
        rest += chunk;
        for (let at = rest.indexOf("\n\n"); at >= 0; at = rest.indexOf("\n\n")) {
          for (const line of rest.slice(0, at).split("\n")) if (line.startsWith("data: ")) heard.events.push(JSON.parse(line.slice(6)) as Record<string, any>);
          rest = rest.slice(at + 2);
        }
      });
      response.on("close", () => (heard.ended = true));
    }
  );
  const heard: Listening = {
    status: 0,
    events: [],
    text: "",
    ended: false,
    named: (name, source = "status") => heard.events.filter((event) => event.type === "extension" && event.source === source && event.name === name),
    stop: () => request.destroy(),
  };

  request.on("error", () => (heard.ended = true));
  request.end();
  listening.push(heard);
  return heard;
}

/** Waits until each stream is open (its hello has arrived) or has been answered with something else. */
async function opened(...streams: Listening[]): Promise<void> {
  await until(() => streams.every((stream) => (stream.status === 200 ? stream.events.length > 0 : stream.status !== 0 && stream.ended)));
}

let marks = 0;
/**
 * Sends an event every reader is sent and waits until each of these streams
 * has it: whatever was sent before it has arrived by then, or never will.
 */
async function settled(...streams: Listening[]): Promise<void> {
  const note = `mark-${(marks += 1)}`;
  const sent = await x("POST", site("/emit"), { cookie: people.owner.cookie, body: { name: "changed", payload: { note, by: "a mark" } } });

  expect(sent.body, sent.text).toEqual({ tried: "done" });
  await until(() => streams.every((stream) => stream.named("changed").some((event) => event.payload.note === note)));
}

/** Asks the status extension to send an event, and says how that went. */
async function emit(body: { name: string; payload?: JsonValue; times?: number; about?: string; odd?: "bigint" | "large" }, cookie = people.owner.cookie): Promise<string> {
  const answer = await x("POST", site("/emit"), { cookie, body });

  expect(answer.status, answer.text).toBe(200);
  return answer.body.tried as string;
}

const envelope = (name: string, payload: unknown, source = "status") => ({ type: "extension", source, name, siteId, payload });

beforeAll(async () => {
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
          setup: (host) => void folderAt.setup.push(noteIn(host.stateDir)),
          stop: () => void folderAt.stop.push(noteIn(probe.host!.stateDir)),
        }),
        // A second one beside it: takes any value but "no", and has an event and a route of its own.
        defineExtension({
          id: "second",
          setup(host) {
            second.host = host;
            host.events.onStream((stream) => {
              second.streams.push(stream);
              if (stream.value === "no") throw forbidden("Second says no.");
              return () => void second.ends.push(stream.value);
            });
            return {
              events: { ping: { level: "edit" } },
              routes: {
                "POST /sites/:siteId/ping": { access: "edit", body: (input) => input as JsonValue, handle: (request) => (host.events.emit("ping", request.site!.id, request.body), { ok: true }) },
              },
            };
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

afterEach(async () => {
  // Every window of a test is closed before the next one opens its own: an account may hold only so many.
  const mine = listening.splice(0);

  for (const stream of mine) stream.stop();
  await until(() => mine.every((stream) => stream.ended));
  probe.inside = undefined;
  probe.shape = undefined;
});

afterAll(async () => {
  delete process.env.STATUS_API_KEY;
  await box.cleanup();
}, 120_000);

describe("an extension's events", () => {
  it("reach the readers their rule's level allows, shaped for each, in an envelope that is the server's", async () => {
    const streams = { owner: listen("", { cookie: people.owner.cookie }), editor: listen("", { cookie: people.editor.cookie }), contributor: listen("", { cookie: people.contributor.cookie }), operator: listen("", { bearer: OPERATOR }) };
    const all = Object.values(streams);

    await opened(...all);
    // The worked example: a note is left, and every window hears of it. Who left it is for those who may publish.
    expect((await x("POST", site("/note"), { cookie: people.editor.cookie, body: { text: "Ready for Monday" } })).body).toEqual({ ok: true });
    await settled(...all);
    for (const reader of [streams.owner, streams.editor, streams.operator]) expect(reader.named("changed")[0]).toEqual(envelope("changed", { note: "Ready for Monday", by: "Ed Editor" }));
    expect(streams.contributor.named("changed")[0]).toEqual(envelope("changed", { note: "Ready for Monday" }));
    expect(Object.keys(streams.owner.named("changed")[0]!).sort()).toEqual(["name", "payload", "siteId", "source", "type"]);

    // An owners' event, sent by a route anyone may call: the level is the event's, not the sender's.
    expect(await emit({ name: "owners.only", payload: { figure: "for owners alone" } }, people.contributor.cookie)).toBe("done");
    // One for those who may publish, whose rule notes every reader it is asked about.
    probe.shapedFor.length = 0;
    expect(await emit({ name: "for.publishers", payload: { draft: "for publishers" } }, people.contributor.cookie)).toBe("done");
    await settled(...all);
    expect(streams.owner.named("owners.only")).toEqual([envelope("owners.only", { figure: "for owners alone" })]);
    // The operator's stream is filtered like anyone's, and the operator has every level.
    expect(streams.operator.named("owners.only")).toHaveLength(1);
    for (const reader of [streams.editor, streams.contributor]) expect(reader.text).not.toContain("for owners alone");
    for (const reader of [streams.owner, streams.editor, streams.operator]) expect(reader.named("for.publishers")).toEqual([envelope("for.publishers", { draft: "for publishers" })]);
    expect(streams.contributor.text).not.toContain("for publishers");
    // The rule was never asked about someone below its level: it can narrow what they are sent, not widen it.
    expect(probe.shapedFor.map((reader) => (reader.kind === "person" ? reader.role : reader.kind)).sort()).toEqual(["editor", "operator", "owner"]);
  });

  it("see each reader as they are at that event: a role taken away is gone at the next one, and a stream that is switched off ends", async () => {
    const tess = await join_("tess@example.com", "editor", "Tess Temp");
    const stream = listen("", { cookie: tess.cookie });
    const owner = listen("", { cookie: people.owner.cookie });

    await opened(stream, owner);
    expect(await emit({ name: "changed", payload: { note: "one", by: "Sam Owner" } })).toBe("done");
    await settled(stream);
    expect(stream.named("changed")[0]!.payload).toEqual({ note: "one", by: "Sam Owner" });
    expect(await emit({ name: "for.publishers", payload: 1 })).toBe("done");

    // Made a contributor while the stream stays open.
    expect((await call(port, "PATCH", `/api/people/${tess.id}`, { cookie: people.owner.cookie, body: { role: "contributor" } })).status).toBe(200);
    probe.shapedFor.length = 0;
    expect(await emit({ name: "changed", payload: { note: "two", by: "Sam Owner" } })).toBe("done");
    expect(await emit({ name: "for.publishers", payload: 2 })).toBe("done");
    expect(await emit({ name: "shaped", payload: { n: 1, list: [] } })).toBe("done");
    await settled(stream);
    expect(stream.ended).toBe(false);
    expect(stream.named("changed").find((event) => event.payload.note === "two")!.payload).toEqual({ note: "two" });
    expect(stream.named("for.publishers").map((event) => event.payload)).toEqual([1]);
    // The rule is handed the reader as they are now.
    expect(probe.shapedFor.filter((reader) => reader.kind === "person" && reader.account === tess.id).map((reader) => (reader.kind === "person" ? reader.role : ""))).toEqual(["contributor"]);

    // Switched off: the stream ends, and no rule is asked about them again.
    expect((await call(port, "PATCH", `/api/people/${tess.id}`, { cookie: people.owner.cookie, body: { disabled: true } })).status).toBe(200);
    await until(() => stream.ended);
    probe.shapedFor.length = 0;
    expect(await emit({ name: "shaped", payload: { n: 2, list: [] } })).toBe("done");
    await settled(owner);
    expect(probe.shapedFor.some((reader) => reader.kind === "person" && reader.account === tess.id)).toBe(false);
  });

  it("can only be ones the extension declared, about a site it was handed, as JSON of a bounded size, and not before it has started", async () => {
    const stream = listen("", { cookie: people.owner.cookie });

    await opened(stream);
    expect(await emit({ name: "nope" })).toBe("refused: “nope” isn't an event this extension declared.");
    // Not the server's own name, not one of the editor's own events, not another extension's.
    expect(await emit({ name: STREAM_REFUSED, payload: { code: "forbidden", message: "forged" } })).toBe("refused: “stream.refused” isn't an event this extension declared.");
    expect(await emit({ name: "forms.submission" })).toBe("refused: “forms.submission” isn't an event this extension declared.");
    expect(await emit({ name: "ping" })).toBe("refused: “ping” isn't an event this extension declared.");
    expect(await emit({ name: "changed", about: "another-site" })).toBe("refused: An event is about a site this extension has been handed. Ask for the site first.");
    expect(await emit({ name: "changed", odd: "bigint" })).toBe("refused: An event's payload is JSON of at most 64 KB.");
    expect(await emit({ name: "changed", odd: "large" })).toBe("refused: An event's payload is JSON of at most 64 KB.");
    expect(probe.early).toBe("refused: An event can be sent once setup has returned: that is when the server learns which events there are.");

    // A payload with a type and a source of its own stays a payload: the envelope's keys are filled in by the server.
    const forged = { type: "job", source: "second", name: "ping", siteId: "elsewhere" };

    expect(await emit({ name: "owners.only", payload: forged })).toBe("done");
    // The other extension's event carries its id, whatever it is called.
    expect((await x("POST", site("/ping"), { cookie: people.owner.cookie, body: { source: "status" } }, "second")).body).toEqual({ ok: true });
    await settled(stream);
    expect(stream.events.filter((event) => event.type === "extension" && event.payload?.by !== "a mark")).toEqual([envelope("owners.only", forged), envelope("ping", { source: "status" }, "second")]);
  });

  it("with a rule that misbehaves send that reader nothing, keep each reader's copy their own, and say so once", async () => {
    const readers = [listen("", { cookie: people.owner.cookie }), listen("", { cookie: people.editor.cookie }), listen("", { bearer: OPERATOR })];

    await opened(...readers);
    // A rule that writes onto what it was handed: the next reader's rule is handed a copy of its own.
    probe.shape = (payload) => {
      payload.list.push(payload.list.length);
      return payload;
    };
    expect(await emit({ name: "shaped", payload: { n: 1, list: [0] } })).toBe("done");
    const from = logs.length;
    const odd: Array<() => unknown> = [
      () => {
        throw new Error(`the rule broke with ${SECRET}`);
      },
      () => undefined,
      async () => ({ n: 4, list: [] }),
      () => Promise.reject(new Error("later")),
      () => {
        const loop: Record<string, unknown> = { n: 6 };

        loop.me = loop;
        return loop;
      },
      () => ({ n: 7, text: "x".repeat(70_000) }),
      // Nothing for this reader: allowed, and not worth a line.
      () => null,
    ];

    for (const [index, shape] of odd.entries()) {
      probe.shape = shape;
      expect(await emit({ name: "shaped", payload: { n: index + 2, list: [] } })).toBe("done");
    }
    probe.shape = undefined;
    expect(await emit({ name: "shaped", payload: { n: 9, list: [] } })).toBe("done");
    await settled(...readers);
    for (const reader of readers) expect(reader.named("shaped").map((event) => event.payload)).toEqual([{ n: 1, list: [0, 1] }, { n: 9, list: [] }]);
    // Seven events to three readers each, said once for each kind of failure, with the secret taken out.
    expect(logs.slice(from).filter((line) => line.includes("the rule for “shaped”"))).toEqual([
      "[status] the rule for “shaped” failed: the rule broke with •••",
      "[status] the rule for “shaped” answered with something that isn't JSON of at most 64 KB, so nothing was sent to that reader.",
    ]);
  });

  it("past fifty a second are dropped, without an error for the sender, and the log says how many", async () => {
    const stream = listen("", { cookie: people.owner.cookie });

    await opened(stream);
    // A second of its own, so that what the tests before this one sent doesn't count.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const from = logs.length;

    expect(await emit({ name: "changed", payload: { note: "burst", by: "Sam Owner" }, times: 130 })).toBe("done");
    await until(() => logs.slice(from).some((line) => line.includes("events in a second")), 10_000);
    const line = logs.slice(from).find((entry) => entry.includes("events in a second"))!;
    const dropped = Number(/: (\d+) were dropped\.$/.exec(line)?.[1]);

    await settled(stream);
    const arrived = stream.named("changed").filter((event) => event.payload.note === "burst").length;

    expect(line).toBe(`[status] it sent more than ${EXTENSION_EVENTS_A_SECOND} events in a second: ${dropped} were dropped.`);
    // The burst may straddle two seconds: fifty in each at most, and every one of the 130 either arrived or was counted.
    expect(arrived + dropped).toBe(130);
    expect(arrived).toBeGreaterThanOrEqual(EXTENSION_EVENTS_A_SECOND);
    expect(arrived).toBeLessThanOrEqual(2 * EXTENSION_EVENTS_A_SECOND);
  });
});

describe("a stream that carries a value for an extension", () => {
  it("tells it the window is there, who is at it, and when it has gone; all of it outside any person", async () => {
    writeFileSync(join(folder, "src/content/pages/to-publish.md"), "---\ntitle: To publish\n---\nSomething to publish\n");
    // What the listener, what it hands back and a rule each try: to publish, in whoever's name they are running.
    probe.inside = (where) => void probe.host!.sites.get(siteId).then(async (open) => probe.later.push(`${where}: publish ${await open!.publish({ message: where }).then(() => "done", (error: Error) => `refused: ${error.message}`)}`));
    const from = probe.streams.length;
    const window = listen("?x-status=tab-1", { cookie: people.owner.cookie, headers: OWN_PAGE });

    await opened(window);
    const told = probe.streams.at(-1)!;

    expect(probe.streams.length).toBe(from + 1);
    expect(told).toEqual({ value: "tab-1", caller: { kind: "person", account: people.owner.id, role: "owner", name: "Sam Owner", session: expect.any(String) } });
    // The sign-in it names is one the extension can ask about, and nothing of the cookie.
    if (told.caller.kind !== "person") throw new Error("a person was expected");
    expect(probe.host!.people!.counts(told.caller.session)).toBe(true);
    expect(decodeURIComponent(people.owner.cookie)).not.toContain(told.caller.session);

    // A stream without a value, and one with a value for nobody here, tell nobody.
    const plain = listen("", { cookie: people.owner.cookie });
    const stranger = listen("?x-nobody=tab-1&status=tab-1", { cookie: people.owner.cookie });

    await opened(plain, stranger);
    expect([plain.status, stranger.status, probe.streams.length]).toEqual([200, 200, from + 1]);
    // A script with the operator's token is told as the operator.
    const script = listen("?x-status=script.1", { bearer: OPERATOR });

    await opened(script);
    expect(probe.streams.at(-1)).toEqual({ value: "script.1", caller: { kind: "operator" } });

    // A rule runs as nobody too, though the owner's own request sent the event.
    expect(await emit({ name: "shaped", payload: { n: 1, list: [] } })).toBe("done");
    // Gone: told once, for each.
    window.stop();
    script.stop();
    await until(() => probe.streamEnds.includes("tab-1") && probe.streamEnds.includes("script.1"));
    await until(() => ["stream opened", "stream ended", "rule"].every((where) => probe.later.some((line) => line.startsWith(`${where}: `))));
    expect(probe.streamEnds.filter((value) => value === "tab-1")).toHaveLength(1);
    expect([...new Set(probe.later.filter((line) => /^(stream opened|stream ended|rule): /.test(line)))].sort()).toEqual(["rule", "stream ended", "stream opened"].map((where) => `${where}: publish refused: ${NO_CALLER_REFUSAL}`));
  });

  it("can have its value refused, never the stream: the window is told, and everything else goes on", async () => {
    const from = logs.length;
    const refused = listen("?x-status=refuse-me&x-second=fine", { cookie: people.editor.cookie, headers: OWN_PAGE });

    await opened(refused);
    await until(() => refused.events.length >= 2);
    // Right after the hello, with the error's own code and words, the secret taken out.
    expect(refused.events.slice(0, 2)).toEqual([{ type: "hello", version: expect.any(String) }, { type: "extension", source: "status", name: STREAM_REFUSED, siteId: "", payload: { code: "forbidden", message: "Not that one. (•••)" } }]);
    // The other extension took its own value, and the stream carries on: one of the editor's own events, and an extension's.
    expect(second.streams.at(-1)).toMatchObject({ value: "fine" });
    started.server.services.events.emit({ type: "forms.submission", siteId, form: "contact", change: "updated", ids: ["one"] } as never);
    await settled(refused);
    expect(refused.events.some((event) => event.type === "forms.submission")).toBe(true);
    expect(refused.named(STREAM_REFUSED, "second")).toEqual([]);

    // The other way round: the second refuses, the first is told as usual and told again when the window goes.
    const half = listen("?x-status=tab-2&x-second=no", { cookie: people.editor.cookie, headers: OWN_PAGE });

    await opened(half);
    await until(() => half.events.length >= 2);
    expect(half.events[1]).toEqual({ type: "extension", source: "second", name: STREAM_REFUSED, siteId: "", payload: { code: "forbidden", message: "Second says no." } });
    expect(half.named(STREAM_REFUSED)).toEqual([]);
    expect(probe.streams.at(-1)).toMatchObject({ value: "tab-2" });
    half.stop();
    refused.stop();
    await until(() => probe.streamEnds.includes("tab-2") && second.ends.includes("fine"));
    // What was refused is never told that it ended.
    expect(probe.streamEnds).not.toContain("refuse-me");
    expect(second.ends).not.toContain("no");

    // A listener that fails in any other way: the window is told in general words, and the log has the rest.
    const broken = listen("?x-status=break", { cookie: people.editor.cookie, headers: OWN_PAGE });
    // One that answers with a promise: its answer isn't used, and the value isn't refused.
    const promised = listen("?x-status=promise", { cookie: people.editor.cookie, headers: OWN_PAGE });

    await opened(broken, promised);
    await settled(broken, promised);
    expect(broken.named(STREAM_REFUSED).map((event) => event.payload)).toEqual([{ code: "internal", message: "That couldn't be taken because of an unexpected problem." }]);
    expect(promised.named(STREAM_REFUSED)).toEqual([]);
    expect(logs.slice(from).filter((line) => line.includes("a stream listener"))).toEqual([
      "[status] a stream listener failed: the listener broke with •••",
      "[status] a stream listener answered with a promise. It has to answer at once, so its answer was not used.",
    ]);
  });

  it("shows the extension only what is a value: anything else is answered for it", async () => {
    const from = probe.streams.length;

    for (const value of ["", "a%20b", "a%2Fb", "..%2F..%2Fsession.key", "caf%C3%A9", "a%0Ab", "x".repeat(129)]) {
      const stream = listen(`?x-status=${value}`, { cookie: people.editor.cookie, headers: OWN_PAGE });

      await opened(stream);
      await until(() => stream.events.length >= 2);
      expect(stream.events[1], value).toEqual({ type: "extension", source: "status", name: STREAM_REFUSED, siteId: "", payload: { code: "invalid", message: NOT_A_VALUE } });
      stream.stop();
    }
    expect(probe.streams.length).toBe(from);
    // Every character a value may have, and the longest one.
    for (const value of ["A-Za-z0-9._~-", "x".repeat(128)]) {
      const stream = listen(`?x-status=${value}`, { cookie: people.editor.cookie, headers: OWN_PAGE });

      await opened(stream);
      expect(probe.streams.at(-1)!.value).toBe(value);
      stream.stop();
    }
  });

  it("is opened only by the editor's own page: a page on another origin can't say a window is there", async () => {
    const from = probe.streams.length;

    for (const where of ["same-site", "cross-site", undefined]) {
      const stream = listen("?x-status=tab-9", { cookie: people.owner.cookie, headers: where ? { "sec-fetch-site": where } : {} });

      await opened(stream);
      expect([stream.status, JSON.parse(stream.text).error], String(where)).toEqual([403, { code: "forbidden", message: NOT_FROM_THE_EDITOR }]);
    }
    expect(probe.streams.length).toBe(from);
    // The editor's own page, and an address typed by hand.
    for (const where of ["same-origin", "none"]) {
      const stream = listen("?x-status=tab-9", { cookie: people.owner.cookie, headers: { "sec-fetch-site": where } });

      await opened(stream);
      expect(stream.status, where).toBe(200);
    }
    expect(probe.streams.length).toBe(from + 2);
    // A stream without a value is as it always was, wherever it is opened from.
    for (const where of ["same-site", "cross-site", undefined]) {
      const stream = listen("", { cookie: people.owner.cookie, headers: where ? { "sec-fetch-site": where } : {} });

      await opened(stream);
      expect(stream.status, String(where)).toBe(200);
    }
    // A script's token is no browser's: it passes without the header.
    const script = listen("?x-status=tab-9", { bearer: OPERATOR });

    await opened(script);
    expect([script.status, probe.streams.length]).toEqual([200, from + 3]);
  });

  it("never reaches the extension for a stream told its account has too many, and when streams are ended to make room each is told", async () => {
    const win = await join_("win@example.com", "editor", "Win Dows");
    const open = async (value: string) => {
      const stream = listen(`?x-status=${value}`, { cookie: win.cookie, headers: OWN_PAGE });

      await opened(stream);
      return stream;
    };
    const told = () => probe.streams.filter((stream) => stream.caller.kind === "person" && stream.caller.account === win.id).map((stream) => stream.value);
    const first: Listening[] = [];

    for (let index = 1; index <= MAX_STREAMS_PER_ACCOUNT; index += 1) first.push(await open(`first-${index}`));
    expect(told()).toHaveLength(MAX_STREAMS_PER_ACCOUNT);
    // One more: the others are ended to find the ones nobody reads any more, and the extension hears each of them go.
    const room = await open("room");

    await until(() => first.every((stream) => stream.ended));
    await until(() => first.every((_, index) => probe.streamEnds.includes(`first-${index + 1}`)));
    expect(told().at(-1)).toBe("room");
    for (let index = 2; index <= MAX_STREAMS_PER_ACCOUNT; index += 1) await open(`again-${index}`);
    // Full again, and too soon to end them all once more: this one is told so, and the extension is told nothing.
    const over = await open("one-too-many");

    await until(() => over.ended);
    expect(over.events).toEqual([{ type: "stream.limit", message: expect.stringContaining("Too many windows") }]);
    expect(told()).not.toContain("one-too-many");
    expect(room.ended).toBe(false);
  });
});

describe("a backup put back under a server with extensions", () => {
  it("stops them before the folder is replaced, starts them again on what was restored, and has every window say again that it is there", async () => {
    const first = probe.host!;
    const note = join(first.stateDir, "note.txt");

    writeFileSync(note, "as it was at the backup");
    const backup = await call(port, "POST", "/api/install/backup", { cookie: people.owner.cookie, body: { passphrase: PASSPHRASE } });

    expect(backup.status, backup.text).toBe(200);
    writeFileSync(note, "written after the backup");
    expect((await x("POST", site("/note"), { cookie: people.owner.cookie, body: { text: "Kept in memory" } })).body).toEqual({ ok: true });
    const window = listen("?x-status=before", { cookie: people.owner.cookie, headers: OWN_PAGE });

    await opened(window);
    const upload = await call(port, "POST", "/api/install/restore/upload", { cookie: people.owner.cookie, raw: backup.bytes });

    expect(upload.status, upload.text).toBe(200);
    const job = await call(port, "POST", "/api/install/restore", { cookie: people.owner.cookie, body: { upload: upload.body.id, passphrase: PASSPHRASE } });
    const done = await waitForJob(port, job.body, { cookie: people.owner.cookie });

    expect(done.state, done.detail).toBe("done");
    // "Done" means everything runs: the extension had started again before the job said so.
    expect(probe.calls.setup).toBe(2);
    await until(() => window.ended);
    // Stopped while its folder was still as it had left it; started again, once, on the folder the backup holds.
    expect(folderAt.stop).toEqual(["written after the backup"]);
    expect(folderAt.setup).toEqual(["nothing", "as it was at the backup"]);
    expect(probe.host).not.toBe(first);
    expect(probe.host!.stateDir).toBe(first.stateDir);
    // What it was handed the first time does nothing any more.
    expect(() => first.events.emit("changed", siteId, { note: "from before", by: "nobody" })).toThrow("This extension has been stopped, so it can no longer send events.");
    expect(await first.sites.get(siteId)).toBeNull();
    // The window from before: its stream was ended so that it opens another, and the stopped extension was not called about it.
    expect(probe.streamEnds).not.toContain("before");
    // The one who started the restore heard how it ended on that stream, before it was ended.
    expect(window.events.some((event) => event.type === "job" && event.job?.id === job.body.id && event.job?.state === "done")).toBe(true);

    // Everyone signs in again, and what answers is the one running now: it has no note in memory, and is told of the new window.
    const cookie = await signIn("sam@example.com");
    const status = await x("GET", site(), { cookie });

    expect([status.status, status.body.note]).toEqual([200, null]);
    const after = listen("?x-status=after&x-second=after", { cookie, headers: OWN_PAGE });

    await opened(after);
    expect(probe.streams.at(-1)).toMatchObject({ value: "after", caller: { kind: "person", name: "Sam Owner" } });
    expect(second.streams.at(-1)).toMatchObject({ value: "after" });
    expect((await x("POST", site("/note"), { cookie, body: { text: "After the restore" } })).body).toEqual({ ok: true });
    await until(() => after.named("changed").length > 0);
    expect(after.named("changed")[0]).toEqual(envelope("changed", { note: "After the restore", by: "Sam Owner" }));
  }, 120_000);
});
