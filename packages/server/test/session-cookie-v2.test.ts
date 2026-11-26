/**
 * A hosted session's end and kind, signed into its cookie (v2): the format
 * and what a changed byte does to it; an older cookie still read as a
 * password session; and the session's own end in every place that reads one
 * — a request, the preview's viewer value (v3; an older value refused), the
 * extensions' record of a sign-in — and in how long a sign-out is kept. A
 * changed password gives the browser a cookie for the same session: its end
 * and kind stay. (The event stream: event-streams.test.ts.)
 */
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createPeople, openInstallState, type Install } from "@galley/core/install";
import { readKnownBrowser, readSession, SESSION_MAX_AGE_S, sessionRunning, signKnownBrowser, signSession, type SessionInfo } from "../src/auth";
import { createPeopleDesk } from "../src/extensions/people";
import { createGatewayTickets } from "../src/gateway-auth";
import { call, EDITOR, sandbox, startHosted, type Started } from "./hosted-helpers";

const box = sandbox("session-cookie-v2");
const PASSWORD = "correct horse battery staple";
const DAY = 24 * 60 * 60_000;
const HOUR = 60 * 60_000;

afterAll(() => box.cleanup(), 120_000);

const hmac = (key: Uint8Array, text: string) => createHmac("sha256", key).update(text).digest("base64url");

/** A hosted cookie as versions before v2 made it: `issuedAt.nonce.accountId.mac`. */
function v1Cookie(key: Uint8Array, issuedAt: number, accountId: string): string {
  const payload = `${issuedAt}.${randomBytes(16).toString("base64url")}.${accountId}`;

  return `${payload}.${hmac(key, `account-session/v1\n${payload}`)}`;
}

/** The parts of a v2 cookie, by name. */
function partsOf(value: string) {
  const [version, issuedAt, expiresAt, kind, nonce, accountId, mac] = value.split(".");

  return { version, issuedAt: Number(issuedAt), expiresAt: Number(expiresAt), kind, nonce, accountId, mac };
}

describe("the v2 session cookie", () => {
  const key = randomBytes(32);
  const now = Date.UTC(2026, 10, 25, 12);

  it("carries its issue, end, kind, id and person under its MAC; a password session lasts 30 days by default", () => {
    const value = signSession(key, now, "nonce_1", "acc_1");

    expect(value.split(".")).toHaveLength(7);
    expect(partsOf(value)).toMatchObject({ version: "2", issuedAt: now, expiresAt: now + SESSION_MAX_AGE_S * 1000, kind: "password", nonce: "nonce_1", accountId: "acc_1" });
    expect(readSession(key, value, now)).toEqual({ id: "nonce_1", issuedAt: now, expiresAt: now + SESSION_MAX_AGE_S * 1000, kind: "password", accountId: "acc_1" });
    const provider = signSession(key, now, "nonce_2", "acc_1", { expiresAt: now + 12 * HOUR, kind: "provider" });

    expect(readSession(key, provider, now)).toEqual({ id: "nonce_2", issuedAt: now, expiresAt: now + 12 * HOUR, kind: "provider", accountId: "acc_1" });
  });

  it("ends at its own end, and is refused a minute later; never before it is issued (beyond a minute of clock skew)", () => {
    const value = signSession(key, now, undefined, "acc_1", { expiresAt: now + 12 * HOUR, kind: "provider" });

    expect(readSession(key, value, now + 12 * HOUR - 1)).not.toBeNull();
    expect(readSession(key, value, now + 12 * HOUR)).toBeNull();
    expect(readSession(key, value, now + 12 * HOUR + 60_000)).toBeNull();
    expect(readSession(key, value, now - 61_000)).toBeNull();
  });

  it("is refused when any part is changed: a later end, another kind, another person, another id, or the older label", () => {
    const value = signSession(key, now, "nonce_1", "acc_1", { expiresAt: now + 12 * HOUR, kind: "recovery" });
    const p = partsOf(value);
    const swapped = [
      [p.version, p.issuedAt, now + 20 * DAY, p.kind, p.nonce, p.accountId, p.mac],
      [p.version, p.issuedAt, p.expiresAt, "provider", p.nonce, p.accountId, p.mac],
      [p.version, p.issuedAt, p.expiresAt, "password", p.nonce, p.accountId, p.mac],
      [p.version, p.issuedAt, p.expiresAt, p.kind, p.nonce, "acc_2", p.mac],
      [p.version, p.issuedAt, p.expiresAt, p.kind, "nonce_2", p.accountId, p.mac],
      [p.version, p.issuedAt - 1, p.expiresAt, p.kind, p.nonce, p.accountId, p.mac],
      ["3", p.issuedAt, p.expiresAt, p.kind, p.nonce, p.accountId, p.mac],
    ];

    for (const parts of swapped) expect(readSession(key, parts.join("."), now)).toBeNull();
    // Signed with the older cookie's label, the same seven parts are nothing.
    const payload = value.split(".").slice(0, 6).join(".");

    expect(readSession(key, `${payload}.${hmac(key, `account-session/v1\n${payload}`)}`, now)).toBeNull();
    expect(readSession(randomBytes(32), value, now)).toBeNull();
    // An unknown kind, even signed, is no session.
    const odd = `2.${now}.${now + HOUR}.admin.nonce_3.acc_1`;

    expect(readSession(key, `${odd}.${hmac(key, `account-session/v2\n${odd}`)}`, now)).toBeNull();
  });

  it("can't be read as a local cookie, an older hosted cookie or a known browser, nor they as it", () => {
    const value = signSession(key, now, undefined, "acc_1");
    const known = signKnownBrowser(key, "acc_1", now);

    expect(readKnownBrowser(key, value, now)).toBeNull();
    expect(readSession(key, known, now)).toBeNull();
    expect(readSession(key, value.split(".").slice(1).join("."), now)).toBeNull();
    expect(readSession(key, value.split(".").slice(0, 5).concat(partsOf(value).mac!).join("."), now)).toBeNull();
  });

  it("is never made to last longer than 30 days, end before it starts, or be of an unknown kind; one signed that way anyway is refused", () => {
    expect(() => signSession(key, now, undefined, "acc_1", { expiresAt: now + SESSION_MAX_AGE_S * 1000 + 1 })).toThrow(/lasts no longer/);
    expect(() => signSession(key, now, undefined, "acc_1", { expiresAt: now })).toThrow(/ends after it starts/);
    expect(() => signSession(key, now, undefined, "acc_1", { kind: "admin" as never })).toThrow(/is started with/);
    expect(() => signSession(key, now, "a.b", "acc_1")).toThrow(/letters, digits/);
    const long = `2.${now}.${now + 31 * DAY}.password.nonce_4.acc_1`;

    expect(readSession(key, `${long}.${hmac(key, `account-session/v2\n${long}`)}`, now)).toBeNull();
    expect(sessionRunning({ issuedAt: now, expiresAt: now + 31 * DAY }, now)).toBe(false);
  });

  it("an older hosted cookie is still read, as a password session ending 30 days after its issue; a local cookie as before", () => {
    const older = v1Cookie(key, now, "acc_1");

    expect(readSession(key, older, now)).toMatchObject({ issuedAt: now, expiresAt: now + SESSION_MAX_AGE_S * 1000, kind: "password", accountId: "acc_1" });
    expect(readSession(key, older, now + SESSION_MAX_AGE_S * 1000 + 60_000)).toBeNull();
    const local = signSession(key, now);

    expect(local.split(".")).toHaveLength(3);
    expect(readSession(key, local, now)).toEqual({ id: local.split(".")[1], issuedAt: now, expiresAt: now + SESSION_MAX_AGE_S * 1000 });
  });
});

describe("a session cookie and a viewer value", () => {
  it("can't be read as each other, either way; a seven-part value is a session only with the tag 2", async () => {
    const store = await openInstallState(box.folder("cross"));
    const people = createPeople(store);
    const owner = await people.createOwner({ password: PASSWORD, name: "Sam", email: "sam@example.com" });
    const key = randomBytes(32);
    const tickets = createGatewayTickets({ key, store });
    const issuedAt = store.nextIssuedAt(Date.now(), owner.id);
    const cookie = signSession(key, issuedAt, "same-id", owner.id);
    const session = readSession(key, cookie)!;
    const viewer = tickets.redeem(tickets.issue(session))!;

    // Both are seven parts made from the same session with the same key, under labels of their own.
    expect([cookie.split(".").length, viewer.split(".").length]).toEqual([7, 7]);
    expect(readSession(key, viewer)).toBeNull();
    expect(tickets.check(cookie)).toBe(false);
    expect(tickets.check(viewer)).toBe(true);
    // The viewer value's payload signed as a session, or the cookie's signed as a viewer value: still nothing, unless the tag is theirs.
    const asSession = `v3.${viewer.split(".").slice(1, 6).join(".")}`;
    const asViewer = `2.${cookie.split(".").slice(1, 6).join(".")}`;

    expect(readSession(key, `${asSession}.${hmac(key, `account-session/v2\n${asSession}`)}`)).toBeNull();
    expect(tickets.check(`${asViewer}.${createHmac("sha256", key).update(`preview-viewer/v3\n${asViewer.split(".").slice(1).join(".")}`).digest("base64url")}`)).toBe(false);
    // Seven parts, correctly signed under the session label, but tagged other than 2.
    for (const tag of ["1", "3", "v2", "02", ""]) {
      const payload = [tag, ...cookie.split(".").slice(1, 6)].join(".");

      expect(readSession(key, `${payload}.${hmac(key, `account-session/v2\n${payload}`)}`)).toBeNull();
    }
    tickets.dispose();
  });

  it("a viewer value's MAC is taken only as it was written: another spelling of the same bytes is refused", async () => {
    const store = await openInstallState(box.folder("spelling"));
    const people = createPeople(store);
    const owner = await people.createOwner({ password: PASSWORD, name: "Sam", email: "sam@example.com" });
    const key = randomBytes(32);
    const tickets = createGatewayTickets({ key, store });
    const issuedAt = store.nextIssuedAt(Date.now(), owner.id);
    const viewer = tickets.redeem(tickets.issue({ id: "an-id", issuedAt, expiresAt: issuedAt + HOUR, kind: "password", accountId: owner.id }))!;
    const signature = viewer.split(".").at(-1)!;
    // 43 characters carry 258 bits for 256: the last one's two lowest bits are spare, so three other letters give the same bytes.
    const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const last = ALPHABET.indexOf(signature.at(-1)!);
    const respelled = [1, 2, 3].map((flip) => `${viewer.slice(0, -1)}${ALPHABET[last ^ flip]}`);

    for (const value of respelled) {
      expect(Buffer.from(value.split(".").at(-1)!, "base64url")).toEqual(Buffer.from(signature, "base64url"));
      expect(tickets.check(value)).toBe(false);
    }
    expect(tickets.check(viewer)).toBe(true);
    tickets.dispose();
  });
});

describe("the session's own end, wherever a session is read", () => {
  it("the preview's viewer value (v3) carries it and stops at it; an older (v2) value is refused", async () => {
    const store = await openInstallState(box.folder("viewer"));
    const people = createPeople(store);
    const owner = await people.createOwner({ password: PASSWORD, name: "Sam", email: "sam@example.com" });
    const key = randomBytes(32);
    let at = Date.now();
    const tickets = createGatewayTickets({ key, store, now: () => at });
    const issuedAt = store.nextIssuedAt(at, owner.id);
    const session: SessionInfo = { id: randomBytes(16).toString("base64url"), issuedAt, expiresAt: issuedAt + 12 * HOUR, kind: "provider", accountId: owner.id };
    const value = tickets.redeem(tickets.issue(session))!;

    expect(value.split(".")).toHaveLength(7);
    expect(value.split(".").slice(0, 4)).toEqual(["v3", String(issuedAt), String(issuedAt + 12 * HOUR), "provider"]);
    expect(tickets.check(value)).toBe(true);
    // The kind and the end are under the MAC.
    expect(tickets.check(value.replace(".provider.", ".password."))).toBe(false);
    expect(tickets.check(value.replace(`.${issuedAt + 12 * HOUR}.`, `.${issuedAt + 20 * DAY}.`))).toBe(false);
    // The older value for the same session, signed as it was: refused from now on.
    const older = `${issuedAt}.${session.id}.${owner.id}`;

    expect(tickets.check(`v2.${older}.${createHmac("sha256", key).update(`preview-viewer/v2\n${older}`).digest("base64url")}`)).toBe(false);
    // A ticket made before the end and traded after it gets nothing; the value already set stops a minute after the end.
    const waiting = tickets.issue(session);

    at = issuedAt + 12 * HOUR + 60_000;
    expect(tickets.check(value)).toBe(false);
    expect(tickets.redeem(waiting)).toBeNull();
    tickets.dispose();
  });

  it("the extensions' record of a sign-in keeps its end and kind, and stops counting at that end", async () => {
    const store = await openInstallState(box.folder("desk"));
    const people = createPeople(store);
    const owner = await people.createOwner({ password: PASSWORD, name: "Sam", email: "sam@example.com" });
    const desk = createPeopleDesk({ store } as unknown as Install, { has: () => false });
    const issuedAt = store.nextIssuedAt(Date.now(), owner.id);
    const short: SessionInfo = { id: "short-one", issuedAt, expiresAt: issuedAt + 12 * HOUR, kind: "provider", accountId: owner.id };
    const long: SessionInfo = { ...short, id: "long-one", expiresAt: issuedAt + SESSION_MAX_AGE_S * 1000, kind: "password" };
    const shortRef = desk.refOf(short);
    const longRef = desk.refOf(long);

    expect([desk.counts(shortRef), desk.counts(longRef)]).toEqual([true, true]);
    expect(desk.stillCounts(short, issuedAt + 12 * HOUR + 60_000)).toBe(false);
    expect(desk.stillCounts(long, issuedAt + 12 * HOUR + 60_000)).toBe(true);
    // The same id with another end or kind is another sign-in to an extension.
    expect(desk.refOf({ ...short, expiresAt: short.expiresAt + 1 })).not.toBe(shortRef);
    expect(desk.refOf({ ...short, kind: "password" })).not.toBe(shortRef);
  });
});

describe("on a hosted install", () => {
  async function withOwner(): Promise<Started & { home: string; key: Buffer; ownerId: string; cookieName: string; owner: string }> {
    const home = box.folder("home");
    const started = await startHosted(box, home, { GALLEY_PUBLIC_URL: EDITOR, GALLEY_PASSWORD: PASSWORD, GALLEY_OWNER_NAME: "Sam Owner", GALLEY_OWNER_EMAIL: "sam@example.com" });
    const answer = await call(started.port, "POST", "/api/auth/login", { body: { email: "sam@example.com", password: PASSWORD } });

    expect(answer.status, answer.text).toBe(200);
    const owner = answer.cookies[0]!;

    return {
      ...started,
      home,
      owner,
      cookieName: owner.split("=")[0]!,
      key: Buffer.from(readFileSync(join(home, "session.key"), "utf8").trim(), "hex"),
      ownerId: started.server.install!.people.list().accounts[0]!.id,
    };
  }
  const setCookieOf = (answer: { headers: Record<string, string[] | string | undefined> }, name: string) =>
    ([answer.headers["set-cookie"] ?? []].flat() as string[]).find((line) => line.startsWith(`${name}=`))!;
  const maxAgeOf = (line: string) => Number(/Max-Age=(\d+)/i.exec(line)?.[1]);
  const valueOf = (line: string) => line.split(";")[0]!.split("=").slice(1).join("=");

  it("a password sign-in gets a v2 password session whose cookie lasts as long as it does, with a known browser beside it", async () => {
    const before = Date.now();
    const started = await startHosted(box, box.folder("home"), { GALLEY_PUBLIC_URL: EDITOR, GALLEY_PASSWORD: PASSWORD, GALLEY_OWNER_NAME: "Sam Owner", GALLEY_OWNER_EMAIL: "sam@example.com" });
    const answer = await call(started.port, "POST", "/api/auth/login", { body: { email: "sam@example.com", password: PASSWORD } });
    const name = answer.cookies[0]!.split("=")[0]!;
    const line = setCookieOf(answer, name);
    const parts = partsOf(valueOf(line));

    expect(parts).toMatchObject({ version: "2", kind: "password" });
    expect(parts.expiresAt - parts.issuedAt).toBe(SESSION_MAX_AGE_S * 1000);
    expect(parts.issuedAt).toBeGreaterThanOrEqual(before);
    expect(maxAgeOf(line)).toBeGreaterThan(SESSION_MAX_AGE_S - 10);
    expect(maxAgeOf(line)).toBeLessThanOrEqual(SESSION_MAX_AGE_S);
    expect(setCookieOf(answer, `${name}_known`)).toBeTruthy();
  });

  it("a changed password gives this browser the same session again: the same end and kind, a new id; the old cookie no longer counts", async () => {
    const { port, key, ownerId, cookieName, server } = await withOwner();
    // A session that ends in an hour (as a short one will), and an older cookie: each keeps its own end. Each is made
    // just before its change, after the change before it signed every other browser out.
    const made = [
      (issuedAt: number) => ({ value: signSession(key, issuedAt, undefined, ownerId, { expiresAt: issuedAt + HOUR }), end: issuedAt + HOUR }),
      (issuedAt: number) => ({ value: v1Cookie(key, issuedAt, ownerId), end: issuedAt + SESSION_MAX_AGE_S * 1000 }),
    ];
    let password = PASSWORD;

    for (const [i, make] of made.entries()) {
      const { value, end } = make(server.install!.store.nextIssuedAt(Date.now(), ownerId));
      const cookie = `${cookieName}=${value}`;
      const next = `${password} again ${i}`;
      const changed = await call(port, "POST", "/api/account/password", { cookie, body: { current: password, next } });

      expect(changed.status, changed.text).toBe(200);
      password = next;
      const line = setCookieOf(changed, cookieName);
      const parts = partsOf(valueOf(line));

      expect(parts).toMatchObject({ version: "2", kind: "password", expiresAt: end, accountId: ownerId });
      expect(maxAgeOf(line)).toBeLessThanOrEqual(Math.ceil((end - Date.now()) / 1000));
      expect((await call(port, "GET", "/api/account", { cookie: `${cookieName}=${valueOf(line)}` })).status).toBe(200);
      expect((await call(port, "GET", "/api/account", { cookie })).status).toBe(401);
    }
  });

  it("a password changed in the last moments of a session: the change is logged, and this browser is signed out with the rest", async () => {
    const { port, key, ownerId, cookieName, server, logs } = await withOwner();
    const install = server.install!;
    const issuedAt = install.store.nextIssuedAt(Date.now(), ownerId);
    const expiresAt = issuedAt + HOUR;
    const cookie = `${cookieName}=${signSession(key, issuedAt, undefined, ownerId, { expiresAt })}`;
    const change = install.people.changePassword.bind(install.people);
    let clock: ReturnType<typeof vi.spyOn> | null = null;

    // The session ends while the new password is being saved.
    install.people.changePassword = async (...args) => {
      const done = await change(...args);
      const real = Date.now.bind(Date);

      clock = vi.spyOn(Date, "now").mockImplementation(() => Math.max(real(), expiresAt));
      return done;
    };
    try {
      const answer = await call(port, "POST", "/api/account/password", { cookie, body: { current: PASSWORD, next: "a brand new long password" } });

      expect(answer.status, answer.text).toBe(401);
      expect(answer.cookies.filter((one) => one.startsWith(`${cookieName}=`) && one.length > cookieName.length + 1)).toEqual([]);
    } finally {
      (clock as ReturnType<typeof vi.spyOn> | null)?.mockRestore();
      install.people.changePassword = change;
    }
    expect(logs.join("\n")).toContain("Sam Owner (Owner) changed their password (from ");
    expect(logs.join("\n")).toContain("This browser of Sam Owner (Owner) wasn't signed in again after the password change: its session had ended.");
    // The password did change.
    expect((await call(port, "POST", "/api/auth/login", { body: { email: "sam@example.com", password: "a brand new long password" } })).status).toBe(200);
  });

  it("a sign-out is kept until the session's own end, not 30 days from its issue", async () => {
    const { port, key, ownerId, cookieName, home, owner } = await withOwner();
    const issuedAt = Date.now();
    const short = signSession(key, issuedAt, "short-session", ownerId, { expiresAt: issuedAt + 2 * HOUR, kind: "provider" });
    const older = v1Cookie(key, issuedAt, ownerId);

    for (const value of [short, older]) expect((await call(port, "POST", "/api/auth/logout", { cookie: `${cookieName}=${value}` })).status).toBe(200);
    const revoked = JSON.parse(readFileSync(join(home, "install.json"), "utf8")).sessions.revoked as Array<{ id: string; until: number }>;

    expect(revoked).toEqual([
      { id: "short-session", until: issuedAt + 2 * HOUR },
      { id: older.split(".")[1], until: issuedAt + SESSION_MAX_AGE_S * 1000 },
    ]);
    // Signing out one browser leaves the others.
    expect((await call(port, "GET", "/api/account", { cookie: owner })).status).toBe(200);
  });
});
