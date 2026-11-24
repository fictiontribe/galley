/**
 * Turning a configured command line ("npm run dev", "astro dev --port 4321")
 * into something we can spawn without a shell.
 */
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { GalleyError } from "../errors";
import { IS_WINDOWS } from "./exec";

export interface ParsedCommand {
  /** Leading NAME=value assignments. */
  env: Record<string, string>;
  argv: string[];
}

/**
 * Splits a command line the way a POSIX shell would for the simple cases:
 * whitespace separates words, single quotes are literal, double quotes allow
 * backslash escapes, `NAME=value` prefixes become environment variables.
 * Anything that needs a real shell — pipes, `&&`, redirects, substitutions —
 * is refused with a message rather than half-interpreted.
 */
export function parseCommand(command: string): ParsedCommand {
  const words: string[] = [];
  let current = "";
  let inWord = false;
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i] as string;

    if (quote === "'") {
      if (char === "'") quote = null;
      else current += char;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === "\\" && i + 1 < command.length && /["\\$`]/.test(command[i + 1] as string)) {
        current += command[i + 1];
        i += 1;
      } else if (char === "$" || char === "`") {
        throw shellFeature(command);
      } else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      inWord = true;
      continue;
    }
    if (char === "\\" && i + 1 < command.length) {
      current += command[i + 1];
      inWord = true;
      i += 1;
      continue;
    }
    if (/\s/.test(char)) {
      if (inWord) words.push(current);
      current = "";
      inWord = false;
      continue;
    }
    if (/[|&;<>()$`*?~#]/.test(char) && !(inWord && (char === "~" || char === "#"))) throw shellFeature(command);
    current += char;
    inWord = true;
  }
  if (quote) throw new GalleyError("invalid", "The command has an unclosed quote. Check it in the site settings.", command);
  if (inWord) words.push(current);

  const env: Record<string, string> = {};

  while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] as string)) {
    const assignment = words.shift() as string;
    const eq = assignment.indexOf("=");

    env[assignment.slice(0, eq)] = assignment.slice(eq + 1);
  }
  if (words.length === 0) throw new GalleyError("invalid", "The command is empty. Set one in the site settings.", command);
  return { env, argv: words };
}

function shellFeature(command: string): GalleyError {
  return new GalleyError(
    "invalid",
    "That command uses shell features (like &&, | or $VARIABLES), which can't be run directly. Put it in a package.json script and use that instead, for example “npm run dev”.",
    command
  );
}

/** PATH with the site's own `node_modules/.bin` first, as package scripts see it. */
export function sitePath(root: string, basePath = process.env.PATH ?? process.env.Path ?? ""): string {
  return [join(root, "node_modules", ".bin"), basePath].filter(Boolean).join(delimiter);
}

function isExecutable(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) return false;
    if (!IS_WINDOWS) accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Finds a binary on a PATH string (honouring PATHEXT on Windows). */
export function which(name: string, pathValue: string, cwd: string): string | null {
  if (name.includes("/") || (IS_WINDOWS && name.includes("\\"))) {
    const candidate = isAbsolute(name) ? name : join(cwd, name);

    return isExecutable(candidate) ? candidate : null;
  }
  const extensions = IS_WINDOWS ? ["", ...(process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").toLowerCase().split(";")] : [""];

  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue;
    for (const ext of extensions) {
      const candidate = join(directory, name + ext);

      if (isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Environment variables that tell tools "an AI agent is driving this
 * terminal". Some dev servers change behaviour on seeing them — Astro 7 moves
 * its dev server into the background and exits at once, leaving a process we
 * do not own, and `next dev` (16) writes an AGENTS.md into the site, which then
 * shows as a change. Next reads them through @vercel/detect-agent. The site's own commands are run as an ordinary user would run
 * them, so these are removed (exact names and prefixes, matched
 * case-insensitively, ignoring leading underscores). `CLAUDE_` covers
 * CLAUDE_CODE_*, CLAUDE_AGENT_* and the other session variables (CLAUDE_PID…)
 * a coding agent's terminal carries; no site needs them. Keep this the one list.
 */
export const AGENT_ENV_NAMES = [
  "AI_AGENT",
  "CLAUDECODE",
  "CURSOR_AGENT",
  "CURSOR_TRACE_ID",
  "CURSOR_CLI",
  "CURSOR_EXTENSION_HOST_ROLE",
  "ANTIGRAVITY_AGENT",
  "AUGMENT_AGENT",
  "COPILOT_MODEL",
  "COPILOT_ALLOW_ALL",
  "COPILOT_GITHUB_TOKEN",
  "CODEX_SANDBOX",
  "CODEX_SANDBOX_NETWORK_DISABLED",
  "GEMINI_CLI",
  "OPENCODE",
  "AIDER",
] as const;
export const AGENT_ENV_PREFIXES = ["CLAUDE_", "CURSOR_AGENT_", "CODEX_", "GEMINI_CLI_", "OPENCODE_"] as const;

export function isAgentMarker(name: string): boolean {
  // Leading underscores mark "private" variants (_CLAUDE_CODE_…) of the same thing.
  const upper = name.toUpperCase().replace(/^_+/, "");

  return (AGENT_ENV_NAMES as readonly string[]).includes(upper) || AGENT_ENV_PREFIXES.some((prefix) => upper.startsWith(prefix));
}

/**
 * Environment variables that say "a test runner started this process". They
 * leak into a site's dev server when Galley itself runs under a test (or is
 * launched from one), and Astro, for one, turns its dev page handler off when
 * it sees them — the preview then serves nothing. `TEST` only counts when it
 * is set to "true" or "1", since sites use plain `TEST` for their own ends.
 */
export const TEST_RUNNER_ENV_NAMES = ["VITEST", "JEST_WORKER_ID"] as const;
export const TEST_RUNNER_ENV_PREFIXES = ["VITEST_"] as const;

export function isTestRunnerMarker(name: string, value: string | undefined): boolean {
  const upper = name.toUpperCase();

  if ((TEST_RUNNER_ENV_NAMES as readonly string[]).includes(upper) || TEST_RUNNER_ENV_PREFIXES.some((prefix) => upper.startsWith(prefix))) return true;
  return upper === "TEST" && (value === "true" || value === "1");
}

/** A copy of `env` without the agent markers and test-runner markers above. */
export function withoutAgentMarkers(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};

  for (const [name, value] of Object.entries(env)) if (!isAgentMarker(name) && !isTestRunnerMarker(name, value)) out[name] = value;
  return out;
}

/**
 * Variables of this app's own process that a site's commands must not
 * inherit. A hosted install is started with its first owner's password, setup
 * code, repository access key and provider keys in its environment; the
 * site's dev server, build and install run the site's code (and its
 * dependencies'), which has no business with any of them. Empty — nothing
 * hidden — until a hosted server sets it; locally a developer's shell is
 * passed through as it always was.
 */
let hiddenFromSiteCommands: ReadonlySet<string> = new Set();

export function hideFromSiteCommands(names: readonly string[]): void {
  hiddenFromSiteCommands = new Set(names.map((name) => name.toUpperCase()));
}

/**
 * A memory ceiling for the site's own commands (a hosted install's
 * GALLEY_PREVIEW_MEMORY_MB): `--max-old-space-size` is added to the
 * NODE_OPTIONS they receive — after whatever the operator set — so a runaway
 * build ends itself with an error its log shows, instead of taking the whole
 * server down. Never applied to this process. Null: no ceiling.
 */
let siteCommandMemoryMb: number | null = null;

export function limitSiteCommandMemory(mb: number | null): void {
  siteCommandMemoryMb = mb !== null && Number.isInteger(mb) && mb > 0 ? mb : null;
}

/** A copy of `env` without the names hideFromSiteCommands was given. */
export function withoutHiddenVariables(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (hiddenFromSiteCommands.size === 0) return env;
  const out: NodeJS.ProcessEnv = {};

  for (const [name, value] of Object.entries(env)) if (!hiddenFromSiteCommands.has(name.toUpperCase())) out[name] = value;
  return out;
}

export interface ResolvedCommand {
  file: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  /** Windows .cmd/.bat shims can only be started through cmd.exe. */
  shell: boolean;
}

/**
 * `argv` with `extra` arguments added so they reach the program the command
 * finally runs. `npm run dev` needs a `--` before them (npm would read
 * `--port` as its own option); pnpm, yarn and bun pass arguments after the
 * script name through as they are, and pnpm would hand a literal `--` on to
 * the script, which some CLIs then read as "no more options".
 */
export function withArguments(argv: string[], extra: string[]): string[] {
  if (extra.length === 0) return argv;
  const runner = (argv[0] ?? "").split(/[\\/]/).pop()?.replace(/\.(cmd|exe|bat)$/i, "").toLowerCase() ?? "";

  if (runner === "npm" && !argv.includes("--")) return [...argv, "--", ...extra];
  return [...argv, ...extra];
}

/**
 * Resolves a command for spawning in `root`: the site's `node_modules/.bin`
 * on PATH, colour and browser-opening off, agent markers removed, plus any
 * NAME=value prefixes. `extraArgs` are appended the way `withArguments` does.
 */
export function resolveCommand(root: string, command: string, extraEnv: NodeJS.ProcessEnv = {}, extraArgs: string[] = []): ResolvedCommand {
  const parsed = parseCommand(command);
  const pathValue = sitePath(root);
  const [name, ...args] = withArguments(parsed.argv, extraArgs) as [string, ...string[]];
  const file = which(name, pathValue, root);

  if (!file) {
    throw new GalleyError(
      "unconfigured",
      `“${name}” isn't installed on this computer, so the command “${command}” can't run. Install it, or change the command in the site settings.`,
      `not found on PATH: ${name}`
    );
  }
  // Inherited agent and test-runner markers are dropped; variables the caller
  // or the command line set on purpose are kept.
  const env: NodeJS.ProcessEnv = {
    ...withoutHiddenVariables(withoutAgentMarkers(process.env)),
    ...extraEnv,
    ...parsed.env,
    PATH: pathValue,
    BROWSER: "none",
    FORCE_COLOR: "0",
    NO_COLOR: "1",
  };

  if (IS_WINDOWS) delete env.Path;
  if (siteCommandMemoryMb !== null) env.NODE_OPTIONS = [env.NODE_OPTIONS?.trim(), `--max-old-space-size=${siteCommandMemoryMb}`].filter(Boolean).join(" ");
  const shell = IS_WINDOWS && /\.(cmd|bat)$/i.test(file);

  return { file, args: shell ? args.map(quoteForCmd) : args, env, shell };
}

/** Minimal cmd.exe quoting for the .cmd-shim case — the only time a shell is used. */
function quoteForCmd(arg: string): string {
  return /[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}
