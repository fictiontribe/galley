/**
 * Running the site's build and installing its dependencies.
 */
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { GalleyError } from "../errors";
import type { BuildResult, PackageManager } from "../types";
import { resolveCommand } from "./command";
import { runCommand, tailLines } from "./exec";
import { stripAnsi } from "./exec";
import { runGit } from "./git";

const OUTPUT_LINES = 200;
const OUTPUT_CHARS = 20_000;
export const BUILD_TIMEOUT_MS = 10 * 60_000;
export const INSTALL_TIMEOUT_MS = 15 * 60_000;

function trimOutput(lines: string[]): string {
  const text = tailLines(lines.join("\n"), OUTPUT_LINES);

  return text.length > OUTPUT_CHARS ? text.slice(-OUTPUT_CHARS) : text;
}

/**
 * Runs the build command and reports whether it passed, with the tail of its
 * output. Never throws for a failing build. `env` is what the site's adapter
 * asks for (SiteModel.environment); it is applied after the inherited
 * environment is cleaned, so an adapter can set a variable on purpose.
 */
export async function runBuild(root: string, command: string, options: { timeoutMs?: number; env?: Record<string, string> } = {}): Promise<BuildResult> {
  const started = Date.now();
  const lines: string[] = [];
  let resolved;

  try {
    resolved = resolveCommand(root, command, { CI: "1", ...options.env });
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started };
  }
  const result = await runCommand(resolved.file, resolved.args, {
    cwd: root,
    env: resolved.env,
    shell: resolved.shell,
    timeoutMs: options.timeoutMs ?? BUILD_TIMEOUT_MS,
    maxStdoutBytes: 0,
    onLine: (line) => {
      lines.push(stripAnsi(line));
      if (lines.length > OUTPUT_LINES * 4) lines.splice(0, lines.length - OUTPUT_LINES * 2);
    },
  });
  let output = trimOutput(lines);

  if (result.spawnError) output = `The build command couldn't be started: ${result.spawnError.message}`;
  if (result.timedOut) output = `${output}\n\nThe build took too long and was stopped.`.trim();
  return { ok: result.code === 0 && !result.timedOut, output, durationMs: Date.now() - started };
}

const INSTALL_ARGS: Record<PackageManager, string[]> = {
  npm: ["install", "--no-audit", "--no-fund"],
  pnpm: ["install"],
  yarn: ["install"],
  bun: ["install"],
};

/** The lockfiles each package manager reads and writes. */
export const LOCKFILES: Record<PackageManager, string[]> = {
  npm: ["package-lock.json", "npm-shrinkwrap.json"],
  pnpm: ["pnpm-lock.yaml"],
  yarn: ["yarn.lock"],
  bun: ["bun.lock", "bun.lockb"],
};

/**
 * How each manager installs without writing a lockfile. Yarn has no switch
 * that every version takes (1.x has --no-lockfile; 2 and later refuse it), so
 * the one it writes is taken away afterwards instead.
 */
const NO_LOCKFILE_ARGS: Record<PackageManager, string[]> = {
  npm: ["--no-package-lock"],
  pnpm: ["--no-lockfile"],
  yarn: [],
  bun: ["--no-save"],
};

export interface InstallDependenciesOptions {
  /**
   * False: when neither the site's folder nor any folder above it in its
   * repository has a lockfile for its package manager, install without
   * writing one — a lockfile the install made would show up as a change
   * nobody made, and be published with the person's edits. A site that has
   * one is installed exactly as when this is true. Default true.
   */
  addLockfile?: boolean;
}

/** The repository's top folder for `root` (where `.git` is), or null outside one. */
function repositoryTop(root: string): string | null {
  for (let dir = root; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

/** Whether `root`, or a folder above it inside its repository (a workspace's top), has a lockfile for `manager`. */
function hasLockfile(root: string, manager: PackageManager): boolean {
  const top = repositoryTop(root) ?? root;

  for (let dir = root; ; dir = dirname(dir)) {
    if (LOCKFILES[manager].some((name) => existsSync(join(dir, name)))) return true;
    if (dir === top || dirname(dir) === dir) return false;
  }
}

/** After an install that found no lockfile: removes the ones it wrote into `root`, unless the repository tracks them. */
async function removeNewLockfiles(root: string, manager: PackageManager): Promise<void> {
  for (const name of LOCKFILES[manager]) {
    const file = join(root, name);

    if (!existsSync(file)) continue;
    const top = repositoryTop(root);

    if (top) {
      const path = relative(top, file).split(sep).join("/");
      const tracked = await runGit(top, ["ls-files", "--error-unmatch", "--", path], { allowFailure: true, readOnly: true });

      if (tracked.code === 0) continue;
    }
    await rm(file, { force: true });
  }
}

/** Detects the package manager from the lockfile when the site model has none. */
export function detectPackageManager(root: string): PackageManager {
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  if (existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock"))) return "bun";
  return "npm";
}

/**
 * Installs the site's dependencies. Throws a plain GalleyError (with the
 * output tail as detail) on failure. `env`: as for runBuild.
 */
export async function installDependencies(
  root: string,
  packageManager: PackageManager | null,
  onLog?: (line: string) => void,
  env?: Record<string, string>,
  options: InstallDependenciesOptions = {}
): Promise<void> {
  const manager = packageManager ?? detectPackageManager(root);
  const noLockfile = options.addLockfile === false && !hasLockfile(root, manager);
  const args = [...INSTALL_ARGS[manager], ...(noLockfile ? NO_LOCKFILE_ARGS[manager] : [])];
  const resolved = resolveCommand(root, [manager, ...args].join(" "), { CI: "1", ...env });
  const lines: string[] = [];
  const result = await runCommand(resolved.file, resolved.args, {
    cwd: root,
    env: resolved.env,
    shell: resolved.shell,
    timeoutMs: INSTALL_TIMEOUT_MS,
    maxStdoutBytes: 0,
    onLine: (raw) => {
      const line = stripAnsi(raw);

      lines.push(line);
      if (lines.length > 1000) lines.splice(0, 500);
      onLog?.(line);
    },
  });

  // Whatever the switch did, a lockfile this install left behind is taken away again (only one that wasn't there before and isn't tracked).
  if (noLockfile) await removeNewLockfiles(root, manager);
  if (result.code === 0 && !result.timedOut) return;
  throw new GalleyError(
    "internal",
    result.timedOut
      ? "Installing the site's dependencies took too long and was stopped. Check your internet connection and try again."
      : "Installing the site's dependencies didn't work. The details below say why; fixing it usually needs a developer.",
    trimOutput(lines) || result.spawnError?.message
  );
}
