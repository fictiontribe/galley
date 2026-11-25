/**
 * Which files are secrets files by name. One rule, asked by everything that
 * shows, writes, commits or deploys a file: the engine's write rule, what a
 * publish never commits, what a deploy never takes, the server's file routes
 * and the guard an extension reads through. Each of those has its own test
 * that it refuses these names; this one holds the rule itself.
 */
import { describe, expect, it } from "vitest";
import { deniedReason, isSecretsFile } from "../../src/workspace/index";

describe("a secrets file, by its name", () => {
  it("is any file whose name starts with .env, in any letter case and any folder", () => {
    for (const path of [".env", ".env.local", ".env.production", ".envrc", ".env-production", ".env_local", ".ENV", ".Env.Staging", "config/.envrc", "a/b/.env.test", "a\\b\\.ENVRC"]) {
      expect(isSecretsFile(path), path).toBe(true);
      expect(deniedReason(path.replace(/\\/g, "/"), "build"), path).toMatch(/can hold passwords and keys/);
    }
  });

  it("is no file that only has env somewhere in its name", () => {
    for (const path of ["env", "env.d.ts", "src/env.d.ts", "environment.md", "docs/my.env.md", "a.env", "dotenv.js", ".eslintrc", "src/.envs/readme.md"]) expect(isSecretsFile(path), path).toBe(false);
  });

  it("errs on the side of refusing: a harmless name that starts the same way is taken for one", () => {
    for (const path of [".envoy.yaml", ".environment", ".envelope.md"]) expect(isSecretsFile(path), path).toBe(true);
  });
});
