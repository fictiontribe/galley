/**
 * The install engine against the real registry, settings and temporary git
 * repositories: connecting the one site (copying a repository, or sending a
 * starter to an empty one), the single-site rule in the engine, waiting for
 * a deploy key, the live address, and the starting values.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createSettingsService } from "../../src/ai/settings";
import { GalleyError } from "../../src/errors";
import { createInstall, createInstallRegistry, validFolder, type Install } from "../../src/install/install";
import { ONE_SITE_MESSAGE } from "../../src/install/single-site";
import { openInstallState } from "../../src/install/state";
import { readStartingValues } from "../../src/install/starting";
import { createEventBus, createSiteRegistry } from "../../src/site/index";
import { bareRepository, refusingSsh, sh, tempDir } from "./helpers";

const PASSWORD = "correct horse battery staple";
const opened: Install[] = [];

afterAll(async () => {
  for (const install of opened.splice(0)) {
    await install.dispose();
    await install.registry.dispose();
  }
});

function starters(): string {
  const dir = tempDir("install-starters-");

  mkdirSync(join(dir, "tiny", "src", "content", "pages"), { recursive: true });
  writeFileSync(join(dir, "tiny", "package.json"), JSON.stringify({ name: "tiny", private: true, scripts: { dev: "echo dev" } }, null, 2));
  writeFileSync(join(dir, "tiny", "src", "content", "pages", "index.md"), "---\ntitle: Home\n---\nHello\n");
  return dir;
}

async function makeInstall(options: { home?: string; env?: NodeJS.ProcessEnv } = {}) {
  const home = options.home ?? tempDir("install-home-");
  const store = await openInstallState(home);
  const events = createEventBus();
  const settings = createSettingsService({ home, env: options.env ?? {} });
  const startersDir = starters();
  const inner = await createSiteRegistry({
    home,
    sitesDir: join(home, "site"),
    startersDir,
    events,
    overlayScript: () => "",
    settings,
    installSite: () => store.siteFolder(),
    liveUrl: () => store.read().liveUrl,
    previewPolicy: false,
    install: async () => {},
  });
  let install: Install | null = null;
  const registry = createInstallRegistry(inner, store, () => (install ? install.job : null));

  install = createInstall({ store, registry, settings, events, startersDir, allowLocalRepositories: true, installDependencies: async () => {} });
  opened.push(install);
  return { home, store, settings, install, registry, inner };
}

async function connected(install: Install, request: Parameters<Install["connect"]>[0]) {
  const job = await install.connect(request);

  await install.idle();
  return install.job(job.id)!;
}

describe("connecting the one site", () => {
  it("copies an existing repository with its history into <home>/site and opens it", async () => {
    const { home, store, install, registry } = await makeInstall();
    const bare = bareRepository(tempDir("install-remote-"), "site", { "src/content/pages/index.md": "---\ntitle: Home\n---\n" });

    await store.setPassword(PASSWORD);
    const check = await install.check({ repository: bare, access: "token", token: "unused-for-a-folder" });

    expect(check).toEqual({ reachable: true, writable: null, empty: false, defaultBranch: "main", message: null });
    // A leftover from a failed attempt is cleared first.
    mkdirSync(join(home, "site"), { recursive: true });
    writeFileSync(join(home, "site", "leftover.txt"), "from before");
    const job = await connected(install, { repository: bare, access: "token", token: "unused-for-a-folder" });

    expect(job).toMatchObject({ kind: "setup", state: "done", siteId: install.siteId() });
    expect(existsSync(join(home, "site", "leftover.txt"))).toBe(false);
    expect(sh(join(home, "site"), "log", "--format=%s")).toBe("First");
    const site = await install.site();

    expect(site).toMatchObject({ state: "connected", repository: bare, branch: "main", access: "token", problem: null });
    expect((await registry.list()).map((summary) => summary.id)).toEqual([install.siteId()]);
    expect(await registry.get(install.siteId()!)).not.toBeNull();
    expect(await registry.get("someone-else")).toBeNull();
    expect((await install.status()).step).toBe("details");
    // The job is found the way the app asks for any job.
    expect(registry.job(job.id)?.state).toBe("done");

    await expect(install.connect({ repository: bare, access: "token", token: "x" })).rejects.toMatchObject({ code: "conflict", message: "This editor already looks after a site. Each site gets an editor of its own." });
  });

  it("sends a starter to an empty repository as the first version, under the publishing name", async () => {
    const { home, store, install, settings } = await makeInstall();
    const bare = bareRepository(tempDir("install-remote-"), "empty");

    await store.setPassword(PASSWORD);
    await install.setDetails({ author: { name: "Sam Editor", email: "sam@example.com" } });
    expect((await install.check({ repository: bare, access: "token", token: "x", starter: { id: "tiny" } })).empty).toBe(true);
    const job = await connected(install, { repository: bare, access: "token", token: "x", starter: { id: "tiny", name: "Harbour notes" } });

    expect(job.state).toBe("done");
    expect(sh(bare, "log", "--format=%an <%ae>|%s", "main")).toBe("Sam Editor <sam@example.com>|Start Harbour notes from a starter");
    expect(sh(join(home, "site"), "status", "--porcelain")).toBe("");
    expect(JSON.parse(readFileSync(join(home, "site", "package.json"), "utf8")).name).toBe("harbour-notes");
    expect((await install.site()).name).toBe("Harbour notes");
    expect((await settings.get()).author).toEqual({ name: "Sam Editor", email: "sam@example.com" });
  });

  it("starts one connection at a time", async () => {
    const { install, store } = await makeInstall();
    const bare = bareRepository(tempDir("install-remote-"), "site", { "a.md": "a\n" });

    await store.setPassword(PASSWORD);
    const results = await Promise.allSettled([install.connect({ repository: bare, access: "token", token: "x" }), install.connect({ repository: bare, access: "token", token: "x" })]);

    await install.idle();
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((results.find((result) => result.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "busy" });
    expect((await install.site()).state).toBe("connected");
  });

  it("won't send a starter to a repository that already has versions", async () => {
    const { install, store, home } = await makeInstall();
    const bare = bareRepository(tempDir("install-remote-"), "full", { "a.md": "a\n" });

    await store.setPassword(PASSWORD);
    expect((await install.check({ repository: bare, access: "token", token: "x", starter: { id: "tiny" } })).message).toMatch(/A starter needs an empty repository/);
    const job = await connected(install, { repository: bare, access: "token", token: "x", starter: { id: "tiny" } });

    expect(job.state).toBe("error");
    expect(job.detail).toMatch(/already has versions in it/);
    expect(existsSync(join(home, "site"))).toBe(false);
    expect((await install.site()).state).toBe("failed");
    expect(sh(bare, "log", "--format=%s", "main")).toBe("First");
  });

  it("refuses a repository that isn't there, plainly, and a starter that doesn't exist before anything starts", async () => {
    const { install } = await makeInstall();
    const missing = join(tempDir("install-remote-"), "nothing.git");

    expect(await install.check({ repository: missing, access: "token", token: "x" })).toMatchObject({ reachable: false, message: expect.stringMatching(/didn't accept the access key, or there's no repository at that address/) });
    await expect(install.connect({ repository: missing, access: "token", token: "x", starter: { id: "nope" } })).rejects.toThrow(/That starter couldn't be found/);
    await expect(install.connect({ repository: "not an address", access: "token", token: "x" })).rejects.toThrow(GalleyError);
    await expect(install.connect({ repository: missing, access: "token" })).rejects.toThrow(/Paste the access key/);
  });

  it("waits, without failing, while the code host doesn't know this editor's key yet — and shows the key", async () => {
    const { install, store } = await makeInstall();
    const path = process.env.PATH;

    await store.setPassword(PASSWORD);
    process.env.PATH = `${refusingSsh()}:${path}`;
    try {
      const job = await connected(install, { repository: "git@code.example:sam/site.git", access: "deploy-key" });
      const site = await install.site();

      expect(job.state).toBe("error");
      expect(site).toMatchObject({ state: "waiting", repository: "git@code.example:sam/site.git", access: "deploy-key", problem: expect.stringMatching(/Add this editor's key to the repository/) });
      expect(site.deployKey?.publicKey).toMatch(/^ssh-ed25519 /);
      expect((await install.check({ repository: "git@code.example:sam/site.git", access: "deploy-key" })).reachable).toBe(false);
    } finally {
      process.env.PATH = path;
    }
  });
});

describe("a site in a folder inside its repository", () => {
  const REPOSITORY = {
    "README.md": "# The whole project\n",
    "packages/tool/index.js": "export {};\n",
    "apps/site/package.json": "{\"name\":\"site\",\"private\":true}\n",
    "apps/site/src/content/pages/index.md": "---\ntitle: Home\n---\nHello\n",
  };

  it("copies the whole repository, opens only the folder, and its changes show in Proof and publish", async () => {
    const { home, store, install, registry } = await makeInstall();
    const bare = bareRepository(tempDir("install-remote-"), "monorepo", REPOSITORY);

    await store.setPassword(PASSWORD);
    await install.setDetails({ author: { name: "Sam Editor", email: "sam@example.com" } });
    const job = await connected(install, { repository: bare, folder: "apps/site/", access: "token", token: "x" });

    expect(job.state).toBe("done");
    expect(existsSync(join(home, "site", "README.md"))).toBe(true);
    expect(store.read().site).toMatchObject({ root: "site", folder: "apps/site" });
    expect(store.siteFolder()).toBe(join(home, "site", "apps", "site"));
    expect(store.checkoutFolder()).toBe(join(home, "site"));
    expect(await install.site()).toMatchObject({ state: "connected", folder: "apps/site" });
    const [summary] = await registry.list();

    expect(summary?.root).toBe(realpathSync(join(home, "site", "apps", "site")));
    const site = (await registry.get(install.siteId()!))!;

    writeFileSync(join(home, "site", "apps", "site", "src", "content", "pages", "index.md"), "---\ntitle: Home\n---\nHello again\n");
    // Outside the site's folder: never the site's change, never published with it.
    writeFileSync(join(home, "site", "README.md"), "# Changed outside the site\n");
    const changes = await site.changes();

    expect(changes.files.map((file) => file.path)).toEqual(["src/content/pages/index.md"]);
    const published = await site.publish({ message: "Say hello again" });

    expect(published).toMatchObject({ ok: true, pushed: true, files: ["src/content/pages/index.md"] });
    expect(sh(bare, "log", "--format=%an|%s", "-1", "main")).toBe("Sam Editor|Say hello again");
    expect(sh(bare, "show", "--name-only", "--format=", "main")).toBe("apps/site/src/content/pages/index.md");
    expect((await site.history(5)).length).toBeGreaterThanOrEqual(2);
  });

  it("refuses a folder that isn't there, leads outside, or comes with a starter — naming the folder", async () => {
    const { install, store, home } = await makeInstall();
    const bare = bareRepository(tempDir("install-remote-"), "monorepo", { ...REPOSITORY, "apps/notes.md": "just a file\n" });

    await store.setPassword(PASSWORD);
    const missing = await connected(install, { repository: bare, folder: "apps/nope", access: "token", token: "x" });

    expect(missing).toMatchObject({ state: "error", detail: expect.stringMatching(/The repository has no folder “apps\/nope”/) });
    expect(existsSync(join(home, "site"))).toBe(false);
    const file = await connected(install, { repository: bare, folder: "apps/notes.md", access: "token", token: "x" });

    expect(file.detail).toMatch(/“apps\/notes.md” is a file in the repository, not a folder/);
    await expect(install.connect({ repository: bareRepository(tempDir("install-remote-"), "empty"), folder: "apps/site", access: "token", token: "x", starter: { id: "tiny" } })).rejects.toThrow(/choose a starter or a folder, not both/);
  });

  it("refuses a link that leads out of the repository", async () => {
    const { install, store } = await makeInstall();
    const work = tempDir("install-seed-");
    const bare = join(tempDir("install-remote-"), "linked.git");

    sh(work, "init", "-q", "-b", "main");
    writeFileSync(join(work, "a.md"), "a\n");
    symlinkSync(tempDir("install-elsewhere-"), join(work, "out"));
    sh(work, "add", "-A");
    sh(work, "commit", "-q", "-m", "First");
    sh(work, "clone", "-q", "--bare", work, bare);
    await store.setPassword(PASSWORD);
    const job = await connected(install, { repository: bare, folder: "out", access: "token", token: "x" });

    expect(job.detail).toMatch(/The folder “out” leads outside the repository/);
  });

  it.each([
    ["apps/site", "apps/site"],
    ["apps/site/", "apps/site"],
    ["", null],
    [undefined, null],
    ["/apps/site", /forward slashes/],
    ["C:/site", /forward slashes/],
    ["apps\\site", /forward slashes/],
    ["../elsewhere", /without “\.\.”/],
    ["apps/../../x", /without “\.\.”/],
    ["apps//site", /without “\.\.”/],
    ["./site", /without “\.\.”/],
    [".git/hooks", /version history/],
  ] as const)("the folder %j → %s", (given, expected) => {
    if (expected === null || typeof expected === "string") expect(validFolder(given)).toBe(expected);
    else expect(() => validFolder(given)).toThrow(expected);
  });
});

describe("the single-site rule, in the engine", () => {
  it("refuses every way of adding, removing, scanning for or filing sites", async () => {
    const { registry } = await makeInstall();
    const refusals = [
      registry.open({ path: "/tmp" }),
      registry.clone({ url: "https://code.example/a.git" }),
      registry.create({ name: "x", starter: "tiny" }),
      registry.remove("x"),
      registry.update!("x", { pinned: true }),
      registry.createGroup!({ name: "Clients" }),
      registry.updateGroup!("g", { name: "x" }),
      registry.removeGroup!("g"),
      registry.orderGroups!([]),
      registry.scan!({ path: "/tmp" }),
      registry.addMany!({ paths: ["/tmp"] }),
    ];

    for (const refusal of refusals) await expect(refusal).rejects.toMatchObject({ code: "forbidden", message: ONE_SITE_MESSAGE });
    expect(await registry.list()).toEqual([]);
    expect(await registry.groups!()).toEqual([]);
    expect((await registry.starters()).map((starter) => starter.id)).toEqual(["tiny"]);
  });
});

describe("the live address", () => {
  // Was "waits until the site is connected, then goes into its settings file": the file was then an unpublished change nobody made.
  it("is kept in the install's state, never in the site's files, and the site's model uses it", async () => {
    const { install, store, home, registry } = await makeInstall();
    const bare = bareRepository(tempDir("install-remote-"), "site", { "galley.config.json": "{\n  \"name\": \"Site\"\n}\n" });

    await store.setPassword(PASSWORD);
    await install.setDetails({ liveUrl: "https://www.example.com/" });
    expect(store.read().liveUrl).toBe("https://www.example.com");
    expect((await install.status()).liveUrl).toBe("https://www.example.com");
    await connected(install, { repository: bare, access: "token", token: "x" });
    const config = () => readFileSync(join(home, "site", "galley.config.json"), "utf8");
    const site = (await registry.get(install.siteId()!))!;

    expect(config()).toBe("{\n  \"name\": \"Site\"\n}\n");
    expect(sh(join(home, "site"), "status", "--porcelain")).toBe("");
    expect((await site.model()).urls.production).toBe("https://www.example.com");
    expect(await install.status()).toMatchObject({ liveUrl: "https://www.example.com", fixed: [] });
    // Changed after: the open site reads it again; the files still say nothing.
    await install.setDetails({ liveUrl: "https://example.org" });
    expect((await site.model()).urls.production).toBe("https://example.org");
    expect(sh(join(home, "site"), "status", "--porcelain")).toBe("");
    await install.setDetails({ liveUrl: null });
    expect((await site.model()).urls.production).toBeUndefined();
    expect((await install.status()).liveUrl).toBeNull();
    await expect(install.setDetails({ liveUrl: "ftp://example.com" })).rejects.toThrow(/should start with https/);
  });

  it("the site's own settings file wins when it names one, and the address is then shown as fixed", async () => {
    const { install, store, registry } = await makeInstall();
    const bare = bareRepository(tempDir("install-remote-"), "site", { "galley.config.json": JSON.stringify({ name: "Site", urls: { production: "https://www.site.example" } }) });

    await store.setPassword(PASSWORD);
    await connected(install, { repository: bare, access: "token", token: "x" });
    await install.setDetails({ liveUrl: "https://www.example.com" });
    expect((await (await registry.get(install.siteId()!))!.model()).urls.production).toBe("https://www.site.example");
    expect(await install.status()).toMatchObject({ liveUrl: "https://www.site.example", fixed: ["liveUrl"] });
  });

  it("a data folder whose state still has a live address waiting from an older version keeps it", async () => {
    const home = tempDir("install-home-");
    const first = await makeInstall({ home });
    const bare = bareRepository(tempDir("install-remote-"), "site", { "a.md": "a\n" });

    await first.store.setPassword(PASSWORD);
    await first.install.dispose();
    await first.registry.dispose();
    // What an older version wrote: the address waiting for the site to be connected.
    const file = join(home, "install.json");

    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), liveUrl: undefined, pendingLiveUrl: "https://www.example.com" }));
    const second = await makeInstall({ home });

    expect(second.store.read()).toMatchObject({ liveUrl: "https://www.example.com", pendingLiveUrl: null });
    await connected(second.install, { repository: bare, access: "token", token: "x" });
    expect((await (await second.registry.get(second.install.siteId()!))!.model()).urls.production).toBe("https://www.example.com");
    expect(sh(join(home, "site"), "status", "--porcelain")).toBe("");
  });
});

describe("starting values", () => {
  it("read the environment first, then the one file, and warn about a file others can read", () => {
    const dir = tempDir("install-config-");
    const file = join(dir, "install.json");

    writeFileSync(
      file,
      JSON.stringify({ address: "https://cms.example.com", password: "from the file, long enough", site: { repository: "git@github.com:sam/site.git", folder: "apps/site", starter: { id: "tiny", look: "harbour" } }, author: { name: "File", email: "file@example.com" }, keys: { anthropic: "sk-ant-fake0000000000000000", nope: "x" } }),
      { mode: 0o644 }
    );
    const { values, warnings } = readStartingValues({ GALLEY_INSTALL_CONFIG: file, GALLEY_AUTHOR_NAME: "Env", GALLEY_AUTHOR_EMAIL: "env@example.com", GALLEY_SITE_BRANCH: "live" }, dir);

    expect(values).toMatchObject({
      address: "https://cms.example.com",
      password: "from the file, long enough",
      site: { repository: "git@github.com:sam/site.git", access: "deploy-key", branch: "live", folder: "apps/site", starter: { id: "tiny", look: "harbour" } },
      author: { name: "Env", email: "env@example.com" },
      keys: { anthropic: "sk-ant-fake0000000000000000" },
    });
    expect(warnings.join("\n")).toMatch(/can be read by other users on this server/);
    expect(warnings.join("\n")).toMatch(/names a key “nope” this app doesn't use/);
  });

  it("refuse what can't work, without quoting a secret", () => {
    expect(readStartingValues({ GALLEY_SITE_REPOSITORY: "git@github.com:a/b.git", GALLEY_SITE_FOLDER: "apps/site" }).values.site?.folder).toBe("apps/site");
    expect(() => readStartingValues({ GALLEY_SETUP_TOKEN: "short" })).toThrow(/at least 24 characters/);
    expect(() => readStartingValues({ GALLEY_SETUP_TOKEN_SHA256: "abc" })).toThrow(/64 hexadecimal/);
    expect(() => readStartingValues({ GALLEY_SITE_REPOSITORY: "git@github.com:a/b.git", GALLEY_SITE_ACCESS: "token" })).toThrow(/Set GALLEY_SITE_TOKEN too/);
    const dir = tempDir("install-config-");

    writeFileSync(join(dir, "bad.json"), JSON.stringify({ password: "a-secret-that-must-not-be-quoted", extra: 1 }), { mode: 0o600 });
    let message = "";

    try {
      readStartingValues({ GALLEY_INSTALL_CONFIG: "bad.json" }, dir);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/has something it can't use/);
    expect(message).not.toContain("a-secret-that-must-not-be-quoted");
  });

  it("are used once and only while the install lacks them: a person's later change sticks across restarts", async () => {
    const home = tempDir("install-home-");
    const values = { password: PASSWORD, author: { name: "Seed", email: "seed@example.com" }, liveUrl: "https://www.example.com" };
    const first = await makeInstall({ home });
    const started = await first.install.start(values);

    expect(started.setupCode).toBeNull();
    expect(await first.store.checkPassword(PASSWORD)).toBe(true);
    expect((await first.install.status()).author).toEqual(values.author);
    await first.install.setDetails({ author: { name: "Changed", email: "changed@example.com" } });
    await first.store.setPassword("a password changed in the app", { signOutEveryone: true });
    await first.install.dispose();
    await first.registry.dispose();

    const second = await makeInstall({ home });
    const again = await second.install.start(values);

    expect(await second.store.checkPassword("a password changed in the app")).toBe(true);
    expect((await second.install.status()).author).toEqual({ name: "Changed", email: "changed@example.com" });
    expect(again.notices.join("\n")).toMatch(/GALLEY_PASSWORD no longer matches the password chosen in the app.*--reset-password/);
  });

  it("without a password, mint a setup code (or keep the operator's) — and --reset-password starts first run again", async () => {
    const home = tempDir("install-home-");
    const first = await makeInstall({ home });
    const minted = await first.install.start({});

    expect(minted.setupCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.store.setupCodeMatches(minted.setupCode!)).toBe(true);
    const supplied = await first.install.start({ setupToken: "the-operator-chose-this-code-01234" });

    expect(supplied.setupCode).toBe("the-operator-chose-this-code-01234");
    expect(first.store.setupCodeMatches(minted.setupCode!)).toBe(false);
    await first.store.setPassword(PASSWORD);
    expect((await first.install.start({})).setupCode).toBeNull();
    const reset = await first.install.start({ password: PASSWORD }, { resetPassword: true });

    expect(first.store.hasPassword()).toBe(false);
    expect(reset.setupCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.store.setupCodeMatches(reset.setupCode!)).toBe(true);
  });

  it("a used setup code stays dead: after --reset-password the operator's old code (or its hash) is ignored and a fresh link is made", async () => {
    const { createHash } = await import("node:crypto");
    const home = tempDir("install-home-");
    const code = "the-operator-chose-this-code-01234";
    const sha256 = createHash("sha256").update(code).digest("hex");
    const { install, store } = await makeInstall({ home });

    // First run with the operator's code, as a generated compose file starts it (only the hash).
    expect((await install.start({ setupTokenSha256: sha256 })).setupCode).toBeNull();
    expect(store.setupCodeMatches(code)).toBe(true);
    await store.setPassword(PASSWORD);
    expect(store.setupCodeMatches(code)).toBe(false);
    expect(store.setupCodeSpent({ plain: code })).toBe(true);

    // The password is forgotten; the environment still carries the same hash.
    const reset = await install.start({ setupTokenSha256: sha256 }, { resetPassword: true });

    expect(store.hasPassword()).toBe(false);
    expect(store.setupCodeMatches(code)).toBe(false);
    expect(reset.setupCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.setupCodeMatches(reset.setupCode!)).toBe(true);
    expect(reset.notices.join(" ")).toContain("has been used already");

    // The same with the code itself in the environment, and across a restart.
    await store.setPassword(PASSWORD);
    const again = await makeInstall({ home });
    const second = await again.install.start({ setupToken: code }, { resetPassword: true });

    expect(second.setupCode).not.toBe(code);
    expect(again.store.setupCodeMatches(code)).toBe(false);
    expect(again.store.setupCodeMatches(second.setupCode!)).toBe(true);
  });
});
