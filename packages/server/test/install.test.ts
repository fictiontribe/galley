/**
 * A hosted install over real HTTP, against the real engine and local bare
 * repositories: first run end to end, the one-time setup code, sessions that
 * outlive a restart, unattended starts that change nothing when repeated,
 * and that no answer or log line ever carries a secret.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { resolveCommand } from "@galley/core/workspace";
import type { SetupStatus } from "@galley/core/install";
import type { Job, MetaInfo } from "@galley/core/types";
import { resolveConfig, startServer, StartupError } from "../src/server";
import type { RunningServer, ServerOptions } from "../src/types";

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "galley-install-http-")));
const gitConfig = join(tmp, "gitconfig");
const running: RunningServer[] = [];
const PASSWORD = "correct horse battery staple";

writeFileSync(gitConfig, "[init]\n\tdefaultBranch = main\n[user]\n\tname = Test Person\n\temail = test@example.com\n");
process.env.GIT_CONFIG_GLOBAL = gitConfig;
process.env.GIT_CONFIG_NOSYSTEM = "1";

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

let counter = 0;
function folder(prefix: string): string {
  counter += 1;
  const dir = join(tmp, `${prefix}-${counter}`);

  mkdirSync(dir, { recursive: true });
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

/** A bare repository: empty, or with one version of a tiny site on main. */
function bareRepository(files?: Record<string, string>): string {
  const bare = join(folder("remote"), "site.git");

  mkdirSync(bare);
  git(bare, "init", "-q", "--bare", "-b", "main");
  if (files) {
    const work = folder("seed");

    git(work, "init", "-q", "-b", "main");
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(work, path, ".."), { recursive: true });
      writeFileSync(join(work, path), content);
    }
    git(work, "add", "-A");
    git(work, "commit", "-q", "-m", "First");
    git(work, "push", "-q", bare, "main");
  }
  return bare;
}

const SITE_FILES = { "package.json": "{\"name\":\"site\",\"private\":true}\n", "src/content/pages/index.md": "---\ntitle: Home\n---\nHello\n" };

const startersDir = (() => {
  const dir = folder("starters");

  mkdirSync(join(dir, "tiny", "src", "content", "pages"), { recursive: true });
  writeFileSync(join(dir, "tiny", "package.json"), JSON.stringify({ name: "tiny", private: true, scripts: { dev: "echo dev" } }, null, 2));
  writeFileSync(join(dir, "tiny", "src", "content", "pages", "index.md"), "---\ntitle: Home\n---\nHello\n");
  return dir;
})();

interface Started {
  server: RunningServer;
  base: string;
  notices: string[];
  logs: string[];
}

async function start(home: string, env: Record<string, string> = {}, options: Partial<ServerOptions> = {}): Promise<Started> {
  const notices: string[] = [];
  const logs: string[] = [];
  const server = await startServer({
    port: 0,
    host: "127.0.0.1",
    mode: "hosted",
    home,
    startersDir,
    webDir: join(tmp, "no-ui"),
    env: { PATH: process.env.PATH, HOME: tmp, GALLEY_MCP: "off", GALLEY_ALLOW_LOCAL_REPOSITORIES: "1", ...env },
    notice: (line) => notices.push(line),
    log: (line) => logs.push(line),
    siteInstall: async () => {},
    ...options,
  });

  running.push(server);
  return { server, base: `http://127.0.0.1:${server.port}`, notices, logs };
}

async function stop(started: Started): Promise<void> {
  running.splice(running.indexOf(started.server), 1);
  await started.server.close();
}

interface Answer<T = any> {
  status: number;
  body: T;
  text: string;
  cookies: string[];
  setCookie: string[];
}

/** Every answer any test got, for the no-secrets check. */
const transcript: string[] = [];

async function call<T = any>(
  base: string,
  method: string,
  path: string,
  init: { body?: unknown; cookie?: string; bearer?: string; origin?: string | null; headers?: Record<string, string> } = {}
): Promise<Answer<T>> {
  const headers: Record<string, string> = { ...init.headers };

  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.cookie) headers.cookie = init.cookie;
  if (init.bearer) headers.authorization = `Bearer ${init.bearer}`;
  if (init.origin !== null && method !== "GET") headers.origin = init.origin ?? base;
  const response = await fetch(`${base}${path}`, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const text = await response.text();
  const setCookie = response.headers.getSetCookie();
  let body: unknown = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  transcript.push(`${method} ${path} ${response.status} ${text}`);
  return { status: response.status, body: body as T, text, setCookie, cookies: setCookie.map((line) => line.split(";")[0]!).filter((pair) => !pair.endsWith("=")) };
}

function codeOf(server: RunningServer): string {
  const code = server.setupUrl ? new URL(server.setupUrl).searchParams.get("token") : null;

  if (!code) throw new Error("no setup link");
  return code;
}

async function waitForJob(base: string, cookie: string, job: Job): Promise<Job> {
  for (let i = 0; i < 600; i += 1) {
    const current = await call<Job>(base, "GET", `/api/jobs/${job.id}`, { cookie });

    if (current.body.state !== "running") return current.body;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("the job didn't finish");
}

async function signIn(base: string, password = PASSWORD, origin?: string): Promise<string> {
  const answer = await call(base, "POST", "/api/auth/login", { body: { password }, ...(origin ? { origin } : {}) });

  expect(answer.status).toBe(200);
  return answer.cookies[0]!;
}

describe("first run, end to end", () => {
  it("setup link → password → check → connect an existing repository → details → finish", async () => {
    const home = folder("home");
    const bare = bareRepository(SITE_FILES);
    const { server, base } = await start(home);
    const code = codeOf(server);

    expect(server.setupUrl).toBe(`${base}/setup?token=${code}`);
    // A stranger learns only that setup is waiting.
    const stranger = await call<MetaInfo>(base, "GET", "/api/meta");

    expect(stranger.body.install).toEqual({ singleSite: true, setupNeeded: true, passwordSet: false, siteId: null, signInWith: "email", passwordEmail: false });
    expect(stranger.body.authenticated).toBe(false);
    expect((await call(base, "GET", "/api/setup")).body.error.message).toMatch(/Open the setup link to continue/);
    expect((await call(base, "GET", "/api/setup", { bearer: "a-wrong-code-of-the-right-length-0000" })).status).toBe(401);
    expect((await call<SetupStatus>(base, "GET", "/api/setup", { bearer: code })).body).toMatchObject({ step: "password", passwordSet: false, site: { state: "none" } });
    // The setup page keeps its code in the address (the page sends it as a Bearer); nothing caches it.
    expect((await fetch(`${base}/setup?token=${code}`, { redirect: "manual" })).status).not.toBe(302);

    // Chosen with the code alone — no Origin, as from the app that created the install.
    const chosen = await call<SetupStatus>(base, "POST", "/api/setup/password", { bearer: code, origin: null, body: { password: PASSWORD, name: "Sam Owner", email: "sam@example.com" } });

    expect(chosen.status).toBe(200);
    expect(chosen.body).toMatchObject({ step: "site", passwordSet: true });
    const cookie = chosen.cookies[0]!;

    // First run left half-way: a stranger is told a password exists, so the way back in is signing in, not the used link.
    expect((await call<MetaInfo>(base, "GET", "/api/meta")).body.install).toEqual({ singleSite: true, setupNeeded: true, passwordSet: true, siteId: null, signInWith: "email", passwordEmail: false });

    // The link works once.
    expect((await call(base, "GET", "/api/setup", { bearer: code })).body.error.message).toBe("The setup link has been used already. Sign in instead.");
    expect((await call(base, "POST", "/api/setup/password", { bearer: code, origin: null, body: { password: "another long password" } })).status).toBe(401);
    // A page that keeps sending the old code beside its new cookie is fine.
    expect((await call(base, "GET", "/api/setup", { bearer: code, cookie })).status).toBe(200);

    const check = await call(base, "POST", "/api/setup/site/check", { cookie, body: { repository: bare, access: "token", token: "unused-for-a-folder" } });

    expect(check.body).toEqual({ reachable: true, writable: null, empty: false, defaultBranch: "main", message: null });
    const job = await call<Job>(base, "POST", "/api/setup/site", { cookie, body: { repository: bare, access: "token", token: "unused-for-a-folder" } });

    expect(job.body).toMatchObject({ kind: "setup", state: "running" });
    const finished = await waitForJob(base, cookie, job.body);

    expect(finished).toMatchObject({ state: "done", siteId: expect.any(String) });
    const details = await call<SetupStatus>(base, "PUT", "/api/setup/details", { cookie, body: { author: { name: "Sam Editor", email: "sam@example.com" }, liveUrl: "https://www.example.com" } });

    expect(details.body).toMatchObject({ step: "details", author: { name: "Sam Editor", email: "sam@example.com" }, liveUrl: "https://www.example.com", site: { state: "connected", repository: bare } });
    expect((await call<SetupStatus>(base, "POST", "/api/setup/finish", { cookie })).body.step).toBe("done");

    const signedIn = await call<MetaInfo>(base, "GET", "/api/meta", { cookie });

    expect(signedIn.body.install).toEqual({ singleSite: true, setupNeeded: false, passwordSet: true, siteId: finished.siteId, signInWith: "email", passwordEmail: false });
    expect(signedIn.body.account).toMatchObject({ name: "Sam Owner", email: "sam@example.com", role: "owner", access: ["edit", "publish", "manage"] });
    expect((await call<MetaInfo>(base, "GET", "/api/meta")).body.install).toEqual({ singleSite: true, setupNeeded: false, passwordSet: true, siteId: null, signInWith: "email", passwordEmail: false });
    expect((await call<MetaInfo>(base, "GET", "/api/meta")).body.account).toBeUndefined();
    expect((await call(base, "GET", "/api/sites", { cookie })).body.map((site: { id: string }) => site.id)).toEqual([finished.siteId]);
    expect((await call(base, "GET", `/api/sites/${finished.siteId}`, { cookie })).status).toBe(200);
    // The live address stays in the install's state (was: written into galley.config.json, an unpublished change nobody made).
    expect(existsSync(join(home, "site", "galley.config.json"))).toBe(false);
    expect(git(join(home, "site"), "status", "--porcelain")).toBe("");
    expect((await call(base, "GET", `/api/sites/${finished.siteId}`, { cookie })).body.model.urls.production).toBe("https://www.example.com");

    // A second site is refused, in plain words.
    const second = await call(base, "POST", "/api/setup/site", { cookie, body: { repository: bareRepository(SITE_FILES), access: "token", token: "x" } });

    expect(second.status).toBe(409);
    expect(second.body.error.message).toBe("This editor already looks after a site. Each site gets an editor of its own.");
    expect((await call(base, "POST", "/api/sites/clone", { cookie, body: { url: bare } })).status).toBe(403);
    // Everything the install keeps is in its data folder.
    expect(readdirSync(home).sort()).toEqual(expect.arrayContaining(["install.json", "keys", "session.key", "settings.json", "site"]));
  });

  it("sends a starter to an empty repository: the first version arrives under the configured name and e-mail", async () => {
    const home = folder("home");
    const bare = bareRepository();
    const { server, base } = await start(home, { GALLEY_AUTHOR_NAME: "Sam Editor", GALLEY_AUTHOR_EMAIL: "sam@example.com" });
    const cookie = (await call(base, "POST", "/api/setup/password", { bearer: codeOf(server), body: { password: PASSWORD } })).cookies[0]!;
    const check = await call(base, "POST", "/api/setup/site/check", { cookie, body: { repository: bare, access: "token", token: "x", starter: { id: "tiny" } } });

    expect(check.body).toMatchObject({ reachable: true, empty: true, message: null });
    const job = await call<Job>(base, "POST", "/api/setup/site", { cookie, body: { repository: bare, access: "token", token: "x", starter: { id: "tiny", name: "Harbour notes" } } });

    expect((await waitForJob(base, cookie, job.body)).state).toBe("done");
    expect(git(bare, "log", "--format=%an <%ae>|%s", "main")).toBe("Sam Editor <sam@example.com>|Start Harbour notes from a starter");
    expect(git(join(home, "site"), "status", "--porcelain")).toBe("");
  });
});

describe("the one-time setup code", () => {
  it("wrong codes count against the sign-in limit; --reset-password makes the owner a one-time new-password link and touches nothing else", async () => {
    const home = folder("home");
    const first = await start(home);
    const code = codeOf(first.server);

    for (let i = 0; i < 5; i += 1) expect((await call(first.base, "GET", "/api/setup", { bearer: `wrong-code-number-${i}-0000000000` })).status).toBe(401);
    const blocked = await call(first.base, "GET", "/api/setup", { bearer: code });

    expect(blocked.status).toBe(429);
    await stop(first);

    // A restart without a password: a new code, the old one dead.
    // Restarted on the same port: without https the cookie's name carries the port.
    const port = { port: first.server.port };
    const second = await start(home, {}, port);
    const fresh = codeOf(second.server);

    expect(fresh).not.toBe(code);
    expect((await call(second.base, "GET", "/api/setup", { bearer: code })).status).toBe(401);
    const cookie = (await call(second.base, "POST", "/api/setup/password", { bearer: fresh, body: { password: PASSWORD } })).cookies[0]!;

    await stop(second);

    const restarted = await start(home, {}, port);

    expect(restarted.server.setupUrl).toBeNull();
    expect((await call(restarted.base, "GET", "/api/setup", { cookie })).status).toBe(200);
    await stop(restarted);

    // Was: forget the password, sign everyone out, print a new setup link. With accounts nobody's account is forgotten:
    // the owner gets a one-time link to choose a new password, and the setup code stays dead.
    const reset = await start(home, { GALLEY_PASSWORD: PASSWORD }, { resetPassword: true, ...port });
    const link = reset.server.passwordLink!;

    expect(reset.server.setupUrl).toBeNull();
    expect(link.url).toMatch(new RegExp(`^${reset.base}/new-password#[A-Za-z0-9_-]{43}$`));
    expect((await call(reset.base, "GET", "/api/setup", { bearer: fresh })).status).toBe(401);
    // Until the link is used, the owner's password and sessions work as before.
    expect((await call(reset.base, "GET", "/api/setup", { cookie })).status).toBe(200);
    expect((await call(reset.base, "POST", "/api/auth/login", { body: { password: PASSWORD } })).status).toBe(200);
    const secret = link.url.split("#")[1]!;

    expect((await call(reset.base, "POST", "/api/auth/link/check", { body: { code: secret } })).body).toMatchObject({ kind: "password", email: "" });
    const used = await call(reset.base, "POST", "/api/auth/link", { body: { code: secret, password: "the owner's new password" } });

    expect(used.status).toBe(200);
    expect((await call(reset.base, "GET", "/api/setup", { cookie })).status).toBe(401);
    expect((await call(reset.base, "GET", "/api/setup", { cookie: used.cookies[0] })).status).toBe(200);
    expect((await call(reset.base, "POST", "/api/auth/login", { body: { password: PASSWORD } })).status).toBe(401);
    expect((await call(reset.base, "POST", "/api/auth/login", { body: { password: "the owner's new password" } })).status).toBe(200);
    // Used once: dead.
    expect((await call(reset.base, "POST", "/api/auth/link", { body: { code: secret, password: "yet another password" } })).status).toBe(404);
  });

  it("an operator's code is used as given, or only its hash is kept", async () => {
    const operator = "the-operator-chose-this-code-0123456";
    const given = await start(folder("home"), { GALLEY_SETUP_TOKEN: operator });

    expect(codeOf(given.server)).toBe(operator);
    const hashed = await start(folder("home"), { GALLEY_SETUP_TOKEN_SHA256: execFileSync("sh", ["-c", `printf %s '${operator}' | shasum -a 256`], { encoding: "utf8" }).split(" ")[0]! });

    expect(hashed.server.setupUrl).toBeNull();
    expect((await call(hashed.base, "GET", "/api/setup", { bearer: operator })).status).toBe(200);
  });
});

describe("sessions", () => {
  it("on an https:// address the cookie is __Host-, always Secure, Path=/, no Domain — whatever the forwarded protocol says", async () => {
    const { base } = await start(folder("home"), { GALLEY_PASSWORD: PASSWORD, GALLEY_PUBLIC_URL: "https://cms.example.com", GALLEY_TRUST_PROXY: "1" });

    for (const headers of [{}, { "x-forwarded-proto": "http" }] as Array<Record<string, string>>) {
      const answer = await call(base, "POST", "/api/auth/login", { body: { password: PASSWORD }, origin: "https://cms.example.com", headers });
      const line = answer.setCookie[0]!;

      expect(line).toMatch(/^__Host-galley_session=/);
      expect(line).toMatch(/; Secure/);
      expect(line).toMatch(/; HttpOnly/);
      expect(line).toMatch(/; SameSite=Strict/);
      expect(line).toMatch(/; Path=\//);
      expect(line).not.toMatch(/Domain=/i);
      const out = await call(base, "POST", "/api/auth/logout", { cookie: answer.cookies[0], origin: "https://cms.example.com" });

      expect(out.setCookie[0]).toMatch(/^__Host-galley_session=; Max-Age=0; Path=\/; Secure/);
    }
  });

  it("without https the cookie is as before (named with the port)", async () => {
    const { server, base } = await start(folder("home"), { GALLEY_PASSWORD: PASSWORD });
    const answer = await call(base, "POST", "/api/auth/login", { body: { password: PASSWORD } });

    expect(answer.setCookie[0]).toMatch(new RegExp(`^galley_session_${server.port}=`));
    expect(answer.setCookie[0]).not.toMatch(/Secure/);
  });

  it("“sign out everywhere” and a changed password end older cookies, after a restart too; one sign-out survives a restart", async () => {
    const home = folder("home");
    const first = await start(home, { GALLEY_PASSWORD: PASSWORD });
    const a = await signIn(first.base);
    const b = await signIn(first.base);
    const c = await signIn(first.base);

    expect((await call(first.base, "POST", "/api/auth/logout", { cookie: c })).status).toBe(200);
    expect((await call(first.base, "GET", "/api/sites", { cookie: c })).status).toBe(401);
    const changed = await call(first.base, "POST", "/api/install/password", { cookie: a, body: { current: PASSWORD, next: "a new long password" } });

    expect(changed.status).toBe(200);
    const a2 = changed.cookies[0]!;

    expect((await call(first.base, "GET", "/api/sites", { cookie: a2 })).status).toBe(200);
    expect((await call(first.base, "GET", "/api/sites", { cookie: a })).status).toBe(401);
    expect((await call(first.base, "GET", "/api/sites", { cookie: b })).status).toBe(401);
    // 400, not 401: the session is fine, only the typed password is wrong (a 401 would send the app to sign-in).
    const wrong = await call(first.base, "POST", "/api/install/password", { cookie: a2, body: { current: "not it at all", next: "whatever long enough" } });

    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toEqual({ code: "invalid", message: "That isn't the current password." });
    expect((await call(first.base, "GET", "/api/sites", { cookie: a2 })).status).toBe(200);
    const d = await signIn(first.base, "a new long password");

    await stop(first);

    // Restarted on the same port: without https the cookie's name carries the port.
    const port = { port: first.server.port };
    const second = await start(home, { GALLEY_PASSWORD: PASSWORD }, port);

    expect(second.notices.join("\n")).toMatch(/GALLEY_PASSWORD no longer matches the password chosen in the app/);
    for (const old of [a, b, c]) expect((await call(second.base, "GET", "/api/sites", { cookie: old })).status).toBe(401);
    expect((await call(second.base, "GET", "/api/sites", { cookie: a2 })).status).toBe(200);
    expect((await call(second.base, "POST", "/api/auth/logout", { cookie: d })).status).toBe(200);
    expect((await call(second.base, "POST", "/api/auth/logout-all", { cookie: a2 })).status).toBe(200);
    expect((await call(second.base, "GET", "/api/sites", { cookie: a2 })).status).toBe(401);
    await stop(second);

    const third = await start(home, {}, port);

    for (const old of [a2, d]) expect((await call(third.base, "GET", "/api/sites", { cookie: old })).status).toBe(401);
    expect((await call(third.base, "GET", "/api/sites", { cookie: await signIn(third.base, "a new long password") })).status).toBe(200);
  });

  it("a cookie one install issued is refused by another", async () => {
    const one = await start(folder("home"), { GALLEY_PASSWORD: PASSWORD });
    const other = await start(folder("home"), { GALLEY_PASSWORD: PASSWORD });
    const cookie = await signIn(one.base);
    const renamed = cookie.replace(/^galley_session_\d+=/, `galley_session_${other.server.port}=`);

    expect((await call(one.base, "GET", "/api/sites", { cookie })).status).toBe(200);
    expect((await call(other.base, "GET", "/api/sites", { cookie: renamed })).status).toBe(401);
  });
});

describe("unattended start", () => {
  function snapshot(home: string) {
    return {
      install: readFileSync(join(home, "install.json"), "utf8"),
      settings: readFileSync(join(home, "settings.json"), "utf8"),
      head: git(join(home, "site"), "rev-parse", "HEAD"),
      status: git(join(home, "site"), "status", "--porcelain"),
      // The live address is kept in install.json; the site's files never get a settings file they didn't have.
      config: existsSync(join(home, "site", "galley.config.json")) ? readFileSync(join(home, "site", "galley.config.json"), "utf8") : null,
      keys: readdirSync(join(home, "keys")).sort(),
    };
  }

  it("from the environment: everything first run asks, and a restart with the same values changes nothing", async () => {
    const home = folder("home");
    const bare = bareRepository(SITE_FILES);
    const env = {
      GALLEY_PASSWORD: PASSWORD,
      GALLEY_SITE_REPOSITORY: bare,
      GALLEY_SITE_ACCESS: "token",
      GALLEY_SITE_TOKEN: "fake-access-key-for-a-folder-0000",
      GALLEY_AUTHOR_NAME: "Sam Editor",
      GALLEY_AUTHOR_EMAIL: "sam@example.com",
      GALLEY_SITE_LIVE_URL: "https://www.example.com",
    };
    const first = await start(home, env);

    expect(first.server.setupUrl).toBeNull();
    await first.server.install!.idle();
    const cookie = await signIn(first.base);
    const status = await call<SetupStatus>(first.base, "GET", "/api/setup", { cookie });

    expect(status.body).toMatchObject({ step: "done", site: { state: "connected", repository: bare }, author: { name: "Sam Editor", email: "sam@example.com" }, liveUrl: "https://www.example.com" });
    const before = snapshot(home);

    // GALLEY_SITE_LIVE_URL left the site as the repository has it: nothing to publish.
    expect(before.status).toBe("");
    expect(before.config).toBeNull();

    await stop(first);
    for (let round = 0; round < 2; round += 1) {
      const again = await start(home, env);

      await again.server.install!.idle();
      expect(again.notices.filter((line) => !line.startsWith("GALLEY_PUBLIC_URL isn't set"))).toEqual([]);
      expect(snapshot(home)).toEqual(before);
      await stop(again);
    }
    // Another repository named later doesn't make a second site: it is ignored, and the operator is told.
    const other = await start(home, { ...env, GALLEY_SITE_REPOSITORY: bareRepository(SITE_FILES) });

    await other.server.install!.idle();
    expect(other.notices.join("\n")).toMatch(/GALLEY_SITE_REPOSITORY is ignored: this install already looks after/);
    expect(snapshot(home)).toEqual(before);
  });

  it("from one config file (warned when others can read it), restarted twice with nothing changing; the deploy key waits without crashing", async () => {
    const home = folder("home");
    const bare = bareRepository(SITE_FILES);
    const file = join(folder("config"), "install.json");

    writeFileSync(file, JSON.stringify({ password: PASSWORD, site: { repository: bare, access: "token", token: "fake-access-key-0000" }, author: { name: "File Editor", email: "file@example.com" }, liveUrl: "https://www.example.com" }));
    chmodSync(file, 0o644);
    const first = await start(home, { GALLEY_INSTALL_CONFIG: file });

    expect(first.notices.join("\n")).toMatch(/can be read by other users on this server/);
    await first.server.install!.idle();
    expect((await first.server.install!.status()).step).toBe("done");
    const before = snapshot(home);

    await stop(first);
    chmodSync(file, 0o600);
    for (let round = 0; round < 2; round += 1) {
      const again = await start(home, { GALLEY_INSTALL_CONFIG: file });

      await again.server.install!.idle();
      expect(snapshot(home)).toEqual(before);
      await stop(again);
    }

    // A repository reached with the install's own key that the code host doesn't know yet: the server starts, the site waits.
    const sshBin = folder("ssh-bin");
    const path = process.env.PATH;

    writeFileSync(join(sshBin, "ssh"), "#!/bin/sh\necho 'git@code.example: Permission denied (publickey).' >&2\nexit 255\n");
    chmodSync(join(sshBin, "ssh"), 0o755);
    process.env.PATH = `${sshBin}:${path}`;
    try {
      const waiting = await start(folder("home"), { GALLEY_PASSWORD: PASSWORD, GALLEY_SITE_REPOSITORY: "git@code.example:sam/site.git" });

      await waiting.server.install!.idle();
      const cookie = await signIn(waiting.base);
      const status = await call<SetupStatus>(waiting.base, "GET", "/api/setup", { cookie });

      expect(status.body).toMatchObject({ step: "site", site: { state: "waiting", access: "deploy-key", repository: "git@code.example:sam/site.git", problem: expect.stringMatching(/Add this editor's key/) } });
      expect(status.body.site.deployKey?.publicKey).toMatch(/^ssh-ed25519 /);
    } finally {
      process.env.PATH = path;
    }
  });
});

describe("starting a hosted install", () => {
  it("ignores --sites-dir and GALLEY_SITES_DIR, saying so once", () => {
    const config = resolveConfig({ mode: "hosted", sitesDir: "/srv/sites", home: "/data", env: {} });

    expect(config.sitesDir).toBe("/data/site");
    expect(config.warnings.join("\n")).toMatch(/--sites-dir and GALLEY_SITES_DIR are ignored: a hosted Galley looks after one site/);
  });

  it("refuses an old data folder with several sites before listening, in one plain sentence", async () => {
    const home = folder("home");
    const roots = ["one", "two"].map((name) => {
      const root = join(home, "sites", name);

      mkdirSync(root, { recursive: true });
      git(root, "init", "-q", "-b", "main");
      return root;
    });

    writeFileSync(join(home, "sites.json"), JSON.stringify({ version: 2, sites: roots.map((root, i) => ({ id: `s${i}`, root, name: `S${i}`, framework: { id: "generic", name: "Site" }, lastOpenedAt: 0 })), groups: [] }));
    const refused = await start(home).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(StartupError);
    expect((refused as Error).message).toMatch(/holds 2 sites \(sites\/one, sites\/two\).*Set GALLEY_SITE_DIR/);
    const kept = await start(home, { GALLEY_SITE_DIR: "sites/two", GALLEY_PASSWORD: PASSWORD });
    const cookie = await signIn(kept.base);

    expect((await call(kept.base, "GET", "/api/sites", { cookie })).body.map((site: { root: string }) => site.root)).toEqual([roots[1]]);
  });
});

describe("a site in a folder inside its repository", () => {
  it("unattended with GALLEY_SITE_FOLDER: the whole repository is copied, the folder is the site", async () => {
    const home = folder("home");
    const bare = bareRepository({ "README.md": "# Project\n", ...Object.fromEntries(Object.entries(SITE_FILES).map(([path, content]) => [`apps/site/${path}`, content])) });
    const { server, base } = await start(home, { GALLEY_PASSWORD: PASSWORD, GALLEY_SITE_REPOSITORY: bare, GALLEY_SITE_ACCESS: "token", GALLEY_SITE_TOKEN: "unused-for-a-folder", GALLEY_SITE_FOLDER: "apps/site" });

    await server.install!.idle();
    const cookie = await signIn(base);

    expect((await call<SetupStatus>(base, "GET", "/api/setup", { cookie })).body.site).toMatchObject({ state: "connected", folder: "apps/site" });
    expect((await call(base, "GET", "/api/sites", { cookie })).body.map((site: { root: string }) => site.root)).toEqual([join(home, "site", "apps", "site")]);
    expect((await call(base, "POST", "/api/setup/site/check", { cookie, body: { repository: bare, access: "token", token: "x", folder: "../up" } })).body.error.message).toMatch(/without “\.\.”/);
  });
});

describe("the site's own commands on a hosted install", () => {
  it("don't inherit the app's password, setup code, access key or provider keys", async () => {
    const root = folder("site-commands");
    const planted = { GALLEY_PASSWORD: "fake-password-for-the-commands", ANTHROPIC_API_KEY: "sk-ant-fake-for-the-commands-000" };
    const saved = Object.fromEntries(Object.keys(planted).map((name) => [name, process.env[name]]));

    Object.assign(process.env, planted);
    try {
      expect(resolveCommand(root, "node --version").env.GALLEY_PASSWORD).toBe(planted.GALLEY_PASSWORD);
      const started = await start(folder("home"), { GALLEY_PASSWORD: PASSWORD });
      const env = resolveCommand(root, "node --version").env;

      expect(env.GALLEY_PASSWORD).toBeUndefined();
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      await stop(started);
      expect(resolveCommand(root, "node --version").env.GALLEY_PASSWORD).toBe(planted.GALLEY_PASSWORD);
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

describe("no secret in any answer or log line", () => {
  it("through the whole first run, refusals included", async () => {
    const secrets = {
      password: "fake-password-NEVER-SHOWN-1234",
      code: "fake-setup-code-NEVER-SHOWN-0123456789",
      token: "fake-access-token-NEVER-SHOWN-012345",
      assistant: "sk-ant-fakeNEVERSHOWN000000000000000",
    };
    const home = folder("home");
    const bare = bareRepository(SITE_FILES);
    const { server, base, notices, logs } = await start(home, { GALLEY_SETUP_TOKEN: secrets.code });
    const from = transcript.length;
    const code = codeOf(server);

    await call(base, "GET", "/api/setup", { bearer: `${secrets.code}x` });
    await call(base, "POST", "/api/setup/handover", { bearer: code, origin: null, body: { author: { name: "Sam", email: "sam@example.com" }, keys: { anthropic: secrets.assistant } } });
    await call(base, "POST", "/api/setup/handover", { bearer: code, origin: null, body: { keys: { anthropic: `not a key ${secrets.assistant}` } } });
    const key = await call(base, "POST", "/api/setup/deploy-key", { bearer: code, origin: null, body: {} });

    expect(key.body.publicKey).toMatch(/^ssh-ed25519 /);
    const privateKey = readFileSync(join(home, "keys", "deploy_key"), "utf8");
    const cookie = (await call(base, "POST", "/api/setup/password", { bearer: code, origin: null, body: { password: secrets.password } })).cookies[0]!;

    await call(base, "POST", "/api/auth/login", { body: { password: `${secrets.password}x` } });
    await call(base, "POST", "/api/setup/site/check", { cookie, body: { repository: `${bare}-missing`, access: "token", token: secrets.token } });
    await call(base, "POST", "/api/setup/site/check", { cookie, body: { repository: `https://user:${secrets.token}@code.invalid/x.git`, access: "token" } });
    const job = await call<Job>(base, "POST", "/api/setup/site", { cookie, body: { repository: bare, access: "token", token: secrets.token } });

    await waitForJob(base, cookie, job.body);
    await call(base, "GET", "/api/setup", { cookie });
    await call(base, "GET", "/api/settings", { cookie });
    await call(base, "GET", "/api/meta", { cookie });
    await call(base, "POST", "/api/install/password", { cookie, body: { current: `${secrets.password}x`, next: "a different long one" } });

    const everything = [...transcript.slice(from), ...notices, ...logs].join("\n");
    const keyLines = privateKey.split("\n").filter((line) => line.length > 20 && !line.startsWith("-----"));

    expect(keyLines.length).toBeGreaterThan(0);
    for (const secret of Object.values(secrets)) expect(everything).not.toContain(secret);
    for (const line of keyLines) expect(everything).not.toContain(line);
    expect((await call(base, "GET", "/api/setup", { cookie })).body.assistantKey).toBe(true);
    expect(readFileSync(join(home, "install.json"), "utf8")).not.toContain(secrets.password);
    expect(readFileSync(join(home, "site", ".git", "config"), "utf8")).not.toContain(secrets.token);
  });
});
