/**
 * Talking to a host's REST API with plain `fetch`: a timeout per request, a
 * few patient retries when the host says "slow down" or has a passing
 * failure, and network failures turned into "this computer can't reach X".
 * Nothing here logs; callers scrub whatever they show.
 */
import { DeployError } from "./errors";
import type { DeployContext } from "./types";

/** What `fetch` accepts as a body. */
export type RequestBody = NonNullable<RequestInit["body"]>;

export const REQUEST_TIMEOUT_MS = 60_000;
const RETRIES = 3;

export interface HostResponse<T = unknown> {
  status: number;
  ok: boolean;
  /** Parsed JSON, or null when the body wasn't JSON. */
  body: T | null;
  /** The raw body text (bounded), for details. */
  text: string;
  headers: Headers;
}

export interface HostRequest {
  method?: string;
  /** Path under the API origin, or an absolute URL. */
  path: string;
  query?: Record<string, string | undefined>;
  headers?: Record<string, string>;
  body?: RequestBody | null;
  /** Bearer value; defaults to the context's access key. */
  bearer?: string;
  timeoutMs?: number;
  /** Retry 429 and 5xx answers (safe for idempotent requests). Default: true for GET. */
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

export function urlFor(ctx: DeployContext, path: string, query?: Record<string, string | undefined>): string {
  const url = /^https?:\/\//.test(path) ? new URL(path) : new URL(path.replace(/^\/+/, ""), ctx.apiBase.endsWith("/") ? ctx.apiBase : `${ctx.apiBase}/`);

  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== "") url.searchParams.set(key, value);
  return url.toString();
}

export async function hostRequest<T = unknown>(ctx: DeployContext, hostName: string, request: HostRequest): Promise<HostResponse<T>> {
  const method = request.method ?? "GET";
  const retry = request.retry ?? method === "GET";
  const url = urlFor(ctx, request.path, request.query);

  for (let attempt = 0; ; attempt += 1) {
    const timeout = AbortSignal.timeout(request.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
    let response: Response;

    try {
      response = await ctx.fetch(url, {
        method,
        headers: { authorization: `Bearer ${request.bearer ?? ctx.token}`, accept: "application/json", ...request.headers },
        ...(request.body !== undefined ? { body: request.body } : {}),
        signal,
      });
    } catch (error) {
      if (ctx.signal?.aborted) throw new DeployError("host", "Putting the site online was stopped.");
      if (attempt < RETRIES && retry) {
        await wait(500 * 2 ** attempt, ctx.signal);
        continue;
      }
      const timedOut = timeout.aborted;

      throw new DeployError(
        "offline",
        timedOut
          ? `${hostName} took too long to answer. Check your internet connection and try again. Nothing on the live site changed.`
          : `This computer can't reach ${hostName}. Check your internet connection and try again. Nothing on the live site changed.`,
        `${method} ${new URL(url).host}${new URL(url).pathname}: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`
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

/** A short, bounded description of a host's answer for "Technical details". */
export function describeResponse(method: string, path: string, response: HostResponse): string {
  return `${method} ${path} → ${response.status}\n${response.text.slice(0, 2000)}`;
}
