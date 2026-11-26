/**
 * The identity provider signing a subject out (back-channel logout), against
 * real state files: both times only go up; the sessions it ends are those
 * up to a minute after its time, never one made after now; a subject with no
 * account is kept fifteen minutes, once, and refused past 10,000; nothing is
 * ever made, switched on or changed besides.
 */
import { describe, expect, it } from "vitest";
import { createPeople } from "../../src/install/people";
import { openInstallState, PROVIDER_LOGOUT_KEPT_MS, PROVIDER_LOGOUTS_KEPT } from "../../src/install/state";
import { tempDir } from "./helpers";

const ISSUER = "https://id.example.com";

async function opened(start = Date.UTC(2026, 10, 26, 12)) {
  let at = start;
  const store = await openInstallState(tempDir("provider-logout-"));
  const people = createPeople(store, { now: () => at, providerConfigured: true });

  return { store, people, at: () => at, move: (ms: number) => (at += ms) };
}

describe("a logout from the provider", () => {
  it("raises the account's cut-offs, never lowers them, and touches nothing else", async () => {
    const { store, people, at } = await opened();
    const made = await people.signInThroughProvider({ issuer: ISSUER, subject: "pat", name: "Pat", email: null, role: "editor", issuedAt: at() - 1000 });
    const id = made.ok ? made.account.id : "";
    const before = store.read().accounts[0]!;

    // Its time ten seconds ago: sessions up to now end (a minute after it would be later than now).
    expect(await people.providerLogout({ issuer: ISSUER, subject: "pat", issuedAt: at() - 10_000 })).toEqual({ ok: true, account: expect.objectContaining({ id }) });
    expect(store.read().accounts[0]).toEqual({ ...before, providerLogoutAt: at() - 10_000, sessionsValidAfter: at() });
    // An older one: neither goes down.
    await people.providerLogout({ issuer: ISSUER, subject: "pat", issuedAt: at() - 3_600_000 });
    expect(store.read().accounts[0]).toMatchObject({ providerLogoutAt: at() - 10_000, sessionsValidAfter: at(), role: "editor", disabled: false });
    // One from long ago, for a session long over: its cut-off is its time and a minute.
    const fresh = await opened();

    await fresh.people.signInThroughProvider({ issuer: ISSUER, subject: "kim", name: "Kim", email: null, role: "editor", issuedAt: fresh.at() });
    await fresh.people.providerLogout({ issuer: ISSUER, subject: "kim", issuedAt: fresh.at() - 300_000 });
    expect(fresh.store.read().accounts[0]!.sessionsValidAfter).toBe(fresh.at() - 240_000);
    expect(store.read().providerLogouts).toEqual([]);
  });

  it("for a subject with no account: kept once, at its latest time, for fifteen minutes, and refused past 10,000; no account is made", async () => {
    const { store, people, at, move } = await opened();

    await people.providerLogout({ issuer: ISSUER, subject: "newcomer", issuedAt: at() - 5000 });
    await people.providerLogout({ issuer: ISSUER, subject: "newcomer", issuedAt: at() - 1000 });
    await people.providerLogout({ issuer: ISSUER, subject: "newcomer", issuedAt: at() - 9000 });
    expect(store.read().providerLogouts).toEqual([{ issuer: ISSUER, subject: "newcomer", at: at() - 1000 }]);
    expect(store.read().accounts).toEqual([]);
    move(PROVIDER_LOGOUT_KEPT_MS);
    await people.providerLogout({ issuer: ISSUER, subject: "another", issuedAt: at() });
    expect(store.read().providerLogouts.map((one) => one.subject)).toEqual(["another"]);
    await store.update((draft) => {
      draft.providerLogouts = Array.from({ length: PROVIDER_LOGOUTS_KEPT }, (_, i) => ({ issuer: ISSUER, subject: `s${i}`, at: at() }));
    });
    expect(await people.providerLogout({ issuer: ISSUER, subject: "one-more", issuedAt: at() })).toEqual({ ok: false, reason: "full" });
    // A subject already kept is still raised.
    expect(await people.providerLogout({ issuer: ISSUER, subject: "s7", issuedAt: at() + 1 })).toEqual({ ok: true, account: null });
  });
});

describe("a logout kept for a link's Connect", () => {
  it("is still there sixteen minutes on, after another logout's write, so a link from before it is refused; gone after twenty-five", async () => {
    const { store, people, at, move } = await opened();
    const sam = await people.createOwner({ password: "correct horse battery staple", name: "Sam", email: "sam@example.com" });
    const signedInAt = at() - 60_000;

    await people.providerLogout({ issuer: ISSUER, subject: "linking", issuedAt: at() });
    move(16 * 60_000);
    // Another subject's logout: its write prunes what is past keeping.
    await people.providerLogout({ issuer: ISSUER, subject: "someone-else", issuedAt: at() });
    expect(store.read().providerLogouts.map((one) => one.subject)).toEqual(["linking", "someone-else"]);
    await expect(people.linkIdentity(sam.id, { issuer: ISSUER, subject: "linking" }, { role: "owner", issuedAt: signedInAt })).rejects.toThrow(/signed that person out after the sign-in this link came from/);
    move(10 * 60_000);
    await people.providerLogout({ issuer: ISSUER, subject: "third", issuedAt: at() });
    expect(store.read().providerLogouts.map((one) => one.subject)).toEqual(["someone-else", "third"]);
    expect(PROVIDER_LOGOUT_KEPT_MS).toBe(25 * 60_000);
  });
});

