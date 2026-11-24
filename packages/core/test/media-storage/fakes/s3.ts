/**
 * A strict stand-in for an S3 bucket service (Amazon S3, Cloudflare R2, any
 * S3-compatible store) and the "public address" visitors load files from.
 *
 * Strict means a request that the real services would refuse is refused here
 * the same way, with their error codes:
 *  - the Signature Version 4 signature is checked for real, by a verifier
 *    written separately from the engine's signer (so a shared mistake can't
 *    pass), including the body's SHA-256 (XAmzContentSHA256Mismatch);
 *  - unknown key → InvalidAccessKeyId; wrong secret → SignatureDoesNotMatch;
 *    a clock more than 15 minutes out → RequestTimeTooSkewed with ServerTime;
 *  - a missing bucket → NoSuchBucket; a missing object → NoSuchKey;
 *  - the wrong region → AuthorizationHeaderMalformed naming the right one
 *    (301 with x-amz-bucket-region for HEAD, as S3 answers HeadBucket);
 *  - each key has permissions per bucket (read, write, list, delete), and
 *    optionally only within a folder (an s3:prefix condition) →
 *    AccessDenied for anything else;
 *  - PUT with If-None-Match: * on an existing key → PreconditionFailed;
 *  - ListObjectsV2 pages (small pages on purpose, so paging is exercised).
 *
 * Path-style addressing over HTTP; virtual-hosted addressing is checked
 * in-process with `verify` (no DNS for bucket names on a test machine).
 */
import { createHash, createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type Permission = "read" | "write" | "list" | "delete";

export interface FakeObject {
  body: Buffer;
  contentType: string;
  cacheControl: string | null;
  metadata: Record<string, string>;
  etag: string;
  lastModified: Date;
}

export interface FakeBucket {
  name: string;
  /** "auto" behaves as R2: it accepts "auto" and "us-east-1" in the signature. */
  region: string;
  public: boolean;
  objects: Map<string, FakeObject>;
}

export interface FakeKey {
  id: string;
  secret: string;
  buckets: Record<string, Permission[]>;
  /**
   * The IAM policy Galley gives for S3: object actions only under this
   * folder, and s3:ListBucket only with an s3:prefix under it — so
   * HeadBucket (which needs ListBucket with no condition) is refused.
   */
  prefix?: string;
}

export interface FakeS3Log {
  method: string;
  path: string;
  status: number;
  code?: string;
  /** The access key id used, never the secret. */
  key: string | null;
  /** Every header name and value the request carried, for "nothing secret was sent in the clear" checks. */
  headers: Record<string, string>;
}

export interface FakeS3 {
  endpoint: string;
  publicBase: string;
  log: FakeS3Log[];
  buckets: Map<string, FakeBucket>;
  keys: Map<string, FakeKey>;
  /** Added to this process's clock to make the "server" time (simulates a skewed computer). */
  clockOffsetMs: number;
  /** Objects per ListObjectsV2 page at most. */
  pageSize: number;
  addBucket(name: string, options?: { region?: string; public?: boolean }): FakeBucket;
  addKey(key: FakeKey): FakeKey;
  /** The public address of a bucket on the stand-in's public origin. */
  publicUrl(bucket: string): string;
  /** Checks a request the way the server does; the error code, or null when it would be accepted. In-process use (virtual-hosted URLs). */
  verify(request: { method: string; url: URL; headers: Record<string, string>; body: Buffer }): { code: string; status: number } | null;
  close(): Promise<void>;
}

const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function xmlEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function errorXml(code: string, message: string, extra: Record<string, string> = {}): string {
  const more = Object.entries(extra)
    .map(([name, value]) => `<${name}>${xmlEscape(value)}</${name}>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code><Message>${xmlEscape(message)}</Message>${more}<RequestId>fake-request</RequestId></Error>`;
}

interface Parsed {
  method: string;
  rawPath: string;
  rawQuery: string;
  headers: Record<string, string>;
  body: Buffer;
}

interface Outcome {
  status: number;
  body?: Buffer | string;
  headers?: Record<string, string>;
  code?: string;
  key?: string | null;
}

export async function startFakeS3(options: { port?: number; publicPort?: number; pageSize?: number } = {}): Promise<FakeS3> {
  const buckets = new Map<string, FakeBucket>();
  const keys = new Map<string, FakeKey>();
  const log: FakeS3Log[] = [];
  const state = { clockOffsetMs: 0, pageSize: options.pageSize ?? 3 };

  function canonicalQuery(raw: string): string {
    if (!raw) return "";
    return raw
      .split("&")
      .filter(Boolean)
      .map((pair) => {
        const at = pair.indexOf("=");
        const name = decodeURIComponent((at === -1 ? pair : pair.slice(0, at)).replace(/\+/g, " "));
        const value = at === -1 ? "" : decodeURIComponent(pair.slice(at + 1).replace(/\+/g, " "));

        return [encode(name), encode(value)] as const;
      })
      .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
      .map(([name, value]) => `${name}=${value}`)
      .join("&");
  }

  /** Authentication and the region: an error, or who is asking. */
  function authenticate(request: Parsed, bucket: FakeBucket | null): { error: Outcome } | { key: FakeKey } {
    const auth = request.headers.authorization ?? "";
    const match = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, ?SignedHeaders=([^,]+), ?Signature=([0-9a-f]{64})$/.exec(auth);
    const head = request.method === "HEAD";

    if (!match) return { error: { status: 403, code: "AccessDenied", body: head ? "" : errorXml("AccessDenied", "Access Denied") } };
    const [, id, day, region, signedList, signature] = match as unknown as [string, string, string, string, string, string];
    const key = keys.get(id);

    if (!key) return { error: { status: 403, code: "InvalidAccessKeyId", key: id, body: head ? "" : errorXml("InvalidAccessKeyId", "The AWS Access Key Id you provided does not exist in our records.", { AWSAccessKeyId: id }) } };
    const stamp = request.headers["x-amz-date"] ?? "";
    const sent = Date.parse(stamp.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z"));
    const serverNow = Date.now() + state.clockOffsetMs;

    if (!Number.isFinite(sent) || Math.abs(serverNow - sent) > 15 * 60_000) {
      return {
        error: {
          status: 403,
          code: "RequestTimeTooSkewed",
          key: id,
          headers: { date: new Date(serverNow).toUTCString() },
          body: errorXml("RequestTimeTooSkewed", "The difference between the request time and the current time is too large.", { RequestTime: stamp, ServerTime: new Date(serverNow).toISOString(), MaxAllowedSkewMilliseconds: "900000" }),
        },
      };
    }
    if (request.rawPath !== "/" && bucket === null) {
      const name = decodeURIComponent(request.rawPath.split("/")[1] ?? "");

      return { error: { status: 404, code: "NoSuchBucket", key: id, body: head ? "" : errorXml("NoSuchBucket", "The specified bucket does not exist", { BucketName: name }) } };
    }
    if (bucket) {
      const accepted = bucket.region === "auto" ? ["auto", "us-east-1"] : [bucket.region];

      if (!accepted.includes(region)) {
        if (head) return { error: { status: 301, code: "PermanentRedirect", key: id, headers: { "x-amz-bucket-region": bucket.region } } };
        return {
          error: {
            status: 400,
            code: "AuthorizationHeaderMalformed",
            key: id,
            body: errorXml("AuthorizationHeaderMalformed", `The authorization header is malformed; the region '${region}' is wrong; expecting '${bucket.region}'`, { Region: bucket.region }),
          },
        };
      }
    }
    const signed = signedList.split(";");

    if (!signed.includes("host") || !signed.includes("x-amz-date") || !signed.includes("x-amz-content-sha256")) {
      return { error: { status: 403, code: "AccessDenied", key: id, body: head ? "" : errorXml("AccessDenied", "Host, x-amz-date and x-amz-content-sha256 must be signed.") } };
    }
    const payload = request.headers["x-amz-content-sha256"] ?? "";

    if (payload !== "UNSIGNED-PAYLOAD" && payload !== createHash("sha256").update(request.body).digest("hex")) {
      return { error: { status: 400, code: "XAmzContentSHA256Mismatch", key: id, body: errorXml("XAmzContentSHA256Mismatch", "The provided 'x-amz-content-sha256' header does not match what was computed.") } };
    }
    const canonical = [
      request.method,
      request.rawPath,
      canonicalQuery(request.rawQuery),
      signed.map((name) => `${name}:${(request.headers[name] ?? "").trim().replace(/\s+/g, " ")}\n`).join(""),
      signedList,
      payload,
    ].join("\n");
    const toSign = ["AWS4-HMAC-SHA256", stamp, `${day}/${region}/s3/aws4_request`, createHash("sha256").update(canonical).digest("hex")].join("\n");
    let signingKey: Buffer = createHmac("sha256", `AWS4${key.secret}`).update(day).digest();

    for (const part of [region, "s3", "aws4_request"]) signingKey = createHmac("sha256", signingKey).update(part).digest();
    const expected = createHmac("sha256", signingKey).update(toSign).digest("hex");

    if (expected !== signature) {
      return { error: { status: 403, code: "SignatureDoesNotMatch", key: id, body: head ? "" : errorXml("SignatureDoesNotMatch", "The request signature we calculated does not match the signature you provided. Check your key and signing method.") } };
    }
    return { key };
  }

  function may(key: FakeKey, bucket: string, permission: Permission): boolean {
    return (key.buckets[bucket] ?? []).includes(permission);
  }

  function denied(method: string, id: string): Outcome {
    return { status: 403, code: "AccessDenied", key: id, body: method === "HEAD" ? "" : errorXml("AccessDenied", "Access Denied") };
  }

  function objectHeaders(object: FakeObject): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": object.contentType,
      "content-length": String(object.body.byteLength),
      etag: `"${object.etag}"`,
      "last-modified": object.lastModified.toUTCString(),
    };

    if (object.cacheControl) headers["cache-control"] = object.cacheControl;
    for (const [name, value] of Object.entries(object.metadata)) headers[`x-amz-meta-${name}`] = value;
    return headers;
  }

  function handle(request: Parsed): Outcome {
    const segments = request.rawPath.split("/");
    const bucketName = decodeURIComponent(segments[1] ?? "");
    const objectKey = segments.length > 2 ? decodeURIComponent(segments.slice(2).join("/")) : "";
    const bucket = buckets.get(bucketName) ?? null;
    const auth = authenticate(request, bucket);

    if ("error" in auth) return auth.error;
    const { key } = auth;

    if (!bucket) return { status: 400, code: "InvalidRequest", key: key.id, body: errorXml("InvalidRequest", "A bucket is needed.") };
    const query = new URLSearchParams(request.rawQuery);

    if (!objectKey) {
      if (request.method === "HEAD") {
        return !key.prefix && Object.keys(key.buckets).includes(bucket.name) && (key.buckets[bucket.name] ?? []).length > 0 ? { status: 200, key: key.id, headers: { "x-amz-bucket-region": bucket.region } } : denied("HEAD", key.id);
      }
      if (request.method === "GET" && query.get("list-type") === "2") {
        const prefix = query.get("prefix") ?? "";

        if (!may(key, bucket.name, "list") || (key.prefix && !prefix.startsWith(key.prefix))) return denied("GET", key.id);
        const after = query.get("continuation-token") ? Buffer.from(query.get("continuation-token")!, "base64url").toString("utf8") : null;
        const max = Math.min(state.pageSize, Number(query.get("max-keys") ?? 1000) || 1000);
        const all = [...bucket.objects.keys()].filter((name) => name.startsWith(prefix)).sort();
        const start = after === null ? 0 : all.findIndex((name) => name > after);
        const page = start === -1 ? [] : all.slice(start, start + max);
        const truncated = start !== -1 && start + max < all.length;
        const contents = page
          .map((name) => {
            const object = bucket.objects.get(name)!;

            return `<Contents><Key>${xmlEscape(name)}</Key><LastModified>${object.lastModified.toISOString()}</LastModified><ETag>&quot;${object.etag}&quot;</ETag><Size>${object.body.byteLength}</Size><StorageClass>STANDARD</StorageClass></Contents>`;
          })
          .join("");
        const next = truncated ? `<NextContinuationToken>${Buffer.from(page[page.length - 1]!).toString("base64url")}</NextContinuationToken>` : "";

        return {
          status: 200,
          key: key.id,
          headers: { "content-type": "application/xml" },
          body: `<?xml version="1.0" encoding="UTF-8"?>\n<ListBucketResult><Name>${bucket.name}</Name><Prefix>${xmlEscape(prefix)}</Prefix><KeyCount>${page.length}</KeyCount><MaxKeys>${max}</MaxKeys><IsTruncated>${truncated}</IsTruncated>${contents}${next}</ListBucketResult>`,
        };
      }
      return { status: 400, code: "InvalidRequest", key: key.id, body: errorXml("InvalidRequest", "Not supported by the stand-in.") };
    }
    const existing = bucket.objects.get(objectKey);

    if (key.prefix && !objectKey.startsWith(key.prefix)) return denied(request.method, key.id);
    switch (request.method) {
      case "PUT": {
        if (!may(key, bucket.name, "write")) return denied("PUT", key.id);
        if (request.headers["if-none-match"] === "*" && existing) return { status: 412, code: "PreconditionFailed", key: key.id, body: errorXml("PreconditionFailed", "At least one of the pre-conditions you specified did not hold", { Condition: "If-None-Match" }) };
        const metadata: Record<string, string> = {};

        for (const [name, value] of Object.entries(request.headers)) if (name.startsWith("x-amz-meta-")) metadata[name.slice("x-amz-meta-".length)] = value;
        const object: FakeObject = {
          body: request.body,
          contentType: request.headers["content-type"] ?? "binary/octet-stream",
          cacheControl: request.headers["cache-control"] ?? null,
          metadata,
          etag: createHash("md5").update(request.body).digest("hex"),
          lastModified: new Date(),
        };

        bucket.objects.set(objectKey, object);
        return { status: 200, key: key.id, headers: { etag: `"${object.etag}"` } };
      }
      case "GET":
      case "HEAD": {
        if (!may(key, bucket.name, "read")) return denied(request.method, key.id);
        if (!existing) return { status: 404, code: "NoSuchKey", key: key.id, body: request.method === "HEAD" ? "" : errorXml("NoSuchKey", "The specified key does not exist.", { Key: objectKey }) };
        return { status: 200, key: key.id, headers: objectHeaders(existing), body: request.method === "HEAD" ? "" : existing.body };
      }
      case "DELETE": {
        if (!may(key, bucket.name, "delete")) return denied("DELETE", key.id);
        bucket.objects.delete(objectKey);
        return { status: 204, key: key.id };
      }
      default:
        return { status: 405, code: "MethodNotAllowed", key: key.id, body: errorXml("MethodNotAllowed", "The specified method is not allowed against this resource.") };
    }
  }

  function read(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

  function flatHeaders(req: IncomingMessage): Record<string, string> {
    const out: Record<string, string> = {};

    for (const [name, value] of Object.entries(req.headers)) if (value !== undefined) out[name] = Array.isArray(value) ? value.join(",") : value;
    return out;
  }

  function reply(res: ServerResponse, outcome: Outcome, head: boolean): void {
    res.writeHead(outcome.status, { ...(outcome.body && !head ? { "content-type": "application/xml" } : {}), ...outcome.headers });
    res.end(head ? undefined : outcome.body);
  }

  const api: Server = createServer((req, res) => {
    void read(req).then((body) => {
      const raw = req.url ?? "/";
      const at = raw.indexOf("?");
      const parsed: Parsed = { method: req.method ?? "GET", rawPath: at === -1 ? raw : raw.slice(0, at), rawQuery: at === -1 ? "" : raw.slice(at + 1), headers: flatHeaders(req), body };
      let outcome: Outcome;

      try {
        outcome = handle(parsed);
      } catch (error) {
        outcome = { status: 500, code: "InternalError", body: errorXml("InternalError", String(error)) };
      }
      log.push({ method: parsed.method, path: parsed.rawPath, status: outcome.status, ...(outcome.code ? { code: outcome.code } : {}), key: outcome.key ?? null, headers: parsed.headers });
      reply(res, outcome, parsed.method === "HEAD");
    });
  });

  /** The public origin: /<bucket>/<key>, no signature, only for public buckets. */
  const site: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0]!;
    const [, name = "", ...rest] = path.split("/");
    const bucket = buckets.get(decodeURIComponent(name));
    const object = bucket?.objects.get(decodeURIComponent(rest.join("/")));

    if (!bucket || !bucket.public) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("This bucket is not public.");
      return;
    }
    if (!object) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, objectHeaders(object));
    res.end(req.method === "HEAD" ? undefined : object.body);
  });

  await new Promise<void>((resolve) => api.listen(options.port ?? 0, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => site.listen(options.publicPort ?? 0, "127.0.0.1", resolve));
  const apiPort = (api.address() as AddressInfo).port;
  const sitePort = (site.address() as AddressInfo).port;
  const publicBase = `http://127.0.0.1:${sitePort}`;

  const fake: FakeS3 = {
    endpoint: `http://127.0.0.1:${apiPort}`,
    publicBase,
    log,
    buckets,
    keys,
    get clockOffsetMs() {
      return state.clockOffsetMs;
    },
    set clockOffsetMs(value: number) {
      state.clockOffsetMs = value;
    },
    get pageSize() {
      return state.pageSize;
    },
    set pageSize(value: number) {
      state.pageSize = value;
    },
    addBucket(name, bucketOptions = {}) {
      const bucket: FakeBucket = { name, region: bucketOptions.region ?? "us-east-1", public: bucketOptions.public ?? true, objects: new Map() };

      buckets.set(name, bucket);
      return bucket;
    },
    addKey(key) {
      keys.set(key.id, key);
      return key;
    },
    publicUrl: (bucket) => `${publicBase}/${encodeURIComponent(bucket)}`,
    verify(request) {
      // Virtual-hosted: the bucket is the first label of the host; the path is the key.
      const host = request.url.host;
      const bucketName = host.split(".")[0] ?? "";
      const headers: Record<string, string> = {};

      for (const [name, value] of Object.entries(request.headers)) headers[name.toLowerCase()] = value;
      headers.host = host;
      const parsed: Parsed = {
        method: request.method,
        rawPath: `/${encodeURIComponent(bucketName)}${request.url.pathname === "/" ? "" : request.url.pathname}`,
        rawQuery: request.url.search.slice(1),
        headers,
        body: request.body,
      };
      // Sign-check against the path as the client sent it (bucket in the host, not the path).
      const outcome = (() => {
        const bucket = buckets.get(bucketName) ?? null;
        const result = authenticate({ ...parsed, rawPath: request.url.pathname }, bucket);

        return "error" in result ? result.error : null;
      })();

      return outcome ? { code: outcome.code ?? "Error", status: outcome.status } : null;
    },
    close: () => Promise.all([new Promise<void>((resolve) => api.close(() => resolve())), new Promise<void>((resolve) => site.close(() => resolve()))]).then(() => undefined),
  };
  return fake;
}
