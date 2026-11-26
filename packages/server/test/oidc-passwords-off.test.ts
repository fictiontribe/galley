/**
 * Passwords off (GALLEY_OIDC_ONLY) and the mixed-mode rules, over real HTTP
 * against the provider that runs inside the test: what is refused, the one
 * way back in (`serve --reset-password`, a link that signs in without a
 * password and starts a recovery session), sessions from before the switch
 * refused when read and staying refused after it, links dropped at the
 * switch, choosing the owner to let back in, and the log kept quiet.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PASSWORDS_OFF, type AccountSession } from "@galley/core/install";
import { readSession } from "../src/auth";
import { call, EDITOR, sandbox, startHosted, type Started } from "./hosted-helpers";
import { startTestProvider, type TestProvider } from "./oidc-test-provider";

const box = sandbox("oidc-passwords-off");
const PASSWORD = "correct horse battery staple";
const CLIENT = "galley-test-client";
const TOKEN = "an-operator-token-for-scripts-0000";
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

const cookieNamed = (cookies: string[], name: string) => cookies.find((cookie) => cookie.startsWith(`${name}=`));
let addresses = 0;

/** An editor on `home` with this provider; `only` turns passwords off. */
function editor(idp: TestProvider, home: string, env: Record<string, string> = {}, options: Parameters<typeof startHosted>[3] = {}): Promise<Started> {
  return startHosted(box, home, { GALLEY_PUBLIC_URL: EDITOR, GALLEY_OIDC_ISSUER: idp.issuer, GALLEY_OIDC_CLIENT_ID: CLIENT, GALLEY_TOKEN: TOKEN, GALLEY_TRUST_PROXY: "1", ...env }, { oidcAllowLoopbackHttp: true, ...options });
}

/** A sign-in through the provider, as a browser would: the session cookie, or undefined. */
async function signIn(port: number, idp: TestProvider): Promise<string | undefined> {
  const headers = { "x-forwarded-for": `198.51.100.${(addresses = (addresses % 250) + 1)}` };
  const start = await call(port, "GET", "/api/auth/oidc/start", { headers });
  const back = new URL(await idp.authorize(String(start.headers.location)));
  const done = await call(port, "GET", `${back.pathname}${back.search}`, { cookie: cookieNamed(start.cookies, PRE_LOGIN)!, headers });

  return cookieNamed(done.cookies, SESSION);
}

const keyOf = (home: string) => Buffer.from(readFileSync(join(home, "session.key"), "utf8").trim(), "hex");
const linkCode = (started: Started) => started.server.passwordLink!.url.split("#")[1]!;

describe("passwords off", () => {
  it("refuse every password way in, in a sentence; the sign-in screen has the provider's button alone", async () => {
    const idp = await provider();
    const home = box.folder("home");

    // An install set up with a password first: Sam is its owner; Pat comes through the provider and is made an owner.
    await (await editor(idp, home, { GALLEY_PASSWORD: PASSWORD, GALLEY_OWNER_NAME: "Sam Owner", GALLEY_OWNER_EMAIL: "sam@example.com" })).server.close();
    const off = await editor(idp, home, { GALLEY_OIDC_ONLY: "1", GALLEY_PASSWORD: PASSWORD });
    const { port, notices } = off;

    expect(notices.join("\n")).toContain("GALLEY_PASSWORD is ignored: passwords are off on this editor (GALLEY_OIDC_ONLY).");
    expect((await call(port, "GET", "/api/meta")).body.install.signInWith).toBe("provider");
    idp.user = { sub: "pat", name: "Pat", galley_role: "owner" };
    const pat = (await signIn(port, idp))!;
    const sam = off.server.install!.people.list().accounts.find((account) => account.email === "sam@example.com")!;
    const refusals = [
      await call(port, "POST", "/api/auth/login", { body: { email: "sam@example.com", password: PASSWORD } }),
      await call(port, "POST", "/api/auth/forgot", { body: { email: "sam@example.com" } }),
      await call(port, "POST", "/api/people/invitations", { cookie: pat, body: { email: "cy@example.com", role: "editor" } }),
      await call(port, "POST", `/api/people/${sam.id}/password-link`, { cookie: pat }),
      await call(port, "POST", "/api/setup/password", { bearer: TOKEN, body: { password: "a brand new long password" } }),
    ];

    for (const answer of refusals) {
      expect(answer.status, answer.text).toBe(403);
      expect(answer.body.error.message).toContain(PASSWORDS_OFF);
    }
    expect(refusals[4]!.body.error.message).toContain("GALLEY_OIDC_OWNER");
    expect(off.server.install!.store.read().links).toEqual([]);
  });

  it("a password session from before the switch is refused at once, and stays refused when passwords are on again; a provider session survives a restart", async () => {
    const idp = await provider();
    const home = box.folder("home");
    const mixed = await editor(idp, home, { GALLEY_PASSWORD: PASSWORD, GALLEY_OWNER_NAME: "Sam Owner", GALLEY_OWNER_EMAIL: "sam@example.com" });
    const before = cookieNamed((await call(mixed.port, "POST", "/api/auth/login", { body: { email: "sam@example.com", password: PASSWORD } })).cookies, SESSION)!;
    const viaProvider = (await signIn(mixed.port, idp))!;

    expect((await call(mixed.port, "GET", "/api/account", { cookie: before })).status).toBe(200);
    await mixed.server.close();
    const off = await editor(idp, home, { GALLEY_OIDC_ONLY: "1" });
    const store = off.server.install!.store;
    const session = readSession(keyOf(home), before.split("=")[1])!;

    expect((await call(off.port, "GET", "/api/account", { cookie: before })).status).toBe(401);
    // Whoever reads it: an open stream, the preview's viewer value and an extension all ask this.
    expect(store.sessionValid(session)).toBe(false);
    expect(store.read().oidcOnlySince).toEqual(expect.any(Number));
    expect((await call(off.port, "GET", "/api/account", { cookie: viaProvider })).status).toBe(200);
    await off.server.close();
    // Passwords on again: the old password session stays refused; a new one works.
    const on = await editor(idp, home, { GALLEY_OIDC_ONLY: "0" });

    expect((await call(on.port, "GET", "/api/account", { cookie: before })).status).toBe(401);
    const fresh = await call(on.port, "POST", "/api/auth/login", { body: { email: "sam@example.com", password: PASSWORD } });

    expect(fresh.status).toBe(200);
    expect((await call(on.port, "GET", "/api/account", { cookie: cookieNamed(fresh.cookies, SESSION)! })).status).toBe(200);
    expect((await call(on.port, "GET", "/api/account", { cookie: viaProvider })).status).toBe(200);
    await on.server.close();
    // Off once more: that new password session is refused too, though it came after the first switch.
    const offAgain = await editor(idp, home, { GALLEY_OIDC_ONLY: "1" });

    expect((await call(offAgain.port, "GET", "/api/account", { cookie: cookieNamed(fresh.cookies, SESSION)! })).status).toBe(401);
  });

  it("a \"forgot\" link and an invitation made before the switch stop working at it; the server's own link is kept", async () => {
    const idp = await provider();
    const home = box.folder("home");
    const mixed = await editor(idp, home, { GALLEY_PASSWORD: PASSWORD, GALLEY_OWNER_NAME: "Sam Owner", GALLEY_OWNER_EMAIL: "sam@example.com" });
    const sam = cookieNamed((await call(mixed.port, "POST", "/api/auth/login", { body: { email: "sam@example.com", password: PASSWORD } })).cookies, SESSION)!;
    // Ed, with a password, and a new-password link for him; and an invitation still open.
    const forEd = String((await call(mixed.port, "POST", "/api/people/invitations", { cookie: sam, body: { email: "ed@example.com", role: "editor" } })).body.link.url).split("#")[1]!;

    await call(mixed.port, "POST", "/api/auth/link", { body: { code: forEd, password: PASSWORD, name: "Ed" } });
    const invitation = String((await call(mixed.port, "POST", "/api/people/invitations", { cookie: sam, body: { email: "cy@example.com", role: "editor" } })).body.link.url).split("#")[1]!;
    const edId = mixed.server.install!.people.list().accounts.find((account) => account.name === "Ed")!.id;
    const forgot = String((await call(mixed.port, "POST", `/api/people/${edId}/password-link`, { cookie: sam })).body.url).split("#")[1]!;

    await mixed.server.close();
    const reset = await editor(idp, home, {}, { resetPassword: true });

    await reset.server.close();
    const off = await editor(idp, home, { GALLEY_OIDC_ONLY: "1" });

    expect(off.notices.join("\n")).toMatch(/the 2 open invitations and new-password links stopped working/);
    for (const code of [invitation, forgot]) expect((await call(off.port, "POST", "/api/auth/link/check", { body: { code } })).status).toBe(404);
    expect((await call(off.port, "POST", "/api/auth/link/check", { body: { code: linkCode(reset) } })).body.kind).toBe("sign-in");
  });
});

describe("the way back in: serve --reset-password", () => {
  it("with passwords off, signs an owner in without a password, with a recovery session as long as the provider's, and sets none", async () => {
    const idp = await provider();
    const home = box.folder("home");

    await (await editor(idp, home, { GALLEY_PASSWORD: PASSWORD, GALLEY_OWNER_NAME: "Sam Owner", GALLEY_OWNER_EMAIL: "sam@example.com" })).server.close();
    const off = await editor(idp, home, { GALLEY_OIDC_ONLY: "1", GALLEY_OIDC_SESSION_HOURS: "2" }, { resetPassword: true });
    const before = off.server.install!.store.read().accounts[0]!;
    const code = linkCode(off);

    expect((await call(off.port, "POST", "/api/auth/link/check", { body: { code } })).body).toMatchObject({ kind: "sign-in", email: "sam@example.com" });
    // A password sent along is not set.
    const used = await call(off.port, "POST", "/api/auth/link", { body: { code, password: "an attempt to set one here" } });

    expect(used.status, used.text).toBe(200);
    const session = readSession(keyOf(home), cookieNamed(used.cookies, SESSION)!.split("=")[1])!;

    expect(session.kind).toBe("recovery");
    expect(session.expiresAt - session.issuedAt).toBe(2 * 60 * 60_000);
    expect(cookieNamed(used.cookies, `${SESSION}_known`)).toBeUndefined();
    expect((await call(off.port, "GET", "/api/account", { cookie: cookieNamed(used.cookies, SESSION)! })).status).toBe(200);
    expect(off.server.install!.store.read().accounts[0]!.passwordHash).toBe(before.passwordHash);
    expect(off.logs.join("\n")).toContain("Sam Owner (Owner) signed in with the link `serve --reset-password` made");
    // Used once.
    expect((await call(off.port, "POST", "/api/auth/link", { body: { code } })).status).toBe(404);
  });

  it("names the owner by --account or --subject; with several and none named, it lists them on the console to choose from", async () => {
    const idp = await provider();
    const home = box.folder("home");
    const first = await editor(idp, home, { GALLEY_OIDC_OWNER: "owner-one" });

    idp.user = { sub: "owner-one", name: "Una", galley_role: "owner" };
    await signIn(first.port, idp);
    idp.user = { sub: "owner-two", name: "Tom", galley_role: "owner" };
    await signIn(first.port, idp);
    const [una, tom] = first.server.install!.people.list().accounts;

    await first.server.close();
    // The provider down, passwords off: the one way in.
    idp.wrong = { discoveryStatus: 503 };
    await expect(editor(idp, home, { GALLEY_OIDC_ONLY: "1" }, { resetPassword: true })).rejects.toThrow(
      new RegExp(`has 2 owners.*--subject <subject>:\\n  ${una!.id}  subject owner-one  Una\\n  ${tom!.id}  subject owner-two  Tom`, "s")
    );
    const bySubject = await editor(idp, home, { GALLEY_OIDC_ONLY: "1" }, { resetPassword: true, resetPasswordSubject: "owner-two" });

    expect(bySubject.server.passwordLink!.name).toBe("Tom");
    await bySubject.server.close();
    const byAccount = await editor(idp, home, { GALLEY_OIDC_ONLY: "1" }, { resetPassword: true, resetPasswordAccount: una!.id });

    expect(byAccount.server.passwordLink!.name).toBe("Una");
    const used = await call(byAccount.port, "POST", "/api/auth/link", { body: { code: linkCode(byAccount) } });

    expect((await call<AccountSession>(byAccount.port, "GET", "/api/account", { cookie: cookieNamed(used.cookies, SESSION)! })).body.name).toBe("Una");
    await byAccount.server.close();
    await expect(editor(idp, home, { GALLEY_OIDC_ONLY: "1" }, { resetPassword: true, resetPasswordSubject: "nobody" })).rejects.toThrow(/No owner of this editor signs in through the identity provider with that subject/);
    idp.wrong = {};
  });

  it("in mixed mode: for an owner who signs in through the provider, the link signs them in and leaves no password; a password owner chooses one as before", async () => {
    const idp = await provider();
    const home = box.folder("home");
    const mixed = await editor(idp, home, { GALLEY_PASSWORD: PASSWORD, GALLEY_OWNER_NAME: "Sam Owner", GALLEY_OWNER_EMAIL: "sam@example.com" });

    idp.user = { sub: "pat", name: "Pat", galley_role: "owner" };
    await signIn(mixed.port, idp);
    const pat = mixed.server.install!.people.list().accounts.find((account) => account.name === "Pat")!;

    await mixed.server.close();
    const forPat = await editor(idp, home, {}, { resetPassword: true, resetPasswordAccount: pat.id });
    const code = linkCode(forPat);

    expect((await call(forPat.port, "POST", "/api/auth/link/check", { body: { code } })).body.kind).toBe("sign-in");
    expect((await call(forPat.port, "POST", "/api/auth/link", { body: { code } })).status).toBe(200);
    expect(forPat.server.install!.store.account(pat.id)!.passwordHash).toBeNull();
    await forPat.server.close();
    const forSam = await editor(idp, home, {}, { resetPassword: true, resetPasswordEmail: "sam@example.com" });

    expect((await call(forSam.port, "POST", "/api/auth/link/check", { body: { code: linkCode(forSam) } })).body.kind).toBe("password");
    expect((await call(forSam.port, "POST", "/api/auth/link", { body: { code: linkCode(forSam) } })).status).toBe(400);
  });
});

describe("starting with passwords off", () => {
  it("refuses GALLEY_PASSWORD on an install with no owner; without GALLEY_OIDC_OWNER it says what is missing", async () => {
    const idp = await provider();

    await expect(editor(idp, box.folder("home"), { GALLEY_OIDC_ONLY: "1", GALLEY_PASSWORD: PASSWORD })).rejects.toThrow(/can't choose the first owner with GALLEY_OIDC_ONLY/);
    const bare = await editor(idp, box.folder("home"), { GALLEY_OIDC_ONLY: "1" });

    expect(bare.notices.join("\n")).toContain("Name the first owner by their subject at the identity provider with GALLEY_OIDC_OWNER");
    await expect(editor(idp, box.folder("home"), { GALLEY_OIDC_ONLY: "yes" })).rejects.toThrow(/GALLEY_OIDC_ONLY must be 1/);
  });
});

describe("the log, kept quiet", () => {
  it("a refusal that counts nothing is written once a minute for each client", async () => {
    const idp = await provider();
    const { port, logs } = await editor(idp, box.folder("home"), { GALLEY_PASSWORD: PASSWORD, GALLEY_OWNER_NAME: "Sam Owner", GALLEY_OWNER_EMAIL: "sam@example.com" });
    const refused = () => logs.filter((line) => line.includes("was refused: no sign-in was started in this browser"));

    for (let i = 0; i < 6; i += 1) await call(port, "GET", "/api/auth/oidc/callback", { headers: { "x-forwarded-for": "203.0.113.40" } });
    expect(refused()).toHaveLength(1);
    await call(port, "GET", "/api/auth/oidc/callback", { headers: { "x-forwarded-for": "203.0.113.41" } });
    expect(refused()).toHaveLength(2);
  });
});
