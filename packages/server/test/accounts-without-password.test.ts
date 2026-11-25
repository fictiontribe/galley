/**
 * A hosted install over real HTTP with accounts that have no password (as an
 * account that signs in through an identity provider will have): signing in
 * with a password, changing one, and changing an e-mail with one are refused
 * in plain words, the password limits aren't touched by any of it, and their
 * sessions still count.
 */
import { afterAll, describe, expect, it } from "vitest";
import { NO_PASSWORD_FOR_EMAIL, NO_PASSWORD_TO_CHANGE, OWN_EMAIL_REFUSAL, type AccountSession } from "@galley/core/install";
import { SIGN_IN_REFUSED } from "../src/accounts-routes";
import { call, EDITOR, sandbox, startHosted, type Started } from "./hosted-helpers";

const box = sandbox("accounts-without-password");
const PASSWORD = "correct horse battery staple";
const from = (address: string) => ({ "x-forwarded-for": address });

afterAll(() => box.cleanup(), 120_000);

async function signIn(port: number, email: string, password = PASSWORD): Promise<string> {
  const answer = await call(port, "POST", "/api/auth/login", { body: { password, email } });

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

/** Takes the password away from these accounts and gives them an identity, as signing in through a provider will. */
async function withoutPasswords(started: Started, ids: string[]): Promise<void> {
  await started.server.install!.store.update((draft) => {
    for (const account of draft.accounts.filter((one) => ids.includes(one.id))) {
      account.passwordHash = null;
      account.identity = { issuer: "https://id.example.com", subject: `subject-${account.id}` };
    }
  });
}

describe("an account with no password", () => {
  it("is refused a password sign-in, a password change and an e-mail change in plain words; none of it counts against the limits; its session still counts", async () => {
    const started = await startHosted(box, box.folder("home"), { GALLEY_PUBLIC_URL: EDITOR, GALLEY_PASSWORD: PASSWORD, GALLEY_OWNER_NAME: "Sam Owner", GALLEY_OWNER_EMAIL: "sam@example.com", GALLEY_TRUST_PROXY: "1" });
    const { port, logs } = started;
    const owner = await signIn(port, "sam@example.com");
    const ed = await join_(port, owner, "ed@example.com", "editor", "Ed Editor");
    const olive = await join_(port, owner, "olive@example.com", "owner", "Olive Owner");

    await withoutPasswords(started, [ed.id, olive.id]);
    // Their sessions from before are still theirs.
    expect((await call<AccountSession>(port, "GET", "/api/account", { cookie: ed.cookie })).body.email).toBe("ed@example.com");
    // A password sign-in: the same answer as a wrong password, and the log says why.
    const signIn_ = await call(port, "POST", "/api/auth/login", { body: { email: "ed@example.com", password: PASSWORD }, headers: from("198.51.100.20") });

    expect(signIn_.status).toBe(401);
    expect(signIn_.body.error.message).toBe(SIGN_IN_REFUSED);
    expect(logs.join("\n")).toContain("A sign-in to Ed Editor (Editor) from 198.51.100.20 failed: the account has no password.");
    // Changing a password, and an owner changing their own e-mail: refused every time, never "too many attempts".
    for (let i = 0; i < 7; i += 1) {
      const change = await call(port, "POST", "/api/account/password", { cookie: ed.cookie, body: { current: PASSWORD, next: "a brand new long password" }, headers: from("203.0.113.5") });

      expect(change.status, change.text).toBe(400);
      expect(change.body.error.message).toBe(NO_PASSWORD_TO_CHANGE);
      const email = await call(port, "PATCH", "/api/account", { cookie: olive.cookie, body: { email: "olive@elsewhere.example.com", password: PASSWORD }, headers: from("203.0.113.5") });

      expect(email.status, email.text).toBe(400);
      expect(email.body.error.message).toBe(NO_PASSWORD_FOR_EMAIL);
    }
    // Someone who isn't an owner is refused by the rule they always were.
    const own = await call(port, "PATCH", "/api/account", { cookie: ed.cookie, body: { email: "ed@elsewhere.example.com", password: PASSWORD }, headers: from("203.0.113.5") });

    expect(own.status).toBe(403);
    expect(own.body.error.message).toBe(OWN_EMAIL_REFUSAL);
    // Nothing changed, and the same address can still sign Sam in: none of it was counted.
    const after = started.server.install!.store.read().accounts;

    expect(after.filter((account) => account.passwordHash === null).map((account) => account.email)).toEqual(["ed@example.com", "olive@example.com"]);
    expect((await call(port, "POST", "/api/auth/login", { body: { email: "sam@example.com", password: PASSWORD }, headers: from("203.0.113.5") })).status).toBe(200);
    // Their names are still theirs to change.
    expect((await call(port, "PATCH", "/api/account", { cookie: ed.cookie, body: { name: "Ed E." } })).status).toBe(200);
    // And the sign-in screen still asks for an e-mail: Sam signs in with one.
    expect((await call(port, "GET", "/api/meta")).body.install.signInWith).toBe("email");
  }, 120_000);
});
