/**
 * The mock answers like the real server: it enforces the role-access table
 * for whoever is signed in (and marks each refusal in its log, so screen
 * tests can assert none happened), says who is signed in in /api/meta, and
 * has no accounts at all in local mode.
 */
import { describe, expect, it } from "vitest";
import { BUILD_MODE_LEVEL, ROLE_REFUSAL, SITE_SETTINGS_LEVEL } from "@galley/core/install/route-access";
import { roleMay } from "@galley/core/install/accounts";
import { createMockServer, type MockServer } from "../../mock/server.ts";
import { BUILD_MODE_REFUSAL, OWN_EMAIL_REFUSAL, SITE_SETTINGS_REFUSAL } from "../../mock/accounts.ts";

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

describe("the hosted mock: what a request asks for, by role", () => {
  type Role = "owner" | "editor" | "contributor";
  const mayBuild = (role: Role) => roleMay(role, BUILD_MODE_LEVEL);
  const maySettings = (role: Role) => roleMay(role, SITE_SETTINGS_LEVEL);

  it.each<Role>(["owner", "editor", "contributor"])("build mode, as the %s: refused without the level whichever way it is asked for, and marked as a refusal", async (role) => {
    const server = createMockServer({ mode: "hosted", setup: "done", role });
    const siteId = server.install?.site.id ?? "";
    const allowed = mayBuild(role) ? 200 : 403;
    const thread = await call(server, "POST", `/api/sites/${siteId}/threads`, { mode: "build" });
    expect(thread.status).toBe(allowed);
    const content = await call(server, "POST", `/api/sites/${siteId}/threads`, { mode: "content" });
    expect(content.status).toBe(200);
    const threadId = String((content.json as { id: string }).id);
    expect((await call(server, "POST", `/api/sites/${siteId}/threads/${threadId}/messages`, { text: "Make the header sticky", mode: "build" })).status).toBe(allowed);
    expect((await call(server, "PUT", `/api/sites/${siteId}/file?path=src/styles/site.css`, { content: "body{}", mode: "build" })).status).toBe(allowed);
    for (const path of ["kit/setup", "kit/visibility", "import/rebuild-all"]) expect((await call(server, "POST", `/api/sites/${siteId}/${path}`, {})).status === 403).toBe(!mayBuild(role));
    if (!mayBuild(role)) {
      expect(thread.json).toEqual({ error: { code: "forbidden", message: BUILD_MODE_REFUSAL } });
      expect(server.log.filter((entry) => entry.refused).map((entry) => `${entry.method} ${entry.path}`)).toEqual([
        `POST /api/sites/${siteId}/threads`,
        `POST /api/sites/${siteId}/threads/${threadId}/messages`,
        `PUT /api/sites/${siteId}/file`,
        `POST /api/sites/${siteId}/kit/setup`,
        `POST /api/sites/${siteId}/kit/visibility`,
        `POST /api/sites/${siteId}/import/rebuild-all`,
      ]);
    } else expect(server.log.some((entry) => entry.refused)).toBe(false);
  });

  it.each<Role>(["owner", "editor", "contributor"])("the site's settings file, as the %s: refused without the level by every route that writes it", async (role) => {
    const server = createMockServer({ mode: "hosted", setup: "done", role });
    const siteId = server.install?.site.id ?? "";
    const allowed = maySettings(role) ? 200 : 403;
    const file = await call(server, "PUT", `/api/sites/${siteId}/file?path=galley.config.json`, { content: "{}", mode: "build" });
    expect(file.status).toBe(allowed);
    if (!maySettings(role)) expect(file.json).toEqual({ error: { code: "forbidden", message: SITE_SETTINGS_REFUSAL } });
    expect((await call(server, "PUT", `/api/sites/${siteId}/redirects/settings`, { host: "netlify" })).status).toBe(allowed);
    expect((await call(server, "PUT", `/api/sites/${siteId}/config`, { config: {} })).status).toBe(allowed);
    expect(server.log.filter((entry) => entry.refused)).toHaveLength(maySettings(role) ? 0 : 3);
  });

  it("changing your own e-mail: an owner may; anyone else is refused; an account with none yet may add one", async () => {
    const editor = createMockServer({ mode: "hosted", setup: "done", role: "editor" });
    const refused = await call(editor, "PATCH", "/api/account", { email: "robin@example.org", password: "proof" });
    expect(refused).toEqual({ status: 403, json: { error: { code: "forbidden", message: OWN_EMAIL_REFUSAL } } });
    expect(editor.accounts?.current()?.email).toBe("robin@example.com");
    expect(editor.log.at(-1)?.refused).toBe(true);
    // The name is still theirs to change, and the same e-mail again is no change.
    expect((await call(editor, "PATCH", "/api/account", { name: "Robin P. Park", email: "robin@example.com" })).status).toBe(200);

    const owner = createMockServer({ mode: "hosted", setup: "done", role: "owner" });
    expect((await call(owner, "PATCH", "/api/account", { email: "sam@example.org", password: "proof" })).status).toBe(200);

    const legacy = createMockServer({ mode: "hosted", setup: "done", legacy: true });
    legacy.backend.authenticated = true;
    expect((await call(legacy, "PATCH", "/api/account", { name: "Sam Rivera", email: "sam@example.com", password: "proof" })).status).toBe(200);
    expect(legacy.accounts?.current()?.email).toBe("sam@example.com");

    // Not an owner, but no e-mail yet: they add it.
    const none = createMockServer({ mode: "hosted", setup: "done", role: "contributor" });
    none.accounts!.current()!.email = "";
    expect((await call(none, "PATCH", "/api/account", { email: "jo@example.org", password: "proof" })).status).toBe(200);
    expect(none.accounts?.current()?.email).toBe("jo@example.org");
  });

  it("an owner changes someone else's e-mail: the same refusals, and that person's open links stop working", async () => {
    const server = createMockServer({ mode: "hosted", setup: "done", role: "owner" });
    const jo = server.accounts!.accounts.find((person) => person.name === "Jo Chen")!;
    const link = (await call(server, "POST", `/api/people/${jo.id}/password-link`)).json as { url: string };
    const code = link.url.split("#")[1];
    expect(await call(server, "PATCH", `/api/people/${jo.id}`, { email: "robin@example.com" })).toEqual({ status: 409, json: { error: { code: "conflict", message: "Someone with that e-mail already has an account here." } } });
    expect((await call(server, "PATCH", `/api/people/${jo.id}`, { email: "not an address" })).json).toEqual({ error: { code: "invalid", message: "That e-mail address is missing something. It should look like name@example.com." } });
    const changed = await call(server, "PATCH", `/api/people/${jo.id}`, { email: "Jo.Chen@Example.org" });
    expect(changed.status).toBe(200);
    expect(changed.json).toMatchObject({ email: "jo.chen@example.org" });
    expect((await call(server, "POST", "/api/auth/link/check", { code })).status).toBe(404);
    // Not your own: another owner changes that.
    const sam = server.accounts!.current()!;
    expect((await call(server, "PATCH", `/api/people/${sam.id}`, { email: "sam@example.org" })).status).toBe(409);
  });

  it("a new-password link for someone else: not handed back when it was e-mailed, handed back when it couldn't be", async () => {
    const mailing = createMockServer({ mode: "hosted", setup: "done", role: "owner", email: true });
    const robin = mailing.accounts!.accounts.find((person) => person.name === "Robin Park")!;
    const mailed = (await call(mailing, "POST", `/api/people/${robin.id}/password-link`)).json as { url: string | null; emailed: boolean };
    expect(mailed).toMatchObject({ url: null, emailed: true });
    expect(mailing.accounts?.outbox.at(-1)).toMatchObject({ to: "robin@example.com", kind: "password" });
    // Invitations always carry their link.
    const invited = (await call(mailing, "POST", "/api/people/invitations", { email: "ana@example.com", role: "editor" })).json as { link: { url: string | null; emailed: boolean } };
    expect(invited.link.emailed).toBe(true);
    expect(invited.link.url).toMatch(/\/join#.+/);

    const byHand = createMockServer({ mode: "hosted", setup: "done", role: "owner" });
    const other = byHand.accounts!.accounts.find((person) => person.name === "Robin Park")!;
    expect((await call(byHand, "POST", `/api/people/${other.id}/password-link`)).json).toMatchObject({ url: expect.stringMatching(/\/new-password#.+/), emailed: false });
  });

  it("without a public address it e-mails nothing, outgoing e-mail or not", async () => {
    const server = createMockServer({ mode: "hosted", setup: "done", email: true, publicAddress: false });
    const meta = (await call(server, "GET", "/api/meta")).json as { install: { passwordEmail: boolean } };
    expect(meta.install.passwordEmail).toBe(false);
    expect(await call(server, "POST", "/api/auth/forgot", { email: "sam@example.com" })).toEqual({ status: 200, json: { ok: true, emailAvailable: false } });
    server.backend.authenticated = true;
    expect(((await call(server, "GET", "/api/people")).json as { emailAvailable: boolean }).emailAvailable).toBe(false);
    const robin = server.accounts!.accounts.find((person) => person.name === "Robin Park")!;
    expect((await call(server, "POST", `/api/people/${robin.id}/password-link`)).json).toMatchObject({ url: expect.stringMatching(/\/new-password#.+/), emailed: false });
    expect(server.accounts?.outbox).toEqual([]);
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
