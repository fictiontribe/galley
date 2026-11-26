/**
 * The mock server without HTTP: one call per request, answered from the
 * handler table, with a log of every request it saw. The dev server
 * (plugin.ts) puts it behind Vite; tests call it from a stubbed `fetch`.
 */
import type { ApiRouteKey } from "@galley/core/api";
import type { GalleyErrorShape, ServerEvent } from "@galley/core/types";
import type { InstallFixed } from "@galley/core/install/types";
import type { AccountRole } from "@galley/core/install/accounts";
import type { BUILD_MODE_LEVEL as BuildModeLevel, ROLE_REFUSAL as RoleRefusal, ROUTE_ACCESS as RouteAccessTable, SITE_SETTINGS_LEVEL as SiteSettingsLevel, roleMayCall as RoleMayCall } from "@galley/core/install/route-access";
import { MockBackend, createHandlers, type Handlers, type MockRequest, type RawReply } from "./backend.ts";
import { MockInstall, SETUP_OPEN_ROUTES, withInstall, type MockSetupStep } from "./install.ts";
import { MockAccounts, MockRoleError, withAccounts } from "./accounts.ts";
import { MockError, MockTooManyError } from "./site.ts";

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
  /** Hosted only: start signed in as the first person with this role (see accounts.ts). */
  role?: AccountRole;
  /** Hosted only: the server has outgoing e-mail. */
  email?: boolean;
  /** Hosted only: false — the server has no public address of its own, so it e-mails no link (see MockAccountsOptions). */
  publicAddress?: boolean;
  /** Hosted only: an install from before accounts (one owner, no e-mail, the password alone). */
  legacy?: boolean;
  /** Hosted only: false answers as a server from before accounts did — one shared password, no `meta.account`, no people routes. */
  accounts?: boolean;
  /** Hosted only: an identity provider set up (see MockAccountsOptions). */
  provider?: { name: string; passwordsOff?: boolean; people?: string[] };
  /** The role-access table, when the caller loads it (the dev server: see `loadAccess`). */
  access?: Promise<MockAccessTable>;
  /** Core's theme engine, when the caller loads it (the dev server, through Vite: see themes.ts). */
  themes?: Promise<import("./themes.ts").ThemesEngine>;
  /**
   * Replace or wrap some answers before requests are routed. The in-browser
   * demo (packages/web/demo) uses it for what only a demo says (the recorded
   * assistant, its sample inbox); the dev server and the tests pass nothing.
   */
  handlers?: (handlers: Handlers, backend: MockBackend) => Handlers;
}

/** The one role-access table (core's install/route-access.ts), as the mock uses it. */
export interface MockAccessTable {
  ROUTE_ACCESS: typeof RouteAccessTable;
  roleMayCall: typeof RoleMayCall;
  ROLE_REFUSAL: typeof RoleRefusal;
  BUILD_MODE_LEVEL: typeof BuildModeLevel;
  SITE_SETTINGS_LEVEL: typeof SiteSettingsLevel;
}

/**
 * The table, loaded on first use rather than imported up front: the dev
 * server loads this file with Node's own loader, which can't follow core's
 * extension-less imports — plugin.ts hands over a copy loaded through Vite
 * instead (`access`). Tests (vitest) load it here.
 */
function loadAccess(): Promise<MockAccessTable> {
  return import("@galley/core/install/route-access");
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
  /** Refused because the signed-in person's role may not call this route (ROUTE_ACCESS), or may not do what the request asks (build mode, the site's settings file). */
  refused?: boolean;
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
  /** Hosted only: the people, invitations and links, and what would have been e-mailed. */
  accounts: MockAccounts | null;
  log: MockLogEntry[];
  handle(request: { method: string; url: string; headers: Record<string, string | undefined>; body?: Buffer }): Promise<MockAnswer>;
  /** Server events, as the event stream sends them. */
  onEvent(listener: (event: ServerEvent) => void): () => void;
}

const isRaw = (value: unknown): value is RawReply => typeof value === "object" && value !== null && "kind" in value && ((value as RawReply).kind === "bytes" || (value as RawReply).kind === "sse");

/** The real server's error body (server/src/errors.ts `errorBody`): the code and the sentence, and `detail` only when there is one. */
function errorBody(code: GalleyErrorShape["code"], message: string, detail?: string): { error: GalleyErrorShape } {
  return { error: detail ? { code, message, detail } : { code, message } };
}

function json(status: number, body: unknown): MockAnswer {
  return { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, body: JSON.stringify(body) };
}

export function createMockServer(options: MockServerOptions): MockServer {
  const listeners = new Set<(event: ServerEvent) => void>();
  const backend = new MockBackend({ mode: options.mode, emit: (event) => listeners.forEach((listener) => listener(event)) });
  if (options.themes) {
    const themes = options.themes;
    backend.themesEngine = () => themes;
  }
  const install = options.mode === "hosted" ? new MockInstall(backend, { setup: options.setup ?? "done", fixed: options.fixed, stepMs: options.stepMs, allowLocalRepositories: options.allowLocalRepositories, address: options.address }) : null;
  const accounts = install && options.accounts !== false ? new MockAccounts(backend, install, { email: options.email, publicAddress: options.publicAddress, legacy: options.legacy, role: options.role, ...(options.provider ? { provider: options.provider } : {}) }) : null;
  const local = createHandlers(backend);
  const hosted = install ? withInstall(backend, local, install) : null;
  const built: Handlers = hosted && accounts ? withAccounts(backend, hosted, accounts) : (hosted ?? local);
  const handlers: Handlers = options.handlers ? options.handlers(built, backend) : built;
  const routes = compile(Object.keys(handlers) as ApiRouteKey[]);
  const open = new Set<ApiRouteKey>(["GET /api/meta", "POST /api/auth/login", "GET /api/events", ...(install ? SETUP_OPEN_ROUTES : [])]);
  // Only a hosted install has people to check; local mode never loads the table.
  let access: Promise<MockAccessTable> | null = null;
  const table = () => (access ??= (options.access ?? loadAccess()).then((loaded) => {
    // The routes that need no sign-in come from the same table.
    for (const key of Object.keys(loaded.ROUTE_ACCESS) as ApiRouteKey[]) if (loaded.ROUTE_ACCESS[key] === "public") open.add(key);
    if (accounts) accounts.levels = { build: loaded.BUILD_MODE_LEVEL, settings: loaded.SITE_SETTINGS_LEVEL };
    return loaded;
  }));
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
    if (!route || !match) return json(404, errorBody("not-found", `The mock doesn’t know ${method} ${url.pathname}.`));
    entry.route = route.key;
    const rules = install ? await table() : null;
    if (!backend.authenticated && !open.has(route.key)) return json(401, errorBody("unauthorized", "Sign in to continue."));
    // The server decides from the one table; the app hides what it can't use, so a refusal here is a screen calling what it shouldn't.
    const person = accounts?.current() ?? null;
    if (person && rules && !rules.roleMayCall(person.role, route.key)) {
      entry.refused = true;
      // Exactly the real server's refusal (app.ts): the status, the shape, the code and the sentence.
      return json(403, errorBody("forbidden", rules.ROLE_REFUSAL));
    }

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
      if (error instanceof MockRoleError) entry.refused = true;
      if (error instanceof MockError) return json(error instanceof MockTooManyError ? 429 : STATUS[error.code], errorBody(error.code, error.message, error.detail));
      return json(500, errorBody("internal", "The mock server ran into a problem.", error instanceof Error ? error.message : String(error)));
    }
  }

  return {
    backend,
    install,
    accounts,
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
