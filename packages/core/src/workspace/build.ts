/**
 * Running the site's build and installing its dependencies.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { GalleyError } from "../errors";
import type { BuildResult, PackageManager } from "../types";
import { resolveCommand } from "./command";
import { runCommand, tailLines } from "./exec";
import { stripAnsi } from "./exec";

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
  env?: Record<string, string>
): Promise<void> {
  const manager = packageManager ?? detectPackageManager(root);
  const resolved = resolveCommand(root, [manager, ...INSTALL_ARGS[manager]].join(" "), { CI: "1", ...env });
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

  if (result.code === 0 && !result.timedOut) return;
  throw new GalleyError(
    "internal",
    result.timedOut
      ? "Installing the site's dependencies took too long and was stopped. Check your internet connection and try again."
      : "Installing the site's dependencies didn't work. The details below say why; fixing it usually needs a developer.",
    trimOutput(lines) || result.spawnError?.message
  );
}
