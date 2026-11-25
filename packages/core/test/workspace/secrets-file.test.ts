/**
 * Which files are secrets files by name. One rule, asked by everything that
 * shows, writes, commits or deploys a file: the engine's write rule, what a
 * publish never commits, what a deploy never takes, the server's file routes
 * and the guard an extension reads through. Each of those has its own test
 * that it refuses these names; this one holds the rule itself.
 */
import { describe, expect, it } from "vitest";
import { deniedReason, HISTORY_NOT_READ, isSecretsFile, mayBeShown, notReadReason, SECRETS_NOT_READ } from "../../src/workspace/index";

describe("a secrets file, by its name", () => {
  it("is any file whose name starts with .env, in any letter case and any folder", () => {
    for (const path of [".env", ".env.local", ".env.production", ".envrc", ".env-production", ".env_local", ".ENV", ".Env.Staging", "config/.envrc", "a/b/.env.test", "a\\b\\.ENVRC"]) {
      expect(isSecretsFile(path), path).toBe(true);
      expect(deniedReason(path.replace(/\\/g, "/"), "build"), path).toMatch(/can hold passwords and keys/);
    }
  });

  it("is no file that only has env somewhere in its name", () => {
    for (const path of ["env", "env.d.ts", "src/env.d.ts", "environment.md", "docs/my.env.md", "a.env", "dotenv.js", ".eslintrc", "src/envs/.keep"]) expect(isSecretsFile(path), path).toBe(false);
  });

  it("is still one however the path to it is written: the engine reads `.env/` and `.env/.` as `.env`", () => {
    for (const path of [".env/", ".env/.", ".env//", ".env/./", "./.env", "config/.envrc/", "config/.envrc/.", ".ENV/"]) {
      expect(isSecretsFile(path), path).toBe(true);
      expect(mayBeShown(path), path).toBe(false);
      expect(notReadReason(path), path).toBe(SECRETS_NOT_READ);
    }
    for (const path of [".git/", ".git/.", "sub/.git//"]) expect(mayBeShown(path), path).toBe(false);
  });

  it("is anything in a folder named like one", () => {
    for (const path of [".envs/production/django", ".env.d/keys", "config/.ENVS/a.txt"]) expect(isSecretsFile(path), path).toBe(true);
  });

  it("errs on the side of refusing: a harmless name that starts the same way is taken for one", () => {
    for (const path of [".envoy.yaml", ".environment", ".envelope.md"]) expect(isSecretsFile(path), path).toBe(true);
  });
});

describe("what may be shown", () => {
  it("is every file but a secrets file and the version history's own, in any letter case and at any depth", () => {
    for (const path of [".env", ".envrc", "config/.env-production", ".ENV", ".git", ".git/config", ".GIT/HEAD", "sub/.git/hooks/pre-commit", "a\\.git\\HEAD", "a\\.Envrc"]) expect(mayBeShown(path), path).toBe(false);
    for (const path of ["src/env.d.ts", ".gitignore", ".github/workflows/ci.yml", "src/git/notes.md", "docs/my.env.md", "README.md", ".gitattributes"]) expect(mayBeShown(path), path).toBe(true);
  });

  it("says why a file isn't read, in a sentence the assistant can act on", () => {
    expect(notReadReason(".env")).toBe(SECRETS_NOT_READ);
    expect(notReadReason("config/.envrc")).toBe(SECRETS_NOT_READ);
    // A secrets file inside the version history's folder is still a secrets file to whoever asks.
    expect(notReadReason(".git/.env")).toBe(SECRETS_NOT_READ);
    expect(notReadReason(".git/config")).toBe(HISTORY_NOT_READ);
    expect(notReadReason("src/content/pages/index.md")).toBeNull();
  });
});
