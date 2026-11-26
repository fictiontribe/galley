/**
 * The server's access token on the people routes, over real HTTP. On every
 * install it may sign one person out. Only where an identity provider is set
 * up, it may also switch someone off, delete an account already switched off,
 * list everyone without names or e-mails, and look an account up by its
 * subject; nothing that grants. Each is logged as the token.
 */
import { afterAll, describe, expect, it } from "vitest";
import { TOKEN_DELETES_ONLY_SWITCHED_OFF, TOKEN_ONLY_SWITCHES_OFF, type AccountSession } from "@galley/core/install";
import { NO_IDENTITY_PROVIDER, TOKEN_ONLY_LOOKUP } from "../src/accounts-routes";
import { NEEDS_A_PERSON } from "../src/who";
import { call, EDITOR, sandbox, startHosted, type Started } from "./hosted-helpers";

const box = sandbox("accounts-operator-token");
const PASSWORD = "correct horse battery staple";
const TOKEN = "an-operator-token-for-scripts-0000";
const ISSUER = "https://id.example.com";

afterAll(() => box.cleanup(), 120_000);

async function signIn(port: number, email: string): Promise<string> {
  const answer = await call(port, "POST", "/api/auth/login", { body: { email, password: PASSWORD } });

  if (answer.status !== 200) throw new Error(`sign-in failed: ${answer.status} ${answer.text}`);
  return answer.cookies[0]!;
}

/** Sam (owner), Ed (editor) and Olive (owner), signed in; with a provider, Ed and Olive have identities at it. */
async function withPeople(provider: boolean): Promise<Started & { owner: string; ed: { id: string; cookie: string }; olive: { id: string; cookie: string }; sam: string }> {
  const started = await startHosted(
    box,
    box.folder("home"),
    { GALLEY_PUBLIC_URL: EDITOR, GALLEY_PASSWORD: PASSWORD, GALLEY_OWNER_NAME: "Sam Owner", GALLEY_OWNER_EMAIL: "sam@example.com", GALLEY_TOKEN: TOKEN },
    provider ? { identityProvider: { issuer: ISSUER } } : {}
  );
  const owner = await signIn(started.port, "sam@example.com");
  const join = async (email: string, role: "owner" | "editor", name: string) => {
    const invited = await call(started.port, "POST", "/api/people/invitations", { cookie: owner, body: { email, role } });
    const accepted = await call(started.port, "POST", "/api/auth/link", { body: { code: String(invited.body.link.url).split("#")[1], password: PASSWORD, name } });
    const cookie = accepted.cookies[0]!;

    return { id: (await call<AccountSession>(started.port, "GET", "/api/account", { cookie })).body.id, cookie };
  };
  const ed = await join("ed@example.com", "editor", "Ed Editor");
  const olive = await join("olive@example.com", "owner", "Olive Owner");

  if (provider) {
    await started.server.install!.store.update((draft) => {
      draft.accounts.find((one) => one.id === ed.id)!.identity = { issuer: ISSUER, subject: "ed-subject" };
      draft.accounts.find((one) => one.id === olive.id)!.identity = { issuer: ISSUER, subject: "olive / subject?#%" };
    });
  }
  return { ...started, owner, ed, olive, sam: started.server.install!.people.list().accounts[0]!.id };
}

const asToken = { bearer: TOKEN };
/** The log so far, as one text. */
const logText = (logs: string[]) => logs.join("\n");

describe("on an install without an identity provider", () => {
  it("the token signs one person out, logged as the token; everything else on People stays a person's", async () => {
    const { port, owner, ed, logs } = await withPeople(false);
    const out = await call(port, "POST", `/api/people/${ed.id}/sign-out`, asToken);

    expect(out.status, out.text).toBe(200);
    expect((await call(port, "GET", "/api/account", { cookie: ed.cookie })).status).toBe(401);
    expect((await call(port, "GET", "/api/account", { cookie: owner })).status).toBe(200);
    expect(logText(logs)).toContain("The server's access token signed Ed Editor (Editor) out everywhere.");
    expect((await call(port, "POST", "/api/people/nobody-here/sign-out", asToken)).status).toBe(404);
    const refused = [
      await call(port, "GET", "/api/people", asToken),
      await call(port, "PATCH", `/api/people/${ed.id}`, { ...asToken, body: { disabled: true } }),
      await call(port, "DELETE", `/api/people/${ed.id}`, asToken),
      await call(port, "POST", "/api/people/invitations", { ...asToken, body: { email: "cy@example.com", role: "editor" } }),
      await call(port, "POST", `/api/people/${ed.id}/password-link`, asToken),
      await call(port, "POST", "/api/people/sign-out", asToken),
    ];

    for (const answer of refused) expect([answer.status, answer.body.error.message]).toEqual([403, NEEDS_A_PERSON]);
    const lookup = await call(port, "GET", "/api/people/by-identity?subject=ed-subject", asToken);

    expect([lookup.status, lookup.body.error.message]).toEqual([404, NO_IDENTITY_PROVIDER]);
    expect(logText(logs)).not.toContain("switched off");
  });
});

describe("on an install with an identity provider", () => {
  it("the token's list and lookup hold ids, roles, switched off and subjects: no name, no e-mail, no invitations; a browser can't look up", async () => {
    const { port, owner, sam, ed, olive, logs } = await withPeople(true);
    const list = await call(port, "GET", "/api/people", asToken);

    expect(list.status, list.text).toBe(200);
    expect(list.body).toEqual({
      accounts: [
        { id: sam, role: "owner", disabled: false, subject: null },
        { id: ed.id, role: "editor", disabled: false, subject: "ed-subject" },
        { id: olive.id, role: "owner", disabled: false, subject: "olive / subject?#%" },
      ],
    });
    expect(list.text).not.toMatch(/@example\.com|Sam Owner|Ed Editor|Olive Owner|invitation/i);
    // An owner's browser still gets People as always.
    expect((await call(port, "GET", "/api/people", { cookie: owner })).body).toMatchObject({ invitations: [], emailAvailable: false, accounts: expect.arrayContaining([expect.objectContaining({ email: "ed@example.com" })]) });
    const found = await call(port, "GET", `/api/people/by-identity?subject=${encodeURIComponent("olive / subject?#%")}`, asToken);

    expect(found.status, found.text).toBe(200);
    expect(found.body).toEqual({ id: olive.id, role: "owner", disabled: false });
    expect((await call(port, "GET", "/api/people/by-identity?subject=nobody", asToken)).status).toBe(404);
    expect((await call(port, "GET", "/api/people/by-identity", asToken)).status).toBe(400);
    expect((await call(port, "GET", `/api/people/by-identity?subject=${"s".repeat(256)}`, asToken)).status).toBe(400);
    const browser = await call(port, "GET", "/api/people/by-identity?subject=ed-subject", { cookie: owner });

    expect([browser.status, browser.body.error.message]).toEqual([403, TOKEN_ONLY_LOOKUP]);
    expect((await call(port, "GET", "/api/people/by-identity?subject=ed-subject")).status).toBe(401);
    expect(logText(logs)).toContain("The server's access token read the list of people (3 accounts).");
    expect(logText(logs)).toContain("The server's access token looked an account up by its identity: Olive Owner (Owner).");
    expect(logText(logs)).toContain("The server's access token looked an account up by its identity: no account has it.");
    expect(logText(logs)).not.toContain("olive / subject");
  });

  it("the token switches someone off (signed out at once) and nothing more; deletes only someone switched off, remembered as removed; never the last owner", async () => {
    const { port, sam, ed, olive, logs, server, owner } = await withPeople(true);

    for (const body of [{ disabled: false }, { role: "owner" }, { email: "x@example.com" }, { disabled: true, role: "editor" }]) {
      const answer = await call(port, "PATCH", `/api/people/${ed.id}`, { ...asToken, body });

      expect([answer.status, answer.body.error.message]).toEqual([403, TOKEN_ONLY_SWITCHES_OFF]);
    }
    expect((await call(port, "GET", "/api/account", { cookie: ed.cookie })).status).toBe(200);
    const off = await call(port, "PATCH", `/api/people/${ed.id}`, { ...asToken, body: { disabled: true } });

    expect(off.status, off.text).toBe(200);
    expect(off.body).toEqual({ id: ed.id, role: "editor", disabled: true, subject: "ed-subject" });
    expect((await call(port, "GET", "/api/account", { cookie: ed.cookie })).status).toBe(401);
    expect(logText(logs)).toContain("The server's access token switched off Ed Editor (Editor); they were signed out.");
    // Deleting: only someone switched off.
    const early = await call(port, "DELETE", `/api/people/${olive.id}`, asToken);

    expect([early.status, early.body.error.message]).toEqual([409, TOKEN_DELETES_ONLY_SWITCHED_OFF]);
    expect((await call(port, "DELETE", `/api/people/${ed.id}`, asToken)).status).toBe(200);
    expect(logText(logs)).toContain("The server's access token removed Ed Editor (Editor); they were signed out.");
    expect(server.install!.store.read().tombstones).toEqual([expect.objectContaining({ issuer: ISSUER, subject: "ed-subject", removedBy: null })]);
    expect((await call(port, "GET", "/api/people/by-identity?subject=ed-subject", asToken)).status).toBe(404);
    // The last owner who can sign in stays: Olive goes off, then Sam can't.
    expect((await call(port, "PATCH", `/api/people/${olive.id}`, { ...asToken, body: { disabled: true } })).status).toBe(200);
    const last = await call(port, "PATCH", `/api/people/${sam}`, { ...asToken, body: { disabled: true } });

    expect(last.status).toBe(409);
    expect((await call(port, "GET", "/api/account", { cookie: owner })).status).toBe(200);
    // Still nothing that grants.
    for (const answer of [
      await call(port, "POST", "/api/people/invitations", { ...asToken, body: { email: "cy@example.com", role: "owner" } }),
      await call(port, "POST", `/api/people/${olive.id}/password-link`, asToken),
    ]) {
      expect([answer.status, answer.body.error.message]).toEqual([403, NEEDS_A_PERSON]);
    }
  });
});
