/**
 * The mock server without HTTP: one call per request, answered from the
 * handler table, with a log of every request it saw. The dev server
 * (plugin.ts) puts it behind Vite; tests call it from a stubbed `fetch`.
 */
import type { ApiRouteKey } from "@galley/core/api";
import type { GalleyErrorShape, ServerEvent } from "@galley/core/types";
import type { InstallFixed } from "@galley/core/install/types";
import { MockBackend, createHandlers, type Handlers, type MockRequest, type RawReply } from "./backend.ts";
import { MockInstall, SETUP_OPEN_ROUTES, withInstall, type MockSetupStep } from "./install.ts";
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

export interface MockServerOptions {
  mode: "local" | "hosted";
  /** Hosted only: the first-run state to start in (default "done"). */
  setup?: MockSetupStep;
  fixed?: InstallFixed[];
  /** ms added to every answer but the event stream. */
  latency?: number;
  /** ms between a job's steps. */
  stepMs?: number;
  /** Hosted only: allow connecting a folder on the server's disk, as a server started for a trial does. */
  allowLocalRepositories?: boolean;
  /** Hosted only: the editor's own address (see MockInstallOptions). */
  address?: string;
}

/** One request as it arrived. */
export interface MockLogEntry {
  method: string;
  path: string;
  search: string;
  route: ApiRouteKey | null;
  status: number;
  /** The Authorization header, when one was sent. */
  authorization: string | null;
  contentType: string | null;
  /** The JSON body as parsed, or the size of a raw one. */
  body: unknown;
}

export interface MockAnswer {
  status: number;
  headers: Record<string, string>;
  /** JSON text, raw bytes, or nothing; `sse` means the caller keeps the response open as an event stream. */
  body: string | Buffer | null;
  sse?: boolean;
}

export interface MockServer {
  backend: MockBackend;
  install: MockInstall | null;
  log: MockLogEntry[];
  handle(request: { method: string; url: string; headers: Record<string, string | undefined>; body?: Buffer }): Promise<MockAnswer>;
  /** Server events, as the event stream sends them. */
  onEvent(listener: (event: ServerEvent) => void): () => void;
}

const isRaw = (value: unknown): value is RawReply => typeof value === "object" && value !== null && "kind" in value && ((value as RawReply).kind === "bytes" || (value as RawReply).kind === "sse");

function json(status: number, body: unknown): MockAnswer {
  return { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, body: JSON.stringify(body) };
}

export function createMockServer(options: MockServerOptions): MockServer {
  const listeners = new Set<(event: ServerEvent) => void>();
  const backend = new MockBackend({ mode: options.mode, emit: (event) => listeners.forEach((listener) => listener(event)) });
  const install = options.mode === "hosted" ? new MockInstall(backend, { setup: options.setup ?? "done", fixed: options.fixed, stepMs: options.stepMs, allowLocalRepositories: options.allowLocalRepositories, address: options.address }) : null;
  const local = createHandlers(backend);
  const handlers: Handlers = install ? withInstall(backend, local, install) : local;
  const routes = compile(Object.keys(handlers) as ApiRouteKey[]);
  const open = new Set<ApiRouteKey>(["GET /api/meta", "POST /api/auth/login", "GET /api/events", ...(install ? SETUP_OPEN_ROUTES : [])]);
  const latency = options.latency ?? 0;
  const log: MockLogEntry[] = [];

  async function answer(method: string, url: URL, headers: Record<string, string | undefined>, raw: Buffer | undefined, entry: MockLogEntry): Promise<MockAnswer> {
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
    if (!route || !match) return json(404, { error: { code: "not-found", message: `The mock doesn’t know ${method} ${url.pathname}.`, status: 404 } });
    entry.route = route.key;
    if (!backend.authenticated && !open.has(route.key)) return json(401, { error: { code: "unauthorized", message: "Sign in to continue.", status: 401 } });

    const params: Record<string, string> = {};
    route.names.forEach((name, index) => (params[name] = decodeURIComponent(match?.[index + 1] ?? "")));
    const query: Record<string, string> = {};
    url.searchParams.forEach((value, key) => (query[key] = value));
    try {
      // A backup upload is raw bytes; every other body is JSON, as the app sends it.
      const bytes = (headers["content-type"] ?? "").includes("application/octet-stream");
      // A DELETE's body is read too: removing the hosted editor carries its `{ confirm: true }` there.
      const text = raw && raw.length > 0 && method !== "GET" && !bytes ? raw.toString("utf8") : "";
      const body = text ? (JSON.parse(text) as unknown) : undefined;
      entry.body = bytes ? { bytes: raw?.length ?? 0 } : body;
      if (route.key !== "GET /api/events" && latency > 0) await new Promise((resolve) => setTimeout(resolve, latency));
      const handler = handlers[route.key] as (request: MockRequest<ApiRouteKey>) => unknown;
      // `headers` and `raw` ride along for the install routes (setup code, backup uploads); see install.ts.
      const result = await handler({ params, query, body, search: url.searchParams, headers, raw: bytes ? raw : undefined } as unknown as MockRequest<ApiRouteKey>);
      if (isRaw(result)) {
        if (result.kind === "sse") return { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" }, body: null, sse: true };
        return { status: 200, headers: { "content-type": result.type, "cache-control": "no-store" }, body: result.body };
      }
      return json(200, result);
    } catch (error) {
      if (error instanceof MockError) {
        const status = STATUS[error.code];
        return json(status, { error: { code: error.code, message: error.message, detail: error.detail, status } });
      }
      return json(500, { error: { code: "internal", message: "The mock server ran into a problem.", detail: error instanceof Error ? error.message : String(error), status: 500 } });
    }
  }

  return {
    backend,
    install,
    log,
    async handle({ method, url, headers, body }) {
      const parsed = new URL(url, "http://localhost");
      const verb = method.toUpperCase();
      const entry: MockLogEntry = { method: verb, path: parsed.pathname, search: parsed.search, route: null, status: 0, authorization: headers.authorization ?? null, contentType: headers["content-type"] ?? null, body: undefined };
      log.push(entry);
      const result = await answer(verb, parsed, headers, body, entry);
      entry.status = result.status;
      return result;
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
