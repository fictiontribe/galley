import { describe, expect, it } from "vitest";
import { uiContentSecurityPolicy } from "../src/app";
import { cookiesOf, json, testApp, TOKEN } from "./helpers";

/**
 * When the UI is served by another origin (a dev server proxying /api), the
 * server never sees the page URL that carried `?token=`, so the page presents
 * the token on its first API call instead.
 */
describe("token hand-off on /api/meta", () => {
  it("sets the session cookie and reports the caller as signed in", async () => {
    const { raw } = testApp({ registry: { list: async () => [] } });
    const response = await raw("GET", `/api/meta?token=${TOKEN}`);

    expect(response.status).toBe(200);
    expect((await json(response)).authenticated).toBe(true);
    const setCookie = response.headers.getSetCookie()[0]!;

    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).not.toContain(TOKEN);
    const cookie = cookiesOf(response)[0]!;

    expect((await raw("GET", "/api/sites", { headers: { cookie } })).status).toBe(200);
  });

  it("a wrong token gets no cookie and learns nothing", async () => {
    const { raw } = testApp();
    const response = await raw("GET", "/api/meta?token=nope");
    const meta = await json(response);

    expect(response.headers.getSetCookie()).toHaveLength(0);
    expect(meta.authenticated).toBe(false);
    expect(meta.version).toBe("");
  });
});

describe("frame sources", () => {
  it("lists only sources browsers accept", () => {
    // An IPv6 literal with a port wildcard is rejected as a CSP source and logs a console error on every page.
    expect(uiContentSecurityPolicy(["http://127.0.0.1:*", "http://localhost:*"])).not.toContain("[::1]");
  });
});
