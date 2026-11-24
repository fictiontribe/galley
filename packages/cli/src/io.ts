/**
 * What a command touches outside itself, so tests can run commands without
 * a terminal, a browser or a real engine.
 */
import { spawn } from "node:child_process";
import type { Writable } from "node:stream";
import { openSingleSite, startServer } from "@galley/server";
import { terminalPrompter, type Prompter } from "./prompt";

export interface Io {
  out(line?: string): void;
  err(line?: string): void;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Starts the server (the real one unless a test swaps it). */
  startServer: typeof startServer;
  /** Opens a URL in the default browser. Resolves false when that wasn't possible. */
  openBrowser(url: string): Promise<boolean>;
  /** Resolves when the user asks the running server to stop (Ctrl+C, SIGTERM). */
  waitForStop(): Promise<void>;
  /** Starts watching for the parent process to go away (standard input closing). */
  watchParent(): ParentWatch;
  /** `mcp`: opens one site with the real engine unless a test swaps it. */
  openSite?: typeof openSingleSite;
  /** `mcp`: the protocol streams. Default: this process's stdin and stdout. */
  stdio?: { stdin?: NodeJS.ReadableStream; stdout?: Writable };
  /** `mcp config`: how this CLI was started (command + script). Default: this process's. */
  launcher?: { command: string; args: string[] };
  /** Asks for a secret on the terminal without showing what is typed. Null when there is no terminal to ask on. */
  askSecret?(prompt: string): Promise<string | null>;
  /** `new`: asks questions. Present only when a person can answer (both ends are a terminal). */
  ask?: Prompter;
  /** A line that replaces itself (progress), shown only on a terminal; null clears it. */
  status?(line: string | null): void;
  /** The Node version to check starters against. Default: this process's. */
  nodeVersion?: string;
  /** The platform for setup advice. Default: this process's. */
  platform?: NodeJS.Platform;
  /**
   * Ends the process with `code` once everything written so far has reached
   * standard output and error. `serve` calls it after a clean stop. Absent in
   * tests, which run commands inside their own process.
   */
  exit?(code: number): Promise<void>;
}

export interface ParentWatch {
  /** Resolves once the parent has gone. */
  gone: Promise<void>;
  /** Stop watching, so standard input no longer keeps the process alive. */
  stop(): void;
}

/** How long a server whose parent died gets to close cleanly before it exits anyway. */
export const ORPHAN_EXIT_MS = 8000;

/**
 * The desktop shell holds the write end of this process's standard input and
 * never writes to it. When the shell exits — normally, by crashing, or by
 * `kill -9` — the operating system closes that end and stdin reaches EOF.
 * That is the one signal that survives a parent which had no chance to clean
 * up, so it is how a server started by the shell notices it is on its own.
 */
export function watchStdin(stdin: NodeJS.ReadableStream & { destroy?: () => void } = process.stdin): ParentWatch {
  let done = false;
  let resolveGone!: () => void;
  const gone = new Promise<void>((resolve) => {
    resolveGone = resolve;
  });
  const onGone = () => {
    if (done) return;
    done = true;
    cleanup();
    resolveGone();
  };
  // Nothing is ever written; drain whatever arrives so the stream keeps flowing to its end.
  const onData = () => {};
  const cleanup = () => {
    stdin.off("data", onData);
    stdin.off("end", onGone);
    stdin.off("close", onGone);
    stdin.off("error", onGone);
  };

  stdin.on("data", onData);
  stdin.once("end", onGone);
  stdin.once("close", onGone);
  stdin.once("error", onGone);
  stdin.resume();
  return {
    gone,
    stop() {
      if (done) return;
      done = true;
      cleanup();
      stdin.pause();
      stdin.destroy?.();
    },
  };
}

export function openInBrowser(url: string): Promise<boolean> {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", '""', url.replace(/&/g, "^&")]]
        : ["xdg-open", [url]];

  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { stdio: "ignore", detached: true, windowsHide: true });

      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

function waitForSignal(): Promise<void> {
  return new Promise((resolve) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      // A second signal while shutting down (Ctrl+C again, or a second stop from the container) means "now".
      process.once("SIGINT", () => process.exit(130));
      process.once("SIGTERM", () => process.exit(143));
      resolve();
    };

    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}

/** Reads one line from the terminal with nothing echoed. Ctrl+C gives up (null). */
export function askSecretOnTerminal(prompt: string, stdin: NodeJS.ReadStream = process.stdin, stderr: NodeJS.WriteStream = process.stderr): Promise<string | null> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    let typed = "";
    const finish = (value: string | null) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stderr.write("\n");
      resolve(value);
    };
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\r" || char === "\n") return finish(typed);
        if (char === "\u0003" || char === "\u0004") return finish(null);
        if (char === "\u007f" || char === "\b") typed = [...typed].slice(0, -1).join("");
        else if (char >= " ") typed += char;
      }
    };

    stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

/**
 * Output whose reader went away (`galley starters | head`) is not an error:
 * the command has said all anyone will read. Node reports a closed pipe as
 * an EPIPE "error" event on the stream, which crashes the process when no
 * one listens, so every command's stdout and stderr get this listener: on
 * EPIPE, exit quietly with status 0; anything else is still a real error.
 */
export function tolerateClosedPipe(stream: NodeJS.EventEmitter, exit: (code: number) => void = (code) => process.exit(code)): void {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE" || error.code === "ERR_STREAM_DESTROYED") return exit(0);
    throw error;
  });
}

/** True when a person is at the keyboard: both ends are a terminal and this isn't CI. */
export function isInteractive(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY) && !env.CI;
}

/** Resolves once everything written to `stream` so far has been handed to the system (pipes are asynchronous on macOS). */
function drained(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolve) => {
    if (stream.destroyed || !stream.writable) return resolve();
    try {
      stream.write("", () => resolve());
    } catch {
      resolve();
    }
  });
}

/** Flushes standard output and error, then ends the process with `code`. */
export async function flushAndExit(code: number): Promise<void> {
  await Promise.all([drained(process.stdout), drained(process.stderr)]);
  process.exit(code);
}

export function processIo(): Io {
  const terminal = Boolean(process.stdout.isTTY);

  return {
    out: (line = "") => process.stdout.write(`${line}\n`),
    err: (line = "") => process.stderr.write(`${line}\n`),
    cwd: process.cwd(),
    env: process.env,
    startServer,
    openSite: openSingleSite,
    openBrowser: openInBrowser,
    waitForStop: waitForSignal,
    exit: flushAndExit,
    askSecret: (prompt) => askSecretOnTerminal(prompt),
    ...(isInteractive() ? { ask: terminalPrompter() } : {}),
    ...(terminal ? { status: (line: string | null) => process.stdout.write(line === null ? "\r\u001b[2K" : `\r\u001b[2K${line}`) } : {}),
    watchParent() {
      const watch = watchStdin();

      // With the parent gone nobody is left to escalate, so a close that hangs must not leave this process behind.
      void watch.gone.then(() => setTimeout(() => process.exit(1), ORPHAN_EXIT_MS).unref());
      return watch;
    },
  };
}
