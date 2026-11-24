/**
 * Media storage's outbound requests, through the project's own guard
 * (forms/net.ts `checkTarget`): the host is resolved first and refused when it
 * points to a private, loopback or link-local address (on a hosted install),
 * the connection goes to the address that was checked, redirects are never
 * followed here (callers that follow one ask again for the new address), and
 * an answer larger than the cap is not read.
 *
 * It looks like `fetch` to its callers (the S3 client, the Cloudflare
 * clients, the check's public load), for the few things they use.
 */
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { checkTarget, systemResolver, type Resolver } from "../forms/net";

export interface MediaFetchOptions {
  /** A hosted install: https only, public addresses only. Locally, this computer's own addresses (a stand-in, MinIO) are allowed. */
  hosted: boolean;
  /** The most an answer may hold. */
  maxBytes: number;
  resolve?: Resolver;
  timeoutMs?: number;
}

export const MEDIA_ANSWER_LIMIT = 32 * 1024 * 1024;

export function createMediaFetch(options: MediaFetchOptions): typeof fetch {
  const resolve = options.resolve ?? systemResolver;

  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const checked = await checkTarget(url, { allowHttp: !options.hosted, allowPrivate: !options.hosted }, resolve);
    // Pinned to the checked address on a hosted install; locally the system's own lookup (which tries every address of "localhost").
    const pinned = options.hosted ? checked : null;
    const headers: Record<string, string> = {};

    new Headers(init.headers).forEach((value, name) => {
      headers[name] = value;
    });
    let body: Buffer | undefined;

    if (init.body instanceof Uint8Array) body = Buffer.from(init.body);
    else if (typeof init.body === "string") body = Buffer.from(init.body);
    else if (init.body !== undefined && init.body !== null) {
      // A form: its bytes and its content type (with the boundary), as fetch would send them.
      const encoded = new Request(url, { method: "POST", body: init.body });

      body = Buffer.from(await encoded.arrayBuffer());
      if (!headers["content-type"]) headers["content-type"] = encoded.headers.get("content-type") ?? "application/octet-stream";
    }
    if (body) headers["content-length"] = String(body.byteLength);

    return new Promise<Response>((resolvePromise, reject) => {
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        request.destroy();
        reject(error);
      };
      const send = url.protocol === "https:" ? httpsRequest : httpRequest;
      const request = send(
        url,
        {
          method: init.method ?? "GET",
          headers,
          ...(pinned
            ? {
                lookup: ((_host, lookupOptions, callback) => {
                  const done = callback as (...args: unknown[]) => void;

                  if ((lookupOptions as { all?: boolean } | undefined)?.all) done(null, [{ address: pinned.address, family: pinned.family }]);
                  else done(null, pinned.address, pinned.family);
                }) as LookupFunction,
              }
            : {}),
        },
        (response: IncomingMessage) => {
          const chunks: Buffer[] = [];
          let size = 0;

          response.on("error", fail);
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > options.maxBytes) {
              fail(new Error(`The answer was larger than ${Math.round(options.maxBytes / (1024 * 1024))} MB, so it wasn't read.`));
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () => {
            if (settled) return;
            settled = true;
            const out = new Headers();

            for (const [name, value] of Object.entries(response.headers)) if (value !== undefined) out.set(name, Array.isArray(value) ? value.join(", ") : value);
            const status = response.statusCode ?? 0;
            const nullBody = status === 204 || status === 304 || (init.method ?? "GET") === "HEAD";

            resolvePromise(new Response(nullBody ? null : Buffer.concat(chunks), { status, headers: out }));
          });
        }
      );

      request.on("error", fail);
      request.setTimeout(options.timeoutMs ?? 60_000, () => fail(Object.assign(new Error("The other server took too long to answer."), { name: "TimeoutError" })));
      init.signal?.addEventListener("abort", () => fail(init.signal?.reason ?? new Error("Stopped.")), { once: true });
      if (body) request.write(body);
      request.end();
    });
  }) as typeof fetch;
}

/** A GET that follows at most `hops` redirects, each to an address checked again by `doFetch`. */
export async function getFollowing(doFetch: typeof fetch, url: string, init: RequestInit = {}, hops = 3): Promise<Response> {
  let current = url;

  for (let hop = 0; ; hop += 1) {
    const response = await doFetch(current, { ...init, redirect: "manual" });
    const location = response.headers.get("location");

    if (response.status < 300 || response.status >= 400 || !location) return response;
    if (hop >= hops) throw new Error("The address kept redirecting, so it wasn't followed.");
    current = new URL(location, current).toString();
  }
}
