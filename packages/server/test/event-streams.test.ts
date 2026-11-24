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
  status: number;
  message: string | null;
  close(): void;
}

/** Opens a stream and waits for its first words (or its refusal). */
async function open(port: number, auth: { cookie?: string; bearer?: string }): Promise<Stream> {
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${port}/api/events`, {
    headers: { host: "cms.localhost", ...(auth.cookie ? { cookie: auth.cookie } : {}), ...(auth.bearer ? { authorization: `Bearer ${auth.bearer}` } : {}) },
    signal: controller.signal,
  });

  if (response.status !== 200) {
    const body = (await response.json()) as { error?: { message?: string } };

    return { status: response.status, message: body.error?.message ?? null, close: () => undefined };
  }
  const reader = response.body!.getReader();

  await reader.read();
  return {
    status: 200,
    message: null,
    close: () => {
      void reader.cancel().catch(() => undefined);
      controller.abort();
    },
  };
}

describe("event streams on a hosted install", () => {
  it("gives each account so many streams, counts them apart, and gives a place back when one closes", async () => {
    const { port, owner, editor } = await withTwoPeople();
    const owners: Stream[] = [];

    for (let n = 0; n < MAX_STREAMS_PER_ACCOUNT; n += 1) owners.push(await open(port, { cookie: owner }));
    expect(owners.map((stream) => stream.status)).toEqual(owners.map(() => 200));

    // One more on the same account is refused, in words a person can act on.
    const over = await open(port, { cookie: owner });

    expect(over.status).toBe(429);
    expect(over.message).toBe(TOO_MANY_WINDOWS);
    expect(TOO_MANY_WINDOWS).toContain(String(MAX_STREAMS_PER_ACCOUNT));

    // Someone else's account is counted on its own.
    const eds = await open(port, { cookie: editor });

    expect(eds.status).toBe(200);

    // Closing one of the owner's gives the place back.
    owners.pop()!.close();
    let again: Stream | null = null;

    await until(async () => {
      again = await open(port, { cookie: owner });
      return again.status === 200;
    });
    expect(again!.status).toBe(200);
    for (const stream of [...owners, eds, again!]) stream.close();
  }, 60_000);

  it("counts the operator's token as one identity, apart from the people", async () => {
    const { port, owner } = await withTwoPeople();
    const scripts: Stream[] = [];

    for (let n = 0; n < MAX_STREAMS_PER_ACCOUNT; n += 1) scripts.push(await open(port, { bearer: OPERATOR }));
    const over = await open(port, { bearer: OPERATOR });

    expect(over.status).toBe(429);
    expect(over.message).toBe(TOO_MANY_TOKEN_STREAMS);
    const person = await open(port, { cookie: owner });

    expect(person.status).toBe(200);
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
