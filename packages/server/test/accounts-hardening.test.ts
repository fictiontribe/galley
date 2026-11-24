/**
 * A hosted install over real HTTP: the site's settings file and build mode
 * by every route-level path, by role; whose name a publish carries when
 * someone else's request opened the site; sign-in limits that slow other
 * people's guesses but never refuse the right password; a bounded number of
 * password checks at once; who changes an e-mail; and signing out that
 * keeps the state small.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { BUILD_MODE_REFUSAL, hashPassword, OWN_EMAIL_REFUSAL, REVOKED_SESSIONS_KEPT, ROLE_REFUSAL, SESSION_LIFETIME_MS, SITE_SETTINGS_REFUSAL, type AccountSession } from "@galley/core/install";
import type { PublishResult } from "@galley/core/types";
import { TOO_MANY_FOR_EMAIL, TOO_MANY_SIGN_INS } from "../src/accounts-routes";
import { signSession } from "../src/auth";
import { call, EDITOR, git, sandbox, siteRepository, startHosted, stopHosted, type Started } from "./hosted-helpers";

const box = sandbox("accounts-hardening");
const PASSWORD = "correct horse battery staple";

afterAll(() => box.cleanup(), 120_000);

async function withOwner(env: Record<string, string> = {}, home = box.folder("home")): Promise<Started & { owner: string; home: string }> {
  const started = await startHosted(box, home, { GALLEY_PUBLIC_URL: EDITOR, GALLEY_PASSWORD: PASSWORD, GALLEY_OWNER_NAME: "Sam Owner", GALLEY_OWNER_EMAIL: "sam@example.com", ...env });

  return { ...started, home, owner: await signIn(started.port, "sam@example.com") };
}

async function signIn(port: number, email?: string, password = PASSWORD, headers: Record<string, string> = {}): Promise<string> {
  const answer = await call(port, "POST", "/api/auth/login", { body: { password, ...(email !== undefined ? { email } : {}) }, headers });

  if (answer.status !== 200) throw new Error(`sign-in failed: ${answer.status} ${answer.text}`);
  return answer.cookies[0]!;
}

async function join_(port: number, owner: string, email: string, role: "owner" | "editor" | "contributor", name: string): Promise<{ id: string; cookie: string }> {
  const invited = await call(port, "POST", "/api/people/invitations", { cookie: owner, body: { email, role } });

  expect(invited.status, invited.text).toBe(200);
  const accepted = await call(port, "POST", "/api/auth/link", { body: { code: String(invited.body.link.url).split("#")[1], password: PASSWORD, name } });
  const cookie = accepted.cookies[0]!;

  return { id: (await call<AccountSession>(port, "GET", "/api/account", { cookie })).body.id, cookie };
}

const from = (address: string) => ({ "x-forwarded-for": address });
const state = (home: string) => JSON.parse(readFileSync(join(home, "install.json"), "utf8"));

describe("the site's settings file and build mode, by every route", () => {
  it("a contributor's and an editor's attempts are refused in plain words; an owner's work; a publish is the publisher's whoever opened the site", async () => {
    const bare = siteRepository(box);
    const started = await withOwner({ GALLEY_SITE_REPOSITORY: bare, GALLEY_SITE_ACCESS: "token", GALLEY_SITE_TOKEN: "fake-access-key-for-the-repository-0000" });
    const { port, owner, server } = started;

    await server.install!.idle();
    const siteId = server.install!.siteId()!;
    const folder = server.install!.siteFolder();
    const ed = await join_(port, owner, "ed@example.com", "editor", "Ed Editor");
    const cy = await join_(port, owner, "cy@example.com", "contributor", "Cy Contributor");
    const settings = () => readFileSync(join(folder, "galley.config.json"), "utf8");
    // The owner's request is the one that opens the site.
    const config = (await call(port, "GET", `/api/sites/${siteId}/config`, { cookie: owner })).body.config;
    const before = settings();
    const write = (cookie: string, path: string, mode: "content" | "build") => call(port, "PUT", `/api/sites/${siteId}/file?path=${encodeURIComponent(path)}`, { cookie, body: { content: '{ "name": "Changed", "dev": { "command": "node other.mjs" } }\n', mode } });

    for (const [who, cookie] of [["editor", ed.cookie], ["contributor", cy.cookie]] as const) {
      const attempts = [
        { answer: await call(port, "PUT", `/api/sites/${siteId}/config`, { cookie, body: { config: { ...config, name: "Changed" } } }), message: ROLE_REFUSAL },
        { answer: await write(cookie, "galley.config.json", "build"), message: who === "editor" ? SITE_SETTINGS_REFUSAL : BUILD_MODE_REFUSAL },
        { answer: await write(cookie, "GALLEY.CONFIG.JSON", "build"), message: who === "editor" ? SITE_SETTINGS_REFUSAL : BUILD_MODE_REFUSAL },
        { answer: await write(cookie, "galley.config.json", "content"), message: null },
        { answer: await call(port, "DELETE", `/api/sites/${siteId}/media?path=galley.config.json`, { cookie }), message: null },
      ];

      for (const { answer, message } of attempts) {
        expect(answer.status, `${who}: ${answer.text}`).toBeGreaterThanOrEqual(400);
        if (message) expect(answer.body.error.message, who).toBe(message);
      }
      expect(settings()).toBe(before);
    }
    // Build mode itself: asked for by a contributor, refused rather than written as content.
    const code = await write(cy.cookie, "src/components/Note.astro", "build");

    expect(code.status).toBe(403);
    expect(code.body.error.message).toBe(BUILD_MODE_REFUSAL);
    expect((await call(port, "PUT", `/api/sites/${siteId}/file?path=src%2Fcomponents%2FNote.astro`, { cookie: ed.cookie, body: { content: "<p>Note</p>\n", mode: "build" } })).status).toBe(200);
    // An owner's settings change, waiting: someone below the settings level can't discard it either.
    const saved = await call(port, "PUT", `/api/sites/${siteId}/config`, { cookie: owner, body: { config: { ...config, name: "Owner's name" } } });

    expect(saved.status, saved.text).toBe(200);
    expect((await call(port, "POST", `/api/sites/${siteId}/discard`, { cookie: cy.cookie, body: {} })).body.error.message).toBe(SITE_SETTINGS_REFUSAL);
    expect(settings()).toContain("Owner's name");
    // An editor publishes: the version is theirs, though the owner's request opened the site.
    const published = await call<PublishResult>(port, "POST", `/api/sites/${siteId}/publish`, { cookie: ed.cookie, body: { message: "Ed's publish", paths: ["src/components/Note.astro"] } });

    expect(published.body.ok, published.text).toBe(true);
    expect(git(folder, "log", "-1", "--format=%an <%ae>")).toBe("Ed Editor <ed@example.com>");
  }, 120_000);
});

describe("sign-in limits", () => {
  it("guesses from other addresses only slow a sign-in down: the right password still gets in", async () => {
    const { port } = await withOwner({ GALLEY_TRUST_PROXY: "1" });

    // 36 failures for Sam's e-mail, from twelve addresses: past the point where attempts are slowed.
    for (let i = 1; i <= 12; i += 1) {
      for (let j = 0; j < 3; j += 1) expect((await call(port, "POST", "/api/auth/login", { body: { email: "sam@example.com", password: "wrong wrong wrong" }, headers: from(`203.0.113.${i}`) })).status).toBe(401);
    }
    const started = Date.now();
    const right = await call(port, "POST", "/api/auth/login", { body: { email: "sam@example.com", password: PASSWORD }, headers: from("198.51.100.7") });

    expect(right.status, right.text).toBe(200);
    // Slowed: it waited its turn.
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  }, 120_000);

  it("the limits still stop one address: five a minute, and ten in fifteen minutes for one e-mail — the same for an e-mail nobody has", async () => {
    const { port, owner } = await withOwner({ GALLEY_TRUST_PROXY: "1" });

    await join_(port, owner, "ed@example.com", "editor", "Ed Editor");
    const attempt = (email: string, password: string, address: string) => call(port, "POST", "/api/auth/login", { body: { email, password }, headers: from(address) });

    for (let i = 0; i < 5; i += 1) expect((await attempt("sam@example.com", "wrong wrong wrong", "203.0.113.1")).status).toBe(401);
    const held = await attempt("sam@example.com", PASSWORD, "203.0.113.1");

    expect(held.status).toBe(429);
    expect(held.body.error.message).toBe(TOO_MANY_SIGN_INS);
    // Ten for one e-mail from one address (a sign-in to another account between them doesn't reset that count).
    for (const target of ["sam@example.com", "nobody@example.com"]) {
      const address = target === "sam@example.com" ? "203.0.113.2" : "203.0.113.3";

      for (let round = 0; round < 3; round += 1) {
        for (let i = 0; i < (round < 2 ? 4 : 2); i += 1) expect((await attempt(target, "wrong wrong wrong", address)).status).toBe(401);
        expect((await attempt("ed@example.com", PASSWORD, address)).status).toBe(200);
      }
    }
    const pair = await attempt("sam@example.com", PASSWORD, "203.0.113.2");
    const unknown = await attempt("nobody@example.com", "wrong wrong wrong", "203.0.113.3");

    expect(pair.status).toBe(429);
    expect(pair.body.error.message).toBe(TOO_MANY_FOR_EMAIL);
    expect(unknown.text).toBe(pair.text);
    // From anywhere else, the right password gets in at once.
    expect((await attempt("sam@example.com", PASSWORD, "203.0.113.9")).status).toBe(200);
  }, 120_000);

  it("the owner carried over from before accounts (no e-mail) is counted the same way", async () => {
    const home = box.folder("home");

    writeFileSync(
      join(home, "install.json"),
      JSON.stringify({ schema: 1, createdAt: "2026-10-01T10:00:00.000Z", password: { hash: await hashPassword(PASSWORD), changedAt: "2026-10-01T10:00:00.000Z" }, setup: { tokenSha256: null, finishedAt: null }, sessions: { validAfter: 0, revoked: [] }, site: null, liveUrl: null, pendingLiveUrl: null, lastBackupAt: null, seeded: ["password"] }),
      { mode: 0o600 }
    );
    const { port } = await startHosted(box, home, { GALLEY_PUBLIC_URL: EDITOR, GALLEY_TRUST_PROXY: "1" });

    for (let i = 1; i <= 8; i += 1) {
      for (let j = 0; j < 4; j += 1) expect((await call(port, "POST", "/api/auth/login", { body: { password: "wrong wrong wrong" }, headers: from(`203.0.113.${i}`) })).status).toBe(401);
    }
    const started = Date.now();

    expect((await call(port, "POST", "/api/auth/login", { body: { password: PASSWORD }, headers: from("198.51.100.7") })).status).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  }, 120_000);

  it("only a few passwords are checked at once: a flood beyond the short queue is told to wait, and the server keeps answering", async () => {
    const { port } = await withOwner({ GALLEY_TRUST_PROXY: "1" });
    const answers = await Promise.all(
      Array.from({ length: 60 }, (_, i) => call(port, "POST", "/api/auth/login", { body: { email: `person${i}@example.com`, password: "wrong wrong wrong" }, headers: from(`192.0.2.${i + 1}`) }))
    );
    const statuses = answers.map((answer) => answer.status);

    expect(statuses.every((status) => status === 401 || status === 429), statuses.join(",")).toBe(true);
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
    expect(answers.find((answer) => answer.status === 429)!.body.error.message).toBe(TOO_MANY_SIGN_INS);
    expect((await call(port, "GET", "/api/meta")).status).toBe(200);
    expect(await signIn(port, "sam@example.com", PASSWORD, from("198.51.100.8"))).toBeTruthy();
  }, 120_000);
});

describe("changing an e-mail", () => {
  it("is an owner's own, or done for someone else by an owner; it ends their open links; checking the password is limited per address", async () => {
    const { port, owner, logs } = await withOwner({ GALLEY_TRUST_PROXY: "1" });
    const ed = await join_(port, owner, "ed@example.com", "editor", "Ed Editor");

    await join_(port, owner, "cy@example.com", "contributor", "Cy Contributor");
    const own = await call(port, "PATCH", "/api/account", { cookie: ed.cookie, body: { email: "ed@elsewhere.example.com", password: PASSWORD } });

    expect(own.status).toBe(403);
    expect(own.body.error.message).toBe(OWN_EMAIL_REFUSAL);
    // Their own name is still theirs.
    expect((await call(port, "PATCH", "/api/account", { cookie: ed.cookie, body: { name: "Ed E." } })).status).toBe(200);
    // An owner changes it, with the same rules, and Ed's open link stops working.
    const link = await call(port, "POST", `/api/people/${ed.id}/password-link`, { cookie: owner });
    const code = String(link.body.url).split("#")[1];

    expect((await call(port, "PATCH", `/api/people/${ed.id}`, { cookie: owner, body: { email: "cy@example.com" } })).status).toBe(409);
    const changed = await call(port, "PATCH", `/api/people/${ed.id}`, { cookie: owner, body: { email: "Ed@Elsewhere.example.com" } });

    expect(changed.status, changed.text).toBe(200);
    expect(changed.body.email).toBe("ed@elsewhere.example.com");
    expect((await call(port, "POST", "/api/auth/link/check", { body: { code } })).status).toBe(404);
    expect(await signIn(port, "ed@elsewhere.example.com")).toBeTruthy();
    expect(logs.join("\n")).toContain("Sam Owner (Owner) changed the e-mail Ed E. (Editor) signs in with; their open links stopped working.");
    expect(logs.join("\n")).not.toContain("elsewhere.example.com");
    // The owner's own: the current password, five wrong tries a minute from one address.
    for (let i = 0; i < 5; i += 1) {
      const wrong = await call(port, "PATCH", "/api/account", { cookie: owner, body: { email: "sam@elsewhere.example.com", password: "not the password at all" }, headers: from("203.0.113.5") });

      expect(wrong.status).toBe(400);
    }
    expect((await call(port, "PATCH", "/api/account", { cookie: owner, body: { email: "sam@elsewhere.example.com", password: PASSWORD }, headers: from("203.0.113.5") })).status).toBe(429);
    expect((await call(port, "PATCH", "/api/account", { cookie: owner, body: { email: "sam@elsewhere.example.com", password: PASSWORD }, headers: from("203.0.113.6") })).status).toBe(200);
  }, 120_000);
});

describe("signing out", () => {
  it("writes a sign-out down only for a session that still counts, and only until it would have run out", async () => {
    const { port, owner, home, server } = await withOwner();
    const key = Buffer.from(readFileSync(join(home, "session.key"), "utf8").trim(), "hex");
    const cookie = (value: string) => `__Host-galley_session=${value}`;
    const ownerId = server.install!.people.list().accounts[0]!.id;
    const issued = Number(owner.split("=")[1]!.split(".")[0]);

    expect((await call(port, "POST", "/api/auth/logout", { cookie: owner })).status).toBe(200);
    const once = state(home).sessions.revoked;

    expect(once).toHaveLength(1);
    expect(once[0].until).toBe(issued + SESSION_LIFETIME_MS);
    // Again with the same cookie, with one for an account that doesn't exist, and with one from before this person's last sign-out everywhere.
    await call(port, "POST", "/api/auth/logout", { cookie: owner });
    await call(port, "POST", "/api/auth/logout", { cookie: cookie(signSession(key, Date.now(), undefined, "nobody-here")) });
    await call(port, "POST", "/api/auth/logout", { cookie: cookie(signSession(key, 1_000, undefined, ownerId)) });
    expect(state(home).sessions.revoked).toEqual(once);
  });

  it("with the list full, a sign-out ends that person's sessions by time; a longer list never stops the install from starting", async () => {
    const first = await withOwner();
    const at = Date.now();

    await stopHosted(box, first);
    const full = state(first.home);

    full.sessions.revoked = Array.from({ length: REVOKED_SESSIONS_KEPT }, (_, i) => ({ id: `gone-${i}`, until: at + 60 * 60_000 }));
    writeFileSync(join(first.home, "install.json"), JSON.stringify(full), { mode: 0o600 });
    const again = await withOwner({}, first.home);
    const other = await signIn(again.port, "sam@example.com");

    expect((await call(again.port, "POST", "/api/auth/logout", { cookie: again.owner })).status).toBe(200);
    expect(state(first.home).sessions.revoked).toHaveLength(REVOKED_SESSIONS_KEPT);
    // Every browser of Sam's was signed out instead.
    expect((await call(again.port, "GET", "/api/sites", { cookie: other })).status).toBe(401);
    await stopHosted(box, again);

    const over = state(first.home);

    over.sessions.revoked = Array.from({ length: REVOKED_SESSIONS_KEPT + 5 }, (_, i) => ({ id: `gone-${i}`, until: at + 60 * 60_000 }));
    writeFileSync(join(first.home, "install.json"), JSON.stringify(over), { mode: 0o600 });
    const trimmed = await withOwner({}, first.home);

    expect(trimmed.notices.join("\n")).toContain("so everyone was signed out once to shorten it");
    expect(state(first.home).sessions.revoked).toEqual([]);
    expect((await call(trimmed.port, "GET", "/api/sites", { cookie: trimmed.owner })).status).toBe(200);
  }, 120_000);
});
