/**
 * A thin wrapper over the `git` binary.
 *
 * Every call: an argument array (never a shell string), `core.quotepath=off`
 * so unusual filenames come back as their bytes, literal pathspecs so a file
 * called `*.md` or `:x` means that file, no prompts (GIT_TERMINAL_PROMPT=0 and
 * no controlling terminal — see exec.ts), no pager, no editor, the C locale so
 * messages can be classified, and a timeout.
 */
import { GalleyError } from "../errors";
import { runCommand, type RunResult } from "./exec";

export const GIT_TIMEOUT_MS = 30_000;
export const GIT_NETWORK_TIMEOUT_MS = 120_000;

export interface GitRunOptions {
  timeoutMs?: number;
  input?: string | Uint8Array;
  env?: Record<string, string>;
  /** Extra `-c key=value` settings for this call only. */
  config?: string[];
  /** Return the result instead of throwing when git exits non-zero. */
  allowFailure?: boolean;
  /**
   * Read-only call: sets GIT_OPTIONAL_LOCKS=0 so `status` does not rewrite the
   * index (which would wake the watcher and race with the user's own git).
   */
  readOnly?: boolean;
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
}

export interface GitResult {
  code: number;
  stdout: Buffer;
  /** stdout decoded as UTF-8. */
  text: string;
  stderr: string;
  timedOut: boolean;
}

export interface RepoInfo {
  /** Absolute path of the repository's top level. */
  topLevel: string;
  /** The site root's position inside the repo, "" or "apps/site/" (POSIX, trailing slash). */
  prefix: string;
  /** Absolute path of the git directory. */
  gitDir: string;
}

export interface Git {
  readonly root: string;
  /** Run `git <args>` in the root. Throws GitCommandError on failure unless allowFailure. */
  run(args: string[], options?: GitRunOptions): Promise<GitResult>;
  isRepository(): Promise<boolean>;
  /** null when the root is not inside a work tree. */
  info(): Promise<RepoInfo | null>;
  /** Checked-out branch name; null when HEAD is detached or the root is not a repo. */
  currentBranch(): Promise<string | null>;
  /** Full hash of HEAD; null in a repo with no commits yet. */
  head(): Promise<string | null>;
  remotes(): Promise<string[]>;
  remoteUrl(remote: string): Promise<string | null>;
}

/** A git command that failed. `message` is plain; `detail` has git's own words. */
export class GitCommandError extends GalleyError {
  readonly exitCode: number;
  readonly stderr: string;
  readonly timedOut: boolean;

  constructor(message: string, result: Pick<GitResult, "code" | "stderr" | "timedOut">, args: string[]) {
    super("git", message, `git ${args.join(" ")} → exit ${result.code}${result.timedOut ? " (timed out)" : ""}\n${result.stderr.trim()}`);
    this.name = "GitCommandError";
    this.exitCode = result.code;
    this.stderr = result.stderr;
    this.timedOut = result.timedOut;
  }
}

const BASE_CONFIG = [
  "core.quotepath=off",
  "color.ui=never",
  // A repository's own config could name an fsmonitor program that git would
  // execute on every status. Opening a folder must not run its code.
  "core.fsmonitor=false",
  "advice.detachedHead=false",
  "protocol.ext.allow=never",
];

export function gitEnv(extra?: Record<string, string>, readOnly = false): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_LITERAL_PATHSPECS: "1",
    GIT_PAGER: "cat",
    PAGER: "cat",
    GIT_EDITOR: ":",
    GIT_MERGE_AUTOEDIT: "no",
    LC_ALL: "C",
    LANG: "C",
    ...(readOnly ? { GIT_OPTIONAL_LOCKS: "0" } : {}),
    ...extra,
  };
}

function plainFailure(result: RunResult, args: string[]): string {
  const stderr = result.stderr;

  if (result.timedOut) return "Version history took too long to respond, so the action was stopped. Try again.";
  if (/dubious ownership/i.test(stderr)) {
    return "This folder belongs to a different user on this computer, so its version history can't be used safely.";
  }
  if (/index\.lock/.test(stderr)) {
    return "Another program is using this site's version history right now. Wait a moment and try again.";
  }
  return `The site's version history couldn't do that (${args[0] ?? "git"}). The technical details say why.`;
}

export async function runGit(cwd: string, args: string[], options: GitRunOptions = {}): Promise<GitResult> {
  const fullArgs = [...[...BASE_CONFIG, ...(options.config ?? [])].flatMap((c) => ["-c", c]), ...args];
  const result = await runCommand("git", fullArgs, {
    cwd,
    env: gitEnv(options.env, options.readOnly),
    timeoutMs: options.timeoutMs ?? GIT_TIMEOUT_MS,
    input: options.input,
    onLine: options.onLine,
  });

  if (result.spawnError) {
    if (result.spawnError.code === "ENOENT") {
      throw new GalleyError(
        "unconfigured",
        "Git isn't installed on this computer. Install it from git-scm.com, then try again.",
        result.spawnError.message
      );
    }
    throw new GalleyError("git", "Version history couldn't be started.", result.spawnError.message);
  }
  const out: GitResult = {
    code: result.code,
    stdout: result.stdout,
    text: result.stdout.toString("utf8"),
    stderr: result.stderr,
    timedOut: result.timedOut,
  };

  if (out.code !== 0 && !options.allowFailure) throw new GitCommandError(plainFailure(result, args), out, args);
  return out;
}

/** Splits NUL-terminated output, dropping the trailing empty record. */
export function splitNul(text: string): string[] {
  const parts = text.split("\0");

  if (parts[parts.length - 1] === "") parts.pop();
  return parts;
}

export function git(root: string): Git {
  let cachedInfo: RepoInfo | null | undefined;

  const run = (args: string[], options?: GitRunOptions) => runGit(root, args, options);

  return {
    root,
    run,
    async isRepository() {
      return (await this.info()) !== null;
    },
    async info() {
      // Cached once positive: a work tree does not stop being one under us in
      // a way we could recover from anyway. Negative answers are re-checked so
      // a `git init` in a terminal is noticed.
      if (cachedInfo) return cachedInfo;
      const result = await run(
        ["rev-parse", "--is-inside-work-tree", "--show-toplevel", "--show-prefix", "--absolute-git-dir"],
        { allowFailure: true, readOnly: true }
      );

      if (result.code !== 0) return null;
      const [inside, topLevel, prefix, gitDir] = result.text.split("\n");

      if (inside?.trim() !== "true" || !topLevel || !gitDir) return null;
      cachedInfo = { topLevel: topLevel.trim(), prefix: (prefix ?? "").trim(), gitDir: gitDir.trim() };
      return cachedInfo;
    },
    async currentBranch() {
      const result = await run(["symbolic-ref", "-q", "--short", "HEAD"], { allowFailure: true, readOnly: true });

      return result.code === 0 ? result.text.trim() || null : null;
    },
    async head() {
      const result = await run(["rev-parse", "-q", "--verify", "HEAD^{commit}"], {
        allowFailure: true,
        readOnly: true,
      });

      return result.code === 0 ? result.text.trim() || null : null;
    },
    async remotes() {
      const result = await run(["remote"], { allowFailure: true, readOnly: true });

      return result.code === 0 ? result.text.split("\n").map((r) => r.trim()).filter(Boolean) : [];
    },
    async remoteUrl(remote: string) {
      const result = await run(["remote", "get-url", "--", remote], { allowFailure: true, readOnly: true });

      return result.code === 0 ? result.text.trim() || null : null;
    },
  };
}
