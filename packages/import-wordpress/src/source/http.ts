/**
 * A polite HTTP client for reading someone's WordPress site.
 *
 * Polite means: at most a few requests at a time, backing off when the
 * server says it is busy (429/5xx, honouring Retry-After), a timeout on every
 * request, a User-Agent that says what is asking without saying who, and a
 * cache of every JSON response on disk so an interrupted import resumes
 * instead of fetching the whole site again.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { getDefaultAutoSelectFamilyAttemptTimeout, setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRODUCT, VERSION } from "@galley/core/brand";
import { ImportError } from "../errors";

export const USER_AGENT = `${PRODUCT.name}-WordPress-Import/${VERSION} (static site migration; read-only)`;

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
/** Longest we wait on one Retry-After before giving up on that request. */
const MAX_RETRY_AFTER_MS = 60_000;
/** Cached responses older than this are fetched again. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Headers worth keeping in the cache: pagination and discovery. */
const KEPT_HEADERS = ["content-type", "link", "x-wp-total", "x-wp-totalpages"];

export interface FetcherOptions {
  concurrency?: number;
  timeoutMs?: number;
  retries?: number;
  /** Directory for cached JSON. Default: a folder under the system temp dir. */
  cacheDir?: string;
  fresh?: boolean;
  auth?: { user: string; password: string };
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

export interface HttpResponse {
  status: number;
  /** Final URL after redirects. */
  url: string;
  headers: Record<string, string>;
  text: string;
  fromCache: boolean;
}

export interface BytesResult {
  status: number;
  bytes?: Uint8Array;
  contentType: string;
  /** The file was bigger than the limit; nothing was kept. */
  tooLarge?: boolean;
  size?: number;
}

export interface Fetcher {
  /** GET a JSON (or any text) resource; 2xx responses are cached. */
  get(url: string, options?: { cache?: boolean; auth?: boolean }): Promise<HttpResponse>;
  bytes(url: string, options?: { maxBytes?: number }): Promise<BytesResult>;
  readonly cacheDir: string;
  clearCache(): void;
  readonly stats: { requests: number; retries: number; cached: number };
}

export function defaultCacheDir(): string {
  return join(tmpdir(), `${PRODUCT.slug}-wordpress-cache`);
}

function semaphore(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(aborted());
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(aborted());
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function aborted(): ImportError {
  return new ImportError("aborted", "The import was stopped. Nothing more was fetched.");
}

/** Connection failures waiting can't fix: nothing listening, no such host, the wrong protocol, a bad certificate. */
function permanent(error: unknown): boolean {
  const parts = [error, (error as { cause?: unknown } | null)?.cause].map((part) => (part instanceof Error ? `${(part as Error & { code?: string }).code ?? ""} ${part.message}` : ""));

  return parts.some((text) => /ECONNREFUSED|ENOTFOUND|EPROTO|wrong version number|CERT_|certificate|self[- ]signed/i.test(text));
}

/** Retry-After is either seconds or an HTTP date. */
export function retryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);

  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);

  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

function pickHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};

  for (const name of KEPT_HEADERS) {
    const value = headers.get(name);

    if (value !== null) out[name] = value;
  }
  return out;
}

/**
 * Node tries IPv6 and IPv4 in turn, giving each address 250 ms by default.
 * On a slow link (or where IPv6 is routed but doesn't answer) every attempt
 * times out and fetch fails although the site is fine — seen against real
 * sites during testing. A second per attempt still falls back quickly; the
 * value is only ever raised, never lowered.
 */
function patientConnections(): void {
  try {
    if (getDefaultAutoSelectFamilyAttemptTimeout() < 1000) setDefaultAutoSelectFamilyAttemptTimeout(1000);
  } catch {
    // Older Node versions without the setting connect the old way.
  }
}

export function createFetcher(options: FetcherOptions = {}): Fetcher {
  patientConnections();
  const limit = semaphore(Math.max(1, Math.min(4, options.concurrency ?? 4)));
  const timeoutMs = options.timeoutMs ?? 30_000;
  const retries = options.retries ?? 4;
  const doFetch = options.fetch ?? fetch;
  const cacheDir = options.cacheDir ?? defaultCacheDir();
  const stats = { requests: 0, retries: 0, cached: 0 };
  const authHeader = options.auth ? `Basic ${Buffer.from(`${options.auth.user}:${options.auth.password}`).toString("base64")}` : null;

  function cacheFile(url: string, withAuth: boolean): string {
    // The user name is part of the key so a signed-in read never answers an anonymous one; the password never is.
    const key = createHash("sha256").update(`${url}\n${withAuth && options.auth ? options.auth.user : ""}`).digest("hex");

    return join(cacheDir, `${key}.json`);
  }

  function readCache(file: string): HttpResponse | null {
    if (options.fresh) return null;
    try {
      if (Date.now() - statSync(file).mtimeMs > CACHE_TTL_MS) return null;
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Omit<HttpResponse, "fromCache">;

      return { ...parsed, fromCache: true };
    } catch {
      return null;
    }
  }

  function writeCache(file: string, response: HttpResponse) {
    try {
      mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
      const { fromCache: _ignored, ...stored } = response;

      writeFileSync(file, JSON.stringify(stored), { mode: 0o600 });
    } catch {
      // A cache that can't be written only costs a refetch next time.
    }
  }

  async function attempt(url: string, headers: Record<string, string>): Promise<Response> {
    for (let tries = 0; ; tries += 1) {
      if (options.signal?.aborted) throw aborted();
      const signals = [AbortSignal.timeout(timeoutMs), ...(options.signal ? [options.signal] : [])];
      let response: Response | null = null;
      let failure: unknown = null;

      stats.requests += 1;
      try {
        response = await doFetch(url, { headers, redirect: "follow", signal: AbortSignal.any(signals) });
      } catch (error) {
        if (options.signal?.aborted) throw aborted();
        // The server's address guard said no: retrying can't change that, and the person needs its words.
        if (error instanceof Error && error.name === "OutboundRefused") throw new ImportError("refused", error.message, (error as Error & { detail?: string }).detail);
        failure = error;
      }
      if (response && !RETRY_STATUSES.has(response.status)) return response;
      if (tries >= retries || (!response && permanent(failure))) {
        if (response) return response;
        throw new ImportError(
          "unreachable",
          "The site didn't answer. Check the address and your connection, then try again — what was already fetched is kept.",
          failure instanceof Error ? `${url}: ${failure.message}` : url
        );
      }
      const wait = response ? retryAfterMs(response.headers.get("retry-after")) : null;

      if (wait !== null && wait > MAX_RETRY_AFTER_MS) return response!;
      // Drain the body so the connection can be reused.
      await response?.arrayBuffer().catch(() => undefined);
      stats.retries += 1;
      await sleep(wait ?? 500 * 2 ** tries + Math.floor(Math.random() * 250), options.signal);
    }
  }

  return {
    cacheDir,
    stats,

    async get(url, opts = {}) {
      const useAuth = opts.auth !== false && authHeader !== null;
      const file = cacheFile(url, useAuth);

      if (opts.cache !== false) {
        const cached = readCache(file);

        if (cached) {
          stats.cached += 1;
          return cached;
        }
      }
      return limit(async () => {
        const headers: Record<string, string> = { "user-agent": USER_AGENT, accept: "application/json, text/html;q=0.8, */*;q=0.5" };

        if (useAuth) headers.authorization = authHeader!;
        const response = await attempt(url, headers);
        const result: HttpResponse = {
          status: response.status,
          url: response.url || url,
          headers: pickHeaders(response.headers),
          text: await response.text(),
          fromCache: false,
        };

        if (opts.cache !== false && response.ok) writeCache(file, result);
        return result;
      });
    },

    async bytes(url, opts = {}) {
      return limit(async () => {
        // Media is public; credentials are never sent with file downloads.
        const response = await attempt(url, { "user-agent": USER_AGENT, accept: "*/*" });
        const contentType = response.headers.get("content-type") ?? "";

        if (!response.ok) {
          await response.arrayBuffer().catch(() => undefined);
          return { status: response.status, contentType };
        }
        const max = opts.maxBytes ?? Number.POSITIVE_INFINITY;
        const declared = Number(response.headers.get("content-length") ?? "NaN");

        if (Number.isFinite(declared) && declared > max) {
          await response.body?.cancel().catch(() => undefined);
          return { status: response.status, contentType, tooLarge: true, size: declared };
        }
        const chunks: Uint8Array[] = [];
        let size = 0;

        if (response.body) {
          for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
            size += chunk.length;
            if (size > max) {
              await response.body.cancel().catch(() => undefined);
              return { status: response.status, contentType, tooLarge: true, size };
            }
            chunks.push(chunk);
          }
        }
        return { status: response.status, contentType, bytes: Buffer.concat(chunks), size };
      });
    },

    clearCache() {
      rmSync(cacheDir, { recursive: true, force: true });
    },
  };
}
