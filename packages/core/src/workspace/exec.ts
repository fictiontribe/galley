/**
 * Process runner shared by git, build and install.
 *
 * Always an argument array, never a shell string. On POSIX every child gets
 * its own session (`detached: true` → setsid), which does two jobs: a timeout
 * can kill the whole process group (credential helpers, ssh, npm's script
 * shell), and the child has no controlling terminal, so nothing it spawns —
 * ssh asking for a passphrase, a host-key confirmation — can block on a
 * prompt the user will never see.
 */
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

export const IS_WINDOWS = process.platform === "win32";

export interface RunOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Kill the process (group) after this long. */
  timeoutMs: number;
  input?: string | Uint8Array;
  /** Stop collecting stdout beyond this many bytes (the process keeps running). */
  maxStdoutBytes?: number;
  /** Called for every complete stderr/stdout line, for progress parsing. */
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
  /** Windows .cmd shims only (see command.ts); never a user-supplied string. */
  shell?: boolean;
}

export interface RunResult {
  /** Exit code; -1 when killed by a signal or never started. */
  code: number;
  stdout: Buffer;
  stderr: string;
  timedOut: boolean;
  /** Set when the binary could not be started at all (ENOENT, EACCES…). */
  spawnError?: NodeJS.ErrnoException;
}

/** Kill a child and everything it spawned. Safe to call on an exited child. */
export function killTree(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
  const pid = child.pid;

  if (pid === undefined) return;
  if (IS_WINDOWS) {
    // taskkill /T walks the tree; there are no process groups to signal.
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });

    killer.on("error", () => child.kill());
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Already gone.
    }
  }
}

export function spawnOptions(cwd: string, env: NodeJS.ProcessEnv | undefined, shell = false): SpawnOptions {
  return {
    cwd,
    env: env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: !IS_WINDOWS,
    windowsHide: true,
    shell,
  };
}

export function runCommand(command: string, args: string[], options: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const max = options.maxStdoutBytes ?? 256 * 1024 * 1024;
    const lineBuffers = { stdout: "", stderr: "" };

    let child: ChildProcess;

    try {
      child = spawn(command, args, spawnOptions(options.cwd, options.env, options.shell));
    } catch (error) {
      resolve({
        code: -1,
        stdout: Buffer.alloc(0),
        stderr: "",
        timedOut: false,
        spawnError: error as NodeJS.ErrnoException,
      });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child, "SIGTERM");
      // A process that ignores SIGTERM still has to go.
      setTimeout(() => killTree(child, "SIGKILL"), 2000).unref();
    }, options.timeoutMs);

    const feedLines = (stream: "stdout" | "stderr", text: string) => {
      if (!options.onLine) return;
      const combined = lineBuffers[stream] + text;
      // Progress output rewrites one line with \r, so treat it as a break too.
      const parts = combined.split(/\r\n|\r|\n/);

      lineBuffers[stream] = parts.pop() ?? "";
      for (const part of parts) if (part) options.onLine(part, stream);
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdoutBytes < max) {
        stdoutChunks.push(chunk);
        stdoutBytes += chunk.length;
      }
      if (options.onLine) feedLines("stdout", chunk.toString("utf8"));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");

      // stderr is for messages; keep the tail so a chatty tool cannot exhaust memory.
      stderr = (stderr + text).slice(-64 * 1024);
      feedLines("stderr", text);
    });

    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const stream of ["stdout", "stderr"] as const) {
        if (lineBuffers[stream] && options.onLine) options.onLine(lineBuffers[stream], stream);
      }
      resolve(result);
    };

    child.on("error", (error: NodeJS.ErrnoException) => {
      finish({ code: -1, stdout: Buffer.alloc(0), stderr, timedOut, spawnError: error });
    });
    child.on("close", (code) => {
      finish({ code: code ?? -1, stdout: Buffer.concat(stdoutChunks), stderr, timedOut });
    });

    child.stdin?.on("error", () => {
      // The child may exit before reading its input; that is reported by its exit code.
    });
    if (options.input !== undefined) child.stdin?.end(options.input);
    else child.stdin?.end();
  });
}

/** Last `count` non-empty lines of some output. */
export function tailLines(text: string, count: number): string {
  const lines = text.split(/\r\n|\r|\n/).filter((line) => line.trim() !== "");

  return lines.slice(-count).join("\n");
}

/** Remove ANSI colour/cursor sequences tools print even when asked not to. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g, "");
}
