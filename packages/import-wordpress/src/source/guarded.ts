/**
 * A `fetch` for reading a WordPress site from a server, where the address is
 * typed by a person and the request leaves from the server's own network.
 *
 * The rules are not this file's: every hop goes through the forms feature's
 * `checkTarget` (@galley/core/forms), the one place the app decides which
 * addresses a server-side request may reach — the host name is resolved
 * first, every address it resolves to must be public (unless private ones are
 * allowed), and the connection is made to exactly the address that was
 * checked, so a second DNS answer can't slip in between. What this file adds
 * is only what a WordPress import needs and a form webhook doesn't: binary
 * bodies streamed to the importer's own size limits, plain http (many
 * WordPress sites still answer on it), and redirects followed to other hosts
 * — WordPress sends `example.com` to `www.example.com` and media to a CDN —
 * each one checked again before it is connected to.
 */
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { checkTarget, systemResolver, type ResolvedAddress, type Resolver } from "@galley/core/forms";

export interface GuardedFetchOptions {
  /** Local mode: a WordPress on this computer or the local network is fine. Hosted mode: never. */
  allowPrivate: boolean;
  maxRedirects?: number;
  /** Test seam: how host names resolve. */
  resolve?: Resolver;
  /** Test seam: where the checked address is actually connected (a fake standing in for a public host). */
  connectTo?: (checked: ResolvedAddress) => ResolvedAddress;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function headerRecord(init: RequestInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};

  new Headers(init?.headers ?? {}).forEach((value, key) => (out[key] = value));
  return out;
}

function send(url: URL, headers: Record<string, string>, pinned: ResolvedAddress, signal: AbortSignal | undefined): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const lookup: LookupFunction = (_host, options, callback) => {
      const done = callback as (...args: unknown[]) => void;

      if ((options as { all?: boolean } | undefined)?.all) done(null, [{ address: pinned.address, family: pinned.family }]);
      else done(null, pinned.address, pinned.family);
    };
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, { method: "GET", headers, lookup }, resolve);
    const abort = () => request.destroy(signal?.reason instanceof Error ? signal.reason : new Error("The request was stopped."));

    request.on("error", reject);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    request.on("close", () => signal?.removeEventListener("abort", abort));
    request.end();
  });
}

/** `fetch(url, { headers, signal })` with the server-side address guard on every hop. GET only — the importer never sends anything. */
export function createGuardedFetch(options: GuardedFetchOptions): typeof fetch {
  const resolve = options.resolve ?? systemResolver;
  const guard = { allowHttp: true, allowPrivate: options.allowPrivate };

  const guarded = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    let url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers = headerRecord(init);
    const signal = init?.signal ?? undefined;

    for (let hop = 0; ; hop += 1) {
      const checked = await checkTarget(url, guard, resolve);
      const pinned = checked && options.connectTo ? options.connectTo(checked) : checked;

      if (!pinned) throw new Error(`${url.host} couldn't be found.`);
      const response = await send(url, headers, pinned, signal);
      const status = response.statusCode ?? 0;
      const location = response.headers.location;

      if (REDIRECTS.has(status) && location && init?.redirect !== "manual") {
        response.resume();
        if (hop >= (options.maxRedirects ?? 5)) throw new Error("The address kept redirecting, so it wasn't followed.");
        const next = new URL(location, url);

        // A signed-in read never carries its password to another host.
        if (next.host !== url.host) delete headers.authorization;
        url = next;
        continue;
      }
      const out = new Headers();

      for (const [key, value] of Object.entries(response.headers)) {
        if (value === undefined) continue;
        for (const one of Array.isArray(value) ? value : [value]) out.append(key, one);
      }
      const body = status === 204 || status === 304 ? null : (Readable.toWeb(response) as ReadableStream<Uint8Array>);
      const result = new Response(body, { status, headers: out });

      // The importer resolves relative links against the address it ended up at.
      Object.defineProperty(result, "url", { value: url.href });
      return result;
    }
  };

  return guarded as typeof fetch;
}
