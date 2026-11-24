/**
 * A bucket as a media store: Cloudflare R2, Amazon S3 and S3-compatible
 * stores, all over the small S3 client (s3.ts). The site's files are kept
 * under its folder (`prefix`), named by Galley, served at the public address
 * plus the key, and never overwritten: every write asks the bucket to refuse
 * an existing name (If-None-Match: *), after a HEAD that catches the stores
 * which ignore that header.
 */
import type { MediaStorageConfig } from "../types";
import type { MediaCheckStepId } from "./contract";
import { endpointFor, normalizePrefix, pathStyleFor, publicUrlOf, regionFor } from "./info";
import { createS3Client, S3Error, S3NetworkError, type S3Client } from "./s3";
import type { Credentials } from "./sigv4";
import { ADDRESS_TAIL, cleanKey, escapePattern, StoreError, StoreNameTaken, type MediaStore, type StoredItem } from "./store";

export const BUCKET_CONNECTOR_NAMES: Record<string, string> = {
  r2: "Cloudflare R2",
  s3: "Amazon S3",
  "s3-compatible": "S3-compatible storage",
};

/** What the library takes; a bucket takes all of it. */
export const BUCKET_MAX_BYTES = 25 * 1024 * 1024;

/** Names never change once written, so visitors' browsers may keep them for a year. */
export const IMMUTABLE = "public, max-age=31536000, immutable";

const EXTENSION_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  mp4: "video/mp4",
};

export function typeOfKey(key: string): string | null {
  const dot = key.lastIndexOf(".");

  return dot > 0 ? (EXTENSION_TYPES[key.slice(dot + 1).toLowerCase()] ?? null) : null;
}

export interface BucketStoreOptions {
  config: MediaStorageConfig;
  credentials: Credentials;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

export function createBucketStore(options: BucketStoreOptions): MediaStore & { client: S3Client } {
  const { config } = options;
  const name = BUCKET_CONNECTOR_NAMES[config.connector] ?? "the storage service";
  const prefix = normalizePrefix(config.prefix);
  const publicBase = config.publicUrl.replace(/\/+$/, "");
  const client = createS3Client({
    endpoint: endpointFor(config),
    region: regionFor(config),
    bucket: config.bucket,
    credentials: options.credentials,
    pathStyle: pathStyleFor(config),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
  const now = options.now ?? Date.now;

  const where = config.connector === "s3" ? `in ${config.region ?? "that Region"}` : config.connector === "r2" ? "in that Cloudflare account" : "at that address";
  const folder = prefix ? `the bucket's “${prefix}” folder` : "the bucket";
  const permissionFix =
    config.connector === "r2"
      ? "On Cloudflare, give the key “Object Read & Write” on this bucket."
      : config.connector === "s3"
        ? "Check the user's inline policy is the one Galley shows, with this bucket's name and folder."
        : "Give the key permission to list, add, read and delete files in the bucket.";

  function explain(error: unknown, step: MediaCheckStepId): StoreError {
    if (error instanceof StoreError) return error;
    if (error instanceof S3NetworkError) {
      const host = (() => {
        try {
          return new URL(endpointFor(config)).host;
        } catch {
          return endpointFor(config);
        }
      })();

      return new StoreError(
        error.timedOut
          ? `${host} didn't answer within a minute. Try again; if it keeps happening, check this computer's internet connection.`
          : config.connector === "r2"
            ? `Couldn't reach ${host}. Check the Account ID (32 letters and digits, from R2's Overview page).`
            : config.connector === "s3"
              ? `Couldn't reach ${host}. Check the Region code.`
              : `Couldn't reach ${host}. Check the S3 address.`,
        { step, field: config.connector === "r2" ? (config.endpoint ? "endpoint" : "account") : config.connector === "s3" ? "region" : "endpoint", detail: error.message, transient: true }
      );
    }
    if (!(error instanceof S3Error)) return new StoreError(`${name} couldn't be used: ${error instanceof Error ? error.message : String(error)}`, { step });
    const detail = `${error.code}${error.message && error.message !== error.code ? `: ${error.message}` : ""}${error.requestId ? ` (request ${error.requestId})` : ""}`;

    switch (error.code) {
      case "InvalidAccessKeyId":
        return new StoreError(`${name} doesn't know that Access Key ID. Copy it again from where the key was made, or make a new key.`, { step, field: "accessKeyId", detail });
      case "SignatureDoesNotMatch":
        return new StoreError("The Secret Access Key doesn't go with that Access Key ID. Paste the secret again: it is the longer of the two.", { step, field: "secretAccessKey", detail });
      case "RequestTimeTooSkewed":
        return new StoreError(`This computer's clock is too far off, so ${name} refuses its requests. Set the clock to update automatically and try again.`, { step, detail });
      case "NoSuchBucket":
        return new StoreError(`There's no bucket called “${config.bucket}” ${where}. Check the name: it has to match exactly.`, { step, field: "bucket", detail });
      case "PermanentRedirect":
      case "AuthorizationHeaderMalformed":
      case "IllegalLocationConstraintException":
        if (error.region && error.region !== regionFor(config) && config.connector !== "r2") {
          return new StoreError(`The bucket is in ${error.region}, not ${regionFor(config)}. Change the Region to ${error.region}.`, { step, field: "region", detail });
        }
        break;
      case "AccessDenied":
      case "AllAccessDisabled": {
        const what: Record<string, string> = {
          reach: `The key isn't allowed to look in ${folder}.`,
          list: `The key isn't allowed to list ${folder}.`,
          write: `The key can look in ${folder} but isn't allowed to add files.`,
          read: `The key can add files but isn't allowed to read them back.`,
          delete: "The key isn't allowed to delete files. Galley needs that to remove its test file, and files nobody uses when you ask it to.",
        };

        return new StoreError(`${what[step] ?? "The key isn't allowed to do that."} ${permissionFix}`, { step, field: "accessKeyId", detail });
      }
      case "SlowDown":
      case "ServiceUnavailable":
      case "InternalError":
        return new StoreError(`${name} is busy or had a problem on its side. Try again in a minute.`, { step, detail, transient: true });
      default:
        break;
    }
    if (error.status >= 500) return new StoreError(`${name} had a problem on its side. Try again in a minute.`, { step, detail, transient: true });
    return new StoreError(`${name} refused (${error.code}).`, { step, detail });
  }

  async function attempt<T>(step: MediaCheckStepId, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw explain(error, step);
    }
  }

  const store: MediaStore & { client: S3Client; explain: typeof explain } = {
    location: "bucket",
    connector: config.connector,
    name,
    client,
    explain,
    abilities: {
      accepts: { types: "any", maxBytes: BUCKET_MAX_BYTES },
      naming: "galley",
      address: "key",
      canList: true,
      knowsDimensions: false,
    },

    async reach() {
      // A one-item listing of the site's folder rather than HeadBucket: the
      // S3 policy limits listing to that folder, and HeadBucket needs more.
      await attempt("reach", () => client.listPage({ prefix, maxKeys: 1 }));
    },

    async put(input) {
      const key = input.name;

      if (prefix && !key.startsWith(prefix)) throw new StoreError(`Files go in ${folder}.`, { step: "write" });
      const existing = await attempt("write", () => client.headObject(key));

      if (existing) throw new StoreNameTaken(key);
      const metadata: Record<string, string> = {};

      if (input.width && input.height) {
        metadata.width = String(input.width);
        metadata.height = String(input.height);
      }
      try {
        await client.putObject(key, input.data, { contentType: input.type, cacheControl: IMMUTABLE, metadata, ifAbsent: true });
      } catch (error) {
        if (error instanceof S3Error && (error.code === "PreconditionFailed" || error.status === 412)) throw new StoreNameTaken(key);
        throw explain(error, "write");
      }
      return {
        key,
        url: publicUrlOf(publicBase, key),
        size: input.data.byteLength,
        type: input.type,
        ...(input.width && input.height ? { width: input.width, height: input.height } : {}),
        uploadedAt: now(),
      };
    },

    async head(key) {
      const head = await attempt("read", () => client.headObject(key));

      if (!head) return null;
      const width = Number(head.metadata.width);
      const height = Number(head.metadata.height);

      return {
        key,
        url: publicUrlOf(publicBase, key),
        size: head.size,
        type: head.contentType ?? typeOfKey(key),
        ...(width > 0 && height > 0 ? { width, height } : {}),
        uploadedAt: head.lastModified,
      };
    },

    async get(key) {
      const object = await attempt("read", () => client.getObject(key));

      return object ? object.body : null;
    },

    async delete(key) {
      await attempt("delete", () => client.deleteObject(key));
    },

    async list(cursor) {
      const page = await attempt("list", () => client.listPage({ prefix, ...(cursor ? { cursor } : {}) }));
      const items: StoredItem[] = page.objects
        .filter((object) => !object.key.endsWith("/") && typeOfKey(object.key) !== null)
        .map((object) => ({ key: object.key, url: publicUrlOf(publicBase, object.key), size: object.size, type: typeOfKey(object.key), uploadedAt: object.lastModified }));

      return { items, next: page.next };
    },

    urlOf(key) {
      return publicUrlOf(publicBase, key);
    },

    ownsKey(key) {
      return cleanKey(key) && (!prefix || key.startsWith(prefix));
    },

    keyFor(relative) {
      return `${prefix}${relative.replace(/^\/+/, "")}`;
    },

    otherBases() {
      // The bucket's own S3 address, as the client reaches it ("https://<account>.r2.cloudflarestorage.com/<bucket>").
      return [client.objectUrl("x").toString().replace(/\/x$/, "")];
    },

    addressPattern() {
      return `${escapePattern(publicBase)}/${ADDRESS_TAIL}`;
    },

    keyOf(url) {
      return keyUnder(publicBase, prefix, url);
    },

    rebase(url, publicUrl) {
      const key = keyUnder(publicBase, prefix, url);

      return key === null ? null : publicUrlOf(publicUrl, key);
    },

    publicProblem(kind, url) {
      const host = (() => {
        try {
          return new URL(url).host;
        } catch {
          return publicBase;
        }
      })();

      switch (kind) {
        case "unreachable":
          return config.connector === "r2"
            ? `${host} doesn't answer. If you just connected it as a custom domain, wait until R2 shows it as “Active” and check again.`
            : `${host} doesn't answer. Check the public address.`;
        case "missing":
          return config.connector === "r2"
            ? `${host} answers, but not with this bucket's files. Check it is the custom domain (or r2.dev address) shown in this bucket's Settings.`
            : `${host} answers, but not with this bucket's files. Check the public address points at this bucket${prefix ? " (without the folder: Galley adds it)" : ""}.`;
        case "refused":
          return config.connector === "s3"
            ? "The bucket turns visitors away. In the S3 console, turn off “Block all public access” for the bucket (and for the account if AWS says so), then add the bucket policy Galley shows."
            : config.connector === "r2"
              ? "The address turns visitors away. Check the custom domain is connected to this bucket and “Active”, or that the r2.dev address shows “Allowed”."
              : "The address turns visitors away. Make the bucket's files readable by anyone.";
        case "different":
          return `${host} serves something other than the file Galley just stored. Check the public address belongs to this bucket.`;
      }
    },
  };
  return store;
}

/** The key behind an address under `publicBase` and inside the site's folder; null otherwise. Ignores ?query and #hash. */
export function keyUnder(publicBase: string, prefix: string, url: string): string | null {
  const base = publicBase.replace(/\/+$/, "");
  const bare = url.split(/[?#]/)[0] ?? "";

  if (!bare.startsWith(`${base}/`)) return null;
  let key: string;

  try {
    key = bare
      .slice(base.length + 1)
      .split("/")
      .map((part) => decodeURIComponent(part))
      .join("/");
  } catch {
    return null;
  }
  if (!key || key.endsWith("/") || key.split("/").includes("..")) return null;
  if (prefix && !key.startsWith(prefix)) return null;
  return key;
}
