/**
 * Test helpers: real temporary directories and real git repositories, with
 * git isolated from the machine's own configuration and identity.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll } from "vitest";
import type { WritableConfig } from "../../src/types";

const isolation = mkdtempSync(join(tmpdir(), "ws-test-gitcfg-"));
const globalConfig = join(isolation, "gitconfig");

writeFileSync(globalConfig, "[init]\n\tdefaultBranch = main\n");
process.env.GIT_CONFIG_GLOBAL = globalConfig;
process.env.GIT_CONFIG_NOSYSTEM = "1";
for (const key of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) {
  delete process.env[key];
}

const created: string[] = [isolation];

export function tempDir(prefix = "ws-test-"): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));

  created.push(dir);
  return dir;
}

export function cleanupAll(): void {
  while (created.length > 1) rmSync(created.pop() as string, { recursive: true, force: true });
}

// Registered from here so every test file that imports the helpers cleans up
// its isolation config too (worker threads do not run process "exit" hooks).
afterAll(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export const IDENTITY = ["-c", "user.name=Test Person", "-c", "user.email=test@example.com"];

/** Runs git in `cwd` with a test identity. Returns trimmed stdout. */
export function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", [...IDENTITY, ...args], { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

export function writeTree(root: string, files: Record<string, string | Uint8Array>): void {
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, ...path.split("/"));

    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
}

/** A repository with `files` committed on main (or uncommitted when commit is false). */
export function makeRepo(files: Record<string, string | Uint8Array>, options: { commit?: boolean } = {}): string {
  const root = tempDir("ws-repo-");

  sh(root, "init", "-q", "-b", "main");
  writeTree(root, files);
  if (options.commit !== false) {
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", "Initial");
  }
  return root;
}

/** A bare repository seeded from `source`'s main branch, set as its `origin`. */
export function addBareRemote(source: string): string {
  const bare = tempDir("ws-bare-");

  sh(bare, "init", "-q", "--bare", "-b", "main");
  sh(source, "remote", "add", "origin", bare);
  sh(source, "push", "-q", "-u", "origin", "main");
  return bare;
}

export const WRITABLE: WritableConfig = {
  content: ["src/content/**", "src/data/**", "public/images/**"],
  build: ["src/**", "public/**", "astro.config.mjs", "package.json", ".github/**"],
};

export const PUBLISH = { branch: "", mode: "commit" as const, remote: "origin", push: true };

/** Polls until `check` returns true or the timeout passes. */
export async function until(check: () => boolean | Promise<boolean>, timeoutMs = 5000, stepMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  throw new Error("condition not met in time");
}

/** A PNG header claiming the given size — enough for image-size, a few dozen bytes on disk. */
export function pngHeader(width: number, height: number): Uint8Array {
  const buffer = Buffer.alloc(33);

  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  buffer[24] = 8;
  buffer[25] = 6;
  return new Uint8Array(buffer);
}
