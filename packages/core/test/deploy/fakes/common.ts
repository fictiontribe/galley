/**
 * A tiny HTTP server for fake hosts: buffered bodies, JSON helpers, a request
 * log. The fakes implement each host's documented protocol strictly enough
 * that a wrong step — a missing manifest, a hash that doesn't match the
 * bytes, the account key where the upload key belongs — fails the way the
 * real host would.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeRequest {
  method: string;
  url: URL;
  headers: IncomingMessage["headers"];
  body: Buffer;
  /** The Authorization bearer value, or null. */
  bearer: string | null;
  json<T = any>(): T;
  form(): Promise<FormData>;
}

export interface FakeReply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface LoggedRequest {
  method: string;
  path: string;
  status: number;
  /** Whether an Authorization header was sent (never its value). */
  auth: "account" | "upload" | "none" | "other";
}

export interface FakeServer {
  url: string;
  port: number;
  log: LoggedRequest[];
  close(): Promise<void>;
}

export async function startFake(
  handle: (request: FakeRequest) => FakeReply | Promise<FakeReply>,
  classify: (bearer: string | null) => LoggedRequest["auth"],
  port = 0
): Promise<FakeServer> {
  const log: LoggedRequest[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", async () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url ?? "/", "http://fake.local");
      const auth = req.headers.authorization ?? "";
      const bearer = /^Bearer (.+)$/i.exec(auth)?.[1] ?? null;
      const request: FakeRequest = {
        method: req.method ?? "GET",
        url,
        headers: req.headers,
        body,
        bearer,
        json: () => JSON.parse(body.toString("utf8") || "null"),
        form: () => new Request("http://fake.local", { method: "POST", headers: { "content-type": String(req.headers["content-type"] ?? "") }, body }).formData(),
      };
      let reply: FakeReply;

      try {
        reply = await handle(request);
      } catch (error) {
        reply = { status: 500, body: { error: String(error) } };
      }
      log.push({ method: request.method, path: url.pathname, status: reply.status, auth: classify(bearer) });
      res.writeHead(reply.status, { "content-type": "application/json", ...reply.headers });
      res.end(reply.body === undefined ? "" : JSON.stringify(reply.body));
    });
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const actual = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${actual}`,
    port: actual,
    log,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
