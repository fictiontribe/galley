/**
 * GET /api/events on a hosted install, over real HTTP with real accounts:
 * how many streams one account may hold open, and what happens to a
 * connection whose other end stops reading.
 */
import { connect, type Socket } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { TOO_MANY_TOKEN_STREAMS, TOO_MANY_WINDOWS } from "../src/accounts-routes";
import { MAX_STREAMS_PER_ACCOUNT } from "../src/events";
import { call, EDITOR, sandbox, startHosted, until, type Started } from "./hosted-helpers";

const box = sandbox("event-streams");
const PASSWORD = "correct horse battery staple";
const OPERATOR = "an-operator-token-for-scripts-0000";

afterAll(() => box.cleanup(), 120_000);

async function signIn(port: number, email: string): Promise<string> {
  const answer = await call(port, "POST", "/api/auth/login", { body: { email, password: PASSWORD } });

  if (answer.status !== 200) throw new Error(`sign-in failed: ${answer.status} ${answer.text}`);
  return answer.cookies[0]!;
}

/** An install with an owner and an editor, both signed in. */
async function withTwoPeople(): Promise<Started & { owner: string; editor: string }> {
  const started = await startHosted(box, box.folder("home"), { GALLEY_PUBLIC_URL: EDITOR, GALLEY_PASSWORD: PASSWORD, GALLEY_OWNER_NAME: "Sam Owner", GALLEY_OWNER_EMAIL: "sam@example.com", GALLEY_TOKEN: OPERATOR });
  const owner = await signIn(started.port, "sam@example.com");
  const invited = await call(started.port, "POST", "/api/people/invitations", { cookie: owner, body: { email: "ed@example.com", role: "editor" } });

  expect(invited.status, invited.text).toBe(200);
  const accepted = await call(started.port, "POST", "/api/auth/link", { body: { code: String(invited.body.link.url).split("#")[1], password: PASSWORD, name: "Ed Editor" } });

  expect(accepted.status, accepted.text).toBe(200);
  return { ...started, owner, editor: accepted.cookies[0]! };
}

interface Stream {
  /** Let in, or told the account has too many open. */
  let: boolean;
  /** What the server said when it wasn't let in. */
  message: string | null;
  /** Resolves when the server ends the stream. */
  ended: Promise<void>;
  close(): void;
}

/** Opens a stream and reads its first words: the hello, or the one event that says there are too many. */
async function open(port: number, auth: { cookie?: string; bearer?: string }): Promise<Stream> {
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${port}/api/events`, {
    headers: { host: "cms.localhost", ...(auth.cookie ? { cookie: auth.cookie } : {}), ...(auth.bearer ? { authorization: `Bearer ${auth.bearer}` } : {}) },
    signal: controller.signal,
  });

  // A browser's event stream can't read an error's words: the limit is said in an event, on a stream.
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(/^text\/event-stream/);
  const reader = response.body!.getReader();
  const first = Buffer.from((await reader.read()).value ?? new Uint8Array()).toString("utf8");
  const event = JSON.parse(/^data: (.+)$/m.exec(first)?.[1] ?? "{}") as { type?: string; message?: string };
  const ended = (async () => {
    for (;;) {
      const { done } = await reader.read().catch(() => ({ done: true }));

      if (done) return;
    }
  })();

  return {
    let: event.type === "hello",
    message: event.type === "stream.limit" ? (event.message ?? null) : null,
    ended,
    close: () => {
      void reader.cancel().catch(() => undefined);
      controller.abort();
    },
  };
}

describe("event streams on a hosted install", () => {
  it("gives each account so many streams, counts them apart, says so in an event at the limit, and gives a place back when one closes", async () => {
    const { port, owner, editor } = await withTwoPeople();
    const first: Stream[] = [];

    for (let n = 0; n < MAX_STREAMS_PER_ACCOUNT; n += 1) first.push(await open(port, { cookie: owner }));
    expect(first.map((stream) => stream.let)).toEqual(first.map(() => true));

    // One more. Some of the others may be windows that went without a word, so they are all ended (the ones still
    // there would connect again by themselves) and this one is let in.
    const newcomer = await open(port, { cookie: owner });

    expect(newcomer.let).toBe(true);
    await Promise.all(first.map((stream) => stream.ended));

    // Up to the limit again with windows that are there. That was done a moment ago, so the next one is told.
    const owners: Stream[] = [newcomer];

    for (let n = 1; n < MAX_STREAMS_PER_ACCOUNT; n += 1) owners.push(await open(port, { cookie: owner }));
    expect(owners.map((stream) => stream.let)).toEqual(owners.map(() => true));
    const over = await open(port, { cookie: owner });

    expect(over.let).toBe(false);
    expect(over.message).toBe(TOO_MANY_WINDOWS);
    expect(TOO_MANY_WINDOWS).toContain(String(MAX_STREAMS_PER_ACCOUNT));
    // One event, and the stream is over.
    await over.ended;

    // Someone else's account is counted on its own.
    const eds = await open(port, { cookie: editor });

    expect(eds.let).toBe(true);

    // Closing one of the owner's gives the place back.
    owners.pop()!.close();
    let again: Stream | null = null;

    await until(async () => {
      again = await open(port, { cookie: owner });
      return again.let;
    });
    expect(again!.let).toBe(true);
    for (const stream of [...owners, eds, again!]) stream.close();
  }, 60_000);

  it("counts the operator's token as one identity, apart from the people", async () => {
    const { port, owner } = await withTwoPeople();
    const scripts: Stream[] = [];

    // The limit, one more (which ends the others and is let in), and up to the limit again.
    for (let n = 0; n < MAX_STREAMS_PER_ACCOUNT + 1; n += 1) scripts.push(await open(port, { bearer: OPERATOR }));
    for (let n = 1; n < MAX_STREAMS_PER_ACCOUNT; n += 1) scripts.push(await open(port, { bearer: OPERATOR }));
    const over = await open(port, { bearer: OPERATOR });

    expect(over.let).toBe(false);
    expect(over.message).toBe(TOO_MANY_TOKEN_STREAMS);
    const person = await open(port, { cookie: owner });

    expect(person.let).toBe(true);
    for (const stream of [...scripts, person]) stream.close();
  }, 60_000);

  it("lets go of a connection whose other end has stopped reading, and keeps the rest", async () => {
    const { port, owner, editor, server } = await withTwoPeople();
    // One reader that keeps up: it must hear everything, the last event included.
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/api/events`, { headers: { host: "cms.localhost", cookie: editor }, signal: controller.signal });
    const heard = { last: false, bytes: 0 };
    const pump = (async () => {
      const reader = response.body!.getReader();
      let tail = "";

      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));

        if (done || !value) break;
        heard.bytes += value.byteLength;
        tail = (tail + Buffer.from(value).toString("latin1")).slice(-256);
        if (tail.includes("the-last-one")) heard.last = true;
      }
    })();
    // A browser that has gone quiet: the request is sent, and nothing is read from the socket while the events go out.
    const stalled: Socket = connect({ host: "127.0.0.1", port });
    const got = { bytes: 0, closed: false };

    stalled.on("error", () => undefined);
    stalled.on("data", (chunk) => {
      got.bytes += chunk.byteLength;
    });
    stalled.on("close", () => {
      got.closed = true;
    });
    await new Promise<void>((resolve) => stalled.once("connect", () => resolve()));
    stalled.pause();
    stalled.write(`GET /api/events HTTP/1.1\r\nhost: cms.localhost\r\ncookie: ${owner}\r\n\r\n`);
    // The request has arrived once the account has a stream open: one more than the limit allows is refused only then.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const page = "x".repeat(32 * 1024);
    const events = 384;

    for (let sent = 0; sent < events; sent += 1) {
      server.services.events.emit({ type: "changes.updated", siteId: "site-1", paths: [`${sent}-${page}`], origin: "user" });
      await new Promise((resolve) => setImmediate(resolve));
    }
    server.services.events.emit({ type: "site.updated", siteId: "the-last-one" });
    await until(() => heard.last, 30_000);
    expect(heard.bytes).toBeGreaterThan(events * page.length);

    // Now the quiet one reads what was kept for it: far less than was sent, and then the connection is over.
    stalled.resume();
    await until(() => got.closed, 30_000);
    expect(got.bytes).toBeGreaterThan(0);
    expect(got.bytes).toBeLessThan((events * page.length) / 2);

    controller.abort();
    await pump;
    stalled.destroy();
  }, 120_000);
});
