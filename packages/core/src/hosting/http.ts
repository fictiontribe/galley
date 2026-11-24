/**
 * Talking to a host's REST API with plain `fetch`, the way deploy/http.ts
 * does — a timeout per request, patient retries when the host says "slow
 * down" or has a passing failure, network failures turned into "this
 * computer can't reach X" — with the words of this feature. Nothing here
 * logs; callers scrub whatever they show.
 */
import { HostingError } from "./errors";
import type { EditorHostContext } from "./types";

export const REQUEST_TIMEOUT_MS = 60_000;
const RETRIES = 3;

export interface ApiResponse<T = unknown> {
  status: number;
  ok: boolean;
  /** Parsed JSON, or null when the body wasn't JSON. */
  body: T | null;
  /** The raw body text (bounded), for details. */
  text: string;
  headers: Headers;
}

export interface ApiCall {
  method?: string;
  /** Path under the API's origin. */
  path: string;
  query?: Record<string, string | undefined>;
  /** Sent as JSON. */
  json?: unknown;
  /** The key, sent as `Authorization: Bearer <key>`. */
  key: string;
  timeoutMs?: number;
  /** Retry 429 and 5xx answers (safe for reads and for deletes). Default: true for GET and DELETE. */
  retry?: boolean;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);

    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function apiUrl(origin: string, path: string, query?: Record<string, string | undefined>): string {
  const url = new URL(path.replace(/^\/+/, ""), origin.endsWith("/") ? origin : `${origin}/`);

  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== "") url.searchParams.set(key, value);
  return url.toString();
}

/** One request to the API called `api` (ctx.api names its origin). */
export async function apiRequest<T = unknown>(ctx: EditorHostContext, api: string, hostName: string, call: ApiCall): Promise<ApiResponse<T>> {
  const method = call.method ?? "GET";
  const retry = call.retry ?? (method === "GET" || method === "DELETE");
  const url = apiUrl(ctx.api(api), call.path, call.query);

  for (let attempt = 0; ; attempt += 1) {
    const timeout = AbortSignal.timeout(call.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
    let response: Response;

    try {
      response = await ctx.fetch(url, {
        method,
        headers: { authorization: `Bearer ${call.key}`, accept: "application/json", ...(call.json !== undefined ? { "content-type": "application/json" } : {}) },
        ...(call.json !== undefined ? { body: JSON.stringify(call.json) } : {}),
        signal,
      });
    } catch (error) {
      if (ctx.signal?.aborted) throw new HostingError("host", "It was stopped before it finished.");
      if (attempt < RETRIES && retry) {
        await wait(500 * 2 ** attempt, ctx.signal);
        continue;
      }
      const where = new URL(url);

      throw new HostingError(
        "offline",
        timeout.aborted ? `${hostName} took too long to answer. Check your internet connection and try again.` : `This computer can't reach ${hostName}. Check your internet connection and try again.`,
        `${method} ${where.host}${where.pathname}: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`
      );
    }
    const text = (await response.text().catch(() => "")).slice(0, 64 * 1024);
    let body: T | null = null;

    try {
      body = text ? (JSON.parse(text) as T) : null;
    } catch {
      body = null;
    }
    const transient = response.status === 429 || response.status >= 500;

    if (transient && attempt < RETRIES && (retry || response.status === 429)) {
      const after = Number(response.headers.get("retry-after"));

      await wait(Number.isFinite(after) && after > 0 ? Math.min(after, 30) * 1000 : 800 * 2 ** attempt, ctx.signal);
      continue;
    }
    return { status: response.status, ok: response.ok, body, text, headers: response.headers };
  }
}

/** A short, bounded description of an answer for "Technical details". */
export function describe(method: string, path: string, response: ApiResponse): string {
  return `${method} ${path} → ${response.status}\n${response.text.slice(0, 2000)}`;
}
