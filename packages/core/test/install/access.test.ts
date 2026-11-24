/**
 * How the install reaches its repository: its own deploy key (made with the
 * real ssh-keygen), the SSH command that uses only that key, an access key
 * handed to git through the askpass program — proven against a real git
 * server on a local port — and the rule that none of it reaches the site's
 * own commands.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GalleyError } from "../../src/errors";
import { accessEnv, ensureDeployKey, fingerprintOf, keysDir, readDeployKey, sshCommand, storeAccessToken } from "../../src/install/access";
import { deployKeyPage, normalizeRepository, redactAddress } from "../../src/install/address";
import { APP_SECRET_ENV_NAMES } from "../../src/install/starting";
import { hideFromSiteCommands, resolveCommand } from "../../src/workspace/command";
import { cloneRepository } from "../../src/workspace/scaffold";
import { gitEnv, registerGitAccess, runGit } from "../../src/workspace/git";
import { bareRepository, httpGitHost, recordingGit, sh, tempDir } from "./helpers";

const TOKEN = "fake-access-key-THIS-IS-A-TEST-0123456789";

afterEach(() => hideFromSiteCommands([]));

describe("the install's own deploy key", () => {
  it("is an ed25519 pair: private half 0600 in keys/ (0700), only the public half ever read", async () => {
    const home = tempDir("install-home-");
    const info = await ensureDeployKey(home, "git@github.com:sam/site.git");
    const dir = keysDir(home);

    expect(info.publicKey).toMatch(/^ssh-ed25519 [A-Za-z0-9+/=]+ galley-editor$/);
    expect(info.addUrl).toBe("https://github.com/sam/site/settings/keys/new");
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, "deploy_key")).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(info)).not.toContain("PRIVATE KEY");
    // The fingerprint is the one ssh-keygen (and every code host) shows.
    const listed = execFileSync("ssh-keygen", ["-l", "-E", "sha256", "-f", join(dir, "deploy_key.pub")], { encoding: "utf8" });

    expect(listed).toContain(info.fingerprint);
    expect(fingerprintOf(info.publicKey)).toBe(info.fingerprint);
    // Made once: asked again, it is the same key.
    expect((await ensureDeployKey(home, null)).publicKey).toBe(info.publicKey);
    expect(readdirSync(dir).filter((name) => name.startsWith(".new-"))).toEqual([]);
  });

  it("rotation replaces both halves", async () => {
    const home = tempDir("install-home-");
    const first = await ensureDeployKey(home, null);
    const privateBefore = readFileSync(join(keysDir(home), "deploy_key"), "utf8");
    const second = await ensureDeployKey(home, null, { rotate: true });

    expect(second.publicKey).not.toBe(first.publicKey);
    expect(readFileSync(join(keysDir(home), "deploy_key"), "utf8")).not.toBe(privateBefore);
    expect((await readDeployKey(home, null))?.publicKey).toBe(second.publicKey);
  });

  it("says plainly when ssh-keygen isn't installed", async () => {
    const home = tempDir("install-home-");
    const path = process.env.PATH;

    process.env.PATH = tempDir("install-empty-path-");
    try {
      const error = await ensureDeployKey(home, null).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(GalleyError);
      expect((error as Error).message).toMatch(/ssh-keygen isn't installed on the server.*or connect with an access key instead/);
    } finally {
      process.env.PATH = path;
    }
  });

  it("names the page to add it on for GitHub, GitLab and Bitbucket, and none for other hosts", () => {
    expect(deployKeyPage("https://github.com/sam/site.git")).toBe("https://github.com/sam/site/settings/keys/new");
    expect(deployKeyPage("git@gitlab.com:group/sub/site.git")).toBe("https://gitlab.com/group/sub/site/-/settings/repository#js-deploy-keys-settings");
    expect(deployKeyPage("git@bitbucket.org:team/site.git")).toBe("https://bitbucket.org/team/site/admin/access-keys/");
    expect(deployKeyPage("git@code.example:sam/site.git")).toBeUndefined();
  });

  it("is used over SSH with nothing else: no agent, no prompts, host keys kept in keys/", async () => {
    const home = tempDir("install-home-");
    const command = (await accessEnv(home, "deploy-key", null)).GIT_SSH_COMMAND!;

    expect(command).toBe(sshCommand(home));
    // `ssh -G` prints the settings a connection would use, without connecting.
    const effective = execFileSync("sh", ["-c", `${command} -G code.example`], { encoding: "utf8" });

    expect(effective).toContain(`identityfile ${join(keysDir(home), "deploy_key")}`);
    expect(effective).not.toMatch(/identityfile .*\.ssh/);
    expect(effective).toMatch(/^identitiesonly yes$/m);
    expect(effective).toMatch(/^identityagent none$/m);
    expect(effective).toMatch(/^batchmode yes$/m);
    expect(effective).toMatch(/^stricthostkeychecking accept-new$/m);
    expect(effective).toContain(`userknownhostsfile ${join(keysDir(home), "known_hosts")}`);
  });
});

describe("repository addresses", () => {
  it("never keep a credential, and take the form the access needs", () => {
    expect(normalizeRepository(`https://${TOKEN}@github.com/sam/site.git`, "token")).toMatchObject({ url: "https://github.com/sam/site.git", embeddedSecret: TOKEN });
    expect(normalizeRepository(`https://sam:${TOKEN}@code.example/sam/site.git`, "token")).toMatchObject({ url: "https://code.example/sam/site.git", embeddedSecret: TOKEN });
    expect(normalizeRepository("https://github.com/sam/site", "deploy-key").url).toBe("git@github.com:sam/site.git");
    expect(normalizeRepository("git@gitlab.com:group/site.git", "token").url).toBe("https://gitlab.com/group/site.git");
    expect(() => normalizeRepository("https://code.example/sam/site.git", "deploy-key")).toThrow(/SSH address, which starts with git@/);
    expect(() => normalizeRepository("git@code.example:sam/site.git", "token")).toThrow(/https:\/\/ address/);
    expect(() => normalizeRepository("/srv/repos/site.git", "token")).toThrow(/Folders on this server can't be used/);
    expect(normalizeRepository("/srv/repos/site.git", "token", { allowLocal: true }).kind).toBe("local");
    expect(() => normalizeRepository("--upload-pack=evil", "token")).toThrow(GalleyError);
    expect(() => normalizeRepository("ext::sh -c evil", "token")).toThrow(GalleyError);
    expect(redactAddress(`https://sam:${TOKEN}@code.example/x.git`)).toBe("https://code.example/x.git");
    expect(redactAddress("ssh://git@code.example/x.git")).toBe("ssh://git@code.example/x.git");
  });
});

describe("an access key over HTTPS", () => {
  it("reaches git through askpass only: never in an argument list, the address or .git/config", async () => {
    const root = tempDir("install-host-");
    const bare = bareRepository(root, "site", { "index.md": "# Home\n" });
    const host = await httpGitHost(root, { user: "x-access-token", password: TOKEN });
    const home = tempDir("install-home-");
    const target = join(home, "site");
    const recorder = recordingGit();
    const path = process.env.PATH;
    let unregister = () => {};

    try {
      await storeAccessToken(home, TOKEN);
      expect(statSync(join(keysDir(home), "site-token")).mode & 0o777).toBe(0o600);
      const env = await accessEnv(home, "token", null);

      expect(JSON.stringify(env)).not.toContain(TOKEN);
      expect(statSync(env.GIT_ASKPASS!).mode & 0o777).toBe(0o700);
      expect(readFileSync(env.GIT_ASKPASS!, "utf8")).not.toContain(TOKEN);
      unregister = registerGitAccess(target, env);
      process.env.PATH = `${recorder.dir}:${path}`;

      await cloneRepository({ url: host.url("site"), directory: target });
      expect(readFileSync(join(target, "index.md"), "utf8")).toBe("# Home\n");
      // A publish's push goes the same way.
      sh(target, "commit", "-q", "--allow-empty", "-m", "Second");
      expect((await runGit(target, ["push", "origin", "main"], { allowFailure: true })).code).toBe(0);
      expect(sh(bare, "log", "--format=%s", "-1")).toBe("Second");

      expect(host.credentials).toContain(`x-access-token:${TOKEN}`);
      expect(readFileSync(join(target, ".git", "config"), "utf8")).not.toContain(TOKEN);
      expect(sh(target, "remote", "get-url", "origin")).toBe(host.url("site"));
      const calls = recorder.calls();

      expect(calls.length).toBeGreaterThan(0);
      for (const args of calls) expect(args.join(" ")).not.toContain(TOKEN);
      // Without the registered access, git in that folder is refused: the key really came from askpass.
      unregister();
      sh(target, "commit", "-q", "--allow-empty", "-m", "Third");
      expect((await runGit(target, ["push", "origin", "main"], { allowFailure: true })).code).not.toBe(0);
    } finally {
      unregister();
      process.env.PATH = path;
      await host.close();
    }
  });

  it("is registered for the site's folder only", async () => {
    const home = tempDir("install-home-");
    const site = join(home, "site");
    const unregister = registerGitAccess(site, { GIT_SSH_COMMAND: "ssh -i only-for-the-site" });

    try {
      expect(gitEnv(undefined, false, join(site, "src")).GIT_SSH_COMMAND).toBe("ssh -i only-for-the-site");
      expect(gitEnv(undefined, false, site).GIT_SSH_COMMAND).toBe("ssh -i only-for-the-site");
      expect(gitEnv(undefined, false, home).GIT_SSH_COMMAND).toBe(process.env.GIT_SSH_COMMAND);
      expect(gitEnv(undefined, false, join(home, "site-other")).GIT_SSH_COMMAND).toBe(process.env.GIT_SSH_COMMAND);
      expect(gitEnv().GIT_SSH_COMMAND).toBe(process.env.GIT_SSH_COMMAND);
    } finally {
      unregister();
    }
    expect(gitEnv(undefined, false, site).GIT_SSH_COMMAND).toBe(process.env.GIT_SSH_COMMAND);
    expect(existsSync(site)).toBe(false);
  });
});

describe("the site's own commands", () => {
  it("never inherit this app's secrets once a hosted server hides them; locally the shell passes through", () => {
    const root = tempDir("install-site-");
    const saved: Record<string, string | undefined> = {};
    const planted: Record<string, string> = {
      GALLEY_PASSWORD: "fake-password-for-the-test",
      GALLEY_SETUP_TOKEN: "fake-setup-code-for-the-test-0123",
      GALLEY_SITE_TOKEN: TOKEN,
      ANTHROPIC_API_KEY: "sk-ant-fake-key-for-the-test-0000",
      SITE_OWN_SETTING: "kept",
    };

    for (const [name, value] of Object.entries(planted)) {
      saved[name] = process.env[name];
      process.env[name] = value;
    }
    try {
      expect(resolveCommand(root, "node --version").env.GALLEY_PASSWORD).toBe(planted.GALLEY_PASSWORD);
      hideFromSiteCommands(APP_SECRET_ENV_NAMES);
      const env = resolveCommand(root, "node --version", { CI: "1" }).env;

      for (const name of ["GALLEY_PASSWORD", "GALLEY_SETUP_TOKEN", "GALLEY_SITE_TOKEN", "ANTHROPIC_API_KEY"]) expect(env[name]).toBeUndefined();
      expect(env.SITE_OWN_SETTING).toBe("kept");
      expect(env.CI).toBe("1");
      // The repository's hooks are the site's code too.
      expect(gitEnv().GALLEY_PASSWORD).toBeUndefined();
      expect(gitEnv().SITE_OWN_SETTING).toBe("kept");
      hideFromSiteCommands([]);
      expect(resolveCommand(root, "node --version").env.ANTHROPIC_API_KEY).toBe(planted.ANTHROPIC_API_KEY);
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
