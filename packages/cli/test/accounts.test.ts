/**
 * `galley accounts` against real data folders: list; link (one pair, a file
 * of pairs, --replace), which drops the password and open links and ends the
 * account's sessions; the refusals (no GALLEY_OIDC_ISSUER, a subject removed
 * or another account's, an account linked already, a server holding the
 * folder); and rekey, which moves identities and removed accounts in one
 * write, or none on a clash — a subject removed under the old issuer stays
 * removed under the new one.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createPeople, openInstallState } from "@galley/core/install";
import type { Io } from "../src/io";
import { main } from "../src/main";

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "galley-cli-accounts-")));
const children: ChildProcess[] = [];
const ISSUER = "https://id.example.com";
const PASSWORD = "correct horse battery staple";

afterAll(() => {
  for (const child of children) child.kill("SIGKILL");
  rmSync(tmp, { recursive: true, force: true });
});

let counter = 0;
function folder(prefix: string): string {
  counter += 1;
  const dir = join(tmp, `${prefix}-${counter}`);

  mkdirSync(dir, { recursive: true });
  return dir;
}

function testIo(env: Record<string, string>): Io & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout,
    stderr,
    out: (line = "") => stdout.push(line),
    err: (line = "") => stderr.push(line),
    cwd: tmp,
    env: { PATH: process.env.PATH, HOME: tmp, ...env },
    startServer: () => {
      throw new Error("not in these tests");
    },
  } as unknown as Io & { stdout: string[]; stderr: string[] };
}

/** An install with Sam (owner) and Ed (editor), both with passwords, and an open new-password link for Ed. */
async function install(): Promise<{ home: string; sam: string; ed: string }> {
  const home = folder("home");
  const store = await openInstallState(home);
  const people = createPeople(store);
  const sam = (await people.createOwner({ password: PASSWORD, name: "Sam Owner", email: "sam@example.com" })).id;
  const ed = (await people.useLink((await people.invite(sam, { email: "ed@example.com", role: "editor" })).link.code, { password: PASSWORD, name: "Ed Editor" })).account.id;

  await people.passwordLink(sam, ed);
  return { home, sam, ed };
}

const read = async (home: string) => (await openInstallState(home)).read();

describe("galley accounts link", () => {
  it("binds an account to its subject: no password, no open link, every session ended; listed as signing in through the provider", async () => {
    const { home, ed } = await install();
    const before = (await read(home)).accounts.find((account) => account.id === ed)!;
    const io = testIo({ GALLEY_HOME: home, GALLEY_OIDC_ISSUER: ISSUER });

    expect(await main(["accounts", "link", ed, "ed-subject"], io)).toBe(0);
    expect(io.stdout.join("\n")).toBe(`Linked ${ed} (Ed Editor, Editor) to subject ed-subject at ${ISSUER}. Its password and open new-password links are gone, and every session of it ended.`);
    const state = await read(home);
    const after = state.accounts.find((account) => account.id === ed)!;

    expect(after).toMatchObject({ identity: { issuer: ISSUER, subject: "ed-subject" }, passwordHash: null });
    expect(after.sessionsValidAfter).toBeGreaterThan(before.sessionsValidAfter);
    expect(state.links.filter((link) => link.accountId === ed)).toEqual([]);
    const list = testIo({ GALLEY_HOME: home });

    expect(await main(["accounts", "list"], list)).toBe(0);
    expect(list.stdout).toContain(`${ed}  Editor  subject ed-subject at ${ISSUER}  Ed Editor`);
    expect(list.stdout.join("\n")).toContain("sam@example.com  Sam Owner");
  });

  it("refuses without GALLEY_OIDC_ISSUER, an account linked already (but --replace puts it right), a subject another account has, and one removed", async () => {
    const { home, sam, ed } = await install();
    const run = async (argv: string[], env: Record<string, string> = { GALLEY_HOME: home, GALLEY_OIDC_ISSUER: ISSUER }) => {
      const io = testIo(env);

      return { code: await main(["accounts", ...argv], io), err: io.stderr.join("\n"), out: io.stdout.join("\n") };
    };

    expect(await run(["link", ed, "ed-subject"], { GALLEY_HOME: home })).toMatchObject({ code: 2, err: expect.stringMatching(/Set GALLEY_OIDC_ISSUER/) });
    expect((await run(["link", ed, "wrong-subject"])).code).toBe(0);
    expect(await run(["link", ed, "ed-subject"])).toMatchObject({ code: 1, err: expect.stringMatching(/signs in through the provider already \(subject wrong-subject\)\. .*--replace/) });
    expect(await run(["link", "--replace", ed, "ed-subject"])).toMatchObject({ code: 0, out: expect.stringContaining("in place of subject wrong-subject") });
    expect(await run(["link", sam, "ed-subject"])).toMatchObject({ code: 1, err: expect.stringMatching(/already has its own account here .*never merged/) });
    const store = await openInstallState(home);

    await store.update((draft) => {
      draft.tombstones.push({ id: "gone", issuer: ISSUER, subject: "removed-one", removedAt: new Date().toISOString(), removedBy: null });
    });
    expect(await run(["link", sam, "removed-one"])).toMatchObject({ code: 1, err: expect.stringMatching(/list of removed accounts/) });
    expect(await run(["link", "no-such-id", "someone"])).toMatchObject({ code: 1, err: expect.stringMatching(/No account here has that id/) });
    expect((await read(home)).accounts.find((account) => account.id === sam)!.passwordHash).not.toBeNull();
  });

  it("takes a file of pairs, each said on its own line; one that can't be linked doesn't stop the rest", async () => {
    const { home, sam, ed } = await install();
    const pairs = join(folder("pairs"), "pairs.txt");

    writeFileSync(pairs, `# account  subject\n${sam}  a subject with spaces\n\nno-such-id  nobody\n${ed}\ted-subject\n`);
    const io = testIo({ GALLEY_HOME: home, GALLEY_OIDC_ISSUER: ISSUER });

    expect(await main(["accounts", "link", "--file", pairs], io)).toBe(1);
    expect(io.stdout).toEqual([expect.stringMatching(/^line 2: Linked .* to subject a subject with spaces at /), expect.stringMatching(/^line 5: Linked .* to subject ed-subject at /)]);
    expect(io.stderr).toEqual([expect.stringMatching(/^line 4: no-such-id: No account here has that id/)]);
  });

  it("refuses while a server holds the data folder, and says so", async () => {
    const { home, ed } = await install();
    const sleeper = spawn("sleep", ["30"], { stdio: "ignore" });

    children.push(sleeper);
    writeFileSync(join(home, "server.lock"), JSON.stringify({ pid: sleeper.pid, hostname: hostname(), port: 4400, startedAt: new Date().toISOString() }));
    const io = testIo({ GALLEY_HOME: home, GALLEY_OIDC_ISSUER: ISSUER });

    expect(await main(["accounts", "link", ed, "ed-subject"], io)).toBe(2);
    expect(io.stderr.join("\n")).toBe(`A server is using this data folder right now (process ${sleeper.pid}, port 4400). Stop it first, then run this again.`);
    expect(await main(["accounts", "rekey", "--from", ISSUER, "--to", "https://new.example.com"], io)).toBe(2);
    expect((await read(home)).accounts.find((account) => account.id === ed)!.identity).toBeUndefined();
  });
});

describe("galley accounts rekey", () => {
  it("moves identities and removed accounts in one write; a subject removed under the old issuer is still refused under the new one", async () => {
    const { home, sam, ed } = await install();
    const NEW = "https://new.example.com";

    expect(await main(["accounts", "link", ed, "ed-subject"], testIo({ GALLEY_HOME: home, GALLEY_OIDC_ISSUER: ISSUER }))).toBe(0);
    const store = await openInstallState(home);

    await store.update((draft) => {
      draft.tombstones.push({ id: "gone", issuer: ISSUER, subject: "removed-one", removedAt: new Date().toISOString(), removedBy: sam });
    });
    const io = testIo({ GALLEY_HOME: home });

    expect(await main(["accounts", "rekey", "--from", ISSUER, "--to", NEW], io)).toBe(0);
    expect(io.stdout.join("\n")).toBe(`Moved 1 account and 1 removed account from ${ISSUER} to ${NEW}. Start the server with GALLEY_OIDC_ISSUER=${NEW}.`);
    const moved = await openInstallState(home);

    expect(moved.read().accounts.find((account) => account.id === ed)!.identity).toEqual({ issuer: NEW, subject: "ed-subject" });
    expect(moved.read().tombstones).toEqual([expect.objectContaining({ issuer: NEW, subject: "removed-one" })]);
    const people = createPeople(moved, { providerConfigured: true });

    expect(await people.signInThroughProvider({ issuer: NEW, subject: "removed-one", name: "Back Again", email: null, role: "editor", issuedAt: Date.now() })).toMatchObject({ ok: false, reason: "removed" });
    expect(await people.signInThroughProvider({ issuer: NEW, subject: "ed-subject", name: null, email: null, role: "editor", issuedAt: Date.now() })).toMatchObject({ ok: true, created: false, account: { id: ed } });
  });

  it("moves nothing when a subject is under both issuers already, and says so", async () => {
    const { home, sam, ed } = await install();
    const NEW = "https://new.example.com";

    expect(await main(["accounts", "link", ed, "same-subject"], testIo({ GALLEY_HOME: home, GALLEY_OIDC_ISSUER: ISSUER }))).toBe(0);
    expect(await main(["accounts", "link", sam, "same-subject"], testIo({ GALLEY_HOME: home, GALLEY_OIDC_ISSUER: NEW }))).toBe(0);
    const io = testIo({ GALLEY_HOME: home });

    expect(await main(["accounts", "rekey", "--from", ISSUER, "--to", NEW], io)).toBe(1);
    expect(io.stderr.join("\n")).toMatch(/One subject is already under https:\/\/new\.example\.com as well as under https:\/\/id\.example\.com, so nothing was moved/);
    expect((await read(home)).accounts.find((account) => account.id === ed)!.identity!.issuer).toBe(ISSUER);
    expect(await main(["accounts", "rekey", "--from", ISSUER], testIo({ GALLEY_HOME: home }))).toBe(2);
  });
});

describe("galley accounts removed and unremove", () => {
  it("lists a removed subject with when and by whom; unremove takes it off by subject, and it can be linked again", async () => {
    const { home, sam, ed } = await install();
    const run = async (argv: string[], env: Record<string, string> = { GALLEY_HOME: home, GALLEY_OIDC_ISSUER: ISSUER }) => {
      const io = testIo(env);

      return { code: await main(["accounts", ...argv], io), err: io.stderr.join("\n"), out: io.stdout.join("\n") };
    };

    expect((await run(["link", ed, "ed-subject"])).code).toBe(0);
    const store = await openInstallState(home);
    const people = createPeople(store, { providerConfigured: true });

    await people.remove(sam, ed);
    expect(await run(["removed"])).toMatchObject({ code: 0, out: expect.stringMatching(new RegExp(`^subject ed-subject at ${ISSUER}  removed \\S+ by Sam Owner$`)) });
    // Linking it is refused, and the refusal names the command that takes it off the list.
    expect(await run(["link", sam, "ed-subject"])).toMatchObject({ code: 1, err: expect.stringContaining("galley accounts unremove <subject>") });
    expect(await run(["unremove", "ed-subject"])).toMatchObject({ code: 0, out: expect.stringMatching(/^Took subject ed-subject at https:\/\/id\.example\.com off the list of removed accounts \(removed \S+\): it may sign in again/) });
    expect(await run(["removed"])).toMatchObject({ code: 0, out: "No removed account is on the list." });
    expect((await run(["link", sam, "ed-subject"])).code).toBe(0);
  });

  it("refuses without GALLEY_OIDC_ISSUER, a subject that isn't on the list, and while a server holds the data folder", async () => {
    const { home, sam, ed } = await install();
    const env = { GALLEY_HOME: home, GALLEY_OIDC_ISSUER: ISSUER };

    expect(await main(["accounts", "link", ed, "ed-subject"], testIo(env))).toBe(0);
    await createPeople(await openInstallState(home), { providerConfigured: true }).remove(sam, ed);
    const noIssuer = testIo({ GALLEY_HOME: home });

    expect(await main(["accounts", "unremove", "ed-subject"], noIssuer)).toBe(2);
    expect(noIssuer.stderr.join("\n")).toMatch(/Set GALLEY_OIDC_ISSUER/);
    const unknown = testIo(env);

    expect(await main(["accounts", "unremove", "someone-else"], unknown)).toBe(1);
    expect(unknown.stderr.join("\n")).toBe(`No removed account has subject someone-else at ${ISSUER}. \`galley accounts removed\` lists them.`);
    const sleeper = spawn("sleep", ["30"], { stdio: "ignore" });

    children.push(sleeper);
    writeFileSync(join(home, "server.lock"), JSON.stringify({ pid: sleeper.pid, hostname: hostname(), port: 4400, startedAt: new Date().toISOString() }));
    const served = testIo(env);

    expect(await main(["accounts", "unremove", "ed-subject"], served)).toBe(2);
    expect(served.stderr.join("\n")).toMatch(/A server is using this data folder right now/);
    expect((await read(home)).tombstones).toHaveLength(1);
  });
});

describe("an account id or subject that starts with -", () => {
  it("goes after --, for link and unremove alike", async () => {
    const { home, sam, ed } = await install();
    const env = { GALLEY_HOME: home, GALLEY_OIDC_ISSUER: ISSUER };

    expect(await main(["accounts", "link", "--", ed, "-ed-subject"], testIo(env))).toBe(0);
    expect((await read(home)).accounts.find((account) => account.id === ed)!.identity).toEqual({ issuer: ISSUER, subject: "-ed-subject" });
    await createPeople(await openInstallState(home), { providerConfigured: true }).remove(sam, ed);
    const io = testIo(env);

    expect(await main(["accounts", "unremove", "--", "-ed-subject"], io)).toBe(0);
    expect(io.stdout.join("\n")).toContain("Took subject -ed-subject at");
  });
});

describe("galley accounts", () => {
  it("says what it does, and refuses a folder with no install", async () => {
    const help = testIo({});

    expect(await main(["accounts", "--help"], help)).toBe(0);
    expect(help.stdout.join("\n")).toContain("accounts link <account id> <subject> [--replace]");
    const empty = testIo({ GALLEY_HOME: folder("empty") });

    expect(await main(["accounts", "list"], empty)).toBe(2);
    expect(empty.stderr.join("\n")).toMatch(/There is no install in/);
  });
});
