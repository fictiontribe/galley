/**
 * Linking a signed-in person's own account to the identity provider, over
 * real HTTP against the provider that runs inside the test: the current
 * password through the sign-in gate, a fresh sign-in at the provider
 * (prompt=login, max_age=0, auth_time checked), a confirm page that shows
 * only a confirmed e-mail, and Connect with the session still that
 * account's. Nothing is bound before Connect; two accounts are never merged;
 * every link is logged naming the subject. And from a recovery session, the
 * provider taken off again (a wrong link put right).
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { PASSWORDS_OFF, type AccountSession } from "@galley/core/install";
import { call, EDITOR, sandbox, startHosted, type Started } from "./hosted-helpers";
import { startTestProvider, type TestProvider } from "./oidc-test-provider";

const box = sandbox("oidc-link");
const PASSWORD = "correct horse battery staple";
const CLIENT = "galley-test-client";
const SESSION = "__Host-galley_session";
const PRE_LOGIN = "__Host-galley_oidc";
const PENDING = "__Host-galley_oidc_link";
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

function editor(idp: TestProvider, env: Record<string, string> = {}, home = box.folder("home"), options: Parameters<typeof startHosted>[3] = {}): Promise<Started> {
  return startHosted(
    box,
    home,
    { GALLEY_PUBLIC_URL: EDITOR, GALLEY_PASSWORD: PASSWORD, GALLEY_OWNER_NAME: "Sam Owner", GALLEY_OWNER_EMAIL: "sam@example.com", GALLEY_OIDC_ISSUER: idp.issuer, GALLEY_OIDC_CLIENT_ID: CLIENT, GALLEY_TRUST_PROXY: "1", ...env },
    { oidcAllowLoopbackHttp: true, ...options }
  );
}

const cookieNamed = (cookies: string[], name: string) => cookies.find((cookie) => cookie.startsWith(`${name}=`));
const signedIn = async (port: number, cookie: string) => (await call(port, "GET", "/api/account", { cookie })).status === 200;

async function passwordSignIn(port: number, email = "sam@example.com"): Promise<string> {
  const answer = await call(port, "POST", "/api/auth/login", { body: { email, password: PASSWORD } });

  return cookieNamed(answer.cookies, SESSION)!;
}

/** Start a link with the password, go round the provider: the pending link cookie, or where the callback sent the browser. */
async function roundTrip(port: number, idp: TestProvider, session: string, password = PASSWORD): Promise<{ status: number; pending?: string; location?: string; error?: string }> {
  const start = await call(port, "POST", "/api/auth/oidc/link", { cookie: session, body: { password } });

  if (start.status !== 200) return { status: start.status, error: start.body?.error?.message };
  const back = new URL(await idp.authorize(start.body.url));
  const done = await call(port, "GET", `${back.pathname}${back.search}`, { cookie: cookieNamed(start.cookies, PRE_LOGIN)! });
  const pending = cookieNamed(done.cookies, PENDING);

  return { status: 200, location: String(done.headers.location), ...(pending ? { pending } : {}) };
}

describe("linking your account in the app", () => {
  it("with the password, a fresh sign-in at the provider and Connect: the subject is bound, the password and old links gone, every session ended, this browser a provider session", async () => {
    const idp = await provider();
    const { port, server, logs } = await editor(idp);
    const sam = await passwordSignIn(port);
    const elsewhere = await passwordSignIn(port);
    const samId = server.install!.people.list().accounts[0]!.id;
    // A new-password link made before Connect.
    const forgot = await server.install!.people.passwordLink(samId, samId);

    idp.user = { sub: "sam-at-provider", name: "Samuel", email: "sam@corp.example", email_verified: true, galley_role: "owner" };
    const trip = await roundTrip(port, idp, sam);

    // The provider was asked to sign whoever is at the keyboard in again.
    expect([idp.lastAuthorize!.get("prompt"), idp.lastAuthorize!.get("max_age")]).toEqual(["login", "0"]);
    // The callback ends on the confirm page: the code is gone from the address bar, and nothing is bound yet.
    expect(trip.location).toBe("/account/connect");
    expect(server.install!.store.account(samId)!.identity).toBeUndefined();
    const both = `${sam}; ${trip.pending}`;
    const view = await call(port, "GET", "/api/auth/oidc/link/pending", { cookie: both });

    expect(view.body).toEqual({ provider: "127.0.0.1", email: "sam@corp.example", name: "Samuel", subject: "sam-at-provider", expiresAt: expect.any(String) });
    const connected = await call(port, "POST", "/api/auth/oidc/link/confirm", { cookie: both, body: { connect: true } });

    expect(connected.status, connected.text).toBe(200);
    const stored = server.install!.store.account(samId)!;

    expect(stored).toMatchObject({ identity: { issuer: idp.issuer, subject: "sam-at-provider" }, passwordHash: null });
    const fresh = cookieNamed(connected.cookies, SESSION)!;

    expect((await call<AccountSession>(port, "GET", "/api/account", { cookie: fresh })).body).toMatchObject({ id: samId, viaProvider: true });
    expect((await call(port, "GET", "/api/meta", { cookie: fresh })).body.account.sessionKind).toBe("provider");
    expect([await signedIn(port, sam), await signedIn(port, elsewhere)]).toEqual([false, false]);
    expect(setCookieOf(connected.headers, PENDING)).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    expect((await call(port, "POST", "/api/auth/link", { body: { code: forgot.link.code, password: "a brand new long password" } })).status).toBe(404);
    expect((await call(port, "POST", "/api/auth/login", { body: { email: "sam@example.com", password: PASSWORD } })).status).toBe(401);
    expect(logs.join("\n")).toContain(`Security: Sam Owner (Owner) linked their account to subject sam-at-provider at ${idp.issuer}`);
    // Signing in through the provider now finds that account.
    const start = await call(port, "GET", "/api/auth/oidc/start", { headers: { "x-forwarded-for": "198.51.100.90" } });
    const back = new URL(await idp.authorize(String(start.headers.location)));
    const done = await call(port, "GET", `${back.pathname}${back.search}`, { cookie: cookieNamed(start.cookies, PRE_LOGIN)!, headers: { "x-forwarded-for": "198.51.100.90" } });

    expect((await call<AccountSession>(port, "GET", "/api/account", { cookie: cookieNamed(done.cookies, SESSION)! })).body.id).toBe(samId);
  });

  it("an e-mail the provider hasn't confirmed isn't shown; Cancel, or ten minutes, binds nothing", async () => {
    const idp = await provider();
    const { port, server } = await editor(idp);
    const sam = await passwordSignIn(port);
    const samId = server.install!.people.list().accounts[0]!.id;

    idp.user = { sub: "unconfirmed", name: "Someone", email: "claimed@example.com", email_verified: false, galley_role: "owner" };
    const trip = await roundTrip(port, idp, sam);
    const both = `${sam}; ${trip.pending}`;

    expect((await call(port, "GET", "/api/auth/oidc/link/pending", { cookie: both })).body).toMatchObject({ email: null, name: "Someone", subject: "unconfirmed" });
    expect((await call(port, "POST", "/api/auth/oidc/link/confirm", { cookie: both, body: { connect: false } })).status).toBe(200);
    expect(server.install!.store.account(samId)!.identity).toBeUndefined();
    const later = await roundTrip(port, idp, sam);
    const real = Date.now;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => real() + 11 * 60_000);

    try {
      // The session is good for its 30 days; the link waited too long.
      expect((await call(port, "POST", "/api/auth/oidc/link/confirm", { cookie: `${sam}; ${later.pending}`, body: { connect: true } })).status).toBe(404);
    } finally {
      clock.mockRestore();
    }
    expect((await call(port, "POST", "/api/auth/oidc/link/confirm", { cookie: `${sam}; ${later.pending}`, body: { connect: false } })).status).toBe(200);
    expect(server.install!.store.account(samId)!.passwordHash).not.toBeNull();
  });

  it("refuses: a wrong password (as a password change would), a provider that didn't ask again (old auth_time), another session at Connect, and another account's or a removed subject", async () => {
    const idp = await provider();
    const { port, server, logs } = await editor(idp);
    const sam = await passwordSignIn(port);
    const install = server.install!;
    const samId = install.people.list().accounts[0]!.id;
    const wrong = await roundTrip(port, idp, sam, "not the password at all");

    expect([wrong.status, wrong.error]).toEqual([400, "That isn't your current password."]);
    expect(logs.join("\n")).toContain("Linking to 127.0.0.1 for Sam Owner (Owner) from 127.0.0.1 was refused: the current password was wrong.");
    // The provider ignored prompt=login: a session it already had, from before the link started.
    idp.wrong = { claims: { auth_time: Math.floor(Date.now() / 1000) - 300 } };
    const stale = await roundTrip(port, idp, sam);

    expect(stale.location).toBe("/account?link=link-stale");
    expect(stale.pending).toBeUndefined();
    idp.wrong = {};
    // Ed signs in in this browser between the round trip and Connect.
    await install.people.useLink((await install.people.invite(samId, { email: "ed@example.com", role: "editor" })).link.code, { password: PASSWORD, name: "Ed" });
    const ed = await passwordSignIn(port, "ed@example.com");
    const trip = await roundTrip(port, idp, sam);
    const swapped = await call(port, "POST", "/api/auth/oidc/link/confirm", { cookie: `${ed}; ${trip.pending}`, body: { connect: true } });

    expect(swapped.status).toBe(403);
    expect(install.store.account(samId)!.identity).toBeUndefined();
    // A subject that has an account of its own here: never merged.
    idp.user = { sub: "taken", name: "Tess", galley_role: "editor" };
    const start = await call(port, "GET", "/api/auth/oidc/start", { headers: { "x-forwarded-for": "198.51.100.91" } });
    const back = new URL(await idp.authorize(String(start.headers.location)));

    await call(port, "GET", `${back.pathname}${back.search}`, { cookie: cookieNamed(start.cookies, PRE_LOGIN)!, headers: { "x-forwarded-for": "198.51.100.91" } });
    const takenTrip = await roundTrip(port, idp, sam);
    const merged = await call(port, "POST", "/api/auth/oidc/link/confirm", { cookie: `${sam}; ${takenTrip.pending}`, body: { connect: true } });

    expect([merged.status, merged.body.error.message]).toEqual([409, expect.stringMatching(/already has its own account here.*never merged/)]);
    // A removed subject.
    await install.store.update((draft) => {
      draft.tombstones.push({ id: "gone", issuer: idp.issuer, subject: "removed-one", removedAt: new Date().toISOString(), removedBy: null });
    });
    idp.user = { sub: "removed-one", name: "Gone", galley_role: "editor" };
    const removedTrip = await roundTrip(port, idp, sam);

    expect((await call(port, "POST", "/api/auth/oidc/link/confirm", { cookie: `${sam}; ${removedTrip.pending}`, body: { connect: true } })).status).toBe(409);
    expect(install.store.account(samId)).toMatchObject({ passwordHash: expect.any(String) });
    expect(install.store.account(samId)!.identity).toBeUndefined();
  });

  it("is a same-origin request only: from another origin, or the preview's hostname, it is refused", async () => {
    const idp = await provider();
    const { port } = await editor(idp);
    const sam = await passwordSignIn(port);

    for (const origin of ["https://evil.example", "https://preview.cms.localhost", null]) {
      const answer = await call(port, "POST", "/api/auth/oidc/link", { cookie: sam, body: { password: PASSWORD }, origin, headers: origin === null ? { "sec-fetch-site": "same-site" } : {} });

      expect(answer.status, String(origin)).toBe(403);
    }
  });

  it("with passwords off, linking in the app is refused; the server's command is the way", async () => {
    const idp = await provider();
    const home = box.folder("home");

    await (await editor(idp, {}, home)).server.close();
    const off = await editor(idp, { GALLEY_OIDC_ONLY: "1" }, home, { resetPassword: true });
    const used = await call(off.port, "POST", "/api/auth/link", { body: { code: off.server.passwordLink!.url.split("#")[1] } });
    const answer = await call(off.port, "POST", "/api/auth/oidc/link", { cookie: cookieNamed(used.cookies, SESSION)!, body: { password: PASSWORD } });

    expect(answer.status).toBe(403);
    expect(answer.body.error.message).toContain(PASSWORDS_OFF);
  });
});

describe("a wrong link put right from a recovery session", () => {
  it("the provider taken off and a password chosen; only from a recovery session, and never with passwords off", async () => {
    const idp = await provider();
    const home = box.folder("home");
    const first = await editor(idp, {}, home);
    const samId = first.server.install!.people.list().accounts[0]!.id;

    // Sam's account was linked to someone else's subject (a phished password, say).
    await first.server.install!.people.linkIdentity(samId, { issuer: idp.issuer, subject: "not-sam" });
    idp.user = { sub: "not-sam", name: "Not Sam", galley_role: "owner" };
    const start = await call(first.port, "GET", "/api/auth/oidc/start", { headers: { "x-forwarded-for": "198.51.100.92" } });
    const back = new URL(await idp.authorize(String(start.headers.location)));
    const intruder = cookieNamed((await call(first.port, "GET", `${back.pathname}${back.search}`, { cookie: cookieNamed(start.cookies, PRE_LOGIN)!, headers: { "x-forwarded-for": "198.51.100.92" } })).cookies, SESSION)!;
    // From a provider session: refused.
    const fromProvider = await call(first.port, "POST", "/api/account/identity/remove", { cookie: intruder, body: { password: "a brand new long password" } });

    expect(fromProvider.status).toBe(403);
    await first.server.close();
    const reset = await editor(idp, {}, home, { resetPassword: true });
    const recovered = await call(reset.port, "POST", "/api/auth/link", { body: { code: reset.server.passwordLink!.url.split("#")[1] } });
    const recovery = cookieNamed(recovered.cookies, SESSION)!;

    expect((await call(reset.port, "GET", "/api/meta", { cookie: recovery })).body.account).toMatchObject({ viaProvider: true, sessionKind: "recovery" });
    const removed = await call(reset.port, "POST", "/api/account/identity/remove", { cookie: recovery, body: { password: "sam's own new password" } });

    expect(removed.status, removed.text).toBe(200);
    expect(reset.server.install!.store.account(samId)!.identity).toBeUndefined();
    expect(await signedIn(reset.port, intruder)).toBe(false);
    expect(await signedIn(reset.port, cookieNamed(removed.cookies, SESSION)!)).toBe(true);
    // The intruder's sign-in had set the account's e-mail as the provider sent it (none): the password alone signs Sam in now.
    expect(reset.server.install!.store.account(samId)!.email).toBe("");
    expect((await call(reset.port, "POST", "/api/auth/login", { body: { password: "sam's own new password" } })).status).toBe(200);
    // Named as the account is now (the provider's sign-in had renamed it), with the subject taken off.
    expect(reset.logs.join("\n")).toMatch(/Security: Not Sam \(Owner\) took subject not-sam at .* off their account from a recovery session/);
    await reset.server.close();
    // With passwords off: refused.
    await (async () => {
      const store = (await editor(idp, {}, home)).server;

      await store.install!.people.linkIdentity(samId, { issuer: idp.issuer, subject: "sam-again" });
      await store.close();
    })();
    const off = await editor(idp, { GALLEY_OIDC_ONLY: "1" }, home, { resetPassword: true });
    const offRecovery = cookieNamed((await call(off.port, "POST", "/api/auth/link", { body: { code: off.server.passwordLink!.url.split("#")[1] } })).cookies, SESSION)!;
    const refused = await call(off.port, "POST", "/api/account/identity/remove", { cookie: offRecovery, body: { password: "a brand new long password" } });

    expect([refused.status, refused.body.error.message]).toEqual([403, expect.stringContaining(PASSWORDS_OFF)]);
  });
});

describe("People, for someone who signs in through the provider", () => {
  it("owners see their subject; their e-mail isn't the owner's to change; they are removed by switching off, and deleted after that, remembered as removed", async () => {
    const idp = await provider();
    const { port, server } = await editor(idp);
    const sam = await passwordSignIn(port);

    idp.user = { sub: "robin-sub", name: "Robin", email: "robin@corp.example", email_verified: true, galley_role: "editor" };
    const start = await call(port, "GET", "/api/auth/oidc/start", { headers: { "x-forwarded-for": "198.51.100.93" } });
    const back = new URL(await idp.authorize(String(start.headers.location)));

    await call(port, "GET", `${back.pathname}${back.search}`, { cookie: cookieNamed(start.cookies, PRE_LOGIN)!, headers: { "x-forwarded-for": "198.51.100.93" } });
    const list = (await call(port, "GET", "/api/people", { cookie: sam })).body;
    const robin = list.accounts.find((one: { name: string }) => one.name === "Robin");

    expect(robin.subject).toBe("robin-sub");
    expect(list.accounts.find((one: { name: string }) => one.name === "Sam Owner").subject).toBeUndefined();
    const email = await call(port, "PATCH", `/api/people/${robin.id}`, { cookie: sam, body: { email: "other@example.com" } });

    expect([email.status, email.body.error.message]).toEqual([409, expect.stringMatching(/e-mail comes from 127\.0\.0\.1/)]);
    const early = await call(port, "DELETE", `/api/people/${robin.id}`, { cookie: sam });

    expect([early.status, early.body.error.message]).toEqual([409, expect.stringMatching(/^Switch this person off first/)]);
    expect((await call(port, "PATCH", `/api/people/${robin.id}`, { cookie: sam, body: { disabled: true } })).status).toBe(200);
    expect((await call(port, "DELETE", `/api/people/${robin.id}`, { cookie: sam })).status).toBe(200);
    expect(server.install!.store.read().tombstones).toEqual([expect.objectContaining({ subject: "robin-sub" })]);
  });
});

function setCookieOf(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  return ([headers["set-cookie"] ?? []].flat() as string[]).find((line) => line.startsWith(`${name}=`));
}
