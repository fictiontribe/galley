/**
 * The people as the server's access token may touch them, against real
 * state files: only switching an account off, never on, never a role or an
 * e-mail; deleting only an account already switched off; the last-owner
 * rule; a deleted account that signed in through the provider remembered as
 * removed (once, with who removed it), and a full list refusing the delete;
 * and the token's views, which never hold a name or an e-mail.
 */
import { describe, expect, it } from "vitest";
import { GalleyError } from "../../src/errors";
import { createPeople, LAST_OWNER, REMOVED_LIST_FULL, TOKEN_DELETES_ONLY_SWITCHED_OFF, TOKEN_ONLY_SWITCHES_OFF, type PeopleService } from "../../src/install/people";
import { openInstallState, TOMBSTONES_KEPT, type InstallStore } from "../../src/install/state";
import { tempDir } from "./helpers";

const PASSWORD = "correct horse battery staple";
const ISSUER = "https://id.example.com";

async function refusal(promise: Promise<unknown>): Promise<GalleyError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof GalleyError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

/** Sam (an owner with a password), Ed (an editor) and Olive (an owner), Ed and Olive with identities at the provider, and Pat with one elsewhere. */
async function install(): Promise<{ store: InstallStore; people: PeopleService; sam: string; ed: string; olive: string; pat: string }> {
  const store = await openInstallState(tempDir("people-operator-"));
  const people = createPeople(store);
  const sam = (await people.createOwner({ password: PASSWORD, name: "Sam Owner", email: "sam@example.com" })).id;
  const join = async (email: string, role: "owner" | "editor", name: string) => (await people.useLink((await people.invite(sam, { email, role })).link.code, { password: PASSWORD, name })).account.id;
  const ed = await join("ed@example.com", "editor", "Ed Editor");
  const olive = await join("olive@example.com", "owner", "Olive Owner");
  const pat = await join("pat@example.com", "editor", "Pat Elsewhere");

  await store.update((draft) => {
    for (const [id, issuer, subject] of [
      [ed, ISSUER, "ed-subject"],
      [olive, ISSUER, "olive / subject?#%"],
      [pat, "https://other.example.com", "pat-subject"],
    ] as const) {
      const account = draft.accounts.find((one) => one.id === id)!;

      account.identity = { issuer, subject };
      account.passwordHash = null;
    }
  });
  return { store, people, sam, ed, olive, pat };
}

describe("the server's access token", () => {
  it("only switches an account off: never on, never a role or an e-mail, and never the last owner who can sign in", async () => {
    const { people, ed, olive, sam } = await install();

    for (const input of [{ disabled: false }, { role: "owner" as const }, { email: "x@example.com" }, { disabled: true, role: "editor" as const }, { disabled: true, email: "ed@example.com" }, {}]) {
      const error = await refusal(people.change(null, ed, input));

      expect([error.code, error.message]).toEqual(["forbidden", TOKEN_ONLY_SWITCHES_OFF]);
    }
    expect(people.get(ed)).toMatchObject({ disabled: false, role: "editor" });
    expect((await people.change(null, ed, { disabled: true })).after).toMatchObject({ disabled: true, role: "editor" });
    // Again: nothing to do, and no refusal.
    expect((await people.change(null, ed, { disabled: true })).after.disabled).toBe(true);
    await people.change(null, olive, { disabled: true });
    expect((await refusal(people.change(null, sam, { disabled: true }))).message).toBe(LAST_OWNER);
    expect(people.get(sam)?.disabled).toBe(false);
  });

  it("deletes only an account already switched off; one with an identity is remembered as removed, once, by nobody in the app", async () => {
    const { store, people, ed, sam } = await install();

    expect((await refusal(people.remove(null, ed))).message).toBe(TOKEN_DELETES_ONLY_SWITCHED_OFF);
    expect(people.get(ed)).not.toBeNull();
    await people.change(null, ed, { disabled: true });
    await people.remove(null, ed);
    expect(people.get(ed)).toBeNull();
    expect(store.read().tombstones).toEqual([{ id: expect.stringMatching(/^[A-Za-z0-9_-]+$/), issuer: ISSUER, subject: "ed-subject", removedAt: expect.any(String), removedBy: null }]);
    // An account without an identity leaves nothing behind.
    const cy = (await people.useLink((await people.invite(sam, { email: "cy@example.com", role: "editor" })).link.code, { password: PASSWORD, name: "Cy" })).account.id;

    await people.change(null, cy, { disabled: true });
    await people.remove(null, cy);
    expect(people.get(cy)).toBeNull();
    expect(store.read().tombstones).toHaveLength(1);
  });

  it("is shown ids, roles, whether switched off, and subjects at its provider only: never a name or an e-mail", async () => {
    const { people, sam, ed, olive, pat } = await install();
    const shown = people.forOperator(ISSUER);

    expect(shown).toEqual([
      { id: sam, role: "owner", disabled: false, subject: null },
      { id: ed, role: "editor", disabled: false, subject: "ed-subject" },
      { id: olive, role: "owner", disabled: false, subject: "olive / subject?#%" },
      { id: pat, role: "editor", disabled: false, subject: null },
    ]);
    expect(JSON.stringify(shown)).not.toMatch(/@example\.com|Sam Owner|Ed Editor|Olive|Pat Elsewhere/);
    expect(people.byIdentity(ISSUER, "olive / subject?#%")).toEqual({ id: olive, role: "owner", disabled: false, subject: "olive / subject?#%" });
    expect(people.byIdentity(ISSUER, "pat-subject")).toBeNull();
    expect(people.byIdentity("https://other.example.com", "ed-subject")).toBeNull();
    expect(people.byIdentity(ISSUER, "nobody")).toBeNull();
  });
});

describe("deleting an account that signs in through the provider", () => {
  it("by an owner, is remembered as removed by that owner; a subject already on the list isn't added twice", async () => {
    const { store, people, sam, ed, olive } = await install();

    await store.update((draft) => {
      draft.tombstones.push({ id: "earlier", issuer: ISSUER, subject: "ed-subject", removedAt: "2026-11-01T10:00:00.000Z", removedBy: null });
    });
    await people.remove(sam, ed);
    expect(store.read().tombstones).toEqual([{ id: "earlier", issuer: ISSUER, subject: "ed-subject", removedAt: "2026-11-01T10:00:00.000Z", removedBy: null }]);
    await people.remove(sam, olive);
    expect(store.read().tombstones.at(-1)).toMatchObject({ issuer: ISSUER, subject: "olive / subject?#%", removedBy: sam });
  });

  it("is refused in a sentence when the list of removed accounts is full, and nothing changes; an account without an identity can still go", async () => {
    const { store, people, sam, ed } = await install();

    await store.update((draft) => {
      draft.tombstones = Array.from({ length: TOMBSTONES_KEPT }, (_, i) => ({ id: `t${i}`, issuer: ISSUER, subject: `gone-${i}`, removedAt: "2026-11-01T10:00:00.000Z", removedBy: null }));
    });
    const error = await refusal(people.remove(sam, ed));

    expect([error.code, error.message]).toEqual(["conflict", REMOVED_LIST_FULL]);
    expect(error.message).toContain("10,000");
    expect(people.get(ed)).not.toBeNull();
    expect(store.read().tombstones).toHaveLength(TOMBSTONES_KEPT);
    const cy = (await people.useLink((await people.invite(sam, { email: "cy@example.com", role: "editor" })).link.code, { password: PASSWORD, name: "Cy" })).account.id;

    await people.remove(sam, cy);
    expect(people.get(cy)).toBeNull();
  });
});

describe("taking a removed account off the list", () => {
  it("lists each removed identity with its entry's id; unremove(id) takes it off, and that identity signs in again as a new account", async () => {
    const { people, sam, ed } = await install();
    const signIn = () => people.signInThroughProvider({ issuer: ISSUER, subject: "ed-subject", name: "Ed Again", email: "ed@example.com", role: "editor", issuedAt: Date.now() });

    await people.remove(sam, ed);
    const [entry] = people.removed();

    expect(people.removed()).toEqual([{ id: expect.any(String), issuer: ISSUER, subject: "ed-subject", removedAt: expect.any(String), removedBy: sam }]);
    expect(await signIn()).toMatchObject({ ok: false, reason: "removed" });
    // The refusal to link it says how to take it off the list, with a command that does.
    expect((await refusal(people.linkIdentity(sam, { issuer: ISSUER, subject: "ed-subject" }))).message).toContain("galley accounts unremove <subject>");
    expect(await people.unremove(entry!.id)).toEqual(entry);
    expect(people.removed()).toEqual([]);
    const again = await signIn();

    expect(again).toMatchObject({ ok: true });
    expect((again as { account: { id: string } }).account.id).not.toBe(ed);
  });

  it("refuses an id that isn't on the list, and changes nothing", async () => {
    const { people, sam, ed } = await install();

    await people.remove(sam, ed);
    const error = await refusal(people.unremove("no-such-entry"));

    expect(error.code).toBe("not-found");
    expect(error.message).toContain("galley accounts removed");
    expect(people.removed()).toHaveLength(1);
  });
});
