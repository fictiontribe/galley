/**
 * The mock answers like the real server: it enforces the role-access table
 * for whoever is signed in (and marks each refusal in its log, so screen
 * tests can assert none happened), says who is signed in in /api/meta, and
 * has no accounts at all in local mode.
 */
import { describe, expect, it } from "vitest";
import { ROLE_REFUSAL } from "@galley/core/install/route-access";
import { createMockServer, type MockServer } from "../../mock/server.ts";

async function call(server: MockServer, method: string, url: string, body?: unknown) {
  const answer = await server.handle({ method, url, headers: body ? { "content-type": "application/json" } : {}, body: body ? Buffer.from(JSON.stringify(body)) : undefined });
  return { status: answer.status, json: answer.body ? (JSON.parse(String(answer.body)) as Record<string, unknown>) : null };
}

describe("the hosted mock with accounts", () => {
  it("refuses a contributor what the table refuses, and lets them edit", async () => {
    const server = createMockServer({ mode: "hosted", setup: "done", role: "contributor" });
    const siteId = server.install?.site.id ?? "";
    expect((await call(server, "GET", `/api/sites/${siteId}/changes`)).status).toBe(200);
    const publish = await call(server, "POST", `/api/sites/${siteId}/publish`, {});
    expect(publish.status).toBe(403);
    // The real server's refusal to the letter (server app.ts answers with the same sentence from the same table): status, shape, code.
    expect(publish.json).toEqual({ error: { code: "forbidden", message: ROLE_REFUSAL } });
    expect((await call(server, "GET", `/api/sites/${siteId}/inbox`)).status).toBe(403);
    expect((await call(server, "GET", "/api/install")).status).toBe(403);
    expect(server.log.filter((entry) => entry.refused).map((entry) => entry.path)).toEqual([`/api/sites/${siteId}/publish`, `/api/sites/${siteId}/inbox`, "/api/install"]);
  });

  it("says who is signed in, and how the sign-in page asks", async () => {
    const server = createMockServer({ mode: "hosted", setup: "done", role: "editor", email: true });
    const meta = (await call(server, "GET", "/api/meta")).json as { account: { name: string; role: string; access: string[] }; install: { signInWith: string; passwordEmail: boolean } };
    expect(meta.account).toMatchObject({ name: "Robin Park", role: "editor", access: ["edit", "publish"] });
    expect(meta.account).not.toHaveProperty("password");
    expect(meta.install).toMatchObject({ signInWith: "email", passwordEmail: true });

    const legacy = createMockServer({ mode: "hosted", setup: "done", legacy: true });
    const signedOut = (await call(legacy, "GET", "/api/meta")).json as { account?: unknown; install: { signInWith: string; passwordEmail: boolean } };
    expect(signedOut.account).toBeUndefined();
    expect(signedOut.install).toMatchObject({ signInWith: "password", passwordEmail: false });
  });

  it("never tells the people list a password or a link's code", async () => {
    const server = createMockServer({ mode: "hosted", setup: "done", role: "owner" });
    const people = JSON.stringify((await call(server, "GET", "/api/people")).json);
    expect(people).not.toContain("proof");
    expect(people).not.toContain("code");
  });

  it("refuses with the real server's body: the code and the sentence, no extra fields", async () => {
    const server = createMockServer({ mode: "hosted", setup: "done" });
    // server/src/app.ts and errors.ts: `{ error: { code, message } }`, `detail` only when there is one.
    expect(await call(server, "GET", "/api/sites")).toEqual({ status: 401, json: { error: { code: "unauthorized", message: "Sign in to continue." } } });
    const wrong = await call(server, "POST", "/api/auth/login", { email: "sam@example.com", password: "not it" });
    expect(wrong.status).toBe(401);
    expect(Object.keys((wrong.json as { error: object }).error).sort()).toEqual(["code", "message"]);
  });

  it("limits tries as the real server does: 429 with code “busy” after five failures, until the minute is up", async () => {
    const server = createMockServer({ mode: "hosted", setup: "done" });
    const accounts = server.accounts!;
    for (let i = 0; i < 5; i += 1) expect((await call(server, "POST", "/api/auth/login", { email: "sam@example.com", password: "not it" })).status).toBe(401);
    // Even the right password waits: the server answers before it looks at the password.
    expect(await call(server, "POST", "/api/auth/login", { email: "sam@example.com", password: "proof" })).toEqual({ status: 429, json: { error: { code: "busy", message: "Too many sign-in attempts. Wait a minute, then try again." } } });
    expect((await call(server, "POST", "/api/auth/link/check", { code: "x" })).status).toBe(429);
    accounts.now = () => Date.now() + 61_000;
    expect((await call(server, "POST", "/api/auth/login", { email: "sam@example.com", password: "proof" })).status).toBe(200);

    // Bad link codes and a wrong current password count against the same limit; a good sign-in starts it again.
    for (let i = 0; i < 3; i += 1) expect((await call(server, "POST", "/api/auth/link/check", { code: `x${i}` })).status).toBe(404);
    for (let i = 0; i < 2; i += 1) expect((await call(server, "POST", "/api/account/password", { current: "not it", next: "a long new password" })).status).toBe(400);
    expect((await call(server, "POST", "/api/account/password", { current: "proof", next: "a long new password" })).json).toEqual({ error: { code: "busy", message: "Too many attempts. Wait a minute, then try again." } });
  });

  it("limits “forgot my password” to five requests in 15 minutes, as the real server does", async () => {
    const server = createMockServer({ mode: "hosted", setup: "done", email: true });
    for (let i = 0; i < 5; i += 1) expect((await call(server, "POST", "/api/auth/forgot", { email: "nobody@example.com" })).status).toBe(200);
    expect((await call(server, "POST", "/api/auth/forgot", { email: "sam@example.com" })).status).toBe(429);
    const passwordMail = () => server.accounts!.outbox.filter((mail) => mail.kind === "password").map((mail) => mail.to);
    expect(passwordMail()).toEqual([]);
    server.accounts!.now = () => Date.now() + 15 * 60_000;
    expect((await call(server, "POST", "/api/auth/forgot", { email: "sam@example.com" })).status).toBe(200);
    expect(passwordMail()).toEqual(["sam@example.com"]);
  });

  it("answers as a server from before accounts when told to", async () => {
    const server = createMockServer({ mode: "hosted", setup: "done", accounts: false });
    expect(server.accounts).toBeNull();
    expect((await call(server, "POST", "/api/auth/login", { password: "proof" })).status).toBe(200);
    const meta = (await call(server, "GET", "/api/meta")).json as { account?: unknown };
    expect(meta.account).toBeUndefined();
    expect((await call(server, "GET", "/api/people")).status).toBe(404);
  });
});

describe("the local mock", () => {
  it("has no accounts: every account route answers “not here”, nothing is refused for a role", async () => {
    const server = createMockServer({ mode: "local" });
    expect(server.accounts).toBeNull();
    expect((await call(server, "GET", "/api/account")).status).toBe(404);
    expect((await call(server, "POST", "/api/auth/link/check", { code: "x" })).status).toBe(404);
    const meta = (await call(server, "GET", "/api/meta")).json as { account?: unknown; install?: unknown };
    expect(meta.account).toBeUndefined();
    expect(meta.install).toBeUndefined();
    expect(server.log.some((entry) => entry.refused)).toBe(false);
  });
});
