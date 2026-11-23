/**
 * `pnpm --filter @galley/web dev:mock` — answers every /api route from
 * in-memory fixtures so the UI can be built before the real server exists.
 *
 *   GALLEY_MOCK=1             enable (set by the dev:mock script)
 *   GALLEY_MOCK_MODE=hosted   require the sign-in screen (password: proof)
 *   GALLEY_MOCK_LATENCY=ms    add latency to every response (default 120)
 *   GALLEY_MOCK_PUSH=fail     sending to the host always fails ("flaky": only
 *                             the send that publishing does fails; Send now works)
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import type { ApiRouteKey } from "@galley/core/api";
import type { GalleyErrorShape, ServerEvent } from "@galley/core/types";
import { MockBackend, createHandlers, type Handlers, type MockRequest, type RawReply } from "./backend.ts";
import { MockError } from "./site.ts";

const STATUS: Record<GalleyErrorShape["code"], number> = {
  "not-found": 404,
  unauthorized: 401,
  conflict: 409,
  forbidden: 403,
  invalid: 400,
  git: 500,
  preview: 500,
  ai: 502,
  unconfigured: 400,
  busy: 409,
  internal: 500,
};

interface CompiledRoute {
  key: ApiRouteKey;
  method: string;
  pattern: RegExp;
  names: string[];
  literal: number;
}

function compile(keys: ApiRouteKey[]): CompiledRoute[] {
  return keys
    .map((key) => {
      const [method = "GET", path = "/"] = key.split(" ");
      const names: string[] = [];
      const pattern = new RegExp(`^${path.replace(/:([A-Za-z]+)/g, (_, name: string) => (names.push(name), "([^/]+)"))}$`);
      return { key, method, pattern, names, literal: path.split("/").filter((part) => part && !part.startsWith(":")).length };
    })
    .sort((a, b) => a.names.length - b.names.length || b.literal - a.literal);
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolve(undefined);
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

const isRaw = (value: unknown): value is RawReply => typeof value === "object" && value !== null && "kind" in value && ((value as RawReply).kind === "bytes" || (value as RawReply).kind === "sse");

export function galleyMock(): Plugin {
  return {
    name: "galley-mock",
    apply: "serve",
    configureServer(server) {
      const clients = new Set<ServerResponse>();
      const emit = (event: ServerEvent) => {
        const line = `data: ${JSON.stringify(event)}\n\n`;
        for (const client of clients) client.write(line);
      };
      const mode = process.env.GALLEY_MOCK_MODE === "hosted" ? "hosted" : "local";
      const latency = Number(process.env.GALLEY_MOCK_LATENCY ?? 120);
      const backend = new MockBackend({ mode, emit });
      const handlers: Handlers = createHandlers(backend);
      const routes = compile(Object.keys(handlers) as ApiRouteKey[]);
      const heartbeat = setInterval(() => {
        for (const client of clients) client.write(": keep-alive\n\n");
      }, 15_000);
      server.httpServer?.on("close", () => clearInterval(heartbeat));

      server.config.logger.info(`  galley mock: ${routes.length} routes from fixtures (${mode} mode)`);

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (!url.pathname.startsWith("/api/")) return next();
        const method = (req.method ?? "GET").toUpperCase();
        let route: CompiledRoute | undefined;
        let match: RegExpExecArray | null = null;
        for (const candidate of routes) {
          if (candidate.method !== method) continue;
          match = candidate.pattern.exec(url.pathname);
          if (match) {
            route = candidate;
            break;
          }
        }
        if (!route || !match) {
          sendJson(res, 404, { error: { code: "not-found", message: `The mock doesn’t know ${method} ${url.pathname}.`, status: 404 } });
          return;
        }

        const open = route.key === "GET /api/meta" || route.key === "POST /api/auth/login" || route.key === "GET /api/events";
        if (!backend.authenticated && !open) {
          sendJson(res, 401, { error: { code: "unauthorized", message: "Sign in to continue.", status: 401 } });
          return;
        }

        const params: Record<string, string> = {};
        route.names.forEach((name, index) => (params[name] = decodeURIComponent(match?.[index + 1] ?? "")));
        const query: Record<string, string> = {};
        url.searchParams.forEach((value, key) => (query[key] = value));

        try {
          const body = method === "GET" || method === "DELETE" ? undefined : await readBody(req);
          if (route.key !== "GET /api/events" && latency > 0) await new Promise((resolve) => setTimeout(resolve, latency));
          const handler = handlers[route.key] as (request: MockRequest<ApiRouteKey>) => unknown;
          const result = await handler({ params, query, body, search: url.searchParams } as unknown as MockRequest<ApiRouteKey>);
          if (isRaw(result)) {
            if (result.kind === "sse") {
              res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" });
              res.write(`data: ${JSON.stringify({ type: "hello", version: "mock" } satisfies ServerEvent)}\n\n`);
              clients.add(res);
              req.on("close", () => clients.delete(res));
              return;
            }
            res.writeHead(200, { "content-type": result.type, "cache-control": "no-store" });
            res.end(result.body);
            return;
          }
          sendJson(res, 200, result);
        } catch (error) {
          if (error instanceof MockError) {
            const status = STATUS[error.code];
            sendJson(res, status, { error: { code: error.code, message: error.message, detail: error.detail, status } });
            return;
          }
          server.config.logger.error(`galley mock: ${route.key} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
          sendJson(res, 500, { error: { code: "internal", message: "The mock server ran into a problem.", detail: error instanceof Error ? error.message : String(error), status: 500 } });
        }
      });
    },
  };
}
