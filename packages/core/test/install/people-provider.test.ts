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
import { ACCOUNTS_KEPT, createPeople, type ProviderSignIn } from "../../src/install/people";
import { openInstallState } from "../../src/install/state";
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
