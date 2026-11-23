/**
 * Outbound requests to addresses built from user input — a provider's form
 * definition, a webhook — with the guards against server-side request
 * forgery in one place:
 *
 *   1. https only (plain http only where the caller allows it: webhooks in
 *      local mode, for a catcher on this computer);
 *   2. no user name or password in the address; optionally only some hosts
 *      (the vendor's own domains) and only the default port;
 *   3. the host name is resolved FIRST and every address it resolves to must
 *      be public — loopback, private, link-local (cloud metadata), carrier-
 *      grade NAT, multicast and reserved ranges are refused — and the
 *      connection is then made to exactly the address that was checked, so a
 *      second, different DNS answer can't slip in between the check and the
 *      request (DNS rebinding);
 *   4. redirects are followed only to the same host (and checked again), at
 *      most twice; a tight timeout and a cap on the response size.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { GalleyError } from "../errors";

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export interface OutboundRequest {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}

export interface OutboundResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Performs one request to `url`, connecting to `pinned` (already checked). Swappable in tests. */
export type Transport = (url: URL, init: OutboundRequest, pinned: ResolvedAddress | null, limits: { timeoutMs: number; maxBytes: number }) => Promise<OutboundResponse>;

export interface GuardOptions {
  /** Allow http:// as well as https://. */
  allowHttp?: boolean;
  /** Allow loopback and private addresses (local mode webhooks). */
  allowPrivate?: boolean;
  /** When set, the host name must pass this test (vendor domains). */
  allowHost?: (hostname: string) => boolean;
  /** Only the scheme's default port. */
  defaultPortOnly?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export class OutboundRefused extends GalleyError {
  constructor(message: string, detail?: string) {
    super("invalid", message, detail);
    this.name = "OutboundRefused";
  }
}

const BLOCKED = new BlockList();

for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv6");
}

/** Whether an IP address is one a request from the server may go to. */
export function isPublicAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, "").toLowerCase();
  const family = isIP(bare);

  if (family === 0) return false;
  if (family === 6) {
    // IPv4-mapped (::ffff:a.b.c.d or ::ffff:hhhh:hhhh) is judged by the IPv4 address inside it.
    const mapped = /^::ffff:(?:0:)?(\d+\.\d+\.\d+\.\d+)$/.exec(bare);

    if (mapped) return isPublicAddress(mapped[1]!);
    const hex = /^::ffff:(?:0:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(bare);

    if (hex) {
      const high = parseInt(hex[1]!, 16);
      const low = parseInt(hex[2]!, 16);

      return isPublicAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return !BLOCKED.check(bare, "ipv6");
  }
  return !BLOCKED.check(bare, "ipv4");
}

export const systemResolver: Resolver = async (hostname) => {
  const results = await dnsLookup(hostname, { all: true, verbatim: true });

  return results.map((item) => ({ address: item.address, family: item.family === 6 ? 6 : 4 }));
};

function describeHost(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "");
}

/** Checks an address before any connection is made; returns the address to connect to. */
export async function checkTarget(url: URL, options: GuardOptions, resolve: Resolver): Promise<ResolvedAddress | null> {
  if (url.protocol !== "https:" && !(options.allowHttp && url.protocol === "http:")) {
    throw new OutboundRefused("Only secure (https://) addresses can be used here.", url.protocol);
  }
  if (url.username || url.password) throw new OutboundRefused("The address can't include a user name or password.");
  const host = describeHost(url).toLowerCase().replace(/\.$/, "");

  if (!host) throw new OutboundRefused("The address has no host name.");
  if (options.allowHost && !options.allowHost(host)) throw new OutboundRefused(`${host} isn't an address this provider uses.`, host);
  if (options.defaultPortOnly && url.port !== "") throw new OutboundRefused("The address can't name a port.", url.port);
  let addresses: ResolvedAddress[];

  if (isIP(host)) {
    addresses = [{ address: host, family: isIP(host) === 6 ? 6 : 4 }];
  } else {
    try {
      addresses = await resolve(host);
    } catch (error) {
      throw new OutboundRefused(`${host} couldn't be found. Check the address.`, error instanceof Error ? error.message : String(error));
    }
  }
  if (!addresses.length) throw new OutboundRefused(`${host} couldn't be found. Check the address.`);
  if (!options.allowPrivate) {
    const blocked = addresses.find((item) => !isPublicAddress(item.address));

    if (blocked) {
      throw new OutboundRefused(`${host} points to a private or local network address, so the server won't send requests there.`, `${host} → ${blocked.address}`);
    }
  }
  return addresses[0]!;
}

/** The real transport: node:http(s), connecting to the checked address while TLS still verifies the host name. */
export const nodeTransport: Transport = (url, init, pinned, limits) =>
  new Promise((resolvePromise, reject) => {
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
        headers: init.headers,
        ...(pinned
          ? {
              lookup: ((_host, options, callback) => {
                const done = callback as (...args: unknown[]) => void;

                if ((options as { all?: boolean } | undefined)?.all) done(null, [{ address: pinned.address, family: pinned.family }]);
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
          if (size > limits.maxBytes) {
            fail(new OutboundRefused("The answer was larger than expected, so it wasn't read.", `> ${limits.maxBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          if (settled) return;
          settled = true;
          const headers: Record<string, string> = {};

          for (const [key, value] of Object.entries(response.headers)) if (value !== undefined) headers[key] = Array.isArray(value) ? value.join(", ") : value;
          resolvePromise({ status: response.statusCode ?? 0, headers, body: Buffer.concat(chunks).toString("utf8") });
        });
      }
    );

    request.on("error", fail);
    request.setTimeout(limits.timeoutMs, () => fail(new OutboundRefused("The other server took too long to answer.", `timeout ${limits.timeoutMs} ms`)));
    if (init.body !== undefined) request.write(init.body);
    request.end();
  });

export interface GuardedFetch {
  (url: string, init?: OutboundRequest, options?: GuardOptions): Promise<OutboundResponse>;
}

export function createGuardedFetch(deps: { resolve?: Resolver; transport?: Transport } = {}): GuardedFetch {
  const resolve = deps.resolve ?? systemResolver;
  const transport = deps.transport ?? nodeTransport;

  return async (raw, init = {}, options = {}) => {
    let url: URL;

    try {
      url = new URL(raw);
    } catch {
      throw new OutboundRefused("That isn't a web address.", raw.slice(0, 200));
    }
    const limits = { timeoutMs: options.timeoutMs ?? 8000, maxBytes: options.maxBytes ?? 1024 * 1024 };
    const firstHost = describeHost(url).toLowerCase();

    for (let hop = 0; ; hop += 1) {
      const pinned = await checkTarget(url, options, resolve);
      const response = await transport(url, init, pinned, limits);

      if (response.status < 300 || response.status >= 400 || !response.headers.location) return response;
      if (hop >= (options.maxRedirects ?? 2)) throw new OutboundRefused("The address kept redirecting, so it wasn't followed.");
      const next = new URL(response.headers.location, url);

      if (describeHost(next).toLowerCase() !== firstHost) {
        throw new OutboundRefused(`The address redirected to another site (${describeHost(next)}), so it wasn't followed.`, next.origin);
      }
      url = next;
      // A redirect turns a POST into a GET only for 301–303; never resend a body to a new place.
      if (init.method === "POST" && response.status !== 307 && response.status !== 308) init = { ...init, method: "GET", body: undefined };
    }
  };
}
