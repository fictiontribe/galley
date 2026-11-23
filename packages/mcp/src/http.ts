/**
 * Streamable HTTP, session by session. Each MCP session gets its own server
 * object and transport (the SDK's web-standard transport, which takes a
 * Request and returns a Response — so it mounts in any fetch-style router).
 *
 * Authentication and the Host/Origin checks belong to whoever mounts this
 * (the HTTP server applies its own guards first); this module handles what
 * the protocol itself requires: a new session only on `initialize`, 400 for a
 * request that names no session, 404 for one that names an unknown or ended
 * session, the protocol-version header (checked by the SDK), DELETE to end a
 * session, and an idle timeout so abandoned sessions don't pile up.
 */
import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

export interface McpHttpOptions {
  /** A fresh, unconnected server for a new session. */
  createServer(): McpServer | Promise<McpServer>;
  /** Sessions idle longer than this are closed. Default 30 minutes. */
  idleMs?: number;
  /** At most this many open sessions; the longest-idle one is closed to make room. Default 64. */
  maxSessions?: number;
  /** Request bodies above this are refused. Default 40 MB (base64 media uploads). */
  maxBodyBytes?: number;
  log?(line: string): void;
}

export interface McpHttpHandler {
  handle(request: Request): Promise<Response>;
  /** End every session. */
  close(): Promise<void>;
  readonly sessions: number;
}

interface Session {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
  lastUsed: number;
}

export const SESSION_HEADER = "mcp-session-id";

/** A JSON-RPC error with no id, which is what the spec allows on transport-level refusals. */
export function jsonRpcError(status: number, message: string, code = -32000, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function createMcpHttpHandler(options: McpHttpOptions): McpHttpHandler {
  const sessions = new Map<string, Session>();
  const idleMs = options.idleMs ?? 30 * 60_000;
  const maxSessions = options.maxSessions ?? 64;
  const maxBodyBytes = options.maxBodyBytes ?? 40 * 1024 * 1024;
  const log = options.log ?? ((line: string) => process.stderr.write(`[mcp] ${line}\n`));
  let closed = false;

  async function end(id: string): Promise<void> {
    const session = sessions.get(id);

    if (!session) return;
    sessions.delete(id);
    await session.server.close().catch(() => undefined);
  }

  function sweep(now = Date.now()): void {
    for (const [id, session] of sessions) if (now - session.lastUsed > idleMs) void end(id);
  }

  const timer = setInterval(() => sweep(), Math.min(idleMs, 60_000));

  timer.unref?.();

  async function start(request: Request, body: unknown): Promise<Response> {
    sweep();
    if (sessions.size >= maxSessions) {
      const oldest = [...sessions.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];

      if (oldest) await end(oldest[0]);
    }
    const server = await options.createServer();
    let session: Session | null = null;
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      // One JSON answer per request: simpler through proxies, and nothing here streams progress.
      enableJsonResponse: true,
      maxRequestBodySize: maxBodyBytes,
      onsessioninitialized: (id) => {
        session = { transport, server, lastUsed: Date.now() };
        sessions.set(id, session);
      },
      onsessionclosed: (id) => void end(id),
    });

    transport.onerror = (error) => log(`session error: ${error.message}`);
    await server.connect(transport);
    const response = await transport.handleRequest(request, { parsedBody: body });

    // An initialize the transport refused leaves no session behind.
    if (!session) await server.close().catch(() => undefined);
    return response;
  }

  return {
    get sessions() {
      return sessions.size;
    },

    async handle(request) {
      if (closed) return jsonRpcError(503, "The server is shutting down.");
      const method = request.method.toUpperCase();
      const id = request.headers.get(SESSION_HEADER);

      if (method !== "POST" && method !== "GET" && method !== "DELETE") {
        return jsonRpcError(405, "Use POST, GET or DELETE on this address.", -32000, { allow: "GET, POST, DELETE" });
      }
      if (method === "POST" && !id) {
        const length = Number(request.headers.get("content-length") ?? "0");

        if (length > maxBodyBytes) return jsonRpcError(413, "That request is too large.");
        let body: unknown;

        try {
          body = await request.json();
        } catch {
          return jsonRpcError(400, "Parse error: the body isn't valid JSON.", -32700);
        }
        if (!isInitializeRequest(body)) return jsonRpcError(400, "Bad request: no session. Start one with an initialize request first.");
        return start(request, body);
      }
      if (!id) return jsonRpcError(400, "Bad request: this needs the Mcp-Session-Id header from initialize.");
      const session = sessions.get(id);

      if (!session) return jsonRpcError(404, "Session not found. It may have ended; start a new one with initialize.", -32001);
      session.lastUsed = Date.now();
      return session.transport.handleRequest(request);
    },

    async close() {
      closed = true;
      clearInterval(timer);
      await Promise.all([...sessions.keys()].map((id) => end(id)));
    },
  };
}
