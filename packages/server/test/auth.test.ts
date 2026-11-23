import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signSession, verifySession, safeEqual, LoginLimiter } from "../src/auth";
import { cookiesOf, json, testApp, TOKEN } from "./helpers";

const PASSWORD = "correct horse battery";

function hosted(overrides = {}) {
  return testApp(
    { registry: { list: async () => [] } },
    { mode: "hosted", token: null, password: PASSWORD, allowedHosts: ["cms.example.com"], publicOrigin: "https://cms.example.com", ...overrides }
  );
}

const SAME_ORIGIN = { origin: "http://localhost" };

describe("local mode", () => {
  it("refuses API calls without a session", async () => {
    const { raw } = testApp({ registry: { list: async () => [] } });
    const response = await raw("GET", "/api/sites");

    expect(response.status).toBe(401);
    // 401 always says "unauthorized"; "forbidden" is kept for 403s.
    expect((await json(response)).error).toMatchObject({ code: "unauthorized", message: expect.stringMatching(/link printed/) });
  });

  it("accepts the Bearer token", async () => {
    const { call } = testApp({ registry: { list: async () => [] } });

    expect((await call("GET", "/api/sites")).status).toBe(200);
  });

  it("refuses a wrong Bearer token", async () => {
    const { raw } = testApp({ registry: { list: async () => [] } });

    for (const response of [await raw("GET", "/api/sites", { headers: { authorization: "Bearer wrong" } }), await raw("POST", "/api/sites/x/refresh", { headers: { authorization: "Bearer wrong" } })]) {
      expect(response.status).toBe(401);
      expect((await json(response)).error.code).toBe("unauthorized");
    }
  });

  it("exchanges ?token= for an HttpOnly SameSite=Strict cookie and redirects without it", async () => {
    const { raw } = testApp({ registry: { list: async () => [] } });
    const response = await raw("GET", `/sites/site-1?tab=proof&token=${TOKEN}`);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/sites/site-1?tab=proof");
    const setCookie = response.headers.getSetCookie()[0]!;

    expect(setCookie).toMatch(/^galley_session_test=/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    expect(setCookie).not.toContain(TOKEN);

    const cookie = cookiesOf(response)[0]!;

    expect((await raw("GET", "/api/sites", { headers: { cookie } })).status).toBe(200);
  });

  it("a wrong token redirects without setting a cookie", async () => {
    const { raw } = testApp();
    const response = await raw("GET", "/?token=nope");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("refuses a tampered cookie", async () => {
    const { raw } = testApp({ registry: { list: async () => [] } });
    const cookie = cookiesOf(await raw("GET", `/?token=${TOKEN}`))[0]!;
    const [name, value] = cookie.split("=") as [string, string];
    const parts = value.split(".");
    const tampered = `${name}=${Number(parts[0]) + 1}.${parts[1]}.${parts[2]}`;

    expect((await raw("GET", "/api/sites", { headers: { cookie: tampered } })).status).toBe(401);
  });

  it("sign-in with a password is refused in local mode", async () => {
    const { raw } = testApp();
    const response = await raw("POST", "/api/auth/login", { body: { password: "anything at all" }, headers: SAME_ORIGIN });

    expect(response.status).toBe(400);
  });

  it("meta is public but reveals only brand, mode and authenticated:false", async () => {
    const { raw, call } = testApp();
    const anonymous = await json(await raw("GET", "/api/meta"));

    expect(anonymous).toEqual({ version: "", brand: expect.objectContaining({ productName: "Galley" }), mode: "local", authenticated: false, desktop: false, platform: "" });
    const signedIn = await json(await call("GET", "/api/meta"));

    expect(signedIn).toMatchObject({ version: "0.0.0-test", mode: "local", authenticated: true, platform: process.platform });
  });

  it("meta reports the desktop shell to a signed-in client", async () => {
    const { call } = testApp({}, { desktop: true });

    expect((await json(await call("GET", "/api/meta"))).desktop).toBe(true);
  });
});

describe("hosted mode", () => {
  const login = (app: ReturnType<typeof hosted>, password: string, headers: Record<string, string> = {}) =>
    app.raw("POST", "http://cms.example.com/api/auth/login", { body: { password }, headers: { origin: "https://cms.example.com", ...headers } });

  it("signs in with the password and sets a signed cookie", async () => {
    const app = hosted();
    const response = await login(app, PASSWORD);

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ ok: true });
    const setCookie = response.headers.getSetCookie()[0]!;

    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    expect(setCookie).toMatch(/Max-Age=\d+/);
    expect(setCookie).not.toMatch(/Secure/);
    const cookie = cookiesOf(response)[0]!;

    expect((await app.raw("GET", "http://cms.example.com/api/sites", { headers: { cookie } })).status).toBe(200);
    expect((await json(await app.raw("GET", "http://cms.example.com/api/meta", { headers: { cookie } }))).authenticated).toBe(true);
  });

  it("marks the cookie Secure over HTTPS", async () => {
    const response = await hosted().raw("POST", "https://cms.example.com/api/auth/login", {
      body: { password: PASSWORD },
      headers: { origin: "https://cms.example.com" },
    });

    expect(response.headers.getSetCookie()[0]).toMatch(/Secure/);
  });

  it("marks the cookie Secure behind a trusted HTTPS proxy only", async () => {
    const trusted = await login(hosted({ trustProxy: true }), PASSWORD, { "x-forwarded-proto": "https" });
    const untrusted = await login(hosted(), PASSWORD, { "x-forwarded-proto": "https" });

    expect(trusted.headers.getSetCookie()[0]).toMatch(/Secure/);
    expect(untrusted.headers.getSetCookie()[0]).not.toMatch(/Secure/);
  });

  it("refuses a wrong password with 401", async () => {
    const response = await login(hosted(), "not the password");

    expect(response.status).toBe(401);
    expect((await json(response)).error).toMatchObject({ code: "unauthorized", message: "That password isn't right. Check it and try again." });
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("rate-limits failed sign-ins: 5 per minute per address, then 429", async () => {
    const app = hosted();
    const env = { incoming: { socket: { remoteAddress: "203.0.113.9" } } };
    const attempt = (password: string, address = env) =>
      app.app.request(
        "http://cms.example.com/api/auth/login",
        { method: "POST", body: JSON.stringify({ password }), headers: { "content-type": "application/json", origin: "https://cms.example.com" } },
        address
      );

    for (let i = 0; i < 5; i += 1) expect((await attempt("wrong password")).status).toBe(401);
    const blocked = await attempt(PASSWORD);

    expect(blocked.status).toBe(429);
    expect((await json(blocked)).error.message).toBe("Too many sign-in attempts. Wait a minute, then try again.");
    // Another address is unaffected.
    expect((await attempt(PASSWORD, { incoming: { socket: { remoteAddress: "198.51.100.1" } } })).status).toBe(200);
  });

  it("refuses API calls without a session, and a tampered cookie", async () => {
    const app = hosted();

    expect((await app.raw("GET", "http://cms.example.com/api/sites")).status).toBe(401);
    const cookie = cookiesOf(await login(app, PASSWORD))[0]!;
    const forged = cookie.replace(/.$/, (char) => (char === "A" ? "B" : "A"));

    expect((await app.raw("GET", "http://cms.example.com/api/sites", { headers: { cookie: forged } })).status).toBe(401);
  });

  it("a cookie signed with another key is refused", async () => {
    const app = hosted();
    const foreign = `galley_session_test=${signSession(randomBytes(32))}`;

    expect((await app.raw("GET", "http://cms.example.com/api/sites", { headers: { cookie: foreign } })).status).toBe(401);
  });

  it("logout clears the cookie and the session stops working", async () => {
    const app = hosted();
    const cookie = cookiesOf(await login(app, PASSWORD))[0]!;
    const out = await app.raw("POST", "http://cms.example.com/api/auth/logout", { headers: { cookie, origin: "https://cms.example.com" } });

    expect(out.status).toBe(200);
    expect(out.headers.getSetCookie()[0]).toMatch(/Max-Age=0/);
    expect((await app.raw("GET", "http://cms.example.com/api/sites", { headers: { cookie } })).status).toBe(401);
  });

  it("ignores ?token= hand-off", async () => {
    const app = hosted({ token: TOKEN });
    const response = await app.raw("GET", `http://cms.example.com/?token=${TOKEN}`);

    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("accepts an operator-configured Bearer token", async () => {
    const app = hosted({ token: TOKEN });

    expect((await app.raw("GET", "http://cms.example.com/api/sites", { headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(200);
  });

  it("unauthenticated meta reveals nothing beyond brand and mode", async () => {
    const meta = await json(await hosted().raw("GET", "http://cms.example.com/api/meta"));

    expect(meta).toEqual({ version: "", brand: expect.any(Object), mode: "hosted", authenticated: false, desktop: false, platform: "" });
  });
});

describe("origin and host guard", () => {
  it("blocks a state-changing request from another origin", async () => {
    const { raw } = testApp({ registry: { list: async () => [] } });
    const cookie = cookiesOf(await raw("GET", `/?token=${TOKEN}`))[0]!;
    const response = await raw("POST", "/api/auth/logout", { headers: { cookie, origin: "https://evil.example" } });

    expect(response.status).toBe(403);
    expect((await json(response)).error.code).toBe("forbidden");
  });

  it("blocks a state-changing request with no Origin and no Sec-Fetch-Site", async () => {
    const { raw } = testApp();
    const cookie = cookiesOf(await raw("GET", `/?token=${TOKEN}`))[0]!;

    expect((await raw("POST", "/api/sites/site-1/refresh", { headers: { cookie } })).status).toBe(403);
  });

  it("allows same-origin requests by Origin or Sec-Fetch-Site", async () => {
    const { raw } = testApp();
    const cookie = cookiesOf(await raw("GET", `/?token=${TOKEN}`))[0]!;

    expect((await raw("POST", "/api/auth/logout", { headers: { cookie, origin: "http://localhost" } })).status).toBe(200);
    expect((await raw("POST", "/api/auth/logout", { headers: { cookie, "sec-fetch-site": "same-origin" } })).status).toBe(200);
    expect((await raw("POST", "/api/auth/logout", { headers: { cookie, "sec-fetch-site": "cross-site" } })).status).toBe(403);
  });

  it("an Origin with the right host but another port is refused", async () => {
    const { raw } = testApp();

    expect((await raw("POST", "http://127.0.0.1:4400/api/auth/logout", { headers: { origin: "http://127.0.0.1:4611" } })).status).toBe(403);
    expect((await raw("POST", "http://127.0.0.1:4400/api/auth/logout", { headers: { origin: "http://127.0.0.1:4400" } })).status).toBe(200);
  });

  it("a Bearer token stands in for Origin", async () => {
    const { call } = testApp({ site: undefined });

    expect((await call("POST", "/api/auth/logout", undefined, { origin: "https://evil.example" })).status).toBe(200);
  });

  it("refuses requests for a host the server wasn't started for (DNS rebinding)", async () => {
    const { raw, call } = testApp();

    expect((await raw("GET", "http://attacker.example:4400/api/meta")).status).toBe(403);
    expect((await call("GET", "http://attacker.example:4400/api/sites")).status).toBe(403);
    expect((await raw("GET", "http://attacker.example:4400/")).status).toBe(403);
    expect((await raw("GET", "http://127.0.0.1:4400/api/meta")).status).toBe(200);
    expect((await raw("GET", "http://[::1]:4400/api/meta")).status).toBe(200);
  });

  it("hosted mode answers to its public host and loopback only", async () => {
    const app = hosted();

    expect((await app.raw("GET", "http://cms.example.com/api/meta")).status).toBe(200);
    expect((await app.raw("GET", "http://localhost:4400/api/meta")).status).toBe(200);
    expect((await app.raw("GET", "http://other.example/api/meta")).status).toBe(403);
  });

  it("hosted origin check accepts the public origin", async () => {
    const app = hosted();
    const ok = await app.raw("POST", "http://127.0.0.1:4400/api/auth/logout", { headers: { origin: "https://cms.example.com" } });
    const bad = await app.raw("POST", "http://127.0.0.1:4400/api/auth/logout", { headers: { origin: "https://cms.example.com.evil.example" } });

    expect(ok.status).toBe(200);
    expect(bad.status).toBe(403);
  });
});

describe("session primitives", () => {
  it("signs and verifies, and expires after 30 days", () => {
    const key = randomBytes(32);
    const now = Date.now();
    const value = signSession(key, now);

    expect(verifySession(key, value, now)).not.toBeNull();
    expect(verifySession(key, value, now + 31 * 24 * 3600 * 1000)).toBeNull();
    expect(verifySession(key, `${value}x`, now)).toBeNull();
    expect(verifySession(key, "a.b", now)).toBeNull();
  });

  it("compares in constant time regardless of length", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("the limiter forgets after the window", () => {
    const limiter = new LoginLimiter(2, 1000);

    limiter.fail("a", 0);
    limiter.fail("a", 10);
    expect(limiter.blocked("a", 20)).toBe(true);
    expect(limiter.blocked("a", 1500)).toBe(false);
  });
});
