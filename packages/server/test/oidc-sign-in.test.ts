/**
 * Signing in through an identity provider, over real HTTP, against a
 * provider that runs inside the test (oidc-test-provider.ts): the round
 * trip; every way the callback is refused, each ending on the sign-in page
 * with its code; PKCE and the nonce; the provider slow, failing, too big or
 * down; every check of the ID token; and the accounts it finds or makes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { APP_SECRET_ENV_NAMES, needsName, type AccountSession } from "@galley/core/install";
import { readSession, SESSION_MAX_AGE_S } from "../src/auth";
import { safeReturnPath } from "../src/oidc/cookie";
import { ANSWER_LIMIT_BYTES, boundedFetch, forTheLog } from "../src/oidc/provider";
import { call, EDITOR, sandbox, startHosted, type Started } from "./hosted-helpers";
import { startTestProvider, type TestProvider } from "./oidc-test-provider";

const box = sandbox("oidc-sign-in");
const PASSWORD = "correct horse battery staple";
const CLIENT = "galley-test-client";
const SESSION = "__Host-galley_session";
const PRE_LOGIN = "__Host-galley_oidc";
const providers: TestProvider[] = [];

afterAll(async () => {
  await Promise.all(providers.map((provider) => provider.close()));
  await box.cleanup();
}, 120_000);

async function provider(options: Parameters<typeof startTestProvider>[0] = {}): Promise<TestProvider> {
  const made = await startTestProvider({ clientId: CLIENT, ...options });

  providers.push(made);
  return made;
}

/** An editor with an owner (Sam, a password) and this provider set up. */
async function editor(idp: TestProvider, env: Record<string, string> = {}, home = box.folder("home")): Promise<Started & { home: string }> {
  const started = await startHosted(
    box,
    home,
    { GALLEY_PUBLIC_URL: EDITOR, GALLEY_PASSWORD: PASSWORD, GALLEY_OWNER_NAME: "Sam Owner", GALLEY_OWNER_EMAIL: "sam@example.com", GALLEY_OIDC_ISSUER: idp.issuer, GALLEY_OIDC_CLIENT_ID: CLIENT, GALLEY_TRUST_PROXY: "1", ...env },
    { oidcAllowLoopbackHttp: true }
  );

  return { ...started, home };
}

const cookieNamed = (cookies: string[], name: string) => cookies.find((cookie) => cookie.startsWith(`${name}=`));
const setCookieLine = (headers: Record<string, string | string[] | undefined>, name: string) => ([headers["set-cookie"] ?? []].flat() as string[]).find((line) => line.startsWith(`${name}=`));

interface RoundTrip {
  /** Where the editor sent the browser in the end. */
  location: string;
  /** The session cookie, when one was set. */
  session: string | undefined;
  preLogin: string | undefined;
  callback: string | undefined;
  done: Awaited<ReturnType<typeof call>> | null;
}

let addresses = 0;
/** A client address of its own for each sign-in, unless the test says: failed callbacks count against an address. */
const nextAddress = () => `198.51.100.${(addresses = (addresses % 250) + 1)}`;

/** Start, the provider's answer, the callback: as a browser would, with the pre-login cookie it was given. */
async function signIn(port: number, idp: TestProvider, returnTo = "/sites/one/proof", tamper?: (callback: URL) => void, from = nextAddress()): Promise<RoundTrip> {
  const headers = { "x-forwarded-for": from };
  const start = await call(port, "GET", `/api/auth/oidc/start?return=${encodeURIComponent(returnTo)}`, { headers });

  if (start.status !== 302) return { location: String(start.headers.location), session: undefined, preLogin: undefined, callback: undefined, done: null };
  const preLogin = cookieNamed(start.cookies, PRE_LOGIN)!;
  const back = new URL(await idp.authorize(String(start.headers.location)));

  tamper?.(back);
  const done = await call(port, "GET", `${back.pathname}${back.search}`, { cookie: preLogin, headers });

  expect(done.status, done.text).toBe(303);
  return { location: String(done.headers.location), session: cookieNamed(done.cookies, SESSION), preLogin, callback: `${back.pathname}${back.search}`, done };
}

const refusedWith = (trip: RoundTrip, code: string) => {
  expect(trip.location).toMatch(new RegExp(`^/login\\?signin=${code}(&|$)`));
  expect(trip.session).toBeUndefined();
};
const logOf = (logs: string[]) => logs.join("\n");

describe("the round trip", () => {
  it("starts with a sealed Lax pre-login cookie and the provider's address; comes back signed in, with a provider session of 12 hours and no known browser", async () => {
    const idp = await provider();
    const { port, logs, server } = await editor(idp);
    const start = await call(port, "GET", `/api/auth/oidc/start?return=${encodeURIComponent("/sites/one/proof?x=1#top")}`);

    expect(start.status).toBe(302);
    const to = new URL(String(start.headers.location));

    expect(`${to.origin}${to.pathname}`).toBe(`${idp.url}/authorize`);
    expect(Object.fromEntries(to.searchParams)).toEqual({
      response_type: "code",
      client_id: CLIENT,
      redirect_uri: `${EDITOR}/api/auth/oidc/callback`,
      scope: "openid profile email",
      state: expect.any(String),
      nonce: expect.any(String),
      code_challenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      code_challenge_method: "S256",
    });
    const line = setCookieLine(start.headers, PRE_LOGIN)!;

    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/Secure/i);
    expect(line).toMatch(/SameSite=Lax/i);
    expect(line).toMatch(/Path=\//i);
    expect(line).toMatch(/Max-Age=600/i);
    expect(line).not.toMatch(/Domain=/i);
    // Nothing in it a page could read: not the state, not the nonce.
    expect(line).not.toContain(to.searchParams.get("state")!);
    expect(line).not.toContain(to.searchParams.get("nonce")!);
    const before = Date.now();
    const back = new URL(await idp.authorize(to.href));
    const done = await call(port, "GET", `${back.pathname}${back.search}`, { cookie: cookieNamed(start.cookies, PRE_LOGIN)! });

    expect(done.status).toBe(303);
    expect(done.headers.location).toBe("/sites/one/proof?x=1#top");
    const session = readSession(Buffer.from(readFileSync(join(server.install!.store.home, "session.key"), "utf8").trim(), "hex"), cookieNamed(done.cookies, SESSION)!.split("=")[1])!;

    expect(session.kind).toBe("provider");
    expect(session.expiresAt - session.issuedAt).toBe(12 * 60 * 60_000);
    expect(session.issuedAt).toBeGreaterThanOrEqual(before);
    expect(Number(/Max-Age=(\d+)/i.exec(setCookieLine(done.headers, SESSION)!)?.[1])).toBeGreaterThan(12 * 3600 - 10);
    // The pre-login cookie is cleared; no known-browser cookie: there is no password here.
    expect(setCookieLine(done.headers, PRE_LOGIN)).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    expect(setCookieLine(done.headers, `${SESSION}_known`)).toBeUndefined();
    const me = await call<AccountSession>(port, "GET", "/api/account", { cookie: cookieNamed(done.cookies, SESSION)! });

    expect(me.body).toMatchObject({ name: "Pat Provider", email: "pat@example.com", role: "editor" });
    const stored = server.install!.store.account(me.body.id)!;

    expect(stored).toMatchObject({ passwordHash: null, identity: { issuer: idp.issuer, subject: "subject-1" }, incomplete: false });
    expect(logOf(logs)).toContain("Signed in through 127.0.0.1: Pat Provider (Editor), a new Editor, from ");
    // The code, the state and the ID token never reach the log.
    expect(logOf(logs)).not.toContain(back.searchParams.get("code")!);
    expect(logOf(logs)).not.toContain(back.searchParams.get("state")!);
    // The next sign-in finds the same account.
    const again = await signIn(port, idp);

    expect((await call<AccountSession>(port, "GET", "/api/account", { cookie: again.session! })).body.id).toBe(me.body.id);
    expect(server.install!.people.list().accounts).toHaveLength(2);
  });

  it("GALLEY_OIDC_SESSION_HOURS sets how long a session lasts; GET /api/meta names the button", async () => {
    const idp = await provider();
    const { port, server } = await editor(idp, { GALLEY_OIDC_SESSION_HOURS: "1", GALLEY_OIDC_NAME: "Example Sign-in" });
    const trip = await signIn(port, idp);
    const key = Buffer.from(readFileSync(join(server.install!.store.home, "session.key"), "utf8").trim(), "hex");
    const session = readSession(key, trip.session!.split("=")[1])!;

    expect(session.expiresAt - session.issuedAt).toBe(60 * 60_000);
    expect((await call(port, "GET", "/api/meta")).body.install.provider).toEqual({ name: "Example Sign-in" });
  });

  it("the return path is always a path on the editor", () => {
    const origin = "https://cms.example.com";

    for (const raw of ["//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "///evil.example", "https://evil.example/", "javascript:alert(1)", "", undefined]) {
      expect(safeReturnPath(raw, origin), String(raw)).toBe("/");
    }
    expect(safeReturnPath("/x/../\\evil.example", origin)).toBe("/evil.example");
    expect(safeReturnPath("/%5Cevil.example", origin)).toBe("/%5Cevil.example");
    expect(safeReturnPath("https://cms.example.com/sites/a?b=1#c", origin)).toBe("/sites/a?b=1#c");
    expect(safeReturnPath("/sites/a", origin)).toBe("/sites/a");
  });
});

describe("the callback refuses, always by sending the browser to the sign-in page with a code", () => {
  it("with no cookie, a cookie from another sign-in (left in place), a state used twice, ten minutes late, and an iss that differs or is missing where the provider sends it", async () => {
    const idp = await provider();
    const { port, logs } = await editor(idp);
    // No cookie.
    const start = await call(port, "GET", "/api/auth/oidc/start");
    const back = new URL(await idp.authorize(String(start.headers.location)));
    const bare = await call(port, "GET", `${back.pathname}${back.search}`);

    expect([bare.status, bare.headers.location]).toEqual([303, "/login?signin=refused-state"]);
    expect(bare.headers["content-type"] ?? "").not.toMatch(/json/);
    // Another sign-in's cookie (another tab, or a callback someone made up): refused, and that cookie is left as it is.
    const other = await call(port, "GET", "/api/auth/oidc/start");
    const mixed = await call(port, "GET", `${back.pathname}${back.search}`, { cookie: cookieNamed(other.cookies, PRE_LOGIN)! });

    expect(mixed.headers.location).toBe("/login?signin=another-tab");
    expect(setCookieLine(mixed.headers, PRE_LOGIN)).toBeUndefined();
    // The cookie and state presented twice (a copied cookie value): the first works, the second is refused.
    const first = await signIn(port, idp);

    expect(first.session).toBeDefined();
    const copy = await call(port, "GET", first.callback!, { cookie: first.preLogin! });

    expect(copy.headers.location).toBe("/login?signin=refused-state");
    // Ten minutes late.
    const late = await call(port, "GET", "/api/auth/oidc/start");
    const lateBack = new URL(await idp.authorize(String(late.headers.location)));
    const real = Date.now;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => real() + 11 * 60_000);

    try {
      expect((await call(port, "GET", `${lateBack.pathname}${lateBack.search}`, { cookie: cookieNamed(late.cookies, PRE_LOGIN)! })).headers.location).toBe("/login?signin=refused-state");
    } finally {
      clock.mockRestore();
    }
    // The answer from another issuer.
    refusedWith(await signIn(port, idp, "/", (url) => url.searchParams.set("iss", "https://evil.example")), "refused-state");
    // No iss where the provider says it always sends one.
    idp.wrong = { issParameterSupported: true, omitIss: true };
    const strict = await editor(idp);

    refusedWith(await signIn(strict.port, idp), "refused-state");
    idp.wrong = { issParameterSupported: true };
    expect((await signIn(strict.port, idp)).session).toBeDefined();
    idp.wrong = {};
    expect(logOf(logs)).toContain("was refused: no sign-in was started in this browser in the last ten minutes.");
    expect(logOf(logs)).toContain("was refused: the answer is for another sign-in than the one this browser started last.");
  });

  it("two tabs signing in at once: whichever comes back, the one whose state is in the cookie works; the other is told to start again", async () => {
    const idp = await provider();
    const { port } = await editor(idp);

    for (const order of ["first-back-first", "second-back-first"]) {
      const tabA = await call(port, "GET", "/api/auth/oidc/start");
      const tabB = await call(port, "GET", "/api/auth/oidc/start");
      // One browser: the second start overwrote the first's cookie.
      const cookie = cookieNamed(tabB.cookies, PRE_LOGIN)!;
      const backA = new URL(await idp.authorize(String(tabA.headers.location)));
      const backB = new URL(await idp.authorize(String(tabB.headers.location)));
      const answers =
        order === "first-back-first"
          ? [await call(port, "GET", `${backA.pathname}${backA.search}`, { cookie }), await call(port, "GET", `${backB.pathname}${backB.search}`, { cookie })]
          : [await call(port, "GET", `${backB.pathname}${backB.search}`, { cookie }), await call(port, "GET", `${backA.pathname}${backA.search}`, { cookie })];
      const [a, b] = order === "first-back-first" ? answers : [answers[1]!, answers[0]!];

      expect(a!.headers.location, order).toBe("/login?signin=another-tab");
      expect(b!.headers.location, order).toBe("/");
      expect(cookieNamed(b!.cookies, SESSION), order).toBeDefined();
    }
  });

  it("an error from the provider: a fixed sentence, its own words only in the log, cut and without control characters; with a wrong state, refused for the state", async () => {
    const idp = await provider();
    const { port, logs } = await editor(idp);

    idp.wrong = { error: { error: "access_denied", description: `<script>alert(1)</script>\nForged log line: ${"y".repeat(400)}` } };
    refusedWith(await signIn(port, idp), "provider-cancelled");
    idp.wrong = { error: { error: "server_error" } };
    refusedWith(await signIn(port, idp), "provider-error");
    const line = logs.find((one) => one.includes("The provider refused the sign-in: access_denied"))!;

    expect(line).not.toContain("\n");
    expect(line).toContain("<script>alert(1)</script> Forged log line:");
    expect(line.length).toBeLessThan(400);
    idp.wrong = { error: { error: "access_denied" } };
    refusedWith(await signIn(port, idp, "/", (url) => url.searchParams.set("state", "not-this-one")), "another-tab");
    idp.wrong = {};
    expect(forTheLog("a b\u0007c")).toBe("a b c");
  });
});

describe("failed callbacks count against the address they came from", () => {
  it("five from one address, then even a good one from it is refused for a while; from elsewhere it works; a success there clears nothing elsewhere", async () => {
    const idp = await provider();
    const { port, logs } = await editor(idp);

    for (let i = 0; i < 5; i += 1) refusedWith(await signIn(port, idp, "/", (url) => url.searchParams.set("iss", "https://evil.example"), "203.0.113.9"), "refused-state");
    refusedWith(await signIn(port, idp, "/", undefined, "203.0.113.9"), "too-many");
    expect((await signIn(port, idp, "/", undefined, "203.0.113.10")).session).toBeDefined();
    expect(logOf(logs)).toContain("from 203.0.113.9 was refused: too many failed sign-ins from there.");
  });
});

describe("the provider and PKCE", () => {
  it("a provider that doesn't say it checks S256 is refused unless a client secret is set; with one, the secret goes to the token endpoint", async () => {
    const idp = await provider();

    idp.wrong = { noS256: true };
    const { port, logs } = await editor(idp);

    refusedWith(await signIn(port, idp), "provider-no-pkce");
    expect(logOf(logs)).toContain("doesn't list S256 in code_challenge_methods_supported, and no client secret is set");
    const withSecret = await provider({ clientSecret: "a client secret for the test 0000" });

    withSecret.wrong = { noS256: true };
    const other = await editor(withSecret, { GALLEY_OIDC_CLIENT_SECRET: "a client secret for the test 0000" });

    expect((await signIn(other.port, withSecret)).session, logOf(other.logs)).toBeDefined();
    expect(withSecret.lastTokenAuth).toMatch(/^Basic /);
  });

  it("a code taken from someone's callback, used with the attacker's own sign-in at a provider that ignores PKCE: refused by the nonce", async () => {
    const idp = await provider();
    const { port, logs } = await editor(idp);

    idp.wrong = { ignorePkce: true };
    // The victim's sign-in: the provider sends their browser back with a code, which leaks.
    const victim = await call(port, "GET", "/api/auth/oidc/start");
    const leaked = new URL(await idp.authorize(String(victim.headers.location))).searchParams.get("code")!;
    // The attacker's own sign-in, with their own cookie and state, and the victim's code.
    const attacker = await call(port, "GET", "/api/auth/oidc/start");
    const theirs = new URL(await idp.authorize(String(attacker.headers.location)));

    theirs.searchParams.set("code", leaked);
    const answer = await call(port, "GET", `${theirs.pathname}${theirs.search}`, { cookie: cookieNamed(attacker.cookies, PRE_LOGIN)! });

    expect(answer.headers.location).toBe("/login?signin=refused-token");
    expect(cookieNamed(answer.cookies, SESSION)).toBeUndefined();
    expect(logOf(logs)).toMatch(/nonce/);
    idp.wrong = {};
  });

  it("the issuer byte for byte: a trailing slash said in the sentence, another issuer refused; with the slash on both sides it works", async () => {
    const idp = await provider();
    const slash = await editor(idp, { GALLEY_OIDC_ISSUER: `${idp.issuer}/` });

    refusedWith(await signIn(slash.port, idp), "provider-misconfigured");
    expect(logOf(slash.logs)).toContain("they differ only by the trailing slash");
    idp.wrong = { issuerInDocument: "https://another.example" };
    const other = await editor(idp);

    refusedWith(await signIn(other.port, idp), "provider-misconfigured");
    idp.wrong = {};
    // The provider's issuer itself ends with a slash: one is dropped before the discovery path, and the two match.
    idp.issuer = `${idp.url}/`;
    const both = await editor(idp, { GALLEY_OIDC_ISSUER: `${idp.url}/` });

    expect((await signIn(both.port, idp)).session).toBeDefined();
    idp.issuer = idp.url;
  });

  it("slow, failing, redirecting or too big: refused in a sentence, and the server carries on", async () => {
    const idp = await provider();

    for (const [wrong, why] of [
      [{ discoveryStatus: 500 }, "it answered 500"],
      [{ discoveryRedirect: true }, "redirect"],
      [{ discoveryBytes: 70 * 1024 }, "larger than 64 KB"],
    ] as const) {
      idp.wrong = wrong;
      const { port, logs } = await editor(idp);

      refusedWith(await signIn(port, idp), "provider-unreachable");
      expect(logOf(logs), JSON.stringify(wrong)).toContain(why);
      expect((await call(port, "GET", "/api/meta")).status).toBe(200);
    }
    idp.wrong = { tokenBytes: 80 * 1024 };
    const big = await editor(idp);

    refusedWith(await signIn(big.port, idp), "provider-unreachable");
    expect(logOf(big.logs)).toContain("larger than 64 KB");
    idp.wrong = { tokenStatus: 500 };
    refusedWith(await signIn(big.port, idp), "refused-token");
    idp.wrong = {};
    // Slow: the bound covers the whole call, answer included.
    const slow = createServer((_req, res) => {
      res.writeHead(200);
      res.write("{");
      setTimeout(() => res.end("}"), 1000).unref();
    });

    await new Promise<void>((resolve) => slow.listen(0, "127.0.0.1", resolve));
    await expect(boundedFetch(`http://127.0.0.1:${(slow.address() as AddressInfo).port}/`, {}, 200)).rejects.toThrow();
    slow.close();
    expect(ANSWER_LIMIT_BYTES).toBe(64 * 1024);
  });

  it("the provider down when the server starts: it starts, a sign-in is refused; once the provider answers, the next sign-in works", async () => {
    const idp = await provider();

    idp.wrong = { discoveryStatus: 503 };
    const { port } = await editor(idp);

    refusedWith(await signIn(port, idp), "provider-unreachable");
    // Asked again only a few seconds later.
    idp.wrong = {};
    refusedWith(await signIn(port, idp), "provider-unreachable");
    const real = Date.now;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => real() + 6_000);

    try {
      expect((await signIn(port, idp)).session).toBeDefined();
    } finally {
      clock.mockRestore();
    }
  });
});

describe("the ID token", () => {
  it("is refused for anything wrong with how it is signed", async () => {
    const idp = await provider();
    const { port } = await editor(idp);

    idp.addKey("unpublished", "RS256", { published: false });
    idp.addKey("for-encryption", "RS256", { jwk: { use: "enc" } });
    idp.addKey("ec-key", "ES256");
    const cases: Array<[string, typeof idp.wrong]> = [
      ["alg none", { noneAlg: true }],
      ["HS256 with the public key as the secret", { hmacWithPublicKey: true }],
      ["a key the provider doesn't publish", { signWith: "unpublished" }],
      ["a key published for encryption", { signWith: "for-encryption" }],
      ["an algorithm other than the configured one", { signWith: "ec-key" }],
      ["a key whose kty contradicts the header's alg", { header: { kid: "ec-key" } }],
      ["a jwk in the header, signed by that key", { signWith: "unpublished", header: { kid: "unknown", jwk: { kty: "RSA" } } }],
      ["a jku in the header", { signWith: "unpublished", header: { kid: "unknown", jku: `${idp.url}/jwks` } }],
      ["an x5u in the header", { signWith: "unpublished", header: { kid: "unknown", x5u: `${idp.url}/cert` } }],
      ["no kid while the provider publishes several keys", { header: { kid: undefined } }],
    ];

    for (const [what, wrong] of cases) {
      idp.wrong = wrong;
      refusedWith(await signIn(port, idp), "refused-token");
      expect(true, what).toBe(true);
    }
    idp.wrong = {};
    expect((await signIn(port, idp)).session).toBeDefined();
  });

  it("is refused for its audience, its times, its nonce and its subject", async () => {
    const idp = await provider();
    const { port } = await editor(idp);
    const now = Math.floor(Date.now() / 1000);
    const cases: Array<[string, typeof idp.wrong]> = [
      ["another aud", { claims: { aud: "another-client" } }],
      ["two audiences", { claims: { aud: [CLIENT, "another-client"] } }],
      ["an azp that differs", { claims: { azp: "another-client" } }],
      ["expired", { claims: { exp: now - 120 } }],
      ["from the future", { claims: { iat: now + 300, exp: now + 600 } }],
      ["an nbf still to come", { claims: { nbf: now + 300 } }],
      ["older than ten minutes", { claims: { iat: now - 11 * 60, exp: now + 300 } }],
      ["another nonce", { claims: { nonce: "someone-elses" } }],
      ["no nonce", { dropClaims: ["nonce"] }],
      ["no sub", { dropClaims: ["sub"] }],
      ["a sub with a newline", { claims: { sub: "subject\nForged: line" } }],
      ["a sub of 256 characters", { claims: { sub: "s".repeat(256) } }],
    ];

    for (const [what, wrong] of cases) {
      idp.wrong = wrong;
      const trip = await signIn(port, idp);

      expect(trip.location, what).toMatch(/^\/login\?signin=refused-token$/);
      expect(trip.session, what).toBeUndefined();
    }
    idp.wrong = { claims: { aud: [CLIENT], azp: CLIENT, sub: "s".repeat(255) } };
    expect((await signIn(port, idp)).session).toBeDefined();
    idp.wrong = {};
  });

  it("a role claim that isn't exactly a role is refused, never given the default role; none at all: the default, or refused without one", async () => {
    const idp = await provider();
    const withDefault = await editor(idp, { GALLEY_OIDC_DEFAULT_ROLE: "contributor" });

    for (const role of ["Owner", ["owner"], "", "admin"]) {
      idp.user = { sub: `bad-role-${JSON.stringify(role)}`, galley_role: role };
      refusedWith(await signIn(withDefault.port, idp), "bad-role");
    }
    idp.user = { sub: "no-role-claim", name: "Nora" };
    const trip = await signIn(withDefault.port, idp);

    expect((await call<AccountSession>(withDefault.port, "GET", "/api/account", { cookie: trip.session! })).body.role).toBe("contributor");
    const without = await editor(idp);

    refusedWith(await signIn(without.port, idp), "no-role");
    expect(without.server.install!.people.list().accounts).toHaveLength(1);
  });
});

describe("the accounts", () => {
  it("found by issuer and subject, never by e-mail; a first sign-in's name and e-mail by the editor's own rules", async () => {
    const idp = await provider();
    const { port, server } = await editor(idp);
    const account = async (trip: RoundTrip) => (await call<AccountSession>(port, "GET", "/api/account", { cookie: trip.session! })).body;

    // The owner's own e-mail, verified at the provider: another account, without that e-mail.
    idp.user = { sub: "owner-lookalike", name: "Sam Owner", email: "sam@example.com", email_verified: true, galley_role: "owner" };
    const lookalike = await account(await signIn(port, idp));

    expect(lookalike).toMatchObject({ email: "", name: "" });
    expect(lookalike.id).not.toBe(server.install!.people.list().accounts[0]!.id);
    expect(needsName(server.install!.store.account(lookalike.id)!)).toBe(true);
    // An e-mail that isn't verified, or verified only as a string: none.
    for (const verified of [undefined, "true", false]) {
      idp.user = { sub: `unverified-${String(verified)}`, name: `Unverified ${String(verified)}`, email: `u-${String(verified)}@example.com`, email_verified: verified, galley_role: "editor" };
      expect((await account(await signIn(port, idp))).email).toBe("");
    }
    // A name the editor can't take: none, and the e-mail's first part stands in for it.
    idp.user = { sub: "angle", name: "<b>Bold</b>", email: "angle.person@example.com", email_verified: true, galley_role: "editor" };
    expect(await account(await signIn(port, idp))).toMatchObject({ name: "angle.person", email: "angle.person@example.com" });
    idp.user = { sub: "long", name: "L".repeat(101), galley_role: "editor" };
    expect((await account(await signIn(port, idp))).name).toBe("");
    // An e-mail the editor's check refuses.
    idp.user = { sub: "odd-email", name: "Odd Email", email: "not an e-mail", email_verified: true, galley_role: "editor" };
    expect((await account(await signIn(port, idp))).email).toBe("");
    // Nameless with no e-mail: publishing waits for a name (needsName), and only a name is asked for.
    idp.user = { sub: "nobody-named", galley_role: "editor" };
    const nameless = await account(await signIn(port, idp));

    expect(nameless).toMatchObject({ name: "", email: "", incomplete: true });
    expect(needsName(server.install!.store.account(nameless.id)!)).toBe(true);
  });

  it("every later sign-in brings it up to date: a new name unless it clashes, the provider's role, but never leaving no owner", async () => {
    const idp = await provider();
    const { port, server } = await editor(idp);
    const account = async () => (await call<AccountSession>(port, "GET", "/api/account", { cookie: (await signIn(port, idp)).session! })).body;

    idp.user = { sub: "pat", name: "Pat", galley_role: "editor" };
    const first = await account();

    idp.user = { sub: "pat", name: "Sam Owner", galley_role: "owner" };
    expect(await account()).toMatchObject({ id: first.id, name: "Pat", role: "owner" });
    idp.user = { sub: "pat", name: "Pat Renamed", galley_role: "contributor" };
    expect(await account()).toMatchObject({ name: "Pat Renamed", role: "contributor" });
    // The claim gone, with no default role: refused; the account stays as it was.
    idp.user = { sub: "pat", name: "Pat Renamed" };
    expect((await signIn(port, idp)).location).toBe("/login?signin=no-role");
    // The last owner who can sign in stays one, whatever the provider says.
    idp.user = { sub: "only-owner", name: "Olive", galley_role: "owner" };
    const olive = await account();
    const sam = server.install!.people.list().accounts.find((one) => one.email === "sam@example.com")!;

    await server.install!.people.change(olive.id, sam.id, { disabled: true });
    idp.user = { sub: "only-owner", name: "Olive", galley_role: "editor" };
    expect((await account()).role).toBe("owner");
  });

  it("switched off here, removed, or signed out by the provider after the sign-in began: refused, and nothing is made", async () => {
    const idp = await provider();
    const { port, server } = await editor(idp);
    const install = server.install!;

    idp.user = { sub: "switched", name: "Switched", galley_role: "editor" };
    const switched = (await call<AccountSession>(port, "GET", "/api/account", { cookie: (await signIn(port, idp)).session! })).body;
    const sam = install.people.list().accounts.find((one) => one.email === "sam@example.com")!;

    await install.people.change(sam.id, switched.id, { disabled: true });
    refusedWith(await signIn(port, idp), "switched-off");
    // A removed subject: on the list of removed accounts, its next sign-in makes nothing.
    await install.store.update((draft) => {
      draft.tombstones.push({ id: "gone", issuer: idp.issuer, subject: "removed-one", removedAt: new Date().toISOString(), removedBy: null });
    });
    idp.user = { sub: "removed-one", name: "Removed", galley_role: "editor" };
    refusedWith(await signIn(port, idp), "removed");
    // The provider signed this subject out after the ID token was issued (no account yet, and one that has one).
    await install.store.update((draft) => {
      draft.providerLogouts.push({ issuer: idp.issuer, subject: "logged-out", at: Date.now() + 60_000 });
    });
    idp.user = { sub: "logged-out", name: "Logged Out", galley_role: "editor" };
    const refused = await signIn(port, idp);

    expect(refused.location).toMatch(/^\/login\?signin=signed-out&at=\d+$/);
    expect(install.people.list().accounts.map((one) => one.name)).toEqual(["Sam Owner", "Switched"]);
  });

  it("an owner can't change the role of an account whose role the provider sets", async () => {
    const idp = await provider();
    const { port } = await editor(idp);
    const owner = await call(port, "POST", "/api/auth/login", { body: { email: "sam@example.com", password: PASSWORD } });
    const pat = (await call<AccountSession>(port, "GET", "/api/account", { cookie: (await signIn(port, idp)).session! })).body;
    const answer = await call(port, "PATCH", `/api/people/${pat.id}`, { cookie: owner.cookies[0]!, body: { role: "contributor" } });

    expect(answer.status).toBe(409);
    expect(answer.body.error.message).toMatch(/set at 127\.0\.0\.1/);
  });
});

describe("the first owner named by subject, and the configuration", () => {
  it("GALLEY_OIDC_OWNER makes the owner at start, with no password; their first sign-in is that owner; another owner claim is an owner too", async () => {
    const idp = await provider();
    const home = box.folder("home");
    const started = await startHosted(
      box,
      home,
      { GALLEY_PUBLIC_URL: EDITOR, GALLEY_OIDC_ISSUER: idp.issuer, GALLEY_OIDC_CLIENT_ID: CLIENT, GALLEY_OIDC_OWNER: "the-owner", GALLEY_OWNER_NAME: "Ignored Name" },
      { oidcAllowLoopbackHttp: true }
    );
    const [owner] = started.server.install!.people.list().accounts;

    expect(owner).toMatchObject({ role: "owner", name: "", email: "" });
    expect(started.server.install!.store.account(owner!.id)).toMatchObject({ passwordHash: null, identity: { issuer: idp.issuer, subject: "the-owner" } });
    expect(started.notices.join("\n")).toContain("GALLEY_OWNER_NAME and GALLEY_OWNER_EMAIL are ignored with GALLEY_OIDC_OWNER");
    // Nobody needs the setup link: the owner exists.
    expect((await call(started.port, "GET", "/api/meta")).body.install.passwordSet).toBe(true);
    idp.user = { sub: "the-owner", name: "Theo Owner", galley_role: "owner" };
    const theo = (await call<AccountSession>(started.port, "GET", "/api/account", { cookie: (await signIn(started.port, idp)).session! })).body;

    expect(theo).toMatchObject({ id: owner!.id, name: "Theo Owner", role: "owner" });
    idp.user = { sub: "another-owner", name: "Ann Other", galley_role: "owner" };
    expect((await call<AccountSession>(started.port, "GET", "/api/account", { cookie: (await signIn(started.port, idp)).session! })).body.role).toBe("owner");
  });

  it("refuses to start with a variable that is wrong or half-given, or set where the site's code could write it", async () => {
    const idp = await provider();
    const base = { GALLEY_PUBLIC_URL: EDITOR, GALLEY_OIDC_ISSUER: idp.issuer, GALLEY_OIDC_CLIENT_ID: CLIENT };
    const refuses = async (env: Record<string, string>, message: RegExp, options: { loopback?: boolean } = {}) => {
      await expect(startHosted(box, box.folder("home"), env, options.loopback === false ? {} : { oidcAllowLoopbackHttp: true })).rejects.toThrow(message);
    };
    const file = join(box.folder("config"), "install.json");

    await refuses({ ...base, GALLEY_OIDC_CLIENT_ID: "" }, /GALLEY_OIDC_CLIENT_ID/);
    await refuses({ GALLEY_PUBLIC_URL: EDITOR, GALLEY_OIDC_CLIENT_ID: CLIENT }, /without GALLEY_OIDC_ISSUER/);
    await refuses(base, /must start with https:\/\//, { loopback: false });
    await refuses({ ...base, GALLEY_PUBLIC_URL: "http://cms.localhost" }, /GALLEY_PUBLIC_URL must start with https:\/\//);
    await refuses({ ...base, GALLEY_OIDC_DEFAULT_ROLE: "owner" }, /can't be owner/);
    await refuses({ ...base, GALLEY_OIDC_ID_TOKEN_ALG: "HS256" }, /GALLEY_OIDC_ID_TOKEN_ALG must be one of/);
    await refuses({ ...base, GALLEY_OIDC_SESSION_HOURS: "721" }, /from 1 to 720/);
    await refuses({ ...base, GALLEY_OIDC_ONLY: "1" }, /GALLEY_OIDC_ONLY can't be used with this version/);
    await refuses({ ...base, GALLEY_PASSWORD: PASSWORD, GALLEY_OIDC_OWNER: "the-owner" }, /would both decide who this install's first owner is/);
    writeFileSync(file, JSON.stringify({ oidcIssuer: idp.issuer }));
    await refuses({ ...base, GALLEY_INSTALL_CONFIG: file }, /set in the server's environment only/);
    writeFileSync(file, JSON.stringify({ address: EDITOR }));
    await refuses({ GALLEY_OIDC_ISSUER: idp.issuer, GALLEY_OIDC_CLIENT_ID: CLIENT, GALLEY_INSTALL_CONFIG: file }, /must be set in the server's environment, not only as the starting-values file's address/);
    expect(APP_SECRET_ENV_NAMES).toContain("GALLEY_OIDC_CLIENT_SECRET");
  });

  it("without a provider configured nothing changes: no route, no button", async () => {
    const started = await startHosted(box, box.folder("home"), { GALLEY_PUBLIC_URL: EDITOR, GALLEY_PASSWORD: PASSWORD });

    expect((await call(started.port, "GET", "/api/auth/oidc/start")).status).toBe(404);
    expect((await call(started.port, "GET", "/api/auth/oidc/callback?code=x&state=y")).status).toBe(404);
    expect((await call(started.port, "GET", "/api/meta")).body.install.provider).toBeUndefined();
    expect(SESSION_MAX_AGE_S).toBe(30 * 24 * 60 * 60);
  });
});
