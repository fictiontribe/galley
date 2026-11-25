/**
 * A client for an extension's own routes (`/api/x/<id>/…`), for its
 * addition in the app. The address is given as its parts and each part is
 * encoded, so a value that came from somewhere else can't turn into a path.
 * A refusal is thrown as the app's own `ApiFailure`, in the server's words;
 * a lost sign-in sends the person to sign in, as it does for the app's own
 * calls.
 */
import type { ApiRouteKey } from "@galley/core/api";
import { ApiFailure, failureFrom } from "@/lib/api";

const ID = /^[a-z][a-z0-9-]{2,31}$/;

export type ExtensionQuery = Record<string, string | number | boolean | undefined>;

export interface ExtensionApi {
  /** A GET changes nothing on the server: that is the rule for every route. */
  get<T = unknown>(parts: readonly string[], query?: ExtensionQuery, init?: { signal?: AbortSignal }): Promise<T>;
  post<T = unknown>(parts: readonly string[], body?: unknown, init?: { signal?: AbortSignal }): Promise<T>;
  put<T = unknown>(parts: readonly string[], body?: unknown, init?: { signal?: AbortSignal }): Promise<T>;
  patch<T = unknown>(parts: readonly string[], body?: unknown, init?: { signal?: AbortSignal }): Promise<T>;
  delete<T = unknown>(parts: readonly string[], init?: { signal?: AbortSignal }): Promise<T>;
}

/** The address of one of the extension's routes: `["sites", siteId, "note"]` is `/api/x/<id>/sites/<siteId>/note`. */
export function extensionUrl(id: string, parts: readonly string[], query?: ExtensionQuery): string {
  if (!ID.test(id)) throw new Error(`“${id}” isn't an extension's id.`);
  if (!Array.isArray(parts) || parts.length === 0 || parts.some((part) => typeof part !== "string" || part === "" || part === "." || part === "..")) throw new Error("A route's address is given as its parts, each a word of its own.");
  const search = new URLSearchParams();

  for (const [name, value] of Object.entries(query ?? {})) if (value !== undefined) search.set(name, String(value));
  const text = search.toString();

  return `/api/x/${id}/${parts.map(encodeURIComponent).join("/")}${text ? `?${text}` : ""}`;
}

export function extensionApi(id: string): ExtensionApi {
  async function call<T>(method: string, parts: readonly string[], options: { query?: ExtensionQuery; body?: unknown; signal?: AbortSignal }): Promise<T> {
    const url = extensionUrl(id, parts, options.query);
    const route = `${method} ${url.split("?")[0]}`;
    const sends = method !== "GET" && method !== "DELETE";
    let response: Response;

    try {
      response = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: { accept: "application/json", ...(sends ? { "content-type": "application/json" } : {}) },
        ...(sends ? { body: JSON.stringify(options.body ?? {}) } : {}),
        signal: options.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new ApiFailure(route, 0, { code: "internal", message: "Can’t reach the app’s server. Check that it’s still running, then try again.", detail: error instanceof Error ? error.message : String(error) });
    }
    // The route isn't in the app's own table, but a refusal is handled the same way: 401 is only ever the editor's own "not signed in".
    if (!response.ok) throw await failureFrom(route as ApiRouteKey, response);
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  if (!ID.test(id)) throw new Error(`“${id}” isn't an extension's id.`);
  return Object.freeze({
    get: <T>(parts: readonly string[], query?: ExtensionQuery, init?: { signal?: AbortSignal }) => call<T>("GET", parts, { query, signal: init?.signal }),
    post: <T>(parts: readonly string[], body?: unknown, init?: { signal?: AbortSignal }) => call<T>("POST", parts, { body, signal: init?.signal }),
    put: <T>(parts: readonly string[], body?: unknown, init?: { signal?: AbortSignal }) => call<T>("PUT", parts, { body, signal: init?.signal }),
    patch: <T>(parts: readonly string[], body?: unknown, init?: { signal?: AbortSignal }) => call<T>("PATCH", parts, { body, signal: init?.signal }),
    delete: <T>(parts: readonly string[], init?: { signal?: AbortSignal }) => call<T>("DELETE", parts, { signal: init?.signal }),
  });
}
