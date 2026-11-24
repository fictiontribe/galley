/**
 * The people on a hosted install, against real state files: the upgrade
 * from a real schema-1 file with one shared password, first run's owner,
 * sign-in, invitations and new-password links (one use, expiry, a newer one
 * cancelling an older one), the last-owner and own-account rules, unique
 * e-mails, the operator's way back in, and that nothing secret is ever in
 * what crosses the API.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join as joinPath } from "node:path";
import { describe, expect, it } from "vitest";
import { GalleyError } from "../../src/errors";
import { INVITATION_DAYS, PASSWORD_LINK_MINUTES } from "../../src/install/accounts";
import { hashPassword, verifyPassword } from "../../src/install/password";
import { ASK_ANOTHER_OWNER, createPeople, LAST_OWNER, LINK_REFUSED, type PeopleService } from "../../src/install/people";
import { openInstallState, sha256Hex, STATE_FILE, type InstallStore } from "../../src/install/state";
import { INSTALL_SCHEMA_VERSION } from "../../src/install/types";
import { tempDir } from "./helpers";

const PASSWORD = "correct horse battery staple";
const OTHER = "another long password here";

/** A clock the test moves. */
function clock(start = Date.UTC(2026, 10, 24, 9)) {
  let at = start;

  return { now: () => at, advance: (ms: number) => (at += ms) };
}

async function opened(): Promise<{ home: string; store: InstallStore; people: PeopleService; time: ReturnType<typeof clock> }> {
  const home = tempDir("people-home-");
  const store = await openInstallState(home);
  const time = clock(Date.now());

  return { home, store, people: createPeople(store, { now: time.now }), time };
}

/** An install with an owner (Sam) and whatever else the test adds, through real invitations. */
async function withOwner() {
  const setup = await opened();
  const owner = await setup.people.createOwner({ password: PASSWORD, name: "Sam Owner", email: "Sam@Example.com" });
  const join = async (email: string, role: "owner" | "editor" | "contributor", name: string) => {
    const { link } = await setup.people.invite(owner.id, { email, role });

    return (await setup.people.useLink(link.code, { password: PASSWORD, name })).account;
  };

  return { ...setup, owner, join };
}

async function refusal(promise: Promise<unknown> | (() => unknown)): Promise<GalleyError> {
  try {
    await (typeof promise === "function" ? promise() : promise);
  } catch (error) {
    if (error instanceof GalleyError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("upgrading from one shared password (layout 1 → 2)", () => {
  it("a real schema-1 file becomes one owner with the same password hash, no name or e-mail, and old cookies stop counting", async () => {
    const home = tempDir("people-upgrade-");
    const hash = await hashPassword(PASSWORD);
    const schema1 = {
      schema: 1,
      createdAt: "2026-10-01T10:00:00.000Z",
      password: { hash, changedAt: "2026-10-02T10:00:00.000Z" },
      setup: { tokenSha256: null, finishedAt: "2026-10-01T10:05:00.000Z", spent: [sha256Hex("an old setup code, used long ago")] },
      sessions: { validAfter: 1_700_000_000_000, revoked: [{ id: "a-signed-out-cookie", until: Date.now() + 60_000 }] },
      site: { root: "site", folder: null, repository: "git@github.com:example/site.git", branch: "main", access: "deploy-key", connectedAt: "2026-10-01T10:04:00.000Z", starter: null },
      liveUrl: "https://www.example.com",
      pendingLiveUrl: null,
      lastBackupAt: null,
      seeded: ["password", "author"],
    };

    writeFileSync(joinPath(home, STATE_FILE), `${JSON.stringify(schema1, null, 2)}\n`, { mode: 0o600 });
    const before = Date.now();
    const store = await openInstallState(home);
    const state = store.read();
    const people = createPeople(store);

    expect(state.schema).toBe(INSTALL_SCHEMA_VERSION);
    expect(state).not.toHaveProperty("password");
    expect(state.accounts).toEqual([
      expect.objectContaining({ name: "", email: "", role: "owner", passwordHash: hash, passwordChangedAt: "2026-10-02T10:00:00.000Z", disabled: false, incomplete: true, lastSeenAt: null }),
    ]);
    expect(state.links).toEqual([]);
    // Everything else comes along as it was.
    expect(state).toMatchObject({ site: schema1.site, liveUrl: schema1.liveUrl, seeded: schema1.seeded, setup: schema1.setup });
    // A cookie from before the upgrade carries no person; whatever it was, it no longer counts.
    expect(state.sessions.validAfter).toBeGreaterThanOrEqual(before);
    expect(store.sessionValid({ id: "x", issuedAt: before - 1 })).toBe(false);
    // The same password still signs in — without an e-mail, the one way the upgraded owner can.
    expect(people.signInWith()).toBe("password");
    expect(await people.verify(null, PASSWORD)).toMatchObject({ ok: true, account: { role: "owner", incomplete: true } });
    expect(await people.verify("", PASSWORD)).toMatchObject({ ok: false });
    expect(store.hasOwner()).toBe(true);
    // The old file stays beside the new one, in case the new version has to be rolled back.
    expect(JSON.parse(readFileSync(joinPath(home, `${STATE_FILE}.schema-1.bak`), "utf8"))).toEqual(schema1);
    // And it was written: a restart reads layout 2 as it is.
    expect(JSON.parse(readFileSync(joinPath(home, STATE_FILE), "utf8")).schema).toBe(INSTALL_SCHEMA_VERSION);
  });

  it("an install that had no password yet gets no account: first run makes the owner", async () => {
    const home = tempDir("people-upgrade-");

    writeFileSync(
      joinPath(home, STATE_FILE),
      JSON.stringify({ schema: 1, createdAt: "2026-10-01T10:00:00.000Z", password: null, setup: { tokenSha256: sha256Hex("a setup code still waiting 0123456"), finishedAt: null }, sessions: { validAfter: 0, revoked: [] }, site: null, liveUrl: null, pendingLiveUrl: null, lastBackupAt: null, seeded: [] }),
      { mode: 0o600 }
    );
    const store = await openInstallState(home);

    expect(store.read().accounts).toEqual([]);
    expect(store.hasOwner()).toBe(false);
    // The setup link still waiting keeps working.
    expect(store.setupCodeMatches("a setup code still waiting 0123456")).toBe(true);
  });
});

describe("first run's owner", () => {
  it("is complete with a name and e-mail, spends the setup code, and there is only ever one first owner", async () => {
    const { store, people } = await opened();

    await store.setSetupCode({ plain: "the-setup-code-for-this-test-0123" });
    const owner = await people.createOwner({ password: PASSWORD, name: "  Sam   Owner ", email: " Sam@Example.COM " });

    expect(owner).toMatchObject({ name: "Sam Owner", email: "sam@example.com", role: "owner", disabled: false });
    expect(owner).not.toHaveProperty("incomplete");
    expect(store.setupCodeMatches("the-setup-code-for-this-test-0123")).toBe(false);
    expect(store.setupCodeSpent({ plain: "the-setup-code-for-this-test-0123" })).toBe(true);
    expect(people.signInWith()).toBe("email");
    expect((await refusal(people.createOwner({ password: PASSWORD }))).message).toMatch(/has an owner already/);
  });

  it("without a name or e-mail is incomplete, and fills them in later (a different e-mail needs the password)", async () => {
    const { people } = await opened();
    const owner = await people.createOwner({ password: PASSWORD });

    expect(owner).toMatchObject({ name: "", email: "", incomplete: true });
    expect((await refusal(people.updateProfile(owner.id, { name: "Sam", email: "sam@example.com" }))).message).toBe("Type your current password to change your e-mail.");
    expect((await refusal(people.updateProfile(owner.id, { email: "sam@example.com", password: "not the password at all" }))).message).toBe("That isn't your current password.");
    const named = await people.updateProfile(owner.id, { name: "Sam" });

    expect(named).toMatchObject({ name: "Sam", incomplete: true });
    const complete = await people.updateProfile(owner.id, { email: "SAM@example.com", password: PASSWORD });

    expect(complete).toMatchObject({ name: "Sam", email: "sam@example.com" });
    expect(complete).not.toHaveProperty("incomplete");
    // Now the e-mail is how they sign in; the password alone no longer is.
    expect(people.signInWith()).toBe("email");
    expect((await people.verify(null, PASSWORD)).ok).toBe(false);
    expect((await people.verify("sam@example.com", PASSWORD)).ok).toBe(true);
    // The name alone needs no password.
    expect(await people.updateProfile(owner.id, { name: "Sam B" })).toMatchObject({ name: "Sam B" });
  });

  it("refuses names and addresses that can't work", async () => {
    const { people } = await opened();

    expect((await refusal(people.createOwner({ password: "short" }))).message).toMatch(/at least 12 characters/);
    expect((await refusal(people.createOwner({ password: PASSWORD, email: "not an address" }))).message).toMatch(/doesn't look like an e-mail address/);
    expect((await refusal(people.createOwner({ password: PASSWORD, name: "Sam <sam@evil.example>" }))).message).toMatch(/can't contain < or >/);
    expect((await refusal(people.createOwner({ password: PASSWORD, name: "x".repeat(101) }))).message).toMatch(/under 100 characters/);
  });
});

describe("names", () => {
  const ALIKE = ["sam owner", "SAM OWNER", "Ｓａｍ　Ｏｗｎｅｒ", "Sam  Owner", "Sa\u200bm Owner", "Sam\u00a0Owner", "\u202eSam Owner"];
  const taken = (name: string) => `Someone here is already called “${name}”. Add something that tells the two apart, such as a middle initial.`;

  it("are kept without what a reader can't see, on every way a name is set", async () => {
    const { people, owner, join } = await withOwner();

    // Changing your own.
    expect((await people.updateProfile(owner.id, { name: "Sam\u202e Own\u200ber\u2060" })).name).toBe("Sam Owner");
    // Accepting an invitation.
    expect((await join("ed@example.com", "editor", "\ufeffEd\u00ad \u2066Editor\u2069")).name).toBe("Ed Editor");
    // First run's owner, and an owner given a name afterwards.
    const fresh = await opened();

    expect((await fresh.people.createOwner({ password: PASSWORD, name: "Pat\u200b Owner" })).name).toBe("Pat Owner");
    const later = await opened();

    await later.people.createOwner({ password: PASSWORD });
    expect(await later.people.completeOwner({ name: "Lee\u200e Owner", email: "lee@example.com" })).toBe(true);
    expect(later.people.list().accounts[0]).toMatchObject({ name: "Lee Owner" });
  });

  it("keep a joiner where writing needs one", async () => {
    const { people, owner } = await withOwner();

    expect((await people.updateProfile(owner.id, { name: "می‌خواهم 👨‍👩‍👧" })).name).toBe("می‌خواهم 👨‍👩‍👧");
  });

  it("with nothing to see in them are no name", async () => {
    const { people, owner } = await withOwner();

    expect((await refusal(people.updateProfile(owner.id, { name: "\u200b\u202e\u3164" }))).message).toMatch(/Add a name/);
    expect((await refusal(people.updateProfile(owner.id, { name: "x".repeat(5000) }))).message).toMatch(/under 100 characters/);
  });

  it("can't be taken by someone accepting an invitation, and the invitation still works with another name", async () => {
    const { people, owner } = await withOwner();

    for (const name of ALIKE) {
      const { link } = await people.invite(owner.id, { email: "ed@example.com", role: "contributor" });
      const error = await refusal(people.useLink(link.code, { password: PASSWORD, name }));

      expect(error.code, name).toBe("conflict");
      expect(error.message.startsWith("Someone here is already called “"), name).toBe(true);
      // Not spent by the refusal.
      expect(people.checkLink(link.code).kind).toBe("invitation");
      await people.cancelInvitation(owner.id, people.list().invitations[0]!.id);
    }
    const { link } = await people.invite(owner.id, { email: "ed@example.com", role: "contributor" });

    expect((await refusal(people.useLink(link.code, { password: PASSWORD, name: "Sam Owner" }))).message).toBe(taken("Sam Owner"));
    expect((await people.useLink(link.code, { password: PASSWORD, name: "Sam O. (design)" })).account.name).toBe("Sam O. (design)");
  });

  it("can't be changed to someone else's, in any case or width", async () => {
    const { people, owner, join } = await withOwner();
    const ed = await join("ed@example.com", "contributor", "Ed Editor");

    for (const name of ALIKE) expect((await refusal(people.updateProfile(ed.id, { name }))).code, name).toBe("conflict");
    expect((await refusal(people.updateProfile(ed.id, { name: "sam owner" }))).message).toBe(taken("sam owner"));
    expect(people.get(ed.id)?.name).toBe("Ed Editor");
    // The other way round too: an owner can't take a contributor's.
    expect((await refusal(people.updateProfile(owner.id, { name: "ED EDITOR" }))).code).toBe("conflict");
  });

  it("can be kept, and respelt, by the person whose name it is", async () => {
    const { people, owner } = await withOwner();

    expect((await people.updateProfile(owner.id, { name: "Sam Owner" })).name).toBe("Sam Owner");
    expect((await people.updateProfile(owner.id, { name: "SAM OWNER" })).name).toBe("SAM OWNER");
    expect((await people.updateProfile(owner.id, { name: "Sam B Owner" })).name).toBe("Sam B Owner");
  });

  it("that were alike before this rule are left alone until one of them changes", async () => {
    const { people, owner, join, store } = await withOwner();
    const ed = await join("ed@example.com", "editor", "Ed Editor");

    // As a data folder from an earlier version can hold them.
    await store.update((draft) => {
      draft.accounts.find((account) => account.id === ed.id)!.name = "sam owner";
    });
    expect(people.list().accounts.map((account) => account.name).sort()).toEqual(["Sam Owner", "sam owner"]);
    // Each keeps their own, and can save the rest of their details.
    expect((await people.updateProfile(ed.id, { name: "sam owner" })).name).toBe("sam owner");
    expect((await people.updateProfile(owner.id, { name: "Sam Owner" })).name).toBe("Sam Owner");
    // One of them changes: the new name is checked like any other.
    expect((await people.updateProfile(ed.id, { name: "Ed Editor" })).name).toBe("Ed Editor");
    expect((await refusal(people.updateProfile(ed.id, { name: "Sam Owner" }))).code).toBe("conflict");
  });

  it("first run's owner can't take a name someone here has, and starting values leave such a name for the owner to choose", async () => {
    const setup = await opened();

    // An install whose owner is gone but whose people remain, as a state file edited by hand can be.
    await setup.store.update((draft) => {
      draft.accounts.push({ id: "kept1", name: "Kit Keeper", email: "kit@example.com", role: "editor", passwordHash: "x", passwordChangedAt: "2026-11-01T00:00:00.000Z", createdAt: "2026-11-01T00:00:00.000Z", lastSeenAt: null, disabled: false, incomplete: false, sessionsValidAfter: 0 });
    });
    expect((await refusal(setup.people.createOwner({ password: PASSWORD, name: "kit keeper" }))).message).toBe(taken("kit keeper"));
    const owner = await setup.people.createOwner({ password: PASSWORD });

    // The e-mail is taken up; the name, which is Kit's, is not.
    expect(await setup.people.completeOwner({ name: "KIT KEEPER", email: "owner@example.com" })).toBe(true);
    expect(setup.people.get(owner.id)).toMatchObject({ name: "", email: "owner@example.com", incomplete: true });
  });
});

describe("signing in", () => {
  it("the same answer for an unknown e-mail, a wrong password and a switched-off account; a stand-in hash is checked when there's no account", async () => {
    const { people, owner, join } = await withOwner();
    const editor = await join("ed@example.com", "editor", "Ed");

    expect(await people.verify("SAM@example.com ", PASSWORD)).toMatchObject({ ok: true, account: { id: owner.id } });
    expect(await people.verify("nobody@example.com", PASSWORD)).toEqual({ ok: false, reason: "unknown", account: null });
    expect(await people.verify("sam@example.com", OTHER)).toMatchObject({ ok: false, reason: "wrong" });
    await people.change(owner.id, editor.id, { disabled: true });
    expect(await people.verify("ed@example.com", PASSWORD)).toMatchObject({ ok: false, reason: "disabled" });
    // Without an e-mail only an account that has none can sign in.
    expect((await people.verify(null, PASSWORD)).ok).toBe(false);
    // An unknown address costs a real scrypt check: about as long as a wrong password, never near-instant.
    const started = performance.now();

    await people.verify("nobody@example.com", PASSWORD);
    const unknown = performance.now() - started;
    const again = performance.now();

    await people.verify("sam@example.com", OTHER);
    const wrong = performance.now() - again;

    expect(unknown).toBeGreaterThan(wrong / 4);
  });

  it("writes down when someone last signed in", async () => {
    const { people, owner } = await withOwner();

    expect(people.get(owner.id)?.lastSeenAt).toBeNull();
    await people.noteSignIn(owner.id);
    expect(people.get(owner.id)?.lastSeenAt).toEqual(expect.any(String));
  });
});

describe("invitations", () => {
  it("make an account once, with the role they were made for; the same refusal for a used, unknown or malformed code", async () => {
    const { people, owner, store } = await withOwner();
    const { invitation, link } = await people.invite(owner.id, { email: "Ed@Example.com", role: "editor" });

    expect(invitation).toMatchObject({ email: "ed@example.com", role: "editor", invitedBy: "Sam Owner", emailed: false });
    expect(Date.parse(invitation.expiresAt) - Date.parse(invitation.createdAt)).toBe(INVITATION_DAYS * 24 * 60 * 60_000);
    expect(link.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(people.checkLink(link.code)).toEqual({ kind: "invitation", email: "ed@example.com", role: "editor", invitedBy: "Sam Owner", expiresAt: invitation.expiresAt });
    expect(people.list().invitations).toEqual([invitation]);

    // A name is needed; a refused password or a missing name spends nothing.
    expect((await refusal(people.useLink(link.code, { password: PASSWORD }))).message).toMatch(/Add a name/);
    expect((await refusal(people.useLink(link.code, { password: "short", name: "Ed" }))).message).toMatch(/at least 12 characters/);
    const used = await people.useLink(link.code, { password: PASSWORD, name: "Ed Editor" });

    expect(used).toMatchObject({ kind: "invitation", account: { name: "Ed Editor", email: "ed@example.com", role: "editor", disabled: false } });
    expect(people.list().invitations).toEqual([]);
    expect(store.read().links).toEqual([]);
    for (const code of [link.code, "A".repeat(43), "short", "", link.code.toLowerCase()]) {
      expect((await refusal(() => people.checkLink(code))).message).toBe(LINK_REFUSED);
      expect((await refusal(people.useLink(code, { password: PASSWORD, name: "Again" }))).message).toBe(LINK_REFUSED);
    }
  });

  it("run out after their time, and can be taken back", async () => {
    const { people, owner, time } = await withOwner();
    const late = await people.invite(owner.id, { email: "late@example.com", role: "contributor" });
    const back = await people.invite(owner.id, { email: "back@example.com", role: "contributor" });

    expect(await people.cancelInvitation(owner.id, back.invitation.id)).toMatchObject({ email: "back@example.com" });
    expect((await refusal(() => people.checkLink(back.link.code))).message).toBe(LINK_REFUSED);
    expect((await refusal(people.cancelInvitation(owner.id, back.invitation.id))).code).toBe("not-found");
    time.advance(INVITATION_DAYS * 24 * 60 * 60_000 - 1000);
    expect(people.checkLink(late.link.code).kind).toBe("invitation");
    time.advance(2000);
    expect((await refusal(() => people.checkLink(late.link.code))).message).toBe(LINK_REFUSED);
    expect((await refusal(people.useLink(late.link.code, { password: PASSWORD, name: "Late" }))).message).toBe(LINK_REFUSED);
    expect(people.list().invitations).toEqual([]);
    // An invitation that ran out no longer blocks a new one to the same address.
    expect((await people.invite(owner.id, { email: "late@example.com", role: "contributor" })).invitation.email).toBe("late@example.com");
  });

  it("are refused, in plain words, for an e-mail that has an account or an open invitation, whatever the letter case", async () => {
    const { people, owner, join } = await withOwner();

    await join("ed@example.com", "editor", "Ed");
    await people.invite(owner.id, { email: "open@example.com", role: "editor" });
    expect((await refusal(people.invite(owner.id, { email: "SAM@EXAMPLE.COM", role: "editor" }))).message).toBe("Someone with that e-mail already has an account here.");
    expect((await refusal(people.invite(owner.id, { email: "Ed@example.com", role: "editor" }))).message).toBe("Someone with that e-mail already has an account here.");
    expect((await refusal(people.invite(owner.id, { email: "OPEN@example.com", role: "owner" }))).message).toMatch(/has an open invitation already/);
    expect((await refusal(people.invite(owner.id, { email: "x@example.com", role: "admin" as never }))).message).toMatch(/Choose a role/);
  });

  it("need an owner who has said who they are", async () => {
    const { people } = await opened();
    const owner = await people.createOwner({ password: PASSWORD });

    expect((await refusal(people.invite(owner.id, { email: "ed@example.com", role: "editor" }))).message).toMatch(/Add your name and e-mail to your account first/);
  });
});

describe("new-password links", () => {
  it("set the password once, end that person's other sessions, and a newer link cancels the older", async () => {
    const { people, owner, join, store, time } = await withOwner();
    const editor = await join("ed@example.com", "editor", "Ed");
    const first = await people.passwordLink(owner.id, editor.id);
    const second = await people.passwordLink(owner.id, editor.id);
    const before = { id: "eds-browser", issuedAt: store.nextIssuedAt(time.now(), editor.id), accountId: editor.id };
    const owners = { id: "sams-browser", issuedAt: store.nextIssuedAt(time.now(), owner.id), accountId: owner.id };

    expect(Date.parse(second.link.expiresAt) - time.now()).toBe(PASSWORD_LINK_MINUTES * 60_000);
    expect((await refusal(() => people.checkLink(first.link.code))).message).toBe(LINK_REFUSED);
    expect(people.checkLink(second.link.code)).toEqual({ kind: "password", email: "ed@example.com", expiresAt: second.link.expiresAt });
    // The old password works until the link is used.
    expect((await people.verify("ed@example.com", PASSWORD)).ok).toBe(true);
    expect(store.sessionValid(before)).toBe(true);
    time.advance(1000);
    const used = await people.useLink(second.link.code, { password: OTHER });

    expect(used).toMatchObject({ kind: "password", account: { id: editor.id } });
    expect((await people.verify("ed@example.com", PASSWORD)).ok).toBe(false);
    expect((await people.verify("ed@example.com", OTHER)).ok).toBe(true);
    expect(store.sessionValid(before)).toBe(false);
    expect(store.sessionValid(owners)).toBe(true);
    expect((await refusal(people.useLink(second.link.code, { password: PASSWORD }))).message).toBe(LINK_REFUSED);
    // Invitations aren't listed with them, and a link never shows up in the People list.
    expect(people.list().invitations).toEqual([]);
  });

  it("run out after an hour, and stop working when the account is switched off or removed", async () => {
    const { people, owner, join, time } = await withOwner();
    const ed = await join("ed@example.com", "editor", "Ed");
    const cy = await join("cy@example.com", "contributor", "Cy");
    const expiring = await people.passwordLink(owner.id, owner.id);
    const off = await people.passwordLink(owner.id, ed.id);
    const gone = await people.passwordLink(owner.id, cy.id);

    await people.change(owner.id, ed.id, { disabled: true });
    await people.remove(owner.id, cy.id);
    expect((await refusal(() => people.checkLink(off.link.code))).message).toBe(LINK_REFUSED);
    expect((await refusal(() => people.checkLink(gone.link.code))).message).toBe(LINK_REFUSED);
    // Switched back on, the old link stays dead: it was ended with the switch-off.
    await people.change(owner.id, ed.id, { disabled: false });
    expect((await refusal(() => people.checkLink(off.link.code))).message).toBe(LINK_REFUSED);
    // A switched-off account gets no new link from an owner.
    await people.change(owner.id, ed.id, { disabled: true });
    expect((await refusal(people.passwordLink(owner.id, ed.id))).message).toMatch(/switched off/);
    time.advance(PASSWORD_LINK_MINUTES * 60_000 + 1);
    expect((await refusal(people.useLink(expiring.link.code, { password: OTHER }))).message).toBe(LINK_REFUSED);
  });

  it("“forgot my password” makes one only for an enabled account, and says nothing either way", async () => {
    const { people, join, owner } = await withOwner();
    const ed = await join("ed@example.com", "editor", "Ed");

    expect(await people.forgot("nobody@example.com")).toBeNull();
    expect(await people.forgot("not even an address")).toBeNull();
    const made = await people.forgot(" ED@example.com ");

    expect(made?.account.id).toBe(ed.id);
    expect(people.checkLink(made!.link.code).kind).toBe("password");
    await people.change(owner.id, ed.id, { disabled: true });
    expect(await people.forgot("ed@example.com")).toBeNull();
  });
});

describe("roles, switching off and removing", () => {
  it("the last owner who can still sign in can't be demoted, switched off or removed; nobody changes their own account here", async () => {
    const { people, owner, join, store } = await withOwner();
    const second = await join("second@example.com", "owner", "Second Owner");
    const ed = await join("ed@example.com", "editor", "Ed");

    // Nobody changes their own role, switches themselves off or removes themselves.
    for (const attempt of [people.change(owner.id, owner.id, { role: "editor" }), people.change(owner.id, owner.id, { disabled: true }), people.remove(owner.id, owner.id)]) {
      expect((await refusal(attempt)).message).toBe(ASK_ANOTHER_OWNER);
    }
    // Two owners: one can be switched off. Then the other is the last one who can sign in.
    const { before, after } = await people.change(owner.id, second.id, { disabled: true });

    expect(before.disabled).toBe(false);
    expect(after.disabled).toBe(true);
    for (const attempt of [people.change(ed.id, owner.id, { role: "editor" }), people.change(ed.id, owner.id, { disabled: true }), people.remove(ed.id, owner.id)]) {
      expect((await refusal(attempt)).message).toBe(LAST_OWNER);
    }
    // A switched-off owner doesn't count as one who can sign in, but can be removed.
    expect(await people.remove(owner.id, second.id)).toMatchObject({ id: second.id });
    expect(people.get(second.id)).toBeNull();
    // Roles change; the store is the one place that says so.
    expect((await people.change(owner.id, ed.id, { role: "contributor" })).after.role).toBe("contributor");
    expect(people.session(ed.id)).toMatchObject({ role: "contributor", access: ["edit"] });
    expect(people.session(owner.id)).toMatchObject({ role: "owner", access: ["edit", "publish", "manage"] });
    expect(store.read().accounts.map((account) => account.id)).toEqual([owner.id, ed.id]);
  });

  it("switching off or removing ends that person's sessions at once, and tells whatever is bound to a session", async () => {
    const { people, owner, join, store, time } = await withOwner();
    const ed = await join("ed@example.com", "editor", "Ed");
    const cy = await join("cy@example.com", "contributor", "Cy");
    const session = (accountId: string) => ({ id: `browser-${accountId}`, issuedAt: store.nextIssuedAt(time.now(), accountId), accountId });
    const eds = session(ed.id);
    const cys = session(cy.id);
    const sams = session(owner.id);
    let told = 0;

    store.onSessionsChanged(() => (told += 1));
    time.advance(10);
    await people.change(owner.id, ed.id, { disabled: true });
    expect(store.sessionValid(eds)).toBe(false);
    // Switched back on, an old session stays ended: they sign in again.
    await people.change(owner.id, ed.id, { disabled: false });
    expect(store.sessionValid(eds)).toBe(false);
    await people.remove(owner.id, cy.id);
    expect(store.sessionValid(cys)).toBe(false);
    expect(store.sessionValid(sams)).toBe(true);
    // Signing one person out everywhere.
    await people.signOut(owner.id);
    expect(store.sessionValid(sams)).toBe(false);
    expect(store.sessionValid(session(owner.id))).toBe(true);
    expect(told).toBe(3);
  });
});

describe("the operator's way back in", () => {
  it("a new-password link for the only owner, or the owner named by e-mail; a switched-off owner is switched back on; nobody else is touched", async () => {
    const { people, owner, join, store } = await withOwner();
    const ed = await join("ed@example.com", "editor", "Ed");
    const before = JSON.stringify(store.read().accounts.find((account) => account.id === ed.id));
    const only = await people.rescue();

    expect(only?.account.id).toBe(owner.id);
    expect(people.checkLink(only!.link.code).kind).toBe("password");
    const second = await join("second@example.com", "owner", "Second");

    expect((await refusal(people.rescue())).message).toMatch(/has 2 owners. Say whose password to reset with --email/);
    expect((await refusal(people.rescue("ed@example.com"))).message).toMatch(/No owner of this editor signs in with that e-mail/);
    await people.change(owner.id, second.id, { disabled: true });
    const named = await people.rescue(" SECOND@example.com ");

    expect(named?.account.id).toBe(second.id);
    expect(people.get(second.id)?.disabled).toBe(false);
    // The first rescue link for Sam is untouched by Second's.
    expect(people.checkLink(only!.link.code).kind).toBe("password");
    expect(JSON.stringify(store.read().accounts.find((account) => account.id === ed.id))).toBe(before);
    expect(store.read().links.every((link) => link.createdBy === null || link.kind === "invitation")).toBe(true);
  });

  it("has nothing to do without an owner: first run makes one", async () => {
    const { people } = await opened();

    expect(await people.rescue()).toBeNull();
  });
});

describe("nothing secret crosses the API", () => {
  it("no hash and no code in the list, a session or a link's preview; the state file keeps only hashes", async () => {
    const { home, people, owner, join } = await withOwner();
    const ed = await join("ed@example.com", "editor", "Ed");
    const invited = await people.invite(owner.id, { email: "new@example.com", role: "contributor" });
    const reset = await people.passwordLink(owner.id, ed.id);
    const said = JSON.stringify([people.list(), people.session(owner.id), people.session(ed.id), people.get(ed.id), people.checkLink(invited.link.code), people.checkLink(reset.link.code), invited.invitation]);
    const file = readFileSync(joinPath(home, STATE_FILE), "utf8");

    for (const secret of [invited.link.code, reset.link.code, sha256Hex(invited.link.code), sha256Hex(reset.link.code), PASSWORD, "scrypt$"]) expect(said).not.toContain(secret);
    for (const secret of [invited.link.code, reset.link.code, PASSWORD]) expect(file).not.toContain(secret);
    expect(file).toContain(sha256Hex(invited.link.code));
    expect(await verifyPassword(PASSWORD, JSON.parse(file).accounts[0].passwordHash)).toBe(true);
    expect(existsSync(joinPath(home, STATE_FILE))).toBe(true);
  });
});
