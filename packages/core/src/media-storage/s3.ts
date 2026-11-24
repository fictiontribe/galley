/**
 * A small S3 client: the six calls a media library needs, over plain
 * `fetch`, signed with sigv4.ts. Cloudflare R2, Amazon S3 and the
 * S3-compatible stores (Backblaze B2, DigitalOcean Spaces, MinIO, Wasabi)
 * all answer it. No SDK: these six calls are a few hundred lines, and an SDK
 * would be the largest dependency the engine has.
 *
 * What it handles on purpose:
 *  - path-style (`endpoint/bucket/key`) and virtual-hosted (`bucket.endpoint/key`) addressing;
 *  - a computer whose clock is off: S3 refuses a request more than 15 minutes
 *    out (RequestTimeTooSkewed); the server's own time is read from the
 *    answer and the request is signed again once with it;
 *  - the error document (`<Error><Code>…</Code>…`) read into `S3Error`, and
 *    the body-less answers to HEAD turned into the same codes by status;
 *  - a wrong region, from the answer's `x-amz-bucket-region` header or the
 *    `<Region>` it names, so the person can be told which region to use.
 *
 * Nothing here logs. The secret is only ever an HMAC key.
 */
import { createHash } from "node:crypto";
import { EMPTY_SHA256, encodeKey, sha256Hex, signRequest, type Credentials } from "./sigv4";

export interface S3ClientOptions {
  /** "https://<account>.r2.cloudflarestorage.com", "https://s3.eu-west-1.amazonaws.com", "http://127.0.0.1:9000". */
  endpoint: string;
  region: string;
  bucket: string;
  credentials: Credentials;
  /** true: endpoint/bucket/key. false: bucket.endpoint/key. */
  pathStyle: boolean;
  fetch?: typeof fetch;
  /** The clock, in ms. Test seam. */
  now?: () => number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface S3Object {
  key: string;
  size: number;
  /** Without the quotes. For a single PUT it is the MD5 of the bytes. */
  etag: string;
  lastModified: number;
}

export interface S3Head {
  size: number;
  etag: string;
  contentType: string | null;
  cacheControl: string | null;
  lastModified: number;
  /** `x-amz-meta-*`, names without the prefix, lowercased. */
  metadata: Record<string, string>;
}

export interface PutOptions {
  contentType?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
  /** Only if nothing is stored under the key yet (`If-None-Match: *`): a name is never overwritten. */
  ifAbsent?: boolean;
}

/** What S3 answered, in its own words. `code` is S3's error code (AccessDenied, NoSuchBucket…), or one made from the status for a body-less answer. */
export class S3Error extends Error {
  readonly status: number;
  readonly code: string;
  /** The region the bucket is really in, when the answer says. */
  readonly region: string | null;
  readonly requestId: string | null;

  constructor(status: number, code: string, message: string, region: string | null = null, requestId: string | null = null) {
    super(message || code);
    this.name = "S3Error";
    this.status = status;
    this.code = code;
    this.region = region;
    this.requestId = requestId;
  }
}

/** The network failed before any answer (DNS, refused connection, TLS, timeout). */
export class S3NetworkError extends Error {
  readonly timedOut: boolean;

  constructor(message: string, timedOut: boolean) {
    super(message);
    this.name = "S3NetworkError";
    this.timedOut = timedOut;
  }
}

export const S3_TIMEOUT_MS = 60_000;
const MAX_SKEW_MS = 15 * 60_000;

function tag(xml: string, name: string): string | null {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);

  return match ? unescapeXml(match[1]!) : null;
}

export function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

const STATUS_CODES: Record<number, string> = { 301: "PermanentRedirect", 307: "TemporaryRedirect", 400: "BadRequest", 403: "AccessDenied", 404: "NotFound", 409: "Conflict", 412: "PreconditionFailed" };

export function md5Hex(data: Uint8Array): string {
  return createHash("md5").update(data).digest("hex");
}

export interface S3Client {
  readonly bucket: string;
  /** The address of an object, as signed requests reach it. */
  objectUrl(key: string): URL;
  headBucket(): Promise<void>;
  putObject(key: string, body: Uint8Array, options?: PutOptions): Promise<{ etag: string }>;
  /** Null when there is no such object. */
  getObject(key: string): Promise<{ body: Uint8Array; contentType: string | null; metadata: Record<string, string> } | null>;
  /** Null when there is no such object. */
  headObject(key: string): Promise<S3Head | null>;
  /** Deleting a key that isn't there succeeds, as it does on S3. */
  deleteObject(key: string): Promise<void>;
  /** One page of ListObjectsV2. */
  listPage(input: { prefix?: string; cursor?: string; maxKeys?: number }): Promise<{ objects: S3Object[]; next: string | null }>;
  /** Every object under a prefix, following the pages. */
  listAll(prefix?: string, options?: { limit?: number }): Promise<S3Object[]>;
}

export function createS3Client(options: S3ClientOptions): S3Client {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const endpoint = new URL(options.endpoint);
  /** Server time minus ours, learned from a RequestTimeTooSkewed answer. */
  let skew = 0;

  function urlFor(key: string | null, query: Record<string, string | undefined> = {}): URL {
    // A URL resolves "." and ".." before anything is signed: such a key would name another object.
    if (key !== null && (key === "" || key.split("/").some((part) => part === "." || part === ".."))) throw new S3Error(400, "InvalidObjectName", "That name has a . or .. part, so it isn't sent.");
    const base = endpoint.pathname.replace(/\/+$/, "");
    const keyPath = key === null ? "" : encodeKey(key);
    let url: URL;

    if (options.pathStyle) {
      url = new URL(`${endpoint.protocol}//${endpoint.host}${base}/${encodeKey(options.bucket)}${key === null ? "" : `/${keyPath}`}`);
    } else {
      url = new URL(`${endpoint.protocol}//${options.bucket}.${endpoint.host}${base}/${keyPath}`);
    }
    for (const [name, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(name, value);
    // URLSearchParams writes spaces as "+"; S3 reads "+" as a plus, so spell them %20 as the signature does.
    url.search = url.search.replace(/\+/g, "%20");
    return url;
  }

  async function send(method: string, url: URL, body: Uint8Array | null, headers: Record<string, string> = {}, retried = false): Promise<Response> {
    const payloadHash = body ? sha256Hex(body) : EMPTY_SHA256;
    const signed = signRequest({
      method,
      url,
      headers: { ...headers, "x-amz-content-sha256": payloadHash },
      payloadHash,
      region: options.region,
      service: "s3",
      credentials: options.credentials,
      date: new Date(now() + skew),
    });
    const timeout = AbortSignal.timeout(options.timeoutMs ?? S3_TIMEOUT_MS);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const { host: _host, ...sendHeaders } = signed.headers;
    let response: Response;

    try {
      response = await doFetch(url, { method, headers: sendHeaders, ...(body ? { body } : {}), redirect: "manual", signal });
    } catch (error) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}${error.cause instanceof Error ? ` (${error.cause.message})` : ""}` : String(error);

      throw new S3NetworkError(`${method} ${url.host}${url.pathname}: ${detail}`, timeout.aborted);
    }
    if (!retried && response.status === 403) {
      const text = await response.clone().text().catch(() => "");

      // A HEAD answer has no body to say so: a server clock far from ours is the sign.
      if (tag(text, "Code") === "RequestTimeTooSkewed" || (text === "" && method === "HEAD")) {
        const server = Date.parse(tag(text, "ServerTime") ?? response.headers.get("date") ?? "");

        if (Number.isFinite(server) && Math.abs(server - now()) > MAX_SKEW_MS / 3) {
          skew = server - now();
          return send(method, url, body, headers, true);
        }
      }
    }
    return response;
  }

  async function failure(response: Response): Promise<S3Error> {
    const text = (await response.text().catch(() => "")).slice(0, 16 * 1024);
    const headerRegion = response.headers.get("x-amz-bucket-region");
    const requestId = response.headers.get("x-amz-request-id");

    if (text.includes("<Error>")) {
      return new S3Error(response.status, tag(text, "Code") ?? STATUS_CODES[response.status] ?? `Http${response.status}`, tag(text, "Message") ?? "", tag(text, "Region") ?? headerRegion, requestId);
    }
    return new S3Error(response.status, STATUS_CODES[response.status] ?? `Http${response.status}`, text.slice(0, 300), headerRegion, requestId);
  }

  function metadataOf(headers: Headers): Record<string, string> {
    const out: Record<string, string> = {};

    headers.forEach((value, name) => {
      if (name.toLowerCase().startsWith("x-amz-meta-")) out[name.toLowerCase().slice("x-amz-meta-".length)] = value;
    });
    return out;
  }

  const stripQuotes = (value: string | null) => (value ?? "").replace(/^"|"$/g, "");

  const client: S3Client = {
    bucket: options.bucket,
    objectUrl: (key) => urlFor(key),

    async headBucket() {
      const response = await send("HEAD", urlFor(null), null);

      if (!response.ok) throw await failure(response);
    },

    async putObject(key, body, put = {}) {
      // fetch sets Content-Length itself; it isn't signed, so a proxy that rewrites it can't break the signature.
      const headers: Record<string, string> = {};

      if (put.contentType) headers["content-type"] = put.contentType;
      if (put.cacheControl) headers["cache-control"] = put.cacheControl;
      if (put.ifAbsent) headers["if-none-match"] = "*";
      for (const [name, value] of Object.entries(put.metadata ?? {})) headers[`x-amz-meta-${name.toLowerCase()}`] = value;
      const response = await send("PUT", urlFor(key), body, headers);

      if (!response.ok) throw await failure(response);
      await response.arrayBuffer().catch(() => undefined);
      return { etag: stripQuotes(response.headers.get("etag")) };
    },

    async getObject(key) {
      const response = await send("GET", urlFor(key), null);

      if (response.status === 404) {
        const error = await failure(response);

        if (error.code === "NoSuchKey" || error.code === "NotFound") return null;
        throw error;
      }
      if (!response.ok) throw await failure(response);
      return { body: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get("content-type"), metadata: metadataOf(response.headers) };
    },

    async headObject(key) {
      const response = await send("HEAD", urlFor(key), null);

      if (response.status === 404) return null;
      if (!response.ok) throw await failure(response);
      return {
        size: Number(response.headers.get("content-length") ?? 0),
        etag: stripQuotes(response.headers.get("etag")),
        contentType: response.headers.get("content-type"),
        cacheControl: response.headers.get("cache-control"),
        lastModified: Date.parse(response.headers.get("last-modified") ?? "") || now(),
        metadata: metadataOf(response.headers),
      };
    },

    async deleteObject(key) {
      const response = await send("DELETE", urlFor(key), null);

      if (!response.ok && response.status !== 404) throw await failure(response);
      await response.arrayBuffer().catch(() => undefined);
    },

    async listPage({ prefix, cursor, maxKeys }) {
      const response = await send("GET", urlFor(null, { "list-type": "2", prefix: prefix || undefined, "continuation-token": cursor, "max-keys": maxKeys ? String(maxKeys) : undefined }), null);

      if (!response.ok) throw await failure(response);
      const xml = await response.text();
      const objects: S3Object[] = [];

      for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const part = match[1]!;
        const key = tag(part, "Key");

        if (key === null) continue;
        objects.push({ key, size: Number(tag(part, "Size") ?? 0), etag: stripQuotes(tag(part, "ETag")), lastModified: Date.parse(tag(part, "LastModified") ?? "") || 0 });
      }
      const truncated = tag(xml, "IsTruncated") === "true";

      return { objects, next: truncated ? tag(xml, "NextContinuationToken") : null };
    },

    async listAll(prefix, list = {}) {
      const out: S3Object[] = [];
      let cursor: string | undefined;

      do {
        const page = await client.listPage({ prefix, ...(cursor ? { cursor } : {}) });

        out.push(...page.objects);
        cursor = page.next ?? undefined;
        if (list.limit && out.length >= list.limit) break;
      } while (cursor);
      return out;
    },
  };
  return client;
}
