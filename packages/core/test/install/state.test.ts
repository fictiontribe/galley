/**
 * The install's state file against real folders: the upgrade of a data
 * folder from before installs (none, one or several sites), refusing a
 * folder a newer version wrote, atomic writes and modes, the password hash,
 * the one-time setup code and sessions that outlive a restart.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rename as renameFile, writeFile as writeFileNow } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { GalleyError } from "../../src/errors";
import { hashPassword, verifyPassword, passwordProblem } from "../../src/install/password";
import { migrate } from "../../src/install/migrate";
import { createPeople } from "../../src/install/people";
import { openInstallState, sha256Hex, STATE_FILE } from "../../src/install/state";
import { INSTALL_SCHEMA_VERSION, MIN_INSTALL_PASSWORD_LENGTH } from "../../src/install/types";
import { sh, tempDir } from "./helpers";

const PASSWORD = "correct horse battery staple";

function siteFolder(root: string): string {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "package.json"), "{}\n");
  sh(root, "init", "-q", "-b", "main");
  sh(root, "remote", "add", "origin", "https://sam:not-a-real-secret@code.example/sam/site.git");
  return root;
}

function oldSitesFile(home: string, roots: string[]): void {
  writeFileSync(
    join(home, "sites.json"),
    JSON.stringify({ version: 2, sites: roots.map((root, i) => ({ id: `id${i}`, root, name: `Site ${i}`, framework: { id: "astro", name: "Astro" }, lastOpenedAt: i, branch: "main" })), groups: [] })
  );
}

describe("upgrading a data folder from before installs (layout 0 → 1)", () => {
  it("starts empty when the folder had no sites", async () => {
    const home = tempDir("install-home-");
    const store = await openInstallState(home);
    const state = store.read();

    expect(state).toMatchObject({ schema: INSTALL_SCHEMA_VERSION, accounts: [], links: [], site: null, setup: { tokenSha256: null, finishedAt: null }, lastBackupAt: null });
    expect(statSync(join(home, STATE_FILE)).mode & 0o777).toBe(0o600);
    expect(statSync(home).mode & 0o777).toBe(0o700);
    expect(store.siteFolder()).toBe(join(home, "site"));
    expect(store.connectedSiteFolder()).toBeNull();
  });

  it("adopts the one site in place, with its repository's address cleaned of credentials", async () => {
    const home = tempDir("install-home-");
    const root = siteFolder(join(home, "sites", "marketing"));

    oldSitesFile(home, [root]);
    const store = await openInstallState(home);
    const state = store.read();

    expect(state.site).toMatchObject({ root: "sites/marketing", repository: "https://code.example/sam/site.git", branch: "main", access: "none" });
    expect(state.site?.connectedAt).toEqual(expect.any(String));
    // It was already in use: first run is over, there's nothing to set up but the password.
    expect(state.setup.finishedAt).toEqual(expect.any(String));
    expect(store.connectedSiteFolder()).toBe(join(home, "sites", "marketing"));
    expect(readFileSync(join(home, STATE_FILE), "utf8")).not.toContain("not-a-real-secret");
  });

  it("refuses several sites in plain words, and keeps the one GALLEY_SITE_DIR names (the others stay on disk)", async () => {
    const home = tempDir("install-home-");
    const roots = ["a", "b", "c"].map((name) => siteFolder(join(home, "sites", name)));

    oldSitesFile(home, roots);
    const refusal = await openInstallState(home).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(GalleyError);
    expect((refusal as Error).message).toMatch(/holds 3 sites \(sites\/a, sites\/b, sites\/c\), and a hosted Galley now looks after one site/);
    expect((refusal as Error).message).toMatch(/Set GALLEY_SITE_DIR to the folder of the one this install should keep/);
    expect(readdirSync(home)).not.toContain(STATE_FILE);

    await expect(openInstallState(home, { keepSite: "sites/nope" })).rejects.toThrow(/isn't one of the sites this data folder holds/);
    const store = await openInstallState(home, { keepSite: "sites/b" });

    expect(store.read().site?.root).toBe("sites/b");
    for (const root of roots) expect(statSync(join(root, "package.json")).isFile()).toBe(true);
  });

  it("refuses a site kept outside the data folder", async () => {
    const home = tempDir("install-home-");
    const outside = siteFolder(join(tempDir("install-outside-"), "site"));

    oldSitesFile(home, [outside]);
    await expect(openInstallState(home)).rejects.toThrow(/outside this install's data folder/);
  });

  it("refuses a folder a newer version wrote, and a damaged state file, instead of starting over", async () => {
    const newer = tempDir("install-home-");

    writeFileSync(join(newer, STATE_FILE), JSON.stringify({ schema: INSTALL_SCHEMA_VERSION + 1 }));
    await expect(openInstallState(newer)).rejects.toThrow(new RegExp(`last used by a newer version of Galley \\(data layout ${INSTALL_SCHEMA_VERSION + 1}; this version knows up to ${INSTALL_SCHEMA_VERSION}\\)`));
    await expect(migrate({}, INSTALL_SCHEMA_VERSION + 3, { home: newer, now: new Date() })).rejects.toThrow(/newer version/);

    const damaged = tempDir("install-home-");

    writeFileSync(join(damaged, STATE_FILE), "{ not json");
    await expect(openInstallState(damaged)).rejects.toThrow(/is damaged, so this install won't start/);
    expect(readFileSync(join(damaged, STATE_FILE), "utf8")).toBe("{ not json");
  });

  it("a folder already at this layout opens without being rewritten", async () => {
    const home = tempDir("install-home-");

    await openInstallState(home);
    const before = statSync(join(home, STATE_FILE)).mtimeMs;
    const again = await openInstallState(home);

    expect(again.read().schema).toBe(INSTALL_SCHEMA_VERSION);
    expect(statSync(join(home, STATE_FILE)).mtimeMs).toBe(before);
  });
});

describe("writes", () => {
  it("are atomic and leave no temporary files, one at a time in order", async () => {
    const home = tempDir("install-home-");
    const store = await openInstallState(home);

    await Promise.all(Array.from({ length: 20 }, (_, i) => store.setLastBackupAt(new Date(Date.UTC(2026, 0, i + 1)))));
    expect(store.read().lastBackupAt).toBe(new Date(Date.UTC(2026, 0, 20)).toISOString());
    expect(JSON.parse(readFileSync(join(home, STATE_FILE), "utf8")).lastBackupAt).toBe(new Date(Date.UTC(2026, 0, 20)).toISOString());
    expect(readdirSync(home).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(statSync(join(home, STATE_FILE)).mode & 0o777).toBe(0o600);
  });
});

describe("the password", () => {
  it("is stored as an scrypt hash with its parameters, verified in constant time, never in plain", async () => {
    const hash = await hashPassword(PASSWORD);

    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(hash).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword(`${PASSWORD}!`, hash)).toBe(false);
    expect(await hashPassword(PASSWORD)).not.toBe(hash);
    // Raised parameters later: an old hash still verifies with the ones it records.
    const cheaper = hash.replace("scrypt$32768$", "scrypt$16384$");

    expect(await verifyPassword(PASSWORD, cheaper)).toBe(false);
    // A tampered file can't make a sign-in cost the server minutes or gigabytes.
    expect(await verifyPassword(PASSWORD, hash.replace("$32768$", "$1073741824$"))).toBe(false);
    expect(await verifyPassword(PASSWORD, "plain")).toBe(false);
  });

  it("needs at least the minimum length", async () => {
    expect(passwordProblem("short")).toMatch(new RegExp(`at least ${MIN_INSTALL_PASSWORD_LENGTH} characters`));
    await expect(hashPassword("short")).rejects.toThrow(GalleyError);
  });

  it("lives in the state file as its hash only", async () => {
    const home = tempDir("install-home-");
    const store = await openInstallState(home);
    const people = createPeople(store);

    await people.createOwner({ password: PASSWORD });
    expect(store.hasOwner()).toBe(true);
    expect(await people.ownerPasswordIs(PASSWORD)).toBe(true);
    expect(await people.ownerPasswordIs("wrong password here")).toBe(false);
    expect(readFileSync(join(home, STATE_FILE), "utf8")).not.toContain(PASSWORD);
    expect((await openInstallState(home)).hasOwner()).toBe(true);
  });
});

describe("the one-time setup code", () => {
  it("is kept as its SHA-256 only, works until the owner is made, then never again", async () => {
    const home = tempDir("install-home-");
    const store = await openInstallState(home);
    const code = "a-setup-code-for-this-test-only-0123";

    await store.setSetupCode({ plain: code });
    expect(store.read().setup.tokenSha256).toBe(sha256Hex(code));
    expect(readFileSync(join(home, STATE_FILE), "utf8")).not.toContain(code);
    expect(store.setupCodeMatches(code)).toBe(true);
    expect(store.setupCodeMatches(`${code}x`)).toBe(false);
    expect(store.setupCodeMatches("")).toBe(false);

    await createPeople(store).createOwner({ password: PASSWORD });
    expect(store.read().setup.tokenSha256).toBeNull();
    expect(store.setupCodeMatches(code)).toBe(false);
    // Once an owner exists, no code can be set again.
    await store.setSetupCode({ plain: code });
    expect(store.setupCodeMatches(code)).toBe(false);
    expect((await openInstallState(home)).setupCodeMatches(code)).toBe(false);

    // A state with no owner again (a backup of a half-finished first run put back): a fresh code works, the used one never.
    await store.update((draft) => {
      draft.accounts = [];
    });
    await store.setSetupCode({ plain: "a-fresh-code-after-reset-0123456789" });
    expect(store.setupCodeMatches("a-fresh-code-after-reset-0123456789")).toBe(true);
    expect(store.setupCodeMatches(code)).toBe(false);
  });

  it("can be given as its hash, so the code never reaches the server", async () => {
    const store = await openInstallState(tempDir("install-home-"));
    const code = "the-operator-keeps-this-one-0123456";

    await store.setSetupCode({ sha256: sha256Hex(code).toUpperCase() });
    expect(store.setupCodeMatches(code)).toBe(true);
    await expect(store.setSetupCode({ sha256: "nope" })).rejects.toThrow(/64 hexadecimal/);
  });
});

describe("sessions", () => {
  it("a session never counts at or after its own end, whoever asks", async () => {
    const store = await openInstallState(tempDir("install-home-"));
    const issuedAt = Date.now() - 1000;
    const session = { id: "ends", issuedAt, expiresAt: issuedAt + 60_000 };

    expect(store.sessionValid(session, issuedAt + 59_999)).toBe(true);
    expect(store.sessionValid(session, issuedAt + 60_000)).toBe(false);
    expect(store.sessionValid(session, issuedAt + 120_000)).toBe(false);
    // Without an end of its own (a local cookie, or a caller that hasn't one), as before.
    expect(store.sessionValid({ id: "no-end", issuedAt }, issuedAt + 120_000)).toBe(true);
  });

  it("“sign out everywhere” refuses every cookie issued at or before it, after a restart too", async () => {
    const home = tempDir("install-home-");
    const store = await openInstallState(home);
    const before = { id: "before", issuedAt: Date.now() - 1000 };

    expect(store.sessionValid(before)).toBe(true);
    await store.signOutEverywhere();
    expect(store.sessionValid(before)).toBe(false);
    const fresh = { id: "fresh", issuedAt: store.nextIssuedAt() };

    expect(store.sessionValid(fresh)).toBe(true);
    const restarted = await openInstallState(home);

    expect(restarted.sessionValid(before)).toBe(false);
    expect(restarted.sessionValid(fresh)).toBe(true);
  });

  it("a changed password signs that person out everywhere; one sign-out is kept until the cookie would have expired anyway", async () => {
    const home = tempDir("install-home-");
    const store = await openInstallState(home);
    const people = createPeople(store);
    let told = 0;

    store.onSessionsChanged(() => (told += 1));
    const owner = await people.createOwner({ password: PASSWORD });
    const old = { id: "old", issuedAt: Date.now() - 10, accountId: owner.id };

    expect(store.sessionValid(old)).toBe(true);
    expect(await people.changePassword(owner.id, PASSWORD, "another long password")).toBe(true);
    expect(store.sessionValid(old)).toBe(false);
    expect(store.sessionValid({ id: "new", issuedAt: store.nextIssuedAt(Date.now(), owner.id), accountId: owner.id })).toBe(true);
    expect(told).toBe(1);

    const one = { id: "one", issuedAt: store.nextIssuedAt() };
    const other = { id: "other", issuedAt: store.nextIssuedAt() };

    await store.revokeSession("one");
    await store.revokeSession("gone-already", Date.now() - 1);
    expect(store.sessionValid(one)).toBe(false);
    expect(store.sessionValid(other)).toBe(true);
    const restarted = await openInstallState(home);

    expect(restarted.sessionValid(one)).toBe(false);
    expect(restarted.isRevoked("one")).toBe(true);
    expect(restarted.read().sessions.revoked.map((entry) => entry.id)).toEqual(["one"]);
  });
});

describe("saving the state when the disk won't take it", () => {
  const failure = (code: string) => Object.assign(new Error(`${code}: from the test`), { code });
  const leftovers = (home: string) => readdirSync(home).filter((name) => name.endsWith(".tmp"));

  it("a write that fails is told in plain words with the system's code, changes nothing, and the next save works", async () => {
    const home = tempDir("state-save-");
    let failing = 1;
    const store = await openInstallState(home, {
      files: {
        writeFile: (async (...args: Parameters<typeof writeFileNow>) => {
          if (failing > 0) {
            failing -= 1;
            throw failure("EIO");
          }
          return writeFileNow(...args);
        }) as typeof writeFileNow,
      },
    });
    const refusal = await store.update((draft) => void (draft.liveUrl = "https://example.com")).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(GalleyError);
    expect((refusal as GalleyError).code).toBe("internal");
    expect((refusal as GalleyError).message).toBe(
      "The editor couldn't save its own state: the disk reported an error. Nothing was changed. Try again. If it keeps happening, whoever runs this editor should check the disk."
    );
    expect((refusal as GalleyError).detail).toBe("EIO");
    expect(store.read().liveUrl).toBeNull();
    expect(leftovers(home)).toEqual([]);
    await store.update((draft) => void (draft.liveUrl = "https://example.com"));
    expect(store.read().liveUrl).toBe("https://example.com");
    expect(JSON.parse(readFileSync(join(home, STATE_FILE), "utf8")).liveUrl).toBe("https://example.com");
  });

  it.each([
    ["ENOSPC", "the disk is full"],
    ["EMFILE", "too many files are open on the server"],
    ["EPERM", "the server isn't allowed to write to its data folder"],
    ["EBUSY", "its data file is in use by something else"],
  ])("%s is said as: %s", async (code, reason) => {
    const home = tempDir("state-save-");
    const store = await openInstallState(home, { files: { writeFile: (async () => Promise.reject(failure(code))) as typeof writeFileNow } });
    const refusal = (await store.update((draft) => void (draft.liveUrl = "https://example.com")).catch((error: unknown) => error)) as GalleyError;

    expect(refusal).toBeInstanceOf(GalleyError);
    expect(refusal.message).toContain(`The editor couldn't save its own state: ${reason}. Nothing was changed.`);
    expect(refusal.detail).toBe(code);
  });

  it("a rename refused once because the file was held is tried once more, and the save goes through", async () => {
    const home = tempDir("state-save-");
    let refusing = 1;
    let renames = 0;
    const store = await openInstallState(home, {
      files: {
        rename: (async (from, to) => {
          renames += 1;
          if (refusing > 0) {
            refusing -= 1;
            throw failure("EBUSY");
          }
          return renameFile(from, to);
        }) as typeof renameFile,
      },
    });

    await store.update((draft) => void (draft.liveUrl = "https://example.com"));
    expect(renames).toBe(2);
    expect(JSON.parse(readFileSync(join(home, STATE_FILE), "utf8")).liveUrl).toBe("https://example.com");
    expect(leftovers(home)).toEqual([]);
  });

  it("a rename refused twice gives up in plain words; a failure nobody planned for stays what it is", async () => {
    const home = tempDir("state-save-");
    let code = "EPERM";
    const store = await openInstallState(home, { files: { rename: (async () => Promise.reject(failure(code))) as typeof renameFile } });
    const held = (await store.update((draft) => void (draft.liveUrl = "https://example.com")).catch((error: unknown) => error)) as GalleyError;

    expect(held).toBeInstanceOf(GalleyError);
    expect(held.detail).toBe("EPERM");
    code = "EXDEV";
    const odd = await store.update((draft) => void (draft.liveUrl = "https://example.com")).catch((error: unknown) => error);

    expect(odd).not.toBeInstanceOf(GalleyError);
    expect((odd as NodeJS.ErrnoException).code).toBe("EXDEV");
    expect(store.read().liveUrl).toBeNull();
    expect(leftovers(home)).toEqual([]);
  });
});

describe("what a stopped write left behind", () => {
  it("is taken away the next time the install opens, and nothing else is", async () => {
    const home = tempDir("install-home-");
    const first = await openInstallState(home);

    await first.update((draft) => void (draft.liveUrl = "https://www.example.com"));
    const saved = readFileSync(join(home, STATE_FILE), "utf8");
    // A process stopped between writing its temporary file and putting it in place, ten minutes ago…
    const old = new Date(Date.now() - 10 * 60_000);
    const left = join(home, `.${STATE_FILE}.0123456789ab.tmp`);

    writeFileSync(left, "{ half a file");
    utimesSync(left, old, old);
    // …a write that may be going on right now, and files that only look similar.
    const fresh = join(home, `.${STATE_FILE}.ba9876543210.tmp`);
    const others = [`.${STATE_FILE}.notes.tmp`, `${STATE_FILE}.0123456789ab.tmp`, "notes.tmp"].map((name) => join(home, name));

    writeFileSync(fresh, "{}");
    for (const other of others) {
      writeFileSync(other, "kept");
      utimesSync(other, old, old);
    }
    const again = await openInstallState(home);

    expect(readdirSync(home)).not.toContain(`.${STATE_FILE}.0123456789ab.tmp`);
    expect(readdirSync(home)).toContain(`.${STATE_FILE}.ba9876543210.tmp`);
    for (const other of others) expect(readFileSync(other, "utf8")).toBe("kept");
    // The state itself is as it was saved, and writing goes on leaving nothing behind.
    expect(readFileSync(join(home, STATE_FILE), "utf8")).toBe(saved);
    expect(again.read().liveUrl).toBe("https://www.example.com");
    await again.update((draft) => void (draft.liveUrl = "https://example.com"));
    expect(readdirSync(home).filter((name) => name.endsWith(".tmp")).sort()).toEqual([`.${STATE_FILE}.ba9876543210.tmp`, `.${STATE_FILE}.notes.tmp`, `${STATE_FILE}.0123456789ab.tmp`, "notes.tmp"].sort());
  });
});
