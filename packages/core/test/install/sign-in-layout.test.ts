/**
 * Layout 3 of the install's state, which can hold accounts that sign in
 * through an identity provider: a real layout-2 file upgrades keeping every
 * password and link; an account with no password, or with an identity,
 * loads; every way of checking a password refuses an account that has none;
 * the rules for an account with no e-mail apply only to one that signs in
 * with a password; and the links `serve --reset-password` makes are marked.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GalleyError } from "../../src/errors";
import { needsName } from "../../src/install/accounts";
import { hashPassword } from "../../src/install/password";
import { createPeople, NO_PASSWORD_FOR_EMAIL, NO_PASSWORD_TO_CHANGE, OWN_EMAIL_REFUSAL, type PeopleService } from "../../src/install/people";
import { openInstallState, sha256Hex, signsInWithPassword, STATE_FILE, type InstallStore, type StoredAccount } from "../../src/install/state";
import { INSTALL_SCHEMA_VERSION } from "../../src/install/types";
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

/** An account as the state holds it; no password and an identity unless the test says otherwise. */
function stored(id: string, over: Partial<StoredAccount> = {}): StoredAccount {
  return {
    id,
    name: "",
    email: "",
    role: "editor",
    passwordHash: null,
    passwordChangedAt: "2026-11-01T10:00:00.000Z",
    createdAt: "2026-11-01T10:00:00.000Z",
    lastSeenAt: null,
    disabled: false,
    incomplete: true,
    sessionsValidAfter: 0,
    identity: { issuer: ISSUER, subject: `subject-${id}` },
    ...over,
  };
}

async function withOwner(): Promise<{ home: string; store: InstallStore; people: PeopleService; owner: string }> {
  const home = tempDir("sign-in-layout-");
  const store = await openInstallState(home);
  const people = createPeople(store);
  const owner = await people.createOwner({ password: PASSWORD, name: "Sam Owner", email: "sam@example.com" });

  return { home, store, people, owner: owner.id };
}

describe("upgrading to layout 3", () => {
  it("a real layout-2 file keeps every account's password and every open link, unmarked, and is written back at the new layout", async () => {
    const home = tempDir("sign-in-layout-");
    const samHash = await hashPassword(PASSWORD);
    const edHash = await hashPassword("ed's own long password");
    const later = new Date(Date.now() + 60 * 60_000).toISOString();
    const link = (id: string, kind: "invitation" | "password", over: Record<string, unknown>) => ({
      id,
      kind,
      codeSha256: sha256Hex(`code of ${id}`),
      email: "",
      role: null,
      accountId: null,
      createdBy: null,
      createdByName: "",
      createdAt: "2026-11-20T10:00:00.000Z",
      expiresAt: later,
      emailed: false,
      ...over,
    });
    const schema2 = {
      schema: 2,
      createdAt: "2026-10-01T10:00:00.000Z",
      accounts: [
        { id: "sam", name: "Sam Owner", email: "sam@example.com", role: "owner", passwordHash: samHash, passwordChangedAt: "2026-10-02T10:00:00.000Z", createdAt: "2026-10-01T10:00:00.000Z", lastSeenAt: "2026-11-20T09:00:00.000Z", disabled: false, incomplete: false, sessionsValidAfter: 1_700_000_000_000 },
        { id: "ed", name: "Ed Editor", email: "ed@example.com", role: "editor", passwordHash: edHash, passwordChangedAt: "2026-10-03T10:00:00.000Z", createdAt: "2026-10-03T10:00:00.000Z", lastSeenAt: null, disabled: false, incomplete: false, sessionsValidAfter: 0 },
      ],
      links: [
        link("invited", "invitation", { email: "cy@example.com", role: "contributor", createdBy: "sam", createdByName: "Sam Owner" }),
        // A "forgot my password" link and a `--reset-password` link were stored alike: neither can be told apart, so neither gets the mark.
        link("forgot", "password", { email: "ed@example.com", accountId: "ed" }),
        link("byowner", "password", { email: "sam@example.com", accountId: "sam", createdBy: "sam", createdByName: "Sam Owner" }),
      ],
      setup: { tokenSha256: null, finishedAt: "2026-10-01T10:05:00.000Z", spent: [sha256Hex("an old setup code, used long ago")] },
      sessions: { validAfter: 1_600_000_000_000, revoked: [{ id: "a-signed-out-cookie", until: Date.now() + 60_000 }] },
      site: { root: "site", folder: null, repository: "git@github.com:example/site.git", branch: "main", access: "deploy-key", connectedAt: "2026-10-01T10:04:00.000Z", starter: null },
      liveUrl: "https://www.example.com",
      pendingLiveUrl: null,
      lastBackupAt: null,
      seeded: ["password", "author"],
    };

    writeFileSync(join(home, STATE_FILE), `${JSON.stringify(schema2, null, 2)}\n`, { mode: 0o600 });
    // What the upgrade to accounts left: the old shared password's hash.
    writeFileSync(join(home, `${STATE_FILE}.schema-1.bak`), JSON.stringify({ schema: 1, password: { hash: samHash } }), { mode: 0o600 });
    const store = await openInstallState(home);
    const state = store.read();
    const people = createPeople(store);

    expect(INSTALL_SCHEMA_VERSION).toBe(3);
    expect(state.schema).toBe(3);
    // Accounts and links come across exactly as they were: no identity, no mark, nothing taken away.
    expect(state.accounts).toEqual(schema2.accounts);
    expect(state.links).toEqual(schema2.links);
    expect(state.links.some((one) => "madeBy" in one)).toBe(false);
    expect(state).toMatchObject({ site: schema2.site, liveUrl: schema2.liveUrl, seeded: schema2.seeded, setup: schema2.setup, sessions: { validAfter: schema2.sessions.validAfter } });
    expect(state).toMatchObject({ tombstones: [], providerLogouts: [], oidcOnlySince: null });
    // Everyone still signs in with the password they had, and the sessions they had still count.
    expect(await people.verify("sam@example.com", PASSWORD)).toMatchObject({ ok: true, account: { id: "sam" } });
    expect(await people.verify("ed@example.com", "ed's own long password")).toMatchObject({ ok: true, account: { id: "ed" } });
    expect(store.sessionValid({ id: "x", issuedAt: Date.now() - 1_000, accountId: "sam" })).toBe(true);
    expect(people.signInWith()).toBe("email");
    // The old file stays beside the new one, and the one from the upgrade before goes; the new one is written, so a restart reads it as it is.
    expect(JSON.parse(readFileSync(join(home, `${STATE_FILE}.schema-2.bak`), "utf8"))).toEqual(schema2);
    expect(existsSync(join(home, `${STATE_FILE}.schema-1.bak`))).toBe(false);
    const written = JSON.parse(readFileSync(join(home, STATE_FILE), "utf8"));

    expect(written).toMatchObject({ schema: 3, tombstones: [], providerLogouts: [], oidcOnlySince: null });
    expect(written.accounts.map((account: StoredAccount) => account.passwordHash)).toEqual([samHash, edHash]);
    expect((await openInstallState(home)).read()).toEqual(state);
  });

  it("a folder a newer version wrote is refused by this one, and the file is left alone", async () => {
    const home = tempDir("sign-in-layout-");
    const newer = JSON.stringify({ schema: 4, accounts: [] });

    writeFileSync(join(home, STATE_FILE), newer);
    await expect(openInstallState(home)).rejects.toThrow(/last used by a newer version of Galley \(data layout 4; this version knows up to 3\)/);
    expect(readFileSync(join(home, STATE_FILE), "utf8")).toBe(newer);
  });
});

describe("an account with no password, or with an identity", () => {
  it("loads, after a restart too; its identity and its provider logout time stay as they were; it is never 'damaged'", async () => {
    const { home, store } = await withOwner();

    await store.update((draft) => {
      draft.accounts.push(stored("viaprovider", { name: "Pat Provider", email: "pat@example.com", incomplete: false, providerLogoutAt: 1_764_000_000_000 }));
      draft.tombstones.push({ id: "gone", issuer: ISSUER, subject: "a subject / with ? # % in it", removedAt: "2026-11-24T10:00:00.000Z", removedBy: null });
      draft.providerLogouts.push({ issuer: ISSUER, subject: "nobody-here", at: 1_764_000_000_000 });
    });
    const again = (await openInstallState(home)).read();

    expect(again.accounts.find((account) => account.id === "viaprovider")).toEqual(
      expect.objectContaining({ passwordHash: null, identity: { issuer: ISSUER, subject: "subject-viaprovider" }, providerLogoutAt: 1_764_000_000_000 })
    );
    expect(again.tombstones).toEqual([{ id: "gone", issuer: ISSUER, subject: "a subject / with ? # % in it", removedAt: "2026-11-24T10:00:00.000Z", removedBy: null }]);
    expect(again.providerLogouts).toEqual([{ issuer: ISSUER, subject: "nobody-here", at: 1_764_000_000_000 }]);
  });

  it("an empty password hash, or an identity with no subject, is still a damaged file", async () => {
    for (const bad of [{ passwordHash: "" }, { identity: { issuer: ISSUER, subject: "" } }]) {
      const { home, store } = await withOwner();
      const state = { ...store.read(), accounts: [...store.read().accounts, { ...stored("bad"), ...bad }] };

      writeFileSync(join(home, STATE_FILE), JSON.stringify(state));
      await expect(openInstallState(home)).rejects.toThrow(/is damaged, so this install won't start/);
    }
  });

  it("can't sign in with a password, change one, or change its e-mail with one; an owner's GALLEY_PASSWORD check passes it by", async () => {
    const { store, people } = await withOwner();

    await store.update((draft) => {
      draft.accounts.push(stored("pat", { name: "Pat", email: "pat@example.com", incomplete: false }));
      draft.accounts.push(stored("olive", { name: "Olive", email: "olive@example.com", role: "owner", incomplete: false }));
    });
    // Signing in: refused with its own reason, and only after the same work as a wrong password.
    expect(await people.verify("pat@example.com", PASSWORD)).toMatchObject({ ok: false, reason: "no-password", account: { id: "pat" } });
    expect(await people.verify("pat@example.com", "")).toMatchObject({ ok: false, reason: "no-password" });
    // Changing it, and changing the e-mail, which needs it.
    expect((await refusal(people.changePassword("pat", PASSWORD, "a brand new long password"))).message).toBe(NO_PASSWORD_TO_CHANGE);
    expect((await refusal(people.updateProfile("olive", { email: "olive@elsewhere.example.com", password: PASSWORD }))).message).toBe(NO_PASSWORD_FOR_EMAIL);
    expect((await refusal(people.updateProfile("olive", { email: "olive@elsewhere.example.com" }))).message).toBe(NO_PASSWORD_FOR_EMAIL);
    // Someone who isn't an owner is refused by the rule they always were.
    expect((await refusal(people.updateProfile("pat", { email: "pat@elsewhere.example.com", password: PASSWORD }))).message).toBe(OWN_EMAIL_REFUSAL);
    // "Is this an owner's password": an owner with none is passed by, never an error.
    expect(await people.ownerPasswordIs(PASSWORD)).toBe(true);
    expect(await people.ownerPasswordIs("not anyone's password at all")).toBe(false);
    // Nothing changed: still no password, the same e-mail.
    const after = store.read().accounts;

    expect(after.filter((account) => account.passwordHash === null).map((account) => [account.id, account.email])).toEqual([
      ["pat", "pat@example.com"],
      ["olive", "olive@example.com"],
    ]);
    // Their name is theirs to change, and a name is all an account with an identity can be missing.
    await people.updateProfile("pat", { name: "Pat P." });
    await store.update((draft) => {
      draft.accounts.find((account) => account.id === "pat")!.email = "";
    });
    expect(await people.updateProfile("pat", { name: "Pat Again" })).not.toHaveProperty("incomplete");
  });

  it("a password change that finds the password gone by the time it is saved sets none", async () => {
    const { store, people, owner } = await withOwner();
    const save = store.update.bind(store);
    let first = true;

    // The password is taken away while the new one is being hashed, just before the change is written.
    store.update = async (change) => {
      if (first) {
        first = false;
        await save((draft) => {
          draft.accounts.find((account) => account.id === owner)!.passwordHash = null;
        });
      }
      return save(change);
    };
    expect((await refusal(people.changePassword(owner, PASSWORD, "a brand new long password"))).message).toBe(NO_PASSWORD_TO_CHANGE);
    expect(store.read().accounts.find((account) => account.id === owner)!.passwordHash).toBeNull();
  });
});

describe("the rules for an account with no e-mail apply only to one that signs in with a password", () => {
  it("signing in with a password alone finds only that account; the sign-in screen counts only accounts with a password", async () => {
    const home = tempDir("sign-in-layout-");
    const store = await openInstallState(home);
    const people = createPeople(store);
    const hash = await hashPassword(PASSWORD);

    // An identity account with no e-mail comes first in the list, and one with no identity but no password either.
    await store.update((draft) => {
      draft.accounts.push(stored("viaprovider", { role: "owner" }));
      draft.accounts.push(stored("nopassword", { identity: undefined }));
    });
    expect(await people.verify(null, PASSWORD)).toMatchObject({ ok: false, reason: "unknown" });
    // With only those, there is nobody to sign in with a password alone.
    expect(people.signInWith()).toBe("email");
    await store.update((draft) => {
      draft.accounts.push(stored("carried", { role: "owner", passwordHash: hash, identity: undefined }));
    });
    // The owner from before accounts: found, and the screen asks for the password alone.
    expect(await people.verify(null, PASSWORD)).toMatchObject({ ok: true, account: { id: "carried" } });
    expect(people.signInWith()).toBe("password");
    // An account with a password and an identity is not that owner either.
    await store.update((draft) => {
      const carried = draft.accounts.find((account) => account.id === "carried")!;

      carried.identity = { issuer: ISSUER, subject: "carried" };
    });
    expect(await people.verify(null, PASSWORD)).toMatchObject({ ok: false, reason: "unknown" });
    expect(people.signInWith()).toBe("email");
  });

  it("an account with no e-mail sets its own only when it signs in with a password", async () => {
    const home = tempDir("sign-in-layout-");
    const store = await openInstallState(home);
    const people = createPeople(store);
    const hash = await hashPassword(PASSWORD);

    await store.update((draft) => {
      draft.accounts.push(stored("carried", { role: "owner", name: "Sam", passwordHash: hash, identity: undefined }));
      draft.accounts.push(stored("linked", { role: "editor", name: "Lee", passwordHash: hash }));
    });
    expect((await people.updateProfile("carried", { email: "sam@example.com", password: PASSWORD })).email).toBe("sam@example.com");
    expect((await refusal(people.updateProfile("linked", { email: "lee@example.com", password: PASSWORD }))).message).toBe(OWN_EMAIL_REFUSAL);
  });

  it("publishing waits for a name: whatever the e-mail for an account that signs in through a provider; only the owner from before accounts is let through", () => {
    expect(needsName({ name: "", email: "", passwordHash: "a hash" })).toBe(false);
    expect(needsName({ name: "", email: "" })).toBe(false);
    expect(needsName({ name: "", email: "ed@example.com", passwordHash: "a hash" })).toBe(true);
    expect(needsName({ name: "", email: "", passwordHash: null })).toBe(true);
    expect(needsName({ name: "", email: "", passwordHash: "a hash", identity: { issuer: ISSUER, subject: "s" } })).toBe(true);
    expect(needsName({ name: "", email: "", passwordHash: null, identity: { issuer: ISSUER, subject: "s" } })).toBe(true);
    expect(needsName({ name: "Pat", email: "", passwordHash: null, identity: { issuer: ISSUER, subject: "s" } })).toBe(false);
    expect(signsInWithPassword({ passwordHash: "a hash" })).toBe(true);
    expect(signsInWithPassword({ passwordHash: "a hash", identity: { issuer: ISSUER, subject: "s" } })).toBe(false);
    expect(signsInWithPassword({ passwordHash: null })).toBe(false);
  });
});

describe("the links `serve --reset-password` makes", () => {
  it("are marked; a 'forgot my password' link and an owner's link are not", async () => {
    const { home, store, people, owner } = await withOwner();
    const rescued = await people.rescue();
    const linkOf = (id: string) => store.read().links.find((one) => one.id === id)!;

    expect(linkOf(rescued!.link.id)).toMatchObject({ kind: "password", accountId: owner, createdBy: null, madeBy: "server" });
    const forgot = await people.forgot("sam@example.com");

    expect(linkOf(forgot!.link.id)).toMatchObject({ kind: "password", accountId: owner, createdBy: null });
    expect(linkOf(forgot!.link.id)).not.toHaveProperty("madeBy");
    const { link } = await people.invite(owner, { email: "ed@example.com", role: "owner" });
    const ed = (await people.useLink(link.code, { password: PASSWORD, name: "Ed" })).account;
    const byOwner = await people.passwordLink(ed.id, owner);

    expect(linkOf(byOwner.link.id)).toMatchObject({ createdBy: ed.id });
    expect(linkOf(byOwner.link.id)).not.toHaveProperty("madeBy");
    expect(store.read().links.filter((one) => one.madeBy === "server")).toEqual([]);
    // The mark is kept on disk, and the marked link still works like any other.
    const again = await people.rescue("sam@example.com");

    expect(JSON.parse(readFileSync(join(home, STATE_FILE), "utf8")).links.find((one: { id: string }) => one.id === again!.link.id).madeBy).toBe("server");
    expect(people.checkLink(again!.link.code).kind).toBe("password");
    expect((await people.useLink(again!.link.code, { password: "a brand new long password" })).kind).toBe("password");
  });
});
