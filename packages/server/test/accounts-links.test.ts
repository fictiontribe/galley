/**
 * One-time links on a hosted install are built only from the editor's
 * configured public address, whatever a request says about where it came
 * in: its Host header, its Origin, or a full address as the request target.
 * Without a public address nothing is ever e-mailed, and only a trial on one
 * computer (a loopback name) is shown a link at all. A new-password link for
 * someone else that went out by e-mail isn't handed to the owner who asked.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { MailMessage, MailTransport } from "@galley/core/forms";
import type { AccountSession } from "@galley/core/install";
import type { MetaInfo } from "@galley/core/types";
import { NEEDS_PUBLIC_ADDRESS } from "../src/accounts-routes";
import { call, EDITOR, sandbox, startHosted, type Started } from "./hosted-helpers";

const box = sandbox("account-links");
const PASSWORD = "correct horse battery staple";
const FOREIGN = "editor.example.net";

afterAll(() => box.cleanup(), 120_000);

interface FakeMail {
  sent: MailMessage[];
  transport: MailTransport;
}

function fakeMail(refuse = false): FakeMail {
  const sent: MailMessage[] = [];

  return {
    sent,
    transport: {
      from: "editor@example.com",
      async send(message) {
        if (refuse) throw Object.assign(new Error("Message failed: 550 mailbox unavailable"), { code: "EENVELOPE", responseCode: 550 });
        sent.push(message);
      },
    },
  };
}

/** An install whose owner is Sam; `publicUrl` null starts it without GALLEY_PUBLIC_URL. */
async function install(publicUrl: string | null, mail: FakeMail | null): Promise<Started & { owner: string; localhost: string }> {
  const started = await startHosted(
    box,
    box.folder("home"),
    { ...(publicUrl ? { GALLEY_PUBLIC_URL: publicUrl } : {}), GALLEY_PASSWORD: PASSWORD, GALLEY_OWNER_NAME: "Sam Owner", GALLEY_OWNER_EMAIL: "sam@example.com" },
    { mailer: mail?.transport ?? null }
  );
  const localhost = `localhost:${started.port}`;
  const signedIn = await call(started.port, "POST", "/api/auth/login", { host: localhost, origin: `http://${localhost}`, body: { email: "sam@example.com", password: PASSWORD } });

  expect(signedIn.status, signedIn.text).toBe(200);
  return { ...started, owner: signedIn.cookies[0]!, localhost };
}

/** A request whose Host and Origin both name another address. */
const foreign = { host: FOREIGN, origin: `http://${FOREIGN}` };

/** Lets an e-mail that is sent in the background (after "forgot my password") arrive. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

function originOf(url: string): string {
  return new URL(url).origin;
}

/** Every link in every e-mail sent, by the address it starts with. */
function linkOrigins(mail: FakeMail): string[] {
  return mail.sent.flatMap((message) => [...message.text.matchAll(/https?:\/\/[^\s]+\/(?:join|new-password)#[A-Za-z0-9_-]{43}/g)].map((match) => originOf(match[0])));
}

async function invite(started: Started & { owner: string }, email: string, where: { host?: string; origin?: string; path?: string } = {}) {
  return call(started.port, "POST", where.path ?? "/api/people/invitations", { cookie: started.owner, body: { email, role: "editor" }, ...(where.host ? { host: where.host } : {}), ...(where.origin ? { origin: where.origin } : {}) });
}

/** Invites Ed from this computer and has him accept; his account id. */
async function addEd(started: Started & { owner: string; localhost: string }, where: { host: string; origin: string }): Promise<string> {
  const invited = await invite(started, "ed@example.com", where);

  expect(invited.status, invited.text).toBe(200);
  const code = String(invited.body.link.url).split("#")[1];
  const accepted = await call(started.port, "POST", "/api/auth/link", { ...where, body: { code, password: PASSWORD, name: "Ed Editor" } });

  expect(accepted.status, accepted.text).toBe(200);
  return (await call<AccountSession>(started.port, "GET", "/api/account", { host: where.host, cookie: accepted.cookies[0]! })).body.id;
}

describe("without the editor's public address", () => {
  it("no e-mail is ever sent, though outgoing e-mail is set up: not for “forgot my password”, an invitation or a new-password link", async () => {
    const mail = fakeMail();
    const started = await install(null, mail);
    const here = { host: started.localhost, origin: `http://${started.localhost}` };

    expect((await call<MetaInfo>(started.port, "GET", "/api/meta", { host: started.localhost })).body.install).toMatchObject({ passwordEmail: false });
    expect((await call(started.port, "GET", "/api/people", { ...here, cookie: started.owner })).body.emailAvailable).toBe(false);
    for (const where of [foreign, here]) {
      const forgot = await call(started.port, "POST", "/api/auth/forgot", { ...where, body: { email: "sam@example.com" } });

      expect(forgot.status, forgot.text).toBe(200);
      expect(forgot.body).toEqual({ ok: true, emailAvailable: false });
    }
    const invited = await invite(started, "kim@example.com", here);

    expect(invited.status, invited.text).toBe(200);
    expect(invited.body).toMatchObject({ invitation: { emailed: false }, link: { emailed: false } });
    const edId = await addEd(started, here);
    const link = await call(started.port, "POST", `/api/people/${edId}/password-link`, { ...here, cookie: started.owner });

    expect(link.status, link.text).toBe(200);
    expect(link.body).toMatchObject({ emailed: false, url: expect.stringMatching(/\/new-password#/) });
    await settle();
    expect(mail.sent).toEqual([]);
  });

  it("a link is shown to the signed-in owner only on a loopback name, and is built from it", async () => {
    const started = await install(null, fakeMail());
    const invited = await invite(started, "kim@example.com", { host: started.localhost, origin: `http://${started.localhost}` });

    expect(invited.status, invited.text).toBe(200);
    expect(originOf(invited.body.link.url)).toBe(`http://${started.localhost}`);
  });

  it("making a link from any other address is refused in plain words, and nothing is left half-made", async () => {
    const mail = fakeMail();
    const started = await install(null, mail);
    const here = { host: started.localhost, origin: `http://${started.localhost}` };
    const edId = await addEd(started, here);
    const attempts = [
      // A Host header and an Origin that agree with each other, naming another address.
      await invite(started, "kim@example.com", foreign),
      await call(started.port, "POST", `/api/people/${edId}/password-link`, { ...foreign, cookie: started.owner }),
      // A full address as the request target, naming this computer, with another Host header.
      await invite(started, "kim@example.com", { host: FOREIGN, origin: `http://${started.localhost}`, path: `http://${started.localhost}/api/people/invitations` }),
      await call(started.port, "POST", `http://${started.localhost}/api/people/${edId}/password-link`, { host: FOREIGN, origin: `http://${started.localhost}`, cookie: started.owner }),
      // A name that isn't a loopback one, without any trickery: still no address to build a link from.
      await invite(started, "kim@example.com", { host: `cms.example.com:${started.port}`, origin: `http://cms.example.com:${started.port}` }),
    ];

    for (const answer of attempts) {
      expect(answer.status, answer.text).toBe(400);
      expect(answer.body.error.message).toBe(NEEDS_PUBLIC_ADDRESS);
      expect(answer.text).not.toMatch(/#[A-Za-z0-9_-]{43}/);
    }
    const people = await call(started.port, "GET", "/api/people", { ...here, cookie: started.owner });

    expect(people.body.invitations).toEqual([]);
    await settle();
    expect(mail.sent).toEqual([]);
  });
});

describe("with the editor's public address", () => {
  it("every link is built from it, whatever Host, Origin or request target a request has", async () => {
    const mail = fakeMail();
    const started = await install(EDITOR, mail);
    // The editor answers only to its own name (and loopback ones); a full address as the target is how another Host gets past that.
    const target = (path: string) => ({ host: FOREIGN, origin: `http://${started.localhost}`, path: `http://${started.localhost}${path}` });
    const invited = await invite(started, "ed@example.com", target("/api/people/invitations"));

    expect(invited.status, invited.text).toBe(200);
    expect(originOf(invited.body.link.url)).toBe(EDITOR);
    const accepted = await call(started.port, "POST", "/api/auth/link", { body: { code: String(invited.body.link.url).split("#")[1], password: PASSWORD, name: "Ed Editor" } });
    const edId = (await call<AccountSession>(started.port, "GET", "/api/account", { cookie: accepted.cookies[0]! })).body.id;
    const forgot = await call(started.port, "POST", `http://${started.localhost}/api/auth/forgot`, { host: FOREIGN, origin: `http://${started.localhost}`, body: { email: "sam@example.com" } });

    expect(forgot.body).toEqual({ ok: true, emailAvailable: true });
    const made = await call(started.port, "POST", `http://${started.localhost}/api/people/${edId}/password-link`, { host: FOREIGN, origin: `http://${started.localhost}`, cookie: started.owner });

    expect(made.status, made.text).toBe(200);
    await settle();
    expect(mail.sent.map((message) => message.to[0])).toEqual(["ed@example.com", "sam@example.com", "ed@example.com"]);
    expect(linkOrigins(mail)).toEqual([EDITOR, EDITOR, EDITOR]);
    // The address in the e-mail's own words is the configured one too.
    for (const message of mail.sent) expect(message.text).not.toContain("localhost:");
    // A request with another Host header and an ordinary target isn't answered at all.
    expect((await call(started.port, "POST", "/api/auth/forgot", { ...foreign, body: { email: "sam@example.com" } })).status).toBe(403);
  });

  it("a new-password link that was e-mailed isn't shown to the owner; one that couldn't be is, and the log says who made it for whom", async () => {
    const mail = fakeMail();
    const started = await install(EDITOR, mail);
    const invited = await invite(started, "ed@example.com");

    expect(invited.body.link).toMatchObject({ emailed: true, url: expect.stringMatching(/^https:\/\/cms\.localhost\/join#/) });
    const accepted = await call(started.port, "POST", "/api/auth/link", { body: { code: String(invited.body.link.url).split("#")[1], password: PASSWORD, name: "Ed Editor" } });
    const edId = (await call<AccountSession>(started.port, "GET", "/api/account", { cookie: accepted.cookies[0]! })).body.id;
    const emailed = await call(started.port, "POST", `/api/people/${edId}/password-link`, { cookie: started.owner });

    expect(emailed.status, emailed.text).toBe(200);
    expect(emailed.body).toMatchObject({ url: null, emailed: true });
    expect(emailed.text).not.toMatch(/#[A-Za-z0-9_-]{43}/);
    expect(linkOrigins(mail)).toEqual([EDITOR, EDITOR]);
    expect(started.logs.join("\n")).toContain("Sam Owner (Owner) made a new-password link for Ed Editor (Editor); it was e-mailed to them and not shown.");

    const refusing = fakeMail(true);
    const other = await install(EDITOR, refusing);
    const invitedThere = await invite(other, "ed@example.com");
    const acceptedThere = await call(other.port, "POST", "/api/auth/link", { body: { code: String(invitedThere.body.link.url).split("#")[1], password: PASSWORD, name: "Ed Editor" } });
    const edThere = (await call<AccountSession>(other.port, "GET", "/api/account", { cookie: acceptedThere.cookies[0]! })).body.id;
    const shown = await call(other.port, "POST", `/api/people/${edThere}/password-link`, { cookie: other.owner });

    expect(shown.body).toMatchObject({ emailed: false, url: expect.stringMatching(/^https:\/\/cms\.localhost\/new-password#[A-Za-z0-9_-]{43}$/) });
    expect(other.logs.join("\n")).toContain("Sam Owner (Owner) made a new-password link for Ed Editor (Editor); it couldn't be e-mailed, so it was shown to them to pass on.");
  });

  it("without outgoing e-mail, links are shown, built from the public address, and “forgot” sends nothing", async () => {
    const started = await install(EDITOR, null);
    const invited = await invite(started, "ed@example.com", { host: FOREIGN, origin: `http://${started.localhost}`, path: `http://${started.localhost}/api/people/invitations` });

    expect(invited.status, invited.text).toBe(200);
    expect(invited.body.link).toMatchObject({ emailed: false });
    expect(originOf(invited.body.link.url)).toBe(EDITOR);
    expect((await call(started.port, "POST", "/api/auth/forgot", { body: { email: "sam@example.com" } })).body).toEqual({ ok: true, emailAvailable: false });
  });
});
