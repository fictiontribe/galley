/**
 * The sign-in limits of a hosted install, as one design (sign-in-gate.ts):
 * what one client may do, what one e-mail may receive from any number of
 * clients, how the password checks are shared out, and the browser someone
 * has signed in on before. Against a real install state (real accounts,
 * real cookies) with a clock that never really waits and a password check
 * the test holds and lets go of itself, so nothing here sleeps.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createPeople, openInstallState, type Install, type InstallStore, type SignInResult } from "@galley/core/install";
import { EMAIL_BUSY, SIGN_IN_REFUSED, SIGN_INS_BUSY, TOO_MANY_ATTEMPTS, TOO_MANY_FOR_EMAIL, TOO_MANY_SIGN_INS } from "../src/accounts-routes";
import { clientKey, KNOWN_BROWSER_MAX_AGE_S, LoginLimiter, signKnownBrowser } from "../src/auth";
import {
  CLIENT_ATTEMPTS,
  CLIENT_IN_FLIGHT,
  EMAIL_DELAY_CAP_MS,
  EMAIL_GUESSES_PER_DAY,
  EMAIL_SLOW_AFTER,
  EMAIL_WAITING,
  KNOWN_BROWSER_FAILURES,
  SignInGate,
  STANDARD_ROOM,
  type SignInClock,
} from "../src/sign-in-gate";
import { fake, testApp, type TestApp } from "./helpers";

type People = Install["people"];

const PASSWORD = "correct horse battery staple";
const WRONG = "wrong wrong wrong";
const HOST = "https://cms.example.com";
const homes: string[] = [];

afterAll(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

/** A clock whose sleeps only move it forward. */
function fakeClock(): SignInClock & { t: number; slept: number[] } {
  const clock = {
    t: Date.now(),
    slept: [] as number[],
    now: () => clock.t,
    sleep: async (ms: number) => {
      clock.slept.push(ms);
      clock.t += ms;
    },
  };

  return clock;
}

/** A password check the test controls: held until let go of (when `manual`), and watched — how many run at once, overall and per e-mail. */
class SlowHasher {
  manual = false;
  readonly calls: Array<{ email: string; password: string }> = [];
  private readonly held: Array<() => void> = [];
  private readonly runningFor = new Map<string, number>();
  active = 0;
  maxActive = 0;
  maxForOneEmail = 0;

  async run(email: string, password: string, step = 0, clock?: { t: number }): Promise<void> {
    this.calls.push({ email, password });
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    this.runningFor.set(email, (this.runningFor.get(email) ?? 0) + 1);
    this.maxForOneEmail = Math.max(this.maxForOneEmail, this.runningFor.get(email)!);
    if (this.manual) await new Promise<void>((resolve) => this.held.push(resolve));
    else await Promise.resolve();
    if (clock) clock.t += step;
    this.active -= 1;
    this.runningFor.set(email, this.runningFor.get(email)! - 1);
  }

  /** Lets the oldest `n` held checks finish. */
  release(n = 1): void {
    for (let i = 0; i < n; i += 1) this.held.shift()?.();
  }

  get holding(): number {
    return this.held.length;
  }

  countFor(email: string): number {
    return this.calls.filter((call) => call.email === email).length;
  }
}

/** Lets everything already started run as far as it can. */
async function settle(rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
}

interface Bench {
  app: TestApp;
  store: InstallStore;
  people: People;
  hasher: SlowHasher;
  clock: ReturnType<typeof fakeClock>;
  key: Uint8Array;
  ids: { sam: string; ed: string };
  login(email: string | undefined, password: string, from: string, cookie?: string): Promise<Response>;
}

/** An install with Sam (owner) and Ed (editor), served by the real app with a fake clock and a fake, slow password check. */
async function bench(): Promise<Bench> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "galley-gate-")));

  homes.push(home);
  const store = await openInstallState(home);
  const engine = createPeople(store);
  const sam = await engine.createOwner({ password: PASSWORD, name: "Sam Owner", email: "sam@example.com" });
  const { link } = await engine.invite(sam.id, { email: "ed@example.com", role: "editor" });
  const ed = (await engine.useLink(link.code, { password: PASSWORD, name: "Ed Editor" })).account;
  const hasher = new SlowHasher();
  const clock = fakeClock();
  // The engine's own decision, without scrypt: the same answers for the same cases (people.ts verify).
  const verify = async (email: string | null, password: string): Promise<SignInResult> => {
    const wanted = email === null ? "" : email.trim().toLowerCase();

    await hasher.run(email ?? "", password);
    const stored = email !== null && !wanted ? undefined : store.read().accounts.find((account) => account.email === wanted);

    if (!stored) return { ok: false, reason: "unknown", account: null };
    const account = engine.get(stored.id)!;

    if (password !== PASSWORD) return { ok: false, reason: "wrong", account };
    if (account.disabled) return { ok: false, reason: "disabled", account };
    return { ok: true, account };
  };
  const people: People = { ...engine, verify };
  const install = fake<Install>("install", { store, people, home, meta: () => ({ singleSite: true, setupNeeded: false, passwordSet: true, siteId: null, signInWith: "email" }) });
  const key = randomBytes(32);
  const app = testApp({}, { mode: "hosted", token: null, install, cookieKey: key, allowedHosts: ["cms.example.com"], publicOrigin: HOST, trustProxy: true, signInClock: clock });

  return {
    app,
    store,
    people,
    hasher,
    clock,
    key,
    ids: { sam: sam.id, ed: ed.id },
    login: (email, password, from, cookie) =>
      app.raw("POST", `${HOST}/api/auth/login`, { body: { password, ...(email !== undefined ? { email } : {}) }, headers: { origin: HOST, "x-forwarded-for": from, ...(cookie ? { cookie } : {}) } }),
  };
}

async function answer(pending: Response | Promise<Response>): Promise<{ status: number; text: string; message: string | undefined }> {
  const response = await pending;
  const text = await response.text();

  return { status: response.status, text, message: (JSON.parse(text || "null") as { error?: { message?: string } } | null)?.error?.message };
}

const knownCookieOf = (response: Response) => response.headers.getSetCookie().find((line) => line.startsWith("galley_session_test_known="));
const pairOf = (line: string) => line.split(";")[0]!;

/** `n` wrong attempts for `email`, one after another, each from a client of its own. */
async function failures(b: Bench, email: string, n: number, prefix = "203.0.113"): Promise<void> {
  for (let i = 0; i < n; i += 1) expect((await b.login(email, WRONG, `${prefix}.${(i % 250) + 1}`)).status).toBe(401);
}

describe("what counts as one client", () => {
  it("an IPv4 address is itself, IPv4-mapped IPv6 is the IPv4 address, and IPv6 is its /64", () => {
    expect(clientKey("203.0.113.7")).toBe("203.0.113.7");
    expect(clientKey("203.0.113.7:51234")).toBe("203.0.113.7");
    expect(clientKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(clientKey("::FFFF:cb00:7107")).toBe("203.0.113.7");
    expect(clientKey("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(clientKey("2001:0db8:0001:0002:ffff:ffff:ffff:ffff")).toBe("2001:db8:1:2::/64");
    expect(clientKey("[2001:db8:1:2:3:4:5:6]:443")).toBe("2001:db8:1:2::/64");
    expect(clientKey("fe80::1%en0")).toBe("fe80:0:0:0::/64");
    expect(clientKey("2001:db8:1:3::1")).not.toBe(clientKey("2001:db8:1:2::1"));
    expect(clientKey("::1")).toBe("0:0:0:0::/64");
    expect(clientKey("unknown")).toBe("unknown");
  });

  it("many addresses inside one IPv6 /64 are held to one client's limits; the next /64 is another client", async () => {
    const b = await bench();

    for (let i = 1; i <= 5; i += 1) expect((await b.login("sam@example.com", WRONG, `2001:db8:1:2::${i.toString(16)}`)).status).toBe(401);
    const held = await answer(await b.login("sam@example.com", PASSWORD, "2001:db8:1:2:ffff:ffff:ffff:9"));

    expect([held.status, held.message]).toEqual([429, TOO_MANY_SIGN_INS]);
    expect((await b.login("sam@example.com", PASSWORD, "2001:db8:1:3::1")).status).toBe(200);
  });
});

describe("one e-mail, from any number of clients", () => {
  it("is checked strictly one at a time: a few wait their turn, the rest are told to wait without a check", async () => {
    const b = await bench();

    b.hasher.manual = true;
    const attempts = Array.from({ length: 10 }, (_, i) => b.login("sam@example.com", WRONG, `198.51.100.${i + 1}`));

    await settle();
    // One being checked, EMAIL_WAITING waiting their turn; the others answered at once, with no check.
    expect(b.hasher.calls).toHaveLength(1);
    for (let i = 0; i < 1 + EMAIL_WAITING; i += 1) {
      b.hasher.release();
      await settle();
    }
    const answers = await Promise.all(attempts.map((attempt) => answer(attempt)));

    expect(answers.filter((a) => a.status === 401)).toHaveLength(1 + EMAIL_WAITING);
    expect(answers.filter((a) => a.status === 429).map((a) => a.message)).toEqual(Array(10 - 1 - EMAIL_WAITING).fill(EMAIL_BUSY));
    expect(b.hasher.countFor("sam@example.com")).toBe(1 + EMAIL_WAITING);
    expect(b.hasher.maxForOneEmail).toBe(1);
  });

  it("past the threshold each turn begins with a growing, capped delay; over a simulated day the checks stay under the documented bound", async () => {
    const clock = fakeClock();
    const gate = new SignInGate(clock, new LoginLimiter());
    const DAY = 24 * 60 * 60_000;
    const end = clock.t + DAY;
    let checks = 0;
    let running = 0;
    let most = 0;
    let refusedWithoutCheck = 0;
    let client = 0;
    const attempt = async () => {
      client += 1;
      const ticket = gate.reserve(`10.${(client >> 16) & 255}.${(client >> 8) & 255}.${client & 255}`);

      if (!ticket) throw new Error("a fresh client was refused");
      try {
        const outcome = await gate.signIn(
          ticket,
          "sam@example.com",
          null,
          async () => {
            checks += 1;
            running += 1;
            most = Math.max(most, running);
            await Promise.resolve();
            // A check takes 50 ms of the simulated day.
            clock.t += 50;
            running -= 1;
            return false;
          },
          (right) => !right
        );

        if (outcome.refused === "email") refusedWithoutCheck += 1;
        else expect(outcome.refused).toBeNull();
      } finally {
        ticket.release();
      }
    };

    while (clock.t < end) await Promise.all(Array.from({ length: 6 }, attempt));
    expect(most).toBe(1);
    expect(refusedWithoutCheck).toBeGreaterThan(0);
    expect(checks).toBeLessThanOrEqual(EMAIL_GUESSES_PER_DAY);
    // The delay, not the speed of a check, is what holds it there.
    expect(checks).toBeGreaterThan(2_000);
    expect(Math.max(...clock.slept)).toBe(EMAIL_DELAY_CAP_MS);
    expect(clock.slept.slice(0, 5)).toEqual([1_000, 2_000, 4_000, 8_000, 16_000]);
  });

  it("an e-mail nobody has gets the same answer, the same number of checks, the same line and the same delay as a wrong password", async () => {
    const b = await bench();
    const sam = await answer(await b.login("sam@example.com", WRONG, "198.51.100.1"));
    const nobody = await answer(await b.login("nobody@example.com", WRONG, "198.51.100.2"));

    expect(nobody).toEqual(sam);
    expect(sam.message).toBe(SIGN_IN_REFUSED);
    expect([b.hasher.countFor("sam@example.com"), b.hasher.countFor("nobody@example.com")]).toEqual([1, 1]);
    // The same line: one checked and EMAIL_WAITING waiting each, the next told to wait in the same words.
    b.hasher.manual = true;
    const lines = ["sam@example.com", "nobody@example.com"].map((email, n) => Array.from({ length: 2 + EMAIL_WAITING }, (_, i) => b.login(email, WRONG, `192.0.${n + 2}.${i + 1}`)));

    await settle();
    expect([b.hasher.countFor("sam@example.com"), b.hasher.countFor("nobody@example.com")]).toEqual([2, 2]);
    while (b.hasher.holding > 0) {
      b.hasher.release(b.hasher.holding);
      await settle();
    }
    const [forSam, forNobody] = await Promise.all(lines.map((line) => Promise.all(line.map((attempt) => answer(attempt)))));

    expect(forNobody).toEqual(forSam);
    expect(forSam!.map((a) => a.status).sort()).toEqual([...Array(1 + EMAIL_WAITING).fill(401), 429]);
    // The same delay once past the threshold.
    b.hasher.manual = false;
    await failures(b, "sam@example.com", EMAIL_SLOW_AFTER + 2 - b.hasher.countFor("sam@example.com"), "192.0.10");
    const samSleeps = [...b.clock.slept];

    b.clock.slept.length = 0;
    await failures(b, "nobody@example.com", EMAIL_SLOW_AFTER + 2 - b.hasher.countFor("nobody@example.com"), "192.0.11");
    expect(b.clock.slept).toEqual(samSleeps);
    expect(samSleeps.length).toBeGreaterThan(0);
  });
});

describe("a browser someone has signed in on before", () => {
  it("is remembered by a signed, HttpOnly cookie of its own that is never accepted as a session", async () => {
    const b = await bench();
    const signedIn = await b.login("sam@example.com", PASSWORD, "198.51.100.1");
    const line = knownCookieOf(signedIn)!;

    expect(signedIn.status).toBe(200);
    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/SameSite=Strict/i);
    expect(line).toMatch(new RegExp(`Max-Age=${KNOWN_BROWSER_MAX_AGE_S}`));
    // The session cookie comes first, so whoever reads the first cookie reads the session.
    expect(signedIn.headers.getSetCookie()[0]).toMatch(/^galley_session_test=/);
    const value = pairOf(line).split("=")[1]!;

    for (const cookie of [pairOf(line), `galley_session_test=${value}`]) expect((await b.app.raw("GET", `${HOST}/api/account`, { headers: { cookie } })).status).toBe(401);
    // A failed sign-in leaves no cookie of either kind.
    expect((await b.login("sam@example.com", WRONG, "198.51.100.2")).headers.getSetCookie()).toEqual([]);
  });

  it("signs in at once with the right password while that e-mail's line is full; a forged, expired or other account's cookie gets no such treatment", async () => {
    const b = await bench();
    const known = pairOf(knownCookieOf(await b.login("sam@example.com", PASSWORD, "198.51.100.1"))!);
    const edKnown = pairOf(knownCookieOf(await b.login("ed@example.com", PASSWORD, "198.51.100.1"))!);

    // Past the threshold, every unknown browser's turn begins with a delay — here one the test holds, so the line stays full.
    await failures(b, "sam@example.com", EMAIL_SLOW_AFTER + 3);
    const sleeping: Array<() => void> = [];

    b.clock.sleep = () => new Promise<void>((resolve) => sleeping.push(resolve));
    b.hasher.manual = true;
    const line = Array.from({ length: 1 + EMAIL_WAITING }, (_, i) => b.login("sam@example.com", WRONG, `198.51.100.${i + 10}`));

    await settle();
    expect([sleeping.length, b.hasher.holding]).toEqual([1, 0]);
    const full = await answer(await b.login("sam@example.com", PASSWORD, "198.51.100.20"));

    expect([full.status, full.message]).toEqual([429, EMAIL_BUSY]);
    // The known browser: no line, no delay — its password is checked while the attempt whose turn it is still waits out its delay.
    const before = b.hasher.calls.length;
    const right = b.login("sam@example.com", PASSWORD, "192.0.2.1", known);

    await settle();
    expect(b.hasher.calls.slice(before)).toEqual([{ email: "sam@example.com", password: PASSWORD }]);
    b.hasher.release();
    expect((await right).status).toBe(200);
    // Every other cookie is an unknown browser's: told to wait, without a check.
    const [, issued, nonce, id] = known.split("=")[1]!.split(".");
    const forged = `${known.slice(0, -2)}${known.endsWith("AA") ? "BB" : "AA"}`;
    const expired = `galley_session_test_known=${signKnownBrowser(b.key, id!, Date.now() - (KNOWN_BROWSER_MAX_AGE_S + 60) * 1000)}`;
    const otherKey = `galley_session_test_known=${signKnownBrowser(randomBytes(32), id!, Number(issued), nonce)}`;
    const checks = b.hasher.calls.length;

    for (const cookie of [forged, expired, otherKey, edKnown, known.replace("galley_session_test_known=", "galley_session_test="), "galley_session_test_known=kb1.1.x.y.z"]) {
      const refused = await answer(await b.login("sam@example.com", PASSWORD, "192.0.2.2", cookie));

      expect([refused.status, refused.message], cookie).toEqual([429, EMAIL_BUSY]);
    }
    expect(b.hasher.calls.length).toBe(checks);
    // Once the attempt whose turn it is has its password checked, a known browser waits for that one check, and only that.
    sleeping.splice(0).forEach((wake) => wake());
    await settle();
    expect(b.hasher.holding).toBe(1);
    const second = b.login("sam@example.com", PASSWORD, "192.0.2.3", known);

    await settle();
    expect(b.hasher.calls.length).toBe(checks + 1);
    b.hasher.release();
    await settle();
    expect(b.hasher.calls[checks + 1]).toEqual({ email: "sam@example.com", password: PASSWORD });
    b.hasher.release();
    expect((await second).status).toBe(200);
    expect(b.hasher.maxForOneEmail).toBe(1);
    let done = false;
    const all = Promise.all(line).then(() => (done = true));

    while (!done) {
      sleeping.splice(0).forEach((wake) => wake());
      b.hasher.release(b.hasher.holding);
      await settle();
    }
    await all;
    expect(b.hasher.maxForOneEmail).toBe(1);
  });

  it("that keeps failing loses it; it stops counting once the account is switched off or removed", async () => {
    const b = await bench();
    const known = pairOf(knownCookieOf(await b.login("sam@example.com", PASSWORD, "198.51.100.1"))!);
    const edKnown = pairOf(knownCookieOf(await b.login("ed@example.com", PASSWORD, "198.51.100.1"))!);
    let client = 0;
    /** Whether `cookie` still gets past `email`'s full line (true), or is an unknown browser told to wait (false). */
    const skipsTheLine = async (email: string, cookie: string, password = PASSWORD) => {
      b.hasher.manual = true;
      const line = Array.from({ length: 1 + EMAIL_WAITING }, () => {
        client += 1;
        return b.login(email, WRONG, `198.51.${100 + Math.floor(client / 250)}.${(client % 250) + 1}`);
      });

      await settle();
      const attempt = b.login(email, password, "192.0.2.50", cookie);

      await settle();
      while (b.hasher.holding > 0) {
        b.hasher.release(b.hasher.holding);
        await settle();
      }
      await Promise.all(line);
      b.hasher.manual = false;
      return (await attempt).status !== 429;
    };

    expect(await skipsTheLine("sam@example.com", known)).toBe(true);
    // KNOWN_BROWSER_FAILURES wrong passwords from it, and it is treated as any other browser.
    for (let i = 0; i < KNOWN_BROWSER_FAILURES; i += 1) expect((await b.login("sam@example.com", WRONG, `192.0.2.${60 + i}`, known)).status).toBe(401);
    expect(await skipsTheLine("sam@example.com", known)).toBe(false);
    // Ed's counts until Ed is switched off, and not again once switched back on.
    expect(await skipsTheLine("ed@example.com", edKnown, WRONG)).toBe(true);
    await b.people.change(b.ids.sam, b.ids.ed, { disabled: true });
    expect(await skipsTheLine("ed@example.com", edKnown, WRONG)).toBe(false);
    await b.people.change(b.ids.sam, b.ids.ed, { disabled: false });
    expect(await skipsTheLine("ed@example.com", edKnown, WRONG)).toBe(false);
    // Removed: the same.
    const again = pairOf(knownCookieOf(await b.login("ed@example.com", PASSWORD, "192.0.2.70"))!);

    expect(await skipsTheLine("ed@example.com", again, WRONG)).toBe(true);
    await b.people.remove(b.ids.sam, b.ids.ed);
    expect(await skipsTheLine("ed@example.com", again, WRONG)).toBe(false);
  });
});

describe("nobody can make sign-in fail for everyone", () => {
  it("one client firing many sign-ins at once: only its share reaches the password check, and another client signs in at the same moment", async () => {
    const b = await bench();

    b.hasher.manual = true;
    const burst = Array.from({ length: 12 }, (_, i) => b.login(i % 2 ? "sam@example.com" : `person${i}@example.com`, i % 2 ? PASSWORD : WRONG, "203.0.113.9"));

    await settle();
    // Reserved before anything was awaited: CLIENT_IN_FLIGHT got through, the rest were refused at once; only one of the two is being checked.
    expect(b.hasher.calls).toHaveLength(1);
    const other = b.login("ed@example.com", PASSWORD, "198.51.100.77");

    await settle();
    expect(b.hasher.calls.map((call) => call.email)).toContain("ed@example.com");
    b.hasher.release(2);
    await settle();
    b.hasher.release(b.hasher.holding);
    expect((await other).status).toBe(200);
    const answers = await Promise.all(burst.map((attempt) => answer(attempt)));

    expect(answers.filter((a) => a.status !== 429)).toHaveLength(CLIENT_IN_FLIGHT);
    expect(answers.filter((a) => a.status === 429).every((a) => a.message === TOO_MANY_SIGN_INS)).toBe(true);
    expect(b.hasher.calls).toHaveLength(CLIENT_IN_FLIGHT + 1);
  });

  it("successful sign-ins count toward a client's attempts a minute", async () => {
    const b = await bench();

    for (let i = 0; i < CLIENT_ATTEMPTS; i += 1) expect((await b.login("sam@example.com", PASSWORD, "203.0.113.20")).status).toBe(200);
    const held = await answer(await b.login("sam@example.com", PASSWORD, "203.0.113.20"));

    expect([held.status, held.message]).toEqual([429, TOO_MANY_SIGN_INS]);
    expect(b.hasher.calls).toHaveLength(CLIENT_ATTEMPTS);
    b.clock.t += 60_000;
    expect((await b.login("sam@example.com", PASSWORD, "203.0.113.20")).status).toBe(200);
  });

  it("five failures a minute per client still hold, the same for an e-mail nobody has; ten for one e-mail from one client in fifteen minutes", async () => {
    const b = await bench();

    for (let i = 0; i < 5; i += 1) expect((await b.login("nobody@example.com", WRONG, "203.0.113.1")).status).toBe(401);
    expect((await answer(await b.login("sam@example.com", PASSWORD, "203.0.113.1"))).message).toBe(TOO_MANY_SIGN_INS);
    // Two minutes apart in fives: ten for one e-mail from one client, then that pair waits out the window — the right password included.
    for (const target of ["sam@example.com", "nobody@example.com"]) {
      for (let round = 0; round < 2; round += 1) {
        b.clock.t += 61_000;
        for (let i = 0; i < 5; i += 1) expect((await b.login(target, WRONG, `203.0.113.${target.startsWith("sam") ? 2 : 3}`)).status).toBe(401);
      }
    }
    b.clock.t += 61_000;
    const pair = await answer(await b.login("sam@example.com", PASSWORD, "203.0.113.2"));
    const unknown = await answer(await b.login("nobody@example.com", WRONG, "203.0.113.3"));

    expect([pair.status, pair.message]).toEqual([429, TOO_MANY_FOR_EMAIL]);
    expect(unknown).toEqual(pair);
    // Another client: Sam's e-mail is past the threshold, so it waits its delay (the fake clock's), then gets in.
    expect((await b.login("sam@example.com", PASSWORD, "203.0.113.9")).status).toBe(200);
  });

  it("a flood of wrong guesses from many clients for many e-mails: a known browser gets in first, an unknown browser's right password waits its turn and gets in", async () => {
    const b = await bench();
    const known = pairOf(knownCookieOf(await b.login("sam@example.com", PASSWORD, "198.51.100.1"))!);

    b.hasher.manual = true;
    const clients = Math.floor(STANDARD_ROOM / CLIENT_IN_FLIGHT) - 2;
    const flood = Array.from({ length: clients * CLIENT_IN_FLIGHT }, (_, i) => b.login(`target${i}@example.com`, WRONG, `10.0.${Math.floor(i / CLIENT_IN_FLIGHT / 250)}.${(Math.floor(i / CLIENT_IN_FLIGHT) % 250) + 1}`));

    await settle(60);
    const running = b.hasher.calls.length;
    const samIn = b.login("sam@example.com", PASSWORD, "192.0.2.1", known);
    const edIn = b.login("ed@example.com", PASSWORD, "192.0.2.2");

    await settle();
    // The next free slot goes to the known browser, ahead of everything the flood has waiting.
    b.hasher.release();
    await settle();
    expect(b.hasher.calls[running]).toEqual({ email: "sam@example.com", password: PASSWORD });
    b.hasher.release(b.hasher.holding);
    expect((await samIn).status).toBe(200);
    // The unknown browser waits behind the flood's turns, round-robin across clients, and is let in, not refused.
    while ((await Promise.race([edIn.then(() => true), settle(5).then(() => false)])) === false) b.hasher.release(b.hasher.holding);
    expect((await edIn).status).toBe(200);
    while (b.hasher.holding > 0) {
      b.hasher.release(b.hasher.holding);
      await settle();
    }
    const statuses = (await Promise.all(flood)).map((response) => response.status);

    expect(statuses.every((status) => status === 401)).toBe(true);
    expect(b.hasher.maxActive).toBeLessThanOrEqual(2);
  }, 60_000);

  it("past the generous bound the flood is told to wait in plain words, and a known browser still gets in", async () => {
    const b = await bench();
    const known = pairOf(knownCookieOf(await b.login("sam@example.com", PASSWORD, "198.51.100.1"))!);

    b.hasher.manual = true;
    const clients = STANDARD_ROOM;
    const flood = Array.from({ length: clients * CLIENT_IN_FLIGHT }, (_, i) => b.login(`target${i}@example.com`, WRONG, `10.1.${Math.floor(i / CLIENT_IN_FLIGHT / 250)}.${(Math.floor(i / CLIENT_IN_FLIGHT) % 250) + 1}`));

    await settle(60);
    const samIn = b.login("sam@example.com", PASSWORD, "192.0.2.1", known);

    await settle();
    b.hasher.release();
    await settle();
    b.hasher.release(b.hasher.holding);
    expect((await samIn).status).toBe(200);
    while (b.hasher.holding > 0) {
      b.hasher.release(b.hasher.holding);
      await settle();
    }
    const answers = await Promise.all(flood.map((response) => response.then(answer)));
    const busy = answers.filter((a) => a.status === 429);

    expect(busy.length).toBeGreaterThan(0);
    expect(busy.every((a) => a.message === SIGN_INS_BUSY)).toBe(true);
    expect(answers.filter((a) => a.status === 401).length).toBeGreaterThanOrEqual(STANDARD_ROOM);
  }, 60_000);

  it("changing your own password and the current password typed to change an e-mail go through the same reservation and limits", async () => {
    const b = await bench();
    const session = (await b.login("sam@example.com", PASSWORD, "198.51.100.1")).headers.getSetCookie()[0]!.split(";")[0]!;
    let checks = 0;
    let release: Array<() => void> = [];

    (b.people as { changePassword: People["changePassword"] }).changePassword = async () => {
      checks += 1;
      await new Promise<void>((resolve) => release.push(resolve));
      return false;
    };
    const change = (from: string) => b.app.raw("POST", `${HOST}/api/account/password`, { body: { current: WRONG, next: "another long password" }, headers: { origin: HOST, cookie: session, "x-forwarded-for": from } });
    const burst = Array.from({ length: 6 }, () => change("203.0.113.30"));

    await settle();
    expect(checks).toBe(1);
    while (release.length > 0) {
      release.splice(0).forEach((done) => done());
      await settle();
    }
    const answers = await Promise.all(burst.map((attempt) => answer(attempt)));

    expect(answers.filter((a) => a.status === 400)).toHaveLength(CLIENT_IN_FLIGHT);
    expect(answers.filter((a) => a.status === 429).every((a) => a.message === TOO_MANY_ATTEMPTS)).toBe(true);
    release = [];
    // Three more failures make five in the minute: the next is refused without a check, the e-mail change's password check included.
    for (let i = 0; i < 3; i += 1) {
      const pending = change("203.0.113.30");

      await settle();
      release.splice(0).forEach((done) => done());
      expect((await pending).status).toBe(400);
    }
    const before = checks;
    const refused = await answer(await b.app.raw("PATCH", `${HOST}/api/account`, { body: { email: "sam@elsewhere.example.com", password: PASSWORD }, headers: { origin: HOST, cookie: session, "x-forwarded-for": "203.0.113.30" } }));

    expect([refused.status, refused.message]).toEqual([429, TOO_MANY_ATTEMPTS]);
    expect((await change("203.0.113.30")).status).toBe(429);
    expect(checks).toBe(before);
  });

  it("the current password is tried no faster from inside a session than from the sign-in page: one at a time for the account, a few waiting, the rest told to wait", async () => {
    const b = await bench();
    const session = (await b.login("sam@example.com", PASSWORD, "198.51.100.1")).headers.getSetCookie()[0]!.split(";")[0]!;
    let running = 0;
    let most = 0;
    let checks = 0;
    const release: Array<() => void> = [];

    (b.people as { changePassword: People["changePassword"] }).changePassword = async () => {
      checks += 1;
      running += 1;
      most = Math.max(most, running);
      await new Promise<void>((resolve) => release.push(resolve));
      running -= 1;
      return false;
    };
    // One session, from ten clients, without that browser's own known-browser cookie.
    const attempts = Array.from({ length: 10 }, (_, i) =>
      b.app.raw("POST", `${HOST}/api/account/password`, { body: { current: WRONG, next: "another long password" }, headers: { origin: HOST, cookie: session, "x-forwarded-for": `203.0.113.${i + 40}` } })
    );

    await settle();
    expect(checks).toBe(1);
    for (let i = 0; i < 1 + EMAIL_WAITING; i += 1) {
      release.splice(0).forEach((done) => done());
      await settle();
    }
    const answers = await Promise.all(attempts.map((attempt) => answer(attempt)));

    expect(most).toBe(1);
    expect(checks).toBe(1 + EMAIL_WAITING);
    expect(answers.filter((a) => a.status === 400)).toHaveLength(1 + EMAIL_WAITING);
    expect(answers.filter((a) => a.status === 429).map((a) => a.message)).toEqual(Array(10 - 1 - EMAIL_WAITING).fill(EMAIL_BUSY));
  });
});

describe("the state stays bounded", () => {
  it("e-mails without failures are let go of once their turn ends; a client's entry is reused", async () => {
    const clock = fakeClock();
    const gate = new SignInGate(clock, new LoginLimiter());

    for (let i = 0; i < 50; i += 1) {
      const ticket = gate.reserve("203.0.113.1")!;

      clock.t += 61_000;
      await gate.signIn(ticket, `person${i}@example.com`, null, async () => true, (right) => !right);
      ticket.release();
    }
    expect(gate.tracked).toEqual({ emails: 0, clients: 1 });
  });
});
