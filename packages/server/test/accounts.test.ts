/**
 * People on a hosted install over real HTTP, against the real engine, real
 * data folders and real repositories: signing in with an e-mail (the same
 * answer for every wrong one, the limits, a switched-off account, the owner
 * carried over from one shared password), sessions that end when they
 * should, invitations and new-password links with a fake mail transport,
 * "forgot my password", the log, and publishes that carry each person's name.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { MailMessage, MailTransport } from "@galley/core/forms";
import { hashPassword, INSTALL_SCHEMA_VERSION, type AccountSession, type LinkPreview, type People } from "@galley/core/install";
import type { GitStatus, MetaInfo, PublishResult } from "@galley/core/types";
import { signSession } from "../src/auth";
import { SIGN_IN_REFUSED } from "../src/accounts-routes";
import { NAME_NEEDED, NAME_NEEDED_REFUSAL } from "@galley/core/install";
import { call, EDITOR, git, sandbox, siteRepository, startHosted, until, type Started } from "./hosted-helpers";

const box = sandbox("accounts");
const PASSWORD = "correct horse battery staple";
const OPERATOR = "an-operator-token-for-scripts-0000";

afterAll(() => box.cleanup(), 120_000);

interface FakeMail {
  sent: MailMessage[];
  transport: MailTransport;
}

/** A mail transport that keeps what it is given — or refuses it the way a mail server does, quoting the address and the message. */
function fakeMail(refuse = false): FakeMail {
  const sent: MailMessage[] = [];

  return {
    sent,
    transport: {
      from: "editor@example.com",
      async send(message) {
        if (refuse) throw Object.assign(new Error(`Message failed: 550 mailbox unavailable <${message.to[0]}> ${message.text}`), { code: "EENVELOPE", responseCode: 550 });
        sent.push(message);
      },
    },
  };
}

/** An install whose owner is Sam (complete, from the starting values). */
async function withOwner(env: Record<string, string> = {}, mail: FakeMail | null = null): Promise<Started & { owner: string }> {
  const started = await startHosted(
    box,
    box.folder("home"),
    { GALLEY_PUBLIC_URL: EDITOR, GALLEY_PASSWORD: PASSWORD, GALLEY_OWNER_NAME: "Sam Owner", GALLEY_OWNER_EMAIL: "sam@example.com", GALLEY_TOKEN: OPERATOR, ...env },
    { mailer: mail?.transport ?? null }
  );

  return { ...started, owner: await signIn(started.port, "sam@example.com") };
}

async function signIn(port: number, email?: string, password = PASSWORD, headers: Record<string, string> = {}): Promise<string> {
  const answer = await call(port, "POST", "/api/auth/login", { body: { password, ...(email !== undefined ? { email } : {}) }, headers });

  if (answer.status !== 200) throw new Error(`sign-in failed: ${answer.status} ${answer.text}`);
  return answer.cookies[0]!;
}

function codeIn(url: string): string {
  return url.split("#")[1]!;
}

/** Invites someone and has them accept: their account id and a signed-in cookie. */
async function join_(port: number, owner: string, email: string, role: "owner" | "editor" | "contributor", name: string): Promise<{ id: string; cookie: string }> {
  const invited = await call(port, "POST", "/api/people/invitations", { cookie: owner, body: { email, role } });

  expect(invited.status, invited.text).toBe(200);
  const accepted = await call(port, "POST", "/api/auth/link", { body: { code: codeIn(invited.body.link.url), password: PASSWORD, name } });

  expect(accepted.status, accepted.text).toBe(200);
  const cookie = accepted.cookies[0]!;
  const me = await call<AccountSession>(port, "GET", "/api/account", { cookie });

  return { id: me.body.id, cookie };
}

describe("signing in", () => {
  it("with an e-mail and a password; the same answer for an unknown e-mail, a wrong password and a switched-off account", async () => {
    const { port, owner } = await withOwner();
    const stranger = await call<MetaInfo>(port, "GET", "/api/meta");

    expect(stranger.body.install).toMatchObject({ signInWith: "email", passwordEmail: false });
    expect(stranger.body.account).toBeUndefined();
    expect((await call<MetaInfo>(port, "GET", "/api/meta", { cookie: owner })).body.account).toMatchObject({ name: "Sam Owner", email: "sam@example.com", role: "owner", access: ["edit", "publish", "manage"] });
    // Letter case and spaces don't matter.
    expect((await call(port, "POST", "/api/auth/login", { body: { email: " SAM@example.COM", password: PASSWORD } })).status).toBe(200);
    const ed = await join_(port, owner, "ed@example.com", "editor", "Ed Editor");

    expect((await call(port, "PATCH", `/api/people/${ed.id}`, { cookie: owner, body: { disabled: true } })).status).toBe(200);
    const answers = [
      await call(port, "POST", "/api/auth/login", { body: { email: "nobody@example.com", password: PASSWORD } }),
      await call(port, "POST", "/api/auth/login", { body: { email: "sam@example.com", password: "not the password at all" } }),
      await call(port, "POST", "/api/auth/login", { body: { email: "ed@example.com", password: PASSWORD } }),
    ];

    for (const answer of answers) {
      expect(answer.status).toBe(401);
      expect(answer.text).toBe(answers[0]!.text);
      expect(answer.cookies).toEqual([]);
    }
    expect(answers[0]!.body.error.message).toBe(SIGN_IN_REFUSED);
    // Without an e-mail only an owner who has none yet signs in; Sam has one.
    expect((await call(port, "POST", "/api/auth/login", { body: { password: PASSWORD } })).status).toBe(401);
  });

  it("limits guesses per address (5 a minute) — for e-mails without an account too", async () => {
    // Every limit, with a clock that never really waits: sign-in-gate.test.ts.
    const { port } = await withOwner({ GALLEY_TRUST_PROXY: "1" });
    const from = (address: string) => ({ "x-forwarded-for": address });

    for (let i = 0; i < 5; i += 1) expect((await call(port, "POST", "/api/auth/login", { body: { email: "sam@example.com", password: "wrong wrong wrong" }, headers: from("203.0.113.1") })).status).toBe(401);
    expect((await call(port, "POST", "/api/auth/login", { body: { email: "sam@example.com", password: PASSWORD }, headers: from("203.0.113.1") })).status).toBe(429);
    // Four more from other addresses: below the point where Sam's e-mail is slowed, the right password from elsewhere gets in at once.
    for (let i = 2; i <= 5; i += 1) expect((await call(port, "POST", "/api/auth/login", { body: { email: "Sam@example.com", password: "wrong wrong wrong" }, headers: from(`203.0.113.${i}`) })).status).toBe(401);
    expect((await call(port, "POST", "/api/auth/login", { body: { email: "sam@example.com", password: PASSWORD }, headers: from("198.51.100.7") })).status).toBe(200);
    // An e-mail nobody has is answered the same way as one that has an account.
    const answers = [
      await call(port, "POST", "/api/auth/login", { body: { email: "nobody@example.com", password: "x".repeat(12) }, headers: from("192.0.2.10") }),
      await call(port, "POST", "/api/auth/login", { body: { email: "sam@example.com", password: "x".repeat(12) }, headers: from("192.0.2.11") }),
    ];

    expect(answers[0]!.text).toBe(answers[1]!.text);
  });

  it("the owner carried over from one shared password signs in with it alone, then completes the account", async () => {
    const home = box.folder("home");
    // A real data folder from before accounts: schema 1, one shared password, and a session key whose old cookies are still around.
    const key = Buffer.alloc(32, 7);

    writeFileSync(join(home, "session.key"), `${key.toString("hex")}\n`, { mode: 0o600 });
    writeFileSync(
      join(home, "install.json"),
      JSON.stringify({ schema: 1, createdAt: "2026-10-01T10:00:00.000Z", password: { hash: await hashPassword(PASSWORD), changedAt: "2026-10-01T10:00:00.000Z" }, setup: { tokenSha256: null, finishedAt: null }, sessions: { validAfter: 0, revoked: [] }, site: null, liveUrl: null, pendingLiveUrl: null, lastBackupAt: null, seeded: ["password"] }),
      { mode: 0o600 }
    );
    const old = `__Host-galley_session=${signSession(key, Date.now() - 60_000)}`;
    const { port, server } = await startHosted(box, home, { GALLEY_PUBLIC_URL: EDITOR });

    expect(JSON.parse(readFileSync(join(home, "install.json"), "utf8")).schema).toBe(INSTALL_SCHEMA_VERSION);
    // A cookie from before the upgrade names nobody: refused, and so is one made like it now.
    for (const cookie of [old, `__Host-galley_session=${signSession(key)}`]) {
      expect((await call(port, "GET", "/api/sites", { cookie })).status).toBe(401);
      expect((await call<MetaInfo>(port, "GET", "/api/meta", { cookie })).body.authenticated).toBe(false);
    }
    expect((await call<MetaInfo>(port, "GET", "/api/meta")).body.install).toMatchObject({ signInWith: "password", passwordSet: true });
    const cookie = await signIn(port);
    const meta = await call<MetaInfo>(port, "GET", "/api/meta", { cookie });

    expect(meta.body.account).toMatchObject({ role: "owner", name: "", email: "", incomplete: true });
    // An invitation says who sent it: an owner with no name or e-mail can't send one yet.
    expect((await call(port, "POST", "/api/people/invitations", { cookie, body: { email: "ed@example.com", role: "editor" } })).body.error.message).toMatch(/Add your name and e-mail to your account first/);
    expect((await call(port, "PATCH", "/api/account", { cookie, body: { name: "Sam Owner", email: "sam@example.com" } })).body.error.message).toBe("Type your current password to change your e-mail.");
    const completed = await call<AccountSession>(port, "PATCH", "/api/account", { cookie, body: { name: "Sam Owner", email: "Sam@Example.com", password: PASSWORD } });

    expect(completed.body).toMatchObject({ name: "Sam Owner", email: "sam@example.com", role: "owner" });
    expect(completed.body.incomplete).toBeUndefined();
    expect((await call<MetaInfo>(port, "GET", "/api/meta")).body.install?.signInWith).toBe("email");
    expect((await call(port, "POST", "/api/auth/login", { body: { password: PASSWORD } })).status).toBe(401);
    expect(await signIn(port, "sam@example.com")).toBeTruthy();
    // The same session keeps working through all of it.
    expect((await call(port, "GET", "/api/sites", { cookie })).status).toBe(200);
    expect(server.install!.people.list().accounts).toHaveLength(1);
  });

  it("first run makes the owner from their name, e-mail and password, and signs them in", async () => {
    const started = await startHosted(box, box.folder("home"), { GALLEY_PUBLIC_URL: EDITOR });
    const code = new URL(started.server.setupUrl!).searchParams.get("token")!;
    const chosen = await call(started.port, "POST", "/api/setup/password", { bearer: code, origin: null, body: { password: PASSWORD, name: "Sam Owner", email: "sam@example.com" } });

    expect(chosen.status, chosen.text).toBe(200);
    expect((await call<MetaInfo>(started.port, "GET", "/api/meta", { cookie: chosen.cookies[0] })).body.account).toMatchObject({ name: "Sam Owner", email: "sam@example.com", role: "owner" });
    expect(started.logs.join("\n")).toContain("The owner's account was made through the setup link: Sam Owner (Owner), from 127.0.0.1.");
    expect(started.logs.join("\n")).not.toContain("sam@example.com");
  });
});

describe("sessions", () => {
  it("sign out one person, yourself everywhere, or everyone; switching off and removing end access on the next request; a role change applies on the next request", async () => {
    const { port, owner, server, logs } = await withOwner();
    const ed = await join_(port, owner, "ed@example.com", "editor", "Ed Editor");
    const cy = await join_(port, owner, "cy@example.com", "contributor", "Cy Contributor");
    const ed2 = await signIn(port, "ed@example.com");
    const ok = async (cookie: string) => (await call(port, "GET", "/api/sites", { cookie })).status === 200;

    // One person, out of every browser.
    expect((await call(port, "POST", `/api/people/${ed.id}/sign-out`, { cookie: owner })).status).toBe(200);
    expect([await ok(ed.cookie), await ok(ed2), await ok(cy.cookie), await ok(owner)]).toEqual([false, false, true, true]);
    // Yourself everywhere: nobody else.
    const cy2 = await signIn(port, "cy@example.com");

    expect((await call(port, "POST", "/api/auth/logout-all", { cookie: cy.cookie })).status).toBe(200);
    expect([await ok(cy.cookie), await ok(cy2), await ok(owner)]).toEqual([false, false, true]);
    // A role change applies to the very next request.
    const ed3 = await signIn(port, "ed@example.com");
    const siteId = "not-a-site";
    const publish = () => call(port, "POST", `/api/sites/${siteId}/publish`, { cookie: ed3, body: {} });

    expect((await publish()).status).toBe(404);
    expect((await call(port, "PATCH", `/api/people/${ed.id}`, { cookie: owner, body: { role: "contributor" } })).body).toMatchObject({ role: "contributor" });
    expect(await publish()).toMatchObject({ status: 403, body: { error: { code: "forbidden", message: "Your account can't do that. Ask an owner of this editor." } } });
    expect((await call<MetaInfo>(port, "GET", "/api/meta", { cookie: ed3 })).body.account).toMatchObject({ role: "contributor", access: ["edit"] });
    expect((await call(port, "GET", "/api/people", { cookie: ed3 })).status).toBe(403);
    // Switched off: refused on the next request, and their sign-in is refused like a wrong password.
    expect((await call(port, "PATCH", `/api/people/${ed.id}`, { cookie: owner, body: { disabled: true } })).status).toBe(200);
    expect(await ok(ed3)).toBe(false);
    expect((await call(port, "POST", "/api/auth/login", { body: { email: "ed@example.com", password: PASSWORD } })).body.error.message).toBe(SIGN_IN_REFUSED);
    // Removed: the same.
    const cy3 = await signIn(port, "cy@example.com");

    expect((await call(port, "DELETE", `/api/people/${cy.id}`, { cookie: owner })).status).toBe(200);
    expect(await ok(cy3)).toBe(false);
    expect(server.install!.people.get(cy.id)).toBeNull();
    // Nobody changes or removes their own account here; the last owner stays.
    expect((await call(port, "PATCH", `/api/people/${server.install!.people.list().accounts[0]!.id}`, { cookie: owner, body: { role: "editor" } })).body.error.message).toBe("Ask another owner to change your own account.");
    // Everyone, this browser included.
    const out = await call(port, "POST", "/api/people/sign-out", { cookie: owner });

    expect(out.status).toBe(200);
    expect(await ok(owner)).toBe(false);
    const log = logs.join("\n");

    expect(log).toContain("Sam Owner (Owner) signed Ed Editor (Editor) out everywhere.");
    expect(log).toContain("Cy Contributor (Contributor) signed out everywhere.");
    expect(log).toContain("Sam Owner (Owner) changed the role of Ed Editor (Editor) to Contributor.");
    expect(log).toContain("Sam Owner (Owner) switched off Ed Editor (Contributor); they were signed out.");
    expect(log).toContain("Sam Owner (Owner) removed Cy Contributor (Contributor); they were signed out.");
    expect(log).toContain("Sam Owner (Owner) signed everyone out.");
    expect(log).toContain("A sign-in to Ed Editor (Contributor) from 127.0.0.1 was refused: the account is switched off.");
    expect(log).not.toMatch(/@example\.com/);
  });

  it("an open event stream ends when its person is switched off, and a contributor never hears what a visitor sent", async () => {
    const { port, owner, server } = await withOwner();
    const cy = await join_(port, owner, "cy@example.com", "contributor", "Cy Contributor");
    const listen = (cookie: string) => {
      const heard = { text: "", ended: false };
      const controller = new AbortController();

      void fetch(`http://127.0.0.1:${port}/api/events`, { headers: { host: "cms.localhost", cookie }, signal: controller.signal })
        .then(async (response) => {
          const reader = response.body!.getReader();

          for (;;) {
            const { done, value } = await reader.read();

            if (done) break;
            heard.text += Buffer.from(value).toString("utf8");
          }
          heard.ended = true;
        })
        .catch(() => undefined);
      return { heard, stop: () => controller.abort() };
    };
    const ownerStream = listen(owner);
    const cyStream = listen(cy.cookie);

    await until(() => ownerStream.heard.text.includes("hello") && cyStream.heard.text.includes("hello"));
    server.services.events.emit({ type: "forms.submission", siteId: "s", form: "contact", change: "added", ids: ["one"], submission: { id: "one", values: { message: "a visitor's private words" } } as never });
    await until(() => ownerStream.heard.text.includes("forms.submission") && cyStream.heard.text.includes("forms.submission"));
    expect(ownerStream.heard.text).toContain("a visitor's private words");
    expect(cyStream.heard.text).not.toContain("a visitor's private words");
    expect(cyStream.heard.text).toContain('"ids":["one"]');
    expect((await call(port, "PATCH", `/api/people/${cy.id}`, { cookie: owner, body: { disabled: true } })).status).toBe(200);
    await until(() => cyStream.heard.ended);
    expect(ownerStream.heard.ended).toBe(false);
    ownerStream.stop();
  });
});

describe("one-time links and e-mail", () => {
  it("an invitation: told once, e-mailed when the server can, one use; every bad code gets the same refusal, and they count against the limit", async () => {
    const mail = fakeMail();
    const install = await withOwner({}, mail);
    const { port, owner, logs } = install;
    const invited = await call(port, "POST", "/api/people/invitations", { cookie: owner, body: { email: "Ed@Example.com", role: "editor" } });

    expect(invited.status).toBe(200);
    expect(invited.body).toMatchObject({ invitation: { email: "ed@example.com", role: "editor", invitedBy: "Sam Owner", emailed: true }, link: { emailed: true } });
    expect(invited.body.link.url).toMatch(/^https:\/\/cms\.localhost\/join#[A-Za-z0-9_-]{43}$/);
    const code = codeIn(invited.body.link.url);
    const [message] = mail.sent;

    expect(message!.to).toEqual(["ed@example.com"]);
    expect(message!.subject).toBe("Sam Owner invited you to edit cms.localhost");
    expect(message!.text).toContain(invited.body.link.url);
    expect(message!.text).toMatch(/Sam Owner invited you to edit the site at cms\.localhost with Galley, as an Editor\./);
    expect(message!.text).toMatch(/It works once, until \d{1,2} \w{3} \d{4}, \d\d:\d\d UTC\./);
    expect(message!.text).toMatch(/If you didn't expect this e-mail, you can ignore it/);
    expect(message!.html).toContain(`href="${invited.body.link.url}"`);
    // Told once: the People list and everything after carry no code.
    const people = await call<People>(port, "GET", "/api/people", { cookie: owner });

    expect(people.body.invitations).toEqual([expect.objectContaining({ email: "ed@example.com", emailed: true })]);
    expect(people.body.emailAvailable).toBe(true);
    expect(people.text).not.toContain(code);
    // What the link is for, before anyone types anything.
    expect((await call<LinkPreview>(port, "POST", "/api/auth/link/check", { body: { code } })).body).toEqual({ kind: "invitation", email: "ed@example.com", role: "editor", invitedBy: "Sam Owner", expiresAt: invited.body.invitation.expiresAt });
    expect((await call(port, "POST", "/api/auth/link", { body: { code, password: PASSWORD } })).body.error.message).toMatch(/Add a name/);
    const used = await call(port, "POST", "/api/auth/link", { body: { code, password: PASSWORD, name: "Ed Editor" } });

    expect(used.status).toBe(200);
    expect((await call<MetaInfo>(port, "GET", "/api/meta", { cookie: used.cookies[0] })).body.account).toMatchObject({ name: "Ed Editor", role: "editor" });
    const refusals = [
      await call(port, "POST", "/api/auth/link/check", { body: { code } }),
      await call(port, "POST", "/api/auth/link", { body: { code, password: PASSWORD, name: "Again" } }),
      await call(port, "POST", "/api/auth/link/check", { body: { code: "A".repeat(43) } }),
      await call(port, "POST", "/api/auth/link/check", { body: { code: "not even a code" } }),
      // A code mangled on the way (pasted twice, a mail program's line breaks): the same answer, not a different one.
      await call(port, "POST", "/api/auth/link/check", { body: { code: `${code}\n${code}${"x".repeat(300)}` } }),
    ];

    for (const refusal of refusals) expect([refusal.status, refusal.text]).toEqual([404, refusals[0]!.text]);
    expect(refusals[0]!.body.error.message).toBe("This link doesn't work any more: it was used already, taken back, or it ran out. Ask an owner of this editor for a new one.");
    expect((await call(port, "POST", "/api/auth/link/check", { body: { code: "C".repeat(43) } })).status).toBe(429);
    // Taken back, an invitation's link stops working.
    const another = await call(port, "POST", "/api/people/invitations", { cookie: owner, body: { email: "cy@example.com", role: "contributor" } });

    expect((await call(port, "POST", "/api/people/invitations", { cookie: owner, body: { email: "CY@example.com", role: "editor" } })).body.error.message).toMatch(/has an open invitation already/);
    expect((await call(port, "DELETE", `/api/people/invitations/${another.body.invitation.id}`, { cookie: owner })).status).toBe(200);
    expect(install.server.install!.people.list().invitations).toEqual([]);
    const all = logs.join("\n");

    expect(all).toContain("Sam Owner (Owner) invited a new Editor; the link was e-mailed.");
    expect(all).toContain("Ed Editor (Editor) accepted an invitation and signed in (from 127.0.0.1).");
    expect(all).toContain("Sam Owner (Owner) took back an invitation for a new Contributor.");
    expect(all).toContain("A one-time link opened from 127.0.0.1 was refused.");
    for (const secret of [code, codeIn(another.body.link.url), "@example.com", "#"]) expect(all).not.toContain(secret);
  });

  it("a new-password link: a newer one cancels the older, it sets the password once and signs that person's other browsers out", async () => {
    const mail = fakeMail();
    const { port, owner } = await withOwner({}, mail);
    const ed = await join_(port, owner, "ed@example.com", "editor", "Ed Editor");
    await call(port, "POST", `/api/people/${ed.id}/password-link`, { cookie: owner });
    const second = await call(port, "POST", `/api/people/${ed.id}/password-link`, { cookie: owner });
    // Was the link itself beside `emailed: true`: an e-mailed link for someone else now reaches only them.
    const linkIn = (text: string) => /https:\/\/cms\.localhost\/new-password#[A-Za-z0-9_-]{43}/.exec(text)![0];
    const first = { body: { url: linkIn(mail.sent.at(-2)!.text) } };

    expect(second.body).toEqual({ url: null, expiresAt: expect.any(String), emailed: true });
    second.body.url = linkIn(mail.sent.at(-1)!.text);
    expect(mail.sent.at(-1)!.text).toMatch(/Sam Owner made you a link to choose a new password for Galley at cms\.localhost\./);
    expect(mail.sent.at(-1)!.text).toMatch(/Your current password keeps working until the link is used\./);
    expect((await call(port, "POST", "/api/auth/link/check", { body: { code: codeIn(first.body.url) } })).status).toBe(404);
    expect((await call<LinkPreview>(port, "POST", "/api/auth/link/check", { body: { code: codeIn(second.body.url) } })).body).toMatchObject({ kind: "password", email: "ed@example.com" });
    // The old password still works until the link is used.
    const before = await signIn(port, "ed@example.com");
    const used = await call(port, "POST", "/api/auth/link", { body: { code: codeIn(second.body.url), password: "ed's brand new password" } });

    expect(used.status).toBe(200);
    expect((await call(port, "GET", "/api/sites", { cookie: before })).status).toBe(401);
    expect((await call(port, "GET", "/api/sites", { cookie: ed.cookie })).status).toBe(401);
    expect((await call(port, "GET", "/api/sites", { cookie: used.cookies[0] })).status).toBe(200);
    expect((await call(port, "GET", "/api/sites", { cookie: owner })).status).toBe(200);
    expect(await signIn(port, "ed@example.com", "ed's brand new password")).toBeTruthy();
    expect((await call(port, "POST", "/api/auth/link", { body: { code: codeIn(second.body.url), password: "yet another password" } })).status).toBe(404);
  });

  it("“forgot my password” answers the same, at once, whether or not the address has an account, and can't flood a mailbox", async () => {
    const mail = fakeMail();
    const { port, owner } = await withOwner({ GALLEY_TRUST_PROXY: "1" }, mail);

    await join_(port, owner, "ed@example.com", "editor", "Ed Editor");
    const before = mail.sent.length;
    const known = await call(port, "POST", "/api/auth/forgot", { body: { email: "ED@example.com" }, headers: { "x-forwarded-for": "203.0.113.1" } });
    const unknown = await call(port, "POST", "/api/auth/forgot", { body: { email: "nobody@example.com" }, headers: { "x-forwarded-for": "203.0.113.2" } });

    expect([known.status, known.text]).toEqual([200, unknown.text]);
    expect(known.body).toEqual({ ok: true, emailAvailable: true });
    await until(() => mail.sent.length === before + 1);
    expect(mail.sent.at(-1)!.to).toEqual(["ed@example.com"]);
    expect(mail.sent.at(-1)!.text).toMatch(/Someone asked for a link to choose a new password/);
    // Three e-mails an hour to one address at most, however many addresses ask.
    for (let i = 3; i <= 6; i += 1) await call(port, "POST", "/api/auth/forgot", { body: { email: "ed@example.com" }, headers: { "x-forwarded-for": `203.0.113.${i}` } });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(mail.sent.filter((message) => message.to[0] === "ed@example.com" && /asked for a link/.test(message.text))).toHaveLength(3);
    // Five requests per address in 15 minutes.
    for (let i = 0; i < 5; i += 1) await call(port, "POST", "/api/auth/forgot", { body: { email: `x${i}@example.com` }, headers: { "x-forwarded-for": "198.51.100.1" } });
    expect((await call(port, "POST", "/api/auth/forgot", { body: { email: "x@example.com" }, headers: { "x-forwarded-for": "198.51.100.1" } })).status).toBe(429);
  });

  it("without outgoing e-mail nothing is sent: links are only told to the owner, and “forgot” says to ask an owner", async () => {
    const { port, owner, server } = await withOwner();
    const invited = await call(port, "POST", "/api/people/invitations", { cookie: owner, body: { email: "ed@example.com", role: "editor" } });

    expect(invited.body).toMatchObject({ invitation: { emailed: false }, link: { emailed: false } });
    expect((await call(port, "POST", "/api/auth/forgot", { body: { email: "sam@example.com" } })).body).toEqual({ ok: true, emailAvailable: false });
    expect((await call<People>(port, "GET", "/api/people", { cookie: owner })).body.emailAvailable).toBe(false);
    expect(server.install!.store.read().links.filter((link) => link.kind === "password")).toEqual([]);
  });

  it("a send that fails never fails the request: the owner still gets the link, and the log says so without the address or the link", async () => {
    const mail = fakeMail(true);
    const { port, owner, logs } = await withOwner({}, mail);
    const invited = await call(port, "POST", "/api/people/invitations", { cookie: owner, body: { email: "ed@example.com", role: "editor" } });

    expect(invited.status).toBe(200);
    expect(invited.body).toMatchObject({ invitation: { emailed: false }, link: { emailed: false, url: expect.stringMatching(/\/join#/) } });
    const all = logs.join("\n");

    expect(all).toContain("The e-mail with an invitation from Sam Owner (Owner) couldn't be sent (EENVELOPE, reply 550). Check GALLEY_SMTP_URL and GALLEY_MAIL_FROM. The link was still given to the owner.");
    expect(all).not.toContain(codeIn(invited.body.link.url));
    expect(all).not.toContain("ed@example.com");
    expect(all).not.toContain("mailbox unavailable");
  });
});

describe("publishes carry the person's name", () => {
  it(
    "someone let in without a name is recorded as nobody else: their own e-mail stands in, and publishing waits until they choose a name",
    async () => {
      const bare = siteRepository(box);
      const { port, owner, server } = await withOwner({
        GALLEY_SITE_REPOSITORY: bare,
        GALLEY_SITE_ACCESS: "token",
        GALLEY_SITE_TOKEN: "fake-access-key-for-the-repository-0000",
        GALLEY_AUTHOR_NAME: "Site Publisher",
        GALLEY_AUTHOR_EMAIL: "publisher@example.com",
      });

      await server.install!.idle();
      const siteId = server.install!.siteId()!;
      const site = server.install!.siteFolder();
      // Ed accepts his invitation with a name someone here already has: he is let in without it.
      const ed = await join_(port, owner, "ed@example.com", "editor", "Sam Owner");

      expect((await call<AccountSession>(port, "GET", "/api/account", { cookie: ed.cookie })).body).toMatchObject({ name: "", email: "ed@example.com", incomplete: true });
      // Who a publish of his would be recorded as: himself, by his e-mail. Not the install's publishing name, and not the owner's.
      expect((await call<GitStatus>(port, "GET", `/api/sites/${siteId}/git`, { cookie: ed.cookie })).body.author).toEqual({ name: "ed@example.com", email: "ed@example.com", from: "account" });

      // He can change the draft like anyone.
      writeFileSync(join(site, "src/content/pages", "eds.md"), "---\ntitle: Ed's page\n---\nEd's page\n");
      const head = git(site, "rev-parse", "HEAD");
      const publish = () => call<PublishResult>(port, "POST", `/api/sites/${siteId}/publish`, { cookie: ed.cookie, body: { message: "Ed's page", paths: ["src/content/pages/eds.md"] } });

      // Publishing, undoing a publish, sending and getting the latest wait for a name, in words that say so.
      for (const refused of [
        await publish(),
        await call(port, "POST", `/api/sites/${siteId}/revert`, { cookie: ed.cookie, body: { commit: head } }),
        await call(port, "POST", `/api/sites/${siteId}/send`, { cookie: ed.cookie, body: {} }),
        await call(port, "POST", `/api/sites/${siteId}/pull`, { cookie: ed.cookie, body: {} }),
      ]) {
        expect(refused.status, refused.text).toBe(403);
        expect(refused.body.error).toMatchObject({ code: "forbidden", message: NAME_NEEDED_REFUSAL, detail: NAME_NEEDED });
      }
      expect(git(site, "rev-parse", "HEAD")).toBe(head);

      // With a name of his own, the same publish goes through and carries it.
      expect((await call(port, "PATCH", "/api/account", { cookie: ed.cookie, body: { name: "Ed Editor" } })).status).toBe(200);
      const published = await publish();

      expect(published.status, published.text).toBe(200);
      expect(published.body.ok, published.text).toBe(true);
      expect(git(site, "log", "-1", "--format=%an <%ae>|%cn <%ce>")).toBe("Ed Editor <ed@example.com>|Ed Editor <ed@example.com>");
    },
    180_000
  );

  it(
    "two people publish: the history shows two authors; undoing a publish is the undoer's; a script's token and the Proof screen use the install's",
    async () => {
      const bare = siteRepository(box);
      const { port, owner, server } = await withOwner({
        GALLEY_SITE_REPOSITORY: bare,
        GALLEY_SITE_ACCESS: "token",
        GALLEY_SITE_TOKEN: "fake-access-key-for-the-repository-0000",
        GALLEY_AUTHOR_NAME: "Site Publisher",
        GALLEY_AUTHOR_EMAIL: "publisher@example.com",
      });

      await server.install!.idle();
      const siteId = server.install!.siteId()!;
      const site = server.install!.siteFolder();
      const ed = await join_(port, owner, "ed@example.com", "editor", "Ed Editor");
      const cy = await join_(port, owner, "cy@example.com", "contributor", "Cy Contributor");
      const publish = async (cookie: string | null, file: string, message: string) => {
        writeFileSync(join(site, "src/content/pages", file), `---\ntitle: ${message}\n---\n${message}\n`);
        const answer = await call<PublishResult>(port, "POST", `/api/sites/${siteId}/publish`, { ...(cookie ? { cookie } : { bearer: OPERATOR }), body: { message, paths: [`src/content/pages/${file}`] } });

        expect(answer.status, answer.text).toBe(200);
        expect(answer.body.ok, answer.text).toBe(true);
        return answer.body.commit!;
      };

      // Who the next publish will be recorded as, as each person sees it.
      expect((await call<GitStatus>(port, "GET", `/api/sites/${siteId}/git`, { cookie: ed.cookie })).body.author).toEqual({ name: "Ed Editor", email: "ed@example.com", from: "account" });
      await publish(owner, "sams.md", "Sam's page");
      const edsVersion = await publish(ed.cookie, "eds.md", "Ed's page");

      // A contributor can't publish or undo a publish.
      expect((await call(port, "POST", `/api/sites/${siteId}/publish`, { cookie: cy.cookie, body: {} })).status).toBe(403);
      expect((await call(port, "POST", `/api/sites/${siteId}/revert`, { cookie: cy.cookie, body: { commit: edsVersion } })).status).toBe(403);
      const undone = await call<PublishResult>(port, "POST", `/api/sites/${siteId}/revert`, { cookie: owner, body: { commit: edsVersion } });

      expect(undone.status, undone.text).toBe(200);
      await publish(null, "script.md", "From a script");
      expect(git(site, "log", "--format=%an <%ae>|%s", "-n", "4").split("\n")).toEqual([
        "Site Publisher <publisher@example.com>|From a script",
        expect.stringMatching(/^Sam Owner <sam@example\.com>\|/),
        "Ed Editor <ed@example.com>|Ed's page",
        "Sam Owner <sam@example.com>|Sam's page",
      ]);
      // The committer is the person too, not the server's own git identity.
      expect(git(site, "log", "--format=%cn <%ce>", "-n", "1", "--skip", "2")).toBe("Ed Editor <ed@example.com>");
      expect((await call<GitStatus>(port, "GET", `/api/sites/${siteId}/git`, { bearer: OPERATOR })).body.author).toMatchObject({ name: "Site Publisher", email: "publisher@example.com" });
    },
    180_000
  );
});
