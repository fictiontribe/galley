/**
 * The write surface (Principle 6): which repo paths the app may change in
 * which mode. Pure functions — containment on disk is `paths.ts`'s job.
 */
import picomatch from "picomatch";
import type { AgentMode, WritableConfig } from "../types";

/** Lockfiles: changed by package managers, never by hand or by the assistant. */
const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "deno.lock",
  "gemfile.lock",
  "composer.lock",
  "cargo.lock",
  "poetry.lock",
  "pipfile.lock",
  "uv.lock",
  "go.sum",
]);

export type DenyReason = string | null;

/**
 * Whether a file is a secrets file, by its name: one whose name starts with
 * ".env", in any letter case and in any folder. So `.env`, `.env.local`,
 * `.env-production`, `.env_local`, `.envrc` and `.ENV` all are; `env.d.ts`
 * and `my.env.md` are not.
 *
 * The app never shows, writes, commits or deploys such a file, and every
 * place that decides one of those asks here, so they can't come to disagree.
 *
 * It errs on the side of refusing. A name can't say what a file holds, so a
 * harmless file that happens to start the same way (`.envoy.yaml`) is taken
 * for one too: hiding a file that held no secret costs a person a moment,
 * and showing one that did can't be taken back.
 */
export function isSecretsFile(path: string): boolean {
  const name = path.replace(/\\/g, "/").split("/").pop() ?? "";

  return name.toLowerCase().startsWith(".env");
}

/**
 * The hard deny-list. Compared case-insensitively because macOS and Windows
 * filesystems are: `.GIT/config` is `.git/config` there.
 */
export function deniedReason(path: string, mode: AgentMode): DenyReason {
  const segments = path.toLowerCase().split("/");
  const name = segments[segments.length - 1] ?? "";

  if (path === "") return "The site folder itself can't be overwritten.";
  if (segments.includes(".git")) return "Version-history files can't be changed from here.";
  if (segments.includes("node_modules")) return "Installed packages can't be changed from here.";
  if (isSecretsFile(name)) {
    return "Environment files can hold passwords and keys, so they can't be changed from here.";
  }
  if (LOCKFILES.has(name)) return "Lockfiles are managed by the package manager and can't be changed by hand.";
  // Dot-directories hold tool state and settings (.vscode, .astro, .github…).
  // Build mode may touch .github/ (workflows are part of a site's source).
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i] ?? "";

    if (!segment.startsWith(".")) continue;
    if (mode === "build" && i === 0 && segment === ".github") continue;
    return "Files inside hidden settings folders can't be changed from here.";
  }
  return null;
}

const matcherCache = new Map<string, (path: string) => boolean>();

function matcherFor(globs: string[]): (path: string) => boolean {
  const key = JSON.stringify(globs);
  let matcher = matcherCache.get(key);

  if (!matcher) {
    matcher = globs.length === 0 ? () => false : picomatch(globs, { dot: true });
    if (matcherCache.size > 64) matcherCache.clear();
    matcherCache.set(key, matcher);
  }
  return matcher;
}

export function writableGlobs(config: WritableConfig, mode: AgentMode): string[] {
  return mode === "build" ? [...config.content, ...config.build] : [...config.content];
}

export function matchesWritable(path: string, config: WritableConfig, mode: AgentMode): boolean {
  return matcherFor(writableGlobs(config, mode))(path);
}

/** Why `path` may not be written in `mode`, or null when it may. */
export function writeRefusal(path: string, config: WritableConfig, mode: AgentMode): string | null {
  const denied = deniedReason(path, mode);

  if (denied) return denied;
  if (!matchesWritable(path, config, mode)) {
    return mode === "content"
      ? "Only content and media can be changed in content mode. Switch to build mode to change the site's code."
      : "This file isn't one the app is allowed to change. Add it to the writable files in the site settings if it should be.";
  }
  return null;
}
