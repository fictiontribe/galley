/**
 * How the install reaches its site's repository, kept in `<home>/keys/`
 * (0700):
 *
 *   deploy_key, deploy_key.pub   the install's own ed25519 key (private half 0600)
 *   known_hosts                  code hosts' keys, accepted on first use
 *   site-token                   an access key, when one is used instead (0600)
 *   askpass                      hands git that access key (0700)
 *
 * The private key and the access key never leave this folder: not in a
 * route's answer, a job, an error, a log, the repository address,
 * `.git/config` or any process's arguments. git is pointed at them through
 * its environment — GIT_SSH_COMMAND for the key, GIT_ASKPASS for the access
 * key — registered for the site's folder only (workspace/git.ts), so the
 * site's own commands never see any of it.
 */
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PRODUCT } from "../brand";
import { GalleyError } from "../errors";
import { runCommand } from "../workspace/exec";
import type { HostKind } from "../workspace/remote";
import { deployKeyPage, tokenUserName } from "./address";
import type { DeployKeyInfo } from "./types";

export const KEYS_DIR = "keys";
const PRIVATE_KEY = "deploy_key";
const KNOWN_HOSTS = "known_hosts";
const TOKEN_FILE = "site-token";
const ASKPASS = "askpass";

export function keysDir(home: string): string {
  return join(home, KEYS_DIR);
}

export async function ensureKeysDir(home: string): Promise<string> {
  const dir = keysDir(home);

  await mkdir(dir, { recursive: true, mode: 0o700 });
  // A folder made earlier with a looser umask is tightened.
  await chmod(dir, 0o700);
  return dir;
}

/** Written beside the target and renamed into place, so a crash never leaves half a key. */
async function writePrivate(path: string, content: string, mode = 0o600): Promise<void> {
  const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;

  await writeFile(temp, content, { mode });
  await chmod(temp, mode);
  try {
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/** "SHA256:…" — the fingerprint code hosts list beside a key: SHA-256 of the key blob, base64 without padding. */
export function fingerprintOf(publicKey: string): string {
  const blob = publicKey.trim().split(/\s+/)[1] ?? "";

  return `SHA256:${createHash("sha256").update(Buffer.from(blob, "base64")).digest("base64").replace(/=+$/, "")}`;
}

/** The public half of the install's key, or null when none has been made yet. */
export async function readDeployKey(home: string, repository: string | null): Promise<DeployKeyInfo | null> {
  const publicKey = await readFile(join(keysDir(home), `${PRIVATE_KEY}.pub`), "utf8").catch(() => null);
  const privateExists = await stat(join(keysDir(home), PRIVATE_KEY)).then((info) => info.isFile(), () => false);

  if (!publicKey?.trim() || !privateExists) return null;
  const line = publicKey.trim().split(/\r?\n/)[0]!;
  const addUrl = deployKeyPage(repository);

  return { publicKey: line, fingerprint: fingerprintOf(line), ...(addUrl ? { addUrl } : {}) };
}

/**
 * Makes the install's key when there is none (or replaces both halves when
 * `rotate`). ssh-keygen gets an argument array, never a shell string; a
 * missing tool is a plain error.
 */
export async function ensureDeployKey(home: string, repository: string | null, options: { rotate?: boolean } = {}): Promise<DeployKeyInfo> {
  if (!options.rotate) {
    const existing = await readDeployKey(home, repository);

    if (existing) return existing;
  }
  const dir = await ensureKeysDir(home);
  const staging = join(dir, `.new-${randomBytes(6).toString("hex")}`);
  const result = await runCommand("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", `${PRODUCT.slug}-editor`, "-f", staging], {
    cwd: dir,
    timeoutMs: 30_000,
  });

  try {
    if (result.spawnError?.code === "ENOENT") {
      throw new GalleyError(
        "unconfigured",
        "This editor can't make its own key because ssh-keygen isn't installed on the server. Install OpenSSH (the openssh-client package), or connect with an access key instead."
      );
    }
    if (result.spawnError || result.code !== 0) {
      throw new GalleyError("internal", "This editor couldn't make its own key. Try again, or connect with an access key instead.", result.stderr.trim().slice(-500) || result.spawnError?.message);
    }
    // Moved into place, never read into this process. The private half goes
    // last: until it lands, the pair is incomplete and readDeployKey says so.
    await chmod(staging, 0o600);
    await chmod(`${staging}.pub`, 0o644);
    await rename(`${staging}.pub`, join(dir, `${PRIVATE_KEY}.pub`));
    await rename(staging, join(dir, PRIVATE_KEY));
  } finally {
    await rm(staging, { force: true });
    await rm(`${staging}.pub`, { force: true });
  }
  const info = await readDeployKey(home, repository);

  if (!info) throw new GalleyError("internal", "This editor couldn't make its own key. Try again, or connect with an access key instead.");
  return info;
}

export async function storeAccessToken(home: string, token: string): Promise<void> {
  const dir = await ensureKeysDir(home);

  await writePrivate(join(dir, TOKEN_FILE), `${token}\n`);
}

export async function forgetAccessToken(home: string): Promise<void> {
  await rm(join(keysDir(home), TOKEN_FILE), { force: true });
}

export async function hasAccessToken(home: string): Promise<boolean> {
  return stat(join(keysDir(home), TOKEN_FILE)).then((info) => info.isFile() && info.size > 1, () => false);
}

/** Single-quoted for a POSIX shell: the one place a path goes through one (GIT_SSH_COMMAND is run by sh). */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The program git asks for the user name and the access key. It reads the
 * key from its file at the moment git asks, so the key is in no process's
 * arguments and no environment variable.
 */
async function writeAskpass(dir: string, tokenFile: string, host: HostKind | null, name = ASKPASS): Promise<string> {
  const path = join(dir, name);
  const script = [
    "#!/bin/sh",
    `# Written by ${PRODUCT.name}: answers git's questions for the site's repository. Holds no secret itself.`,
    'case "$1" in',
    `  Username*) printf '%s\\n' ${shellQuote(tokenUserName(host))} ;;`,
    `  *) cat ${shellQuote(tokenFile)} ;;`,
    "esac",
    "",
  ].join("\n");

  await writePrivate(path, script, 0o700);
  return path;
}

/** GIT_SSH_COMMAND for the install's key: only that key, no agent, no prompts, host keys accepted on first use and kept in the keys folder. */
export function sshCommand(home: string): string {
  const dir = keysDir(home);

  return [
    "ssh",
    "-F", "/dev/null",
    "-i", shellQuote(join(dir, PRIVATE_KEY)),
    "-o", "IdentitiesOnly=yes",
    "-o", "IdentityAgent=none",
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", `UserKnownHostsFile=${shellQuote(join(dir, KNOWN_HOSTS))}`,
    "-o", "ConnectTimeout=20",
  ].join(" ");
}

/**
 * Environment for git when the site's repository is reached with an access
 * key: GIT_ASKPASS answers, and the machine's own credential helpers are
 * switched off for these calls (GIT_CONFIG_*), so the key is neither looked
 * up elsewhere nor saved anywhere.
 */
function tokenEnv(askpass: string): Record<string, string> {
  return {
    GIT_ASKPASS: askpass,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: "",
  };
}

export type RepositoryAccess = "deploy-key" | "token" | "none";

/** What git needs in its environment for the stored access. Writes the askpass program when an access key is used. */
export async function accessEnv(home: string, access: RepositoryAccess, host: HostKind | null): Promise<Record<string, string>> {
  if (access === "deploy-key") {
    // ssh skips an identity file that isn't there and falls back to the server user's own keys: the install's key must exist first.
    await ensureDeployKey(home, null);
    return { GIT_SSH_COMMAND: sshCommand(home) };
  }
  if (access === "token") {
    const dir = await ensureKeysDir(home);

    return tokenEnv(await writeAskpass(dir, join(dir, TOKEN_FILE), host));
  }
  return {};
}

/**
 * Access for one check of a repository with an access key that isn't stored
 * yet: the key goes into its own short-lived file. `dispose` removes both.
 */
export async function trialAccess(
  home: string,
  access: RepositoryAccess,
  host: HostKind | null,
  token: string | null
): Promise<{ env: Record<string, string>; dispose: () => Promise<void> }> {
  if (access !== "token" || token === null) return { env: await accessEnv(home, access, host), dispose: async () => {} };
  const dir = await ensureKeysDir(home);
  const id = randomBytes(6).toString("hex");
  const file = join(dir, `.check-${id}`);

  await writePrivate(file, `${token}\n`);
  const askpass = await writeAskpass(dir, file, host, `.askpass-${id}`);

  return {
    env: tokenEnv(askpass),
    dispose: async () => {
      await rm(file, { force: true });
      await rm(askpass, { force: true });
    },
  };
}
