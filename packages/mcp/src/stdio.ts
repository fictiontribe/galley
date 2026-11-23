/**
 * Serving one McpServer over the process's standard streams.
 *
 * On stdio, standard output belongs to the protocol: a single stray line
 * (a dependency's console.log, a warning) corrupts the session. So before the
 * transport starts, every other way of writing to stdout — console.* and
 * process.stdout.write itself — is pointed at stderr, and the transport alone
 * keeps a handle on the real stream.
 */
import { Writable } from "node:stream";
import { format } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface StdioSession {
  /** Resolves when the client has gone (stdin ended or closed) or close() was called. */
  closed: Promise<void>;
  close(): Promise<void>;
}

/**
 * Redirects console.* and process.stdout.write to stderr, and returns a
 * stream that still writes to the real stdout — for the transport only.
 */
export function reserveStdout(): Writable {
  const stdout = process.stdout;
  const write = stdout.write.bind(stdout) as (chunk: string | Uint8Array, callback?: (error?: Error | null) => void) => boolean;
  const toStderr = (...args: unknown[]) => {
    process.stderr.write(`${format(...args)}\n`);
  };

  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;
  console.warn = toStderr;
  console.dir = toStderr;
  console.table = toStderr;
  (stdout as { write: unknown }).write = (chunk: unknown, ...rest: unknown[]) => (process.stderr.write as (...args: unknown[]) => boolean)(chunk, ...rest);
  return new Writable({
    write(chunk: Uint8Array, _encoding, callback) {
      if (write(chunk)) callback();
      else stdout.once("drain", () => callback());
    },
  });
}

export async function serveStdio(server: McpServer, streams: { stdin?: NodeJS.ReadableStream; stdout?: Writable } = {}): Promise<StdioSession> {
  const stdin = streams.stdin ?? process.stdin;
  const stdout = streams.stdout ?? reserveStdout();
  const transport = new StdioServerTransport(stdin as never, stdout);
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => (resolveClosed = resolve));
  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    if (closing) return closing;
    // Assigned before server.close() runs: closing the server closes the
    // transport, whose onclose lands back here and must find this promise.
    let finish!: () => void;

    closing = new Promise<void>((resolve) => (finish = resolve));
    stdin.off("end", close);
    stdin.off("close", close);
    void server
      .close()
      .catch(() => undefined)
      .then(() => {
        resolveClosed();
        finish();
      });
    return closing;
  };

  // The client ends a stdio session by closing our stdin; the transport itself doesn't watch for that.
  stdin.once("end", close);
  stdin.once("close", close);
  transport.onclose = () => void close();
  await server.connect(transport);
  return { closed, close };
}
