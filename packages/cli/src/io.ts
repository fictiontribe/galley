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
  /** `new`: asks questions. Present only when a person can answer (both ends are a terminal). */
  ask?: Prompter;
  /** A line that replaces itself (progress), shown only on a terminal; null clears it. */
  status?(line: string | null): void;
  /** The Node version to check starters against. Default: this process's. */
  nodeVersion?: string;
  /** The platform for setup advice. Default: this process's. */
  platform?: NodeJS.Platform;
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
      // A second Ctrl+C while shutting down means "now".
      process.once("SIGINT", () => process.exit(130));
      resolve();
    };

    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}

/** True when a person is at the keyboard: both ends are a terminal and this isn't CI. */
export function isInteractive(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY) && !env.CI;
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
