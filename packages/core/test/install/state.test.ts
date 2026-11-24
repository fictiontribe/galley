/**
 * The install's state file against real folders: the upgrade of a data
 * folder from before installs (none, one or several sites), refusing a
 * folder a newer version wrote, atomic writes and modes, the password hash,
 * the one-time setup code and sessions that outlive a restart.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GalleyError } from "../../src/errors";
import { hashPassword, verifyPassword, passwordProblem } from "../../src/install/password";
import { migrate } from "../../src/install/migrate";
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

    expect(state).toMatchObject({ schema: INSTALL_SCHEMA_VERSION, password: null, site: null, setup: { tokenSha256: null, finishedAt: null }, lastBackupAt: null });
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
    await expect(openInstallState(newer)).rejects.toThrow(/last used by a newer version of Galley \(data layout 2; this version knows up to 1\)/);
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

    await store.setPassword(PASSWORD);
    expect(store.hasPassword()).toBe(true);
    expect(await store.checkPassword(PASSWORD)).toBe(true);
    expect(await store.checkPassword("wrong password here")).toBe(false);
    expect(readFileSync(join(home, STATE_FILE), "utf8")).not.toContain(PASSWORD);
    expect((await openInstallState(home)).hasPassword()).toBe(true);
  });
});

describe("the one-time setup code", () => {
  it("is kept as its SHA-256 only, works until a password is chosen, then never again", async () => {
    const home = tempDir("install-home-");
    const store = await openInstallState(home);
    const code = "a-setup-code-for-this-test-only-0123";

    await store.setSetupCode({ plain: code });
    expect(store.read().setup.tokenSha256).toBe(sha256Hex(code));
    expect(readFileSync(join(home, STATE_FILE), "utf8")).not.toContain(code);
    expect(store.setupCodeMatches(code)).toBe(true);
    expect(store.setupCodeMatches(`${code}x`)).toBe(false);
    expect(store.setupCodeMatches("")).toBe(false);

    await store.setPassword(PASSWORD);
    expect(store.read().setup.tokenSha256).toBeNull();
    expect(store.setupCodeMatches(code)).toBe(false);
    // Once a password exists, no code can be set again except by --reset-password.
    await store.setSetupCode({ plain: code });
    expect(store.setupCodeMatches(code)).toBe(false);
    expect((await openInstallState(home)).setupCodeMatches(code)).toBe(false);

    await store.clearPassword();
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

  it("a changed password signs everyone out; one sign-out is kept until the cookie would have expired anyway", async () => {
    const home = tempDir("install-home-");
    const store = await openInstallState(home);
    const old = { id: "old", issuedAt: Date.now() - 10 };
    let told = 0;

    store.onSessionsChanged(() => (told += 1));
    await store.setPassword(PASSWORD);
    expect(store.sessionValid(old)).toBe(true);
    await store.setPassword("another long password", { signOutEveryone: true });
    expect(store.sessionValid(old)).toBe(false);
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
