/**
 * Accounts made and found by a sign-in through the identity provider,
 * against real state files: the same subject at another issuer is another
 * account; the provider's logout time refuses a sign-in from before it; the
 * account limit refuses a new one and leaves a state the next start reads;
 * an owner the provider demotes stays an owner while they are the last; the
 * first owner is named only while there is none; and the starting values
 * never complete an owner who signs in through the provider.
 */
import { describe, expect, it } from "vitest";
import { GalleyError } from "../../src/errors";
import { ACCOUNTS_KEPT, createPeople, NO_PASSWORD_FOR_PROVIDER_ACCOUNT, REMOVED_LIST_FULL_FOR_TAKE_OFF, type ProviderSignIn } from "../../src/install/people";
import { openInstallState, TOMBSTONES_KEPT } from "../../src/install/state";
import { tempDir } from "./helpers";

const ISSUER = "https://id.example.com";
const at = Date.UTC(2026, 10, 25, 12);

function input(over: Partial<ProviderSignIn> = {}): ProviderSignIn {
  return { issuer: ISSUER, subject: "sub-1", name: "Pat", email: "pat@example.com", role: "editor", issuedAt: at, ...over };
}

async function opened() {
  const home = tempDir("people-provider-");
  const store = await openInstallState(home);

  return { home, store, people: createPeople(store) };
}

describe("a sign-in through the provider", () => {
  it("finds the account by issuer and subject: another issuer's same subject is another account, with no name or e-mail of the first's", async () => {
    const { people } = await opened();
    const first = await people.signInThroughProvider(input());
    const again = await people.signInThroughProvider(input());
    const elsewhere = await people.signInThroughProvider(input({ issuer: "https://other.example.com" }));

    expect(first).toMatchObject({ ok: true, created: true, account: { name: "Pat", email: "pat@example.com", role: "editor" } });
    expect(again).toMatchObject({ ok: true, created: false });
    expect(again.ok && first.ok && again.account.id).toBe(first.ok && first.account.id);
    expect(elsewhere).toMatchObject({ ok: true, created: true, account: { name: "", email: "" } });
    expect(elsewhere.ok && elsewhere.notes).toEqual(["its name is taken here, so it was left without one", "its e-mail is another account's here, so it has none"]);
  });

  it("is refused when the provider signed that subject out at or after the token's issue, for an account and for a subject with none", async () => {
    const { store, people } = await opened();
    const made = await people.signInThroughProvider(input());

    await store.update((draft) => {
      draft.accounts[0]!.providerLogoutAt = at;
      draft.providerLogouts.push({ issuer: ISSUER, subject: "sub-2", at: at + 1000 });
    });
    expect(await people.signInThroughProvider(input())).toMatchObject({ ok: false, reason: "signed-out", signedOutAt: at, account: { id: made.ok ? made.account.id : "" } });
    expect(await people.signInThroughProvider(input({ issuedAt: at + 1000 }))).toMatchObject({ ok: true });
    expect(await people.signInThroughProvider(input({ subject: "sub-2", issuedAt: at + 1000 }))).toMatchObject({ ok: false, reason: "signed-out", account: null });
    expect(await people.signInThroughProvider(input({ subject: "sub-2", name: "Other", email: null, issuedAt: at + 2000 }))).toMatchObject({ ok: true, created: true });
  });

  it("at the account limit, a new subject is refused and nothing is written; the state still opens", async () => {
    const { home, store, people } = await opened();

    await store.update((draft) => {
      for (let i = draft.accounts.length; i < ACCOUNTS_KEPT; i += 1) {
        draft.accounts.push({ id: `a${i}`, name: "", email: "", role: "contributor", passwordHash: null, passwordChangedAt: "", createdAt: "", lastSeenAt: null, disabled: false, incomplete: true, sessionsValidAfter: 0, identity: { issuer: ISSUER, subject: `s${i}` } });
      }
    });
    expect(await people.signInThroughProvider(input({ subject: "one-too-many" }))).toEqual({ ok: false, reason: "full", account: null });
    // Someone already here still signs in.
    expect(await people.signInThroughProvider(input({ subject: "s5", name: null, email: null }))).toMatchObject({ ok: true, created: false });
    expect((await openInstallState(home)).read().accounts).toHaveLength(ACCOUNTS_KEPT);
  });

  it("the role the provider says, except where that leaves no owner who can sign in", async () => {
    const { people } = await opened();

    await people.signInThroughProvider(input({ subject: "owner", name: "Olive", email: null, role: "owner" }));
    const demoted = await people.signInThroughProvider(input({ subject: "owner", name: "Olive", email: null, role: "editor" }));

    expect(demoted).toMatchObject({ ok: true, account: { role: "owner" } });
    expect(demoted.ok && demoted.notes).toEqual(["the provider says editor, but it is the last owner here, so it stays an owner"]);
    await people.signInThroughProvider(input({ subject: "second", name: "Sid", email: null, role: "owner" }));
    expect(await people.signInThroughProvider(input({ subject: "owner", name: "Olive", email: null, role: "editor" }))).toMatchObject({ ok: true, account: { role: "editor" } });
  });
});

describe("the first owner named by subject", () => {
  it("is made only while there is no owner, with no password; the starting values never complete them", async () => {
    const { store, people } = await opened();
    const named = await people.nameFirstOwner(ISSUER, "the-owner");

    expect(named).toMatchObject({ role: "owner", name: "", email: "", incomplete: true });
    expect(store.read().accounts[0]).toMatchObject({ passwordHash: null, identity: { issuer: ISSUER, subject: "the-owner" } });
    expect(await people.nameFirstOwner(ISSUER, "someone-else")).toBeNull();
    expect(store.read().accounts).toHaveLength(1);
    await people.completeOwner({ name: "From The Environment", email: "env@example.com" });
    expect(store.read().accounts[0]).toMatchObject({ name: "", email: "" });
  });
});

describe("a password for someone who signs in through the provider", () => {
  it("is never given while a provider is set up: not by \"forgot\", an owner's link, the server's way back in (which signs them in instead), or a link made before", async () => {
    const { store } = await opened();
    const people = createPeople(store, { providerConfigured: true });
    const sam = await people.createOwner({ password: "correct horse battery staple", name: "Sam", email: "sam@example.com" });
    const made = await people.signInThroughProvider(input({ role: "owner" }));
    const pat = made.ok ? made.account.id : "";
    const refused = async (work: Promise<unknown>) => {
      const error = await work.then(() => null, (caught: unknown) => caught);

      expect(error).toBeInstanceOf(GalleyError);
      expect((error as GalleyError).message).toBe(NO_PASSWORD_FOR_PROVIDER_ACCOUNT);
    };

    expect(await people.forgot("pat@example.com")).toBeNull();
    await refused(people.passwordLink(sam.id, pat));
    // The server's way back in signs them in without a password.
    const rescued = (await people.rescue("pat@example.com"))!;

    expect(people.checkLink(rescued.link.code).kind).toBe("sign-in");
    // A link made while no provider was set up, used once one is.
    const before = createPeople(store);
    const { link } = await before.passwordLink(sam.id, pat);

    await refused(people.useLink(link.code, { password: "a password of their own here" }));
    expect(store.read().accounts.find((account) => account.id === pat)!.passwordHash).toBeNull();
    // With the provider taken away, the same link works, as for anyone.
    expect((await before.useLink(link.code, { password: "a password of their own here" })).kind).toBe("password");
    // Someone who signs in with a password is not affected.
    expect(await people.forgot("sam@example.com")).not.toBeNull();
  });
});

describe("linking and rekeying (the server's commands)", () => {
  it("rekey refuses the same issuer, and moves recent logouts with the rest; a subject is checked before anything is linked", async () => {
    const { store, people } = await opened();
    const sam = await people.createOwner({ password: "correct horse battery staple", name: "Sam", email: "sam@example.com" });

    await expect(people.linkIdentity(sam.id, { issuer: ISSUER, subject: "bad\nsubject" })).rejects.toThrow(/1 to 255 printable characters/);
    expect(store.read().accounts[0]!.passwordHash).not.toBeNull();
    await expect(people.rekeyIssuer(ISSUER, ISSUER)).rejects.toThrow(/the same issuer/);
    await store.update((draft) => {
      draft.providerLogouts.push({ issuer: ISSUER, subject: "someone", at: at });
    });
    expect(await people.rekeyIssuer(ISSUER, "https://new.example.com")).toEqual({ accounts: 0, removed: 0 });
    expect(store.read().providerLogouts).toEqual([{ issuer: "https://new.example.com", subject: "someone", at }]);
  });
});

describe("taking the provider off from a recovery session, with the list of removed accounts full", () => {
  it("is refused with a sentence that says to let some back first, and nothing changes", async () => {
    const { store, people } = await opened();
    const made = await people.signInThroughProvider(input({ role: "owner" }));
    const id = made.ok ? made.account.id : "";

    await store.update((draft) => {
      draft.tombstones = Array.from({ length: TOMBSTONES_KEPT }, (_, i) => ({ id: `t${i}`, issuer: ISSUER, subject: `gone-${i}`, removedAt: "2026-11-01T10:00:00.000Z", removedBy: null }));
    });
    await expect(people.removeIdentity(id, "a brand new long password")).rejects.toThrow(REMOVED_LIST_FULL_FOR_TAKE_OFF);
    expect(REMOVED_LIST_FULL_FOR_TAKE_OFF).toMatch(/Let some of the removed back first \(People, under Removed, or `galley accounts unremove` on the server\)/);
    expect(store.read().accounts.find((account) => account.id === id)).toMatchObject({ identity: { subject: "sub-1" }, passwordHash: null });
  });
});


describe("a wrong link put right on the server (linkIdentity with replace)", () => {
  async function linkedWrongly() {
    const { store, people } = await opened();
    const sam = await people.createOwner({ password: "correct horse battery staple", name: "Sam", email: "sam@example.com" });

    await people.linkIdentity(sam.id, { issuer: ISSUER, subject: "wrong-subject" });
    return { store, people, sam };
  }

  it("remembers the subject it replaces as removed, by whoever runs the server: it can't sign in or be linked until it is let back", async () => {
    const { store, people, sam } = await linkedWrongly();
    const { replaced } = await people.linkIdentity(sam.id, { issuer: ISSUER, subject: "right-subject" }, { replace: true });

    expect(replaced).toEqual({ issuer: ISSUER, subject: "wrong-subject", removed: true });
    expect(people.removed()).toEqual([expect.objectContaining({ issuer: ISSUER, subject: "wrong-subject", removedBy: null })]);
    expect(store.read().accounts.find((account) => account.id === sam.id)!.identity).toEqual({ issuer: ISSUER, subject: "right-subject" });
    expect(await people.signInThroughProvider(input({ subject: "wrong-subject", issuedAt: Date.now() }))).toMatchObject({ ok: false, reason: "removed", account: null });
    const ed = await people.signInThroughProvider(input({ subject: "ed-subject", name: "Ed", email: "ed@example.com", issuedAt: Date.now() }));

    await expect(people.linkIdentity(ed.ok ? ed.account.id : "", { issuer: ISSUER, subject: "wrong-subject" }, { replace: true })).rejects.toThrow(/list of removed accounts/);
    await people.unremove(people.removed()[0]!.id);
    expect(await people.signInThroughProvider(input({ subject: "wrong-subject", issuedAt: Date.now() }))).toMatchObject({ ok: true, created: true });
  });

  it("with the list of removed accounts full, is refused with the sentence that says to let some back first, and nothing changes", async () => {
    const { store, people, sam } = await linkedWrongly();

    await store.update((draft) => {
      draft.tombstones = Array.from({ length: TOMBSTONES_KEPT }, (_, i) => ({ id: `t${i}`, issuer: ISSUER, subject: `gone-${i}`, removedAt: "2026-11-01T10:00:00.000Z", removedBy: null }));
    });
    const before = store.read();

    await expect(people.linkIdentity(sam.id, { issuer: ISSUER, subject: "right-subject" }, { replace: true })).rejects.toThrow(REMOVED_LIST_FULL_FOR_TAKE_OFF);
    expect(store.read()).toEqual(before);
  });

  it("binding the same subject again adds nothing to the list; one under another issuer than the accounts hold is refused, pointing to rekey, and nothing changes", async () => {
    const { store, people, sam } = await linkedWrongly();

    expect((await people.linkIdentity(sam.id, { issuer: ISSUER, subject: "wrong-subject" }, { replace: true })).replaced).toBeNull();
    expect(store.read().tombstones).toEqual([]);
    const before = store.read();

    await expect(people.linkIdentity(sam.id, { issuer: `${ISSUER}/`, subject: "right-subject" }, { replace: true })).rejects.toThrow(
      `this install has accounts, or removed accounts, from another identity provider: “${ISSUER}”. Accounts are kept by issuer, byte for byte, so nothing was linked.`
    );
    expect(store.read()).toEqual(before);
  });
});

describe("a password given while no provider was set up", () => {
  async function gap() {
    const { store } = await opened();
    const plain = createPeople(store);
    const sam = await plain.createOwner({ password: "correct horse battery staple", name: "Sam", email: "sam@example.com" });
    const withProvider = createPeople(store, { providerConfigured: true });
    const made = await withProvider.signInThroughProvider(input());
    const pat = made.ok ? made.account.id : "";

    // As a link used while no provider was set up would leave it: Pat's identity, and a password (Sam's, to keep it short).
    await store.update((draft) => {
      draft.accounts.find((account) => account.id === pat)!.passwordHash = draft.accounts.find((account) => account.id === sam.id)!.passwordHash;
    });
    return { store, plain, withProvider, pat };
  }

  it("signs in by e-mail without a provider, never while one is set up, right password or wrong; a password account does either way", async () => {
    const { plain, withProvider } = await gap();

    expect(await plain.verify("pat@example.com", "correct horse battery staple")).toMatchObject({ ok: true });
    expect(await withProvider.verify("pat@example.com", "correct horse battery staple")).toMatchObject({ ok: false, reason: "no-password" });
    expect(await withProvider.verify("pat@example.com", "not the password at all")).toMatchObject({ ok: false, reason: "no-password" });
    expect(await withProvider.verify("sam@example.com", "correct horse battery staple")).toMatchObject({ ok: true });
  });

  it("is taken off by dropProviderAccountPasswords, with open new-password links and every session, only while a provider is set up", async () => {
    const { store, plain, withProvider, pat } = await gap();
    const before = store.read().accounts.find((account) => account.id === pat)!;

    expect(await plain.dropProviderAccountPasswords()).toBe(0);
    expect(store.read().accounts.find((account) => account.id === pat)!.passwordHash).not.toBeNull();
    await store.update((draft) => {
      draft.links.push({ id: "pl", kind: "password", codeSha256: "0".repeat(64), email: "pat@example.com", role: null, accountId: pat, createdBy: null, createdByName: "", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), emailed: false });
    });
    expect(await withProvider.dropProviderAccountPasswords()).toBe(1);
    const after = store.read();

    expect(after.accounts.find((account) => account.id === pat)).toMatchObject({ passwordHash: null, identity: { issuer: ISSUER, subject: "sub-1" } });
    expect(after.accounts.find((account) => account.id === pat)!.sessionsValidAfter).toBeGreaterThan(before.sessionsValidAfter);
    expect(after.links.filter((link) => link.accountId === pat)).toEqual([]);
    expect(after.accounts.find((account) => account.email === "sam@example.com")!.passwordHash).not.toBeNull();
    expect(await withProvider.dropProviderAccountPasswords()).toBe(0);
  });
});
