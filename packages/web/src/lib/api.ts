/**
 * The one way the UI talks to the server. Every call is typed from
 * `ApiRoutes`: a wrong path param, query key or body shape is a compile error.
 */
import type {
  ApiRouteKey,
  RouteBody,
  RouteParams,
  RouteQuery,
  RouteResponse,
} from "@galley/core/api";
import type { GalleyErrorShape } from "@galley/core/types";
import { carriesSetupCode } from "./hosted";
import { isUnauthorized } from "./session";

/** Routes that answer with something other than JSON (SSE, raw bytes). */
type NonJsonRoute = {
  [K in ApiRouteKey]: [RouteResponse<K>] extends [never] ? K : never;
}[ApiRouteKey];

export type JsonRoute = Exclude<ApiRouteKey, NonJsonRoute>;

type IsEmpty<T> = [keyof T] extends [never] ? true : false;

type ParamsOption<K extends ApiRouteKey> =
  IsEmpty<RouteParams<K>> extends true ? { params?: never } : { params: RouteParams<K> };

type QueryOption<K extends ApiRouteKey> = [RouteQuery<K>] extends [undefined]
  ? { query?: never }
  : Partial<NonNullable<RouteQuery<K>>> extends RouteQuery<K>
    ? { query?: RouteQuery<K> }
    : { query: RouteQuery<K> };

type BodyOption<K extends ApiRouteKey> = [RouteBody<K>] extends [undefined]
  ? { body?: never }
  : Partial<NonNullable<RouteBody<K>>> extends RouteBody<K>
    ? { body?: RouteBody<K> }
    : { body: RouteBody<K> };

export type ApiOptions<K extends ApiRouteKey> = ParamsOption<K> &
  QueryOption<K> &
  BodyOption<K> & { signal?: AbortSignal };

type RequiredKeys<T> = { [P in keyof T]-?: object extends Pick<T, P> ? never : P }[keyof T];

/** Options are optional only when the route needs none of them. */
type ApiArgs<K extends ApiRouteKey> =
  [RequiredKeys<ApiOptions<K>>] extends [never] ? [options?: ApiOptions<K>] : [options: ApiOptions<K>];

type QueryValue = string | number | boolean | undefined;

/** A failed call. `shape` is the server's error, safe to show. */
export class ApiFailure extends Error {
  readonly shape: GalleyErrorShape;
  readonly status: number;
  readonly route: string;

  constructor(route: string, status: number, shape: GalleyErrorShape) {
    super(shape.message);
    this.name = "ApiFailure";
    this.route = route;
    this.status = status;
    this.shape = shape;
  }

  /** True when the server could not be reached at all. */
  get offline(): boolean {
    return this.status === 0;
  }
}

export function isApiFailure(value: unknown): value is ApiFailure {
  return value instanceof ApiFailure;
}

/** Turn any thrown value into something with a plain message and optional detail. */
export function errorShape(error: unknown): GalleyErrorShape {
  if (isApiFailure(error)) return error.shape;
  if (error instanceof Error) {
    return { code: "internal", message: "This screen ran into a problem it couldn’t recover from.", detail: error.message };
  }
  return { code: "internal", message: "This screen ran into a problem it couldn’t recover from.", detail: String(error) };
}

let unauthorizedHandler: (() => void) | null = null;

/** The app installs this once so a lost session sends the person to sign in. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

/** Something other than a JSON call (the event stream) found the session gone. */
export function reportUnauthorized(): void {
  unauthorizedHandler?.();
}

function splitRoute(route: string): { method: string; path: string } {
  const space = route.indexOf(" ");
  return { method: route.slice(0, space), path: route.slice(space + 1) };
}

/** "/api/sites/:siteId/x" + { siteId } → "/api/sites/abc/x". Values are URL-encoded. */
export function fillPath(path: string, params: Record<string, string> | undefined): string {
  return path.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const value = params?.[name];
    if (value === undefined || value === "") throw new Error(`Missing route param "${name}" for ${path}`);
    return encodeURIComponent(value);
  });
}

/** Query string from a flat record; undefined values are left out. */
export function queryString(query: Record<string, QueryValue> | undefined): string {
  if (!query) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

/** The URL of a route, with params filled and query appended. */
export function buildUrl<K extends ApiRouteKey>(
  route: K,
  params?: RouteParams<K>,
  query?: RouteQuery<K>,
): string {
  const { path } = splitRoute(route);
  return fillPath(path, params as Record<string, string> | undefined) + queryString(query as Record<string, QueryValue> | undefined);
}

/** Routes whose 401 is handled where they're called (sign-in, the session hand-off, /open's own explanation, a wrong current password). */
const AUTH_ROUTES: ReadonlySet<string> = new Set<JsonRoute>(["POST /api/auth/login", "GET /api/meta", "GET /api/open", "POST /api/install/password"]);

/**
 * A hosted install's one-time setup code, from the setup link. Held in memory
 * only — never in storage or the address bar — and sent only to first-run
 * routes, until choosing the password signs this browser in.
 */
let setupCode: string | null = null;

export function setSetupCode(code: string | null): void {
  setupCode = code;
}

export function getSetupCode(): string | null {
  return setupCode;
}

/** The setup code as a header, for the routes that take it; nothing for every other route. */
export function setupCodeHeaders(url: string): Record<string, string> {
  return setupCode && carriesSetupCode(url) ? { authorization: `Bearer ${setupCode}` } : {};
}

/** A refusal on a first-run route is the setup screen's to explain (a used or wrong link), not a lost session. */
function handledInPlace(route: ApiRouteKey): boolean {
  const { path } = splitRoute(route);
  return AUTH_ROUTES.has(route) || path === "/api/setup" || path.startsWith("/api/setup/") || (setupCode !== null && carriesSetupCode(path.replace(/:[A-Za-z]+/g, "x")));
}

async function readError(route: string, response: Response): Promise<ApiFailure> {
  let shape: GalleyErrorShape | null = null;
  try {
    const json = (await response.json()) as { error?: GalleyErrorShape };
    if (json && typeof json.error?.message === "string") shape = json.error;
  } catch {
    // Not JSON: fall through to a plain description of the status.
  }
  if (shape && response.status === 401 && shape.code !== "unauthorized") shape = { ...shape, code: "unauthorized" };
  return new ApiFailure(
    route,
    response.status,
    shape ?? {
      code: response.status === 404 ? "not-found" : response.status === 401 ? "unauthorized" : "internal",
      message:
        response.status === 404
          ? "The app’s server doesn’t know this request. It may be an older version."
          : "The app’s server couldn’t finish this request. Your work is safe.",
      detail: `${route} → HTTP ${response.status} ${response.statusText}`,
      status: response.status,
    },
  );
}

/** The failure a non-OK response means; a lost session also sends the person to sign in (once). */
export async function failureFrom(route: ApiRouteKey, response: Response): Promise<ApiFailure> {
  const failure = await readError(route, response);
  if (!handledInPlace(route) && isUnauthorized(response.status, failure.shape)) unauthorizedHandler?.();
  return failure;
}

/** The method and URL of a route call. */
export function requestOf<K extends ApiRouteKey>(route: K, options: ApiOptions<K>): { method: string; url: string } {
  const opts = options as { params?: Record<string, string>; query?: Record<string, QueryValue> };
  const { method, path } = splitRoute(route);
  return { method, url: fillPath(path, opts.params) + queryString(opts.query) };
}

/** Call a JSON route. Throws `ApiFailure`. */
export async function api<K extends JsonRoute>(route: K, ...[options]: ApiArgs<K>): Promise<RouteResponse<K>> {
  const opts = (options ?? {}) as {
    params?: Record<string, string>;
    query?: Record<string, QueryValue>;
    body?: unknown;
    signal?: AbortSignal;
  };
  const { method, path } = splitRoute(route);
  const url = fillPath(path, opts.params) + queryString(opts.query);
  // A DELETE carries a body only when its route's contract has one (removing the hosted editor takes `{ confirm: true }`); the types let no other DELETE pass one.
  const hasBody = method === "DELETE" ? opts.body !== undefined : method !== "GET";
  const init: RequestInit = {
    method,
    credentials: "same-origin",
    headers: { ...(hasBody ? { "content-type": "application/json" } : {}), accept: "application/json", ...setupCodeHeaders(url) },
    signal: opts.signal,
  };
  if (hasBody) init.body = JSON.stringify(opts.body ?? {});

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiFailure(route, 0, {
      code: "internal",
      message: "Can’t reach the app’s server. Check that it’s still running, then try again.",
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  if (!response.ok) throw await failureFrom(route, response);
  if (response.status === 204) return undefined as unknown as RouteResponse<K>;
  return (await response.json()) as RouteResponse<K>;
}

/** Raw bytes of a repo file: the working copy, or the last published version with `rev: "base"`. */
export function rawFileUrl(siteId: string, path: string, rev?: "base"): string {
  return buildUrl("GET /api/sites/:siteId/raw", { siteId }, { path, rev });
}

/** Bytes of a generated image that hasn't been saved yet. */
export function candidateUrl(candidateId: string): string {
  return buildUrl("GET /api/images/candidates/:candidateId", { candidateId });
}

export const EVENTS_URL = buildUrl("GET /api/events");
