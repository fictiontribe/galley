/**
 * Test doubles a plugin author needs and nothing more: a scripted `fetch`
 * that records what was sent, and a `PluginContext` with settings you
 * choose and a logger you can read back. No network, no engine.
 */
import { PRODUCT, SITE_URL, VERSION } from "@galley/core/brand";
import type { PluginContext, ProviderCallContext } from "@galley/core/plugins";

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** Parsed JSON when the body was JSON, else the text. */
  body: unknown;
}

export type FakeRoute = (request: RecordedRequest) => Response | Promise<Response>;

export interface FakeFetch {
  fetch: typeof fetch;
  requests: RecordedRequest[];
}

/** A `fetch` answered by `route` for every request, recording each one. */
export function fakeFetch(route: FakeRoute): FakeFetch {
  const requests: RecordedRequest[] = [];
  const impl = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};

    new Headers(init.headers as ConstructorParameters<typeof Headers>[0]).forEach((value, key) => {
      headers[key] = value;
    });
    const text = typeof init.body === "string" ? init.body : "";
    let body: unknown = text;

    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    const request: RecordedRequest = { url, method: init.method ?? "GET", headers, body };

    requests.push(request);
    if (init.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    return route(request);
  };

  return { fetch: impl as typeof fetch, requests };
}

/** A JSON response, as a provider would send it. */
export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export interface TestContextOptions {
  name?: string;
  version?: string | null;
  settings?: Record<string, string | undefined>;
  fetch?: typeof fetch;
}

export interface TestContext extends PluginContext {
  /** Every line the plugin logged, as `level message`. */
  readonly lines: string[];
}

/** The context the engine hands a plugin, with settings and fetch of your choosing. */
export function testContext(options: TestContextOptions = {}): TestContext {
  const lines: string[] = [];
  const sink = (level: string) => (message: string) => void lines.push(`${level} ${message}`);

  return {
    plugin: { name: options.name ?? "galley-plugin-test", version: options.version ?? null },
    settings: Object.freeze({ ...(options.settings ?? {}) }),
    log: { info: sink("info"), warn: sink("warn"), error: sink("error") },
    fetch: options.fetch ?? (async () => json(599, { error: { message: "This test gave the plugin no network." } })),
    brand: { productName: PRODUCT.name, slug: PRODUCT.slug, version: VERSION, siteUrl: SITE_URL },
    lines,
  };
}

/** A provider's call context: a test context plus the key and an abort signal. */
export function providerContext(options: TestContextOptions & { key?: string | null; signal?: AbortSignal } = {}): ProviderCallContext & { lines: string[] } {
  return { ...testContext(options), key: options.key ?? null, ...(options.signal ? { signal: options.signal } : {}) };
}
