/**
 * The one place every line the server writes goes through: notices for the
 * operator, unexpected-error reports, request lines and the install's own
 * events (sign-ins, backups, restores).
 *
 * Every line is scrubbed first (core install/secrets.ts): whatever secret
 * the process knows at that moment — the password and keys from the
 * environment, the setup code, GALLEY_TOKEN, the data folder's stored keys
 * and access key, plugin secrets — and secret-looking address parameters.
 * Written to stderr, a line starts with its time in ISO form; given to a
 * caller's own sink (the command line, a test), it is passed as it is and
 * the sink adds what it needs.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { scrubLine } from "@galley/core/install";

export interface ServerLog {
  /** Something the operator should hear (start-up warnings, a port change). */
  notice(line: string): void;
  /** Unexpected errors, with their stack: for the operator, never for the person in the app. */
  log(line: string): void;
  /** One handled request: method, path without its query, status, milliseconds. Never headers or bodies. */
  request(method: string, path: string, status: number, ms: number): void;
  /** One event worth keeping (a sign-in, a restore). */
  event(line: string): void;
  /** `text` with every secret known now cut out. */
  scrub(text: string): string;
  /** A secret this process learned after start (the setup code it minted). */
  remember(value: string | null | undefined): void;
}

export interface ServerLogOptions {
  notice?: (line: string) => void;
  log?: (line: string) => void;
  /** Values to cut out of every line, read at each line (the environment's, the starting values'). */
  secrets?: () => Iterable<string>;
  /** The data folder: its stored keys and access key are read (when they change) and cut out too. */
  home?: string | null;
  /** Write request lines (hosted mode, unless GALLEY_LOG_REQUESTS=0). */
  requests?: boolean;
}

export function stamped(line: string, now = new Date()): string {
  return `${now.toISOString()} ${line}`;
}

function stderr(line: string): void {
  process.stderr.write(`${stamped(line)}\n`);
}

/** A file's secret values, read again only when the file changed. */
function fileValues(path: string, read: (text: string) => string[]): () => string[] {
  let seen = "";
  let values: string[] = [];

  return () => {
    try {
      const info = statSync(path);
      const stamp = `${info.mtimeMs}:${info.size}`;

      if (stamp !== seen) {
        seen = stamp;
        values = read(readFileSync(path, "utf8"));
      }
    } catch {
      seen = "";
      values = [];
    }
    return values;
  };
}

function jsonStrings(text: string): string[] {
  try {
    const parsed = JSON.parse(text) as unknown;

    return parsed && typeof parsed === "object" ? Object.values(parsed as Record<string, unknown>).filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

export function createServerLog(options: ServerLogOptions = {}): ServerLog {
  const noticeSink = options.notice ?? stderr;
  const logSink = options.log ?? stderr;
  const learned = new Set<string>();
  const stored = options.home
    ? [
        fileValues(join(options.home, "secrets.json"), jsonStrings),
        fileValues(join(options.home, "keys", "site-token"), (text) => [text.trim()]),
        fileValues(join(options.home, "session.key"), (text) => [text.trim()]),
      ]
    : [];

  const known = (): string[] => {
    const out = [...learned];

    for (const read of stored) out.push(...read());
    try {
      for (const value of options.secrets?.() ?? []) if (typeof value === "string") out.push(value);
    } catch {
      // A failing source of secrets never stops a line; the engine's own list still applies.
    }
    return out;
  };
  const scrub = (text: string) => scrubLine(text, known());

  return {
    notice: (line) => noticeSink(scrub(line)),
    log: (line) => logSink(scrub(line)),
    request(method, path, status, ms) {
      if (!options.requests) return;
      logSink(scrub(`${method} ${path.split("?")[0]} ${status} ${Math.round(ms)}ms`));
    },
    event: (line) => logSink(scrub(line)),
    scrub,
    remember(value) {
      if (value) learned.add(value);
    },
  };
}
