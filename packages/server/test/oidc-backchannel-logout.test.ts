/**
 * Back-channel logout (OpenID Connect Back-Channel Logout 1.0), over real
 * HTTP against the provider that runs inside the test: a good logout token
 * ends the subject's sessions and streams, holds across a restart, and
 * refuses a sign-in from before it, for an account or a subject with none;
 * every bad token is a 400 that ends nothing; the route takes no cookie and
 * no Origin, by its exact path only, its body capped before anything reads
 * it; its failures and sign-in's never block each other; 200 only once the
 * logout is written; 503 with Retry-After while a backup is put back.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PROVIDER_LOGOUTS_KEPT, type AccountSession } from "@galley/core/install";
import { signSession } from "../src/auth";
import { BACKCHANNEL_LOGOUT_PATH } from "../src/oidc/routes";
import { testApp } from "./helpers";
import { call, EDITOR, sandbox, startHosted, type Started } from "./hosted-helpers";
import { startTestProvider, type TestProvider } from "./oidc-test-provider";

const box = sandbox("oidc-backchannel-logout");
const PASSWORD = "correct horse battery staple";
const CLIENT = "galley-test-client";
const SESSION = "__Host-galley_session";
const PRE_LOGIN = "__Host-galley_oidc";
const providers: TestProvider[] = [];

afterAll(async () => {
  await Promise.all(providers.map((one) => one.close()));
  await box.cleanup();
}, 120_000);

async function provider(): Promise<TestProvider> {
  const made = await startTestProvider({ clientId: CLIENT });

  providers.push(made);
  return made;
}

function editor(idp: TestProvider, home = box.folder("home"), env: Record<string, string> = {}, options: Parameters<typeof startHosted>[3] = {}): Promise<Started> {
  return startHosted(
    box,
    home,
    { GALLEY_PUBLIC_URL: EDITOR, GALLEY_PASSWORD: PASSWORD, GALLEY_OWNER_NAME: "Sam Owner", GALLEY_OWNER_EMAIL: "sam@example.com", GALLEY_OIDC_ISSUER: idp.issuer, GALLEY_OIDC_CLIENT_ID: CLIENT, GALLEY_TRUST_PROXY: "1", ...env },
    { oidcAllowLoopbackHttp: true, heartbeatMs: 40, ...options }
  );
}

const cookieNamed = (cookies: string[], name: string) => cookies.find((cookie) => cookie.startsWith(`${name}=`));
let addresses = 0;
const nextAddress = () => `198.51.100.${(addresses = (addresses % 250) + 1)}`;

/** A sign-in through the provider as `sub`: the session cookie, or where the browser was sent. */
async function signIn(port: number, idp: TestProvider, sub: string, from = nextAddress()): Promise<{ cookie?: string; location: string }> {
  idp.user = { sub, name: `Person ${sub}`, galley_role: "editor", ...(idp.user.sub === sub ? idp.user : {}) };
  const headers = { "x-forwarded-for": from };
  const start = await call(port, "GET", "/api/auth/oidc/start", { headers });
  const back = new URL(await idp.authorize(String(start.headers.location)));
  const done = await call(port, "GET", `${back.pathname}${back.search}`, { cookie: cookieNamed(start.cookies, PRE_LOGIN)!, headers });
  const cookie = cookieNamed(done.cookies, SESSION);

  return { ...(cookie ? { cookie } : {}), location: String(done.headers.location) };
}

/** The provider's server sending a logout: form-encoded, no cookie, no Origin. */
function logout(port: number, token: string, extra = "", from = "203.0.113.200") {
  return call(port, "POST", BACKCHANNEL_LOGOUT_PATH, {
    raw: `logout_token=${encodeURIComponent(token)}${extra}`,
    headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": from },
    origin: null,
  });
}

const signedIn = async (port: number, cookie: string) => (await call(port, "GET", "/api/account", { cookie })).status === 200;

/** An event stream opened with this cookie: whether it was let in, and when it ends. */
async function stream(port: number, cookie: string): Promise<{ ended: Promise<void>; close: () => void }> {
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${port}/api/events`, { headers: { host: "cms.localhost", cookie }, signal: controller.signal });
  const reader = response.body!.getReader();

  await reader.read();
  const ended = (async () => {
    for (;;) if ((await reader.read().catch(() => ({ done: true }))).done) return;
  })();

  return { ended, close: () => controller.abort() };
}

const within = <T>(ms: number, what: string, work: Promise<T>) => Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(what)), ms).unref())]);

describe("a good logout token", () => {
  it("ends the subject's sessions and their open streams, and nobody else's; answered 200 with no-store; a sign-in after it works; it holds across a restart", async () => {
    const idp = await provider();
    const home = box.folder("home");
    const first = await editor(idp, home);
    const pat = (await signIn(first.port, idp, "pat")).cookie!;
    const patElsewhere = (await signIn(first.port, idp, "pat")).cookie!;
    const kim = (await signIn(first.port, idp, "kim")).cookie!;
    const open = await stream(first.port, pat);
    const answer = await logout(first.port, idp.logoutToken("pat"));

    expect(answer.status, answer.text).toBe(200);
    expect(answer.headers["cache-control"]).toBe("no-store");
    expect([await signedIn(first.port, pat), await signedIn(first.port, patElsewhere), await signedIn(first.port, kim)]).toEqual([false, false, true]);
    await within(5000, "the stream of a signed-out person stayed open", open.ended);
    expect(first.logs.join("\n")).toContain("The provider (127.0.0.1) signed Person pat (Editor) out (key main).");
    // Signing in afterwards (a token issued after the logout) works.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const again = (await signIn(first.port, idp, "pat")).cookie;

    expect(again).toBeDefined();
    await first.server.close();
    const restarted = await editor(idp, home);

    expect(await signedIn(restarted.port, pat)).toBe(false);
    expect(await signedIn(restarted.port, kim)).toBe(true);
  });

  it("with the provider's clock 40 seconds behind, still ends a session made 10 seconds before it; replayed, it reaches no further than a minute after its iat; an older one changes nothing", async () => {
    const idp = await provider();
    const home = box.folder("home");
    const { port, server } = await editor(idp, home);

    await signIn(port, idp, "pat");
    const store = server.install!.store;
    const key = Buffer.from(readFileSync(join(home, "session.key"), "utf8").trim(), "hex");
    const id = server.install!.people.list().accounts.find((account) => account.name === "Person pat")!.id;
    const now = Date.now();
    const tenSecondsAgo = `${SESSION}=${signSession(key, Math.max(now - 10_000, store.nextIssuedAt(now - 10_000, id)), undefined, id, { kind: "provider", lastsMs: 3_600_000 })}`;

    expect(await signedIn(port, tenSecondsAgo)).toBe(true);
    const token = idp.logoutToken("pat", { claims: { iat: Math.floor((now - 40_000) / 1000) } });

    expect((await logout(port, token)).status).toBe(200);
    expect(await signedIn(port, tenSecondsAgo)).toBe(false);
    const iat = Math.floor((now - 40_000) / 1000) * 1000;
    const before = store.account(id)!;

    expect(before.providerLogoutAt).toBe(iat);
    expect((await logout(port, token)).status).toBe(200);
    expect(store.account(id)!.providerLogoutAt).toBe(iat);
    expect(store.account(id)!.sessionsValidAfter).toBeLessThanOrEqual(iat + 60_000);
    // A logout older than the account's cut-offs: neither time goes down, nothing else changes.
    const settled = store.account(id)!;

    expect((await logout(port, idp.logoutToken("pat", { claims: { iat: Math.floor((now - 600_000) / 1000) } }))).status).toBe(200);
    expect(store.account(id)).toEqual(settled);
  });

  it("a sign-in begun before the logout and finished after it is refused, for an account and for a subject with none yet; signing out everywhere in the editor refuses nothing", async () => {
    const idp = await provider();
    const { port, server } = await editor(idp);
    const pat = (await signIn(port, idp, "pat")).cookie!;
    const now = Math.floor(Date.now() / 1000);

    // Signed out everywhere in the editor: the provider's next good token still signs them in.
    expect((await call(port, "POST", "/api/auth/logout-all", { cookie: pat })).status).toBe(200);
    expect((await signIn(port, idp, "pat")).cookie).toBeDefined();
    // The logout at now; an ID token from 30 seconds before it (a code got earlier, exchanged later).
    expect((await logout(port, idp.logoutToken("pat"))).status).toBe(200);
    expect((await logout(port, idp.logoutToken("newcomer"))).status).toBe(200);
    idp.wrong = { claims: { iat: now - 30, exp: now + 300 } };
    for (const sub of ["pat", "newcomer"]) {
      const refused = await signIn(port, idp, sub);

      expect(refused.location, sub).toMatch(/^\/login\?signin=signed-out&at=\d+$/);
      expect(refused.cookie).toBeUndefined();
    }
    idp.wrong = {};
    expect(server.install!.people.list().accounts.map((account) => account.name)).not.toContain("Person newcomer");
    expect(server.install!.store.read().providerLogouts).toEqual([expect.objectContaining({ subject: "newcomer" })]);
  });

  it("with sub and sid, every session of the subject ends; without exp it is taken on its iat; typ logout+jwt or JWT; extra values in the body are ignored", async () => {
    const idp = await provider();
    const { port } = await editor(idp);

    for (const options of [{ claims: { sid: "a-provider-session" } }, { drop: ["exp"] }, { header: { typ: "JWT" } }, { header: { typ: "application/logout+jwt" } }, { header: { typ: undefined } }]) {
      const cookie = (await signIn(port, idp, "pat")).cookie!;
      const answer = await logout(port, idp.logoutToken("pat", options), "&state=ignored&logout_token_hint=x");

      expect(answer.status, `${JSON.stringify(options)}: ${answer.text}`).toBe(200);
      expect(await signedIn(port, cookie), JSON.stringify(options)).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 1100));
    }
  });
});

describe("a bad logout token", () => {
  it("is answered 400 invalid_request with no-store, and ends nothing", async () => {
    const idp = await provider();
    const { port, logs } = await editor(idp);
    const pat = (await signIn(port, idp, "pat")).cookie!;
    const now = Math.floor(Date.now() / 1000);

    idp.addKey("unpublished", "RS256", { published: false });
    const cases: Array<[string, string]> = [
      ["only sid", idp.logoutToken(undefined, { claims: { sid: "a-provider-session" } })],
      ["a nonce", idp.logoutToken("pat", { claims: { nonce: "n" } })],
      ["no events", idp.logoutToken("pat", { drop: ["events"] })],
      ["events without the back-channel member", idp.logoutToken("pat", { claims: { events: { "http://schemas.openid.net/event/other": {} } } })],
      ["no jti", idp.logoutToken("pat", { drop: ["jti"] })],
      ["no iat", idp.logoutToken("pat", { drop: ["iat"] })],
      ["exp past", idp.logoutToken("pat", { claims: { exp: now - 120 } })],
      ["iat 31 days old", idp.logoutToken("pat", { claims: { iat: now - 31 * 24 * 3600 }, drop: ["exp"] })],
      ["iat in the future", idp.logoutToken("pat", { claims: { iat: now + 600, exp: now + 900 } })],
      ["encrypted", "a.b.c.d.e"],
      ["signed by another key", idp.logoutToken("pat", { signWith: "unpublished" })],
      ["another audience", idp.logoutToken("pat", { claims: { aud: "another-client" } })],
      ["an extra audience", idp.logoutToken("pat", { claims: { aud: [CLIENT, "another-client"] } })],
      ["another issuer", idp.logoutToken("pat", { claims: { iss: "https://another.example" } })],
      ["alg none", idp.logoutToken("pat", { none: true })],
      ["HS256 with the public key", idp.logoutToken("pat", { hmacWithPublicKey: true })],
      ["typ at+jwt", idp.logoutToken("pat", { header: { typ: "at+jwt" } })],
      ["typ JOSE", idp.logoutToken("pat", { header: { typ: "JOSE" } })],
      ["a sub with a newline", idp.logoutToken("pat\nForged")],
      ["not a JWT", "not-a-token"],
      ["a jwk in the header, signed by it", idp.logoutToken("pat", { signWith: "unpublished", header: { kid: "nope", jwk: { kty: "RSA" } } })],
    ];

    for (const [what, token] of cases) {
      const answer = await logout(port, token, "", `203.0.113.${cases.findIndex((one) => one[0] === what) + 1}`);

      expect([answer.status, answer.body], what).toEqual([400, { error: "invalid_request" }]);
      expect(answer.headers["cache-control"], what).toBe("no-store");
    }
    expect((await logout(port, "")).status).toBe(400);
    expect(await signedIn(port, pat)).toBe(true);
    expect(logs.join("\n")).toContain("was refused: it names only a provider session (sid), not a subject.");
  });
});

describe("the route", () => {
  it("needs no Origin and reads no cookie, by its exact path; anything else posted with no Origin is still refused", async () => {
    const idp = await provider();
    const { port } = await editor(idp);
    const owner = await call(port, "POST", "/api/auth/login", { body: { email: "sam@example.com", password: PASSWORD } });

    for (const path of [`${BACKCHANNEL_LOGOUT_PATH}/`, `${BACKCHANNEL_LOGOUT_PATH}x`, `${BACKCHANNEL_LOGOUT_PATH}/../../people/sign-out`, "/api/auth/oidc/backchannel-logou", "/api/auth/logout-all"]) {
      const answer = await call(port, "POST", path, { raw: "logout_token=x", headers: { "content-type": "application/x-www-form-urlencoded" }, origin: null, cookie: owner.cookies[0]! });

      expect(answer.status, path).toBe(403);
    }
    // With a cookie and a foreign Origin it is the same route: the cookie is never read, the Origin never asked for.
    const answer = await call(port, "POST", BACKCHANNEL_LOGOUT_PATH, { raw: `logout_token=${encodeURIComponent(idp.logoutToken("pat"))}`, headers: { "content-type": "application/x-www-form-urlencoded" }, origin: "https://evil.example", cookie: owner.cookies[0]! });

    expect(answer.status).toBe(200);
    expect((await call(port, "GET", "/api/account", { cookie: owner.cookies[0]! })).status).toBe(200);
  });

  it("refuses a 17 KB body before anything reads it", async () => {
    const idp = await provider();
    const { port } = await editor(idp);
    const answer = await call(port, "POST", BACKCHANNEL_LOGOUT_PATH, { raw: `logout_token=${"x".repeat(17 * 1024)}`, headers: { "content-type": "application/x-www-form-urlencoded" }, origin: null });

    expect(answer.status).toBe(413);
    expect(answer.body).toEqual({ error: "invalid_request" });
  });

  it("shares no limit with sign-in: five failed sign-ins don't block it; a hundred bad tokens don't block it or a sign-in", async () => {
    const idp = await provider();
    const { port, logs } = await editor(idp);
    const from = "203.0.113.77";

    for (let i = 0; i < 5; i += 1) await call(port, "POST", "/api/auth/login", { body: { email: "sam@example.com", password: "a wrong password here" }, headers: { "x-forwarded-for": from } });
    const pat = (await signIn(port, idp, "pat", "198.51.100.77")).cookie!;

    expect((await logout(port, idp.logoutToken("pat"), "", from)).status).toBe(200);
    expect(await signedIn(port, pat)).toBe(false);
    const other = "203.0.113.78";

    for (let i = 0; i < 100; i += 1) expect((await logout(port, "not-a-token", "", other)).status).toBe(400);
    const kim = (await signIn(port, idp, "kim", other)).cookie!;

    expect((await logout(port, idp.logoutToken("kim"), "", other)).status).toBe(200);
    expect(await signedIn(port, kim)).toBe(false);
    expect((await call(port, "POST", "/api/auth/login", { body: { email: "sam@example.com", password: PASSWORD }, headers: { "x-forwarded-for": other } })).status).toBe(200);
    // The refusals were logged at a bounded rate: once a minute from that address.
    expect(logs.filter((line) => line.startsWith("A back-channel logout from 203.0.113.78 was refused"))).toHaveLength(1);
  });

  it("answers 200 only once it is written: a failed write is a 400 server_error, logged, and ends nothing; past 10,000 recent logouts, 503 to be sent again", async () => {
    const idp = await provider();
    const { port, server, logs } = await editor(idp);
    const store = server.install!.store;
    const pat = (await signIn(port, idp, "pat")).cookie!;
    const write = store.update.bind(store);

    store.update = async () => {
      throw new Error("the disk is full");
    };
    try {
      const answer = await logout(port, idp.logoutToken("pat"));

      expect([answer.status, answer.body]).toEqual([400, { error: "server_error" }]);
    } finally {
      store.update = write;
    }
    expect(await signedIn(port, pat)).toBe(true);
    expect(logs.join("\n")).toContain("couldn't be written, so nobody was signed out by it");
    await store.update((draft) => {
      draft.providerLogouts = Array.from({ length: PROVIDER_LOGOUTS_KEPT }, (_, i) => ({ issuer: idp.issuer, subject: `gone-${i}`, at: Date.now() }));
    });
    const full = await logout(port, idp.logoutToken("someone-new"));

    expect([full.status, full.headers["retry-after"]]).toEqual([503, "30"]);
    // For an account, it is still written.
    expect((await logout(port, idp.logoutToken("pat"))).status).toBe(200);
    expect(await signedIn(port, pat)).toBe(false);
  });

  it("while a backup is being put back, answers 503 with Retry-After: the provider sends it again", async () => {
    const app = testApp(
      {},
      {
        mode: "hosted",
        install: { store: { isRevoked: () => false, revokeSession: async () => {}, sessionValid: () => false } } as never,
        ops: { restoring: () => true } as never,
        oidc: { config: { issuer: "https://id.example.com", name: "id.example.com" } } as never,
        publicOrigin: EDITOR,
      }
    );
    const answer = await app.raw("POST", `http://127.0.0.1:4400${BACKCHANNEL_LOGOUT_PATH}`, { body: "logout_token=x", headers: { "content-type": "application/x-www-form-urlencoded" } });

    expect(answer.status).toBe(503);
    expect(answer.headers.get("retry-after")).toBe("30");
    expect(answer.headers.get("cache-control")).toBe("no-store");
    expect(await answer.json()).toEqual({ error: "temporarily_unavailable" });
  });

  it("isn't there without a provider", async () => {
    const started = await startHosted(box, box.folder("home"), { GALLEY_PUBLIC_URL: EDITOR, GALLEY_PASSWORD: PASSWORD });

    expect((await call(started.port, "POST", BACKCHANNEL_LOGOUT_PATH, { raw: "logout_token=x", headers: { "content-type": "application/x-www-form-urlencoded" }, origin: null })).status).toBe(403);
    expect((await call<AccountSession>(started.port, "POST", BACKCHANNEL_LOGOUT_PATH, { raw: "logout_token=x", headers: { "content-type": "application/x-www-form-urlencoded" } })).status).toBe(404);
  });
});
