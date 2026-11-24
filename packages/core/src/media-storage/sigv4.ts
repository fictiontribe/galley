/**
 * AWS Signature Version 4, header form, with `node:crypto` only.
 *
 * Written from AWS's own description of the algorithm ("Create a signed AWS
 * API request", IAM User Guide) and checked against the published test
 * vectors (test/media-storage/sigv4.test.ts). R2 and every S3-compatible
 * store accept exactly this, which is why one small signer is enough and no
 * SDK is needed.
 *
 * Paths are signed as given: the caller encodes object keys once with
 * `encodeKey` (S3 signs the path as sent, it does not double-encode).
 */
import { createHash, createHmac } from "node:crypto";

export const ALGORITHM = "AWS4-HMAC-SHA256";
export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
export const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

export interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface SignInput {
  method: string;
  url: URL;
  /** Headers to send and sign (names in any case). `host` and `x-amz-date` are added when absent. */
  headers: Record<string, string>;
  /** Hex SHA-256 of the body, or UNSIGNED_PAYLOAD. */
  payloadHash: string;
  region: string;
  service: string;
  credentials: Credentials;
  date: Date;
}

export interface Signed {
  /** Every header to send, `authorization` included, names lowercased. */
  headers: Record<string, string>;
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** RFC 3986 encoding as SigV4 defines it: unreserved characters stay, everything else is %XX in upper case. */
export function uriEncode(value: string, encodeSlash = true): string {
  let out = "";

  for (const byte of Buffer.from(value, "utf8")) {
    const char = String.fromCharCode(byte);

    if (/[A-Za-z0-9\-._~]/.test(char) || (char === "/" && !encodeSlash)) out += char;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/** An object key as a URL path: each segment encoded once, the slashes kept. */
export function encodeKey(key: string): string {
  return uriEncode(key, false);
}

/** "20150830T123600Z" */
export function amzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function canonicalQuery(url: URL): string {
  const pairs: Array<[string, string]> = [];

  for (const [key, value] of url.searchParams) pairs.push([uriEncode(key), uriEncode(value)]);
  pairs.sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  return pairs.map(([key, value]) => `${key}=${value}`).join("&");
}

export function signingKey(secret: string, day: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), service), "aws4_request");
}

export function signRequest(input: SignInput): Signed {
  const stamp = amzDate(input.date);
  const day = stamp.slice(0, 8);
  const headers: Record<string, string> = {};

  for (const [name, value] of Object.entries(input.headers)) headers[name.toLowerCase()] = value;
  headers.host ??= input.url.host;
  headers["x-amz-date"] ??= stamp;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]!.trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [input.method.toUpperCase(), input.url.pathname || "/", canonicalQuery(input.url), canonicalHeaders, signedHeaders, input.payloadHash].join("\n");
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(input.credentials.secretAccessKey, day, input.region, input.service)).update(stringToSign, "utf8").digest("hex");

  headers.authorization = `${ALGORITHM} Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { headers, canonicalRequest, stringToSign, signature };
}
